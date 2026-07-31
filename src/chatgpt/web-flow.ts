import { join } from "node:path";
import { rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { Locator, Page } from "playwright-core";
import { waitForAutomatedComposer } from "../browser/login.js";
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

const modernTurnSelector = (role: "user" | "assistant") => `[data-turn="${role}"]`;
const legacyTurnSelector = (role: "user" | "assistant") => `[data-message-author-role="${role}"]`;

async function turnLocator(page: Page, role: "user" | "assistant"): Promise<Locator> {
  const modern = page.locator(modernTurnSelector(role));
  return await modern.count() > 0 ? modern : page.locator(legacyTurnSelector(role));
}

async function userMessageTexts(page: Page): Promise<string[]> {
  const modern = page.locator(modernTurnSelector("user"));
  if (await modern.count() === 0) return page.locator(legacyTurnSelector("user")).allTextContents();
  return modern.evaluateAll((turns) => turns.map((turn) => {
    const message = turn.querySelector('[data-message-author-role="user"]') ?? turn;
    return message.textContent ?? "";
  }));
}

async function composerText(composer: Locator): Promise<string> {
  return composer.evaluate((element) => {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value;
    if (element instanceof HTMLElement) return element.innerText;
    return element.textContent ?? "";
  });
}

async function fillStableComposer(page: Page, prompt: string, timeoutMs: number, pollIntervalMs: number): Promise<Locator> {
  const deadline = Date.now() + timeoutMs;
  const expected = prompt.replace(/\s+/g, " ").trim();
  while (Date.now() < deadline) {
    const composer = page.getByRole("textbox", { name: /message|prompt|消息|提问|聊天/i }).filter({ visible: true });
    if (await composer.count() === 1) {
      try {
        await composer.fill(prompt, { timeout: Math.min(2000, Math.max(1, deadline - Date.now())) });
        await page.waitForTimeout(Math.min(150, Math.max(0, deadline - Date.now())));
        const current = page.getByRole("textbox", { name: /message|prompt|消息|提问|聊天/i }).filter({ visible: true });
        if (await current.count() === 1 && (await composerText(current)).replace(/\s+/g, " ").trim() === expected) return current;
      } catch {
        // The SPA can replace the visible composer during hydration; retry only before submit.
      }
    }
    await page.waitForTimeout(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
  }
  throw new Error("PAGE_STRUCTURE_CHANGED: composer");
}

async function downloadBuffer(page: Page, assistant: Locator, resultId: string, resourceUrl: string): Promise<{ event?: () => Promise<Buffer>; exposed: () => Promise<Buffer> }> {
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
  if (options.submit !== false) await waitForAutomatedComposer(page, Math.min(options.timeoutMs, 60_000), options.pollIntervalMs ?? 250);
  const assistantBaseline = await (await turnLocator(page, "assistant")).count();
  const userBaseline = await userMessageTexts(page);
  let initialPageState = "";
  if (options.submit !== false) {
    if ((options.referencePaths?.length ?? 0) > 0) {
      const upload = page.locator('input[type="file"][accept*="image" i]');
      if (await upload.count() === 0) throw new Error("PAGE_STRUCTURE_CHANGED: upload");
      await upload.first().setInputFiles(options.referencePaths as string[]);
    }
    const prepared = prepareSubmission(options.prompt, assistantBaseline + userBaseline.length, userBaseline);
    await options.onPreparedSubmission?.(prepared);
    const composer = await fillStableComposer(page, options.prompt, Math.min(options.timeoutMs, 15_000), options.pollIntervalMs ?? 250);
    const submit = page.getByRole("button", { name: /send|submit|发送/i });
    if (await submit.count() !== 1) throw new Error("PAGE_STRUCTURE_CHANGED: submit");
    await options.onBeforeSubmitClick?.();
    const initialStatePromise = page.waitForFunction((count) => {
      const modern = document.querySelectorAll('[data-turn="assistant"]');
      const response = (modern.length > 0 ? modern : document.querySelectorAll('[data-message-author-role="assistant"]')).item(count);
      return response ? response.getAttribute("data-state") ?? "generating" : false;
    }, assistantBaseline, { timeout: Math.min(options.timeoutMs, 10000) }).then((handle) => handle.jsonValue() as Promise<string>).catch(() => undefined);
    await submit.click();
    await page.waitForFunction((count) => {
      const modern = document.querySelectorAll('[data-turn="user"]');
      return (modern.length > 0 ? modern : document.querySelectorAll('[data-message-author-role="user"]')).length > count;
    }, userBaseline.length, { timeout: Math.min(options.timeoutMs, 10000) });
    const composerEmpty = await composer.evaluate((element) => {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value === "";
      return (element.textContent ?? "").trim() === "";
    });
    const status = confirmSubmission(prepared, { userMessages: await userMessageTexts(page), composerEmpty });
    if (status !== "confirmed") throw new Error(`SUBMISSION_${status.toUpperCase()}`);
    const [capturedState] = await Promise.all([initialStatePromise, options.onSubmissionConfirmed?.()]);
    initialPageState = capturedState ?? "";
  }
  await page.waitForFunction((count) => {
    const modern = document.querySelectorAll('[data-turn="assistant"]');
    return (modern.length > 0 ? modern : document.querySelectorAll('[data-message-author-role="assistant"]')).length > count;
  }, assistantBaseline, { timeout: Math.min(options.timeoutMs, 10000) });
  const assistantIndex = assistantBaseline;
  const assistant = (await turnLocator(page, "assistant")).nth(assistantIndex);
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
    const candidates = await assistant.locator('img[data-result-id], img:not([aria-hidden="true"])[alt]:not([alt=""])').evaluateAll((images) => images.map((node, index) => {
      const image = node as HTMLImageElement;
      const resourceUrl = image.currentSrc || image.src;
      const resultId = image.dataset.resultId || image.id || `image-${index + 1}`;
      return { anchorId: "current", resultId, fingerprint: `${resultId}:${resourceUrl}`, loaded: image.complete, width: image.naturalWidth, height: image.naturalHeight, resourceUrl };
    })) as ImageCandidate[];
    for (const candidate of discovery.observe("current", candidates)) {
      if (await options.isCancelled?.()) throw new Error("TASK_CANCELLED");
      const resultId = candidate.resultId ?? createHash("sha256").update(candidate.resourceUrl).digest("hex").slice(0, 12);
      const source = await downloadBuffer(page, assistant, resultId, candidate.resourceUrl);
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
