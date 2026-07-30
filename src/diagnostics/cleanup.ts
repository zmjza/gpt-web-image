import { lstat, readdir, unlink } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export interface CleanupReport { removed: string[]; skipped: string[]; }

export async function cleanupDiagnostics(root: string, now = new Date(), retentionDays = 7, dryRun = false, protectedRoot?: string): Promise<CleanupReport> {
  const base = resolve(root);
  if (protectedRoot) {
    const relativeToProtected = relative(resolve(protectedRoot), base);
    if (relativeToProtected === "" || (!isAbsolute(relativeToProtected) && relativeToProtected !== ".." && !relativeToProtected.startsWith(`..${sep}`))) {
      throw new Error("拒绝清理专用 Chrome Profile：Profile 数据永不自动删除");
    }
  }
  const report: CleanupReport = { removed: [], skipped: [] };
  let entries: string[];
  try { entries = await readdir(base); } catch { return report; }
  const cutoff = now.getTime() - retentionDays * 86400000;
  for (const name of entries) {
    const path = resolve(base, name);
    if (relative(base, path).startsWith("..")) { report.skipped.push(path); continue; }
    const stat = await lstat(path).catch(() => undefined);
    if (!stat || stat.isSymbolicLink() || !stat.isFile() || stat.mtimeMs >= cutoff || name === "task.json") { report.skipped.push(path); continue; }
    if (!dryRun) await unlink(path);
    report.removed.push(path);
  }
  return report;
}
