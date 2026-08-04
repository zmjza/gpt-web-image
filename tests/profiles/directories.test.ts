import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ProfileRegistryStore } from "../../src/profiles/registry.js";
import { ProfileManager } from "../../src/profiles/manager.js";
import { scanDefaultRoot } from "../../src/profiles/directories.js";
import { changeDefaultRoot } from "../../src/profiles/migration.js";
import type { ProfileRecord } from "../../src/profiles/types.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "gpt-web-image-directories-"));
  const profiles = join(root, "profiles");
  const store = new ProfileRegistryStore(join(root, "profile-registry.json"), profiles);
  const manager = new ProfileManager(store);
  return { root, profiles, store, manager };
}

test("T44 scans only owned direct children and never follows symlink escapes", async () => {
  const { root, profiles, store, manager } = await fixture();
  const owned = await manager.create({ name: "已登记", accountLabel: null });
  const external = join(root, "external");
  await mkdir(external, { recursive: true });
  await writeFile(join(external, ".gpt-web-image-profile.json"), JSON.stringify({ schemaVersion: "1", owner: "gpt-web-image", createdAt: new Date().toISOString(), profileDir: resolve(external), retentionPolicy: "never-auto-delete" }));
  await symlink(external, join(profiles, "linked"));
  await mkdir(join(profiles, "foreign"), { recursive: true });
  const result = await scanDefaultRoot(store);
  assert.deepEqual(result.registered.map((entry) => entry.profileId), [owned.profileId]);
  assert.equal(result.discovered.length, 0);
  assert.equal(result.skipped.some((entry) => entry.name === "linked" && entry.reason === "SYMLINK_REJECTED"), true);
  assert.equal(result.skipped.some((entry) => entry.name === "foreign" && entry.reason === "NOT_OWNED"), true);
});

test("directory discovery rechecks paths at commit time when registration races a scan", async () => {
  const { root, profiles } = await fixture();
  const discoveredPath = join(profiles, "racing-profile");
  await mkdir(discoveredPath, { recursive: true });
  await writeFile(join(discoveredPath, ".gpt-web-image-profile.json"), JSON.stringify({ schemaVersion: "1", owner: "gpt-web-image", createdAt: new Date().toISOString(), profileDir: resolve(discoveredPath), retentionPolicy: "never-auto-delete" }));

  class RacingStore extends ProfileRegistryStore {
    private raced = false;
    public override async transaction(update: Parameters<ProfileRegistryStore["transaction"]>[0]): Promise<Awaited<ReturnType<ProfileRegistryStore["transaction"]>>> {
      if (!this.raced) {
        this.raced = true;
        const record: ProfileRecord = { profileId: "racing-registration", name: "已登记竞态", accountLabel: null, notes: null, profileDir: discoveredPath, source: "imported", active: false, retentionPolicy: "never-auto-delete", loginStatus: "checking", membership: "technical_failure", browserStatus: "closed", taskBusy: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastCheckedAt: null, lastOpenedAt: null };
        await super.transaction((current) => ({ ...current, profiles: [...current.profiles, record] }));
      }
      return super.transaction(update);
    }
  }

  const store = new RacingStore(join(root, "profile-registry.json"), profiles);
  await scanDefaultRoot(store);
  const registry = await store.read();
  assert.equal(registry.profiles.filter((profile) => resolve(profile.profileDir) === resolve(discoveredPath)).length, 1);
});

test("T46 retain changes only the default root and keeps existing profile paths", async () => {
  const { root, store, manager } = await fixture();
  const profile = await manager.create({ name: "旧目录账号", accountLabel: null });
  const nextRoot = join(root, "新的 profiles");
  await changeDefaultRoot(store, nextRoot, "retain");
  const registry = await store.read();
  assert.equal(registry.defaultRootDir, resolve(nextRoot));
  assert.equal(registry.profiles[0]?.profileDir, profile.profileDir);
  assert.equal(registry.retainedRoots.includes(resolve(profile.profileDir, "..")), true);
});

test("T46 migrate copies all owned profile data before switching and preserves sources", async () => {
  const { root, store, manager } = await fixture();
  const profile = await manager.create({ name: "迁移账号", accountLabel: null });
  await writeFile(join(profile.profileDir, "Local State"), "browser-state");
  const nextRoot = join(root, "迁移 目标");
  const result = await changeDefaultRoot(store, nextRoot, "migrate");
  const migrated = result.profiles.find((entry) => entry.profileId === profile.profileId);
  assert.equal(migrated?.profileDir.startsWith(resolve(nextRoot)), true);
  assert.equal(await readFile(join(migrated!.profileDir, "Local State"), "utf8"), "browser-state");
  assert.equal(await readFile(join(profile.profileDir, "Local State"), "utf8"), "browser-state");
});
