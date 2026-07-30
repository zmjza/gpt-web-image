import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { ProfileLock } from "./profile-lock.js";

const MARKER = ".gpt-web-image-profile.json";

export interface ProfileMarker { schemaVersion: "1"; owner: "gpt-web-image"; createdAt: string; }
export interface BrowserSession { context: BrowserContext; page: Page; mode: "headed" | "headless"; close(): Promise<void>; }
export interface LaunchProfileOptions { profileDir: string; executablePath: string; headed: boolean; url?: string; }

export function buildHeadedChromeArgs(profileDir: string, url: string, debugPort: number): string[] {
  return [
    `--user-data-dir=${resolve(profileDir)}`,
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${debugPort}`,
    "--no-first-run",
    "--no-default-browser-check",
    url
  ];
}

async function reserveLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("无法分配专用 Chrome 调试端口");
  await new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
  return address.port;
}

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

async function connectToHeadedChrome(profileDir: string, executablePath: string, url: string): Promise<{ browser: Browser; context: BrowserContext; page: Page; child: ChildProcess }> {
  const debugPort = await reserveLoopbackPort();
  const child = spawn(executablePath, buildHeadedChromeArgs(profileDir, url, debugPort), { stdio: "ignore" });
  let launchError: Error | null = null;
  child.once("error", (error) => { launchError = error; });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw new Error(`专用 Chrome 提前退出：${child.exitCode}`);
    try {
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { timeout: 500 });
      const context = browser.contexts()[0];
      if (!context) { await browser.close(); throw new Error("专用 Chrome 未创建默认上下文"); }
      const page = context.pages().find((candidate) => candidate.url() !== "about:blank") ?? context.pages()[0] ?? await context.newPage();
      return { browser, context, page, child };
    } catch { /* Chrome 尚未监听这个随机本机端口。 */ }
    await delay(100);
  }
  child.kill();
  throw new Error("专用 Chrome 启动超时");
}

export async function launchProfile(options: LaunchProfileOptions): Promise<BrowserSession> {
  await ensureOwnedProfile(options.profileDir);
  const lock = new ProfileLock(resolve(options.profileDir));
  await lock.acquire();
  try {
    if (options.headed) {
      const launched = await connectToHeadedChrome(options.profileDir, options.executablePath, options.url ?? "about:blank");
      let closed = false;
      return {
        context: launched.context,
        page: launched.page,
        mode: "headed",
        close: async () => {
          if (closed) return;
          closed = true;
          await launched.browser.close().catch(() => undefined);
          if (launched.child.exitCode === null) launched.child.kill();
          await lock.release();
        }
      };
    }
    const context = await chromium.launchPersistentContext(resolve(options.profileDir), {
      executablePath: options.executablePath,
      headless: !options.headed,
      chromiumSandbox: true,
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
