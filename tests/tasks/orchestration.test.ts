import test from "node:test";
import assert from "node:assert/strict";
import { TaskQueue, QueueCancelledError } from "../../src/tasks/queue.js";
import { isCancellationRequested, requestCancellation } from "../../src/tasks/cancel.js";
import { nextSupplementRound, normalizeCount, rememberExplicitCount } from "../../src/tasks/count-policy.js";
import { selectTargets } from "../../src/tasks/selection.js";
import { readRememberedCount, writeRememberedCount } from "../../src/tasks/count-memory.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("T14 runs FIFO with one active task and rejects queued cancellation", async () => {
  const queue = new TaskQueue();
  const order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const first = queue.enqueue({ id: "a", run: async () => { order.push("a:start"); await gate; order.push("a:end"); return "a"; } });
  const second = queue.enqueue({ id: "b", run: async () => { order.push("b"); return "b"; } });
  assert.equal(queue.cancel("b"), true);
  assert.equal(queue.cancel("b"), false);
  release();
  assert.equal(await first, "a");
  await assert.rejects(() => second, QueueCancelledError);
  assert.deepEqual(order, ["a:start", "a:end"]);
});

test("T14 cancellation state is idempotent", () => {
  const once = requestCancellation({ requestedAt: null }, new Date("2026-07-30T00:00:00Z"));
  assert.equal(requestCancellation(once, new Date("2026-07-31T00:00:00Z")), once);
  assert.equal(isCancellationRequested(once), true);
});

test("T15 validates remembered counts and enforces three supplement rounds", () => {
  assert.equal(normalizeCount(undefined, 4), 4);
  assert.equal(rememberExplicitCount(2, 7), 7);
  assert.equal(rememberExplicitCount(2, undefined), 2);
  assert.equal(nextSupplementRound(4, 2, 2), 3);
  assert.equal(nextSupplementRound(4, 2, 3), null);
  assert.equal(nextSupplementRound(4, 4, 1), null);
  assert.throws(() => normalizeCount(11));
});

test("T15 persists an explicit count without storing account data", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "gwi-count-")), "preferences.json");
  assert.equal(await readRememberedCount(path, 1), 1);
  await writeRememberedCount(path, 6);
  assert.equal(await readRememberedCount(path, 1), 6);
});

test("T16 requires a choice for multiple images and understands explicit positions", () => {
  assert.equal(selectTargets(["a"], undefined).selected[0], "a");
  assert.deepEqual(selectTargets(["a", "b"], "修改第 2 张").selected, ["b"]);
  assert.deepEqual(selectTargets(["a", "b"], "修改最后一张").selected, ["b"]);
  assert.deepEqual(selectTargets(["a", "b"], "全部修改").selected, ["a", "b"]);
  assert.equal(selectTargets(["a", "b"], "改亮一点").needsChoice, true);
});
