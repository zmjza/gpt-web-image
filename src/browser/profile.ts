import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { ProfileLock } from "./profile-lock.js";

const MARKER = ".gpt-web-image-profile.json";

export interface ProfileMarker { schemaVersion: "1"; owner: "gpt-web-image"; createdAt: string; }
export interface BrowserSession { context: BrowserContext; page: Page; mode: "headed" | "headless"; close(): Promise<void>; }
export interface LaunchProfileOptions { profileDir: string; executablePath: string; headed: boolean; url?: string; }

export function profileMarkerPath(profileDir: string): string { return join(resolve(profileDir), MARKER); }

export async function ensureOwnedProfile(profileDir: string): Promise<ProfileMarker> {
  const directory = resolve(profileDir);
  await mkdir(directory, { recursive: true });
  const markerPath = profileMarkerPath(directory);
  try {
    const marker = JSON.parse(await readFile(markerPath, "utf8")) as Partial<ProfileMarker>;
    if (marker.schemaVersion !== "1" || marker.owner !== "gpt-web-image" || typeof marker.createdAt !== "string") throw new Error("Profile 归属标记无效");
    return marker as ProfileMarker;
  } catch (error) {
    const entries = (await readdir(directory)).filter((entry) => entry !== ".gpt-web-image.lock");
    if (entries.length > 0) throw new Error(`拒绝使用非本项目 Profile：${error instanceof Error ? error.message : String(error)}`);
    const marker: ProfileMarker = { schemaVersion: "1", owner: "gpt-web-image", createdAt: new Date().toISOString() };
    await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`, { flag: "wx" });
    return marker;
  }
}

export async function launchProfile(options: LaunchProfileOptions): Promise<BrowserSession> {
  await ensureOwnedProfile(options.profileDir);
  const lock = new ProfileLock(resolve(options.profileDir));
  await lock.acquire();
  try {
    const context = await chromium.launchPersistentContext(resolve(options.profileDir), {
      executablePath: options.executablePath,
      headless: !options.headed,
      acceptDownloads: true,
      args: ["--no-first-run", "--no-default-browser-check"]
    });
    const page = context.pages()[0] ?? await context.newPage();
    if (options.url) await page.goto(options.url, { waitUntil: "domcontentloaded" });
    let closed = false;
    return {
      context, page, mode: options.headed ? "headed" : "headless",
      close: async () => {
        if (closed) return;
        closed = true;
        await context.close().finally(() => lock.release());
      }
    };
  } catch (error) {
    await lock.release();
    throw error;
  }
}
