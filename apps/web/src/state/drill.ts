// Drill helpers on the app side (D81, D82): study-day bounds, settings view, counts for the
// dashboard / NextSteps tiles, the session's new-card queue and the placement lists.
import type { MasterRow } from '@ksrs/content';
import {
  drillCardId, drillCounts, effectiveStartTier, localDayStart, mixNew, newForwardIds, newLeftToday, nextLocalDayStart,
  reverseNewIds, type AppSettings, type DeckMeta, type DrillCounts, type DrillDay, type DrillSettingsView, type DrillState,
  type TzOffset,
} from '@ksrs/srs-engine';
import type { DeckWord } from '../features/drill/deck.ts';

export function drillDay(t: number, s: Pick<AppSettings, 'dayStartHour'>, tz: TzOffset): DrillDay {
  const start = localDayStart(t, tz, s.dayStartHour);
  return { start, end: nextLocalDayStart(start, tz, s.dayStartHour) };
}

export function drillSettingsView(s: AppSettings): DrillSettingsView {
  return { newPerDay: s['drill.newPerDay'], reverse: s['drill.reverse'] !== false, startTier: s['drill.startTier'] ?? 0 };
}

export function drillSummary(st: DrillState, s: AppSettings, meta: DeckMeta, t: number, tz: TzOffset): DrillCounts {
  return drillCounts(st, meta, drillSettingsView(s), t, drillDay(t, s, tz));
}

/** Cards waiting today (due + new), as shown on the Drill buttons. */
export const drillWaiting = (c: DrillCounts): number => c.due + c.newToday;

/** New cards for a session: today's forward allowance from the start tier, with unlocked reverse cards spread in. */
export function sessionNewQueue(st: DrillState, words: readonly DeckWord[], meta: DeckMeta, s: AppSettings, t: number, tz: TzOffset): string[] {
  const view = drillSettingsView(s);
  const day = drillDay(t, s, tz);
  const from = effectiveStartTier(st, meta, view.startTier);
  const forward = from === null ? [] : newForwardIds(st, words.filter((w) => w.tier >= from).map((w) => w.id), newLeftToday(st, view, day));
  return mixNew(forward, reverseNewIds(st, day, view.reverse));
}

const unseen = (st: DrillState, wordId: string) => !st.cards.has(drillCardId(wordId, 'f'));

/** Skip ahead: unseen forward cards of every word below `tier` (cards already in study are left alone). */
export function skipAheadIds(st: DrillState, words: readonly DeckWord[], tier: number): string[] {
  return words.filter((w) => w.tier < tier && unseen(st, w.id)).map((w) => drillCardId(w.id, 'f'));
}

/**
 * "Skip words you've mastered in Anki": unseen forward cards whose headword has status
 * `mastered` in the master list's Anki baseline (D61). Every homonym with that spelling matches.
 */
export function ankiMasteredIds(st: DrillState, words: readonly DeckWord[], baseline: readonly MasterRow[]): string[] {
  const mastered = new Set(baseline.filter((r) => r.status === 'mastered').map((r) => r.word.trim()));
  return words.filter((w) => mastered.has(w.headword) && unseen(st, w.id)).map((w) => drillCardId(w.id, 'f'));
}
