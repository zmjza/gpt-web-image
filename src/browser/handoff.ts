export interface HandoffInput { taskId: string; attemptId: string | null; chatUrl: string | null; state: "needs_login" | "needs_human_verification" | "structure_changed"; }
export interface HandoffPlan { taskId: string; attemptId: string | null; chatUrl: string | null; fromMode: "headless"; toMode: "headed"; resumeWithoutSubmit: true; }
export function createHandoffPlan(input: HandoffInput): HandoffPlan {
  return { taskId: input.taskId, attemptId: input.attemptId, chatUrl: input.chatUrl, fromMode: "headless", toMode: "headed", resumeWithoutSubmit: true };
}
