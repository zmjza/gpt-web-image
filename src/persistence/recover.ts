import type { TaskRecord } from "../tasks/model.js";
import { isTerminalState } from "../monitor/state-machine.js";

export type RecoveryDecision =
  | { action: "already_terminal"; maySubmit: false; reason: "terminal" }
  | { action: "resume_before_submit"; maySubmit: true; reason: "no_attempt" }
  | { action: "result_uncertain"; maySubmit: false; reason: "submission_unconfirmed" | "missing_context" }
  | { action: "resume_observer"; maySubmit: false; reason: "anchored_submission" };

export function auditRecovery(task: TaskRecord): RecoveryDecision {
  if (isTerminalState(task.state)) return { action: "already_terminal", maySubmit: false, reason: "terminal" };
  if (!task.submission.attemptId && !task.submission.clickedAt) return { action: "resume_before_submit", maySubmit: true, reason: "no_attempt" };
  if (!task.submission.confirmedAt) return { action: "result_uncertain", maySubmit: false, reason: "submission_unconfirmed" };
  if (!task.chatUrl || !task.responseAnchor) return { action: "result_uncertain", maySubmit: false, reason: "missing_context" };
  return { action: "resume_observer", maySubmit: false, reason: "anchored_submission" };
}
