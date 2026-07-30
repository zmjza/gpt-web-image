import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import sharp from "sharp";

export async function createPngPreview(originalPath: string, previewPath: string): Promise<string> {
  if (originalPath === previewPath) throw new Error("预览不得覆盖原图");
  await mkdir(dirname(previewPath), { recursive: true });
  await sharp(originalPath, { failOn: "error" }).png().toFile(previewPath);
  return previewPath;
}
