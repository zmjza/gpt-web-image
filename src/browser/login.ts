import { setTimeout as delay } from "node:timers/promises";
import type { Page } from "playwright-core";

export interface LoginPageSignals { url: string; hasInteractiveComposer: boolean; hasLoginControl: boolean; hasVerification: boolean; }
export type LoginClassification = "ready" | "needs_login" | "needs_human_verification" | "unknown";
export interface VerificationSignals { url: string; bodyText: string; hasChallengeFrame: boolean; }

export function isVerificationChallenge(signals: VerificationSignals): boolean {
  if (signals.hasChallengeFrame) return true;
  if (!/auth\.openai\.com|challenges\.cloudflare\.com/i.test(signals.url)) return false;
  return /checking your browser|verify (?:that )?you are human|security verification|captcha|正在(?:进行)?安全验证|正在验证您是否是真人|请验证您是真人/i.test(signals.bodyText);
}

export function classifyLoginPage(signals: LoginPageSignals): LoginClassification {
  if (signals.hasVerification) return "needs_human_verification";
  if (signals.hasLoginControl || /\/auth\/(?:login|signup)/i.test(signals.url)) return "needs_login";
  if (signals.hasInteractiveComposer) return "ready";
  return "unknown";
}

export class LoginReadinessTracker {
  private readySince: number | null = null;
  public constructor(private readonly stabilityMs = 1000) {}
  public observe(signals: LoginPageSignals, now = Date.now()): LoginClassification | "stabilizing" {
    const classification = classifyLoginPage(signals);
    if (classification !== "ready") { this.readySince = null; return classification; }
    this.readySince ??= now;
    return now - this.readySince >= this.stabilityMs ? "ready" : "stabilizing";
  }
}

export async function readLoginPageSignals(page: Page): Promise<LoginPageSignals> {
  try {
    const raw = await page.evaluate(() => {
      const visible = (element: Element) => {
        const rect = (element as HTMLElement).getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const controls = Array.from(document.querySelectorAll("button, a, [role='button']"));
      const composers = Array.from(document.querySelectorAll("[role='textbox'], textarea, input, [contenteditable='true']"));
      const bodyText = (document.body?.innerText ?? "").slice(0, 5000);
      return {
        url: location.href,
        bodyText,
        hasChallengeFrame: Boolean(document.querySelector("iframe[src*='challenges.cloudflare.com'], [class*='cf-turnstile'], [data-sitekey], input[id^='cf-chl-widget-']")),
        hasLoginControl: controls.some((element) => visible(element) && /log\s*in|sign\s*in|登录/i.test(element.textContent || element.getAttribute("aria-label") || "")),
        hasInteractiveComposer: composers.some((element) => visible(element) && /message|prompt|消息|提问|聊天/i.test(element.getAttribute("aria-label") ?? element.getAttribute("placeholder") ?? ""))
      };
    });
    return {
      url: raw.url,
      hasInteractiveComposer: raw.hasInteractiveComposer,
      hasLoginControl: raw.hasLoginControl,
      hasVerification: isVerificationChallenge(raw)
    };
  } catch {
    return { url: page.url(), hasInteractiveComposer: false, hasLoginControl: false, hasVerification: false };
  }
}

export async function waitForReadyComposer(page: Page, timeoutMs: number, pollIntervalMs = 250): Promise<void> {
  const tracker = new LoginReadinessTracker(1000);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (page.isClosed()) throw new Error("专用 Chrome 已关闭");
    if (tracker.observe(await readLoginPageSignals(page)) === "ready") return;
    await delay(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
  }
  throw new Error("等待 ChatGPT 登录完成超时");
}

export async function waitForAutomatedComposer(page: Page, timeoutMs: number, pollIntervalMs = 250): Promise<void> {
  // Keep the normal one-second hydration guard without consuming tiny test/custom time budgets.
  const stabilityMs = Math.min(1000, Math.max(0, Math.floor(timeoutMs / 4)));
  const tracker = new LoginReadinessTracker(stabilityMs);
  const deadline = Date.now() + timeoutMs;
  let blockingState: "needs_login" | "needs_human_verification" | null = null;
  let blockingSince = 0;
  while (Date.now() < deadline) {
    if (page.isClosed()) throw new Error("PAGE_STRUCTURE_CHANGED: page_closed");
    const state = tracker.observe(await readLoginPageSignals(page));
    if (state === "ready") return;
    if (state === "needs_login" || state === "needs_human_verification") {
      if (blockingState !== state) { blockingState = state; blockingSince = Date.now(); }
      if (Date.now() - blockingSince >= stabilityMs) {
        throw new Error(state === "needs_login" ? "LOGIN_REQUIRED" : "HUMAN_VERIFICATION_REQUIRED");
      }
    } else {
      blockingState = null;
      blockingSince = 0;
    }
    await delay(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
  }
  throw new Error("PAGE_STRUCTURE_CHANGED: composer");
}
