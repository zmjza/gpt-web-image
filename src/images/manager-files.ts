import { constants } from "node:fs";
import { copyFile, lstat, realpath, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { isWithinRoot, sanitizeFileName } from "../platform/paths.js";
import type { ImageIndex, ImageRecord } from "./manager-model.js";

export class IndexedImageFileError extends Error {
  public constructor(message: string, public readonly code: "IMAGE_NOT_FOUND" | "IMAGE_MISSING" | "IMAGE_CORRUPT" | "IMAGE_UNAVAILABLE" | "PROFILE_SCOPE_VIOLATION" | "EXPORT_FAILED") { super(message); }
}

function findRecord(index: ImageIndex, imageId: string): ImageRecord {
  const record = index.records.find((candidate) => candidate.imageId === imageId);
  if (!record) throw new IndexedImageFileError("图片记录不存在", "IMAGE_NOT_FOUND");
  if (record.profileId !== index.profileId) throw new IndexedImageFileError("图片不属于所选 Profile", "PROFILE_SCOPE_VIOLATION");
  return record;
}

export async function resolveIndexedImageSource(index: ImageIndex, imageId: string): Promise<{ record: ImageRecord; sourcePath: string }> {
  const record = findRecord(index, imageId);
  if (record.status === "missing") throw new IndexedImageFileError("图片文件缺失", "IMAGE_MISSING");
  if (record.status === "corrupt") throw new IndexedImageFileError("图片文件损坏", "IMAGE_CORRUPT");
  if (record.status === "generating" || record.status === "failed") throw new IndexedImageFileError("当前记录没有可用图片文件", "IMAGE_UNAVAILABLE");
  let canonicalRoot: string;
  let canonicalSource: string;
  try {
    canonicalRoot = await realpath(resolve(index.outputRoot));
    const sourceStat = await lstat(resolve(record.absolutePath));
    if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) throw new IndexedImageFileError("图片来源不是受控普通文件", "PROFILE_SCOPE_VIOLATION");
    canonicalSource = await realpath(resolve(record.absolutePath));
  } catch (error) {
    if (error instanceof IndexedImageFileError) throw error;
    throw new IndexedImageFileError("图片文件缺失", "IMAGE_MISSING");
  }
  if (!isWithinRoot(canonicalRoot, canonicalSource)) throw new IndexedImageFileError("图片路径越出所选 Profile", "PROFILE_SCOPE_VIOLATION");
  return { record, sourcePath: canonicalSource };
}

export interface IndexedImageDetails {
  record: ImageRecord;
  available: boolean;
  parentDirectory: string;
  actions: {
    preview: boolean;
    copyPath: boolean;
    openDirectory: boolean;
    export: boolean;
  };
}

export async function getIndexedImageDetails(index: ImageIndex, imageId: string): Promise<IndexedImageDetails> {
  const indexedRecord = findRecord(index, imageId);
  if (indexedRecord.status !== "completed") {
    const root = await realpath(resolve(index.outputRoot));
    const recordPath = resolve(indexedRecord.absolutePath);
    if (!isWithinRoot(root, recordPath)) throw new IndexedImageFileError("图片路径越出所选 Profile", "PROFILE_SCOPE_VIOLATION");
    return {
      record: indexedRecord,
      available: false,
      parentDirectory: dirname(recordPath),
      actions: { preview: false, copyPath: false, openDirectory: true, export: false }
    };
  }
  const { record, sourcePath } = await resolveIndexedImageSource(index, imageId);
  return {
    record,
    available: true,
    parentDirectory: dirname(sourcePath),
    actions: { preview: true, copyPath: true, openDirectory: true, export: true }
  };
}

export async function exportIndexedImage(index: ImageIndex, imageId: string, destinationDirectory: string, preferredFileName?: string): Promise<string> {
  const { record, sourcePath } = await resolveIndexedImageSource(index, imageId);
  let destinationRoot: string;
  try {
    const destinationStat = await lstat(resolve(destinationDirectory));
    if (destinationStat.isSymbolicLink() || !destinationStat.isDirectory()) throw new Error("导出位置不是普通目录");
    destinationRoot = await realpath(resolve(destinationDirectory));
  } catch {
    throw new IndexedImageFileError("导出目录不可用", "EXPORT_FAILED");
  }
  const fileName = sanitizeFileName(preferredFileName?.trim() || basename(record.fileName));
  const destinationPath = resolve(destinationRoot, fileName);
  if (!isWithinRoot(destinationRoot, destinationPath)) throw new IndexedImageFileError("导出路径越界", "PROFILE_SCOPE_VIOLATION");
  try {
    await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL);
    const copied = await stat(destinationPath);
    if (!copied.isFile()) throw new Error("导出结果不是文件");
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
    if (code === "EEXIST") throw new IndexedImageFileError("导出文件已存在", "EXPORT_FAILED");
    throw new IndexedImageFileError("图片导出失败", "EXPORT_FAILED");
  }
  return destinationPath;
}
