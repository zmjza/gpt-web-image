import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { taskOutputDir } from "../platform/paths.js";

export interface OutputLayout { taskDir: string; originalDir: string; editedDir: string; previewDir: string; diagnosticsDir: string; partialDir: string; }
export function layoutFromTaskDir(taskDir: string): OutputLayout {
  return {
    taskDir,
    originalDir: join(taskDir, "original"),
    editedDir: join(taskDir, "edited"),
    previewDir: join(taskDir, "preview"),
    diagnosticsDir: join(taskDir, "diagnostics"),
    partialDir: join(taskDir, ".partial")
  };
}
export async function createOutputLayout(root: string, date: Date, taskId: string): Promise<OutputLayout> {
  const taskDir = taskOutputDir(root, date, taskId);
  const layout = layoutFromTaskDir(taskDir);
  await Promise.all(Object.values(layout).slice(1).map((directory) => mkdir(directory, { recursive: true })));
  return layout;
}
