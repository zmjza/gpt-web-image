import { createHash, randomUUID } from "node:crypto";
import { access, cp, lstat, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { ProfileRegistryStore } from "./registry.js";
import type { ProfileRecord, ProfileRegistry } from "./types.js";

export type DirectoryChangeMode = "migrate" | "retain";
export interface DirectoryChangePlan { mode: DirectoryChangeMode; currentRootDir: string; targetRootDir: string; profileCount: number; conflicts: string[]; busyProfileIds: string[]; }

export async function planDefaultRootChange(store: ProfileRegistryStore, targetRootDir: string, mode: DirectoryChangeMode): Promise<DirectoryChangePlan> {
  const registry = await store.read();
  const target = resolve(targetRootDir);
  if (target === resolve(registry.defaultRootDir)) throw new Error("DIRECTORY_UNCHANGED");
  await mkdir(target, { recursive: true });
  await access(target, constants.R_OK | constants.W_OK);
  const conflicts: string[] = [];
  for (const profile of registry.profiles) {
    try { await lstat(join(target, profile.profileId)); conflicts.push(profile.profileId); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return {
    mode,
    currentRootDir: resolve(registry.defaultRootDir),
    targetRootDir: target,
    profileCount: registry.profiles.length,
    conflicts,
    busyProfileIds: registry.profiles.filter((profile) => profile.taskBusy || profile.browserStatus !== "closed").map((profile) => profile.profileId)
  };
}

async function fingerprintTree(root: string): Promise<string> {
  const parts: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === ".gpt-web-image.lock" || entry.name === ".gpt-web-image-profile.json") continue;
      const path = join(directory, entry.name);
      const info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error("PROFILE_SYMLINK_REJECTED");
      if (info.isDirectory()) { parts.push(`d:${relative(root, path)}`); await visit(path); continue; }
      if (!info.isFile()) continue;
      const content = await readFile(path);
      parts.push(`f:${relative(root, path)}:${info.size}:${createHash("sha256").update(content).digest("hex")}`);
    }
  }
  await visit(root);
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

async function copyProfileToStaging(profile: ProfileRecord, stagingRoot: string, targetRoot: string): Promise<{ stagingDir: string; targetDir: string }> {
  const stagingDir = join(stagingRoot, profile.profileId);
  const targetDir = join(targetRoot, profile.profileId);
  await cp(profile.profileDir, stagingDir, { recursive: true, errorOnExist: true, force: false });
  if (await fingerprintTree(profile.profileDir) !== await fingerprintTree(stagingDir)) throw new Error(`MIGRATION_VERIFY_FAILED:${profile.profileId}`);
  const markerPath = join(stagingDir, ".gpt-web-image-profile.json");
  const marker = JSON.parse(await readFile(markerPath, "utf8")) as Record<string, unknown>;
  await writeFile(markerPath, `${JSON.stringify({ ...marker, profileDir: resolve(targetDir) }, null, 2)}\n`, { mode: 0o600 });
  return { stagingDir, targetDir };
}

export async function changeDefaultRoot(store: ProfileRegistryStore, targetRootDir: string, mode: DirectoryChangeMode): Promise<ProfileRegistry> {
  const plan = await planDefaultRootChange(store, targetRootDir, mode);
  if (plan.conflicts.length > 0) throw new Error(`DIRECTORY_CONFLICT:${plan.conflicts.join(",")}`);
  if (mode === "migrate" && plan.busyProfileIds.length > 0) throw new Error(`PROFILE_BUSY:${plan.busyProfileIds.join(",")}`);
  const registry = await store.read();
  const retainedRoots = Array.from(new Set([...registry.retainedRoots, plan.currentRootDir]));
  if (mode === "retain") {
    return store.transaction((current) => ({ ...current, defaultRootDir: plan.targetRootDir, retainedRoots }));
  }
  const stagingRoot = join(plan.targetRootDir, `.gpt-web-image-migration-${randomUUID()}`);
  await mkdir(stagingRoot, { recursive: true });
  const copies: Array<{ profile: ProfileRecord; stagingDir: string; targetDir: string }> = [];
  for (const profile of registry.profiles) copies.push({ profile, ...await copyProfileToStaging(profile, stagingRoot, plan.targetRootDir) });
  for (const copy of copies) await rename(copy.stagingDir, copy.targetDir);
  for (const copy of copies) {
    const sourceStats = await stat(copy.profile.profileDir);
    const targetStats = await stat(copy.targetDir);
    if (!sourceStats.isDirectory() || !targetStats.isDirectory()) throw new Error(`MIGRATION_VERIFY_FAILED:${copy.profile.profileId}`);
  }
  return store.transaction((current) => ({
    ...current,
    defaultRootDir: plan.targetRootDir,
    retainedRoots,
    profiles: current.profiles.map((profile) => ({ ...profile, profileDir: join(plan.targetRootDir, profile.profileId), updatedAt: new Date().toISOString() }))
  }));
}
