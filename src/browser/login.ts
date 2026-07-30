export interface LoginPageSignals { url: string; hasInteractiveComposer: boolean; hasLoginControl: boolean; hasVerification: boolean; }
export type LoginClassification = "ready" | "needs_login" | "needs_human_verification" | "unknown";

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
