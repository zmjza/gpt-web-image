import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { ProfileRecord } from "./types.js";
import { ProfileManager } from "./manager.js";

export interface BackupRecord {
  backupId: string;
  sourceProfileId: string;
  sourceProfileName: string;
  backupDir: string;
  createdAt: string;
  encrypted: false;
  includesChromeAuthData: true;
}

interface BackupManifest extends BackupRecord {
  schemaVersion: "1";
}

export async function createBackup(profile: ProfileRecord, backupRoot: string): Promise<BackupRecord> {
  if (profile.browserStatus !== "closed" || profile.taskBusy) throw new Error("PROFILE_BUSY");
  const backupId = randomUUID();
  const backupDir = resolve(backupRoot, `${profile.profileId}-${backupId}`);
  const snapshotDir = join(backupDir, "profile");
  await mkdir(backupDir, { recursive: true });
  await cp(profile.profileDir, snapshotDir, { recursive: true, errorOnExist: true, force: false });
  const record: BackupRecord = {
    backupId,
    sourceProfileId: profile.profileId,
    sourceProfileName: profile.name,
    backupDir,
    createdAt: new Date().toISOString(),
    encrypted: false,
    includesChromeAuthData: true
  };
  const manifest: BackupManifest = { schemaVersion: "1", ...record };
  await writeFile(join(backupDir, "backup.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return record;
}

export async function restoreBackup(backup: BackupRecord, manager: ProfileManager, name: string): Promise<ProfileRecord> {
  const manifest = JSON.parse(await readFile(join(backup.backupDir, "backup.json"), "utf8")) as Partial<BackupManifest>;
  if (manifest.schemaVersion !== "1" || manifest.backupId !== backup.backupId || manifest.encrypted !== false || manifest.includesChromeAuthData !== true) throw new Error("BACKUP_INVALID");
  const registry = await manager.list();
  const profileId = randomUUID();
  const profileDir = join(registry.defaultRootDir, profileId);
  await mkdir(profileDir, { recursive: true });
  await cp(join(backup.backupDir, "profile"), profileDir, { recursive: true, force: true });
  const markerPath = join(profileDir, ".gpt-web-image-profile.json");
  const oldMarker = JSON.parse(await readFile(markerPath, "utf8")) as Record<string, unknown>;
  await writeFile(markerPath, `${JSON.stringify({ ...oldMarker, profileDir: resolve(profileDir) }, null, 2)}\n`, { mode: 0o600 });
  return manager.importProfile({ name, accountLabel: basename(backup.sourceProfileName) || null, profileDir, source: "restored" });
}

export async function listBackups(backupRoot: string): Promise<BackupRecord[]> {
  const records: BackupRecord[] = [];
  for (const entry of await readdir(resolve(backupRoot), { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    try {
      const raw = JSON.parse(await readFile(join(resolve(backupRoot), entry.name, "backup.json"), "utf8")) as Partial<BackupManifest>;
      if (raw.schemaVersion !== "1" || typeof raw.backupId !== "string" || typeof raw.sourceProfileId !== "string" || typeof raw.sourceProfileName !== "string" || typeof raw.backupDir !== "string" || typeof raw.createdAt !== "string" || raw.encrypted !== false || raw.includesChromeAuthData !== true) continue;
      records.push({ backupId: raw.backupId, sourceProfileId: raw.sourceProfileId, sourceProfileName: raw.sourceProfileName, backupDir: resolve(raw.backupDir), createdAt: raw.createdAt, encrypted: false, includesChromeAuthData: true });
    } catch { /* Invalid backup directories are ignored until explicitly selected. */ }
  }
  return records.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}
