import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureOwnedProfile, profileMarkerPath } from "../../src/browser/profile.js";
import { LoginReadinessTracker, classifyLoginPage } from "../../src/browser/login.js";
import { createHandoffPlan } from "../../src/browser/handoff.js";

test("T17 creates an ownership marker and rejects a foreign non-empty profile", async () => {
  const owned = await mkdtemp(join(tmpdir(), "gwi-profile-"));
  await ensureOwnedProfile(owned);
  await ensureOwnedProfile(owned);
  const marker = JSON.parse(await (await import("node:fs/promises")).readFile(profileMarkerPath(owned), "utf8")) as { owner: string };
  assert.equal(marker.owner, "gpt-web-image");

  const foreign = await mkdtemp(join(tmpdir(), "gwi-foreign-"));
  await writeFile(join(foreign, "Preferences"), "{}");
  await assert.rejects(() => ensureOwnedProfile(foreign), /非本项目/);
});

test("T18 requires a stable interactive composer, not a URL redirect", () => {
  assert.equal(classifyLoginPage({ url: "https://chatgpt.com/", hasInteractiveComposer: false, hasLoginControl: false, hasVerification: false }), "unknown");
  assert.equal(classifyLoginPage({ url: "https://chatgpt.com/auth/login", hasInteractiveComposer: false, hasLoginControl: true, hasVerification: false }), "needs_login");
  assert.equal(classifyLoginPage({ url: "https://chatgpt.com/", hasInteractiveComposer: false, hasLoginControl: false, hasVerification: true }), "needs_human_verification");
  assert.equal(classifyLoginPage({ url: "https://chatgpt.com/", hasInteractiveComposer: true, hasLoginControl: true, hasVerification: false }), "needs_login");
  const tracker = new LoginReadinessTracker(1000);
  assert.equal(tracker.observe({ url: "https://chatgpt.com/", hasInteractiveComposer: true, hasLoginControl: false, hasVerification: false }, 0), "stabilizing");
  assert.equal(tracker.observe({ url: "https://chatgpt.com/", hasInteractiveComposer: true, hasLoginControl: false, hasVerification: false }, 1000), "ready");
});

test("T19 handoff preserves task, attempt and URL while switching to headed", () => {
  const plan = createHandoffPlan({ taskId: "t1", attemptId: "a1", chatUrl: "https://chatgpt.com/c/1", state: "needs_human_verification" });
  assert.deepEqual(plan, { taskId: "t1", attemptId: "a1", chatUrl: "https://chatgpt.com/c/1", fromMode: "headless", toMode: "headed", resumeWithoutSubmit: true });
});
