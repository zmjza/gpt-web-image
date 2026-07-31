export const PROFILE_REGISTRY_SCHEMA_VERSION = "1" as const;
export const PROFILE_RETENTION_POLICY = "never-auto-delete" as const;

export type LoginStatus = "checking" | "logged_in" | "needs_login" | "verification_required" | "technical_failure";
export type Membership = "plus" | "pro" | "go" | "other" | "technical_failure";
export type BrowserStatus = "closed" | "open" | "task_busy" | "unknown";

export interface ProfileRecord {
  profileId: string;
  name: string;
  accountLabel: string | null;
  notes: string | null;
  profileDir: string;
  source: "legacy" | "created" | "imported" | "restored" | "discovered";
  active: boolean;
  retentionPolicy: typeof PROFILE_RETENTION_POLICY;
  loginStatus: LoginStatus;
  membership: Membership;
  browserStatus: BrowserStatus;
  taskBusy: boolean;
  createdAt: string;
  updatedAt: string;
  lastCheckedAt: string | null;
  lastOpenedAt: string | null;
}

export interface ProfileRegistry {
  schemaVersion: typeof PROFILE_REGISTRY_SCHEMA_VERSION;
  defaultRootDir: string;
  retainedRoots: string[];
  activeProfileId: string | null;
  profiles: ProfileRecord[];
  updatedAt: string;
}

export interface EligibilityResult {
  login: "logged_in" | "needs_login" | "verification_required" | "technical_failure";
  membership: Membership;
  evidenceKinds: string[];
  checkedAt: string;
  eligible: boolean;
}
