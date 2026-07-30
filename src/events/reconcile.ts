import { access } from "node:fs/promises";
import type { ImageResult } from "../images/validate.js";

export interface ReconcileResult { state: "succeeded" | "partial_success" | "failed" | "result_uncertain"; completed: number; missingFiles: string[]; missingEvents: string[]; }
export async function reconcileResults(results: ImageResult[], emittedResultIds: ReadonlySet<string>, target: number): Promise<ReconcileResult> {
  const unique = [...new Map(results.map((result) => [result.sha256, result])).values()];
  const missingFiles: string[] = [];
  for (const result of unique) await access(result.originalPath).catch(() => missingFiles.push(result.originalPath));
  const missingEvents = unique.filter((result) => !emittedResultIds.has(result.resultId)).map((result) => result.resultId);
  if (missingFiles.length > 0 || missingEvents.length > 0) return { state: "result_uncertain", completed: unique.length - missingFiles.length, missingFiles, missingEvents };
  if (unique.length >= target) return { state: "succeeded", completed: unique.length, missingFiles, missingEvents };
  if (unique.length > 0) return { state: "partial_success", completed: unique.length, missingFiles, missingEvents };
  return { state: "failed", completed: 0, missingFiles, missingEvents };
}
