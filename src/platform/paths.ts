import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const WINDOWS_RESERVED = new Set(["CON", "PRN", "AUX", "NUL", ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`), ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`)]);

export function sanitizeFileName(input: string): string {
  const replaced = input.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[ .]+$/, "");
  const dot = replaced.lastIndexOf(".");
  const base = (dot > 0 ? replaced.slice(0, dot) : replaced).toUpperCase();
  return WINDOWS_RESERVED.has(base) ? `${replaced}_` : (replaced || "unnamed");
}

export function isWithinRoot(root: string, candidate: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const rel = relative(resolvedRoot, resolvedCandidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export function taskOutputDir(root: string, date: Date, taskId: string): string {
  const datePart = date.toISOString().slice(0, 10);
  const safeTaskId = sanitizeFileName(taskId);
  const outputRoot = join(resolve(root), "gpt-web-images");
  const output = join(outputRoot, datePart, safeTaskId);
  if (!isWithinRoot(outputRoot, output)) throw new Error("任务输出路径越界");
  return output;
}

export function safeParentPath(filePath: string): string {
  return dirname(resolve(filePath));
}
