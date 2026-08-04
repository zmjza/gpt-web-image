#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type { Page } from "playwright-core";
import { loadConfig } from "../config/load.js";
import { inspectChrome } from "../platform/chrome.js";
import { launchProfile, type BrowserSession } from "../browser/profile.js";
import { BrowserLease } from "../browser/browser-lease.js";
import { classifyLoginPage, readLoginPageSignals, waitForAutomatedComposer } from "../browser/login.js";
import { evaluateEligibility, readMembershipSignals } from "../browser/membership.js";
import { scanDefaultRoot } from "../profiles/directories.js";
import { changeDefaultRoot, planDefaultRootChange, type DirectoryChangeMode } from "../profiles/migration.js";
import { createBackup, listBackups, restoreBackup, type BackupRecord } from "../profiles/backup.js";
import { ProfileManagerError } from "../profiles/manager.js";
import { openProfileRuntime, type ProfileRuntime } from "../profiles/runtime.js";
import type { EligibilityResult, ProfileRecord } from "../profiles/types.js";
import { readImageIndex, writeImageIndex } from "../images/manager-index-store.js";
import { IMAGE_GENERATION_TYPES, IMAGE_GROUPS, IMAGE_SORTS, IMAGE_STATUSES, type ImageFilter, type ImageGroupBy, type ImageOrientation, type ImageSort } from "../images/manager-model.js";
import { queryImages } from "../images/manager-query.js";
import { scanImageIndex } from "../images/manager-scanner.js";
import { createManagerThumbnail } from "../images/manager-thumbnail.js";
import { getIndexedImageDetails, resolveIndexedImageSource } from "../images/manager-files.js";

const HOST = "127.0.0.1";
const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"], [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"], [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".webp", "image/webp"], [".svg", "image/svg+xml"]
]);
const PROFILE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const IMAGE_ID = /^[a-f0-9]{64}$/;
const SENSITIVE_KEY = /^(?:cookie|cookies|token|accessToken|refreshToken|password|authorization|headers|authHeader|secret)$/i;

export interface ManagerBrowserController {
  check(profile: ProfileRecord): Promise<EligibilityResult>;
  open(profile: ProfileRecord): Promise<void>;
  close(profile: ProfileRecord): Promise<void>;
  closeAll(): Promise<void>;
}

export interface StartManagerServerOptions {
  runtime: ProfileRuntime;
  outputRoot: string;
  backupRoot: string;
  browser?: ManagerBrowserController;
  chromeExecutablePath?: string | null;
  publicRoot?: string;
  port?: number;
}

export interface RunningManagerServer {
  host: typeof HOST;
  port: number;
  url: string;
  close(): Promise<void>;
}

export async function readBrowserEligibility(page: Page, timeoutMs = 15_000): Promise<EligibilityResult> {
  try {
    await waitForAutomatedComposer(page, timeoutMs);
  } catch {
    const login = classifyLoginPage(await readLoginPageSignals(page));
    return evaluateEligibility({
      login: login === "needs_login" ? "needs_login" : login === "needs_human_verification" ? "verification_required" : "technical_failure",
      visibleTexts: [],
      imageGenerationAvailable: null
    });
  }
  const membership = await readMembershipSignals(page);
  return evaluateEligibility({ ...membership, login: "logged_in" });
}

class HttpError extends Error {
  public constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}

function rejectSensitive(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(key)) throw new HttpError(400, "SENSITIVE_FIELD_REJECTED", "请求包含禁止字段");
    rejectSensitive(nested);
  }
}

function objectBody(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  rejectSensitive(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "INVALID_BODY", "请求正文必须是对象");
  const body = value as Record<string, unknown>;
  for (const key of Object.keys(body)) if (!allowed.includes(key)) throw new HttpError(400, "UNKNOWN_FIELD", `请求字段不受支持：${key}`);
  return body;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, "INVALID_INPUT", `${name} 不能为空`);
  return value.trim();
}

function nullableString(value: unknown, name: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new HttpError(400, "INVALID_INPUT", `${name} 必须是字符串`);
  return value.trim() || null;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1024 * 1024) throw new HttpError(413, "BODY_TOO_LARGE", "请求正文过大");
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { throw new HttpError(400, "INVALID_JSON", "请求正文不是有效 JSON"); }
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), "X-Content-Type-Options": "nosniff" });
  response.end(body);
}

function profileView(profile: ProfileRecord): ProfileRecord {
  return { ...profile };
}

function errorStatus(code: string): number {
  if (["PROFILE_NOT_FOUND", "IMAGE_NOT_FOUND", "BACKUP_NOT_FOUND"].includes(code)) return 404;
  if (["LOGIN_REQUIRED", "VERIFICATION_REQUIRED"].includes(code)) return 409;
  if (["ACTIVE_PROFILE", "PROFILE_BUSY", "BROWSER_BUSY", "BROWSER_LEASED", "PATH_CONFLICT", "NAME_CONFLICT", "DELETE_CONFIRMATION_REQUIRED", "DELETE_CONFIRMATION_INVALID", "DIRECTORY_CONFLICT", "INDEX_BUSY"].includes(code)) return 409;
  if (["NOT_OWNED", "MEMBERSHIP_INELIGIBLE", "ELIGIBILITY_CHECK_FAILED", "PROFILE_SCOPE_VIOLATION", "IMAGE_MISSING", "IMAGE_CORRUPT", "IMAGE_UNAVAILABLE", "BACKUP_INVALID"].includes(code)) return 422;
  return 400;
}

function errorCode(error: unknown): string {
  if (error instanceof HttpError || error instanceof ProfileManagerError) return error.code;
  if (error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string") return (error as { code: string }).code;
  const message = error instanceof Error ? error.message : String(error);
  return (message.split(":", 1)[0] ?? "").replace(/[^A-Z0-9_]/g, "") || "INTERNAL_ERROR";
}

function safeError(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof HttpError) return { status: error.status, code: error.code, message: error.message };
  const code = errorCode(error);
  const known = new Set(["PROFILE_NOT_FOUND", "NOT_OWNED", "PATH_CONFLICT", "NAME_CONFLICT", "LOGIN_REQUIRED", "VERIFICATION_REQUIRED", "MEMBERSHIP_INELIGIBLE", "ELIGIBILITY_CHECK_FAILED", "PROFILE_BUSY", "ACTIVE_PROFILE", "PROFILE_DELETE_FAILED", "DELETE_CONFIRMATION_REQUIRED", "DELETE_CONFIRMATION_INVALID", "DELETE_CONFIRMATION_FORBIDDEN", "DIRECTORY_CONFLICT", "DIRECTORY_UNCHANGED", "MIGRATION_VERIFY_FAILED", "BACKUP_INVALID", "BACKUP_NOT_FOUND", "BROWSER_BUSY", "CHROME_UNAVAILABLE", "PROFILE_SCOPE_VIOLATION", "DIRECTORY_MISSING", "PERMISSION_DENIED", "SCAN_FAILED", "INDEX_READ_FAILED", "INDEX_INVALID", "IMAGE_NOT_FOUND", "IMAGE_MISSING", "IMAGE_CORRUPT", "IMAGE_UNAVAILABLE"]);
  return { status: known.has(code) ? errorStatus(code) : 500, code: known.has(code) ? code : "INTERNAL_ERROR", message: known.has(code) ? code : "本地服务执行失败" };
}

function createBrowserController(runtime: ProfileRuntime, configuredPath?: string | null): ManagerBrowserController {
  const chrome = inspectChrome({ configuredPath: configuredPath ?? undefined });
  let current: { profileId: string; session: BrowserSession; lease: BrowserLease } | null = null;
  async function withTemporarySession(profile: ProfileRecord, operation: (session: BrowserSession) => Promise<EligibilityResult>): Promise<EligibilityResult> {
    if (current) {
      if (current.profileId !== profile.profileId) throw new Error("BROWSER_BUSY");
      return operation(current.session);
    }
    if (!chrome.path) throw new Error("CHROME_UNAVAILABLE");
    const lease = new BrowserLease(runtime.dataRoot, { profileId: profile.profileId, profileDir: profile.profileDir, ownerType: "manual" });
    await lease.acquire();
    let session: BrowserSession | undefined;
    try { session = await launchProfile({ profileDir: profile.profileDir, executablePath: chrome.path, headed: false, url: "https://chatgpt.com/" }); return await operation(session); }
    finally { await session?.close(); await lease.release(); }
  }
  return {
    check: (profile) => withTemporarySession(profile, (session) => readBrowserEligibility(session.page)),
    open: async (profile) => {
      if (current) { if (current.profileId === profile.profileId) return; throw new Error("BROWSER_BUSY"); }
      if (!chrome.path) throw new Error("CHROME_UNAVAILABLE");
      const lease = new BrowserLease(runtime.dataRoot, { profileId: profile.profileId, profileDir: profile.profileDir, ownerType: "manual" });
      await lease.acquire();
      try { const session = await launchProfile({ profileDir: profile.profileDir, executablePath: chrome.path, headed: true, url: "https://chatgpt.com/" }); current = { profileId: profile.profileId, session, lease }; }
      catch (error) { await lease.release(); throw error; }
    },
    close: async (profile) => {
      if (!current || current.profileId !== profile.profileId) throw new Error("NOT_PROJECT_BROWSER");
      const owned = current; current = null; await owned.session.close(); await owned.lease.release();
    },
    closeAll: async () => { if (!current) return; const owned = current; current = null; await owned.session.close(); await owned.lease.release(); }
  };
}

function imageIndexPath(runtime: ProfileRuntime, profileId: string): string { return join(runtime.dataRoot, "image-indexes", `${profileId}.json`); }
function thumbnailRoot(runtime: ProfileRuntime, profileId: string): string { return join(runtime.dataRoot, "image-thumbnails", profileId); }

async function openDirectory(path: string): Promise<void> {
  const command = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const child = spawn(command, [path], { detached: true, stdio: "ignore", shell: false });
  await new Promise<void>((resolvePromise, reject) => { child.once("error", reject); child.once("spawn", resolvePromise); });
  child.unref();
}

function resolveStatic(publicRoot: string, requestUrl: string): string | null {
  const pathname = decodeURIComponent(new URL(requestUrl, `http://${HOST}`).pathname);
  const relativePath = normalize(pathname === "/" ? "index.html" : pathname.replace(/^\/+/, ""));
  const candidate = resolve(join(publicRoot, relativePath));
  return candidate === publicRoot || candidate.startsWith(`${publicRoot}${sep}`) ? candidate : null;
}

function validateId(value: string, pattern: RegExp, name: string): string {
  if (!pattern.test(value)) throw new HttpError(400, "INVALID_INPUT", `${name} 无效`);
  return value;
}

function stringList(params: URLSearchParams, name: string): string[] {
  return params.getAll(name).flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
}

export async function startManagerServer(options: StartManagerServerOptions): Promise<RunningManagerServer> {
  const runtime = options.runtime;
  const outputRoot = resolve(options.outputRoot);
  const backupRoot = resolve(options.backupRoot);
  const publicRoot = resolve(options.publicRoot ?? join(process.cwd(), "src", "manager", "public"));
  const browser = options.browser ?? createBrowserController(runtime, options.chromeExecutablePath);
  const leaseProbe = new BrowserLease(runtime.dataRoot, { profileId: "startup-probe", profileDir: runtime.dataRoot, ownerType: "manual" });
  await runtime.manager.reconcileBrowserStatuses(await leaseProbe.liveStatus());
  await Promise.all([mkdir(outputRoot, { recursive: true }), mkdir(backupRoot, { recursive: true }), mkdir(join(runtime.dataRoot, "image-indexes"), { recursive: true })]);
  const backups = new Map((await listBackups(backupRoot)).map((backup) => [backup.backupId, backup]));

  async function scanProfile(profile: ProfileRecord) {
    let previous;
    try { previous = await readImageIndex(imageIndexPath(runtime, profile.profileId), profile.profileId); } catch { previous = undefined; }
    const index = await scanImageIndex({ profileId: profile.profileId, outputRoot, ...(previous ? { previousIndex: previous } : {}), includeUnbound: profile.source === "legacy" });
    await writeImageIndex(imageIndexPath(runtime, profile.profileId), index);
    return index;
  }

  async function indexFor(profile: ProfileRecord) {
    try { return await readImageIndex(imageIndexPath(runtime, profile.profileId), profile.profileId); }
    catch { return scanProfile(profile); }
  }

  async function route(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", `http://${HOST}`);
    if (!url.pathname.startsWith("/api/")) return false;
    const path = url.pathname.slice(4);

    if (method === "GET" && path === "/profiles") {
      const scan = await scanDefaultRoot(runtime.store);
      const registry = await runtime.store.read();
      sendJson(response, 200, { schemaVersion: "1", activeProfileId: registry.activeProfileId, profiles: registry.profiles.map(profileView), scan: { discovered: scan.discovered.length, skipped: scan.skipped.length, scannedAt: scan.scannedAt } }); return true;
    }
    if (method === "POST" && path === "/profiles") {
      const body = objectBody(await readJson(request), ["name", "accountLabel", "notes"]);
      const profile = await runtime.manager.create({ name: requiredString(body.name, "name"), accountLabel: nullableString(body.accountLabel, "accountLabel"), notes: nullableString(body.notes, "notes") });
      sendJson(response, 201, profileView(profile)); return true;
    }
    if (method === "POST" && path === "/profiles/import") {
      const body = objectBody(await readJson(request), ["name", "accountLabel", "notes", "profileDir"]);
      const profile = await runtime.manager.importProfile({ name: requiredString(body.name, "name"), accountLabel: nullableString(body.accountLabel, "accountLabel"), notes: nullableString(body.notes, "notes"), profileDir: requiredString(body.profileDir, "profileDir") });
      sendJson(response, 201, profileView(profile)); return true;
    }
    const profileMatch = path.match(/^\/profiles\/([^/]+)$/);
    if (profileMatch) {
      const profileId = validateId(decodeURIComponent(profileMatch[1]!), PROFILE_ID, "profileId");
      if (method === "PATCH") { const body = objectBody(await readJson(request), ["name", "accountLabel", "notes"]); const profile = await runtime.manager.update(profileId, { ...(body.name !== undefined ? { name: requiredString(body.name, "name") } : {}), ...(body.accountLabel !== undefined ? { accountLabel: nullableString(body.accountLabel, "accountLabel") } : {}), ...(body.notes !== undefined ? { notes: nullableString(body.notes, "notes") } : {}) }); sendJson(response, 200, profileView(profile)); return true; }
      if (method === "DELETE") { await runtime.manager.deleteProfile(profileId, typeof request.headers["x-delete-confirmation"] === "string" ? request.headers["x-delete-confirmation"] : null); response.writeHead(204).end(); return true; }
    }
    const profileAction = path.match(/^\/profiles\/([^/]+)\/(activate|check|open|close|delete-confirmation|backups)$/);
    if (profileAction && method === "POST") {
      const profileId = validateId(decodeURIComponent(profileAction[1]!), PROFILE_ID, "profileId");
      const action = profileAction[2]!;
      const profile = await runtime.manager.get(profileId);
      if (action === "check") { const result = await browser.check(profile); const updated = await runtime.manager.recordEligibility(profileId, result); sendJson(response, 200, profileView(updated)); return true; }
      if (action === "activate") { const updated = await runtime.manager.activate(profileId, (selected) => browser.check(selected)); sendJson(response, 200, profileView(updated)); return true; }
      if (action === "open") { await browser.open(profile); const updated = await runtime.manager.setBrowserStatus(profileId, "open"); sendJson(response, 200, profileView(updated)); return true; }
      if (action === "close") { await browser.close(profile); const updated = await runtime.manager.setBrowserStatus(profileId, "closed"); sendJson(response, 200, profileView(updated)); return true; }
      if (action === "delete-confirmation") { const body = objectBody(await readJson(request), ["profileName"]); if (requiredString(body.profileName, "profileName") !== profile.name) throw new HttpError(400, "PROFILE_NAME_MISMATCH", "Profile 名称不匹配"); sendJson(response, 200, { confirmation: runtime.manager.issueDeleteConfirmation(profileId, "page"), expiresInSeconds: 120 }); return true; }
      if (action === "backups") { const backup = await createBackup(profile, backupRoot); backups.set(backup.backupId, backup); sendJson(response, 201, backup); return true; }
    }
    if (method === "GET" && path === "/directories") { const scan = await scanDefaultRoot(runtime.store); const registry = await runtime.store.read(); sendJson(response, 200, { defaultRootDir: registry.defaultRootDir, retainedRoots: registry.retainedRoots, profileCount: registry.profiles.length, scannedAt: scan.scannedAt, skippedCount: scan.skipped.length }); return true; }
    if (method === "POST" && path === "/directories/plan") { const body = objectBody(await readJson(request), ["targetRootDir", "mode"]); const mode = body.mode === "migrate" || body.mode === "retain" ? body.mode : (() => { throw new HttpError(400, "INVALID_INPUT", "mode 必须是 migrate 或 retain"); })(); sendJson(response, 200, await planDefaultRootChange(runtime.store, requiredString(body.targetRootDir, "targetRootDir"), mode)); return true; }
    const directoryAction = path.match(/^\/directories\/(migrate|retain)$/);
    if (directoryAction && method === "POST") { const body = objectBody(await readJson(request), ["targetRootDir"]); sendJson(response, 200, await changeDefaultRoot(runtime.store, requiredString(body.targetRootDir, "targetRootDir"), directoryAction[1] as DirectoryChangeMode)); return true; }
    if (method === "GET" && path === "/backups") { sendJson(response, 200, { backups: [...backups.values()].map((backup) => ({ ...backup, backupDir: backup.backupDir })) }); return true; }
    const restoreMatch = path.match(/^\/backups\/([^/]+)\/restore$/);
    if (restoreMatch && method === "POST") { const backup = backups.get(decodeURIComponent(restoreMatch[1]!)); if (!backup) throw new HttpError(404, "BACKUP_NOT_FOUND", "备份不存在"); const body = objectBody(await readJson(request), ["name"]); const profile = await restoreBackup(backup, runtime.manager, requiredString(body.name, "name")); sendJson(response, 201, profileView(profile)); return true; }

    const imageList = path.match(/^\/profiles\/([^/]+)\/images$/);
    if (imageList && method === "GET") {
      const profile = await runtime.manager.get(validateId(decodeURIComponent(imageList[1]!), PROFILE_ID, "profileId"));
      const index = await indexFor(profile);
      const sort = url.searchParams.get("sort") ?? "generatedAt_desc"; if (!(IMAGE_SORTS as readonly string[]).includes(sort)) throw new HttpError(400, "INVALID_INPUT", "sort 无效");
      const group = url.searchParams.get("group") ?? "recent_project"; if (!(IMAGE_GROUPS as readonly string[]).includes(group)) throw new HttpError(400, "INVALID_INPUT", "group 无效");
      const statuses = stringList(url.searchParams, "status"); if (!statuses.every((value) => (IMAGE_STATUSES as readonly string[]).includes(value))) throw new HttpError(400, "INVALID_INPUT", "status 无效");
      const generationTypes = stringList(url.searchParams, "generationType"); if (!generationTypes.every((value) => (IMAGE_GENERATION_TYPES as readonly string[]).includes(value))) throw new HttpError(400, "INVALID_INPUT", "generationType 无效");
      const requestedOrientation = url.searchParams.get("orientation"); if (requestedOrientation && !["landscape", "portrait", "square"].includes(requestedOrientation)) throw new HttpError(400, "INVALID_INPUT", "orientation 无效");
      const numeric = (name: string) => { const raw = url.searchParams.get(name); if (raw === null || raw === "") return null; const value = Number(raw); if (!Number.isFinite(value) || value < 0) throw new HttpError(400, "INVALID_INPUT", `${name} 无效`); return value; };
      const filter: ImageFilter = { keyword: url.searchParams.get("keyword") ?? "", statuses: statuses as NonNullable<ImageFilter["statuses"]>, formats: stringList(url.searchParams, "format"), generationTypes: generationTypes as NonNullable<ImageFilter["generationTypes"]>, projectIds: stringList(url.searchParams, "projectId"), taskIds: stringList(url.searchParams, "taskId"), from: url.searchParams.get("from"), to: url.searchParams.get("to"), orientation: requestedOrientation as ImageOrientation | null, minWidth: numeric("minWidth"), maxWidth: numeric("maxWidth"), minHeight: numeric("minHeight"), maxHeight: numeric("maxHeight"), minByteSize: numeric("minByteSize"), maxByteSize: numeric("maxByteSize") };
      let result;
      try { result = queryImages(index, filter, sort as ImageSort, Number(url.searchParams.get("page") ?? 1), Number(url.searchParams.get("pageSize") ?? 50), group as ImageGroupBy); }
      catch { throw new HttpError(400, "INVALID_INPUT", "图片查询参数无效"); }
      sendJson(response, 200, result); return true;
    }
    const imageScan = path.match(/^\/profiles\/([^/]+)\/images\/scan$/);
    if (imageScan && method === "POST") { const profile = await runtime.manager.get(validateId(decodeURIComponent(imageScan[1]!), PROFILE_ID, "profileId")); sendJson(response, 200, await scanProfile(profile)); return true; }
    const indexStatus = path.match(/^\/profiles\/([^/]+)\/images\/index-status$/);
    if (indexStatus && method === "GET") { const profileId = validateId(decodeURIComponent(indexStatus[1]!), PROFILE_ID, "profileId"); await runtime.manager.get(profileId); try { const index = await readImageIndex(imageIndexPath(runtime, profileId), profileId); sendJson(response, 200, { state: "ready", scannedAt: index.scannedAt, stats: index.stats, issues: index.issues }); } catch { sendJson(response, 200, { state: "not_scanned", scannedAt: null, stats: null, issues: [] }); } return true; }
    const imageOperation = path.match(/^\/profiles\/([^/]+)\/images\/([^/]+)(?:\/(content|open-directory))?$/);
    if (imageOperation) {
      if (method === "DELETE") throw new HttpError(405, "METHOD_NOT_ALLOWED", "图片管理不提供删除能力");
      const profile = await runtime.manager.get(validateId(decodeURIComponent(imageOperation[1]!), PROFILE_ID, "profileId"));
      const imageId = validateId(decodeURIComponent(imageOperation[2]!), IMAGE_ID, "imageId");
      const index = await indexFor(profile);
      const operation = imageOperation[3];
      if (!operation && method === "GET") { sendJson(response, 200, await getIndexedImageDetails(index, imageId)); return true; }
      if (operation === "open-directory" && method === "POST") { const details = await getIndexedImageDetails(index, imageId); if (!details.actions.openDirectory) throw new HttpError(422, "IMAGE_UNAVAILABLE", "当前记录无可打开目录"); await openDirectory(details.parentDirectory); sendJson(response, 200, { opened: true }); return true; }
      if (operation === "content" && method === "GET") {
        const source = url.searchParams.get("kind") === "thumbnail" ? await createManagerThumbnail({ index, imageId, thumbnailRoot: thumbnailRoot(runtime, profile.profileId) }) : (await resolveIndexedImageSource(index, imageId)).sourcePath;
        const file = await stat(source); response.writeHead(200, { "Cache-Control": "private, no-store", "Content-Type": CONTENT_TYPES.get(extname(source).toLowerCase()) ?? "application/octet-stream", "Content-Length": file.size, "Content-Disposition": url.searchParams.get("download") === "1" ? `attachment; filename*=UTF-8''${encodeURIComponent((await resolveIndexedImageSource(index, imageId)).record.fileName)}` : "inline", "X-Content-Type-Options": "nosniff" }); createReadStream(source).pipe(response); return true;
      }
    }
    throw new HttpError(404, "NOT_FOUND", "接口不存在");
  }

  const server = createServer(async (request, response) => {
    try {
      if (await route(request, response)) return;
      const filePath = resolveStatic(publicRoot, request.url ?? "/");
      if (!filePath) throw new HttpError(403, "FORBIDDEN", "路径被拒绝");
      const file = await stat(filePath).catch(() => null);
      if (!file?.isFile()) throw new HttpError(404, "NOT_FOUND", "资源不存在");
      response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": CONTENT_TYPES.get(extname(filePath).toLowerCase()) ?? "application/octet-stream", "Content-Length": file.size, "X-Content-Type-Options": "nosniff" });
      createReadStream(filePath).pipe(response);
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      const safe = safeError(error); sendJson(response, safe.status, { error: { code: safe.code, message: safe.message } });
    }
  });
  await new Promise<void>((resolvePromise, reject) => { server.once("error", reject); server.listen({ host: HOST, port: options.port ?? 0, exclusive: true }, resolvePromise); });
  const address = server.address() as AddressInfo;
  return { host: HOST, port: address.port, url: `http://${HOST}:${address.port}`, close: async () => { await browser.closeAll().catch(() => undefined); await new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise())); } };
}

async function main(): Promise<void> {
  const config = await loadConfig();
  const runtime = await openProfileRuntime(config.profileDir);
  const running = await startManagerServer({ runtime, outputRoot: join(resolve(config.fallbackOutputDir), "gpt-web-images"), backupRoot: join(runtime.dataRoot, "backups"), chromeExecutablePath: config.chromeExecutablePath, port: Number(process.env.GPT_WEB_IMAGE_MANAGER_PORT ?? 4173) });
  process.stdout.write(`GPT Web Image manager: ${running.url}\n`);
  const shutdown = async () => { await running.close(); process.exitCode = 0; };
  process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown);
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) main().catch((error) => { process.stderr.write(`${safeError(error).message}\n`); process.exitCode = 1; });
