import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
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
import { referenceExpectations, waitForUploadedAttachments } from "../../src/chatgpt/attachments.js";

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

test("T17 refuses to return a restored tab when the requested target cannot be reached", { skip: !chrome.available }, async () => {
  const profileDir = await mkdtemp(join(tmpdir(), "gwi-unreachable-target-"));
  await assert.rejects(
    () => launchProfile({ profileDir, executablePath: chrome.path as string, headed: true, url: "http://127.0.0.1:9/unreachable-target" }),
    /PAGE_NAVIGATION_UNCERTAIN/
  );
});

test("T17 minimizes only the dedicated Chrome window for background sessions", { skip: !chrome.available }, async () => {
  const fixture = await startFixtureServer();
  const profileDir = await mkdtemp(join(tmpdir(), "gwi-minimized-window-"));
  let session: Awaited<ReturnType<typeof launchProfile>> | undefined;
  try {
    session = await launchProfile({ profileDir, executablePath: chrome.path as string, headed: false, url: fixture.url });
    if (process.platform === "darwin") {
      const script = [
        'tell application "Google Chrome"',
        "set states to {}",
        "repeat with w in windows",
        "repeat with t in tabs of w",
        'if (title of t) is "Controlled ChatGPT Fixture" then set end of states to (visible of w)',
        "end repeat",
        "end repeat",
        "return states as text",
        "end tell"
      ].join("\n");
      assert.equal(execFileSync("osascript", ["-e", script], { encoding: "utf8" }).trim(), "false");
    } else {
      const client = await session.context.newCDPSession(session.page);
      try {
        const { windowId } = await client.send("Browser.getWindowForTarget") as { windowId: number };
        const { bounds } = await client.send("Browser.getWindowBounds", { windowId }) as { bounds: { windowState: string } };
        assert.equal(bounds.windowState, "minimized");
      } finally {
        await client.detach().catch(() => undefined);
      }
    }
  } finally {
    await session?.close();
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
    let resolveSubmission!: () => void;
    const submissionConfirmed = new Promise<void>((resolve) => { resolveSubmission = resolve; });
    const flowPromise = runWebImageFlow({
      page,
      prompt: "生成两张图",
      targetCount: 2,
      outputLayout: layout,
      stabilityWindowMs: 20,
      pollIntervalMs: 20,
      timeoutMs: 8000,
      onSubmissionConfirmed: () => {
        resolveSubmission();
        return new Promise((resolve) => setTimeout(resolve, 75));
      },
      onState: (state) => observed.push(state)
    });
    await Promise.race([
      submissionConfirmed,
      flowPromise.then(() => { throw new Error("流程在提交确认回调前意外结束"); })
    ]);
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(await page.locator('article[data-message-author-role="assistant"]').last().locator("img").count(), 0);
    const result = await flowPromise;
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

test("T23 waits for a lazy media card to load and expose its original download", { skip: !chrome.available }, async () => {
  const fixture = await startFixtureServer();
  const browser = await chromium.launch({ executablePath: chrome.path as string, headless: true });
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    await page.goto(`${fixture.url}/?scenario=success&count=1&mediaLoadDelay=250`);
    const layout = await createOutputLayout(await mkdtemp(join(tmpdir(), "gwi-lazy-media-")), new Date(), "lazy_media");
    const result = await runWebImageFlow({ page, prompt: "等待懒加载原图", targetCount: 1, outputLayout: layout, stabilityWindowMs: 20, pollIntervalMs: 10, timeoutMs: 2000 });
    assert.equal(result.state, "succeeded");
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0]?.provenance?.mediaCardId, "result-1");
  } finally { await browser.close(); await fixture.close(); }
});

test("T23 binds a generated image to its delayed matching viewer save download event", { skip: !chrome.available }, async () => {
  const fixture = await startFixtureServer();
  const browser = await chromium.launch({ executablePath: chrome.path as string, headless: true });
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    await page.goto(`${fixture.url}/?scenario=success&count=1&viewerDownload=1&viewerOpenDelay=50&viewerControlsDelay=500&viewerThumbnails=1&cardThumbnails=1`);
    const layout = await createOutputLayout(await mkdtemp(join(tmpdir(), "gwi-viewer-download-")), new Date(), "viewer_download");
    const result = await runWebImageFlow({ page, prompt: "查看器下载原图", targetCount: 1, outputLayout: layout, stabilityWindowMs: 20, pollIntervalMs: 10, timeoutMs: 2000 });
    assert.equal(result.state, "succeeded");
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0]?.provenance?.downloadMethod, "download_event");
    assert.equal(result.results[0]?.provenance?.mediaCardId, "image-fixture-1");
  } finally { await browser.close(); await fixture.close(); }
});

test("T23 waits for a slowly hydrated unique viewer save button", { skip: !chrome.available }, async () => {
  const fixture = await startFixtureServer();
  const browser = await chromium.launch({ executablePath: chrome.path as string, headless: true });
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    await page.goto(`${fixture.url}/?scenario=success&count=1&viewerDownload=1&viewerControlsDelay=6500`);
    const result = await runWebImageFlow({ page, prompt: "等待真实查看器控件", targetCount: 1, outputLayout: await createOutputLayout(await mkdtemp(join(tmpdir(), "gwi-slow-viewer-save-")), new Date(), "slow_viewer_save"), stabilityWindowMs: 20, pollIntervalMs: 10, timeoutMs: 12000 });
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0]?.provenance?.downloadMethod, "download_event");
  } finally { await browser.close(); await fixture.close(); }
});

test("T34 persists a stable conversation link that appears after submission confirmation", { skip: !chrome.available }, async () => {
  const fixture = await startFixtureServer();
  const browser = await chromium.launch({ executablePath: chrome.path as string, headless: true });
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    await page.goto(`${fixture.url}/?scenario=success&count=1&stableLinkDelay=3500&historicalLink=1&queueDelay=2500&imageGap=500`);
    const observedUrls: Array<string | null> = [];
    const result = await runWebImageFlow({
      page,
      prompt: "延迟稳定会话",
      targetCount: 1,
      outputLayout: await createOutputLayout(await mkdtemp(join(tmpdir(), "gwi-stable-route-")), new Date(), "stable_route"),
      stabilityWindowMs: 20,
      pollIntervalMs: 20,
      timeoutMs: 6000,
      onResponseAnchor: (_anchor, chatUrl) => { observedUrls.push(chatUrl); }
    });
    const stableUrl = "https://chatgpt.com/c/6a6e1566-0318-83ec-ac91-2c6536149b19";
    assert.ok(observedUrls.includes(stableUrl));
    assert.equal(result.chatUrl, stableUrl);
  } finally { await browser.close(); await fixture.close(); }
});

test("T20 chooses the next available model and refuses an explicit daily limit", { skip: !chrome.available }, async () => {
  const fixture = await startFixtureServer();
  const browser = await chromium.launch({ executablePath: chrome.path as string, headless: true });
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    await page.goto(`${fixture.url}/?scenario=success&count=1&models=gpt-5.6-sol-high`);
    const fallback = await runWebImageFlow({ page, prompt: "模型回退", targetCount: 1, outputLayout: await createOutputLayout(await mkdtemp(join(tmpdir(), "gwi-model-fallback-")), new Date(), "model_fallback"), stabilityWindowMs: 10, pollIntervalMs: 10, timeoutMs: 3000 });
    assert.equal(fallback.modelSelection?.modelKey, "gpt-5.6-sol-medium");
    await page.goto(`${fixture.url}/?scenario=success&count=1&models=all`);
    const limitLayout = await createOutputLayout(await mkdtemp(join(tmpdir(), "gwi-model-limit-")), new Date(), "model_limit");
    await assert.rejects(() => runWebImageFlow({ page, prompt: "限额", targetCount: 1, outputLayout: limitLayout, stabilityWindowMs: 10, pollIntervalMs: 10, timeoutMs: 1000 }), /单日生图已达限额，暂时不可生图。/);
  } finally { await browser.close(); await fixture.close(); }
});

test("T20 selects the real ChatGPT capability picker when its trigger only says high", { skip: !chrome.available }, async () => {
  const fixture = await startFixtureServer();
  const browser = await chromium.launch({ executablePath: chrome.path as string, headless: true });
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    await page.goto(`${fixture.url}/?scenario=success&count=1&modelUi=capability`);
    const result = await runWebImageFlow({ page, prompt: "真实模型菜单", targetCount: 1, outputLayout: await createOutputLayout(await mkdtemp(join(tmpdir(), "gwi-capability-model-")), new Date(), "capability_model"), stabilityWindowMs: 10, pollIntervalMs: 10, timeoutMs: 3000 });
    assert.equal(result.modelSelection?.modelKey, "gpt-5.6-sol-high");
    assert.match(result.modelSelection?.label ?? "", /GPT-5\.6 Sol.*高/);
  } finally { await browser.close(); await fixture.close(); }
});

test("T20 accepts the current Chinese reasoning label in the capability picker", { skip: !chrome.available }, async () => {
  const fixture = await startFixtureServer();
  const browser = await chromium.launch({ executablePath: chrome.path as string, headless: true });
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    await page.goto(`${fixture.url}/?scenario=success&count=1&modelUi=localized-capability`);
    const result = await runWebImageFlow({ page, prompt: "推理强度模型菜单", targetCount: 1, outputLayout: await createOutputLayout(await mkdtemp(join(tmpdir(), "gwi-localized-capability-")), new Date(), "localized_capability"), stabilityWindowMs: 10, pollIntervalMs: 10, timeoutMs: 3000 });
    assert.equal(result.modelSelection?.modelKey, "gpt-5.6-sol-high");
  } finally { await browser.close(); await fixture.close(); }
});

test("T20 opens a nested model capability submenu without relying on pointer clicks", { skip: !chrome.available }, async () => {
  const fixture = await startFixtureServer();
  const browser = await chromium.launch({ executablePath: chrome.path as string, headless: true });
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    await page.goto(`${fixture.url}/?scenario=success&count=1&modelUi=nested-capability`);
    const result = await runWebImageFlow({ page, prompt: "嵌套模型菜单", targetCount: 1, outputLayout: await createOutputLayout(await mkdtemp(join(tmpdir(), "gwi-nested-model-")), new Date(), "nested_model"), stabilityWindowMs: 10, pollIntervalMs: 10, timeoutMs: 3000 });
    assert.equal(result.modelSelection?.modelKey, "gpt-5.6-sol-high");
    assert.match(result.modelSelection?.label ?? "", /GPT-5\.6 Sol.*高/);
  } finally { await browser.close(); await fixture.close(); }
});

test("T20 waits for the model trigger to hydrate after the composer", { skip: !chrome.available }, async () => {
  const fixture = await startFixtureServer();
  const browser = await chromium.launch({ executablePath: chrome.path as string, headless: true });
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    await page.goto(`${fixture.url}/?scenario=success&count=1&modelUi=capability&modelDelay=1800`);
    const result = await runWebImageFlow({ page, prompt: "延迟模型菜单", targetCount: 1, outputLayout: await createOutputLayout(await mkdtemp(join(tmpdir(), "gwi-delayed-model-")), new Date(), "delayed_model"), stabilityWindowMs: 10, pollIntervalMs: 20, timeoutMs: 3000 });
    assert.equal(result.modelSelection?.modelKey, "gpt-5.6-sol-high");
  } finally { await browser.close(); await fixture.close(); }
});

test("T03 verifies local image attachments before edit submission", { skip: !chrome.available }, async () => {
  const fixture = await startFixtureServer();
  const browser = await chromium.launch({ executablePath: chrome.path as string, headless: true });
  const root = await mkdtemp(join(tmpdir(), "gwi-attachment-"));
  const reference = join(root, "reference.jpg");
  await writeFile(reference, Buffer.from("test-reference"));
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    await page.goto(`${fixture.url}/?scenario=success&count=1&attachmentUi=real`);
    const result = await runWebImageFlow({ page, prompt: "图生图附件", targetCount: 1, referencePaths: [reference], outputLayout: await createOutputLayout(root, new Date(), "edit_ok"), stabilityWindowMs: 10, pollIntervalMs: 10, timeoutMs: 3000 });
    assert.equal(result.results.length, 1);
    await page.goto(`${fixture.url}/?scenario=success&count=1&attachmentMissing=1`);
    const missingLayout = await createOutputLayout(root, new Date(), "edit_missing");
    await assert.rejects(() => runWebImageFlow({ page, prompt: "缺失附件", targetCount: 1, referencePaths: [reference], outputLayout: missingLayout, stabilityWindowMs: 10, pollIntervalMs: 10, timeoutMs: 1000 }), /ATTACHMENT_UPLOAD_UNCONFIRMED/);
    await page.goto(`${fixture.url}/?scenario=success&count=1&attachmentMissing=1&historicalAttachment=1&duplicateComposer=1`);
    const attachmentExpectations = await referenceExpectations([reference]);
    await assert.rejects(() => waitForUploadedAttachments(page, attachmentExpectations, 200, 10), /ATTACHMENT_UPLOAD_UNCONFIRMED/);
    await page.goto(`${fixture.url}/?scenario=success&count=1&attachmentMismatch=1`);
    const wrongLayout = await createOutputLayout(root, new Date(), "edit_wrong");
    await assert.rejects(() => runWebImageFlow({ page, prompt: "错附件", targetCount: 1, referencePaths: [reference], outputLayout: wrongLayout, stabilityWindowMs: 10, pollIntervalMs: 10, timeoutMs: 1000 }), /ATTACHMENT_IDENTITY_MISMATCH/);
  } finally { await browser.close(); await fixture.close(); }
});

test("T03 prefers the current dedicated photo input over an earlier generic file input", { skip: !chrome.available }, async () => {
  const fixture = await startFixtureServer();
  const browser = await chromium.launch({ executablePath: chrome.path as string, headless: true });
  const root = await mkdtemp(join(tmpdir(), "gwi-current-photo-input-"));
  const reference = join(root, "reference.jpg");
  await writeFile(reference, Buffer.from("current-photo-input"));
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    await page.goto(`${fixture.url}/?scenario=success&count=1&attachmentUi=current`);
    const result = await runWebImageFlow({ page, prompt: "当前照片入口", targetCount: 1, referencePaths: [reference], outputLayout: await createOutputLayout(root, new Date(), "current_photo_input"), stabilityWindowMs: 10, pollIntervalMs: 10, timeoutMs: 3000 });
    assert.equal(result.results.length, 1);
  } finally { await browser.close(); await fixture.close(); }
});

test("T03 CLI preserves confirmed reference attachment evidence after submission preparation", { skip: !chrome.available }, async () => {
  const fixture = await startFixtureServer();
  const root = await mkdtemp(join(tmpdir(), "gwi-cli-attachment-evidence-"));
  const configPath = join(root, "config.json");
  const profileDir = join(root, "profile");
  const outputDir = join(root, "output");
  const reference = join(root, "reference.jpg");
  await writeFile(reference, Buffer.from("reference-evidence"));
  await writeFile(configPath, JSON.stringify({ chromeExecutablePath: chrome.path, profileDir, fallbackOutputDir: outputDir, stabilityWindowMs: 20, hardTimeoutMs: 5000 }));
  const runtime = await openProfileRuntime(profileDir);
  const profile = (await runtime.manager.list()).profiles.find((entry) => entry.profileDir === profileDir);
  assert.ok(profile);
  await runtime.manager.activate(profile.profileId, async () => ({ login: "logged_in", membership: "plus", evidenceKinds: ["fixture"], checkedAt: new Date().toISOString(), eligible: true }));
  const stdout: string[] = [];
  const stderr: string[] = [];
  try {
    const code = await runCli(["edit", "--reference", reference, "--prompt", "保留附件证据", "--count", "1", "--url", `${fixture.url}/?scenario=success&count=1&attachmentUi=real`, "--config", configPath], { stdout: (line) => stdout.push(line), stderr: (line) => stderr.push(line) });
    assert.equal(code, 0, [...stderr, ...stdout].join("\n"));
    const taskId = (JSON.parse(stdout[0] as string) as { taskId: string }).taskId;
    const taskFile = (await readdir(outputDir, { recursive: true })).find((entry) => entry.endsWith(join(taskId, "task.json")));
    assert.ok(taskFile);
    const task = JSON.parse(await readFile(join(outputDir, taskFile), "utf8")) as { submission: { confirmationEvidence: string[] } };
    assert.ok(task.submission.confirmationEvidence.includes("reference_attachment_visible"));
    assert.ok(task.submission.confirmationEvidence.includes("reference:reference.jpg"));
  } finally { await fixture.close(); }
});

test("T23 refuses a visible card whose download resource is not its own", { skip: !chrome.available }, async () => {
  const fixture = await startFixtureServer();
  const browser = await chromium.launch({ executablePath: chrome.path as string, headless: true });
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    await page.goto(`${fixture.url}/?scenario=success&count=1&wrongDownload=1`);
    const layout = await createOutputLayout(await mkdtemp(join(tmpdir(), "gwi-wrong-download-")), new Date(), "wrong_download");
    await assert.rejects(() => runWebImageFlow({ page, prompt: "错误下载资源", targetCount: 1, outputLayout: layout, stabilityWindowMs: 10, pollIntervalMs: 10, timeoutMs: 1500 }), /MEDIA_BINDING_UNCERTAIN|生成结束但没有合格图片/);
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

test("T22 uses one keyboard dispatch when a verified send-button click has no effect", { skip: !chrome.available }, async () => {
  const fixture = await startFixtureServer();
  const browser = await chromium.launch({ executablePath: chrome.path as string, headless: true });
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    await page.goto(`${fixture.url}/?scenario=success&count=1&submitUi=click-ignored`);
    const result = await runWebImageFlow({ page, prompt: "发送点击无效", targetCount: 1, outputLayout: await createOutputLayout(await mkdtemp(join(tmpdir(), "gwi-submit-fallback-")), new Date(), "submit_fallback"), stabilityWindowMs: 10, pollIntervalMs: 10, timeoutMs: 3000 });
    assert.equal(result.results.length, 1);
    assert.equal(await page.locator('[data-message-author-role="user"]').count(), 1);
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
    const result = await runWebImageFlow({ page, prompt: "生成十张图", targetCount: 10, outputLayout: layout, stabilityWindowMs: 10, pollIntervalMs: 10, timeoutMs: 10000 });
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
    await page.goto(`${fixture.url}/?scenario=success&count=2&imageGap=500`);
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
