// Review queue.

import type { ItemId } from '@ksrs/content';
import type { DerivedState } from './state.ts';

/**
 * Items due for review at `now`: stage 1–8 with availableAt ≤ now, plus any item with an
 * open pending group (a session interrupted mid-item resumes). Hanja are never due.
 * Ordered by availableAt, then content order.
 */
export function dueItems(s: DerivedState, now: number): ItemId[] {
  const out: { id: ItemId; t: number; o: number }[] = [];
  for (const st of s.items.values()) {
    if (st.kind === 'hanja' || st.stage < 1 || st.stage > 8 || st.availableAt === null) continue;
    if (st.availableAt <= now || st.pending !== null) {
      out.push({ id: st.itemId, t: st.availableAt, o: s.index.order.get(st.itemId) ?? Number.MAX_SAFE_INTEGER });
    }
  }
  out.sort((a, b) => a.t - b.t || a.o - b.o || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out.map((x) => x.id);
}
