import { createHash } from "node:crypto";
import { lstat, opendir, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";
import sharp from "sharp";
import { isWithinRoot } from "../platform/paths.js";
import { hashFile } from "./hash.js";
import { readImageAttribution, type ImageAttribution } from "./manager-attribution.js";
import { calculateImageIndexStats, type ImageIndex, type ImageRecord, type ImageScanIssue, type ImageStatus } from "./manager-model.js";

const SUPPORTED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".tif", ".tiff"]);
const SKIPPED_DIRECTORIES = new Set([".partial", ".manager-thumbnails", "diagnostics", "preview"]);

export class ImageScanError extends Error {
  public constructor(message: string, public readonly code: "PROFILE_SCOPE_VIOLATION" | "DIRECTORY_MISSING" | "PERMISSION_DENIED" | "SCAN_FAILED") {
    super(message);
  }
}

export interface ScanImageIndexOptions {
  profileId: string;
  outputRoot: string;
  profileRoot?: string;
  previousIndex?: ImageIndex;
  now?: Date;
  includeUnbound?: boolean;
}

function normalizeFormat(extension: string): string {
  const format = extension.slice(1).toLowerCase();
  if (format === "jpeg") return "jpg";
  if (format === "tiff") return "tif";
  return format;
}

function normalizeDecodedFormat(format: string, extension: string): string {
  if (format === "jpeg") return "jpg";
  if (format === "tiff") return "tif";
  if (format === "heif" && extension.toLowerCase() === ".avif") return "avif";
  return format.toLowerCase();
}

function imageId(profileId: string, relativePath: string): string {
  return createHash("sha256").update(`${profileId}\0${relativePath.split(sep).join("/")}`).digest("hex");
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : undefined;
}

async function canonicalRoot(options: ScanImageIndexOptions): Promise<string> {
  if (!options.profileId.trim()) throw new ImageScanError("profileId 不能为空", "PROFILE_SCOPE_VIOLATION");
  const requested = resolve(options.outputRoot);
  try {
    const requestedStat = await lstat(requested);
    if (requestedStat.isSymbolicLink() || !requestedStat.isDirectory()) {
      throw new ImageScanError("图片根目录必须是非符号链接目录", "PROFILE_SCOPE_VIOLATION");
    }
    const canonical = await realpath(requested);
    if (options.profileRoot) {
      const profileCanonical = await realpath(resolve(options.profileRoot));
      if (!isWithinRoot(profileCanonical, canonical)) throw new ImageScanError("图片根目录不属于所选 Profile", "PROFILE_SCOPE_VIOLATION");
    }
    return canonical;
  } catch (error) {
    if (error instanceof ImageScanError) throw error;
    if (errorCode(error) === "ENOENT") throw new ImageScanError("图片根目录不存在", "DIRECTORY_MISSING");
    if (errorCode(error) === "EACCES" || errorCode(error) === "EPERM") throw new ImageScanError("没有权限读取图片根目录", "PERMISSION_DENIED");
    throw new ImageScanError("无法读取图片根目录", "SCAN_FAILED");
  }
}

async function collectPaths(directory: string, root: string, issues: ImageScanIssue[], imagePaths: string[], taskPaths: string[]): Promise<void> {
  let entries: Awaited<ReturnType<typeof opendir>>;
  try {
    entries = await opendir(directory);
  } catch (error) {
    if (errorCode(error) === "EACCES" || errorCode(error) === "EPERM") {
      issues.push({ relativePath: relative(root, directory), code: "PERMISSION_DENIED", message: "目录不可读" });
      return;
    }
    throw error;
  }
  for await (const entry of entries) {
    const candidate = resolve(directory, entry.name);
    if (!isWithinRoot(root, candidate)) throw new ImageScanError("扫描路径越出图片根目录", "PROFILE_SCOPE_VIOLATION");
    if (entry.isSymbolicLink()) {
      let target: string;
      try { target = await realpath(candidate); }
      catch { issues.push({ relativePath: relative(root, candidate), code: "SYMLINK_IGNORED", message: "无法解析的符号链接已忽略" }); continue; }
      if (!isWithinRoot(root, target)) throw new ImageScanError("检测到越出图片根目录的符号链接", "PROFILE_SCOPE_VIOLATION");
      issues.push({ relativePath: relative(root, candidate), code: "SYMLINK_IGNORED", message: "符号链接不会进入图片索引" });
      continue;
    }
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) await collectPaths(candidate, root, issues, imagePaths, taskPaths);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name === "task.json") taskPaths.push(candidate);
    else if (SUPPORTED_EXTENSIONS.has(extname(entry.name).toLowerCase())) imagePaths.push(candidate);
  }
}

const GENERATING_TASK_STATES = new Set(["initializing", "ready", "submitting", "submitted", "queued", "generating", "partial", "stabilizing", "downloading", "validating", "recovering"]);
const FAILED_TASK_STATES = new Set(["needs_login", "failed", "timed_out", "cancelled", "needs_human_verification", "structure_changed", "result_uncertain"]);

function taskImageStatus(value: unknown): Extract<ImageStatus, "generating" | "failed"> | null {
  if (typeof value !== "string") return null;
  if (GENERATING_TASK_STATES.has(value)) return "generating";
  if (FAILED_TASK_STATES.has(value)) return "failed";
  return null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function taskStateRecord(taskPath: string, root: string, profileId: string, includeUnbound: boolean | undefined): Promise<ImageRecord | null> {
  const metadataStat = await lstat(taskPath);
  if (metadataStat.isSymbolicLink() || !metadataStat.isFile()) return null;
  const canonical = await realpath(taskPath);
  if (!isWithinRoot(root, canonical)) throw new ImageScanError("task.json 越出图片根目录", "PROFILE_SCOPE_VIOLATION");
  const raw = JSON.parse(await readFile(canonical, "utf8")) as Record<string, unknown>;
  const binding = raw.profileBinding && typeof raw.profileBinding === "object" ? raw.profileBinding as Record<string, unknown> : null;
  const boundProfileId = stringOrNull(binding?.profileId);
  if (boundProfileId !== null && boundProfileId !== profileId) return null;
  if (boundProfileId === null && includeUnbound === false) return null;
  const status = taskImageStatus(raw.state);
  const taskId = stringOrNull(raw.taskId);
  if (!status || !taskId) return null;
  const attribution = await readImageAttribution(taskPath, root);
  const file = await stat(canonical);
  const updatedAt = stringOrNull(raw.updatedAt) ?? stringOrNull(raw.createdAt);
  const generatedAt = updatedAt && !Number.isNaN(Date.parse(updatedAt)) ? new Date(updatedAt).toISOString() : file.mtime.toISOString();
  const relativeTaskPath = relative(root, canonical);
  return {
    imageId: imageId(profileId, `${relativeTaskPath}\0${status}`),
    profileId,
    absolutePath: canonical,
    relativePath: relativeTaskPath,
    fileName: taskId,
    generatedAt,
    generatedAtSource: updatedAt && !Number.isNaN(Date.parse(updatedAt)) ? "task" : "file_mtime",
    projectId: attribution.projectId,
    projectName: attribution.projectName,
    taskId,
    taskName: attribution.taskName,
    promptSummary: attribution.promptSummary,
    note: status === "generating" ? "任务正在生成，尚无可用图片文件" : "任务已失败，未产生可用图片文件",
    generationType: attribution.generationType,
    format: "",
    width: null,
    height: null,
    byteSize: null,
    status,
    thumbnailPath: null,
    contentHash: null
  };
}

async function scanFile(filePath: string, root: string, profileId: string, attribution: ImageAttribution): Promise<{ record: ImageRecord; issue: ImageScanIssue | null }> {
  const relativePath = relative(root, filePath);
  const file = await stat(filePath);
  const generatedAt = attribution.generatedAt ?? file.mtime.toISOString();
  const base: Omit<ImageRecord, "width" | "height" | "status" | "contentHash"> = {
    imageId: imageId(profileId, relativePath),
    profileId,
    absolutePath: filePath,
    relativePath,
    fileName: basename(filePath),
    generatedAt,
    generatedAtSource: attribution.generatedAtSource,
    projectId: attribution.projectId,
    projectName: attribution.projectName,
    taskId: attribution.taskId,
    taskName: attribution.taskName,
    promptSummary: attribution.promptSummary,
    note: null,
    generationType: attribution.generationType,
    format: normalizeFormat(extname(filePath)),
    byteSize: file.size,
    thumbnailPath: null
  };
  try {
    const metadata = await sharp(filePath, { failOn: "error" }).metadata();
    if (!metadata.width || !metadata.height || !metadata.format) throw new Error("无法解码图片元数据");
    return { record: { ...base, format: normalizeDecodedFormat(metadata.format, extname(filePath)), width: metadata.width, height: metadata.height, status: "completed", contentHash: await hashFile(filePath) }, issue: null };
  } catch {
    return {
      record: { ...base, width: null, height: null, status: "corrupt", contentHash: null },
      issue: { relativePath, code: "FILE_CORRUPT", message: "图片无法解码" }
    };
  }
}

function missingRecord(record: ImageRecord): ImageRecord {
  return { ...record, status: "missing", width: record.width, height: record.height, byteSize: null, thumbnailPath: null, contentHash: null };
}

export async function scanImageIndex(options: ScanImageIndexOptions): Promise<ImageIndex> {
  const root = await canonicalRoot(options);
  if (options.previousIndex && options.previousIndex.profileId !== options.profileId) {
    throw new ImageScanError("旧索引不属于所选 Profile", "PROFILE_SCOPE_VIOLATION");
  }
  const issues: ImageScanIssue[] = [];
  const paths: string[] = [];
  const taskPaths: string[] = [];
  try { await collectPaths(root, root, issues, paths, taskPaths); }
  catch (error) {
    if (error instanceof ImageScanError) throw error;
    if (errorCode(error) === "EACCES" || errorCode(error) === "EPERM") throw new ImageScanError("扫描图片目录时权限不足", "PERMISSION_DENIED");
    throw new ImageScanError("扫描图片目录失败", "SCAN_FAILED");
  }
  paths.sort((left, right) => left.localeCompare(right));
  const attributionCache = new Map<string, ImageAttribution | null>();
  const current = new Map<string, ImageRecord>();
  for (const path of paths) {
    try {
      const attribution = await readImageAttribution(path, root, attributionCache);
      if (attribution.profileId !== null && attribution.profileId !== options.profileId) continue;
      if (attribution.profileId === null && options.includeUnbound === false) continue;
      const result = await scanFile(path, root, options.profileId, attribution);
      current.set(result.record.imageId, result.record);
      if (result.issue) issues.push(result.issue);
    } catch (error) {
      const code = errorCode(error);
      issues.push({
        relativePath: relative(root, path),
        code: code === "ENOENT" ? "FILE_MISSING" : code === "EACCES" || code === "EPERM" ? "PERMISSION_DENIED" : "READ_FAILED",
        message: code === "ENOENT" ? "扫描期间文件已消失" : code === "EACCES" || code === "EPERM" ? "文件不可读" : "文件读取失败"
      });
    }
  }
  const tasksWithImages = new Set([...current.values()].map((record) => record.taskId).filter((taskId): taskId is string => taskId !== null));
  for (const taskPath of taskPaths.sort((left, right) => left.localeCompare(right))) {
    try {
      const placeholder = await taskStateRecord(taskPath, root, options.profileId, options.includeUnbound);
      if (placeholder && !tasksWithImages.has(placeholder.taskId!)) current.set(placeholder.imageId, placeholder);
    } catch (error) {
      if (error instanceof ImageScanError) throw error;
      const code = errorCode(error);
      issues.push({
        relativePath: relative(root, taskPath),
        code: code === "EACCES" || code === "EPERM" ? "PERMISSION_DENIED" : "READ_FAILED",
        message: code === "EACCES" || code === "EPERM" ? "task.json 不可读" : "task.json 读取失败"
      });
    }
  }
  for (const previous of options.previousIndex?.records ?? []) {
    if (!current.has(previous.imageId) && previous.status !== "generating" && previous.status !== "failed") {
      const missing = missingRecord(previous);
      current.set(missing.imageId, missing);
      issues.push({ relativePath: missing.relativePath, code: "FILE_MISSING", message: "索引文件已不在磁盘" });
    }
  }
  const records = [...current.values()].sort((left, right) => left.imageId.localeCompare(right.imageId));
  return {
    schemaVersion: "1",
    indexVersion: (options.previousIndex?.indexVersion ?? 0) + 1,
    profileId: options.profileId,
    outputRoot: root,
    scannedAt: (options.now ?? new Date()).toISOString(),
    records,
    issues,
    stats: calculateImageIndexStats(records)
  };
}
