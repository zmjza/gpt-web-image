import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { ProfileLock } from "./profile-lock.js";

const MARKER = ".gpt-web-image-profile.json";
export const PROFILE_RETENTION_POLICY = "never-auto-delete" as const;

export interface ProfileMarker {
  schemaVersion: "1";
  owner: "gpt-web-image";
  createdAt: string;
  profileDir: string;
  retentionPolicy: typeof PROFILE_RETENTION_POLICY;
}
export interface BrowserSession { context: BrowserContext; page: Page; mode: "headed" | "headless"; close(): Promise<void>; }
export interface LaunchProfileOptions { profileDir: string; executablePath: string; headed: boolean; url?: string; }

export function buildHeadedChromeArgs(profileDir: string, url: string, debugPort: number, minimized = false): string[] {
  return [
    `--user-data-dir=${resolve(profileDir)}`,
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${debugPort}`,
    "--no-first-run",
    "--no-default-browser-check",
    ...(minimized ? ["--start-minimized"] : []),
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
    if (marker.profileDir !== undefined && resolve(marker.profileDir) !== directory) throw new Error("Profile 路径与归属标记不一致");
    if (marker.retentionPolicy !== undefined && marker.retentionPolicy !== PROFILE_RETENTION_POLICY) throw new Error("Profile 保留策略无效");
    const normalized: ProfileMarker = {
      schemaVersion: "1",
      owner: "gpt-web-image",
      createdAt: marker.createdAt,
      profileDir: directory,
      retentionPolicy: PROFILE_RETENTION_POLICY
    };
    if (marker.profileDir !== directory || marker.retentionPolicy !== PROFILE_RETENTION_POLICY) {
      // 仅升级本项目自己的元数据标记，不触碰 Chrome Profile 内容。
      await writeFile(markerPath, `${JSON.stringify(normalized, null, 2)}\n`);
    }
    return normalized;
  } catch (error) {
    const entries = (await readdir(directory)).filter((entry) => entry !== ".gpt-web-image.lock");
    if (entries.length > 0) throw new Error(`拒绝使用非本项目 Profile：${error instanceof Error ? error.message : String(error)}`);
    const marker: ProfileMarker = {
      schemaVersion: "1",
      owner: "gpt-web-image",
      createdAt: new Date().toISOString(),
      profileDir: directory,
      retentionPolicy: PROFILE_RETENTION_POLICY
    };
    await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`, { flag: "wx" });
    return marker;
  }
}

async function connectToChrome(profileDir: string, executablePath: string, url: string, minimized: boolean): Promise<{ browser: Browser; context: BrowserContext; page: Page; child: ChildProcess }> {
  const debugPort = await reserveLoopbackPort();
  const child = spawn(executablePath, buildHeadedChromeArgs(profileDir, url, debugPort, minimized), { stdio: "ignore" });
  let launchError: Error | null = null;
  child.once("error", (error) => { launchError = error; });
  // Windows runners can start several isolated Chrome processes concurrently;
  // allow the browser enough time to create its profile and bind CDP.
  const startupTimeoutMs = Number(process.env.GWI_CHROME_START_TIMEOUT_MS ?? 60_000);
  const deadline = Date.now() + (Number.isFinite(startupTimeoutMs) && startupTimeoutMs > 0 ? startupTimeoutMs : 60_000);
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

async function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise<boolean>((resolvePromise) => {
    const timer = setTimeout(() => { child.removeListener("exit", onExit); resolvePromise(false); }, timeoutMs);
    const onExit = () => { clearTimeout(timer); resolvePromise(true); };
    child.once("exit", onExit);
  });
}

async function closeConnectedChrome(browser: Browser, child: ChildProcess): Promise<void> {
  await browser.close().catch(() => undefined);
  if (await waitForChildExit(child, 3000)) return;
  child.kill();
  await waitForChildExit(child, 1000);
}

export async function launchProfile(options: LaunchProfileOptions): Promise<BrowserSession> {
  await ensureOwnedProfile(options.profileDir);
  const lock = new ProfileLock(resolve(options.profileDir));
  await lock.acquire();
  try {
    const launched = await connectToChrome(options.profileDir, options.executablePath, options.url ?? "about:blank", !options.headed);
    const targetUrl = options.url ?? "about:blank";
    if (targetUrl !== "about:blank" && launched.page.url() !== targetUrl) {
      await launched.page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => undefined);
    }
    let closed = false;
    return {
      context: launched.context,
      page: launched.page,
      mode: options.headed ? "headed" : "headless",
      close: async () => {
        if (closed) return;
        closed = true;
        await closeConnectedChrome(launched.browser, launched.child);
        await lock.release();
      }
    };
  } catch (error) {
    await lock.release();
    throw error;
  }
}
