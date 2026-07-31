import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ProfileRegistryStore } from "../../src/profiles/registry.js";
import { ProfileManager, ProfileManagerError } from "../../src/profiles/manager.js";
import { createBackup, restoreBackup } from "../../src/profiles/backup.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "gpt-web-image-profiles-"));
  const store = new ProfileRegistryStore(join(root, "profile-registry.json"), join(root, "profiles"));
  const manager = new ProfileManager(store);
  return { root, store, manager };
}

test("T43/T45 creates an owned profile and persists a single active id atomically", async () => {
  const { store, manager } = await fixture();
  const first = await manager.create({ name: "主账号", accountLabel: "Plus" });
  const second = await manager.create({ name: "备用账号", accountLabel: null });
  await manager.activate(first.profileId, async () => ({ login: "logged_in", membership: "plus", evidenceKinds: ["fixture"], checkedAt: new Date().toISOString(), eligible: true }));
  await manager.activate(second.profileId, async () => ({ login: "logged_in", membership: "pro", evidenceKinds: ["fixture"], checkedAt: new Date().toISOString(), eligible: true }));
  const registry = await store.read();
  assert.equal(registry.activeProfileId, second.profileId);
  assert.equal(registry.profiles.filter((profile) => profile.active).length, 1);
  assert.equal(JSON.parse(await readFile(store.registryPath, "utf8")).profiles.length, 2);
});

test("T45 rejects a foreign import and accepts an owned dedicated profile", async () => {
  const { root, manager } = await fixture();
  const foreign = join(root, "foreign");
  await mkdir(foreign, { recursive: true });
  await writeFile(join(foreign, "Cookies"), "not read");
  await assert.rejects(() => manager.importProfile({ name: "日常", profileDir: foreign, accountLabel: null }), /NOT_OWNED/);

  const owned = await manager.create({ name: "已有专用", accountLabel: null });
  const registry = await manager.list();
  assert.equal(registry.profiles.some((profile) => profile.profileId === owned.profileId), true);
});

test("T47 refuses activation when login or membership is ineligible", async () => {
  const { manager } = await fixture();
  const profile = await manager.create({ name: "未登录", accountLabel: null });
  await assert.rejects(
    () => manager.activate(profile.profileId, async () => ({ login: "needs_login", membership: "technical_failure", evidenceKinds: [], checkedAt: new Date().toISOString(), eligible: false })),
    (error: unknown) => error instanceof ProfileManagerError && error.code === "LOGIN_REQUIRED"
  );
});

test("T53 deletion requires a page confirmation and protects active profiles", async () => {
  const { manager } = await fixture();
  const profile = await manager.create({ name: "待删除", accountLabel: null });
  await assert.rejects(() => manager.deleteProfile(profile.profileId, null), /DELETE_CONFIRMATION_REQUIRED/);
  const confirmation = manager.issueDeleteConfirmation(profile.profileId, "page");
  await manager.activate(profile.profileId, async () => ({ login: "logged_in", membership: "go", evidenceKinds: ["fixture"], checkedAt: new Date().toISOString(), eligible: true }));
  await assert.rejects(() => manager.deleteProfile(profile.profileId, confirmation), /ACTIVE_PROFILE/);
});

test("T54/T55 backup copies complete profile data and restore creates a new inactive profile", async () => {
  const { root, manager } = await fixture();
  const profile = await manager.create({ name: "备份源", accountLabel: null });
  await writeFile(join(profile.profileDir, "Local State"), "browser-data");
  const backup = await createBackup(profile, join(root, "backups"));
  assert.equal(backup.encrypted, false);
  assert.equal(backup.includesChromeAuthData, true);
  const restored = await restoreBackup(backup, manager, "恢复副本");
  assert.notEqual(restored.profileId, profile.profileId);
  assert.equal(restored.active, false);
  assert.equal(await readFile(join(restored.profileDir, "Local State"), "utf8"), "browser-data");
});

test("T43 registry rejects sensitive fields and invalid multiple active records", async () => {
  const { store } = await fixture();
  await writeFile(store.registryPath, JSON.stringify({ schemaVersion: "1", defaultRootDir: resolve("profiles"), retainedRoots: [], activeProfileId: null, profiles: [], updatedAt: new Date().toISOString(), token: "secret" }));
  await assert.rejects(() => store.read(), /敏感字段/);
});

test("T47 persists eligibility and browser status without exposing authentication data", async () => {
  const { manager } = await fixture();
  const profile = await manager.create({ name: "待检测", accountLabel: null });
  await manager.recordEligibility(profile.profileId, { login: "logged_in", membership: "plus", evidenceKinds: ["visible_plan_text"], checkedAt: "2026-07-31T00:00:00.000Z", eligible: true });
  await manager.setBrowserStatus(profile.profileId, "open");
  const updated = (await manager.list()).profiles[0];
  assert.equal(updated?.loginStatus, "logged_in");
  assert.equal(updated?.membership, "plus");
  assert.equal(updated?.browserStatus, "open");
  assert.equal(updated?.lastOpenedAt !== null, true);
  assert.equal(JSON.stringify(updated).includes("evidenceKinds"), false);
});

test("T53 automatic code paths cannot issue delete confirmations", async () => {
  const { manager } = await fixture();
  const profile = await manager.create({ name: "保留账号", accountLabel: null });
  assert.throws(() => manager.issueDeleteConfirmation(profile.profileId, "automation"), /DELETE_CONFIRMATION_FORBIDDEN/);
});
