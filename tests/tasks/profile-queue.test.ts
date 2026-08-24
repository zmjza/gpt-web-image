import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { ProfileTaskQueue } from "../../src/tasks/profile-queue.js";

test("serializes FIFO work across independent queue instances for one Profile", async () => {
  const root = await mkdtemp(join(tmpdir(), "gwi-profile-queue-"));
  const firstQueue = new ProfileTaskQueue(root, "profile-a", { pollIntervalMs: 5 });
  const secondQueue = new ProfileTaskQueue(root, "profile-a", { pollIntervalMs: 5 });
  await firstQueue.enqueue("task-a");
  await secondQueue.enqueue("task-b");
  const order: string[] = [];
  const first = (async () => { await firstQueue.waitForTurn("task-a"); order.push("a:start"); await new Promise((resolve) => setTimeout(resolve, 30)); order.push("a:end"); await firstQueue.release("task-a"); })();
  const second = (async () => { await secondQueue.waitForTurn("task-b"); order.push("b:start"); await secondQueue.release("task-b"); })();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["a:start", "a:end", "b:start"]);
});

test("removes a queued task without disturbing the active task", async () => {
  const root = await mkdtemp(join(tmpdir(), "gwi-profile-queue-cancel-"));
  const queue = new ProfileTaskQueue(root, "profile-a", { pollIntervalMs: 5 });
  await queue.enqueue("task-a");
  await queue.enqueue("task-b");
  await queue.waitForTurn("task-a");
  assert.equal(await queue.cancel("task-b"), true);
  assert.equal(await queue.cancel("task-b"), false);
  await queue.release("task-a");
  await assert.rejects(() => queue.waitForTurn("task-b", undefined, 80), /QUEUE_TASK_NOT_FOUND/);
});

test("reclaims an owned queue mutex left by a dead process", async () => {
  const root = await mkdtemp(join(tmpdir(), "gwi-profile-queue-stale-lock-"));
  const profileId = "profile-stale-lock";
  const key = createHash("sha256").update(profileId).digest("hex").slice(0, 24);
  const queueDir = join(root, ".gpt-web-image-queues");
  await mkdir(queueDir, { recursive: true });
  await writeFile(join(queueDir, `${key}.json.lock`), `${JSON.stringify({ schemaVersion: "1", pid: 999999, token: "stale-owned-lock" })}\n`);
  const queue = new ProfileTaskQueue(root, profileId, { pollIntervalMs: 5, lockTimeoutMs: 150 });
  assert.equal(await queue.enqueue("task-after-crash"), 1);
  await queue.waitForTurn("task-after-crash");
  await queue.release("task-after-crash");
});

test("serializes two separate Node processes in FIFO order", async () => {
  const root = await mkdtemp(join(tmpdir(), "gwi-profile-queue-process-"));
  const ready = join(root, "first.ready");
  const log = join(root, "order.log");
  const modulePath = join(process.cwd(), "dist/src/tasks/profile-queue.js");
  const worker = `import { writeFile, appendFile } from "node:fs/promises"; import { ProfileTaskQueue } from ${JSON.stringify(modulePath)}; const [root, task, ready, log, hold] = process.argv.slice(1); const q = new ProfileTaskQueue(root, "profile-process", { pollIntervalMs: 5 }); await q.enqueue(task); if (ready) await writeFile(ready, "ready"); await q.waitForTurn(task); await appendFile(log, task + ":start\\n"); await new Promise((resolve) => setTimeout(resolve, Number(hold))); await appendFile(log, task + ":end\\n"); await q.release(task);`;
  const first = spawn(process.execPath, ["--input-type=module", "-e", worker, root, "task-a", ready, log, "50"], { stdio: "ignore" });
  const waitForReady = async (): Promise<void> => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { await access(ready); return; } catch { await new Promise((resolve) => setTimeout(resolve, 5)); }
    }
    throw new Error("跨进程队列夹具启动超时");
  };
  await waitForReady();
  const second = spawn(process.execPath, ["--input-type=module", "-e", worker, root, "task-b", "", log, "0"], { stdio: "ignore" });
  const waitForExit = (child: ReturnType<typeof spawn>): Promise<void> => new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`跨进程队列子进程退出：${code}`)));
  });
  await Promise.all([waitForExit(first), waitForExit(second)]);
  assert.equal(await readFile(log, "utf8"), "task-a:start\ntask-a:end\ntask-b:start\ntask-b:end\n");
});
