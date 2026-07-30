import { accessSync, constants, existsSync } from "node:fs";
import { join } from "node:path";

export interface ChromeInspection {
  available: boolean;
  path: string | null;
  reason: "configured_path_missing" | "not_found" | "available";
}

export interface ChromeOptions {
  platform?: NodeJS.Platform | undefined;
  configuredPath?: string | undefined;
}

function candidates(platform: NodeJS.Platform): string[] {
  if (platform === "darwin") return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome Stable"];
  if (platform === "win32") {
    const programFiles = process.env.PROGRAMFILES ?? "C:\\Program Files";
    const localAppData = process.env.LOCALAPPDATA ?? "C:\\Users\\Public\\AppData\\Local";
    return [join(programFiles, "Google/Chrome/Application/chrome.exe"), join(localAppData, "Google/Chrome/Application/chrome.exe")];
  }
  return [];
}

export function inspectChrome(options: ChromeOptions = {}): ChromeInspection {
  const configuredPath = options.configuredPath;
  if (configuredPath) {
    if (existsSync(configuredPath)) return { available: true, path: configuredPath, reason: "available" };
    return { available: false, path: configuredPath, reason: "configured_path_missing" };
  }
  for (const candidate of candidates(options.platform ?? process.platform)) {
    if (existsSync(candidate)) return { available: true, path: candidate, reason: "available" };
  }
  return { available: false, path: null, reason: "not_found" };
}

export function isWritableDirectory(path: string): boolean {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
