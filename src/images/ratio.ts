export interface AspectRatio { width: number; height: number; value: string; }

export function parseAspectRatio(value: string): AspectRatio {
  const match = value.trim().match(/^(\d{1,3})\s*:\s*(\d{1,3})$/);
  const width = Number(match?.[1]);
  const height = Number(match?.[2]);
  if (!match || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 100 || height > 100) {
    throw new Error("比例必须是 1 到 100 之间的整数比，例如 16:9 或 9:16");
  }
  return { width, height, value: `${width}:${height}` };
}
