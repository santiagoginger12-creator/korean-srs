// Scheduler interface (§7.2). WK is the only implementation at M1; FSRS is deferred (D19).

export type Stage = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export const BURNED: Stage = 9;
export const GURU: Stage = 5;

export interface SrsCore {
  stage: Stage;
  availableAt: number | null;
  fsrs?: { s: number; d: number; due: number };
}

export interface SrsParams {
  /** ms intervals applied on reaching stage s = 1..8 (index s-1). */
  intervals: readonly number[];
}

export interface ReviewOutcome { incorrect: number; closeAttempts: number; at: number }

export interface Scheduler {
  id: 'wk' | 'fsrs';
  next(state: SrsCore, outcome: ReviewOutcome, params: SrsParams): SrsCore; // pure
  isGuruOrAbove(state: SrsCore): boolean; // FSRS: scheduled interval ≥ 7d
}

export function clampStage(n: number): Stage {
  return Math.max(0, Math.min(9, Math.trunc(n))) as Stage;
}
