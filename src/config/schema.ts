export interface Config {
  schemaVersion: "1";
  chromeExecutablePath: string | null;
  profileDir: string;
  fallbackOutputDir: string;
  defaultImageCount: number;
  maxSupplementRounds: number;
  pageReadyTimeoutMs: number;
  inactivityTimeoutMs: number;
  hardTimeoutMs: number;
  stabilityWindowMs: number;
  diagnosticRetentionDays: number;
  normalBrowserMode: "headless";
}

function defaultProfileDir(): string {
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "gpt-web-image", "chrome-profile");
  }
  return join(homedir(), "Library", "Application Support", "gpt-web-image", "chrome-profile");
}

function defaultOutputDir(): string {
  return join(homedir(), "Pictures", "gpt-web-images");
}

export const DEFAULT_CONFIG: Config = Object.freeze({
  schemaVersion: "1",
  chromeExecutablePath: null,
  profileDir: defaultProfileDir(),
  fallbackOutputDir: defaultOutputDir(),
  defaultImageCount: 1,
  maxSupplementRounds: 3,
  pageReadyTimeoutMs: 60000,
  inactivityTimeoutMs: 240000,
  hardTimeoutMs: 1200000,
  stabilityWindowMs: 1500,
  diagnosticRetentionDays: 7,
  normalBrowserMode: "headless"
});

const REQUIRED_KEYS = new Set(Object.keys(DEFAULT_CONFIG));
const SENSITIVE_KEYS = new Set(["password", "cookie", "cookies", "token", "authorization", "headers", "authHeader"]);

export function validateConfig(input: unknown): Config {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("配置必须是对象");
  }
  const value = input as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) throw new Error(`配置禁止包含敏感字段：${key}`);
    if (!REQUIRED_KEYS.has(key)) throw new Error(`未知配置字段：${key}`);
  }
  const merged = { ...DEFAULT_CONFIG, ...value } as Record<string, unknown>;
  if (merged.schemaVersion !== "1") throw new Error("不支持的配置版本");
  if (merged.chromeExecutablePath !== null && typeof merged.chromeExecutablePath !== "string") throw new Error("chromeExecutablePath 无效");
  for (const key of ["profileDir", "fallbackOutputDir"]) {
    if (typeof merged[key] !== "string") throw new Error(`${key} 必须是字符串`);
  }
  for (const key of ["defaultImageCount", "maxSupplementRounds", "pageReadyTimeoutMs", "inactivityTimeoutMs", "hardTimeoutMs", "stabilityWindowMs", "diagnosticRetentionDays"]) {
    const numberValue = merged[key];
    if (typeof numberValue !== "number" || !Number.isInteger(numberValue) || numberValue < 0) throw new Error(`${key} 必须是非负整数`);
  }
  if ((merged.defaultImageCount as number) < 1 || (merged.defaultImageCount as number) > 10) throw new Error("defaultImageCount 必须在 1 到 10 之间");
  if ((merged.maxSupplementRounds as number) > 3) throw new Error("maxSupplementRounds 不能超过 3");
  if (merged.normalBrowserMode !== "headless") throw new Error("normalBrowserMode 首版必须为 headless");
  return merged as unknown as Config;
}
import { homedir } from "node:os";
import { join } from "node:path";
