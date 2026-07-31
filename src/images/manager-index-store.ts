import { open, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isImageGenerationType, isImageStatus, type ImageIndex, type ImageRecord } from "./manager-model.js";

export class ImageIndexStoreError extends Error {
  public constructor(message: string, public readonly code: "INDEX_READ_FAILED" | "INDEX_WRITE_FAILED" | "INDEX_INVALID" | "PROFILE_SCOPE_VIOLATION") { super(message); }
}

function validRecord(value: unknown, profileId: string): value is ImageRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ImageRecord>;
  return typeof record.imageId === "string"
    && record.profileId === profileId
    && typeof record.absolutePath === "string"
    && typeof record.relativePath === "string"
    && typeof record.fileName === "string"
    && typeof record.generatedAt === "string"
    && !Number.isNaN(Date.parse(record.generatedAt))
    && isImageGenerationType(record.generationType)
    && typeof record.format === "string"
    && isImageStatus(record.status);
}

function validIndex(value: unknown): value is ImageIndex {
  if (!value || typeof value !== "object") return false;
  const index = value as Partial<ImageIndex>;
  return index.schemaVersion === "1"
    && Number.isInteger(index.indexVersion)
    && (index.indexVersion ?? 0) >= 1
    && typeof index.profileId === "string"
    && typeof index.outputRoot === "string"
    && typeof index.scannedAt === "string"
    && !Number.isNaN(Date.parse(index.scannedAt))
    && Array.isArray(index.records)
    && index.records.every((record) => validRecord(record, index.profileId!))
    && Array.isArray(index.issues)
    && Boolean(index.stats && typeof index.stats.total === "number");
}

export async function writeImageIndex(filePath: string, index: ImageIndex): Promise<void> {
  if (!validIndex(index)) throw new ImageIndexStoreError("图片索引结构无效", "INDEX_INVALID");
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.partial`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(index, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    const handle = await open(temporaryPath, "r+");
    await handle.sync();
    await handle.close();
    await rename(temporaryPath, filePath);
    const directory = await open(dirname(filePath), "r").catch(() => undefined);
    if (directory) { await directory.sync().catch(() => undefined); await directory.close(); }
  } catch {
    throw new ImageIndexStoreError("图片索引写入失败", "INDEX_WRITE_FAILED");
  }
}

export async function readImageIndex(filePath: string, expectedProfileId?: string): Promise<ImageIndex> {
  let parsed: unknown;
  try { parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown; }
  catch { throw new ImageIndexStoreError("图片索引读取失败", "INDEX_READ_FAILED"); }
  if (!validIndex(parsed)) throw new ImageIndexStoreError("图片索引结构无效", "INDEX_INVALID");
  if (expectedProfileId && parsed.profileId !== expectedProfileId) throw new ImageIndexStoreError("图片索引 Profile 不匹配", "PROFILE_SCOPE_VIOLATION");
  return parsed;
}
