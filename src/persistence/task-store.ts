import { open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { TaskRecord } from "../tasks/model.js";

export class TaskStoreError extends Error {
  public constructor(message: string, public readonly code: string = "PERSISTENCE_FAILED") { super(message); }
}

function isTaskRecord(value: unknown): value is TaskRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<TaskRecord>;
  return record.schemaVersion === "1" && typeof record.taskId === "string" && typeof record.state === "string" && Array.isArray(record.results);
}

export async function writeTaskRecord(filePath: string, record: TaskRecord): Promise<void> {
  if (record.schemaVersion !== "1") throw new TaskStoreError("不支持的 task schemaVersion");
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.partial`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    handle = await open(temporaryPath, "r+");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, filePath);
    const directory = await open(dirname(filePath), "r").catch(() => undefined);
    if (directory) {
      await directory.sync().catch(() => undefined);
      await directory.close();
    }
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw new TaskStoreError(`task.json 写入失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function readTaskRecord(filePath: string): Promise<TaskRecord> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    throw new TaskStoreError(`task.json 读取失败：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isTaskRecord(parsed)) throw new TaskStoreError("task.json 结构无效或 schemaVersion 未知", "PERSISTENCE_INCOMPATIBLE");
  return {
    ...parsed,
    profileBinding: parsed.profileBinding ?? null,
    modelSelection: parsed.modelSelection ?? null,
    modelSelections: parsed.modelSelections ?? (parsed.modelSelection ? [parsed.modelSelection] : []),
    referenceEvidence: parsed.referenceEvidence ?? []
  };
}

export function taskFilePath(directory: string): string { return join(directory, "task.json"); }
