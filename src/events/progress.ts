import type { TaskState } from "../tasks/model.js";
export interface ProgressSnapshot { state: TaskState; completed: number; message: string; }

export class ProgressThrottle {
  private last: ProgressSnapshot | null = null;
  private lastAt = Number.NEGATIVE_INFINITY;
  public constructor(private readonly heartbeatMs = 30000) {}
  public shouldEmit(snapshot: ProgressSnapshot, now = Date.now()): boolean {
    const changed = !this.last || this.last.state !== snapshot.state || this.last.completed !== snapshot.completed || this.last.message !== snapshot.message;
    if (!changed && now - this.lastAt < this.heartbeatMs) return false;
    this.last = { ...snapshot }; this.lastAt = now; return true;
  }
}
