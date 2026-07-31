import type { RequestKind } from "../input/parse-request.js";

export type ConversationPlan = { action: "new"; chatUrl: null } | { action: "reuse"; chatUrl: string };
export function conversationPlan(input: { kind: RequestKind; sourceChatUrl: string | null }): ConversationPlan {
  if (input.kind !== "refine") return { action: "new", chatUrl: null };
  if (!input.sourceChatUrl || !/^https:\/\/chatgpt\.com\/c\//.test(input.sourceChatUrl)) throw new Error("连续修改上下文不可恢复");
  return { action: "reuse", chatUrl: input.sourceChatUrl };
}

function inlineDeliveryRequirements(count: number): string {
  return [
    `必须调用 ChatGPT 内置图像生成能力，生成 ${count} 张彼此独立的图片。`,
    "每张图片必须直接作为回复正文中的可见生成图片展示。",
    "禁止使用 Python、代码解释器、Canvas 或其他程序创建图片；禁止作为附件、ZIP、文件清单、下载链接或打包文件交付。",
    "不要把多张图片拼成一张，也不要只回复文件名或说明文字。"
  ].join("\n");
}

export function imageGenerationPrompt(prompt: string, count: number): string {
  return `${prompt.trim()}\n\n${inlineDeliveryRequirements(count)}`;
}

export function supplementImagePrompt(remaining: number): string {
  return `请继续生成剩余 ${remaining} 张图片，保持上一轮的内容和风格要求不变。\n\n${inlineDeliveryRequirements(remaining)}`;
}
