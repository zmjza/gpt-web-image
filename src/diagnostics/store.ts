import { mkdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { redactRecord } from "./redact.js";

export interface DiagnosticRecordInput {
  taskId: string;
  category: "structure" | "network" | "download" | "recovery" | "process";
  message: string;
  artifacts?: Record<string, unknown>;
  createdAt?: Date;
}

export interface StoredDiagnosticRecord {
  diagnosticId: string;
  taskId: string;
  category: DiagnosticRecordInput["category"];
  createdAt: string;
  expiresAt: string;
  sanitizedMessage: string;
  artifactPaths: string[];
  redactionVersion: "1";
}

export async function writeDiagnostic(root: string, input: DiagnosticRecordInput): Promise<StoredDiagnosticRecord> {
  const base = resolve(root);
  const created = input.createdAt ?? new Date();
  const record = redactRecord({
    diagnosticId: randomUUID(), taskId: input.taskId, category: input.category,
    createdAt: created.toISOString(), expiresAt: new Date(created.getTime() + 7 * 86400000).toISOString(),
    sanitizedMessage: input.message, artifactPaths: [] as string[], redactionVersion: "1" as const
  });
  await mkdir(base, { recursive: true });
  const file = join(base, `${record.diagnosticId}.json`);
  const resolved = resolve(file);
  if (relative(base, resolved).startsWith("..")) throw new Error("诊断路径越界");
  await writeFile(resolved, `${JSON.stringify({ ...record, artifacts: input.artifacts ? redactRecord(input.artifacts) : undefined }, null, 2)}\n`, { flag: "wx" });
  return record;
}
