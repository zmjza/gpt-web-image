export function createTaskId(now: () => number = Date.now): string {
  const timestamp = now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `task_${timestamp}_${random}`;
}

export function assertSafeTaskId(taskId: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(taskId) || taskId.length > 128) throw new Error("taskId 不是安全的文件名");
}
