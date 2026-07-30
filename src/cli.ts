#!/usr/bin/env node

import { mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright-core";
import { loadConfig } from "./config/load.js";
import { runDoctor } from "./commands/doctor.js";
import { installUserSkill } from "./commands/install.js";
import { cleanupDiagnostics } from "./diagnostics/cleanup.js";
import { inspectChrome } from "./platform/chrome.js";
import { createTaskId } from "./tasks/id.js";
import { createTaskRecord, type TaskRecord, type TaskState } from "./tasks/model.js";
import { createOutputLayout } from "./images/output-layout.js";
import { readTaskRecord, writeTaskRecord } from "./persistence/task-store.js";
import { launchProfile } from "./browser/profile.js";
import { runWebImageFlow } from "./chatgpt/web-flow.js";
import { EventWriter } from "./events/writer.js";
import { ImageReadyEmitter } from "./events/image-ready.js";
import { auditRecovery } from "./persistence/recover.js";
import { readRememberedCount, writeRememberedCount } from "./tasks/count-memory.js";

export interface CliIo { stdout: (line: string) => void; stderr: (line: string) => void; }
const DEFAULT_IO: CliIo = { stdout: (line) => process.stdout.write(`${line}\n`), stderr: (line) => process.stderr.write(`${line}\n`) };

function option(argv: string[], name: string): string | undefined { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; }
function options(argv: string[], name: string): string[] { return argv.flatMap((value, index) => value === name && argv[index + 1] ? [argv[index + 1] as string] : []); }
function flag(argv: string[], name: string): boolean { return argv.includes(name); }

async function findTask(outputRoot: string, taskId: string): Promise<string | null> {
  const base = join(resolve(outputRoot), "gpt-web-images");
  for (const date of await readdir(base, { withFileTypes: true }).catch(() => [])) {
    if (!date.isDirectory()) continue;
    const candidate = join(base, date.name, taskId, "task.json");
    try { await readTaskRecord(candidate); return candidate; } catch { /* continue */ }
  }
  return null;
}

function parsePrompt(argv: string[]): string {
  const explicit = option(argv, "--prompt");
  if (explicit) return explicit;
  const positional = argv.filter((value, index) => index > 0 && !value.startsWith("--") && !["--count", "--ratio", "--reference", "--task-id", "--result-id", "--url", "--output-dir", "--config"].includes(argv[index - 1] ?? ""));
  return positional.join(" ").trim();
}

async function waitForReadyComposer(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(() => {
    const visible = (element: Element) => { const rect = (element as HTMLElement).getBoundingClientRect(); return rect.width > 0 && rect.height > 0; };
    const login = Array.from(document.querySelectorAll("button, a, [role='button']")).some((element) => visible(element) && /log\s*in|sign\s*in|登录/i.test((element.textContent || element.getAttribute("aria-label") || "")));
    const verification = /verify|captcha|安全检查|验证/i.test((document.body.innerText ?? "").slice(0, 5000));
    const composer = Array.from(document.querySelectorAll("[role='textbox'], textarea, input")).some((element) => visible(element) && /message|prompt|消息|提问|聊天/i.test(element.getAttribute("aria-label") ?? element.getAttribute("placeholder") ?? ""));
    return !login && !verification && composer;
  }, undefined, { timeout: timeoutMs });
}

async function runImageCommand(command: "generate" | "edit" | "refine", argv: string[], io: CliIo): Promise<number> {
  const config = await loadConfig({ configPath: option(argv, "--config") });
  const chrome = inspectChrome({ configuredPath: config.chromeExecutablePath ?? undefined });
  if (!chrome.available || !chrome.path) { io.stderr("未找到 Google Chrome"); return 20; }
  const sourceTaskId = option(argv, "--task-id") ?? null;
  let sourceTask: TaskRecord | null = null;
  if (command === "refine") {
    if (!sourceTaskId) { io.stderr("refine 必须提供 --task-id"); return 20; }
    const sourcePath = await findTask(option(argv, "--output-dir") ?? config.fallbackOutputDir, sourceTaskId);
    if (!sourcePath) { io.stderr("找不到连续修改的源任务"); return 20; }
    sourceTask = await readTaskRecord(sourcePath);
    if (!sourceTask.chatUrl) { io.stderr("源任务缺少可恢复会话 URL"); return 41; }
  }
  const prompt = parsePrompt(argv);
  const countMemoryPath = join(resolve(config.profileDir, ".."), "preferences.json");
  const explicitCount = option(argv, "--count");
  const count = Number(explicitCount ?? await readRememberedCount(countMemoryPath, config.defaultImageCount));
  let task: TaskRecord;
  try {
    task = createTaskRecord({ kind: command, prompt, count, aspectRatio: option(argv, "--ratio") ?? null, referencePaths: options(argv, "--reference"), sourceTaskId, sourceResultIds: options(argv, "--result-id"), modifyAll: false }, createTaskId());
  } catch (error) { io.stderr(error instanceof Error ? error.message : String(error)); return 20; }
  if (explicitCount !== undefined) await writeRememberedCount(countMemoryPath, count);
  const outputRoot = option(argv, "--output-dir") ?? config.fallbackOutputDir;
  const layout = await createOutputLayout(outputRoot, new Date(), task.taskId);
  const taskPath = join(layout.taskDir, "task.json");
  await writeTaskRecord(taskPath, task);
  const writer = new EventWriter({ stdout: io.stdout, initialSequence: task.lastEventSeq });
  const images = new ImageReadyEmitter(writer);
  writer.write({ taskId: task.taskId, type: "state", state: "initializing", message: "任务已创建", completed: 0, target: count, recoverable: true });
  const startUrl = option(argv, "--url") ?? sourceTask?.chatUrl ?? "https://chatgpt.com/";
  let session = await launchProfile({ profileDir: config.profileDir, executablePath: chrome.path, headed: flag(argv, "--headed"), url: startUrl });
  try {
    task.state = "submitting"; task.startedAt = new Date().toISOString(); task.updatedAt = task.startedAt;
    await writeTaskRecord(taskPath, task);
    let flowPrompt = prompt;
    let flowTarget = count;
    let finalChatUrl = startUrl;
    for (let round = 0; round <= config.maxSupplementRounds && task.results.length < count; round += 1) {
      if (round > 0) { task.supplementRound = round; flowTarget = count - task.results.length; flowPrompt = `请继续生成剩余 ${flowTarget} 张图片，保持上一轮要求不变。`; await writeTaskRecord(taskPath, task); }
      const executeRound = () => runWebImageFlow({
          page: session.page, prompt: flowPrompt, targetCount: flowTarget, outputLayout: layout, referencePaths: round === 0 ? task.request.referencePaths : [],
          stabilityWindowMs: config.stabilityWindowMs, timeoutMs: config.hardTimeoutMs, knownHashes: new Set(task.results.map((entry) => (entry as { sha256?: string }).sha256).filter((value): value is string => typeof value === "string")),
          onPreparedSubmission: async (submission) => { task.submission = { attemptId: submission.attemptId, baselineMessageCount: submission.baselineMessageCount, baselineImageFingerprints: [], promptFingerprint: submission.promptFingerprint, clickedAt: null, confirmedAt: null, confirmationEvidence: [] }; task.state = "submitting"; await writeTaskRecord(taskPath, task); },
          onBeforeSubmitClick: async () => { task.submission.clickedAt = new Date().toISOString(); await writeTaskRecord(taskPath, task); },
          onSubmissionConfirmed: async () => { task.submission.confirmedAt = new Date().toISOString(); task.submission.confirmationEvidence = ["matching_user_turn", "composer_empty"]; task.state = "submitted"; await writeTaskRecord(taskPath, task); },
          onResponseAnchor: async (anchor, chatUrl) => { task.responseAnchor = anchor; task.chatUrl = chatUrl; await writeTaskRecord(taskPath, task); },
          onState: (state) => writer.write({ taskId: task.taskId, type: "progress", state: state === "queued" ? "queued" : state === "generating" ? "generating" : "partial", message: state, completed: task.results.length, target: count, recoverable: true }),
          onImage: async (image) => { task.results.push(image); task.updatedAt = new Date().toISOString(); await writeTaskRecord(taskPath, task); images.emit(task.taskId, image, task.results.length, count); task.lastEventSeq = writer.currentSequence; await writeTaskRecord(taskPath, task); },
          isCancelled: async () => (await readTaskRecord(taskPath)).cancelRequestedAt !== null
        });
      let result;
      try { result = await executeRound(); }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const needsHandoff = /LOGIN_REQUIRED|HUMAN_VERIFICATION_REQUIRED/.test(message) && task.submission.attemptId === null && session.mode === "headless";
        if (!needsHandoff) throw error;
        task.state = /LOGIN_REQUIRED/.test(message) ? "needs_login" : "needs_human_verification";
        await writeTaskRecord(taskPath, task);
        writer.write({ taskId: task.taskId, type: "warning", state: task.state, message: "需要在专用 Chrome 中完成人工登录或验证", completed: task.results.length, target: count, recoverable: true });
        await session.close();
        session = await launchProfile({ profileDir: config.profileDir, executablePath: chrome.path, headed: true, url: startUrl });
        await waitForReadyComposer(session.page, config.hardTimeoutMs).catch(() => { throw new Error(message); });
        task.state = "ready"; await writeTaskRecord(taskPath, task);
        result = await executeRound();
      }
      finalChatUrl = result.chatUrl;
      if (result.state === "succeeded" && task.results.length >= count) break;
    }
    task.state = task.results.length >= count ? "succeeded" : task.results.length > 0 ? "partial_success" : "failed"; task.chatUrl = finalChatUrl; task.finishedAt = new Date().toISOString(); task.updatedAt = task.finishedAt;
    await writeTaskRecord(taskPath, task);
    writer.write({ taskId: task.taskId, type: "terminal", state: task.state, message: `${task.results.length}/${count} 张图片已交付`, completed: task.results.length, target: count, recoverable: task.state === "partial_success" });
    task.lastEventSeq = writer.currentSequence; await writeTaskRecord(taskPath, task);
    return task.state === "succeeded" ? 0 : 10;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const state: TaskState = /TASK_CANCELLED/.test(message) ? "cancelled" : task.results.length > 0 ? "partial_success" : /LOGIN_REQUIRED/.test(message) ? "needs_login" : /HUMAN_VERIFICATION/.test(message) ? "needs_human_verification" : /PAGE_STRUCTURE_CHANGED/.test(message) ? "structure_changed" : /TIMED_OUT/.test(message) ? "timed_out" : /SUBMISSION/.test(message) ? "result_uncertain" : "failed";
    task.state = state; task.failures.push({ code: message.split(":", 1)[0], message }); task.finishedAt = new Date().toISOString(); task.updatedAt = task.finishedAt;
    await writeTaskRecord(taskPath, task).catch(() => undefined);
    writer.write({ taskId: task.taskId, type: "terminal", state, message: message.replace(/cookie|authorization|token|password/gi, "[REDACTED]"), completed: task.results.length, target: count, recoverable: state !== "failed" });
    task.lastEventSeq = writer.currentSequence; await writeTaskRecord(taskPath, task).catch(() => undefined);
    if (state === "partial_success") return 10;
    if (state === "cancelled") return 43;
    if (state === "needs_login") return 30;
    if (state === "needs_human_verification") return 31;
    if (state === "structure_changed") return 40;
    if (state === "result_uncertain") return 41;
    if (state === "timed_out") return 42;
    return 70;
  } finally { await session.close(); }
}

export async function runCli(argv: string[] = process.argv.slice(2), io: CliIo = DEFAULT_IO): Promise<number> {
  const command = argv[0];
  if (command === "--version" || command === "version") { io.stdout("gpt-web-image 0.1.0"); return 0; }
  try {
    if (command === "doctor") {
      const config = await loadConfig({ configPath: option(argv, "--config") });
      await Promise.all([mkdir(config.profileDir, { recursive: true }), mkdir(config.fallbackOutputDir, { recursive: true })]);
      io.stdout(JSON.stringify(runDoctor({ configuredPath: config.chromeExecutablePath ?? undefined, profileDir: config.profileDir, outputDir: config.fallbackOutputDir })));
      return 0;
    }
    if (command === "cleanup") {
      const config = await loadConfig({ configPath: option(argv, "--config") });
      io.stdout(JSON.stringify(await cleanupDiagnostics(join(config.fallbackOutputDir, "diagnostics"), new Date(), config.diagnosticRetentionDays, flag(argv, "--dry-run"))));
      return 0;
    }
    if (command === "install") { io.stdout(JSON.stringify(await installUserSkill({ projectRoot: resolve(option(argv, "--project-root") ?? process.cwd()), targetDir: option(argv, "--target") }))); return 0; }
    if (command === "generate" || command === "edit" || command === "refine") return runImageCommand(command, argv, io);
    if (command === "resume") {
      const config = await loadConfig({ configPath: option(argv, "--config") }); const taskId = option(argv, "--task-id") ?? argv[1];
      if (!taskId) return 20; const path = await findTask(option(argv, "--output-dir") ?? config.fallbackOutputDir, taskId); if (!path) return 20;
      const decision = auditRecovery(await readTaskRecord(path)); io.stdout(JSON.stringify(decision)); return decision.action === "result_uncertain" ? 41 : 0;
    }
    if (command === "cancel") {
      const config = await loadConfig({ configPath: option(argv, "--config") }); const taskId = option(argv, "--task-id") ?? argv[1];
      if (!taskId) return 20; const path = await findTask(option(argv, "--output-dir") ?? config.fallbackOutputDir, taskId); if (!path) return 20;
      const task = await readTaskRecord(path); task.cancelRequestedAt ??= new Date().toISOString(); if (!task.finishedAt) task.state = "cancelled"; await writeTaskRecord(path, task); io.stdout(JSON.stringify({ taskId, cancelled: true })); return 0;
    }
    if (command === "setup") {
      const config = await loadConfig({ configPath: option(argv, "--config") }); const chrome = inspectChrome({ configuredPath: config.chromeExecutablePath ?? undefined });
      if (!chrome.path) return 20; const session = await launchProfile({ profileDir: config.profileDir, executablePath: chrome.path, headed: true, url: "https://chatgpt.com/" });
      try {
        await waitForReadyComposer(session.page, config.hardTimeoutMs);
        io.stdout(JSON.stringify({ state: "ready" })); return 0;
      }
      finally { await session.close(); }
    }
    io.stderr("未知命令。可用命令：setup, doctor, generate, edit, refine, resume, cancel, cleanup, install"); return 20;
  } catch (error) { io.stderr(error instanceof Error ? error.message : String(error)); return 70; }
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) runCli().then((code) => { process.exitCode = code; });
