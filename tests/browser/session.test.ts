import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildHeadedChromeArgs, ensureOwnedProfile, hideMacWindowByTitle, profileMarkerPath } from "../../src/browser/profile.js";
import { LoginReadinessTracker, classifyLoginPage, isVerificationChallenge } from "../../src/browser/login.js";
import { createHandoffPlan } from "../../src/browser/handoff.js";

test("T17 creates an ownership marker and rejects a foreign non-empty profile", async () => {
  const owned = await mkdtemp(join(tmpdir(), "gwi-profile-"));
  await ensureOwnedProfile(owned);
  await ensureOwnedProfile(owned);
  const marker = JSON.parse(await (await import("node:fs/promises")).readFile(profileMarkerPath(owned), "utf8")) as { owner: string; profileDir: string; retentionPolicy: string };
  assert.equal(marker.owner, "gpt-web-image");
  assert.equal(marker.profileDir, resolve(owned));
  assert.equal(marker.retentionPolicy, "never-auto-delete");

  const foreign = await mkdtemp(join(tmpdir(), "gwi-foreign-"));
  await writeFile(join(foreign, "Preferences"), "{}");
  await assert.rejects(() => ensureOwnedProfile(foreign), /非本项目/);
});

test("T17 upgrades a legacy marker without deleting existing Profile data", async () => {
  const profile = await mkdtemp(join(tmpdir(), "gwi-legacy-profile-"));
  const sentinel = join(profile, "Cookies");
  await writeFile(profileMarkerPath(profile), JSON.stringify({ schemaVersion: "1", owner: "gpt-web-image", createdAt: "2026-01-01T00:00:00.000Z" }));
  await writeFile(sentinel, "opaque-profile-data");

  await ensureOwnedProfile(profile);

  const marker = JSON.parse(await (await import("node:fs/promises")).readFile(profileMarkerPath(profile), "utf8")) as { profileDir: string; retentionPolicy: string };
  assert.equal(marker.profileDir, resolve(profile));
  assert.equal(marker.retentionPolicy, "never-auto-delete");
  assert.equal(await (await import("node:fs/promises")).readFile(sentinel, "utf8"), "opaque-profile-data");
});

test("T17 avoids Playwright launch fingerprints for account flows", async () => {
  const source = await readFile("src/browser/profile.ts", "utf8");
  assert.doesNotMatch(source, /launchPersistentContext|--no-sandbox|chromiumSandbox:\s*false/);
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

test("T17 runs normal tasks in minimized ordinary Chrome without headless fingerprints", () => {
  const args = buildHeadedChromeArgs(resolve("dedicated profile"), "https://chatgpt.com/", 43124, true);
  assert.equal(args.includes("--start-minimized"), true);
  assert.equal(args.some((argument) => /--headless|--enable-automation|--no-sandbox/.test(argument)), false);
});

test("T17 retries the macOS window marker while Chrome propagates the title", async () => {
  let attempts = 0;
  await hideMacWindowByTitle("gpt-web-image-marker", {
    intervalMs: 0,
    maxAttempts: 3,
    run: () => (++attempts >= 3 ? "true\n" : "false\n")
  });
  assert.equal(attempts, 3);
});

test("T17 retries a transient macOS AppleScript connection error", async () => {
  let attempts = 0;
  await hideMacWindowByTitle("gpt-web-image-marker", {
    intervalMs: 0,
    maxAttempts: 3,
    run: () => {
      attempts += 1;
      if (attempts === 1) throw new Error("connection is invalid (-609)");
      return attempts === 3 ? "true\n" : "false\n";
    }
  });
  assert.equal(attempts, 3);
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
  assert.equal(isVerificationChallenge({ url: "https://chatgpt.com/", bodyText: "", hasChallengeFrame: true }), true);
  assert.equal(isVerificationChallenge({ url: "https://chatgpt.com/", bodyText: "历史聊天：验证码怎么收", hasChallengeFrame: false }), false);
  assert.equal(isVerificationChallenge({ url: "https://chatgpt.com/", bodyText: "", hasChallengeFrame: false }), false);
});

test("T19 handoff preserves task, attempt and URL while switching to headed", () => {
  const plan = createHandoffPlan({ taskId: "t1", attemptId: "a1", chatUrl: "https://chatgpt.com/c/1", state: "needs_human_verification" });
  assert.deepEqual(plan, { taskId: "t1", attemptId: "a1", chatUrl: "https://chatgpt.com/c/1", fromMode: "headless", toMode: "headed", resumeWithoutSubmit: true });
});
