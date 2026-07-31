import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface BrowserLeaseRecord {
  schemaVersion: "1";
  ownerToken: string;
  pid: number;
  profileId: string;
  profileDir: string;
  ownerType: "manual" | "task";
  acquiredAt: string;
}

export class BrowserLeaseError extends Error {
  public constructor(public readonly code: "BROWSER_LEASED" | "BROWSER_LEASE_UNVERIFIED" | "BROWSER_LEASE_FAILED", message: string = code) { super(`${code}: ${message}`); }
}

async function readLease(path: string): Promise<BrowserLeaseRecord | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<BrowserLeaseRecord>;
    if (
      value.schemaVersion !== "1" || typeof value.ownerToken !== "string" || typeof value.pid !== "number" ||
      typeof value.profileId !== "string" || typeof value.profileDir !== "string" ||
      (value.ownerType !== "manual" && value.ownerType !== "task") || typeof value.acquiredAt !== "string"
    ) return null;
    return value as BrowserLeaseRecord;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? null : null;
  }
}

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export class BrowserLease {
  public readonly path: string;
  public readonly record: BrowserLeaseRecord;
  private acquired = false;

  public constructor(rootDir: string, input: { profileId: string; profileDir: string; ownerType: "manual" | "task" }) {
    this.path = join(resolve(rootDir), ".gpt-web-image-browser-lease.json");
    this.record = { schemaVersion: "1", ownerToken: randomUUID(), pid: process.pid, profileId: input.profileId, profileDir: resolve(input.profileDir), ownerType: input.ownerType, acquiredAt: new Date().toISOString() };
  }

  public status(): Promise<BrowserLeaseRecord | null> { return readLease(this.path); }

  public async acquire(): Promise<void> {
    await mkdir(resolve(this.path, ".."), { recursive: true });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const handle = await open(this.path, "wx", 0o600);
        try { await handle.writeFile(`${JSON.stringify(this.record)}\n`, "utf8"); await handle.sync(); }
        finally { await handle.close(); }
        this.acquired = true;
        return;
      } catch (error) {
        const existing = await readLease(this.path);
        if (!existing) throw new BrowserLeaseError("BROWSER_LEASE_UNVERIFIED");
        if (processAlive(existing.pid)) throw new BrowserLeaseError("BROWSER_LEASED", `Profile ${existing.profileId} 正在使用专用浏览器`);
        if (attempt === 0) { await rm(this.path, { force: true }); continue; }
        throw new BrowserLeaseError("BROWSER_LEASE_FAILED", error instanceof Error ? error.message : String(error));
      }
    }
  }

  public async release(): Promise<void> {
    if (!this.acquired) return;
    const existing = await readLease(this.path);
    if (existing?.ownerToken === this.record.ownerToken) await rm(this.path, { force: true });
    this.acquired = false;
  }
}
