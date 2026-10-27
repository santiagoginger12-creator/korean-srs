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
  if (customItems) for (const it of customItems) byId.set(it.id, repairCustomItem(it));

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

type Obj = Record<string, unknown>;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
/** `arr(v)` keeping only elements that pass; the same array when they all do. */
const only = (v: unknown, ok: (x: unknown) => boolean): unknown[] => { const a = arr(v); return a.every(ok) ? a : a.filter(ok); };
const isStrX = (x: unknown): boolean => typeof x === 'string';
const hasId = (x: unknown): boolean => typeof x === 'object' && x !== null && typeof (x as Obj).id === 'string';

/**
 * Custom items arrive through events that are only structurally validated (id, kind, level), so
 * a hand-edited backup or an older/newer device can deliver a partial item. Every consumer
 * (lessons, reviews, item pages, browse, related items) assumes the full shape, so the index
 * gets a copy with missing or mistyped fields defaulted, and question types whose spec is
 * unusable dropped. Complete items are returned unchanged (same object).
 */
export function repairCustomItem(it: Item): Item {
  const o = it as unknown as Obj;
  const out: Obj = { ...o };
  const fix = (k: string, v: unknown) => { if (out[k] !== v) out[k] = v; };
  fix('tags', arr(o.tags));
  fix('unlockDeps', only(o.unlockDeps, hasId));
  if (typeof o.source !== 'object' || o.source === null || typeof (o.source as Obj).kind !== 'string') {
    out.source = { kind: 'import', license: 'unknown', attribution: 'unknown source' };
  }
  switch (o.kind) {
    case 'hanja':
      for (const k of ['char', 'hun', 'eum', 'mnemonic']) fix(k, str(o[k]));
      fix('meanings', only(o.meanings, isStrX));
      break;
    case 'vocab':
      for (const k of ['word', 'pos']) fix(k, str(o[k]));
      fix('register', str(o.register, 'neutral'));
      fix('meanings', only(o.meanings, isStrX));
      fix('collocations', arr(o.collocations));
      fix('examples', arr(o.examples));
      if (o.hanjaBreakdown !== undefined) fix('hanjaBreakdown', arr(o.hanjaBreakdown));
      break;
    case 'grammar':
      for (const k of ['pattern', 'meaning', 'nuance']) fix(k, str(o[k]));
      fix('attachment', arr(o.attachment));
      fix('contrasts', only(o.contrasts, hasId));
      fix('examples', arr(o.examples));
      break;
    case 'expression':
      for (const k of ['text', 'meaning', 'literal', 'usage']) fix(k, str(o[k]));
      fix('subtype', str(o.subtype, '관용구'));
      fix('examples', arr(o.examples));
      break;
  }
  if (o.kind !== 'hanja') {
    const q = (typeof o.questions === 'object' && o.questions !== null ? o.questions : {}) as Obj;
    const usable = (t: unknown): boolean => {
      const spec = q[t as string];
      if (t === 'meaning' || t === 'production') return typeof spec === 'object' && spec !== null && Array.isArray((spec as Obj).accepted);
      return Array.isArray(spec) && spec.length > 0;
    };
    fix('questions', q);
    fix('questionTypes', only(o.questionTypes, usable));
  }
  const changed = Object.keys(out).some((k) => out[k] !== o[k]);
  return changed ? (out as unknown as Item) : it;
}
