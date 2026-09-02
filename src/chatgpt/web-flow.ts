import { join } from "node:path";
import { rename, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { Locator, Page } from "playwright-core";
import { waitForAutomatedComposer } from "../browser/login.js";
import { prepareSubmission, confirmSubmission, normalizeSubmissionText } from "./submit.js";
import { ImageDiscovery, type ImageCandidate } from "../images/discovery.js";
import { downloadOriginal } from "../images/download.js";
import { validateImageFile, ImageValidationError, assertAspectRatioDirection, type ImageResult } from "../images/validate.js";
import type { OutputLayout } from "../images/output-layout.js";
import { sanitizeFileName } from "../platform/paths.js";
import { createPngPreview } from "../images/preview.js";
import type { PreparedSubmission } from "./submit.js";
import type { ResponseAnchor } from "../tasks/model.js";
import { isStableConversationUrl } from "./conversation.js";
import { referenceExpectations, waitForUploadedAttachments, type UploadedAttachmentEvidence } from "./attachments.js";
import { bindMediaCards, type RawMediaCardSnapshot } from "./media-binding.js";

export interface WebImageFlowOptions {
  page: Page;
  prompt: string;
  targetCount: number;
  outputLayout: OutputLayout;
  aspectRatio?: string | null;
  referencePaths?: string[];
  submit?: boolean;
  /** Resume an already-confirmed assistant turn without creating a new submission. */
  resumeAssistantOrdinal?: number;
  resumeUserOrdinal?: number;
  stabilityWindowMs: number;
  pollIntervalMs?: number;
  timeoutMs: number;
  onState?: (state: string) => void;
  onImage?: (image: ImageResult, completed: number, target: number) => void | Promise<void>;
  onPreparedSubmission?: (submission: PreparedSubmission) => void | Promise<void>;
  onBeforeSubmitClick?: () => void | Promise<void>;
  onSubmissionConfirmed?: () => void | Promise<void>;
  onResponseAnchor?: (anchor: ResponseAnchor, chatUrl: string | null) => void | Promise<void>;
  onAttachmentsConfirmed?: (attachments: UploadedAttachmentEvidence[]) => void | Promise<void>;
  knownHashes?: ReadonlySet<string>;
  isCancelled?: () => boolean | Promise<boolean>;
  requireExistingConversation?: boolean;
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

async function conversationLinks(page: Page): Promise<string[]> {
  return page.locator('a[href*="/c/"]').evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).href).filter(Boolean)).catch(() => []);
}

async function composerText(composer: Locator): Promise<string> {
  return composer.evaluate((element) => {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value;
    if (element instanceof HTMLElement) return element.innerText;
    return element.textContent ?? "";
  });
}

async function composerIsEmpty(page: Page): Promise<boolean> {
  const composer = page.getByRole("textbox", { name: /message|prompt|消息|提问|聊天/i }).filter({ visible: true });
  if (await composer.count() !== 1) return false;
  try {
    return await composer.evaluate((element) => {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value === "";
      return (element.textContent ?? "").trim() === "";
    });
  } catch {
    // React may replace the composer while the new conversation route hydrates.
    return false;
  }
}

async function waitForSubmissionConfirmation(page: Page, prepared: PreparedSubmission, baselineConversationLinks: ReadonlySet<string>, timeoutMs: number): Promise<{ status: "confirmed" | "not_submitted" | "uncertain"; conversationUrl: string | null }> {
  const deadline = Date.now() + Math.min(timeoutMs, 10_000);
  let status: "confirmed" | "not_submitted" | "uncertain" = "uncertain";
  while (Date.now() < deadline) {
    const links = await conversationLinks(page);
    const currentUrl = page.url();
    const conversationUrl = links.find((link) => isStableConversationUrl(link) && !baselineConversationLinks.has(link))
      ?? (isStableConversationUrl(currentUrl) && !baselineConversationLinks.has(currentUrl) ? currentUrl : null);
    status = confirmSubmission(prepared, { userMessages: await userMessageTexts(page), composerEmpty: await composerIsEmpty(page), conversationCreated: conversationUrl !== null });
    if (status === "confirmed") return { status, conversationUrl };
    await page.waitForTimeout(100);
  }
  return { status, conversationUrl: null };
}

async function sendClickHadNoEffect(page: Page, prepared: PreparedSubmission, baselineConversationLinks: ReadonlySet<string>): Promise<boolean> {
  await page.waitForTimeout(750);
  const composer = page.getByRole("textbox", { name: /message|prompt|消息|提问|聊天/i }).filter({ visible: true });
  const send = page.getByRole("button", { name: /send|submit|发送/i });
  if (await composer.count() !== 1 || await send.count() !== 1 || !(await send.isEnabled())) return false;
  if (normalizeSubmissionText(await composerText(composer)) !== normalizeSubmissionText(prepared.prompt)) return false;
  if ((await userMessageTexts(page)).length !== prepared.baselineUserMessages.length) return false;
  const currentUrl = page.url();
  if (isStableConversationUrl(currentUrl) && !baselineConversationLinks.has(currentUrl)) return false;
  const links = await conversationLinks(page);
  return !links.some((link) => isStableConversationUrl(link) && !baselineConversationLinks.has(link));
}

async function openSubmittedConversation(page: Page, conversationUrl: string | null): Promise<void> {
  if (!conversationUrl || isStableConversationUrl(page.url())) return;
  await page.goto(conversationUrl, { waitUntil: "domcontentloaded", timeout: 10_000 }).catch(() => undefined);
}

async function waitForExistingConversation(page: Page, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + Math.min(timeoutMs, 15_000);
  while (Date.now() < deadline) {
    const assistants = await page.locator(modernTurnSelector("assistant")).count() || await page.locator(legacyTurnSelector("assistant")).count();
    const users = await page.locator(modernTurnSelector("user")).count() || await page.locator(legacyTurnSelector("user")).count();
    if (assistants > 0 && users > 0) return;
    await page.waitForTimeout(100);
  }
  throw new Error("PAGE_STRUCTURE_CHANGED: conversation");
}

async function waitForAssistantTurn(page: Page, index: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + Math.min(timeoutMs, 30_000);
  while (Date.now() < deadline) {
    const modern = await page.locator(modernTurnSelector("assistant")).count();
    const legacy = modern > 0 ? 0 : await page.locator(legacyTurnSelector("assistant")).count();
    if (Math.max(modern, legacy) > index) return;
    await page.waitForTimeout(100);
  }
  throw new Error("PAGE_STRUCTURE_CHANGED: assistant turn");
}

async function activeTurnSelector(page: Page, role: "user" | "assistant"): Promise<string> {
  const modern = modernTurnSelector(role);
  return await page.locator(modern).count() > 0 ? modern : legacyTurnSelector(role);
}

async function bindSubmittedResponse(
  page: Page,
  expectedPrompt: string,
  baselineUserCount: number,
  baselineAssistantCount: number,
  timeoutMs: number
): Promise<{ assistantIndex: number; userTurnOrdinal: number; assistantTurnOrdinal: number }> {
  const expected = normalizeSubmissionText(expectedPrompt);
  const deadline = Date.now() + Math.min(timeoutMs, 30_000);
  while (Date.now() < deadline) {
    const userSelector = await activeTurnSelector(page, "user");
    const assistantSelector = await activeTurnSelector(page, "assistant");
    const userTexts = await userMessageTexts(page);
    const matches = userTexts
      .map((text, index) => ({ index, text: normalizeSubmissionText(text) }))
      .filter((entry) => entry.index >= baselineUserCount && entry.text === expected);
    const assistantCount = await page.locator(assistantSelector).count();
    if (matches.length === 1 && assistantCount === baselineAssistantCount + 1) {
      const userIndex = matches[0]?.index;
      if (userIndex !== undefined) {
        const adjacent = await page.evaluate(({ userSelector: usersSelector, assistantSelector: assistantsSelector, userIndex: targetUser, assistantIndex: targetAssistant }) => {
          const users = Array.from(document.querySelectorAll(usersSelector));
          const assistants = Array.from(document.querySelectorAll(assistantsSelector));
          const user = users[targetUser];
          const assistant = assistants[targetAssistant];
          if (!user || !assistant || !(user.compareDocumentPosition(assistant) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
          return !users.slice(targetUser + 1).some((candidate) => Boolean(candidate.compareDocumentPosition(assistant) & Node.DOCUMENT_POSITION_FOLLOWING));
        }, { userSelector, assistantSelector, userIndex, assistantIndex: baselineAssistantCount });
        if (adjacent) {
          return {
            assistantIndex: baselineAssistantCount,
            userTurnOrdinal: userIndex + 1,
            assistantTurnOrdinal: baselineAssistantCount + 1
          };
        }
      }
    }
    await page.waitForTimeout(Math.min(100, Math.max(1, deadline - Date.now())));
  }
  throw new Error("RESPONSE_BINDING_UNCERTAIN: 无法唯一绑定本轮用户消息和紧邻助手回复");
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

async function readDownloadBuffer(page: Page, click: () => Promise<void>): Promise<Buffer> {
  const [download] = await Promise.all([page.waitForEvent("download"), click()]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

function generatedImageTitle(alt: string): string {
  return alt.replace(/^已生成图片[：:]\s*/u, "").trim();
}

async function downloadBuffer(page: Page, assistant: Locator, candidate: ImageCandidate): Promise<{ event?: () => Promise<Buffer>; exposed?: () => Promise<Buffer> }> {
  if (candidate.downloadKind === "viewer") {
    if (!candidate.viewerTitle || !candidate.mediaOrdinal || candidate.mediaOrdinal < 1) throw new Error("MEDIA_BINDING_UNCERTAIN: 当前媒体卡缺少查看器身份");
    return {
      event: async () => {
        const images = assistant.locator('img:not([aria-hidden="true"])[alt]:not([alt=""])');
        if (await images.count() < candidate.mediaOrdinal!) throw new Error("MEDIA_BINDING_UNCERTAIN: 当前媒体卡位置已变化");
        const image = images.nth(candidate.mediaOrdinal! - 1);
        const title = generatedImageTitle(await image.getAttribute("alt") ?? "");
        if (title !== candidate.viewerTitle) throw new Error("MEDIA_BINDING_UNCERTAIN: 当前媒体卡标题已变化");
        const opener = image.locator('xpath=ancestor::*[@role="button"][1]');
        if (await opener.count() !== 1) throw new Error("MEDIA_BINDING_UNCERTAIN: 当前媒体卡没有唯一查看器入口");
        await opener.click();
        const dialog = page.locator('[role="dialog"]').filter({ visible: true });
        try {
          await dialog.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
          if (await dialog.count() !== 1) throw new Error("MEDIA_BINDING_UNCERTAIN: 当前媒体卡没有唯一查看器");
          const viewerImages = await dialog.locator('img:not([aria-hidden="true"])').evaluateAll((nodes) => nodes.map((node) => {
            const image = node as HTMLImageElement;
            const rect = image.getBoundingClientRect();
            const style = window.getComputedStyle(image);
            return {
              area: rect.width * rect.height,
              loaded: image.complete,
              naturalWidth: image.naturalWidth,
              naturalHeight: image.naturalHeight,
              visible: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
            };
          }));
          const ranked = viewerImages.filter((image) => image.visible && image.loaded).sort((left, right) => right.area - left.area);
          const dominant = ranked[0];
          const runnerUp = ranked[1];
          if (!dominant || dominant.area <= 0 || (runnerUp && dominant.area < runnerUp.area * 4)) throw new Error("MEDIA_BINDING_UNCERTAIN: 当前查看器没有唯一主图");
          if (dominant.naturalWidth !== candidate.width || dominant.naturalHeight !== candidate.height) throw new Error("MEDIA_BINDING_UNCERTAIN: 当前查看器主图尺寸与媒体卡不一致");
          const save = dialog.getByRole("button", { name: /^(保存|Save)$/i }).filter({ visible: true });
          await save.first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
          if (await save.count() !== 1) throw new Error("MEDIA_BINDING_UNCERTAIN: 当前查看器没有唯一保存按钮");
          return await readDownloadBuffer(page, () => save.click());
        } finally {
          const close = dialog.getByRole("button", { name: /关闭全屏显示|Close full.?screen/i }).filter({ visible: true });
          if (await close.count() === 1) await close.click().catch(() => undefined);
          else await page.keyboard.press("Escape").catch(() => undefined);
        }
      }
    };
  }
  if (!candidate.downloadUrl) throw new Error("MEDIA_BINDING_UNCERTAIN: 当前媒体卡缺少原图下载资源");
  const links = assistant.locator("a[download][data-result-id]");
  const linkIds = await links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-result-id")));
  const matchingIndexes = linkIds.flatMap((value, index) => value === candidate.downloadResultId ? [index] : []);
  const link = matchingIndexes.length === 1 ? links.nth(matchingIndexes[0] as number) : null;
  let event: (() => Promise<Buffer>) | undefined;
  if (link) {
    event = () => readDownloadBuffer(page, () => link.click());
  }
  return {
    ...(event ? { event } : {}),
    exposed: async () => {
      const response = await page.request.get(candidate.downloadUrl as string);
      if (!response.ok()) throw new Error(`媒体卡原图资源下载失败：${response.status()}`);
      return response.body();
    }
  };
}

export async function runWebImageFlow(options: WebImageFlowOptions): Promise<WebImageFlowResult> {
  const { page } = options;
  let baselineConversationLinks = new Set<string>();
  let confirmedConversationUrl: string | null = null;
  if (options.submit !== false) await waitForAutomatedComposer(page, Math.min(options.timeoutMs, 60_000), options.pollIntervalMs ?? 250);
  if (options.requireExistingConversation) await waitForExistingConversation(page, options.timeoutMs);
  const assistantBaseline = await (await turnLocator(page, "assistant")).count();
  const userBaseline = await userMessageTexts(page);
  let initialPageState = "";
  if (options.submit !== false) {
    if ((options.referencePaths?.length ?? 0) > 0) {
      const dedicatedPhotoUpload = page.locator('input[type="file"][data-testid="upload-photos-input"][accept*="image" i]');
      let upload: Locator;
      if (await dedicatedPhotoUpload.count() === 1) {
        upload = dedicatedPhotoUpload;
      } else if (await dedicatedPhotoUpload.count() > 1) {
        throw new Error("PAGE_STRUCTURE_CHANGED: multiple dedicated photo uploads");
      } else {
        const composer = page.getByRole("textbox", { name: /message|prompt|消息|提问|聊天/i }).filter({ visible: true });
        const composerForm = composer.locator("xpath=ancestor::form[1]");
        const legacyImageUpload = composerForm.locator('input[type="file"][accept*="image" i]:not([capture])');
        if (await composer.count() !== 1 || await composerForm.count() !== 1 || await legacyImageUpload.count() !== 1) {
          throw new Error("PAGE_STRUCTURE_CHANGED: upload");
        }
        upload = legacyImageUpload;
      }
      await upload.setInputFiles(options.referencePaths as string[]);
      const attachments = await waitForUploadedAttachments(
        page,
        await referenceExpectations(options.referencePaths as string[]),
        Math.min(options.timeoutMs, 15_000),
        options.pollIntervalMs ?? 250
      );
      await options.onAttachmentsConfirmed?.(attachments);
    }
    const prepared = prepareSubmission(options.prompt, assistantBaseline + userBaseline.length, userBaseline);
    baselineConversationLinks = new Set(await conversationLinks(page));
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
    if (await sendClickHadNoEffect(page, prepared, baselineConversationLinks)) {
      const currentComposer = page.getByRole("textbox", { name: /message|prompt|消息|提问|聊天/i }).filter({ visible: true });
      await currentComposer.press("Enter");
    }
    const clickedAssistant = (await turnLocator(page, "assistant")).nth(assistantBaseline);
    const clickedState = await clickedAssistant.getAttribute("data-state", { timeout: 2_000 }).catch(() => null);
    if (clickedState && !initialPageState) initialPageState = clickedState;
    const confirmation = await waitForSubmissionConfirmation(page, prepared, baselineConversationLinks, options.timeoutMs);
    if (confirmation.status !== "confirmed") throw new Error(`SUBMISSION_${confirmation.status.toUpperCase()}`);
    confirmedConversationUrl = confirmation.conversationUrl;
    await openSubmittedConversation(page, confirmation.conversationUrl);
    const [capturedState] = await Promise.all([initialStatePromise, options.onSubmissionConfirmed?.()]);
    initialPageState ||= capturedState ?? "";
  }
  const responseBinding = options.submit !== false
    ? await bindSubmittedResponse(page, options.prompt, userBaseline.length, assistantBaseline, options.timeoutMs)
    : {
        assistantIndex: Math.max(0, (options.resumeAssistantOrdinal ?? assistantBaseline + 1) - 1),
        userTurnOrdinal: options.resumeUserOrdinal ?? Math.max(1, userBaseline.length),
        assistantTurnOrdinal: options.resumeAssistantOrdinal ?? assistantBaseline + 1
      };
  const assistantIndex = responseBinding.assistantIndex;
  if (options.submit === false) await waitForAssistantTurn(page, assistantIndex, options.timeoutMs);
  const assistant = (await turnLocator(page, "assistant")).nth(assistantIndex);
  const currentChatUrl = page.url();
  let stableChatUrl = isStableConversationUrl(currentChatUrl) ? currentChatUrl : confirmedConversationUrl;
  const responseAnchor = {
    userTurnOrdinal: responseBinding.userTurnOrdinal,
    assistantTurnOrdinal: responseBinding.assistantTurnOrdinal,
    semanticFingerprint: createHash("sha256").update(`${currentChatUrl}:${responseBinding.userTurnOrdinal}:${responseBinding.assistantTurnOrdinal}`).digest("hex"),
    boundAt: new Date().toISOString()
  };
  await options.onResponseAnchor?.(responseAnchor, stableChatUrl);
  if (initialPageState) options.onState?.(initialPageState);
  const discovery = new ImageDiscovery([], options.stabilityWindowMs);
  const knownHashes = new Set(options.knownHashes ?? []);
  const results: ImageResult[] = [];
  const startedAt = Date.now();
  let lastState = initialPageState;
  let completedAt: number | null = null;
  while (Date.now() - startedAt <= options.timeoutMs) {
    if (await options.isCancelled?.()) throw new Error("TASK_CANCELLED");
    if (!stableChatUrl) {
      const observedUrl = page.url();
      stableChatUrl = isStableConversationUrl(observedUrl)
        ? observedUrl
        : options.submit !== false
          ? (await conversationLinks(page)).find((link) => isStableConversationUrl(link) && !baselineConversationLinks.has(link)) ?? null
          : null;
      if (stableChatUrl) await options.onResponseAnchor?.(responseAnchor, stableChatUrl);
    }
    const alert = (await assistant.getByRole("alert").allTextContents()).join(" ");
    if (/429|rate limit/i.test(alert)) throw new Error("RATE_LIMITED");
    if (/5\d\d|server error/i.test(alert)) throw new Error("UPSTREAM_SERVER_ERROR");
    if (/verify|captcha|安全检查|验证/i.test(alert)) throw new Error("HUMAN_VERIFICATION_REQUIRED");
    const pageState = await assistant.getAttribute("data-state") ?? "generating";
    if (pageState !== lastState) { lastState = pageState; options.onState?.(pageState); }
    if (pageState === "complete") completedAt ??= Date.now();
    const rawCandidates = await assistant.locator('img:not([aria-hidden="true"])[alt]:not([alt=""])').evaluateAll((images, anchor) => images.map((node, index) => {
      const image = node as HTMLImageElement;
      const card = image.closest('[data-image-card], [data-image-card-id], [data-image-id], [data-testid*="image" i], figure, a[download], [role="button"]') as HTMLElement | null;
      const viewer = image.closest('[role="button"]') as HTMLElement | null;
      const semanticCard = image.closest('[id^="image-"]') as HTMLElement | null;
      if (semanticCard && !viewer) return null;
      const viewerTitle = image.alt.replace(/^已生成图片[：:]\s*/u, "").trim() || null;
      const nestedDownload = card?.querySelector('a[download], [data-original-url], [data-download-url]') as HTMLElement | null | undefined;
      const download = card?.matches('a[download], [data-original-url], [data-download-url]') ? card : nestedDownload ?? null;
      const downloadUrl = download?.getAttribute("data-original-url")
        || download?.getAttribute("data-download-url")
        || (download instanceof HTMLAnchorElement ? download.href : null);
      const cardId = card?.getAttribute("data-image-card-id")
        || card?.getAttribute("data-image-id")
        || card?.getAttribute("data-result-id")
        || semanticCard?.id
        || download?.getAttribute("data-result-id")
        || (viewer && viewerTitle ? `assistant-${anchor.assistantTurnOrdinal}-media-${index + 1}` : null);
      const resultId = image.dataset.resultId
        || card?.getAttribute("data-result-id")
        || download?.getAttribute("data-result-id")
        || cardId;
      const imageStyle = window.getComputedStyle(image);
      const cardStyle = card ? window.getComputedStyle(card) : null;
      return {
        cardId,
        resultId,
        resourceUrl: image.getAttribute("data-original-url") || card?.getAttribute("data-original-url") || downloadUrl || (viewer && viewerTitle ? `viewer:${anchor.assistantTurnOrdinal}:${index + 1}` : ""),
        downloadUrl,
        downloadResultId: download?.getAttribute("data-result-id") || null,
        viewerTitle,
        viewerAvailable: Boolean(viewer),
        mediaOrdinal: index + 1,
        loaded: image.complete,
        width: image.naturalWidth,
        height: image.naturalHeight,
        visible: imageStyle.display !== "none" && imageStyle.visibility !== "hidden" && image.getClientRects().length > 0 && (!cardStyle || (cardStyle.display !== "none" && cardStyle.visibility !== "hidden")),
        hidden: image.hasAttribute("hidden") || image.getAttribute("aria-hidden") === "true" || Boolean(card?.hasAttribute("hidden")) || card?.getAttribute("aria-hidden") === "true",
        userTurnOrdinal: anchor.userTurnOrdinal,
        assistantTurnOrdinal: anchor.assistantTurnOrdinal
      };
    }).filter((candidate) => candidate !== null), responseBinding) as RawMediaCardSnapshot[];
    const hasPendingAnchoredMedia = rawCandidates.some((card) =>
      card.userTurnOrdinal === responseBinding.userTurnOrdinal
      && card.assistantTurnOrdinal === responseBinding.assistantTurnOrdinal
      && card.visible
      && !card.hidden
      && (!card.loaded || card.width <= 0 || card.height <= 0)
    );
    const anchorId = responseAnchor.semanticFingerprint;
    const candidates = bindMediaCards(rawCandidates, responseBinding).map((candidate) => ({ ...candidate, anchorId })) as ImageCandidate[];
    for (const candidate of discovery.observe(anchorId, candidates)) {
      if (await options.isCancelled?.()) throw new Error("TASK_CANCELLED");
      const resultId = candidate.resultId ?? candidate.cardId;
      if (!resultId || !candidate.cardId) throw new Error("MEDIA_BINDING_UNCERTAIN: 当前媒体卡缺少唯一身份");
      const source = await downloadBuffer(page, assistant, candidate);
      const uniqueId = `${responseBinding.assistantTurnOrdinal}-${resultId}`;
      const destination = join(options.outputLayout.originalDir, sanitizeFileName(`${uniqueId}.download`));
      const downloadResult = await downloadOriginal({ destinationPath: destination, ...(source.event ? { downloadEvent: source.event } : {}), ...(source.exposed ? { exposedResource: source.exposed } : {}) });
      try {
        const image = await validateImageFile(destination, undefined, knownHashes);
        assertAspectRatioDirection(image.width, image.height, options.aspectRatio ?? null);
        const extension = image.mimeType === "image/jpeg" ? ".jpg" : image.mimeType === "image/png" ? ".png" : image.mimeType === "image/webp" ? ".webp" : `.${image.mimeType.split("/")[1] ?? "img"}`;
        const originalPath = join(options.outputLayout.originalDir, sanitizeFileName(`${uniqueId}${extension}`));
        await rename(destination, originalPath);
        image.resultId = uniqueId;
        image.originalPath = originalPath;
        image.provenance = {
          userTurnOrdinal: responseBinding.userTurnOrdinal,
          assistantTurnOrdinal: responseBinding.assistantTurnOrdinal,
          mediaCardId: candidate.cardId,
          downloadMethod: downloadResult.method
        };
        if (image.mimeType !== "image/png") image.previewPath = await createPngPreview(originalPath, join(options.outputLayout.previewDir, sanitizeFileName(`${uniqueId}.png`)));
        knownHashes.add(image.sha256);
        results.push(image);
        options.onState?.("image_ready");
        await options.onImage?.(image, results.length, options.targetCount);
      } catch (error) {
        await unlink(destination).catch(() => undefined);
        if (!(error instanceof ImageValidationError) || !/重复/.test(error.message)) throw error;
      }
    }
    if (results.length >= options.targetCount) return { state: "succeeded", results, chatUrl: stableChatUrl ?? page.url() };
    if (pageState === "complete" && completedAt !== null && Date.now() - completedAt >= options.stabilityWindowMs && !hasPendingAnchoredMedia && !discovery.hasPendingCandidates) {
      if (results.length > 0) return { state: "partial_success", results, chatUrl: stableChatUrl ?? page.url() };
      throw new Error("生成结束但没有合格图片");
    }
    await page.waitForTimeout(options.pollIntervalMs ?? 100);
  }
  if (results.length > 0) return { state: "partial_success", results, chatUrl: stableChatUrl ?? page.url() };
  throw new Error("TASK_TIMED_OUT");
}
