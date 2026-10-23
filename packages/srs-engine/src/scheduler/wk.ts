// WaniKani scheduler (§7.1).

import { floorHour } from '../util.ts';
import { clampStage, type Scheduler, type SrsCore, type SrsParams, type Stage } from './index.ts';

/** The §7.1 formula. `incorrect` counts every wrong submission in the group. */
export function wkNextStage(stage: number, incorrect: number): Stage {
  const s = clampStage(stage);
  if (incorrect <= 0) return clampStage(Math.min(9, s + 1));
  const adj = Math.ceil(incorrect / 2);
  const penalty = s >= 5 ? 2 : 1;
  return clampStage(Math.max(1, s - adj * penalty));
}

/** availableAt on reaching `stage` at time `at`; null for Burned (and stage 0). */
export function wkAvailableAt(stage: Stage, at: number, params: SrsParams): number | null {
  if (stage <= 0 || stage >= 9) return null;
  const iv = params.intervals[stage - 1];
  if (iv === undefined) throw new Error(`wk: no interval for stage ${stage}`);
  return floorHour(at + iv);
}

export const wkScheduler: Scheduler = {
  id: 'wk',
  next(state: SrsCore, outcome, params): SrsCore {
    const stage = wkNextStage(state.stage, outcome.incorrect);
    return { stage, availableAt: wkAvailableAt(stage, outcome.at, params) };
  },
  isGuruOrAbove(state) {
    return state.stage >= 5;
  },
};

/** Scheduler lookup. FSRS is deferred (D19): 'fsrs' resolves to WK with `fallback: true`. */
export function getScheduler(id: 'wk' | 'fsrs'): { scheduler: Scheduler; fallback: boolean } {
  return { scheduler: wkScheduler, fallback: id !== 'wk' };
}
