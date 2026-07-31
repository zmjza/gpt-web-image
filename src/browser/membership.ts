import type { Page } from "playwright-core";
import type { EligibilityResult, Membership } from "../profiles/types.js";

export interface MembershipSignals {
  login: "logged_in" | "needs_login" | "verification_required" | "technical_failure";
  visibleTexts: string[];
  imageGenerationAvailable: boolean | null;
}

export interface EligibilityEvaluation extends EligibilityResult {
  reason: "ELIGIBLE" | "LOGIN_REQUIRED" | "VERIFICATION_REQUIRED" | "MEMBERSHIP_INELIGIBLE" | "ELIGIBILITY_CHECK_FAILED";
}

export function classifyMembershipSignals(signals: MembershipSignals): Membership {
  if (signals.login !== "logged_in") return "technical_failure";
  const text = signals.visibleTexts.join("\n").replace(/\s+/g, " ");
  if (/\bchatgpt\s+pro\b|\bcurrent plan\s*:\s*pro\b|\bpro\s+(?:plan|方案|套餐)\b/i.test(text)) return "pro";
  if (/\bchatgpt\s+plus\b|\bcurrent plan\s*:\s*plus\b|\bplus\s+(?:plan|方案|套餐)\b/i.test(text)) return "plus";
  if (/\b(?:chatgpt|gpt)?\s*go\s*(?:plan|方案|套餐)?\b/i.test(text)) return "go";
  if (/\bfree\s*(?:plan|tier)?\b|免费(?:方案|套餐|版)?/i.test(text)) return "other";
  return "technical_failure";
}

export function evaluateEligibility(signals: MembershipSignals, checkedAt = new Date().toISOString()): EligibilityEvaluation {
  const membership = classifyMembershipSignals(signals);
  const evidenceKinds = [
    ...(signals.visibleTexts.length > 0 ? ["visible_plan_text"] : []),
    ...(signals.imageGenerationAvailable !== null ? ["image_generation_capability"] : [])
  ];
  if (signals.login === "needs_login") return { login: signals.login, membership, evidenceKinds, checkedAt, eligible: false, reason: "LOGIN_REQUIRED" };
  if (signals.login === "verification_required") return { login: signals.login, membership, evidenceKinds, checkedAt, eligible: false, reason: "VERIFICATION_REQUIRED" };
  if (signals.login === "technical_failure" || membership === "technical_failure") return { login: "technical_failure", membership: "technical_failure", evidenceKinds, checkedAt, eligible: false, reason: "ELIGIBILITY_CHECK_FAILED" };
  if (membership === "other" || signals.imageGenerationAvailable === false) return { login: "logged_in", membership, evidenceKinds, checkedAt, eligible: false, reason: "MEMBERSHIP_INELIGIBLE" };
  return { login: "logged_in", membership, evidenceKinds, checkedAt, eligible: true, reason: "ELIGIBLE" };
}

export async function readMembershipSignals(page: Page): Promise<MembershipSignals> {
  try {
    const raw = await page.evaluate(() => {
      const visible = (element: Element) => {
        const rect = (element as HTMLElement).getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const candidates = Array.from(document.querySelectorAll("[role='menu'], [role='dialog'], aside, nav, button, a"))
        .filter(visible)
        .map((element) => (element.textContent ?? "").trim())
        .filter((text) => /plus|pro|\bgo\b|free|方案|套餐|会员/i.test(text))
        .slice(0, 30);
      const controls = Array.from(document.querySelectorAll("button, [role='button'], [role='menuitem']")).filter(visible);
      const imageGenerationAvailable = controls.some((element) => /create image|generate image|生成图片|创建图片/i.test(element.textContent ?? element.getAttribute("aria-label") ?? ""));
      return { visibleTexts: candidates, imageGenerationAvailable };
    });
    return { login: "logged_in", visibleTexts: raw.visibleTexts, imageGenerationAvailable: raw.imageGenerationAvailable };
  } catch {
    return { login: "technical_failure", visibleTexts: [], imageGenerationAvailable: null };
  }
}
