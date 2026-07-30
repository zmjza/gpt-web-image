import { join } from "node:path";
import { rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { Page } from "playwright-core";
import { prepareSubmission, confirmSubmission } from "./submit.js";
import { ImageDiscovery, type ImageCandidate } from "../images/discovery.js";
import { downloadOriginal } from "../images/download.js";
import { validateImageFile, ImageValidationError, type ImageResult } from "../images/validate.js";
import type { OutputLayout } from "../images/output-layout.js";
import { sanitizeFileName } from "../platform/paths.js";
import { createPngPreview } from "../images/preview.js";
import type { PreparedSubmission } from "./submit.js";
import type { ResponseAnchor } from "../tasks/model.js";

export interface WebImageFlowOptions {
  page: Page;
  prompt: string;
  targetCount: number;
  outputLayout: OutputLayout;
  referencePaths?: string[];
  submit?: boolean;
  stabilityWindowMs: number;
  pollIntervalMs?: number;
  timeoutMs: number;
  onState?: (state: string) => void;
  onImage?: (image: ImageResult, completed: number, target: number) => void | Promise<void>;
  onPreparedSubmission?: (submission: PreparedSubmission) => void | Promise<void>;
  onBeforeSubmitClick?: () => void | Promise<void>;
  onSubmissionConfirmed?: () => void | Promise<void>;
  onResponseAnchor?: (anchor: ResponseAnchor, chatUrl: string) => void | Promise<void>;
  knownHashes?: ReadonlySet<string>;
  isCancelled?: () => boolean | Promise<boolean>;
}
export interface WebImageFlowResult { state: "succeeded" | "partial_success"; results: ImageResult[]; chatUrl: string; }

async function downloadBuffer(page: Page, assistantIndex: number, resultId: string, resourceUrl: string): Promise<{ event?: () => Promise<Buffer>; exposed: () => Promise<Buffer> }> {
  const assistant = page.locator('[data-message-author-role="assistant"]').nth(assistantIndex);
  const link = assistant.locator(`a[download][data-result-id="${resultId}"]`);
  let event: (() => Promise<Buffer>) | undefined;
  if (await link.count() === 1) {
    event = async () => {
      const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
      const stream = await download.createReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
      return Buffer.concat(chunks);
    };
  }
  return {
    ...(event ? { event } : {}),
    exposed: async () => {
      const response = await page.request.get(resourceUrl);
      if (!response.ok()) throw new Error(`公开图片资源下载失败：${response.status()}`);
      return response.body();
    }
  };
}

export async function runWebImageFlow(options: WebImageFlowOptions): Promise<WebImageFlowResult> {
  const { page } = options;
  const assistantBaseline = await page.locator('[data-message-author-role="assistant"]').count();
  const userBaseline = await page.locator('[data-message-author-role="user"]').allTextContents();
  let initialPageState = "";
  if (options.submit !== false) {
    const composer = page.getByRole("textbox", { name: /message|prompt|消息|提问/i });
    if (await composer.count() !== 1) {
      if (await page.getByRole("button", { name: /log\s*in|sign\s*in|登录/i }).count() > 0 || /\/auth\/login/i.test(page.url())) throw new Error("LOGIN_REQUIRED");
      if (/verify|captcha|安全检查|验证/i.test((await page.locator("body").innerText()).slice(0, 5000))) throw new Error("HUMAN_VERIFICATION_REQUIRED");
      throw new Error("PAGE_STRUCTURE_CHANGED: composer");
    }
    if ((options.referencePaths?.length ?? 0) > 0) {
      const upload = page.locator('input[type="file"]');
      if (await upload.count() !== 1) throw new Error("PAGE_STRUCTURE_CHANGED: upload");
      await upload.setInputFiles(options.referencePaths as string[]);
    }
    const prepared = prepareSubmission(options.prompt, assistantBaseline + userBaseline.length, userBaseline);
    await options.onPreparedSubmission?.(prepared);
    await composer.fill(options.prompt);
    const submit = page.getByRole("button", { name: /send|submit|发送/i });
    if (await submit.count() !== 1) throw new Error("PAGE_STRUCTURE_CHANGED: submit");
    await options.onBeforeSubmitClick?.();
    const initialStatePromise = page.waitForFunction((count) => {
      const response = document.querySelectorAll('[data-message-author-role="assistant"]').item(count);
      return response ? response.getAttribute("data-state") ?? "generating" : false;
    }, assistantBaseline, { timeout: Math.min(options.timeoutMs, 10000) }).then((handle) => handle.jsonValue() as Promise<string>).catch(() => undefined);
    await submit.click();
    await page.waitForFunction((count) => document.querySelectorAll('[data-message-author-role="user"]').length > count, userBaseline.length, { timeout: Math.min(options.timeoutMs, 10000) });
    const status = confirmSubmission(prepared, { userMessages: await page.locator('[data-message-author-role="user"]').allTextContents(), composerEmpty: (await composer.inputValue()) === "" });
    if (status !== "confirmed") throw new Error(`SUBMISSION_${status.toUpperCase()}`);
    const [capturedState] = await Promise.all([initialStatePromise, options.onSubmissionConfirmed?.()]);
    initialPageState = capturedState ?? "";
  }
  await page.waitForFunction((count) => document.querySelectorAll('[data-message-author-role="assistant"]').length > count, assistantBaseline, { timeout: Math.min(options.timeoutMs, 10000) });
  const assistantIndex = assistantBaseline;
  const assistant = page.locator('[data-message-author-role="assistant"]').nth(assistantIndex);
  await options.onResponseAnchor?.({ userTurnOrdinal: userBaseline.length + 1, assistantTurnOrdinal: assistantIndex + 1, semanticFingerprint: createHash("sha256").update(`${page.url()}:${userBaseline.length + 1}:${assistantIndex + 1}`).digest("hex"), boundAt: new Date().toISOString() }, page.url());
  if (initialPageState) options.onState?.(initialPageState);
  const discovery = new ImageDiscovery([], options.stabilityWindowMs);
  const knownHashes = new Set(options.knownHashes ?? []);
  const results: ImageResult[] = [];
  const startedAt = Date.now();
  let lastState = initialPageState;
  let completedAt: number | null = null;
  while (Date.now() - startedAt <= options.timeoutMs) {
    if (await options.isCancelled?.()) throw new Error("TASK_CANCELLED");
    const alert = (await assistant.getByRole("alert").allTextContents()).join(" ");
    if (/429|rate limit/i.test(alert)) throw new Error("RATE_LIMITED");
    if (/5\d\d|server error/i.test(alert)) throw new Error("UPSTREAM_SERVER_ERROR");
    if (/verify|captcha|安全检查|验证/i.test(alert)) throw new Error("HUMAN_VERIFICATION_REQUIRED");
    const pageState = await assistant.getAttribute("data-state") ?? "generating";
    if (pageState !== lastState) { lastState = pageState; options.onState?.(pageState); }
    if (pageState === "complete") completedAt ??= Date.now();
    const candidates = await assistant.locator("img[data-result-id]").evaluateAll((images) => images.map((node) => {
      const image = node as HTMLImageElement;
      return { anchorId: "current", fingerprint: `${image.dataset.resultId}:${image.currentSrc || image.src}`, loaded: image.complete, width: image.naturalWidth, height: image.naturalHeight, resourceUrl: image.currentSrc || image.src };
    })) as ImageCandidate[];
    for (const candidate of discovery.observe("current", candidates)) {
      const resultId = candidate.fingerprint.split(":", 1)[0] ?? `result-${results.length + 1}`;
      const source = await downloadBuffer(page, assistantIndex, resultId, candidate.resourceUrl);
      const uniqueId = `${assistantIndex + 1}-${resultId}`;
      const destination = join(options.outputLayout.originalDir, sanitizeFileName(`${uniqueId}.download`));
      await downloadOriginal({ destinationPath: destination, ...(source.event ? { downloadEvent: source.event } : {}), exposedResource: source.exposed });
      try {
        const image = await validateImageFile(destination, undefined, knownHashes);
        const extension = image.mimeType === "image/jpeg" ? ".jpg" : image.mimeType === "image/png" ? ".png" : image.mimeType === "image/webp" ? ".webp" : `.${image.mimeType.split("/")[1] ?? "img"}`;
        const originalPath = join(options.outputLayout.originalDir, sanitizeFileName(`${uniqueId}${extension}`));
        await rename(destination, originalPath);
        image.resultId = uniqueId;
        image.originalPath = originalPath;
        if (image.mimeType !== "image/png") image.previewPath = await createPngPreview(originalPath, join(options.outputLayout.previewDir, sanitizeFileName(`${uniqueId}.png`)));
        knownHashes.add(image.sha256);
        results.push(image);
        options.onState?.("image_ready");
        await options.onImage?.(image, results.length, options.targetCount);
      } catch (error) {
        if (!(error instanceof ImageValidationError) || !/重复/.test(error.message)) throw error;
      }
    }
    if (results.length >= options.targetCount) return { state: "succeeded", results, chatUrl: page.url() };
    if (pageState === "complete" && completedAt !== null && Date.now() - completedAt >= options.stabilityWindowMs && !discovery.hasPendingCandidates) {
      if (results.length > 0) return { state: "partial_success", results, chatUrl: page.url() };
      throw new Error("生成结束但没有合格图片");
    }
    await page.waitForTimeout(options.pollIntervalMs ?? 100);
  }
  if (results.length > 0) return { state: "partial_success", results, chatUrl: page.url() };
  throw new Error("TASK_TIMED_OUT");
}
