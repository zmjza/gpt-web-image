import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyMembershipSignals, evaluateEligibility } from "../../src/browser/membership.js";
import { BrowserLease, BrowserLeaseError } from "../../src/browser/browser-lease.js";

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
