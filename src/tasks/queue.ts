export interface QueueItem<T> { id: string; run: (signal: AbortSignal) => Promise<T>; }

export class QueueCancelledError extends Error {
  public readonly code = "CANCELLED";
  public constructor(id: string) { super(`任务已取消：${id}`); }
}

interface PendingItem {
  id: string;
  run: (signal: AbortSignal) => Promise<void>;
  cancel: () => void;
}

export class TaskQueue {
  private pending: PendingItem[] = [];
  private running = false;
  private controllers = new Map<string, AbortController>();
  public enqueue<T>(item: QueueItem<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.pending.some((pending) => pending.id === item.id) || this.controllers.has(item.id)) {
        reject(new Error(`重复任务 ID：${item.id}`));
        return;
      }
      this.pending.push({
        id: item.id,
        run: async (signal) => { try { resolve(await item.run(signal)); } catch (error) { reject(error); } },
        cancel: () => reject(new QueueCancelledError(item.id))
      });
      void this.drain();
    });
  }
  public cancel(id: string): boolean {
    const controller = this.controllers.get(id);
    if (controller) {
      if (controller.signal.aborted) return false;
      controller.abort();
      return true;
    }
    const index = this.pending.findIndex((item) => item.id === id);
    if (index < 0) return false;
    const [item] = this.pending.splice(index, 1);
    item?.cancel();
    return true;
  }
  public get size(): number { return this.pending.length + (this.running ? 1 : 0); }
  private async drain(): Promise<void> { if (this.running) return; const item = this.pending.shift(); if (!item) return; this.running = true; const controller = new AbortController(); this.controllers.set(item.id, controller); try { await item.run(controller.signal); } finally { this.controllers.delete(item.id); this.running = false; void this.drain(); } }
}
