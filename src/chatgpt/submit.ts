import { createHash, randomUUID } from "node:crypto";

export interface PreparedSubmission { attemptId: string; baselineMessageCount: number; baselineUserMessages: string[]; promptFingerprint: string; prompt: string; }
export interface SubmissionEvidence { userMessages: string[]; composerEmpty: boolean; conversationCreated?: boolean; clickFailedBeforeDispatch?: boolean; }
export type SubmissionStatus = "confirmed" | "not_submitted" | "uncertain";

function normalizeSubmissionText(value: string): string {
  const compact = value.replace(/\s+/g, "");
  return compact.replace(/^你说[：:]/, "").replace(/展开收起$/, "");
}

function fingerprint(value: string): string { return createHash("sha256").update(normalizeSubmissionText(value)).digest("hex"); }

export function prepareSubmission(prompt: string, baselineMessageCount: number, baselineUserMessages: string[]): PreparedSubmission {
  return { attemptId: randomUUID(), baselineMessageCount, baselineUserMessages: [...baselineUserMessages], promptFingerprint: fingerprint(prompt), prompt: prompt.trim() };
}

export function confirmSubmission(prepared: PreparedSubmission, evidence: SubmissionEvidence): SubmissionStatus {
  const additions = evidence.userMessages.slice(prepared.baselineUserMessages.length);
  if (additions.some((message) => fingerprint(message) === prepared.promptFingerprint)) return "confirmed";
  if (evidence.conversationCreated === true && evidence.composerEmpty) return "confirmed";
  if (evidence.clickFailedBeforeDispatch === true && !evidence.composerEmpty && additions.length === 0) return "not_submitted";
  return "uncertain";
}

export function decideRetry(status: SubmissionStatus): boolean { return status === "not_submitted"; }
