// Related items for item pages (M3, §15): hanja families, grammar contrasts in both
// directions, and unlock edges. Pure; the reverse maps are memoized per ContentIndex.

import type { ItemId, UnlockDep } from '@ksrs/content';
import { resolveId, type ContentIndex } from './content-index.ts';
import { unlockDepsOf } from './unlock.ts';

export interface RelatedItems {
  /**
   * Vocab: one group per content hanja in its breakdown, listing the *other* vocab that share
   * it (the group is present even when empty). Hanja: one group for itself, listing all its
   * vocab. Otherwise empty. Items are in content order.
   */
  byHanja: { hanjaId: ItemId; items: ItemId[] }[];
  /** Grammar contrasts: 'out' = listed on this item; 'in' = another item lists this one. */
  contrasts: { id: ItemId; note: string; direction: 'out' | 'in' }[];
  /** This item's effective unlock deps (explicit + implicit hanja-lesson deps). */
  unlockedBy: UnlockDep[];
  /** Items whose effective deps include this item, in content order. */
  unlocks: ItemId[];
}

interface Reverse {
  contrastsIn: Map<ItemId, { id: ItemId; note: string }[]>;
  unlocks: Map<ItemId, ItemId[]>;
}

const cache = new WeakMap<ContentIndex, Reverse>();

function reverse(index: ContentIndex): Reverse {
  const hit = cache.get(index);
  if (hit) return hit;
  const contrastsIn = new Map<ItemId, { id: ItemId; note: string }[]>();
  const unlocks = new Map<ItemId, ItemId[]>();
  const push = <T>(m: Map<ItemId, T[]>, k: ItemId, v: T) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); };
  for (const it of index.byId.values()) { // byId iteration is content order
    if (it.kind === 'grammar') {
      for (const c of it.contrasts ?? []) { // custom items are only shape-checked (events.ts)
        const target = resolveId(index.redirects, c.id);
        if (target !== it.id && index.byId.has(target)) push(contrastsIn, target, { id: it.id, note: c.note });
      }
    }
    for (const d of unlockDepsOf(index, it)) push(unlocks, d.id, it.id);
  }
  const r = { contrastsIn, unlocks };
  cache.set(index, r);
  return r;
}

const EMPTY: RelatedItems = { byHanja: [], contrasts: [], unlockedBy: [], unlocks: [] };

export function relatedItems(index: ContentIndex, itemId: ItemId): RelatedItems {
  const id = resolveId(index.redirects, itemId);
  const it = index.byId.get(id);
  if (!it) return { ...EMPTY };
  const rev = reverse(index);
  const byOrder = (a: ItemId, b: ItemId) => (index.order.get(a) ?? 0) - (index.order.get(b) ?? 0);

  const byHanja: RelatedItems['byHanja'] = [];
  if (it.kind === 'hanja') {
    byHanja.push({ hanjaId: id, items: (index.vocabByHanja.get(id) ?? []).slice().sort(byOrder) });
  } else if (it.kind === 'vocab') {
    const seen = new Set<ItemId>();
    for (const hb of it.hanjaBreakdown ?? []) {
      if (!hb.hanjaId) continue;
      const hid = resolveId(index.redirects, hb.hanjaId);
      if (seen.has(hid) || index.byId.get(hid)?.kind !== 'hanja') continue;
      seen.add(hid);
      byHanja.push({ hanjaId: hid, items: (index.vocabByHanja.get(hid) ?? []).filter((v) => v !== id).sort(byOrder) });
    }
  }

  const contrasts: RelatedItems['contrasts'] = [];
  if (it.kind === 'grammar') {
    const outIds = new Set<ItemId>();
    for (const c of it.contrasts ?? []) {
      const cid = resolveId(index.redirects, c.id);
      if (cid === id || !index.byId.has(cid) || outIds.has(cid)) continue;
      outIds.add(cid);
      contrasts.push({ id: cid, note: c.note, direction: 'out' });
    }
    for (const c of rev.contrastsIn.get(id) ?? []) contrasts.push({ ...c, direction: 'in' });
  }

  return {
    byHanja,
    contrasts,
    unlockedBy: unlockDepsOf(index, it),
    unlocks: (rev.unlocks.get(id) ?? []).slice().sort(byOrder),
  };
}
