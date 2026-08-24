#!/usr/bin/env node

import { mkdir, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config/load.js";
import { runDoctor } from "./commands/doctor.js";
import { installUserSkill } from "./commands/install.js";
import { cleanupDiagnostics } from "./diagnostics/cleanup.js";
import { inspectChrome } from "./platform/chrome.js";
import { createTaskId } from "./tasks/id.js";
import { createTaskRecord, type TaskRecord, type TaskState } from "./tasks/model.js";
import { createOutputLayout, layoutFromTaskDir } from "./images/output-layout.js";
import { readTaskRecord, writeTaskRecord } from "./persistence/task-store.js";
import { launchProfile, PROFILE_RETENTION_POLICY, profileMarkerPath, type BrowserSession } from "./browser/profile.js";
import { waitForReadyComposer } from "./browser/login.js";
import { runWebImageFlow } from "./chatgpt/web-flow.js";
import { EventWriter } from "./events/writer.js";
import { ImageReadyEmitter } from "./events/image-ready.js";
import { auditRecovery } from "./persistence/recover.js";
import { readRememberedCount, writeRememberedCount } from "./tasks/count-memory.js";
import { openProfileRuntime } from "./profiles/runtime.js";
import { bindActiveProfile } from "./profiles/binding.js";
import { BrowserLease } from "./browser/browser-lease.js";
import { imageGenerationPrompt, supplementImagePrompt, refineImagePrompt, isStableConversationUrl, type RefineSourceDescriptor } from "./chatgpt/conversation.js";
import { ProfileTaskQueue } from "./tasks/profile-queue.js";
import { hashFile } from "./images/hash.js";
import { referenceExpectations } from "./chatgpt/attachments.js";

export interface CliIo { stdout: (line: string) => void; stderr: (line: string) => void; }
const DEFAULT_IO: CliIo = { stdout: (line) => process.stdout.write(`${line}\n`), stderr: (line) => process.stderr.write(`${line}\n`) };
const PACKAGE_VERSION = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;

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

async function resumeObserver(taskPath: string, task: TaskRecord, config: Awaited<ReturnType<typeof loadConfig>>, io: CliIo): Promise<number> {
  const decision = auditRecovery(task);
  if (decision.action !== "resume_observer") { io.stdout(JSON.stringify(decision)); return decision.action === "result_uncertain" ? 41 : 0; }
  if (!task.profileBinding || !task.chatUrl || !task.responseAnchor) { io.stdout(JSON.stringify({ action: "result_uncertain", maySubmit: false, reason: "missing_context" })); return 41; }
  const chrome = inspectChrome({ configuredPath: config.chromeExecutablePath ?? undefined });
  if (!chrome.path) { io.stderr("未找到 Google Chrome"); return 20; }
  const runtime = await openProfileRuntime(config.profileDir);
  const lease = new BrowserLease(runtime.dataRoot, { profileId: task.profileBinding.profileId, profileDir: task.profileBinding.profileDir, ownerType: "task" });
  await lease.acquire();
  let session: BrowserSession;
  try { session = await launchProfile({ profileDir: task.profileBinding.profileDir, executablePath: chrome.path, headed: false, url: task.chatUrl }); }
  catch (error) { await lease.release(); throw error; }
  const layout = layoutFromTaskDir(dirname(taskPath));
  const writer = new EventWriter({ stdout: io.stdout, initialSequence: task.lastEventSeq });
  const images = new ImageReadyEmitter(writer);
  task.state = "recovering"; task.updatedAt = new Date().toISOString(); await writeTaskRecord(taskPath, task);
  writer.write({ taskId: task.taskId, type: "progress", state: "recovering", message: "正在恢复已确认提交的网页监控", completed: task.results.length, target: task.targetCount, recoverable: true });
  try {
    const remaining = Math.max(0, task.targetCount - task.results.length);
    if (remaining === 0) { task.state = "succeeded"; }
    else {
      const result = await runWebImageFlow({
        page: session.page, prompt: task.request.prompt, targetCount: remaining, outputLayout: layout, aspectRatio: task.request.aspectRatio, submit: false, resumeAssistantOrdinal: task.responseAnchor.assistantTurnOrdinal, resumeUserOrdinal: task.responseAnchor.userTurnOrdinal,
        stabilityWindowMs: config.stabilityWindowMs, timeoutMs: config.hardTimeoutMs,
        knownHashes: new Set(task.results.map((entry) => (entry as { sha256?: string }).sha256).filter((value): value is string => typeof value === "string")),
        onState: (state) => writer.write({ taskId: task.taskId, type: "progress", state: state === "queued" ? "queued" : state === "generating" ? "generating" : "partial", message: state, completed: task.results.length, target: task.targetCount, recoverable: true }),
        onImage: async (image) => { task.results.push(image); task.updatedAt = new Date().toISOString(); await writeTaskRecord(taskPath, task); images.emit(task.taskId, image, task.results.length, task.targetCount); task.lastEventSeq = writer.currentSequence; await writeTaskRecord(taskPath, task); },
        isCancelled: async () => (await readTaskRecord(taskPath)).cancelRequestedAt !== null
      });
      task.chatUrl = result.chatUrl; task.state = task.results.length >= task.targetCount ? "succeeded" : "partial_success";
    }
    task.finishedAt = new Date().toISOString(); task.updatedAt = task.finishedAt; await writeTaskRecord(taskPath, task);
    writer.write({ taskId: task.taskId, type: "terminal", state: task.state, message: `恢复完成：${task.results.length}/${task.targetCount} 张图片已交付`, completed: task.results.length, target: task.targetCount, recoverable: task.state === "partial_success" });
    task.lastEventSeq = writer.currentSequence; await writeTaskRecord(taskPath, task);
    return task.state === "succeeded" ? 0 : 10;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    task.state = /TASK_CANCELLED/.test(message) ? "cancelled" : task.results.length > 0 ? "partial_success" : /TIMED_OUT/.test(message) ? "timed_out" : "result_uncertain";
    task.failures.push({ code: message.split(":", 1)[0], message }); task.finishedAt = new Date().toISOString(); task.updatedAt = task.finishedAt; await writeTaskRecord(taskPath, task);
    writer.write({ taskId: task.taskId, type: "terminal", state: task.state, message: message.replace(/cookie|authorization|token|password/gi, "[REDACTED]"), completed: task.results.length, target: task.targetCount, recoverable: true });
    return task.state === "partial_success" ? 10 : 41;
  } finally { await session.close(); await lease.release(); }
}

function parsePrompt(argv: string[]): string {
  const explicit = option(argv, "--prompt");
  if (explicit) return explicit;
  const positional = argv.filter((value, index) => index > 0 && !value.startsWith("--") && !["--count", "--ratio", "--reference", "--task-id", "--result-id", "--url", "--output-dir", "--config"].includes(argv[index - 1] ?? ""));
  return positional.join(" ").trim();
}

async function runImageCommand(command: "generate" | "edit" | "refine", argv: string[], io: CliIo): Promise<number> {
  const config = await loadConfig({ configPath: option(argv, "--config") });
  const runtime = await openProfileRuntime(config.profileDir);
  let profileBinding;
  try { profileBinding = await bindActiveProfile(runtime.store); }
  catch (error) { io.stderr(error instanceof Error ? error.message : String(error)); return 30; }
  const chrome = inspectChrome({ configuredPath: config.chromeExecutablePath ?? undefined });
  if (!chrome.available || !chrome.path) { io.stderr("未找到 Google Chrome"); return 20; }
  const sourceTaskId = option(argv, "--task-id") ?? null;
  let sourceResultIds = options(argv, "--result-id");
  let refineSources: RefineSourceDescriptor[] = [];
  let sourceTask: TaskRecord | null = null;
  if (command === "refine") {
    if (!sourceTaskId) { io.stderr("refine 必须提供 --task-id"); return 20; }
    const sourcePath = await findTask(option(argv, "--output-dir") ?? config.fallbackOutputDir, sourceTaskId);
    if (!sourcePath) { io.stderr("找不到连续修改的源任务"); return 20; }
    sourceTask = await readTaskRecord(sourcePath);
    if (!sourceTask.chatUrl || !isStableConversationUrl(sourceTask.chatUrl)) { io.stderr("源任务缺少稳定、可恢复的 ChatGPT 会话 URL"); return 41; }
    if (sourceTask.profileBinding?.profileId !== profileBinding.profileId || sourceTask.profileBinding.profileDir !== profileBinding.profileDir) { io.stderr("图改图源任务与当前启用 Profile 不一致"); return 20; }
    const sourceResults = sourceTask.results.flatMap((entry, index) => {
      const result = entry as { resultId?: unknown; provenance?: { assistantTurnOrdinal?: unknown } };
      return typeof result.resultId === "string" ? [{ resultId: result.resultId, index, provenance: result.provenance }] : [];
    });
    if (sourceResultIds.length === 0) {
      if (sourceResults.length !== 1) { io.stderr("图改图源任务包含多张图片，必须明确提供 --result-id"); return 20; }
      sourceResultIds = [sourceResults[0]?.resultId as string];
    }
    const selected = sourceResultIds.map((resultId) => sourceResults.find((entry) => entry.resultId === resultId));
    if (selected.some((entry) => !entry)) { io.stderr("图改图指定的 --result-id 不属于源任务"); return 20; }
    if (selected.some((entry) => !Number.isInteger(entry?.provenance?.assistantTurnOrdinal))) { io.stderr("图改图源结果缺少一一对应的助手回合证据"); return 41; }
    refineSources = selected.map((entry) => ({ assistantTurnOrdinal: entry?.provenance?.assistantTurnOrdinal as number, resultPosition: (entry?.index as number) + 1 }));
  }
  const prompt = parsePrompt(argv);
  const countMemoryPath = join(runtime.dataRoot, "preferences.json");
  const explicitCount = option(argv, "--count");
  const count = Number(explicitCount ?? await readRememberedCount(countMemoryPath, config.defaultImageCount));
  let task: TaskRecord;
  try {
    task = createTaskRecord({ kind: command, prompt, count, aspectRatio: option(argv, "--ratio") ?? null, referencePaths: options(argv, "--reference"), sourceTaskId, sourceResultIds, modifyAll: false }, createTaskId(), new Date(), profileBinding);
  } catch (error) { io.stderr(error instanceof Error ? error.message : String(error)); return 20; }
  if (task.request.referencePaths.length > 0) {
    const expectations = await referenceExpectations(task.request.referencePaths);
    task.referenceEvidence = await Promise.all(expectations.map(async (entry, index) => ({ ...entry, sha256: await hashFile(task.request.referencePaths[index] as string) })));
  }
  if (explicitCount !== undefined) await writeRememberedCount(countMemoryPath, count);
  const outputRoot = option(argv, "--output-dir") ?? config.fallbackOutputDir;
  const layout = await createOutputLayout(outputRoot, new Date(), task.taskId);
  const taskPath = join(layout.taskDir, "task.json");
  await writeTaskRecord(taskPath, task);
  const writer = new EventWriter({ stdout: io.stdout, initialSequence: task.lastEventSeq });
  const images = new ImageReadyEmitter(writer);
  writer.write({ taskId: task.taskId, type: "state", state: "initializing", message: "任务已创建", completed: 0, target: count, recoverable: true });
  const startUrl = option(argv, "--url") ?? sourceTask?.chatUrl ?? "https://chatgpt.com/";
  const profileQueue = new ProfileTaskQueue(runtime.dataRoot, profileBinding.profileId);
  const queuePosition = await profileQueue.enqueue(task.taskId);
  task.queuePosition = queuePosition;
  task.state = "queued";
  await writeTaskRecord(taskPath, task);
  writer.write({ taskId: task.taskId, type: "progress", state: "queued", message: `已进入 Profile 队列，第 ${queuePosition} 位`, completed: 0, target: count, recoverable: true });
  try {
    await profileQueue.waitForTurn(task.taskId, async () => (await readTaskRecord(taskPath)).cancelRequestedAt !== null, config.hardTimeoutMs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    task.state = /QUEUE_CANCELLED/.test(message) ? "cancelled" : "failed";
    task.queuePosition = null;
    task.failures.push({ code: message.split(":", 1)[0], message });
    task.finishedAt = new Date().toISOString();
    task.updatedAt = task.finishedAt;
    await writeTaskRecord(taskPath, task);
    writer.write({ taskId: task.taskId, type: "terminal", state: task.state, message: task.state === "cancelled" ? "任务已取消" : message, completed: 0, target: count, recoverable: false });
    return task.state === "cancelled" ? 43 : 70;
  }
  task.queuePosition = null;
  task.state = "ready";
  task.updatedAt = new Date().toISOString();
  await writeTaskRecord(taskPath, task);
  const browserLease = new BrowserLease(runtime.dataRoot, { profileId: profileBinding.profileId, profileDir: profileBinding.profileDir, ownerType: "task" });
  try { await browserLease.acquire(); }
  catch (error) { await profileQueue.release(task.taskId); throw error; }
  let session: BrowserSession;
  try {
    session = await launchProfile({ profileDir: profileBinding.profileDir, executablePath: chrome.path, headed: flag(argv, "--headed"), url: startUrl });
  } catch (error) {
    await browserLease.release();
    await profileQueue.release(task.taskId);
    throw error;
  }
  try {
    task.state = "submitting"; task.startedAt = new Date().toISOString(); task.updatedAt = task.startedAt;
    await writeTaskRecord(taskPath, task);
    let flowPrompt = command === "refine"
      ? refineImagePrompt(prompt, count, refineSources, task.request.aspectRatio)
      : imageGenerationPrompt(prompt, count, task.request.aspectRatio);
    let flowTarget = count;
    let finalChatUrl = startUrl;
    for (let round = 0; round <= config.maxSupplementRounds && task.results.length < count; round += 1) {
      if (round > 0) { task.supplementRound = round; flowTarget = count - task.results.length; flowPrompt = supplementImagePrompt(flowTarget, task.request.aspectRatio); await writeTaskRecord(taskPath, task); }
      const executeRound = () => runWebImageFlow({
          page: session.page, prompt: flowPrompt, targetCount: flowTarget, outputLayout: layout, aspectRatio: task.request.aspectRatio, referencePaths: round === 0 ? task.request.referencePaths : [],
          requireExistingConversation: command === "refine",
          stabilityWindowMs: config.stabilityWindowMs, timeoutMs: config.hardTimeoutMs, knownHashes: new Set(task.results.map((entry) => (entry as { sha256?: string }).sha256).filter((value): value is string => typeof value === "string")),
          onPreparedSubmission: async (submission) => { task.submission = { attemptId: submission.attemptId, baselineMessageCount: submission.baselineMessageCount, baselineImageFingerprints: [], promptFingerprint: submission.promptFingerprint, clickedAt: null, confirmedAt: null, confirmationEvidence: [...task.submission.confirmationEvidence] }; task.state = "submitting"; await writeTaskRecord(taskPath, task); },
          onBeforeSubmitClick: async () => { task.submission.clickedAt = new Date().toISOString(); await writeTaskRecord(taskPath, task); },
          onSubmissionConfirmed: async () => { task.submission.confirmedAt = new Date().toISOString(); task.submission.confirmationEvidence = [...new Set([...task.submission.confirmationEvidence, "matching_user_turn", "composer_empty"])]; task.state = "submitted"; await writeTaskRecord(taskPath, task); },
          onModelSelected: async (selection) => { task.modelSelection = selection; task.modelSelections.push(selection); task.updatedAt = new Date().toISOString(); await writeTaskRecord(taskPath, task); },
          onAttachmentsConfirmed: async (attachments) => { task.submission.confirmationEvidence = [...new Set([...task.submission.confirmationEvidence, "reference_attachment_visible", ...attachments.map((entry) => `reference:${entry.fileName}`)])]; task.updatedAt = new Date().toISOString(); await writeTaskRecord(taskPath, task); },
          onResponseAnchor: async (anchor, chatUrl) => { task.responseAnchor = anchor; task.chatUrl = chatUrl; await writeTaskRecord(taskPath, task); },
          onState: (state) => writer.write({ taskId: task.taskId, type: "progress", state: state === "queued" ? "queued" : state === "generating" ? "generating" : "partial", message: state, completed: task.results.length, target: count, recoverable: true }),
          onImage: async (image) => {
            const latest = await readTaskRecord(taskPath).catch(() => task);
            task.cancelRequestedAt ??= latest.cancelRequestedAt;
            task.results.push(image); task.updatedAt = new Date().toISOString(); await writeTaskRecord(taskPath, task);
            images.emit(task.taskId, image, task.results.length, count); task.lastEventSeq = writer.currentSequence; await writeTaskRecord(taskPath, task);
          },
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
        session = await launchProfile({ profileDir: profileBinding.profileDir, executablePath: chrome.path, headed: true, url: startUrl });
        await waitForReadyComposer(session.page, config.hardTimeoutMs).catch(() => { throw new Error(message); });
        task.state = "ready"; await writeTaskRecord(taskPath, task);
        result = await executeRound();
      }
      finalChatUrl = result.chatUrl;
      if (result.state === "succeeded" && task.results.length >= count) break;
    }
    const latestBeforeFinish = await readTaskRecord(taskPath).catch(() => task);
    task.cancelRequestedAt ??= latestBeforeFinish.cancelRequestedAt;
    task.state = task.cancelRequestedAt ? "cancelled" : task.results.length >= count ? "succeeded" : task.results.length > 0 ? "partial_success" : "failed"; task.chatUrl = finalChatUrl; task.finishedAt = new Date().toISOString(); task.updatedAt = task.finishedAt;
    await writeTaskRecord(taskPath, task);
    writer.write({ taskId: task.taskId, type: "terminal", state: task.state, message: `${task.results.length}/${count} 张图片已交付`, completed: task.results.length, target: count, recoverable: task.state === "partial_success" });
    task.lastEventSeq = writer.currentSequence; await writeTaskRecord(taskPath, task);
    return task.state === "succeeded" ? 0 : 10;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const latestTask = await readTaskRecord(taskPath).catch(() => task);
    task.cancelRequestedAt ??= latestTask.cancelRequestedAt;
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
  } finally { await session.close(); await browserLease.release(); await profileQueue.release(task.taskId); }
}

export async function runCli(argv: string[] = process.argv.slice(2), io: CliIo = DEFAULT_IO): Promise<number> {
  const command = argv[0];
  if (command === "--version" || command === "version") { io.stdout(`gpt-web-image ${PACKAGE_VERSION}`); return 0; }
  try {
    if (command === "doctor") {
      const config = await loadConfig({ configPath: option(argv, "--config") });
      await Promise.all([mkdir(config.profileDir, { recursive: true }), mkdir(config.fallbackOutputDir, { recursive: true })]);
      io.stdout(JSON.stringify(runDoctor({ configuredPath: config.chromeExecutablePath ?? undefined, profileDir: config.profileDir, outputDir: config.fallbackOutputDir })));
      return 0;
    }
    if (command === "cleanup") {
      const config = await loadConfig({ configPath: option(argv, "--config") });
      io.stdout(JSON.stringify(await cleanupDiagnostics(join(config.fallbackOutputDir, "diagnostics"), new Date(), config.diagnosticRetentionDays, flag(argv, "--dry-run"), config.profileDir)));
      return 0;
    }
    if (command === "install") { io.stdout(JSON.stringify(await installUserSkill({ projectRoot: resolve(option(argv, "--project-root") ?? process.cwd()), targetDir: option(argv, "--target") }))); return 0; }
    if (command === "generate" || command === "edit" || command === "refine") return runImageCommand(command, argv, io);
    if (command === "resume") {
      const config = await loadConfig({ configPath: option(argv, "--config") }); const taskId = option(argv, "--task-id") ?? argv[1];
      if (!taskId) return 20; const path = await findTask(option(argv, "--output-dir") ?? config.fallbackOutputDir, taskId); if (!path) return 20;
      return resumeObserver(path, await readTaskRecord(path), config, io);
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
        io.stdout(JSON.stringify({ state: "ready", profileDir: resolve(config.profileDir), markerPath: profileMarkerPath(config.profileDir), retentionPolicy: PROFILE_RETENTION_POLICY })); return 0;
      }
      finally { await session.close(); }
    }
    io.stderr("未知命令。可用命令：setup, doctor, generate, edit, refine, resume, cancel, cleanup, install"); return 20;
  } catch (error) { io.stderr(error instanceof Error ? error.message : String(error)); return 70; }
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) runCli().then((code) => { process.exitCode = code; });
