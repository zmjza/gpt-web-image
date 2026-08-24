import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

interface QueueEntry { taskId: string; sequence: number; enqueuedAt: string; }
interface ActiveEntry { taskId: string; pid: number; ownerToken: string; startedAt: string; }
interface QueueState { schemaVersion: "1"; profileId: string; nextSequence: number; entries: QueueEntry[]; active: ActiveEntry | null; }
interface QueueLockRecord { schemaVersion: "1"; pid: number; token: string; }

export interface ProfileTaskQueueOptions { pollIntervalMs?: number; lockTimeoutMs?: number; }

function processAlive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }
function queueFile(rootDir: string, profileId: string): string { const key = createHash("sha256").update(profileId).digest("hex").slice(0, 24); return join(resolve(rootDir), ".gpt-web-image-queues", `${key}.json`); }
function initialState(profileId: string): QueueState { return { schemaVersion: "1", profileId, nextSequence: 1, entries: [], active: null }; }

async function readState(path: string, profileId: string): Promise<QueueState> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<QueueState>;
    if (value.schemaVersion !== "1" || value.profileId !== profileId || !Array.isArray(value.entries) || typeof value.nextSequence !== "number") throw new Error("队列状态无效");
    return { schemaVersion: "1", profileId, nextSequence: value.nextSequence, entries: value.entries as QueueEntry[], active: value.active ?? null };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return initialState(profileId);
    throw error;
  }
}

async function writeState(path: string, state: QueueState): Promise<void> {
  await mkdir(resolve(path, ".."), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.partial`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  try { await rename(temporary, path); } catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
}

async function readQueueLock(path: string): Promise<QueueLockRecord | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<QueueLockRecord>;
    return value.schemaVersion === "1" && Number.isInteger(value.pid) && (value.pid as number) > 0 && typeof value.token === "string" && value.token.length > 0
      ? value as QueueLockRecord
      : null;
  } catch { return null; }
}

export class ProfileTaskQueue {
  private readonly path: string;
  private readonly lockPath: string;
  private readonly pollIntervalMs: number;
  private readonly lockTimeoutMs: number;
  private readonly ownerTokens = new Map<string, string>();

  public constructor(rootDir: string, private readonly profileId: string, options: ProfileTaskQueueOptions = {}) {
    this.path = queueFile(rootDir, profileId);
    this.lockPath = `${this.path}.lock`;
    this.pollIntervalMs = Math.max(1, Math.floor(options.pollIntervalMs ?? 100));
    this.lockTimeoutMs = Math.max(100, Math.floor(options.lockTimeoutMs ?? 10_000));
  }

  private async withStateLock<T>(operation: (state: QueueState) => Promise<{ state: QueueState; value: T }> | { state: QueueState; value: T }): Promise<T> {
    await mkdir(resolve(this.lockPath, ".."), { recursive: true });
    const deadline = Date.now() + this.lockTimeoutMs;
    while (Date.now() < deadline) {
      const token = randomUUID();
      try {
        const handle = await open(this.lockPath, "wx", 0o600);
        try { await handle.writeFile(`${JSON.stringify({ schemaVersion: "1", pid: process.pid, token })}\n`, "utf8"); await handle.sync(); }
        finally { await handle.close(); }
        try {
          const result = await operation(await readState(this.path, this.profileId));
          await writeState(this.path, result.state);
          return result.value;
        } finally {
          await unlink(this.lockPath).catch(() => undefined);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const existing = await readQueueLock(this.lockPath);
        if (existing && !processAlive(existing.pid)) {
          await unlink(this.lockPath).catch(() => undefined);
          continue;
        }
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, this.pollIntervalMs));
    }
    throw new Error("PROFILE_QUEUE_LOCK_TIMEOUT");
  }

  public async enqueue(taskId: string): Promise<number> {
    return this.withStateLock((state) => {
      if (state.entries.some((entry) => entry.taskId === taskId) || state.active?.taskId === taskId) throw new Error(`重复任务 ID：${taskId}`);
      const entry = { taskId, sequence: state.nextSequence, enqueuedAt: new Date().toISOString() };
      const entries = [...state.entries, entry];
      return { state: { ...state, nextSequence: state.nextSequence + 1, entries }, value: entries.length + (state.active ? 1 : 0) };
    });
  }

  public async waitForTurn(taskId: string, isCancelled?: (() => boolean | Promise<boolean>) | undefined, timeoutMs = 1200000): Promise<void> {
    const deadline = Date.now() + Math.max(1, timeoutMs);
    while (Date.now() < deadline) {
      if (await isCancelled?.()) { await this.cancel(taskId); throw new Error("QUEUE_CANCELLED"); }
      const acquired = await this.withStateLock((state) => {
        let next = state;
        if (next.active && !processAlive(next.active.pid)) next = { ...next, active: null };
        const index = next.entries.findIndex((entry) => entry.taskId === taskId);
        if (index < 0) return { state: next, value: false };
        if (index !== 0 || next.active) return { state: next, value: false };
        const ownerToken = randomUUID();
        this.ownerTokens.set(taskId, ownerToken);
        return { state: { ...next, entries: next.entries.slice(1), active: { taskId, pid: process.pid, ownerToken, startedAt: new Date().toISOString() } }, value: true };
      });
      if (acquired) return;
      const state = await this.withStateLock((current) => ({ state: current, value: current }));
      if (!state.entries.some((entry) => entry.taskId === taskId) && state.active?.taskId !== taskId) throw new Error("QUEUE_TASK_NOT_FOUND");
      await new Promise((resolvePromise) => setTimeout(resolvePromise, this.pollIntervalMs));
    }
    throw new Error("PROFILE_QUEUE_TIMEOUT");
  }

  public async release(taskId: string): Promise<void> {
    const ownerToken = this.ownerTokens.get(taskId);
    await this.withStateLock((state) => {
      if (state.active?.taskId === taskId && (!ownerToken || state.active.ownerToken === ownerToken)) return { state: { ...state, active: null }, value: undefined };
      return { state, value: undefined };
    });
    this.ownerTokens.delete(taskId);
  }

  public async cancel(taskId: string): Promise<boolean> {
    return this.withStateLock((state) => {
      const index = state.entries.findIndex((entry) => entry.taskId === taskId);
      if (index < 0) return { state, value: false };
      return { state: { ...state, entries: state.entries.filter((entry) => entry.taskId !== taskId) }, value: true };
    });
  }
}
