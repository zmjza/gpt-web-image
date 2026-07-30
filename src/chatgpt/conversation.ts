import type { RequestKind } from "../input/parse-request.js";

export type ConversationPlan = { action: "new"; chatUrl: null } | { action: "reuse"; chatUrl: string };
export function conversationPlan(input: { kind: RequestKind; sourceChatUrl: string | null }): ConversationPlan {
  if (input.kind !== "refine") return { action: "new", chatUrl: null };
  if (!input.sourceChatUrl || !/^https:\/\/chatgpt\.com\/c\//.test(input.sourceChatUrl)) throw new Error("连续修改上下文不可恢复");
  return { action: "reuse", chatUrl: input.sourceChatUrl };
}
