import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { PROFILE_RETENTION_POLICY, type EligibilityResult, type ProfileRecord, type ProfileRegistry } from "./types.js";
import { ProfileRegistryStore } from "./registry.js";

const MARKER = ".gpt-web-image-profile.json";

export class ProfileManagerError extends Error {
  public constructor(public readonly code: string, message = code) {
    super(`${code}: ${message}`);
  }
}

interface CreateProfileInput {
  name: string;
  accountLabel: string | null;
  notes?: string | null;
  profileDir?: string;
  source?: ProfileRecord["source"];
}

interface ImportProfileInput {
  name: string;
  accountLabel: string | null;
  notes?: string | null;
  profileDir: string;
  source?: ProfileRecord["source"];
}

async function writeOwnedMarker(profileDir: string, createdAt: string): Promise<void> {
  await writeFile(join(profileDir, MARKER), `${JSON.stringify({
    schemaVersion: "1",
    owner: "gpt-web-image",
    createdAt,
    profileDir,
    retentionPolicy: PROFILE_RETENTION_POLICY
  }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
}

async function verifyOwnedDirectory(profileDir: string): Promise<void> {
  const directory = resolve(profileDir);
  try {
    const marker = JSON.parse(await readFile(join(directory, MARKER), "utf8")) as Record<string, unknown>;
    if (
      marker.schemaVersion !== "1" || marker.owner !== "gpt-web-image" ||
      marker.retentionPolicy !== PROFILE_RETENTION_POLICY ||
      typeof marker.profileDir !== "string" || resolve(marker.profileDir) !== directory
    ) throw new Error("marker mismatch");
    await access(directory, constants.R_OK | constants.W_OK);
  } catch {
    throw new ProfileManagerError("NOT_OWNED", "目录不是本项目专用 Profile");
  }
}

function validateName(name: string): string {
  const normalized = name.trim();
  if (!normalized || normalized.length > 80) throw new ProfileManagerError("INVALID_NAME", "名称长度必须为 1-80 个字符");
  return normalized;
}

function createRecord(input: CreateProfileInput, profileId: string, profileDir: string, now: string): ProfileRecord {
  return {
    profileId,
    name: validateName(input.name),
    accountLabel: input.accountLabel,
    notes: input.notes ?? null,
    profileDir,
    source: input.source ?? "created",
    active: false,
    retentionPolicy: PROFILE_RETENTION_POLICY,
    loginStatus: "checking",
    membership: "technical_failure",
    browserStatus: "closed",
    taskBusy: false,
    createdAt: now,
    updatedAt: now,
    lastCheckedAt: null,
    lastOpenedAt: null
  };
}

export class ProfileManager {
  private readonly deleteConfirmations = new Map<string, { profileId: string; expiresAt: number }>();

  public constructor(public readonly store: ProfileRegistryStore) {}

  public list(): Promise<ProfileRegistry> { return this.store.read(); }

  public async get(profileId: string): Promise<ProfileRecord> {
    const profile = (await this.store.read()).profiles.find((entry) => entry.profileId === profileId);
    if (!profile) throw new ProfileManagerError("PROFILE_NOT_FOUND");
    return profile;
  }

  public async create(input: CreateProfileInput): Promise<ProfileRecord> {
    const profileId = randomUUID();
    const registry = await this.store.read();
    const profileDir = resolve(input.profileDir ?? join(registry.defaultRootDir, profileId));
    if (registry.profiles.some((profile) => resolve(profile.profileDir) === profileDir)) throw new ProfileManagerError("PATH_CONFLICT");
    await mkdir(profileDir, { recursive: true });
    const entries = await readdir(profileDir);
    if (entries.length > 0) throw new ProfileManagerError("PATH_CONFLICT", "新 Profile 目录必须为空");
    const now = new Date().toISOString();
    await writeOwnedMarker(profileDir, now);
    const record = createRecord(input, profileId, profileDir, now);
    try {
      await this.store.transaction((current) => {
        if (current.profiles.some((profile) => profile.name === record.name)) throw new ProfileManagerError("NAME_CONFLICT");
        return { ...current, profiles: [...current.profiles, record] };
      });
      return record;
    } catch (error) {
      await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  public async importProfile(input: ImportProfileInput): Promise<ProfileRecord> {
    const profileDir = resolve(input.profileDir);
    await verifyOwnedDirectory(profileDir);
    const profileId = randomUUID();
    const now = new Date().toISOString();
    const record = createRecord({ ...input, source: input.source ?? "imported" }, profileId, profileDir, now);
    await this.store.transaction((registry) => {
      if (registry.profiles.some((profile) => resolve(profile.profileDir) === profileDir)) throw new ProfileManagerError("PATH_CONFLICT");
      if (registry.profiles.some((profile) => profile.name === record.name)) throw new ProfileManagerError("NAME_CONFLICT");
      return { ...registry, profiles: [...registry.profiles, record] };
    });
    return record;
  }

  public async update(profileId: string, input: { name?: string; accountLabel?: string | null; notes?: string | null }): Promise<ProfileRecord> {
    let updated: ProfileRecord | undefined;
    const requestedName = input.name === undefined ? undefined : validateName(input.name);
    await this.store.transaction((registry) => {
      if (requestedName && registry.profiles.some((profile) => profile.profileId !== profileId && profile.name === requestedName)) throw new ProfileManagerError("NAME_CONFLICT");
      const profiles = registry.profiles.map((profile) => {
        if (profile.profileId !== profileId) return profile;
        updated = { ...profile, ...(requestedName !== undefined ? { name: requestedName } : {}), ...(input.accountLabel !== undefined ? { accountLabel: input.accountLabel } : {}), ...(input.notes !== undefined ? { notes: input.notes } : {}), updatedAt: new Date().toISOString() };
        return updated;
      });
      if (!updated) throw new ProfileManagerError("PROFILE_NOT_FOUND");
      return { ...registry, profiles };
    });
    return updated as ProfileRecord;
  }

  public async activate(profileId: string, check: (profile: ProfileRecord) => Promise<EligibilityResult>): Promise<ProfileRecord> {
    const registry = await this.store.read();
    const selected = registry.profiles.find((profile) => profile.profileId === profileId);
    if (!selected) throw new ProfileManagerError("PROFILE_NOT_FOUND");
    await verifyOwnedDirectory(selected.profileDir);
    if (selected.taskBusy || selected.browserStatus === "task_busy") throw new ProfileManagerError("PROFILE_BUSY");
    const eligibility = await check(selected);
    if (eligibility.login === "needs_login") throw new ProfileManagerError("LOGIN_REQUIRED");
    if (eligibility.login === "verification_required") throw new ProfileManagerError("VERIFICATION_REQUIRED");
    if (eligibility.login === "technical_failure") throw new ProfileManagerError("ELIGIBILITY_CHECK_FAILED");
    if (!eligibility.eligible || !["plus", "pro", "go"].includes(eligibility.membership)) throw new ProfileManagerError("MEMBERSHIP_INELIGIBLE");
    let activated: ProfileRecord | undefined;
    await this.store.transaction((current) => {
      if (!current.profiles.some((profile) => profile.profileId === profileId)) throw new ProfileManagerError("PROFILE_NOT_FOUND");
      const profiles = current.profiles.map((profile) => {
        const active = profile.profileId === profileId;
        const next = active ? { ...profile, active, loginStatus: "logged_in" as const, membership: eligibility.membership, lastCheckedAt: eligibility.checkedAt, updatedAt: eligibility.checkedAt } : { ...profile, active };
        if (active) activated = next;
        return next;
      });
      return { ...current, activeProfileId: profileId, profiles };
    });
    return activated as ProfileRecord;
  }

  public async recordEligibility(profileId: string, result: EligibilityResult): Promise<ProfileRecord> {
    let updated: ProfileRecord | undefined;
    await this.store.transaction((registry) => {
      const profiles = registry.profiles.map((profile) => {
        if (profile.profileId !== profileId) return profile;
        updated = { ...profile, loginStatus: result.login, membership: result.membership, lastCheckedAt: result.checkedAt, updatedAt: result.checkedAt };
        return updated;
      });
      if (!updated) throw new ProfileManagerError("PROFILE_NOT_FOUND");
      return { ...registry, profiles };
    });
    return updated as ProfileRecord;
  }

  public async setBrowserStatus(profileId: string, browserStatus: ProfileRecord["browserStatus"]): Promise<ProfileRecord> {
    let updated: ProfileRecord | undefined;
    const now = new Date().toISOString();
    await this.store.transaction((registry) => {
      const profiles = registry.profiles.map((profile) => {
        if (profile.profileId !== profileId) return profile;
        updated = { ...profile, browserStatus, updatedAt: now, ...(browserStatus === "open" ? { lastOpenedAt: now } : {}) };
        return updated;
      });
      if (!updated) throw new ProfileManagerError("PROFILE_NOT_FOUND");
      return { ...registry, profiles };
    });
    return updated as ProfileRecord;
  }

  public issueDeleteConfirmation(profileId: string, source: "page" | "automation"): string {
    if (source !== "page") throw new ProfileManagerError("DELETE_CONFIRMATION_FORBIDDEN");
    const token = randomUUID();
    this.deleteConfirmations.set(token, { profileId, expiresAt: Date.now() + 120_000 });
    return token;
  }

  public async deleteProfile(profileId: string, confirmation: string | null): Promise<void> {
    if (!confirmation) throw new ProfileManagerError("DELETE_CONFIRMATION_REQUIRED");
    const issued = this.deleteConfirmations.get(confirmation);
    this.deleteConfirmations.delete(confirmation);
    if (!issued || issued.profileId !== profileId || issued.expiresAt < Date.now()) throw new ProfileManagerError("DELETE_CONFIRMATION_INVALID");
    const registry = await this.store.read();
    const profile = registry.profiles.find((entry) => entry.profileId === profileId);
    if (!profile) throw new ProfileManagerError("PROFILE_NOT_FOUND");
    if (profile.active) throw new ProfileManagerError("ACTIVE_PROFILE");
    if (profile.taskBusy || profile.browserStatus !== "closed") throw new ProfileManagerError("PROFILE_BUSY");
    await verifyOwnedDirectory(profile.profileDir);
    const stagedDirectory = join(dirname(profile.profileDir), `.gpt-web-image-deleting-${profile.profileId}-${randomUUID()}`);
    await rename(profile.profileDir, stagedDirectory);
    try {
      await this.store.transaction((current) => ({ ...current, profiles: current.profiles.filter((entry) => entry.profileId !== profileId) }));
    } catch (error) {
      await rename(stagedDirectory, profile.profileDir).catch(() => undefined);
      throw error;
    }
    try {
      await rm(stagedDirectory, { recursive: true });
    } catch (error) {
      const restored = await rename(stagedDirectory, profile.profileDir).then(() => true).catch(() => false);
      if (restored) {
        await this.store.transaction((current) => current.profiles.some((entry) => entry.profileId === profileId)
          ? current
          : { ...current, profiles: [...current.profiles, profile] });
      }
      throw new ProfileManagerError("PROFILE_DELETE_FAILED", restored ? "物理删除失败，Profile 已恢复" : "物理删除失败，删除目录已隔离");
    }
  }
}

export async function assertOwnedProfile(profileDir: string): Promise<void> {
  await verifyOwnedDirectory(profileDir);
}

export function suggestedProfileName(profileDir: string): string {
  return basename(resolve(profileDir));
}
