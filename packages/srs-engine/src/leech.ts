// Leech detection (§7.5): score = incorrectLast90d / max(1, streak)^1.5; leech when score ≥ 3 and reviews ≥ 4.

import type { ItemId } from '@ksrs/content';
import type { DerivedState, ItemState } from './state.ts';
import { DAY } from './util.ts';

export const LEECH_WINDOW_MS = 90 * DAY;
export const LEECH_MIN_SCORE = 3;
export const LEECH_MIN_REVIEWS = 4;

export function leechScore(incorrectAts: readonly number[], streak: number, now: number): number {
  const from = now - LEECH_WINDOW_MS;
  let n = 0;
  for (const t of incorrectAts) if (t > from && t <= now) n++;
  return n / Math.pow(Math.max(1, streak), 1.5);
}

export function isLeech(st: ItemState, now?: number): boolean {
  if (st.kind === 'hanja' || st.stats.reviews < LEECH_MIN_REVIEWS) return false;
  const score = now === undefined ? st.leechScore : leechScore(st.recentIncorrectAts, st.stats.streak, now);
  return score >= LEECH_MIN_SCORE;
}

/** Leeches sorted by score (desc), then item id. Pass `now` to score against the current time. */
export function troubleItems(s: DerivedState, limit = 20, now?: number): { itemId: ItemId; score: number }[] {
  const out: { itemId: ItemId; score: number }[] = [];
  for (const st of s.items.values()) {
    if (!isLeech(st, now)) continue;
    const score = now === undefined ? st.leechScore : leechScore(st.recentIncorrectAts, st.stats.streak, now);
    out.push({ itemId: st.itemId, score });
  }
  out.sort((a, b) => b.score - a.score || (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
  return out.slice(0, Math.max(0, limit));
}
