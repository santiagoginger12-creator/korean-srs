// FSRS-5 scheduler for the Anki-style drill (D79). Pure: no clock, no RNG (fuzz is seeded from
// the card id and its review count, so replay is reproducible).
//
// Sources for the formulas and the default parameters:
// - open-spaced-repetition/fsrs4anki wiki, "The Algorithm" (FSRS-5 section):
//   https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm
// - Fernando Borretti, "Implementing FSRS in 100 Lines" (FSRS-5, same parameter vector):
//   https://borretti.me/article/implementing-fsrs-in-100-lines
// - Anki's learning steps (1m 10m), relearning step (10m), Hard = mean of the first two steps,
//   Hard/Good/Easy ordering, and the fuzz ranges follow Anki's v3 scheduler / ts-fsrs `get_fuzz_range`.
//
//   R(t, S)    = (1 + F·t/S)^C                                     C = −0.5, F = 19/81
//   I(r, S)    = S/F · (r^(1/C) − 1)                                (I = S when r = 0.9)
//   S0(G)      = w[G−1]
//   D0(G)      = w4 − e^(w5·(G−1)) + 1                              clamped to [1, 10]
//   D'(D, G)   = D + (−w6·(G−3))·(10 − D)/9                         linear damping
//   D''        = w7·D0(4) + (1 − w7)·D'                             mean reversion; clamped to [1, 10]
//   S'r        = S·(1 + e^w8·(11 − D)·S^−w9·(e^(w10·(1−R)) − 1)·h·b) h = w15 if Hard, b = w16 if Easy
//   S'f        = min(S, w11·D^−w12·((S+1)^w13 − 1)·e^(w14·(1−R)))
//   S'short    = S·e^(w17·(G − 3 + w18))                            same-day review (< 1 day since last)

import { DAY, fnv1a, MINUTE, mulberry32 } from '../util.ts';

export type Rating = 1 | 2 | 3 | 4;
export const RATINGS: readonly Rating[] = [1, 2, 3, 4];
export const RATING_LABELS: Readonly<Record<Rating, string>> = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };

/** FSRS-5 default parameters (19 weights), as published (fsrs4anki wiki, ts-fsrs v4 `default_w`). */
export const FSRS5_DEFAULT_W: readonly number[] = Object.freeze([
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192,
  1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
]);
export const DECAY = -0.5;
export const FACTOR = 19 / 81; // 0.9^(1/DECAY) − 1, so R(S, S) = 0.9
export const S_MIN = 0.01;

export interface FsrsParams {
  w: readonly number[];
  /** Desired retention, 0.80–0.97 (setting `drill.retention`). */
  retention: number;
  /** Days. */
  maxIvl: number;
  /** ms. Anki defaults: 1m 10m. */
  learnSteps: readonly number[];
  /** ms. Anki default: 10m. */
  relearnSteps: readonly number[];
  fuzz: boolean;
}

export const DEFAULT_RETENTION = 0.9;
export const MAX_IVL_DAYS = 36500;

export const DEFAULT_FSRS_PARAMS: Readonly<FsrsParams> = Object.freeze({
  w: FSRS5_DEFAULT_W,
  retention: DEFAULT_RETENTION,
  maxIvl: MAX_IVL_DAYS,
  learnSteps: Object.freeze([1 * MINUTE, 10 * MINUTE]),
  relearnSteps: Object.freeze([10 * MINUTE]),
  fuzz: true,
});

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

// ---------------------------------------------------------------- formulas

export function retrievability(tDays: number, s: number): number {
  return Math.pow(1 + FACTOR * Math.max(0, tDays) / s, DECAY);
}

/** Unrounded interval in days for stability `s` at desired retention `r`. */
export function rawInterval(s: number, r: number): number {
  return (s / FACTOR) * (Math.pow(r, 1 / DECAY) - 1);
}

/** Whole-day interval: rounded, at least 1, at most maxIvl. */
export function nextIntervalDays(s: number, r: number, maxIvl: number): number {
  return clamp(Math.round(rawInterval(s, r)), 1, maxIvl);
}

export const initStability = (w: readonly number[], g: Rating): number => Math.max(S_MIN, w[g - 1]!);
export const rawInitDifficulty = (w: readonly number[], g: Rating): number => w[4]! - Math.exp(w[5]! * (g - 1)) + 1;
export const initDifficulty = (w: readonly number[], g: Rating): number => clamp(rawInitDifficulty(w, g), 1, 10);

export function nextDifficulty(w: readonly number[], d: number, g: Rating): number {
  const delta = -w[6]! * (g - 3);
  const damped = d + delta * (10 - d) / 9;
  return clamp(w[7]! * rawInitDifficulty(w, 4) + (1 - w[7]!) * damped, 1, 10);
}

export function recallStability(w: readonly number[], d: number, s: number, r: number, g: Rating): number {
  const hard = g === 2 ? w[15]! : 1;
  const easy = g === 4 ? w[16]! : 1;
  return s * (1 + Math.exp(w[8]!) * (11 - d) * Math.pow(s, -w[9]!) * (Math.exp(w[10]! * (1 - r)) - 1) * hard * easy);
}

export function forgetStability(w: readonly number[], d: number, s: number, r: number): number {
  const sf = w[11]! * Math.pow(d, -w[12]!) * (Math.pow(s + 1, w[13]!) - 1) * Math.exp(w[14]! * (1 - r));
  return Math.min(sf, s);
}

export function shortTermStability(w: readonly number[], s: number, g: Rating): number {
  return s * Math.exp(w[17]! * (g - 3 + w[18]!));
}

/** Memory state after a rating. `elapsedMs` is null for the first review. */
export function nextMemory(w: readonly number[], mem: { s: number; d: number } | null, elapsedMs: number | null, g: Rating): { s: number; d: number } {
  if (!mem || elapsedMs === null) return { s: initStability(w, g), d: initDifficulty(w, g) };
  const d = nextDifficulty(w, mem.d, g);
  if (elapsedMs < DAY) return { s: Math.max(S_MIN, shortTermStability(w, mem.s, g)), d };
  const r = retrievability(elapsedMs / DAY, mem.s);
  const s = g === 1 ? forgetStability(w, mem.d, mem.s, r) : recallStability(w, mem.d, mem.s, r, g);
  return { s: Math.max(S_MIN, s), d };
}

// ---------------------------------------------------------------- fuzz

/** Anki / ts-fsrs fuzz range for an interval of `ivl` days (no fuzz below 2.5 days). */
export function fuzzRange(ivl: number, maxIvl: number): { min: number; max: number } {
  if (ivl < 2.5) return { min: ivl, max: ivl };
  const delta = 1 + 0.15 * Math.min(Math.max(ivl - 2.5, 0), 4.5) + 0.1 * Math.min(Math.max(ivl - 7, 0), 13)
    + 0.05 * Math.max(ivl - 20, 0);
  const min = Math.max(2, Math.round(ivl - delta));
  const max = Math.min(Math.round(ivl + delta), maxIvl);
  return { min: Math.min(min, max), max };
}

/** Seeded fuzz factor in [0, 1) for a card's n-th review (one factor for all four buttons). */
export function fuzzFactor(cardId: string, reps: number): number {
  return mulberry32(fnv1a(`${cardId}#${reps}`))();
}

/** Fuzzed interval: only for intervals of 3+ days. */
export function applyFuzz(ivl: number, factor: number, maxIvl: number): number {
  if (ivl < 3) return ivl;
  const { min, max } = fuzzRange(ivl, maxIvl);
  return clamp(min + Math.floor(factor * (max - min + 1)), 1, maxIvl);
}

// ---------------------------------------------------------------- card scheduling

export type CardPhase = 'new' | 'learning' | 'review' | 'relearning';

export interface CardSched {
  phase: CardPhase;
  /** Index into learnSteps / relearnSteps while (re)learning. */
  step: number;
  /** FSRS memory; 0 until the first review. */
  s: number;
  d: number;
  /** When the card is next due (ms). For review cards: last review + ivl days. */
  due: number;
  /** Scheduled interval in days (review phase); 0 while (re)learning. */
  ivl: number;
  /** Last review (ms), or null when new. */
  last: number | null;
  /** Reviews applied so far (seeds the fuzz). */
  reps: number;
  /** Times forgotten in the review phase. */
  lapses: number;
}

export function newCardSched(): CardSched {
  return { phase: 'new', step: 0, s: 0, d: 0, due: 0, ivl: 0, last: null, reps: 0, lapses: 0 };
}

/** Delay for Hard while on step `i` (Anki: mean of the first two steps on step 0, else repeat; one step → 1.5×). */
function hardDelay(steps: readonly number[], i: number): number {
  if (i === 0 && steps.length >= 2) return (steps[0]! + steps[1]!) / 2;
  if (i === 0) return Math.min(steps[0]! * 1.5, steps[0]! + DAY);
  return steps[i]!;
}

/**
 * The card after each rating at time `at`, Anki-style: new and relearning cards walk their steps,
 * Easy graduates at once, and review-phase intervals keep Hard ≤ Good < Easy after fuzz.
 */
export function scheduleAll(card: CardSched, at: number, cardId: string, p: FsrsParams = DEFAULT_FSRS_PARAMS): Record<Rating, CardSched> {
  const elapsed = card.last === null ? null : Math.max(0, at - card.last);
  const mem = card.phase === 'new' || card.last === null ? null : { s: card.s, d: card.d };
  const factor = p.fuzz ? fuzzFactor(cardId, card.reps) : 0;
  const base = { last: at, reps: card.reps + 1 };
  const out = {} as Record<Rating, CardSched>;
  const reviewIvl: Partial<Record<Rating, number>> = {};

  for (const g of RATINGS) {
    const m = nextMemory(p.w, mem, elapsed, g);
    const learning = (steps: readonly number[], phase: 'learning' | 'relearning', step: number, delay: number): CardSched =>
      ({ ...base, phase, step, s: m.s, d: m.d, due: at + delay, ivl: 0, lapses: card.lapses + (card.phase === 'review' && g === 1 ? 1 : 0) });
    const graduate = (): CardSched => {
      const ivl = nextIntervalDays(m.s, p.retention, p.maxIvl);
      reviewIvl[g] = ivl;
      return { ...base, phase: 'review', step: 0, s: m.s, d: m.d, due: at + ivl * DAY, ivl, lapses: card.lapses };
    };

    if (card.phase === 'review') {
      if (g === 1) {
        out[g] = p.relearnSteps.length
          ? learning(p.relearnSteps, 'relearning', 0, p.relearnSteps[0]!) // counts the lapse
          : { ...graduate(), lapses: card.lapses + 1 };
      } else out[g] = graduate();
      continue;
    }
    // new, learning, relearning
    const relearn = card.phase === 'relearning';
    const steps = relearn ? p.relearnSteps : p.learnSteps;
    const phase = relearn ? 'relearning' : 'learning';
    const i = card.phase === 'new' ? 0 : Math.min(card.step, Math.max(0, steps.length - 1));
    if (!steps.length || g === 4) { out[g] = graduate(); continue; }
    if (g === 1) { out[g] = learning(steps, phase, 0, steps[0]!); continue; }
    if (g === 2) { out[g] = learning(steps, phase, i, hardDelay(steps, i)); continue; }
    // Good: next step, or graduate after the last one. A new card starts on step 0, so Good moves to step 1.
    const nextStep = card.phase === 'new' ? 1 : i + 1;
    out[g] = nextStep < steps.length ? learning(steps, phase, nextStep, steps[nextStep]!) : graduate();
  }

  // Fuzz, then keep Hard ≤ Good < Easy among the ratings that land in the review phase.
  if (p.fuzz) for (const g of RATINGS) if (reviewIvl[g] !== undefined) reviewIvl[g] = applyFuzz(reviewIvl[g]!, factor, p.maxIvl);
  if (reviewIvl[2] !== undefined && reviewIvl[3] !== undefined && reviewIvl[3] <= reviewIvl[2]) reviewIvl[3] = Math.min(p.maxIvl, reviewIvl[2] + 1);
  if (reviewIvl[3] !== undefined && reviewIvl[4] !== undefined && reviewIvl[4] <= reviewIvl[3]) reviewIvl[4] = Math.min(p.maxIvl, reviewIvl[3] + 1);
  if (reviewIvl[2] !== undefined && reviewIvl[4] !== undefined && reviewIvl[4] <= reviewIvl[2]) reviewIvl[4] = Math.min(p.maxIvl, reviewIvl[2] + 1);
  for (const g of RATINGS) {
    const ivl = reviewIvl[g];
    if (ivl === undefined) continue;
    out[g] = { ...out[g], ivl, due: at + ivl * DAY };
  }
  return out;
}

export function schedule(card: CardSched, rating: Rating, at: number, cardId: string, p: FsrsParams = DEFAULT_FSRS_PARAMS): CardSched {
  return scheduleAll(card, at, cardId, p)[rating];
}

// ---------------------------------------------------------------- display

/** Anki-style short interval label: "<1m", "6m", "10m", "1h", "4d", "1.5mo", "2.1y". */
export function formatInterval(ms: number): string {
  if (ms < 60_000 + 500) return '<1m';
  const min = ms / MINUTE;
  if (min < 59.5) return `${Math.round(min)}m`;
  const h = min / 60;
  if (h < 23.5) return `${Math.round(h)}h`;
  const d = ms / DAY;
  if (d < 29.5) return `${Math.round(d)}d`;
  const mo = d / 30;
  if (d < 365) return `${trim1(mo)}mo`;
  return `${trim1(d / 365)}y`;
}
const trim1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1).replace(/\.0$/, '');
