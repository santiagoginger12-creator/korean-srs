// Drill statistics (D88): due forecast, answers per day, retention and card states per tier, and
// leeches. Pure functions of the drill state; callers pass the study-day bounds.

import { DAY } from '../util.ts';
import { MATURE_DAYS, type DrillCard, type DrillState } from './state.ts';
import { tierOf, type DeckMeta, type DrillDay } from './queue.ts';

/** Anki's default leech threshold: a card forgotten this many times in the review phase. */
export const LEECH_LAPSES = 8;

const isLearning = (c: DrillCard) => c.phase === 'learning' || c.phase === 'relearning';
const live = (c: DrillCard) => !c.known && !c.suspended && c.phase !== 'new';

/**
 * Cards due on each of the next `days` study days. Day 0 is today and includes overdue cards
 * and learning cards due before the day ends. Days are `DAY` long from `day.start` (a DST
 * shift moves a boundary by an hour at most).
 */
export function dueForecast(st: DrillState, day: DrillDay, days: number): { review: number; learning: number }[] {
  const out = Array.from({ length: days }, () => ({ review: 0, learning: 0 }));
  for (const c of st.cards.values()) {
    if (!live(c)) continue;
    const k = c.due < day.end ? 0 : Math.floor((c.due - day.end) / DAY) + 1;
    if (k >= days) continue;
    if (isLearning(c)) out[k]!.learning++; else out[k]!.review++;
  }
  return out;
}

/** Answers on each of the last `days` study days, oldest first (the last entry is today). */
export function answersByDay(st: DrillState, day: DrillDay, days: number): { total: number; again: number }[] {
  const out = Array.from({ length: days }, () => ({ total: 0, again: 0 }));
  const first = day.start - (days - 1) * DAY;
  for (const r of st.reviews) {
    if (r.at < first || r.at >= day.end) continue;
    const k = Math.min(days - 1, Math.floor((r.at - first) / DAY));
    out[k]!.total++;
    if (r.rating === 1) out[k]!.again++;
  }
  return out;
}

export interface TierStats {
  tier: number;
  label: string;
  /** Review-phase answers in the window that weren't Again. */
  pass: number;
  total: number;
  rate: number | null;
  learning: number;
  young: number;
  mature: number;
  known: number;
  suspended: number;
}

/** Retention (review-phase answers since `since`) and card states, per tier. Forward and reverse cards both count. */
export function tierStats(st: DrillState, meta: DeckMeta, since: number): TierStats[] {
  const by = new Map<number, TierStats>(meta.tiers.map((t) => [t.tier, {
    tier: t.tier, label: t.label, pass: 0, total: 0, rate: null, learning: 0, young: 0, mature: 0, known: 0, suspended: 0,
  }]));
  const wordOf = (cardId: string) => cardId.slice(0, cardId.lastIndexOf(':'));
  for (const r of st.reviews) {
    if (r.phase !== 'review' || r.at < since) continue;
    const t = tierOf(meta, wordOf(r.cardId));
    const s = t && by.get(t.tier);
    if (!s) continue;
    s.total++;
    if (r.rating > 1) s.pass++;
  }
  for (const c of st.cards.values()) {
    const t = tierOf(meta, c.wordId);
    const s = t && by.get(t.tier);
    if (!s) continue;
    if (c.known) s.known++;
    else if (c.suspended) s.suspended++;
    else if (isLearning(c)) s.learning++;
    else if (c.phase === 'review') { if (c.ivl >= MATURE_DAYS) s.mature++; else s.young++; }
  }
  for (const s of by.values()) s.rate = s.total ? s.pass / s.total : null;
  return [...by.values()];
}

/** Cards with at least `threshold` lapses (suspended ones included), most lapses first. */
export function leeches(st: DrillState, threshold = LEECH_LAPSES): DrillCard[] {
  return [...st.cards.values()]
    .filter((c) => !c.known && c.lapses >= threshold)
    .sort((a, b) => b.lapses - a.lapses || (a.id < b.id ? -1 : 1));
}

/** Cards answered Again at least once today (any phase), in the order they were first missed. */
export function missedToday(st: DrillState, day: DrillDay): string[] {
  const seen = new Set<string>();
  for (const r of st.reviews) if (r.rating === 1 && r.at >= day.start && r.at < day.end) seen.add(r.cardId);
  return [...seen].filter((id) => { const c = st.cards.get(id); return c && !c.known; });
}

/** Cards first studied within `ms` before `now` (newest last). */
export function recentlyLearned(st: DrillState, now: number, ms: number): string[] {
  return [...st.cards.values()]
    .filter((c) => !c.known && c.firstAt !== null && c.firstAt >= now - ms)
    .sort((a, b) => a.firstAt! - b.firstAt!)
    .map((c) => c.id);
}
