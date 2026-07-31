import { lstat, mkdir, realpath, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { isWithinRoot } from "../platform/paths.js";
import { resolveIndexedImageSource } from "./manager-files.js";
import type { ImageIndex } from "./manager-model.js";

export interface CreateManagerThumbnailOptions {
  index: ImageIndex;
  imageId: string;
  thumbnailRoot: string;
  maxWidth?: number;
  maxHeight?: number;
}

export async function createManagerThumbnail(options: CreateManagerThumbnailOptions): Promise<string> {
  const maxWidth = options.maxWidth ?? 320;
  const maxHeight = options.maxHeight ?? 320;
  if (!Number.isInteger(maxWidth) || !Number.isInteger(maxHeight) || maxWidth < 1 || maxHeight < 1 || maxWidth > 2048 || maxHeight > 2048) {
    throw new Error("缩略图尺寸必须是 1 到 2048 的整数");
  }
  const { record, sourcePath } = await resolveIndexedImageSource(options.index, options.imageId);
  const requestedRoot = resolve(options.thumbnailRoot);
  await mkdir(requestedRoot, { recursive: true });
  const rootStat = await lstat(requestedRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error("缩略图目录不安全");
  const thumbnailRoot = await realpath(requestedRoot);
  const destinationPath = join(thumbnailRoot, `${record.imageId}-${maxWidth}x${maxHeight}.png`);
  if (!isWithinRoot(thumbnailRoot, destinationPath)) throw new Error("缩略图路径越界");
  try {
    const existing = await lstat(destinationPath);
    if (existing.isFile() && !existing.isSymbolicLink()) return destinationPath;
    throw new Error("缩略图目标不是普通文件");
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
    if (code !== "ENOENT") throw error;
  }
  const temporaryPath = `${destinationPath}.${process.pid}.${Date.now()}.partial`;
  await sharp(sourcePath, { failOn: "error" })
    .resize({ width: maxWidth, height: maxHeight, fit: "inside", withoutEnlargement: true })
    .png()
    .toFile(temporaryPath);
  await rename(temporaryPath, destinationPath);
  return destinationPath;
}
