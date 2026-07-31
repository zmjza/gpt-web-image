import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createTaskRecord } from "../../src/tasks/model.js";
import { readTaskRecord } from "../../src/persistence/task-store.js";
import { ProfileRegistryStore } from "../../src/profiles/registry.js";
import { ProfileManager } from "../../src/profiles/manager.js";
import { bindActiveProfile } from "../../src/profiles/binding.js";

test("T50 stores an immutable active Profile path snapshot on a new task", async () => {
  const root = await mkdtemp(join(tmpdir(), "gpt-web-image-binding-"));
  const store = new ProfileRegistryStore(join(root, "registry.json"), join(root, "profiles"));
  const manager = new ProfileManager(store);
  const profile = await manager.create({ name: "主账号", accountLabel: null });
  await manager.activate(profile.profileId, async () => ({ login: "logged_in", membership: "plus", evidenceKinds: ["fixture"], checkedAt: new Date().toISOString(), eligible: true }));
  const binding = await bindActiveProfile(store, new Date("2026-07-31T00:00:00Z"));
  const task = createTaskRecord({ prompt: "测试" }, "bound_task", new Date("2026-07-31T00:00:01Z"), binding);
  assert.deepEqual(task.profileBinding, { profileId: profile.profileId, profileDir: resolve(profile.profileDir), boundAt: "2026-07-31T00:00:00.000Z" });
});

test("T50 refuses binding when no eligible active Profile exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "gpt-web-image-binding-"));
  const store = new ProfileRegistryStore(join(root, "registry.json"), join(root, "profiles"));
  await assert.rejects(() => bindActiveProfile(store), /ACTIVE_PROFILE_REQUIRED/);
});

test("T50 reads legacy tasks as explicitly unbound without inventing a Profile", async () => {
  const root = await mkdtemp(join(tmpdir(), "gpt-web-image-binding-"));
  const path = join(root, "task.json");
  const task = createTaskRecord({ prompt: "旧任务" }, "legacy_task");
  const { profileBinding: _removed, ...legacy } = task;
  await writeFile(path, JSON.stringify(legacy));
  assert.equal((await readTaskRecord(path)).profileBinding, null);
});
