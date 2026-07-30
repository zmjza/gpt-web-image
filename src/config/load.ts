import { readFile } from "node:fs/promises";
import { validateConfig, DEFAULT_CONFIG, type Config } from "./schema.js";

export interface LoadConfigOptions {
  configPath?: string | undefined;
  overrides?: Partial<Config> | undefined;
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<Config> {
  let userConfig: unknown = {};
  if (options.configPath) {
    userConfig = JSON.parse(await readFile(options.configPath, "utf8")) as unknown;
  }
  return validateConfig({ ...DEFAULT_CONFIG, ...(userConfig as object), ...(options.overrides ?? {}) });
}
