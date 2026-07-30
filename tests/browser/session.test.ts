import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildHeadedChromeArgs, ensureOwnedProfile, profileMarkerPath } from "../../src/browser/profile.js";
import { LoginReadinessTracker, classifyLoginPage, isVerificationChallenge } from "../../src/browser/login.js";
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

test("T17 keeps the Chromium sandbox enabled for account flows", async () => {
  assert.match(await readFile("src/browser/profile.ts", "utf8"), /chromiumSandbox:\s*true/);
});

test("T17 launches headed account flows as ordinary Chrome with an isolated profile", () => {
  const profileDir = resolve("dedicated profile");
  const args = buildHeadedChromeArgs(profileDir, "https://chatgpt.com/", 43123);
  assert.deepEqual(args, [
    `--user-data-dir=${profileDir}`,
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=43123",
    "--no-first-run",
    "--no-default-browser-check",
    "https://chatgpt.com/"
  ]);
  assert.equal(args.some((argument) => /--no-sandbox|--enable-automation|--disable-(?:features|extensions|sync)/.test(argument)), false);
  assert.equal(args.includes("--remote-debugging-port=0"), false);
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

test("T18 recognizes real verification pages without matching unrelated chat text", () => {
  assert.equal(isVerificationChallenge({ url: "https://auth.openai.com/", bodyText: "正在进行安全验证", hasChallengeFrame: true }), true);
  assert.equal(isVerificationChallenge({ url: "https://chatgpt.com/", bodyText: "历史聊天：验证码怎么收", hasChallengeFrame: false }), false);
  assert.equal(isVerificationChallenge({ url: "https://chatgpt.com/", bodyText: "", hasChallengeFrame: false }), false);
});

test("T19 handoff preserves task, attempt and URL while switching to headed", () => {
  const plan = createHandoffPlan({ taskId: "t1", attemptId: "a1", chatUrl: "https://chatgpt.com/c/1", state: "needs_human_verification" });
  assert.deepEqual(plan, { taskId: "t1", attemptId: "a1", chatUrl: "https://chatgpt.com/c/1", fromMode: "headless", toMode: "headed", resumeWithoutSubmit: true });
});
