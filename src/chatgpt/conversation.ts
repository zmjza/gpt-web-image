import type { RequestKind } from "../input/parse-request.js";

export type ConversationPlan = { action: "new"; chatUrl: null } | { action: "reuse"; chatUrl: string };
export function conversationPlan(input: { kind: RequestKind; sourceChatUrl: string | null }): ConversationPlan {
  if (input.kind !== "refine") return { action: "new", chatUrl: null };
  if (!input.sourceChatUrl || !/^https:\/\/chatgpt\.com\/c\//.test(input.sourceChatUrl)) throw new Error("连续修改上下文不可恢复");
  return { action: "reuse", chatUrl: input.sourceChatUrl };
}

function inlineDeliveryRequirements(count: number): string {
  return [
    `只使用 ChatGPT 内置图像生成能力，生成 ${count} 张彼此独立的图片。`,
    "每张图片都必须在这一条回复正文中作为真实、可见、可预览的生成图片逐张渲染；生成一张就直接显示一张。",
    "交付格式是原生图片预览：回复中必须实际出现可查看的图片内容，而不是图片名称、文件图标、附件卡片或下载按钮。",
    "禁止使用 Python、代码解释器、Canvas、HTML、Markdown 模拟图、脚本或其他程序创建、拼接或导出图片。",
    "禁止返回附件卡片、文件图标、PNG/JPG 文件列表、ZIP、压缩包、‘下载全部’、‘打包下载’、文件清单、文件名列表、下载链接、网页、表格或仅包含说明文字的结果。",
    "不要先列出文件名再提供下载；不要把多张图片拼成一张；不要把图片转成文件交付；不要在回复中声称已生成却不直接显示图片。",
    "如果界面只能提供文件卡片、文件列表或下载入口，而不能逐张显示原生图片预览，则本次交付视为失败并明确说明，不要声称成功。",
    "如果无法以内置图像生成方式直接显示图片，明确报告生成失败，不要改用文件或代码交付。"
  ].join("\n");
}

export function imageGenerationPrompt(prompt: string, count: number): string {
  return `${prompt.trim()}\n\n${inlineDeliveryRequirements(count)}`;
}

export function supplementImagePrompt(remaining: number): string {
  return `请继续生成剩余 ${remaining} 张图片，保持上一轮的内容和风格要求不变。\n\n${inlineDeliveryRequirements(remaining)}`;
}
