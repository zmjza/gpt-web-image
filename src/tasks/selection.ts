export interface Selection { selected: string[]; needsChoice: boolean; candidates: string[]; }
export function selectTargets(ids: string[], instruction?: string, modifyAll = false): Selection {
  const candidates = [...ids];
  if (modifyAll || /全部|所有/.test(instruction ?? "")) return { selected: candidates, needsChoice: false, candidates };
  if (candidates.length <= 1) return { selected: candidates, needsChoice: false, candidates };
  const ordinal = instruction?.match(/第\s*(\d+)\s*张/);
  if (ordinal) { const index = Number(ordinal[1]) - 1; if (index >= 0 && index < candidates.length) return { selected: [candidates[index] as string], needsChoice: false, candidates }; }
  if (/最后一张/.test(instruction ?? "")) return { selected: [candidates[candidates.length - 1] as string], needsChoice: false, candidates };
  return { selected: [], needsChoice: true, candidates };
}
