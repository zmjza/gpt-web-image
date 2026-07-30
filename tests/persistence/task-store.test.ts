import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTaskRecord } from "../../src/tasks/model.js";
import { readTaskRecord, taskFilePath, writeTaskRecord } from "../../src/persistence/task-store.js";

test("T10 atomically replaces task.json and rejects unknown schemas", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gwi-store-"));
  const path = taskFilePath(dir);
  const task = createTaskRecord({ prompt: "海报" }, "task_store", new Date("2026-07-30T00:00:00Z"));
  await writeTaskRecord(path, task);
  assert.equal((await readTaskRecord(path)).taskId, "task_store");
  assert.match(await readFile(path, "utf8"), /"schemaVersion": "1"/);
  await writeFile(path, JSON.stringify({ ...task, schemaVersion: "99" }));
  await assert.rejects(() => readTaskRecord(path), (error: Error & { code?: string }) => error.code === "PERSISTENCE_INCOMPATIBLE");
});

test("T10 leaves the last trusted file intact when replacement cannot start", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gwi-store-"));
  const path = taskFilePath(dir);
  const task = createTaskRecord({ prompt: "海报" }, "task_store", new Date("2026-07-30T00:00:00Z"));
  await writeTaskRecord(path, task);
  await assert.rejects(() => writeTaskRecord(join(dir, "missing", "task.json"), task));
  assert.equal((await readTaskRecord(path)).taskId, task.taskId);
});
