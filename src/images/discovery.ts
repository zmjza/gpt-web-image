export interface ImageCandidate { anchorId: string; fingerprint: string; resultId?: string; loaded: boolean; width: number; height: number; resourceUrl: string; downloadAvailable?: boolean; }

export class ImageDiscovery {
  private readonly firstStableAt = new Map<string, number>();
  private readonly emitted = new Set<string>();
  private readonly baseline: Set<string>;
  public constructor(baselineFingerprints: Iterable<string>, private readonly stabilityWindowMs: number) { this.baseline = new Set(baselineFingerprints); }

  public get hasPendingCandidates(): boolean {
    return [...this.firstStableAt.keys()].some((fingerprint) => !this.emitted.has(fingerprint));
  }

  public observe(anchorId: string, candidates: ImageCandidate[], now = Date.now()): ImageCandidate[] {
    const valid = candidates.filter((candidate) => candidate.anchorId === anchorId && !this.baseline.has(candidate.fingerprint) && candidate.loaded && candidate.width > 0 && candidate.height > 0 && candidate.resourceUrl !== "");
    const visible = new Set(valid.map((candidate) => candidate.fingerprint));
    for (const fingerprint of this.firstStableAt.keys()) if (!visible.has(fingerprint)) this.firstStableAt.delete(fingerprint);
    const stable: ImageCandidate[] = [];
    for (const candidate of valid) {
      const first = this.firstStableAt.get(candidate.fingerprint);
      if (first === undefined) { this.firstStableAt.set(candidate.fingerprint, now); continue; }
      if (now - first >= this.stabilityWindowMs && !this.emitted.has(candidate.fingerprint)) {
        this.emitted.add(candidate.fingerprint);
        stable.push(candidate);
      }
    }
    return stable;
  }
}
