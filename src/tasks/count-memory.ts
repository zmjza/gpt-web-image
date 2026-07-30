import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { normalizeCount } from "./count-policy.js";

export async function readRememberedCount(path: string, fallback: number): Promise<number> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as { schemaVersion?: string; imageCount?: number };
    if (value.schemaVersion !== "1") return normalizeCount(fallback);
    return normalizeCount(value.imageCount, fallback);
  } catch { return normalizeCount(fallback); }
}

export async function writeRememberedCount(path: string, count: number): Promise<void> {
  const normalized = normalizeCount(count);
  const partial = `${path}.${process.pid}.${Date.now()}.partial`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(partial, `${JSON.stringify({ schemaVersion: "1", imageCount: normalized }, null, 2)}\n`, { flag: "wx" });
  await rename(partial, path);
}
