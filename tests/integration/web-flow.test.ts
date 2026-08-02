import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { inspectChrome } from "../../src/platform/chrome.js";
import { runWebImageFlow } from "../../src/chatgpt/web-flow.js";
import { createOutputLayout } from "../../src/images/output-layout.js";
import { startFixtureServer } from "../fixtures/chatgpt-page/server.js";
import { runCli } from "../../src/cli.js";
import { openProfileRuntime } from "../../src/profiles/runtime.js";
import { launchProfile } from "../../src/browser/profile.js";

const chrome = inspectChrome();
if (process.env.GWI_REQUIRE_CHROME === "1" && !chrome.available) throw new Error("GWI_REQUIRE_CHROME=1 but Google Chrome was not found");
test("T17 closes a dedicated Chrome before immediately reopening the same profile", { skip: !chrome.available }, async () => {
  const fixture = await startFixtureServer();
  const profileDir = await mkdtemp(join(tmpdir(), "gwi-reopen-profile-"));
  let first: Awaited<ReturnType<typeof launchProfile>> | undefined;
  let second: Awaited<ReturnType<typeof launchProfile>> | undefined;
  try {
    first = await launchProfile({ profileDir, executablePath: chrome.path as string, headed: false, url: fixture.url });
    await first.close();
    first = undefined;
    second = await launchProfile({ profileDir, executablePath: chrome.path as string, headed: true, url: fixture.url });
    assert.match(await second.page.title(), /Controlled ChatGPT Fixture/);
  } finally {
    await first?.close();
    await second?.close();
    await fixture.close();
  }
});
test("T37 controlled browser fixture proves queued -> progressive images -> complete", { skip: !chrome.available }, async () => {
  const fixture = await startFixtureServer();
  const browser = await chromium.launch({ executablePath: chrome.path as string, headless: true });
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    await page.goto(`${fixture.url}/?scenario=success&count=2&queueDelay=3000`);
    const layout = await createOutputLayout(await mkdtemp(join(tmpdir(), "gwi-flow-")), new Date("2026-07-30T00:00:00Z"), "fixture_task");
    const observed: string[] = [];
    const result = await runWebImageFlow({
      page,
      prompt: "生成两张图",
      targetCount: 2,
      outputLayout: layout,
      stabilityWindowMs: 20,
      pollIntervalMs: 20,
      timeoutMs: 8000,
      onSubmissionConfirmed: () => new Promise((resolve) => setTimeout(resolve, 75)),
      onState: (state) => observed.push(state)
    });
    assert.equal(result.results.length, 2);
    assert.notEqual(result.results[0]?.sha256, result.results[1]?.sha256);
    assert.ok(observed.includes("queued"));
    assert.ok(observed.includes("generating"));
    assert.ok(observed.includes("image_ready"));
    assert.equal(result.state, "succeeded");
  } finally { await browser.close(); await fixture.close(); }
});

test("T34 resumes an anchored assistant turn without submitting a second message", { skip: !chrome.available }, async () => {
  const fixture = await startFixtureServer();
  const browser = await chromium.launch({ executablePath: chrome.path as string, headless: true });
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    await page.goto(`${fixture.url}/?scenario=success&count=2&queueDelay=1000`);
    const root = await mkdtemp(join(tmpdir(), "gwi-resume-observer-"));
    const first = await runWebImageFlow({ page, prompt: "恢复观察", targetCount: 1, outputLayout: await createOutputLayout(root, new Date(), "resume_first"), stabilityWindowMs: 20, pollIntervalMs: 20, timeoutMs: 3000 });
    assert.equal(first.results.length, 1);
    const resumed = await runWebImageFlow({ page, prompt: "恢复观察", targetCount: 1, outputLayout: await createOutputLayout(root, new Date(), "resume_second"), submit: false, resumeAssistantOrdinal: 2, knownHashes: new Set(first.results.map((image) => image.sha256)), stabilityWindowMs: 20, pollIntervalMs: 20, timeoutMs: 10000 });
    assert.equal(resumed.results.length, 1);
    assert.notEqual(resumed.results[0]?.sha256, first.results[0]?.sha256);
  } finally { await browser.close(); await fixture.close(); }
});

test("T40 keeps the current ChatGPT turn anchor and ignores hidden image clones", { skip: !chrome.available }, async () => {
  const fixture = await startFixtureServer();
  const browser = await chromium.launch({ executablePath: chrome.path as string, headless: true });
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    await page.goto(`${fixture.url}/?scenario=success&count=1&dom=modern`);
    const layout = await createOutputLayout(await mkdtemp(join(tmpdir(), "gwi-modern-dom-")), new Date(), "fixture_modern_dom");
    const result = await runWebImageFlow({ page, prompt: "生成一张图", targetCount: 1, outputLayout: layout, stabilityWindowMs: 20, pollIntervalMs: 20, timeoutMs: 2000 });
    assert.equal(result.state, "succeeded");
    assert.equal(result.results.length, 1);
  } finally { await browser.close(); await fixture.close(); }
});

test("T37 controlled browser fixture classifies a rate limit failure", { skip: !chrome.available }, async () => {
  const fixture = await startFixtureServer();
  const browser = await chromium.launch({ executablePath: chrome.path as string, headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${fixture.url}/?scenario=failure`);
    const layout = await createOutputLayout(await mkdtemp(join(tmpdir(), "gwi-flow-")), new Date(), "fixture_failure");
    await assert.rejects(() => runWebImageFlow({ page, prompt: "失败场景", targetCount: 1, outputLayout: layout, stabilityWindowMs: 10, pollIntervalMs: 10, timeoutMs: 1000 }), /RATE_LIMITED/);
  } finally { await browser.close(); await fixture.close(); }
});

test("T21 waits for a delayed SPA composer instead of reporting a structure change", { skip: !chrome.available }, async () => {
  const fixture = await startFixtureServer();
  const browser = await chromium.launch({ executablePath: chrome.path as string, headless: true });
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    await page.goto(`${fixture.url}/?scenario=success&count=1&readyDelay=150`);
    const layout = await createOutputLayout(await mkdtemp(join(tmpdir(), "gwi-delayed-composer-")), new Date(), "fixture_delayed_composer");
    const result = await runWebImageFlow({ page, prompt: "等待输入区", targetCount: 1, outputLayout: layout, stabilityWindowMs: 10, pollIntervalMs: 10, timeoutMs: 2000 });
    assert.equal(result.state, "succeeded");
  } finally { await browser.close(); await fixture.close(); }
});

test("T21 retries a composer replaced during SPA hydration before submission", { skip: !chrome.available }, async () => {
  const fixture = await startFixtureServer();
  const browser = await chromium.launch({ executablePath: chrome.path as string, headless: true });
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    page.setDefaultTimeout(1000);
    await page.goto(`${fixture.url}/?scenario=success&count=1&composerSwap=1`);
    const layout = await createOutputLayout(await mkdtemp(join(tmpdir(), "gwi-composer-swap-")), new Date(), "fixture_composer_swap");
    const result = await runWebImageFlow({ page, prompt: "等待输入框替换", targetCount: 1, outputLayout: layout, stabilityWindowMs: 10, pollIntervalMs: 20, timeoutMs: 3000 });
    assert.equal(result.state, "succeeded");
  } finally { await browser.close(); await fixture.close(); }
});

test("T18 ignores a transient login control while the saved session hydrates", { skip: !chrome.available }, async () => {
  const fixture = await startFixtureServer();
  const browser = await chromium.launch({ executablePath: chrome.path as string, headless: true });
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    await page.goto(`${fixture.url}/?scenario=success&count=1&loginFlash=150`);
    const layout = await createOutputLayout(await mkdtemp(join(tmpdir(), "gwi-login-flash-")), new Date(), "fixture_login_flash");
    const result = await runWebImageFlow({ page, prompt: "等待会话恢复", targetCount: 1, outputLayout: layout, stabilityWindowMs: 10, pollIntervalMs: 10, timeoutMs: 2500 });
    assert.equal(result.state, "succeeded");
  } finally { await browser.close(); await fixture.close(); }
});

test("T37 controlled browser fixture delivers the supported maximum of ten images", { skip: !chrome.available }, async () => {
  const fixture = await startFixtureServer();
  const browser = await chromium.launch({ executablePath: chrome.path as string, headless: true });
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    await page.goto(`${fixture.url}/?scenario=success&count=10`);
    const layout = await createOutputLayout(await mkdtemp(join(tmpdir(), "gwi-ten-")), new Date(), "fixture_ten");
    const result = await runWebImageFlow({ page, prompt: "生成十张图", targetCount: 10, outputLayout: layout, stabilityWindowMs: 10, pollIntervalMs: 10, timeoutMs: 5000 });
    assert.equal(result.results.length, 10);
    assert.equal(new Set(result.results.map((image) => image.sha256)).size, 10);
  } finally { await browser.close(); await fixture.close(); }
});

test("T37 controlled browser fixture returns partial success and times out without false success", { skip: !chrome.available }, async () => {
  const fixture = await startFixtureServer();
  const browser = await chromium.launch({ executablePath: chrome.path as string, headless: true });
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    const root = await mkdtemp(join(tmpdir(), "gwi-partial-"));
    await page.goto(`${fixture.url}/?scenario=partial&count=2`);
    const partial = await runWebImageFlow({ page, prompt: "目标四张", targetCount: 4, outputLayout: await createOutputLayout(root, new Date(), "fixture_partial"), stabilityWindowMs: 10, pollIntervalMs: 10, timeoutMs: 2000 });
    assert.equal(partial.state, "partial_success");
    assert.equal(partial.results.length, 2);
    await page.goto(`${fixture.url}/?scenario=timeout`);
    let cancellationChecks = 0;
    const cancelLayout = await createOutputLayout(root, new Date(), "fixture_cancel");
    await assert.rejects(() => runWebImageFlow({ page, prompt: "取消", targetCount: 1, outputLayout: cancelLayout, stabilityWindowMs: 10, pollIntervalMs: 10, timeoutMs: 1000, isCancelled: () => ++cancellationChecks > 2 }), /TASK_CANCELLED/);
    await page.goto(`${fixture.url}/?scenario=timeout`);
    const timeoutLayout = await createOutputLayout(root, new Date(), "fixture_timeout");
    await assert.rejects(() => runWebImageFlow({ page, prompt: "超时", targetCount: 1, outputLayout: timeoutLayout, stabilityWindowMs: 10, pollIntervalMs: 10, timeoutMs: 200 }), /TASK_TIMED_OUT/);
  } finally { await browser.close(); await fixture.close(); }
});

test("T14 stops between image deliveries when cancellation is requested", { skip: !chrome.available }, async () => {
  const fixture = await startFixtureServer();
  const browser = await chromium.launch({ executablePath: chrome.path as string, headless: true });
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    await page.goto(`${fixture.url}/?scenario=success&count=2`);
    let delivered = 0;
    const layout = await createOutputLayout(await mkdtemp(join(tmpdir(), "gwi-cancel-between-images-")), new Date(), "fixture_cancel_between_images");
    await assert.rejects(() => runWebImageFlow({
      page, prompt: "取消中的两张图", targetCount: 2,
      outputLayout: layout,
      stabilityWindowMs: 10, pollIntervalMs: 10, timeoutMs: 2000,
      onImage: () => { delivered += 1; },
      isCancelled: () => delivered > 0
    }), /TASK_CANCELLED/);
    assert.equal(delivered, 1);
  } finally { await browser.close(); await fixture.close(); }
});

test("T35/T37 CLI streams validated local images before terminal completion", { skip: !chrome.available }, async () => {
  const fixture = await startFixtureServer();
  const root = await mkdtemp(join(tmpdir(), "gwi-cli-flow-"));
  const configPath = join(root, "config.json");
  const profileDir = join(root, "profile");
  await writeFile(configPath, JSON.stringify({ chromeExecutablePath: chrome.path, profileDir, fallbackOutputDir: join(root, "output"), stabilityWindowMs: 20, hardTimeoutMs: 5000 }));
  const runtime = await openProfileRuntime(profileDir);
  const profile = (await runtime.manager.list()).profiles.find((entry) => entry.profileDir === profileDir);
  assert.ok(profile);
  await runtime.manager.activate(profile.profileId, async () => ({ login: "logged_in", membership: "plus", evidenceKinds: ["fixture"], checkedAt: new Date().toISOString(), eligible: true }));
  const stdout: string[] = []; const stderr: string[] = [];
  try {
    const code = await runCli(["generate", "--prompt", "生成两张图", "--count", "2", "--url", `${fixture.url}/?scenario=success&count=2`, "--config", configPath], { stdout: (line) => stdout.push(line), stderr: (line) => stderr.push(line) });
    assert.equal(code, 0, [...stderr, ...stdout].join("\n"));
    const events = stdout.map((line) => JSON.parse(line) as { type: string; image?: { originalPath: string } });
    const ready = events.filter((event) => event.type === "image_ready");
    assert.equal(ready.length, 2);
    assert.ok(events.findIndex((event) => event.type === "image_ready") < events.findIndex((event) => event.type === "terminal"));
    await Promise.all(ready.map((event) => access(event.image?.originalPath as string)));
  } finally { await fixture.close(); }
});
