// Ghost reviews: extra practice for grammar misses, derived from the review log (no events).
// Every live incorrect `review.answer` on a grammar item opens two ghost slots, at +2 h and
// +24 h after the miss. Ghost sessions run in the no-events session mode ('extra'), so they never
// change SRS state. Which slots were done is per-device UI state (kept in kv by the app, not
// synced); slots also lapse GHOST_EXPIRY_MS after they come due, so an old log doesn't resurface
// a pile of stale ghosts.

import type { ItemId } from '@ksrs/content';
import { resolveId, type ContentIndex } from './content-index.ts';
import type { AppEvent } from './events.ts';
import { liveEvents } from './replay.ts';
import { DAY, HOUR } from './util.ts';

export const GHOST_OFFSETS_MS: readonly number[] = Object.freeze([2 * HOUR, 24 * HOUR]);
export const GHOST_EXPIRY_MS = 7 * DAY;

export interface GhostSlot {
  /** Stable id: `${missEventId}@${offsetHours}h`. */
  key: string;
  itemId: ItemId;
  missAt: number;
  dueAt: number;
}

export interface GhostDue {
  itemId: ItemId;
  /** Due, not-done, not-expired slot keys for this item (completing the item clears them all). */
  slots: string[];
  /** Earliest due time among them. */
  dueAt: number;
}

/** All ghost slots in the log, ordered by dueAt then key. */
export function ghostSlots(index: ContentIndex, events: readonly AppEvent[]): GhostSlot[] {
  const out: GhostSlot[] = [];
  for (const e of liveEvents(events)) {
    if (e.type !== 'review.answer' || e.grade !== 'incorrect') continue;
    const itemId = resolveId(index.redirects, e.itemId);
    if (index.byId.get(itemId)?.kind !== 'grammar') continue;
    for (const off of GHOST_OFFSETS_MS) {
      out.push({ key: `${e.id}@${off / HOUR}h`, itemId, missAt: e.at, dueAt: e.at + off });
    }
  }
  out.sort((a, b) => a.dueAt - b.dueAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

const live = (g: GhostSlot, now: number, done: ReadonlySet<string>): boolean =>
  !done.has(g.key) && now < g.dueAt + GHOST_EXPIRY_MS;

/** Ghost practice due at `now`, one entry per item, earliest first. */
export function dueGhosts(index: ContentIndex, events: readonly AppEvent[], now: number, done: Iterable<string> = []): GhostDue[] {
  const doneSet = new Set(done);
  const byItem = new Map<ItemId, GhostDue>();
  for (const g of ghostSlots(index, events)) {
    if (g.dueAt > now || !live(g, now, doneSet)) continue;
    const cur = byItem.get(g.itemId);
    if (cur) cur.slots.push(g.key);
    else byItem.set(g.itemId, { itemId: g.itemId, slots: [g.key], dueAt: g.dueAt });
  }
  return [...byItem.values()];
}

/** When the next not-yet-due ghost arrives, if any. */
export function nextGhostAt(index: ContentIndex, events: readonly AppEvent[], now: number, done: Iterable<string> = []): number | undefined {
  const doneSet = new Set(done);
  return ghostSlots(index, events).find((g) => g.dueAt > now && live(g, now, doneSet))?.dueAt;
}

/** Done-keys worth keeping (slots that could still be due); the rest can be dropped from storage. */
export function pruneGhostDone(index: ContentIndex, events: readonly AppEvent[], now: number, done: Iterable<string>): string[] {
  const keep = new Set(ghostSlots(index, events).filter((g) => now < g.dueAt + GHOST_EXPIRY_MS).map((g) => g.key));
  return [...new Set(done)].filter((k) => keep.has(k)).sort();
}
