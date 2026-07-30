export interface CancellationState { requestedAt: string | null; }
export function requestCancellation(state: CancellationState, now = new Date()): CancellationState { return state.requestedAt ? state : { requestedAt: now.toISOString() }; }
export function isCancellationRequested(state: CancellationState): boolean { return state.requestedAt !== null; }
