import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { chromium } from "playwright-core";
import { ProfileRegistryStore } from "../../src/profiles/registry.js";
import { ProfileManager } from "../../src/profiles/manager.js";
import { inspectChrome } from "../../src/platform/chrome.js";
import { readBrowserEligibility, startManagerServer, type ManagerBrowserController } from "../../src/manager/server.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "gpt-web-image-manager-api-"));
  const store = new ProfileRegistryStore(join(root, "profile-registry.json"), join(root, "profiles"));
  const manager = new ProfileManager(store);
  const outputRoot = join(root, "outputs", "gpt-web-images");
  await mkdir(outputRoot, { recursive: true });
  const openProfiles = new Set<string>();
  const browser: ManagerBrowserController = {
    check: async () => ({ login: "logged_in", membership: "plus", evidenceKinds: ["fixture"], checkedAt: new Date().toISOString(), eligible: true }),
    open: async (profile) => { if (openProfiles.size && !openProfiles.has(profile.profileId)) throw new Error("BROWSER_BUSY"); openProfiles.add(profile.profileId); },
    close: async (profile) => { openProfiles.delete(profile.profileId); },
    closeAll: async () => { openProfiles.clear(); }
  };
  const server = await startManagerServer({ runtime: { store, manager, dataRoot: root }, outputRoot, backupRoot: join(root, "backups"), browser, port: 0 });
  return { root, store, manager, outputRoot, server, baseUrl: server.url };
}

async function json(baseUrl: string, path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}/api${path}`, { ...init, headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => null);
  return { response, body };
}

test("T48 manager eligibility waits for the hydrated composer before reading plan signals", { skip: !inspectChrome().available }, async () => {
  const chrome = inspectChrome();
  const browser = await chromium.launch({ executablePath: chrome.path as string, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<main id=app></main>");
    setTimeout(() => void page.evaluate(() => { document.querySelector("#app")!.innerHTML = '<div role="button" aria-label="bang wei Plus，打开个人资料菜单">bang weiPlus</div><div contenteditable="true" aria-label="与 ChatGPT 聊天"></div>'; }), 150);
    const result = await readBrowserEligibility(page, 2_000);
    assert.equal(result.login, "logged_in");
    assert.equal(result.membership, "plus");
    assert.equal(result.eligible, true);
  } finally {
    await browser.close();
  }
});

test("T51 listens only on loopback and exposes schema-limited Profile lifecycle APIs", async () => {
  const { server, baseUrl } = await fixture();
  try {
    assert.equal(server.host, "127.0.0.1");
    const created = await json(baseUrl, "/profiles", { method: "POST", body: JSON.stringify({ name: "主账号", accountLabel: "Plus", notes: "专用" }) });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.active, false);
    assert.equal("token" in created.body, false);
    const profileId = created.body.profileId as string;

    const checked = await json(baseUrl, `/profiles/${profileId}/check`, { method: "POST" });
    assert.equal(checked.response.status, 200);
    assert.equal(checked.body.membership, "plus");
    assert.equal("evidenceKinds" in checked.body, false);
    assert.equal((await json(baseUrl, `/profiles/${profileId}/activate`, { method: "POST" })).response.status, 200);
    assert.equal((await json(baseUrl, "/profiles")).body.activeProfileId, profileId);
    assert.equal((await json(baseUrl, `/profiles/${profileId}/open`, { method: "POST" })).response.status, 200);
    assert.equal((await json(baseUrl, `/profiles/${profileId}/close`, { method: "POST" })).response.status, 200);
  } finally { await server.close(); }
});

test("T51/T53 requires page-issued two-step confirmation and never exposes an image delete API", async () => {
  const { server, baseUrl } = await fixture();
  try {
    const created = (await json(baseUrl, "/profiles", { method: "POST", body: JSON.stringify({ name: "待删除", accountLabel: null }) })).body;
    const profileId = created.profileId as string;
    assert.equal((await json(baseUrl, `/profiles/${profileId}`, { method: "DELETE" })).response.status, 409);
    assert.equal((await json(baseUrl, `/profiles/${profileId}/delete-confirmation`, { method: "POST", body: JSON.stringify({ profileName: "错误" }) })).response.status, 400);
    const issued = await json(baseUrl, `/profiles/${profileId}/delete-confirmation`, { method: "POST", body: JSON.stringify({ profileName: "待删除" }) });
    const removed = await json(baseUrl, `/profiles/${profileId}`, { method: "DELETE", headers: { "X-Delete-Confirmation": issued.body.confirmation } });
    assert.equal(removed.response.status, 204);
    assert.equal((await json(baseUrl, `/profiles/${profileId}/images/not-there`, { method: "DELETE" })).response.status, 405);
  } finally { await server.close(); }
});

test("T46/T54/T55 plans directories and restores a complete backup as inactive", async () => {
  const { root, server, baseUrl } = await fixture();
  try {
    const profile = (await json(baseUrl, "/profiles", { method: "POST", body: JSON.stringify({ name: "备份源", accountLabel: null }) })).body;
    await writeFile(join(profile.profileDir, "Local State"), "browser-state");
    const planned = await json(baseUrl, "/directories/plan", { method: "POST", body: JSON.stringify({ targetRootDir: join(root, "新目录"), mode: "retain" }) });
    assert.equal(planned.response.status, 200);
    assert.equal((await json(baseUrl, "/directories/retain", { method: "POST", body: JSON.stringify({ targetRootDir: join(root, "新目录") }) })).response.status, 200);
    const backup = await json(baseUrl, `/profiles/${profile.profileId}/backups`, { method: "POST" });
    assert.equal(backup.body.includesChromeAuthData, true);
    const restored = await json(baseUrl, `/backups/${backup.body.backupId}/restore`, { method: "POST", body: JSON.stringify({ name: "恢复副本" }) });
    assert.equal(restored.response.status, 201);
    assert.equal(restored.body.active, false);
    assert.notEqual(restored.body.profileId, profile.profileId);
  } finally { await server.close(); }
});

test("T63-T74 scans and queries only the selected Profile and serves indexed content", async () => {
  const { server, baseUrl, outputRoot } = await fixture();
  try {
    const first = (await json(baseUrl, "/profiles", { method: "POST", body: JSON.stringify({ name: "A", accountLabel: null }) })).body;
    const second = (await json(baseUrl, "/profiles", { method: "POST", body: JSON.stringify({ name: "B", accountLabel: null }) })).body;
    for (const profile of [first, second]) {
      const taskRoot = join(outputRoot, profile.profileId);
      await mkdir(taskRoot, { recursive: true });
      await writeFile(join(taskRoot, "task.json"), JSON.stringify({ schemaVersion: "1", taskId: `task-${profile.name}`, createdAt: new Date().toISOString(), request: { kind: "generate", prompt: profile.name }, profileBinding: { profileId: profile.profileId, profileDir: profile.profileDir, boundAt: new Date().toISOString() } }));
      await sharp({ create: { width: 24, height: 16, channels: 3, background: profile.name === "A" ? "red" : "blue" } }).png().toFile(join(taskRoot, `${profile.name}.png`));
    }
    assert.equal((await json(baseUrl, `/profiles/${first.profileId}/images/scan`, { method: "POST" })).response.status, 200);
    const listed = await json(baseUrl, `/profiles/${first.profileId}/images?sort=generatedAt_desc&page=1&pageSize=20`);
    assert.equal(listed.body.total, 1);
    assert.equal(listed.body.items[0].fileName, "A.png");
    const imageId = listed.body.items[0].imageId as string;
    assert.equal((await json(baseUrl, `/profiles/${first.profileId}/images/${imageId}`)).response.status, 200);
    const content = await fetch(`${baseUrl}/api/profiles/${first.profileId}/images/${imageId}/content`);
    assert.equal(content.status, 200);
    assert.match(content.headers.get("content-type") ?? "", /^image\//);
  } finally { await server.close(); }
});

test("T73/T74 validates numeric filters and exposes task-only states without image content", async () => {
  const { server, baseUrl, outputRoot } = await fixture();
  try {
    const profile = (await json(baseUrl, "/profiles", { method: "POST", body: JSON.stringify({ name: "状态账号", accountLabel: null }) })).body;
    const taskRoot = join(outputRoot, "generating-task");
    await mkdir(taskRoot, { recursive: true });
    await writeFile(join(taskRoot, "task.json"), JSON.stringify({
      schemaVersion: "1",
      taskId: "generating-task",
      state: "generating",
      createdAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:01:00.000Z",
      request: { kind: "generate", prompt: "状态测试" },
      profileBinding: { profileId: profile.profileId, profileDir: profile.profileDir, boundAt: "2026-07-31T00:00:00.000Z" }
    }));
    await json(baseUrl, `/profiles/${profile.profileId}/images/scan`, { method: "POST" });

    for (const query of ["page=0", "pageSize=501", "minWidth=not-a-number", "minWidth=20&maxWidth=10", "from=bad-date"]) {
      const invalid = await json(baseUrl, `/profiles/${profile.profileId}/images?${query}`);
      assert.equal(invalid.response.status, 400, query);
      assert.equal(invalid.body.error.code, "INVALID_INPUT");
    }

    const listed = await json(baseUrl, `/profiles/${profile.profileId}/images?status=generating`);
    assert.equal(listed.body.total, 1);
    assert.equal(listed.body.items[0].status, "generating");
    const imageId = listed.body.items[0].imageId as string;
    const details = await json(baseUrl, `/profiles/${profile.profileId}/images/${imageId}`);
    assert.equal(details.response.status, 200);
    assert.equal(details.body.available, false);
    assert.equal((await fetch(`${baseUrl}/api/profiles/${profile.profileId}/images/${imageId}/content`)).status, 422);
  } finally { await server.close(); }
});

test("T51 rejects unknown and sensitive request fields without reflecting their values", async () => {
  const { server, baseUrl } = await fixture();
  try {
    const secret = "do-not-reflect-this-token";
    const result = await json(baseUrl, "/profiles", { method: "POST", body: JSON.stringify({ name: "x", token: secret }) });
    assert.equal(result.response.status, 400);
    assert.equal(JSON.stringify(result.body).includes(secret), false);
  } finally { await server.close(); }
});
