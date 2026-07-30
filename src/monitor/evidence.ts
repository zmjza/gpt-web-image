import type { TaskState } from "../tasks/model.js";

export interface MonitorEvidence {
  queued: boolean;
  generating: boolean;
  responseComplete: boolean;
  stableImages: number;
  target: number;
  httpStatus?: number;
  errorText?: string;
  loginRequired?: boolean;
  verificationRequired?: boolean;
}
export interface ClassifiedFailure { state: Extract<TaskState, "failed" | "needs_login" | "needs_human_verification">; code: string; recoverable: boolean; }

export function classifyEvidence(evidence: MonitorEvidence): TaskState | ClassifiedFailure {
  if (evidence.loginRequired) return { state: "needs_login", code: "LOGIN_REQUIRED", recoverable: true };
  if (evidence.verificationRequired) return { state: "needs_human_verification", code: "HUMAN_VERIFICATION_REQUIRED", recoverable: true };
  if (evidence.httpStatus === 429) return { state: "failed", code: "RATE_LIMITED", recoverable: true };
  if ((evidence.httpStatus ?? 0) >= 500) return { state: "failed", code: "UPSTREAM_SERVER_ERROR", recoverable: true };
  if (/content policy|无法生成|不能生成|拒绝/i.test(evidence.errorText ?? "")) return { state: "failed", code: "CONTENT_REJECTED", recoverable: false };
  if (evidence.queued) return "queued";
  if (evidence.generating) return evidence.stableImages > 0 ? "partial" : "generating";
  if (evidence.responseComplete && evidence.stableImages > 0) return "stabilizing";
  return "submitted";
}
