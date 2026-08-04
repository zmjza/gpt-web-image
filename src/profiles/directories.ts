import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { ProfileRegistryStore } from "./registry.js";
import { PROFILE_RETENTION_POLICY, type ProfileRecord } from "./types.js";

export interface DirectoryScanSkip { name: string; path: string; reason: "SYMLINK_REJECTED" | "NOT_DIRECTORY" | "NOT_OWNED" | "CONFLICT"; }
export interface DirectoryScanResult { rootDir: string; registered: ProfileRecord[]; discovered: ProfileRecord[]; skipped: DirectoryScanSkip[]; scannedAt: string; }

async function readOwnedMarker(profileDir: string): Promise<{ createdAt: string } | null> {
  try {
    const marker = JSON.parse(await readFile(join(profileDir, ".gpt-web-image-profile.json"), "utf8")) as Record<string, unknown>;
    if (
      marker.schemaVersion !== "1" || marker.owner !== "gpt-web-image" ||
      marker.retentionPolicy !== PROFILE_RETENTION_POLICY || typeof marker.createdAt !== "string" ||
      typeof marker.profileDir !== "string" || resolve(marker.profileDir) !== resolve(profileDir)
    ) return null;
    return { createdAt: marker.createdAt };
  } catch { return null; }
}

function discoveredRecord(profileDir: string, name: string, createdAt: string): ProfileRecord {
  const now = new Date().toISOString();
  return {
    profileId: randomUUID(),
    name,
    accountLabel: null,
    notes: null,
    profileDir,
    source: "discovered",
    active: false,
    retentionPolicy: PROFILE_RETENTION_POLICY,
    loginStatus: "checking",
    membership: "technical_failure",
    browserStatus: "closed",
    taskBusy: false,
    createdAt,
    updatedAt: now,
    lastCheckedAt: null,
    lastOpenedAt: null
  };
}

export async function scanDefaultRoot(store: ProfileRegistryStore): Promise<DirectoryScanResult> {
  const registry = await store.read();
  const rootDir = resolve(registry.defaultRootDir);
  await mkdir(rootDir, { recursive: true });
  const registered = registry.profiles.filter((profile) => resolve(profile.profileDir, "..") === rootDir);
  const registeredPaths = new Set(registry.profiles.map((profile) => resolve(profile.profileDir)));
  const usedNames = new Set(registry.profiles.map((profile) => profile.name));
  const discovered: ProfileRecord[] = [];
  const skipped: DirectoryScanSkip[] = [];
  for (const entry of await readdir(rootDir, { withFileTypes: true })) {
    const path = resolve(rootDir, entry.name);
    if (registeredPaths.has(path)) continue;
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) { skipped.push({ name: entry.name, path, reason: "SYMLINK_REJECTED" }); continue; }
    if (!stats.isDirectory()) { skipped.push({ name: entry.name, path, reason: "NOT_DIRECTORY" }); continue; }
    const marker = await readOwnedMarker(path);
    if (!marker) { skipped.push({ name: entry.name, path, reason: "NOT_OWNED" }); continue; }
    let name = basename(path);
    if (usedNames.has(name)) name = `${name}-${entry.name.slice(0, 8)}`;
    if (usedNames.has(name)) { skipped.push({ name: entry.name, path, reason: "CONFLICT" }); continue; }
    usedNames.add(name);
    discovered.push(discoveredRecord(path, name, marker.createdAt));
  }
  if (discovered.length > 0) {
    await store.transaction((current) => {
      const existingPaths = new Set(current.profiles.map((profile) => resolve(profile.profileDir)));
      const existingNames = new Set(current.profiles.map((profile) => profile.name));
      const additions = discovered.filter((profile) => {
        const path = resolve(profile.profileDir);
        if (existingPaths.has(path) || existingNames.has(profile.name)) return false;
        existingPaths.add(path);
        existingNames.add(profile.name);
        return true;
      });
      return additions.length ? { ...current, profiles: [...current.profiles, ...additions] } : current;
    });
  }
  return { rootDir, registered, discovered, skipped, scannedAt: new Date().toISOString() };
}
