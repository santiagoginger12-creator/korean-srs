// Lookup structure over the content bundle plus custom items (custom items join the index
// and override a bundle item with the same id).

import type { ContentBundle, Item, ItemId, ItemKind } from '@ksrs/content';

export interface ContentIndex {
  byId: Map<ItemId, Item>;
  /** Global order: bundle order, then custom items in first-upsert order. */
  order: Map<ItemId, number>;
  byLevel: Map<number, Item[]>;
  levels: number[]; // ascending
  maxLevel: number;
  redirects: Record<ItemId, ItemId>;
  /** hanja id → vocab ids whose hanjaBreakdown references it. */
  vocabByHanja: Map<ItemId, ItemId[]>;
  contentVersion: string;
}

export const KIND_ORDER: Record<ItemKind, number> = { hanja: 0, vocab: 1, grammar: 2, expression: 3 };

export function buildContentIndex(content: ContentBundle, customItems?: Iterable<Item>): ContentIndex {
  const byId = new Map<ItemId, Item>();
  for (const it of content.items) byId.set(it.id, it);
  if (customItems) for (const it of customItems) byId.set(it.id, it);

  const order = new Map<ItemId, number>();
  let i = 0;
  for (const id of byId.keys()) order.set(id, i++);

  const byLevel = new Map<number, Item[]>();
  for (const it of byId.values()) {
    const arr = byLevel.get(it.level);
    if (arr) arr.push(it); else byLevel.set(it.level, [it]);
  }
  const levels = [...byLevel.keys()].sort((a, b) => a - b);

  const vocabByHanja = new Map<ItemId, ItemId[]>();
  for (const it of byId.values()) {
    if (it.kind !== 'vocab' || !it.hanjaBreakdown) continue;
    for (const hb of it.hanjaBreakdown) {
      if (!hb.hanjaId) continue;
      const hid = resolveId(content.idRedirects, hb.hanjaId);
      const arr = vocabByHanja.get(hid);
      if (!arr) vocabByHanja.set(hid, [it.id]);
      else if (!arr.includes(it.id)) arr.push(it.id);
    }
  }

  return {
    byId, order, byLevel, levels,
    maxLevel: levels.length ? levels[levels.length - 1]! : 0,
    redirects: content.idRedirects,
    vocabByHanja,
    contentVersion: content.contentVersion,
  };
}

/** Follows `idRedirects` (chains allowed, cycles cut after 32 hops). */
export function resolveId(redirects: Record<ItemId, ItemId>, id: ItemId): ItemId {
  let cur = id;
  for (let hops = 0; hops < 32; hops++) {
    const next = Object.prototype.hasOwnProperty.call(redirects, cur) ? redirects[cur] : undefined;
    if (next === undefined || next === cur) return cur;
    cur = next;
  }
  return cur;
}

/** Headword shown as the prompt for meaning questions. */
export function headword(it: Item): string {
  switch (it.kind) {
    case 'vocab': return it.word;
    case 'grammar': return it.pattern;
    case 'expression': return it.text;
    case 'hanja': return it.char;
  }
}
