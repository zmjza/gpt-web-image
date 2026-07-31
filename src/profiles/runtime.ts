import { dirname, join, resolve } from "node:path";
import { ensureOwnedProfile } from "../browser/profile.js";
import { ProfileManager } from "./manager.js";
import { ProfileRegistryStore } from "./registry.js";

export interface ProfileRuntime {
  store: ProfileRegistryStore;
  manager: ProfileManager;
  dataRoot: string;
}

export async function openProfileRuntime(legacyProfileDir: string, bootstrapLegacy = true): Promise<ProfileRuntime> {
  const normalizedLegacy = resolve(legacyProfileDir);
  const dataRoot = dirname(normalizedLegacy);
  const store = new ProfileRegistryStore(join(dataRoot, "profile-registry.json"), join(dataRoot, "profiles"));
  const manager = new ProfileManager(store);
  if (bootstrapLegacy) {
    const registry = await store.read();
    if (!registry.profiles.some((profile) => resolve(profile.profileDir) === normalizedLegacy)) {
      await ensureOwnedProfile(normalizedLegacy);
      await manager.importProfile({ name: registry.profiles.some((profile) => profile.name === "默认 Profile") ? "旧版 Profile" : "默认 Profile", accountLabel: null, profileDir: normalizedLegacy, source: "legacy" });
    }
  }
  return { store, manager, dataRoot };
}
