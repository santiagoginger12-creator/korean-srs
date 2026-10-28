// Load estimator / daily lesson cap (§7.4, D13). Hanja are excluded from the cap.

import type { Item, ItemId, QuestionType } from '@ksrs/content';
import { QUESTION_TYPES, type AppEvent, type Settings } from './events.ts';
import { dueItems } from './queue.ts';
import { liveEvents } from './replay.ts';
import type { DerivedState } from './state.ts';
import type { AppSettings } from './settings.ts';
import { localDayBoundaries, type TzOffset } from './time.ts';
import { availableLessons, isSeparatePath } from './unlock.ts';
import { DAY, floorHour } from './util.ts';

export const DEFAULT_SEC_PER_Q: Readonly<Record<QuestionType, number>> = Object.freeze({
  meaning: 7, production: 10, cloze: 14, nuance: 18, register: 40,
});
/** EMA smoothing factor for secPerQ (not fixed by §7.4; chosen here). */
export const SEC_PER_Q_ALPHA = 0.2;
export const DEFAULT_ACCURACY = 0.85;
export const ACCURACY_WINDOW_MS = 30 * DAY;
export const REVIEWS_TO_BURN = 8;
export const BACKLOG_FACTOR = 1.5;
export const HEADROOM_DAYS = 7;
/** New items assumed to cost this when there is nothing to average over. */
const FALLBACK_QTYPES: QuestionType[] = ['meaning', 'production'];

/** The grammar path's share of the day (separate grammar path). All zero in combined mode. */
export interface GrammarCapReport {
  /** Grammar lessons still allowed today = max(0, limit − doneToday). */
  cap: number;
  /** Grammar lessons allowed for the whole study day = min(allowance, steadyCap, headroomCap); 0 in the backlog state. */
  limit: number;
  /** `grammar.dailyLessons`. */
  allowance: number;
  steadyCap: number;
  headroomCap: number;
  doneToday: number;
  /** Unlocked grammar lessons not yet taken. */
  available: number;
  /** Grammar lessons whose projected cost is reserved before the vocab cap: max(doneToday, min(limit, doneToday + available)). */
  reserved: number;
  /** Steady-state review seconds per day reserved for them (reserved × reviewsPerItem × avgItemCost). */
  reservedSec: number;
  /** Average cost of the next grammar items (their real question types). */
  avgItemCost: number;
}

export interface LessonCapReport {
  /** Vocab-path lessons still allowed today (combined mode: all non-hanja lessons). */
  cap: number;
  steadyCap: number;
  headroomCap: number;
  /** Vocab-path lessons done today (combined mode: all non-hanja). */
  lessonsDoneToday: number;
  maxLessonsPerDay: number;
  /** True when due reviews exceed 1.5 × T: cap is 0, dashboard says "clear reviews first". */
  clearReviewsFirst: boolean;
  targetSec: number;
  dueCount: number;
  dueLoadSec: number;
  secPerQ: Record<QuestionType, number>;
  accuracy: number;
  /** Average cost of the next vocab-path items (combined mode: all next items). */
  avgItemCost: number;
  reviewsPerItem: number;
  /** Projected review seconds per study day (day 0 = today) from existing items. */
  projectedDaySec: number[];
  /** Reviews one new item (learned now) adds to each projected day. */
  newItemReviewsPerDay: number[];
  dayStart: number;
  /** `grammar.separatePath`. */
  separateGrammar: boolean;
  grammar: GrammarCapReport;
}

/** Settings the estimator reads (the M1 Settings plus the optional grammar-path keys). */
export type CapSettings = Settings & Partial<Pick<AppSettings, 'grammar.dailyLessons' | 'grammar.separatePath'>>;

const clampDur = (ms: number): number => Math.min(120, Math.max(3, ms / 1000));

function answers(events: readonly AppEvent[]) {
  return liveEvents(events).filter((e): e is AppEvent & { type: 'review.answer' } => e.type === 'review.answer');
}

/** EMA of answer durations per qtype (seconds, each sample clamped to 3–120 s). */
export function secPerQEstimates(events: readonly AppEvent[]): Record<QuestionType, number> {
  const out = { ...DEFAULT_SEC_PER_Q };
  for (const e of answers(events)) out[e.qtype] += SEC_PER_Q_ALPHA * (clampDur(e.durationMs) - out[e.qtype]);
  return out;
}

/** Share of correct submissions in the last 30 days (default 0.85 when there are none). */
export function rollingAccuracy(events: readonly AppEvent[], now: number): number {
  let n = 0;
  let ok = 0;
  for (const e of answers(events)) {
    if (e.at > now || e.at <= now - ACCURACY_WINDOW_MS) continue;
    n++;
    if (e.grade === 'correct') ok++;
  }
  return n === 0 ? DEFAULT_ACCURACY : ok / n;
}

export function requiredQTypes(item: Item, enabled: readonly QuestionType[]): QuestionType[] {
  if (item.kind === 'hanja') return [];
  const q = item.questionTypes.filter((t) => enabled.includes(t));
  return q.length ? q : item.questionTypes.slice(0, 1);
}

/** itemCost = Σ_required secPerQ × (1 + (1 − acc)). */
export function itemCost(qtypes: readonly QuestionType[], secPerQ: Record<QuestionType, number>, acc: number): number {
  let sum = 0;
  for (const q of qtypes) sum += secPerQ[q];
  return sum * (1 + (1 - acc));
}

/**
 * Daily lesson caps (§7.4). One review budget T (`targetReviewMin`). With the separate grammar
 * path, the grammar allowance is sized first (min of `grammar.dailyLessons` and what T alone
 * could carry), its projected cost is reserved — at grammar's real per-item cost, and only for
 * grammar lessons that can actually happen today — and the vocab cap is solved in what is left:
 *   steady:   n_v = ⌊(T − reserved·rpi·c_g) / (rpi·c_v)⌋
 *   headroom: n_v = min_d ⌊(T − proj_d − adds_d·reserved·c_g) / (adds_d·c_v)⌋
 * Combined mode (`grammar.separatePath: false`) is the original single cap over everything.
 */
export function dailyLessonCap(s: DerivedState, events: readonly AppEvent[], now: number, st: CapSettings = s.settings,
                               tz?: TzOffset): LessonCapReport {
  const separate = isSeparatePath(st);
  const secPerQ = secPerQEstimates(events);
  const accuracy = rollingAccuracy(events, now);
  const enabled = st.enabledQTypes.length ? st.enabledQTypes : QUESTION_TYPES;
  const costOf = (it: Item | undefined): number =>
    itemCost(it && it.kind !== 'hanja' ? requiredQTypes(it, enabled) : FALLBACK_QTYPES, secPerQ, accuracy);
  const avgCost = (pool: Item[]): number => (pool.length ? pool.reduce((a, it) => a + costOf(it), 0) / pool.length : costOf(undefined));
  const isG = (it: Item): boolean => it.kind === 'grammar';

  // Average cost of the next new items per path: available lessons, else all reviewable content.
  const avail = availableLessons(s.index, s).map((id) => s.index.byId.get(id)!).filter((it) => it.kind !== 'hanja');
  const content = [...s.index.byId.values()].filter((it) => it.kind !== 'hanja');
  const onVocabPath = (it: Item): boolean => !separate || !isG(it);
  let vPool = avail.filter(onVocabPath);
  if (vPool.length === 0) vPool = content.filter(onVocabPath);
  let gPool = avail.filter(isG);
  const grammarAvailable = gPool.length;
  if (gPool.length === 0) gPool = content.filter(isG);
  const avgItemCost = avgCost(vPool);
  const gAvgItemCost = avgCost(gPool);

  const targetSec = st.targetReviewMin * 60;
  const reviewsPerItem = REVIEWS_TO_BURN / Math.max(0.01, accuracy);

  // Headroom: success-path projection of existing items over the next 7 study days.
  const bounds = localDayBoundaries(now, HEADROOM_DAYS, tz, st.dayStartHour);
  const dayStart = bounds[0]!;
  const windowEnd = bounds[HEADROOM_DAYS]!;
  const dayOf = (t: number): number => {
    let d = 0;
    while (d + 1 < HEADROOM_DAYS && bounds[d + 1]! <= t) d++;
    return d;
  };
  // Lessons already done today (non-hanja, distinct items), per path.
  const done = new Set<ItemId>();
  let grammarDoneToday = 0;
  for (const e of liveEvents(events)) {
    if (e.type !== 'lesson.completed' || e.at < dayStart || e.at > now) continue;
    const it = s.index.byId.get(e.itemId);
    if (!it || it.kind === 'hanja' || done.has(it.id)) continue;
    done.add(it.id);
    if (isG(it)) grammarDoneToday++;
  }
  const lessonsDoneToday = separate ? done.size - grammarDoneToday : done.size;

  const iv = st['srs.intervals'];
  const projectedDaySec = new Array<number>(HEADROOM_DAYS).fill(0);
  for (const it of s.items.values()) {
    if (it.kind === 'hanja' || it.stage < 1 || it.stage > 8 || it.availableAt === null) continue;
    // Items learned today are paid for by the day's limits below (vocab: subtracting
    // lessonsDoneToday; grammar: the reservation covers them); projecting them here as well
    // would count them twice and shrink the cap as the day goes on (D44).
    if (done.has(it.itemId)) continue;
    const cost = costOf(s.index.byId.get(it.itemId));
    let t = Math.max(it.availableAt, now);
    let stage: number = it.stage;
    while (t < windowEnd) {
      projectedDaySec[dayOf(t)]! += cost;
      stage++;
      if (stage >= 9) break;
      t = floorHour(t + iv[stage - 1]!);
    }
  }
  const newItemReviewsPerDay = new Array<number>(HEADROOM_DAYS).fill(0);
  let t = now;
  for (let stage = 1; stage <= 4; stage++) {
    t = floorHour(t + iv[stage - 1]!); // reaching stage s makes the next review available
    if (t >= windowEnd) break;
    newItemReviewsPerDay[dayOf(t)]!++;
  }
  /** Largest n with n new items of cost `c` on top of `fixed` (extra seconds per added review slot) fitting every day. */
  const headroomFor = (c: number, fixedPerAdd: number): number => {
    let h = Number.POSITIVE_INFINITY;
    for (let d = 0; d < HEADROOM_DAYS; d++) {
      const adds = newItemReviewsPerDay[d]!;
      if (adds === 0) continue;
      h = Math.min(h, Math.max(0, Math.floor((targetSec - projectedDaySec[d]! - adds * fixedPerAdd) / (adds * c))));
    }
    return h;
  };
  const steadyFor = (c: number, reservedSec: number): number =>
    Math.max(0, Math.floor((targetSec - reservedSec) / (reviewsPerItem * c)));

  const due = dueItems(s, now);
  const dueLoadSec = due.reduce((a, id) => a + costOf(s.index.byId.get(id)), 0);
  const clearReviewsFirst = dueLoadSec > BACKLOG_FACTOR * targetSec;

  // Grammar allowance first; its projected cost is reserved out of T.
  const allowance = separate ? (st['grammar.dailyLessons'] ?? 3) : 0;
  let grammar: GrammarCapReport = {
    cap: 0, limit: 0, allowance, steadyCap: 0, headroomCap: 0, doneToday: separate ? grammarDoneToday : 0,
    available: separate ? grammarAvailable : 0, reserved: 0, reservedSec: 0, avgItemCost: gAvgItemCost,
  };
  if (separate) {
    const gSteady = steadyFor(gAvgItemCost, 0);
    let gHead = headroomFor(gAvgItemCost, 0);
    if (!Number.isFinite(gHead)) gHead = gSteady;
    const limit = clearReviewsFirst ? 0 : Math.min(allowance, gSteady, gHead);
    const reserved = Math.max(grammarDoneToday, Math.min(limit, grammarDoneToday + grammarAvailable));
    grammar = {
      ...grammar, steadyCap: gSteady, headroomCap: gHead, limit, reserved,
      reservedSec: reserved * reviewsPerItem * gAvgItemCost, cap: Math.max(0, limit - grammarDoneToday),
    };
  }

  const steadyCap = steadyFor(avgItemCost, grammar.reservedSec);
  let headroomCap = headroomFor(avgItemCost, grammar.reserved * gAvgItemCost);
  if (!Number.isFinite(headroomCap)) headroomCap = steadyCap;

  const max = st.maxLessonsPerDay;
  const cap = clearReviewsFirst ? 0 : Math.max(0, Math.min(max, Math.min(steadyCap, headroomCap, max) - lessonsDoneToday));

  return {
    cap, steadyCap, headroomCap, lessonsDoneToday, maxLessonsPerDay: max, clearReviewsFirst, targetSec,
    dueCount: due.length, dueLoadSec, secPerQ, accuracy, avgItemCost, reviewsPerItem,
    projectedDaySec, newItemReviewsPerDay, dayStart, separateGrammar: separate, grammar,
  };
}
