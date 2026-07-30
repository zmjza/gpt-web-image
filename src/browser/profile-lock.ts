import { open, readFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface ProfileLockRecord { schemaVersion: "1"; ownerToken: string; pid: number; startedAt: string; profileDir: string; executableHint: string; }

export class ProfileLockError extends Error {
  public constructor(public readonly code: "PROFILE_LOCKED" | "PROFILE_LOCK_UNVERIFIED" | "PROFILE_LOCK_FAILED", message: string = code) { super(message); }
}

export class ProfileLock {
  public readonly path: string;
  private handle: Awaited<ReturnType<typeof open>> | undefined;
  public readonly record: ProfileLockRecord;
  public constructor(private readonly profileDir: string, executableHint = "gpt-web-image") {
    this.path = join(profileDir, ".gpt-web-image.lock");
    this.record = { schemaVersion: "1", ownerToken: randomUUID(), pid: process.pid, startedAt: new Date().toISOString(), profileDir, executableHint };
  }
  public async acquire(): Promise<void> {
    await mkdir(this.profileDir, { recursive: true });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        this.handle = await open(this.path, "wx");
        await this.handle.writeFile(`${JSON.stringify(this.record)}\n`, "utf8");
        await this.handle.sync();
        return;
      } catch (error) {
        if (this.handle) await this.handle.close().catch(() => undefined);
        this.handle = undefined;
        const existing = await readLock(this.path);
        if (!existing || existing.schemaVersion !== "1" || existing.profileDir !== this.profileDir || existing.executableHint !== "gpt-web-image") {
          throw new ProfileLockError("PROFILE_LOCK_UNVERIFIED", "现有 Profile 锁无法验证归属");
        }
        if (isProcessAlive(existing.pid)) throw new ProfileLockError("PROFILE_LOCKED", "Profile 正被另一个任务使用");
        if (attempt === 0) {
          await unlink(this.path).catch(() => undefined);
          continue;
        }
        throw new ProfileLockError("PROFILE_LOCK_FAILED", `Profile 死锁回收失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new ProfileLockError("PROFILE_LOCK_FAILED");
  }
  public async release(): Promise<void> {
    if (!this.handle) return;
    await this.handle.close(); this.handle = undefined;
    const existing = await readLock(this.path);
    if (existing?.ownerToken === this.record.ownerToken) await unlink(this.path).catch(() => undefined);
  }
}

async function readLock(path: string): Promise<ProfileLockRecord | undefined> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<ProfileLockRecord>;
    return value.schemaVersion === "1" && typeof value.ownerToken === "string" && typeof value.pid === "number" && typeof value.startedAt === "string" && typeof value.profileDir === "string" && typeof value.executableHint === "string" ? value as ProfileLockRecord : undefined;
  } catch { return undefined; }
}
function isProcessAlive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }
