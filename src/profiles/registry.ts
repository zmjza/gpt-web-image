import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  PROFILE_REGISTRY_SCHEMA_VERSION,
  PROFILE_RETENTION_POLICY,
  type ProfileRecord,
  type ProfileRegistry
} from "./types.js";

const SENSITIVE_FIELD = /^(?:cookie|cookies|token|accessToken|refreshToken|password|authorization|authHeader|secret)$/i;

function defaultRegistry(defaultRootDir: string): ProfileRegistry {
  return {
    schemaVersion: PROFILE_REGISTRY_SCHEMA_VERSION,
    defaultRootDir,
    retainedRoots: [],
    activeProfileId: null,
    profiles: [],
    updatedAt: new Date().toISOString()
  };
}

function rejectSensitiveFields(value: unknown, path = "registry"): void {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_FIELD.test(key)) throw new Error(`注册表包含敏感字段：${path}.${key}`);
    rejectSensitiveFields(nested, `${path}.${key}`);
  }
}

function isStringOrNull(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function parseProfile(value: unknown): ProfileRecord {
  if (!value || typeof value !== "object") throw new Error("Profile 记录无效");
  const item = value as Partial<ProfileRecord>;
  if (
    typeof item.profileId !== "string" || !item.profileId ||
    typeof item.name !== "string" || !item.name.trim() ||
    typeof item.profileDir !== "string" || !item.profileDir ||
    !isStringOrNull(item.accountLabel) || !isStringOrNull(item.notes) ||
    typeof item.active !== "boolean" || item.retentionPolicy !== PROFILE_RETENTION_POLICY ||
    typeof item.createdAt !== "string" || typeof item.updatedAt !== "string"
  ) throw new Error("Profile 记录字段无效");
  return item as ProfileRecord;
}

function parseRegistry(value: unknown): ProfileRegistry {
  rejectSensitiveFields(value);
  if (!value || typeof value !== "object") throw new Error("Profile 注册表无效");
  const raw = value as Partial<ProfileRegistry>;
  if (
    raw.schemaVersion !== PROFILE_REGISTRY_SCHEMA_VERSION ||
    typeof raw.defaultRootDir !== "string" ||
    !Array.isArray(raw.retainedRoots) || !raw.retainedRoots.every((entry) => typeof entry === "string") ||
    !Array.isArray(raw.profiles) ||
    !isStringOrNull(raw.activeProfileId) ||
    typeof raw.updatedAt !== "string"
  ) throw new Error("Profile 注册表字段无效");
  const profiles = raw.profiles.map(parseProfile);
  const ids = new Set(profiles.map((profile) => profile.profileId));
  if (ids.size !== profiles.length) throw new Error("Profile ID 重复");
  const active = profiles.filter((profile) => profile.active);
  if (active.length > 1) throw new Error("Profile 注册表存在多个启用项");
  if ((raw.activeProfileId === null) !== (active.length === 0)) throw new Error("Profile 启用状态不一致");
  if (raw.activeProfileId && active[0]?.profileId !== raw.activeProfileId) throw new Error("Profile 启用 ID 不一致");
  return { ...raw, defaultRootDir: resolve(raw.defaultRootDir), retainedRoots: raw.retainedRoots.map((entry) => resolve(entry)), profiles } as ProfileRegistry;
}

async function atomicWrite(path: string, value: ProfileRegistry): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export class ProfileRegistryStore {
  public readonly registryPath: string;
  public readonly defaultRootDir: string;
  private transactionTail: Promise<void> = Promise.resolve();

  public constructor(registryPath: string, defaultRootDir: string) {
    this.registryPath = resolve(registryPath);
    this.defaultRootDir = resolve(defaultRootDir);
  }

  public async read(): Promise<ProfileRegistry> {
    try {
      return parseRegistry(JSON.parse(await readFile(this.registryPath, "utf8")) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultRegistry(this.defaultRootDir);
      throw error;
    }
  }

  public async write(registry: ProfileRegistry): Promise<void> {
    const parsed = parseRegistry(registry);
    await atomicWrite(this.registryPath, parsed);
  }

  public async transaction(update: (registry: ProfileRegistry) => ProfileRegistry | Promise<ProfileRegistry>): Promise<ProfileRegistry> {
    let result: ProfileRegistry | undefined;
    const operation = this.transactionTail.then(async () => {
      const next = await update(await this.read());
      next.updatedAt = new Date().toISOString();
      await this.write(next);
      result = next;
    });
    this.transactionTail = operation.catch(() => undefined);
    await operation;
    if (!result) throw new Error("Profile 注册表事务未产生结果");
    return result;
  }
}
