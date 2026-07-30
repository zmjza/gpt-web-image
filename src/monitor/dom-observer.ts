export type MutationKind = "image" | "text" | "control" | "attribute" | "animation" | "timestamp";
export interface MutationSignal { anchorId: string; kind: MutationKind; }

export function isRelevantMutation(signal: MutationSignal, anchorId: string): boolean {
  return signal.anchorId === anchorId && !["animation", "timestamp"].includes(signal.kind);
}

export class ActivityClock {
  public lastActivityAt: number;
  public version = 0;
  public constructor(private anchorId: string, startedAt = Date.now()) { this.lastActivityAt = startedAt; }
  public observe(signal: MutationSignal, now = Date.now()): boolean {
    if (!isRelevantMutation(signal, this.anchorId)) return false;
    this.lastActivityAt = now;
    this.version += 1;
    return true;
  }
  public rebind(anchorId: string, now = Date.now()): void { this.anchorId = anchorId; this.lastActivityAt = now; this.version = 0; }
}
