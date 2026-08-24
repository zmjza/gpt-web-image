import { basename } from "node:path";
import { stat } from "node:fs/promises";
import type { Page } from "playwright-core";

export interface AttachmentExpectation { fileName: string; byteLength: number; }
export interface UploadedAttachmentEvidence { fileName: string; byteLength: number | null; ready?: boolean; }

export class AttachmentUploadError extends Error {
  public constructor(public readonly code: "ATTACHMENT_UPLOAD_UNCONFIRMED" | "ATTACHMENT_IDENTITY_MISMATCH", message: string) { super(`${code}: ${message}`); }
}

export function matchUploadedAttachments(expected: readonly AttachmentExpectation[], actual: readonly UploadedAttachmentEvidence[]): UploadedAttachmentEvidence[] {
  if (expected.length === 0) return [];
  if (actual.length === 0) throw new AttachmentUploadError("ATTACHMENT_UPLOAD_UNCONFIRMED", "网页输入区没有可验证的参考图附件。");
  if (actual.some((candidate) => candidate.ready === false)) throw new AttachmentUploadError("ATTACHMENT_UPLOAD_UNCONFIRMED", "网页参考图附件尚未完成上传。");
  if (actual.length !== expected.length) throw new AttachmentUploadError("ATTACHMENT_IDENTITY_MISMATCH", "网页输入区的参考图数量与任务不一致。");
  const remaining = [...actual];
  for (const item of expected) {
    const index = remaining.findIndex((candidate) => candidate.fileName === item.fileName && (candidate.byteLength === null || candidate.byteLength === item.byteLength));
    if (index < 0) throw new AttachmentUploadError("ATTACHMENT_IDENTITY_MISMATCH", `网页附件与本地参考图不一致：${item.fileName}`);
    remaining.splice(index, 1);
  }
  return [...actual];
}

export async function referenceExpectations(paths: readonly string[]): Promise<AttachmentExpectation[]> {
  return Promise.all(paths.map(async (path) => ({ fileName: basename(path), byteLength: (await stat(path)).size })));
}

export async function waitForUploadedAttachments(page: Page, expected: readonly AttachmentExpectation[], timeoutMs: number, pollIntervalMs = 100): Promise<UploadedAttachmentEvidence[]> {
  const deadline = Date.now() + Math.max(1, timeoutMs);
  while (Date.now() < deadline) {
    const composer = page.getByRole("textbox", { name: /message|prompt|消息|提问|聊天/i }).filter({ visible: true });
    const composerForm = composer.locator("xpath=ancestor::form[1]");
    const scope = await composer.count() === 1 && await composerForm.count() === 1 ? composerForm : null;
    const actual = scope ? await scope.locator('[data-uploaded-file], [data-file-name], [data-testid*="attachment" i], [role="group"][aria-label]').evaluateAll((nodes) => nodes.map((node) => {
      const element = node as HTMLElement;
      const style = window.getComputedStyle(element);
      const fileName = element.getAttribute("data-file-name") || element.getAttribute("aria-label") || element.textContent || "";
      const rawSize = element.getAttribute("data-file-size");
      const controlNames = Array.from(element.querySelectorAll("button,[role=button]")).map((control) => control.getAttribute("aria-label") || control.textContent || "");
      const canOpen = controlNames.some((name) => /打开图片|open image|preview image/i.test(name));
      const canRemove = controlNames.some((name) => /移除文件|remove file|删除附件|delete attachment/i.test(name));
      return {
        fileName: fileName.replace(/^.*(?:附件|attachment|remove|删除)\s*[:：]?\s*/i, "").trim(),
        byteLength: rawSize && /^\d+$/.test(rawSize) ? Number(rawSize) : null,
        ready: canOpen && canRemove,
        visible: style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0
      };
    }).filter((entry) => entry.visible && entry.fileName) as Array<UploadedAttachmentEvidence & { visible: boolean}>).catch(() => []) : [];
    try { return matchUploadedAttachments(expected, actual); } catch (error) {
      if (Date.now() >= deadline || (error instanceof AttachmentUploadError && error.code === "ATTACHMENT_IDENTITY_MISMATCH" && actual.length > 0)) throw error;
    }
    await page.waitForTimeout(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
  }
  throw new AttachmentUploadError("ATTACHMENT_UPLOAD_UNCONFIRMED", "等待网页确认参考图上传超时。");
}
