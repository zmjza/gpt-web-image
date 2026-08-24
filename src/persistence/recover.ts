import type { TaskRecord } from "../tasks/model.js";
import { isTerminalState } from "../monitor/state-machine.js";
import { isStableConversationUrl } from "../chatgpt/conversation.js";

export type RecoveryDecision =
  | { action: "already_terminal"; maySubmit: false; reason: "terminal" }
  | { action: "resume_before_submit"; maySubmit: true; reason: "no_attempt" }
  | { action: "result_uncertain"; maySubmit: false; reason: "submission_unconfirmed" | "missing_context" }
  | { action: "resume_observer"; maySubmit: false; reason: "anchored_submission" };

export function auditRecovery(task: TaskRecord): RecoveryDecision {
  if (isTerminalState(task.state)) {
    const failedDeliveryCanResume = (task.state === "failed" || task.state === "result_uncertain")
      && Boolean(task.submission.confirmedAt)
      && Boolean(task.chatUrl && isStableConversationUrl(task.chatUrl))
      && Boolean(task.responseAnchor);
    if (failedDeliveryCanResume) return { action: "resume_observer", maySubmit: false, reason: "anchored_submission" };
    return { action: "already_terminal", maySubmit: false, reason: "terminal" };
  }
  if (!task.submission.attemptId && !task.submission.clickedAt) return { action: "resume_before_submit", maySubmit: true, reason: "no_attempt" };
  if (!task.submission.confirmedAt) return { action: "result_uncertain", maySubmit: false, reason: "submission_unconfirmed" };
  if (!task.chatUrl || !isStableConversationUrl(task.chatUrl) || !task.responseAnchor) return { action: "result_uncertain", maySubmit: false, reason: "missing_context" };
  return { action: "resume_observer", maySubmit: false, reason: "anchored_submission" };
}
