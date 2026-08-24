import test from "node:test";
import assert from "node:assert/strict";
import { createTaskRecord } from "../../src/tasks/model.js";
import { createTaskId } from "../../src/tasks/id.js";

test("T09 creates a stable path-safe TaskRecord", () => {
  const taskId = createTaskId(() => 1700000000000);
  const task = createTaskRecord({ kind: "generate", prompt: "海边", count: 1, referencePaths: [] }, taskId, new Date("2026-07-30T00:00:00Z"));
  assert.match(task.taskId, /^[a-z0-9_-]+$/);
  assert.equal(task.schemaVersion, "1");
  assert.equal(task.state, "initializing");
  assert.equal(task.targetCount, 1);
  assert.deepEqual(task.modelSelections, []);
  assert.deepEqual(task.referenceEvidence, []);
  assert.equal(task.queuePosition, null);
  assert.deepEqual(task.results, []);
  assert.equal("cookie" in task, false);
  assert.equal("authorization" in task, false);
  assert.equal("password" in task, false);
});

test("T09 refuses unsafe task ids", () => {
  assert.throws(() => createTaskRecord({ kind: "generate", prompt: "x", count: 1, referencePaths: [] }, "../escape"));
});
