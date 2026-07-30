import { arch, platform } from "node:process";
import { inspectChrome, isWritableDirectory, type ChromeOptions } from "../platform/chrome.js";

export interface DoctorOptions extends ChromeOptions {
  profileDir: string;
  outputDir: string;
}

export interface DoctorReport {
  node: { version: string; platform: string; arch: string };
  chrome: ReturnType<typeof inspectChrome>;
  profile: { path: string; writable: boolean };
  output: { path: string; writable: boolean };
}

export function runDoctor(options: DoctorOptions): DoctorReport {
  return {
    node: { version: process.version, platform: options.platform ?? platform, arch },
    chrome: inspectChrome(options),
    profile: { path: options.profileDir, writable: isWritableDirectory(options.profileDir) },
    output: { path: options.outputDir, writable: isWritableDirectory(options.outputDir) }
  };
}
