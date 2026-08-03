import test from "node:test";
import assert from "node:assert/strict";
import { conversationPlan, imageGenerationPrompt, supplementImagePrompt } from "../../src/chatgpt/conversation.js";
import { resolveSemanticTarget, SemanticLocatorError } from "../../src/chatgpt/locators.js";
import { prepareSubmission, confirmSubmission, decideRetry } from "../../src/chatgpt/submit.js";
import { bindResponseAnchor } from "../../src/chatgpt/response-anchor.js";

test("T20 creates fresh conversations for generate/edit and reuses refine context", () => {
  assert.equal(conversationPlan({ kind: "generate", sourceChatUrl: null }).action, "new");
  assert.equal(conversationPlan({ kind: "edit", sourceChatUrl: null }).action, "new");
  assert.deepEqual(conversationPlan({ kind: "refine", sourceChatUrl: "https://chatgpt.com/c/1" }), { action: "reuse", chatUrl: "https://chatgpt.com/c/1" });
  assert.throws(() => conversationPlan({ kind: "refine", sourceChatUrl: null }), /上下文不可恢复/);
});

test("T20 forces native inline image delivery and forbids attachment bundles", () => {
  const prompt = imageGenerationPrompt("生成十张几何图", 10);
  assert.match(prompt, /内置图像生成能力/);
  assert.match(prompt, /10 张彼此独立/);
  assert.match(prompt, /禁止.*附件.*ZIP.*文件清单.*下载链接/);
  assert.match(prompt, /禁止.*网页.*表格/);
  assert.match(prompt, /真实、可见、可预览.*逐张渲染/);
  assert.match(prompt, /原生图片预览.*图片名称.*文件图标.*附件卡片/);
  assert.match(prompt, /下载全部.*打包下载/);
  assert.match(prompt, /文件卡片.*文件列表.*原生图片预览.*失败/);
  assert.match(prompt, /无法.*直接显示图片.*生成失败/);
  assert.match(prompt, /不要把多张图片拼成一张/);
  assert.match(supplementImagePrompt(7), /剩余 7 张/);
  assert.match(supplementImagePrompt(7), /内置图像生成能力/);
});

test("T21 resolves by accessible semantics and rejects conflicts", () => {
  const nodes = [{ id: "random-a", role: "textbox", name: "Message ChatGPT", visible: true }, { id: "random-b", role: "button", name: "Send prompt", visible: true }];
  assert.equal(resolveSemanticTarget(nodes, "composer").id, "random-a");
  assert.equal(resolveSemanticTarget(nodes, "submit").id, "random-b");
  assert.throws(() => resolveSemanticTarget([...nodes, { id: "other", role: "textbox", name: "Message ChatGPT", visible: true }], "composer"), SemanticLocatorError);
});

test("T21 accepts the current ChatGPT Chinese composer name", () => {
  assert.equal(resolveSemanticTarget([{ id: "chat-a", role: "textbox", name: "与 ChatGPT 聊天", visible: true }], "composer").id, "chat-a");
});

test("T22 classifies confirmed, definitely absent and uncertain submissions without blind retry", () => {
  const prepared = prepareSubmission("画一张海报", 4, ["old"]);
  assert.ok(prepared.attemptId);
  assert.equal(confirmSubmission(prepared, { userMessages: ["old", "画一张海报"], composerEmpty: true }), "confirmed");
  assert.equal(confirmSubmission(prepared, { userMessages: ["old", "你说：画一张海报展开收起"], composerEmpty: true }), "confirmed");
  assert.equal(confirmSubmission(prepared, { userMessages: ["old"], composerEmpty: true, conversationCreated: true }), "confirmed");
  assert.equal(confirmSubmission(prepared, { userMessages: ["old"], composerEmpty: false, clickFailedBeforeDispatch: true }), "not_submitted");
  assert.equal(confirmSubmission(prepared, { userMessages: ["old"], composerEmpty: true }), "uncertain");
  assert.equal(decideRetry("confirmed"), false);
  assert.equal(decideRetry("uncertain"), false);
  assert.equal(decideRetry("not_submitted"), true);
});

test("T23 binds only the assistant turn adjacent to this user turn", () => {
  const turns = [
    { ordinal: 1, role: "user" as const, text: "旧请求", imageFingerprints: [] },
    { ordinal: 2, role: "assistant" as const, text: "旧回复", imageFingerprints: ["old"] },
    { ordinal: 3, role: "user" as const, text: "画一张海报", imageFingerprints: [] },
    { ordinal: 4, role: "assistant" as const, text: "本轮回复", imageFingerprints: ["new"] }
  ];
  const anchor = bindResponseAnchor(turns, 3, new Date("2026-07-30T00:00:00Z"));
  assert.equal(anchor.assistantTurnOrdinal, 4);
  assert.throws(() => bindResponseAnchor([...turns, { ordinal: 5, role: "assistant", text: "冲突", imageFingerprints: [] }], 3, new Date()), /唯一/);
});
