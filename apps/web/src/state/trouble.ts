// Trouble-list view model (pure). Unit-tested in test/trouble.test.ts.
import type { ItemId } from '@ksrs/content';
import { headword, liveEvents, troubleItems, type AppEvent, type DerivedState } from '@ksrs/srs-engine';

export interface TroubleRow {
  itemId: ItemId; label: string; kind: string; score: number; stage: number;
  lastWrong: { response: string; at: number; qtype: string } | null;
}

/** Leeches (§7.5) with the most recent wrong answer each (voided/overridden answers excluded). */
export function troubleRows(s: DerivedState, events: readonly AppEvent[], now: number, limit = 50): TroubleRow[] {
  const list = troubleItems(s, limit, now);
  if (!list.length) return [];
  const want = new Set(list.map((t) => t.itemId));
  const last = new Map<ItemId, TroubleRow['lastWrong']>();
  const live = liveEvents(events);
  for (let i = live.length - 1; i >= 0 && last.size < want.size; i--) {
    const e = live[i]!;
    if (e.type !== 'review.answer' || e.grade !== 'incorrect' || !want.has(e.itemId) || last.has(e.itemId)) continue;
    last.set(e.itemId, { response: e.response, at: e.at, qtype: e.qtype });
  }
  return list.map((t) => {
    const it = s.index.byId.get(t.itemId);
    return {
      itemId: t.itemId, label: it ? headword(it) ?? t.itemId : t.itemId, kind: it?.kind ?? 'vocab', score: t.score,
      stage: s.items.get(t.itemId)?.stage ?? 0, lastWrong: last.get(t.itemId) ?? null,
    };
  });
}
