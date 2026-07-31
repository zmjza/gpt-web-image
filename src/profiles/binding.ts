import { resolve } from "node:path";
import { ProfileRegistryStore } from "./registry.js";

export interface TaskProfileBinding {
  profileId: string;
  profileDir: string;
  boundAt: string;
}

export async function bindActiveProfile(store: ProfileRegistryStore, now = new Date()): Promise<TaskProfileBinding> {
  const registry = await store.read();
  const active = registry.activeProfileId === null ? undefined : registry.profiles.find((profile) => profile.profileId === registry.activeProfileId && profile.active);
  if (!active) throw new Error("ACTIVE_PROFILE_REQUIRED");
  if (active.loginStatus !== "logged_in" || !["plus", "pro", "go"].includes(active.membership)) throw new Error("ACTIVE_PROFILE_INELIGIBLE");
  if (active.taskBusy || active.browserStatus === "task_busy") throw new Error("ACTIVE_PROFILE_BUSY");
  return { profileId: active.profileId, profileDir: resolve(active.profileDir), boundAt: now.toISOString() };
}
