import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redactRecord, redactText } from "../../src/diagnostics/redact.js";
import { writeDiagnostic } from "../../src/diagnostics/store.js";
import { cleanupDiagnostics } from "../../src/diagnostics/cleanup.js";

test("T11 redacts headers, nested tokens, cookies and URL query secrets", async () => {
  const value = redactRecord({ headers: { authorization: "Bearer secret" }, nested: { access_token: "abc" }, text: "Cookie: sid=123; auth=456 https://x.test/?token=xyz&ok=1" });
  const json = JSON.stringify(value);
  assert.doesNotMatch(json, /secret|abc|sid=123|auth=456|xyz/);
  assert.match(redactText("Authorization: Bearer token-value"), /\[REDACTED\]/);

  const root = await mkdtemp(join(tmpdir(), "gwi-diag-"));
  const record = await writeDiagnostic(root, { taskId: "t1", category: "network", message: "token=secret", artifacts: { cookie: "sid=1" }, createdAt: new Date("2026-07-30T00:00:00Z") });
  assert.equal(record.expiresAt, "2026-08-06T00:00:00.000Z");
  const body = await readFile(join(root, `${record.diagnosticId}.json`), "utf8");
  assert.doesNotMatch(body, /secret|sid=1/);
});

test("T12 only removes expired regular diagnostics and never follows symlinks", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "gwi-clean-"));
  const outside = await mkdtemp(join(tmpdir(), "gwi-outside-"));
  const old = join(root, "old.json");
  const fresh = join(root, "fresh.json");
  const task = join(root, "task.json");
  const external = join(outside, "original.png");
  await writeFile(old, "{}"); await writeFile(fresh, "{}"); await writeFile(task, "{}"); await writeFile(external, "image");
  try { await symlink(external, join(root, "escape.json")); }
  catch (error) { if (process.platform !== "win32") throw error; t.diagnostic("Windows runner does not permit symlink creation; boundary behavior is covered on POSIX."); }
  await mkdir(join(root, "nested"));
  const oldDate = new Date("2026-07-01T00:00:00Z");
  await Promise.all([utimes(old, oldDate, oldDate), utimes(task, oldDate, oldDate)]);
  const dry = await cleanupDiagnostics(root, new Date("2026-07-30T00:00:00Z"), 7, true);
  assert.ok(dry.removed.includes(old));
  const result = await cleanupDiagnostics(root, new Date("2026-07-30T00:00:00Z"));
  assert.deepEqual(result.removed, [old]);
  assert.equal(await readFile(external, "utf8"), "image");
  assert.equal(await readFile(task, "utf8"), "{}");
});

test("T12 refuses to clean any directory inside the protected Chrome Profile", async () => {
  const profile = await mkdtemp(join(tmpdir(), "gwi-protected-profile-"));
  const diagnostics = join(profile, "diagnostics");
  await mkdir(diagnostics);
  const old = join(diagnostics, "old.json");
  await writeFile(old, "{}");
  const oldDate = new Date("2026-07-01T00:00:00Z");
  await utimes(old, oldDate, oldDate);

  await assert.rejects(() => cleanupDiagnostics(diagnostics, new Date("2026-07-30T00:00:00Z"), 7, false, profile), /Profile 数据永不自动删除/);
  assert.equal(await readFile(old, "utf8"), "{}");
});
