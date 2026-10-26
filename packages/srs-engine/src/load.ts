// Load estimator / daily lesson cap (§7.4, D13). Hanja are excluded from the cap.

import type { Item, ItemId, QuestionType } from '@ksrs/content';
import { QUESTION_TYPES, type AppEvent, type Settings } from './events.ts';
import { dueItems } from './queue.ts';
import { liveEvents } from './replay.ts';
import type { DerivedState } from './state.ts';
import { localDayBoundaries, type TzOffset } from './time.ts';
import { availableLessons } from './unlock.ts';
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

export interface LessonCapReport {
  cap: number;
  steadyCap: number;
  headroomCap: number;
  lessonsDoneToday: number;
  maxLessonsPerDay: number;
  /** True when due reviews exceed 1.5 × T: cap is 0, dashboard says "clear reviews first". */
  clearReviewsFirst: boolean;
  targetSec: number;
  dueCount: number;
  dueLoadSec: number;
  secPerQ: Record<QuestionType, number>;
  accuracy: number;
  avgItemCost: number;
  reviewsPerItem: number;
  /** Projected review seconds per study day (day 0 = today) from existing items. */
  projectedDaySec: number[];
  /** Reviews one new item (learned now) adds to each projected day. */
  newItemReviewsPerDay: number[];
  dayStart: number;
}

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

export function dailyLessonCap(s: DerivedState, events: readonly AppEvent[], now: number, st: Settings = s.settings,
                               tz?: TzOffset): LessonCapReport {
  const secPerQ = secPerQEstimates(events);
  const accuracy = rollingAccuracy(events, now);
  const enabled = st.enabledQTypes.length ? st.enabledQTypes : QUESTION_TYPES;
  const costOf = (it: Item | undefined): number =>
    itemCost(it && it.kind !== 'hanja' ? requiredQTypes(it, enabled) : FALLBACK_QTYPES, secPerQ, accuracy);

  // Average cost of the next new items: available lessons, else all reviewable content.
  let pool: Item[] = availableLessons(s.index, s).map((id) => s.index.byId.get(id)!).filter((it) => it.kind !== 'hanja');
  if (pool.length === 0) pool = [...s.index.byId.values()].filter((it) => it.kind !== 'hanja');
  const avgItemCost = pool.length ? pool.reduce((a, it) => a + costOf(it), 0) / pool.length : costOf(undefined);

  const targetSec = st.targetReviewMin * 60;
  const reviewsPerItem = REVIEWS_TO_BURN / Math.max(0.01, accuracy);
  const steadyCap = Math.max(0, Math.floor(targetSec / (reviewsPerItem * avgItemCost)));

  // Headroom: success-path projection of existing items over the next 7 study days.
  const bounds = localDayBoundaries(now, HEADROOM_DAYS, tz, st.dayStartHour);
  const dayStart = bounds[0]!;
  const windowEnd = bounds[HEADROOM_DAYS]!;
  const dayOf = (t: number): number => {
    let d = 0;
    while (d + 1 < HEADROOM_DAYS && bounds[d + 1]! <= t) d++;
    return d;
  };
  // Lessons already done today (non-hanja, distinct items).
  const done = new Set<ItemId>();
  for (const e of liveEvents(events)) {
    if (e.type !== 'lesson.completed' || e.at < dayStart || e.at > now) continue;
    const it = s.index.byId.get(e.itemId);
    if (it && it.kind !== 'hanja') done.add(it.id);
  }
  const lessonsDoneToday = done.size;

  const iv = st['srs.intervals'];
  const projectedDaySec = new Array<number>(HEADROOM_DAYS).fill(0);
  for (const it of s.items.values()) {
    if (it.kind === 'hanja' || it.stage < 1 || it.stage > 8 || it.availableAt === null) continue;
    // Items learned today are paid for by subtracting lessonsDoneToday below; projecting them
    // here as well would count them twice and shrink the cap as the day goes on.
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
  let headroomCap = Number.POSITIVE_INFINITY;
  for (let d = 0; d < HEADROOM_DAYS; d++) {
    const adds = newItemReviewsPerDay[d]!;
    if (adds === 0) continue;
    headroomCap = Math.min(headroomCap, Math.max(0, Math.floor((targetSec - projectedDaySec[d]!) / (adds * avgItemCost))));
  }
  if (!Number.isFinite(headroomCap)) headroomCap = steadyCap;


  const due = dueItems(s, now);
  const dueLoadSec = due.reduce((a, id) => a + costOf(s.index.byId.get(id)), 0);
  const clearReviewsFirst = dueLoadSec > BACKLOG_FACTOR * targetSec;

  const max = st.maxLessonsPerDay;
  const cap = clearReviewsFirst ? 0 : Math.max(0, Math.min(max, Math.min(steadyCap, headroomCap, max) - lessonsDoneToday));

  return {
    cap, steadyCap, headroomCap, lessonsDoneToday, maxLessonsPerDay: max, clearReviewsFirst, targetSec,
    dueCount: due.length, dueLoadSec, secPerQ, accuracy, avgItemCost, reviewsPerItem,
    projectedDaySec, newItemReviewsPerDay, dayStart,
  };
}
