import { stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { hashFile } from "./hash.js";
import { parseAspectRatio } from "./ratio.js";

export interface ImageResult {
  resultId: string;
  originalPath: string;
  previewPath: string | null;
  mimeType: string;
  width: number;
  height: number;
  byteLength: number;
  sha256: string;
  provenance?: {
    userTurnOrdinal: number;
    assistantTurnOrdinal: number;
    mediaCardId: string;
    downloadMethod: "download_event" | "exposed_resource";
  };
}

export class ImageValidationError extends Error { public readonly code = "VALIDATION_FAILED"; }
const FORMAT_MIME: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", avif: "image/avif", tiff: "image/tiff" };

export function assertAspectRatioDirection(width: number, height: number, requested: string | null): void {
  if (!requested || width <= 0 || height <= 0) return;
  const ratio = parseAspectRatio(requested);
  const requestedOrientation = ratio.width === ratio.height ? "square" : ratio.width > ratio.height ? "landscape" : "portrait";
  const actualOrientation = width === height ? "square" : width > height ? "landscape" : "portrait";
  if (requestedOrientation !== "square" && actualOrientation !== "square" && requestedOrientation !== actualOrientation) {
    throw new ImageValidationError(`图片比例方向与请求不符：请求 ${requested}，实际 ${width}:${height}`);
  }
}

export async function validateImageFile(path: string, declaredMime?: string, knownHashes: ReadonlySet<string> = new Set()): Promise<ImageResult> {
  try {
    const file = await stat(path);
    if (!file.isFile() || file.size < 16) throw new Error("文件过小或不是普通文件");
    const metadata = await sharp(path, { failOn: "error" }).metadata();
    if (!metadata.format || !metadata.width || !metadata.height) throw new Error("无法解码图片尺寸或格式");
    const mimeType = FORMAT_MIME[metadata.format];
    if (!mimeType) throw new Error(`不支持的图片格式：${metadata.format}`);
    if (declaredMime && declaredMime !== mimeType) throw new Error(`MIME 不一致：${declaredMime} != ${mimeType}`);
    const sha256 = await hashFile(path);
    if (knownHashes.has(sha256)) throw new ImageValidationError("图片内容重复");
    return { resultId: randomUUID(), originalPath: path, previewPath: null, mimeType, width: metadata.width, height: metadata.height, byteLength: file.size, sha256 };
  } catch (error) {
    if (error instanceof ImageValidationError) throw error;
    throw new ImageValidationError(`图片校验失败：${error instanceof Error ? error.message : String(error)}`);
  }
}
