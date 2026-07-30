export function normalizeCount(count: number | undefined, remembered = 1): number { const value = count ?? remembered; if (!Number.isInteger(value) || value < 1 || value > 10) throw new Error("图片数量必须为 1–10"); return value; }
export function rememberExplicitCount(previous: number, explicit: number | undefined): number { return explicit === undefined ? normalizeCount(previous) : normalizeCount(explicit); }
export function shouldSupplement(target: number, completed: number, round: number, maxRounds = 3): boolean { return completed < target && round < maxRounds; }
export function nextSupplementRound(target: number, completed: number, round: number, maxRounds = 3): number | null { return shouldSupplement(target, completed, round, maxRounds) ? round + 1 : null; }
