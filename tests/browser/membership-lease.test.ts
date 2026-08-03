import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { inspectChrome } from "../../src/platform/chrome.js";
import { classifyMembershipSignals, evaluateEligibility, readMembershipSignals } from "../../src/browser/membership.js";
import { BrowserLease, BrowserLeaseError } from "../../src/browser/browser-lease.js";

const chrome = inspectChrome();

test("T48 classifies Plus, Pro and Go from public account-plan signals", () => {
  assert.equal(classifyMembershipSignals({ login: "logged_in", visibleTexts: ["ChatGPT Plus"], imageGenerationAvailable: true }), "plus");
  assert.equal(classifyMembershipSignals({ login: "logged_in", visibleTexts: ["Current plan: Pro"], imageGenerationAvailable: true }), "pro");
  assert.equal(classifyMembershipSignals({ login: "logged_in", visibleTexts: ["GPT Go 方案"], imageGenerationAvailable: true }), "go");
});

test("T48 separates login, ineligible plan and technical failure", () => {
  assert.equal(evaluateEligibility({ login: "needs_login", visibleTexts: [], imageGenerationAvailable: false }).reason, "LOGIN_REQUIRED");
  assert.equal(evaluateEligibility({ login: "logged_in", visibleTexts: ["Free plan"], imageGenerationAvailable: false }).reason, "MEMBERSHIP_INELIGIBLE");
  assert.equal(evaluateEligibility({ login: "logged_in", visibleTexts: [], imageGenerationAvailable: null }).reason, "ELIGIBILITY_CHECK_FAILED");
});

test("T48 accepts an eligible plan when the home page has no explicit image control", () => {
  const result = evaluateEligibility({ login: "logged_in", visibleTexts: ["魏邦 Plus"], imageGenerationAvailable: false });
  assert.equal(result.membership, "plus");
  assert.equal(result.eligible, true);
  assert.equal(result.reason, "ELIGIBLE");
});

test("T48 recognizes a plan suffix attached to the localized profile name", () => {
  assert.equal(classifyMembershipSignals({ login: "logged_in", visibleTexts: ["bang weiPlus"], imageGenerationAvailable: null }), "plus");
});

test("T48 reads the localized profile menu trigger as public membership evidence", { skip: !chrome.available }, async () => {
  const browser = await chromium.launch({ executablePath: chrome.path as string, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div role="button" aria-label="bang wei Plus，打开个人资料菜单" style="display:block">bang wei Plus</div><div contenteditable="true" aria-label="与 ChatGPT 聊天" style="display:block"></div>');
    const signals = await readMembershipSignals(page);
    assert.equal(signals.login, "logged_in");
    assert.ok(signals.visibleTexts.some((text) => /plus/i.test(text)));
    assert.equal(signals.imageGenerationAvailable, null);
  } finally {
    await browser.close();
  }
});

test("T49 allows only one global dedicated browser lease across profiles", async () => {
  const root = await mkdtemp(join(tmpdir(), "gpt-web-image-browser-lease-"));
  const first = new BrowserLease(root, { profileId: "p1", profileDir: join(root, "p1"), ownerType: "manual" });
  const second = new BrowserLease(root, { profileId: "p2", profileDir: join(root, "p2"), ownerType: "task" });
  await first.acquire();
  await assert.rejects(() => second.acquire(), (error: unknown) => error instanceof BrowserLeaseError && error.code === "BROWSER_LEASED");
  assert.equal((await first.status())?.profileId, "p1");
  await first.release();
  await second.acquire();
  await second.release();
});
