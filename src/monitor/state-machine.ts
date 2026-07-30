import type { TaskState } from "../tasks/model.js";

const TERMINAL = new Set<TaskState>(["succeeded", "partial_success", "failed", "timed_out", "cancelled", "structure_changed", "result_uncertain"]);
const TRANSITIONS: Partial<Record<TaskState, readonly TaskState[]>> = {
  initializing: ["needs_login", "ready", "failed", "recovering"],
  needs_login: ["ready", "needs_human_verification", "timed_out", "cancelled"],
  ready: ["submitting", "cancelled", "failed"],
  submitting: ["submitted", "ready", "result_uncertain", "cancelled", "structure_changed"],
  submitted: ["queued", "generating", "recovering", "result_uncertain", "cancelled", "failed"],
  queued: ["generating", "partial", "failed", "timed_out", "cancelled", "needs_login", "needs_human_verification"],
  generating: ["partial", "stabilizing", "failed", "timed_out", "cancelled", "needs_login", "needs_human_verification", "structure_changed"],
  partial: ["generating", "stabilizing", "downloading", "partial_success", "failed", "timed_out", "cancelled", "structure_changed"],
  stabilizing: ["generating", "partial", "downloading", "failed", "timed_out", "cancelled"],
  downloading: ["validating", "partial", "failed", "timed_out", "cancelled"],
  validating: ["partial", "downloading", "succeeded", "partial_success", "failed", "result_uncertain"],
  recovering: ["submitted", "queued", "generating", "partial", "stabilizing", "downloading", "validating", "result_uncertain", "cancelled"],
  needs_human_verification: ["ready", "submitted", "generating", "timed_out", "cancelled"]
};

export interface TransitionEvidence { validatedFiles?: number; completed?: number; target?: number; }
export class InvalidStateTransitionError extends Error {
  public constructor(from: TaskState, to: TaskState) { super(`非法状态迁移：${from} -> ${to}`); }
}

export function isTerminalState(state: TaskState): boolean { return TERMINAL.has(state); }

export function transitionTaskState(from: TaskState, to: TaskState, evidence: TransitionEvidence = {}): { state: TaskState; terminal: boolean } {
  if (from === to) return { state: from, terminal: isTerminalState(from) };
  if (isTerminalState(from) || !(TRANSITIONS[from] ?? []).includes(to)) throw new InvalidStateTransitionError(from, to);
  if (to === "succeeded" && ((evidence.validatedFiles ?? 0) < 1 || evidence.validatedFiles !== evidence.completed || (evidence.completed ?? 0) < (evidence.target ?? 1))) {
    throw new Error("成功状态缺少完整文件校验证据");
  }
  if (to === "partial_success" && (evidence.validatedFiles ?? 0) < 1) throw new Error("部分成功缺少文件校验证据");
  return { state: to, terminal: isTerminalState(to) };
}
