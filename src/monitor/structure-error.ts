import { redactRecord } from "../diagnostics/redact.js";

export interface StructureFailure { state: "structure_changed"; code: string; stopActions: true; diagnostic: unknown; }
export function createStructureFailure(code: string, diagnostic: unknown): StructureFailure {
  return { state: "structure_changed", code, stopActions: true, diagnostic: redactRecord(diagnostic) };
}
