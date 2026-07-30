export interface WatchdogTimes { startedAt: number; lastActivityAt: number; pageReadyAt: number | null; now: number; }
export interface WatchdogLimits { pageReadyTimeoutMs: number; inactivityTimeoutMs: number; hardTimeoutMs: number; }
export type WatchdogResult = "PAGE_READY_TIMEOUT" | "INACTIVITY_TIMEOUT" | "HARD_TIMEOUT" | null;

export function evaluateWatchdog(times: WatchdogTimes, limits: WatchdogLimits): WatchdogResult {
  if (times.now - times.startedAt > limits.hardTimeoutMs) return "HARD_TIMEOUT";
  if (times.pageReadyAt === null && times.now - times.startedAt > limits.pageReadyTimeoutMs) return "PAGE_READY_TIMEOUT";
  if (times.pageReadyAt !== null && times.now - times.lastActivityAt > limits.inactivityTimeoutMs) return "INACTIVITY_TIMEOUT";
  return null;
}
