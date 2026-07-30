import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfileLock, ProfileLockError } from "../../src/browser/profile-lock.js";

test("T13 refuses an active owned lock and reclaims a verified stale lock", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gwi-lock-"));
  const lock = new ProfileLock(dir);
  await lock.acquire();
  const second = new ProfileLock(dir);
  await assert.rejects(() => second.acquire(), (error: unknown) => error instanceof ProfileLockError && error.code === "PROFILE_LOCKED");
  await lock.release();

  await writeFile(join(dir, ".gpt-web-image.lock"), JSON.stringify({ schemaVersion: "1", ownerToken: "old", pid: 99999999, startedAt: "2026-01-01T00:00:00Z", profileDir: dir, executableHint: "gpt-web-image" }));
  await second.acquire();
  await second.release();
});

test("T13 does not reclaim a lock with unverified ownership", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gwi-lock-"));
  await writeFile(join(dir, ".gpt-web-image.lock"), "not-json");
  const lock = new ProfileLock(dir);
  await assert.rejects(() => lock.acquire(), (error: unknown) => error instanceof ProfileLockError && error.code === "PROFILE_LOCK_UNVERIFIED");
});
