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
      fix('collocations', repairList(o.collocations, (x) => withStrs(x, ['ko'], ['en'])));
      fix('examples', repairList(o.examples, repairExample));
      if (o.hanjaBreakdown !== undefined) fix('hanjaBreakdown', repairList(o.hanjaBreakdown, (x) => withStrs(x, ['syllable'], ['hanja'])));
      break;
    case 'grammar':
      for (const k of ['pattern', 'meaning', 'nuance']) fix(k, str(o[k]));
      fix('attachment', repairList(o.attachment, (x) => withStrs(x, [], ['stem', 'tense', 'form', 'example'])));
      fix('contrasts', repairList(only(o.contrasts, hasId), (x) => withStrs(x, ['id'], ['note'])));
      fix('examples', repairList(o.examples, repairExample));
      break;
    case 'expression':
      for (const k of ['text', 'meaning', 'literal', 'usage']) fix(k, str(o[k]));
      fix('subtype', str(o.subtype, '관용구'));
      fix('examples', repairList(o.examples, repairExample));
      break;
  }
  if (o.kind !== 'hanja') {
    const q0 = (typeof o.questions === 'object' && o.questions !== null ? o.questions : {}) as Obj;
    // QA M5: repair each prompt too. A non-empty prompt array with a malformed prompt (e.g. a
    // cloze without `sentence`) used to pass and crash question building in reviews.
    const q: Obj = { ...q0 };
    const qfix = (k: string, v: unknown) => { if (v === undefined) delete q[k]; else if (q[k] !== v) q[k] = v; };
    qfix('meaning', repairAnswerSpec(q0.meaning, []));
    qfix('production', repairAnswerSpec(q0.production, ['promptEn']));
    qfix('cloze', q0.cloze === undefined ? undefined : repairList(q0.cloze, repairCloze));
    qfix('nuance', q0.nuance === undefined ? undefined : repairList(q0.nuance, repairNuance));
    qfix('register', q0.register === undefined ? undefined : repairList(q0.register, repairRegister));
    const qs = Object.keys(q).length === Object.keys(q0).length && Object.keys(q).every((k) => q[k] === q0[k]) ? q0 : q;
    const usable = (t: unknown): boolean => {
      const spec = qs[t as string];
      if (t === 'meaning' || t === 'production') return typeof spec === 'object' && spec !== null && Array.isArray((spec as Obj).accepted);
      return Array.isArray(spec) && spec.length > 0;
    };
    fix('questions', qs);
    fix('questionTypes', only(o.questionTypes, usable));
  }
  const changed = Object.keys(out).some((k) => out[k] !== o[k]);
  return changed ? (out as unknown as Item) : it;
}

const isObjX = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const DROP = Symbol('drop');

/** Maps `repair` over an array (non-arrays → []), dropping DROP; the same array when nothing changed. */
function repairList(v: unknown, repair: (x: unknown) => unknown): unknown[] {
  const a = arr(v);
  let changed = a !== v;
  const out: unknown[] = [];
  for (const x of a) {
    const r = repair(x);
    if (r !== x) changed = true;
    if (r !== DROP) out.push(r);
  }
  return changed ? out : a;
}

/** Object with every `required` key a string (else DROP) and `defaults` keys defaulted to ''. */
function withStrs(x: unknown, required: string[], defaults: string[]): unknown {
  if (!isObjX(x) || required.some((k) => typeof x[k] !== 'string')) return DROP;
  const bad = defaults.filter((k) => typeof x[k] !== 'string');
  if (!bad.length) return x;
  const out: Obj = { ...x };
  for (const k of bad) out[k] = '';
  return out;
}

const strList = (v: unknown): unknown[] => only(v, isStrX);
/** Patches fields of `x`; returns `x` itself when no patch changes anything. */
function patch(x: Obj, p: Obj): Obj {
  return Object.keys(p).some((k) => p[k] !== x[k]) ? { ...x, ...p } : x;
}

const repairExample = (x: unknown): unknown => withStrs(x, ['ko'], ['en']);

function repairAnswerSpec(v: unknown, strKeys: string[]): unknown {
  if (v === undefined) return undefined;
  if (!isObjX(v) || !Array.isArray(v.accepted)) return undefined;
  const p: Obj = { accepted: strList(v.accepted) };
  if (v.rejected !== undefined) p.rejected = strList(v.rejected);
  for (const k of strKeys) p[k] = str(v[k]);
  return patch(v, p);
}

function repairCloze(x: unknown): unknown {
  if (!isObjX(x) || typeof x.id !== 'string' || typeof x.sentence !== 'string' || !Array.isArray(x.accepted)) return DROP;
  const p: Obj = { accepted: strList(x.accepted), en: str(x.en), cue: str(x.cue), particleTolerance: str(x.particleTolerance, 'allomorph') };
  if (x.nearMiss !== undefined) p.nearMiss = repairList(x.nearMiss, (n) => withStrs(n, ['answer'], ['hint']));
  return patch(x, p);
}

function repairNuance(x: unknown): unknown {
  if (!isObjX(x) || typeof x.id !== 'string') return DROP;
  const options = repairList(x.options, (op) => {
    const r = withStrs(op, ['text'], ['why']);
    return r === DROP || typeof (r as Obj).correct === 'boolean' ? r : { ...(r as Obj), correct: false };
  });
  if (options.length < 2) return DROP;
  return patch(x, { situation: str(x.situation), options });
}

function repairRegister(x: unknown): unknown {
  if (!isObjX(x) || typeof x.id !== 'string' || typeof x.source !== 'string' || !Array.isArray(x.accepted)) return DROP;
  const features = repairList(x.features, (f) => {
    if (!isObjX(f) || typeof f.kind !== 'string') return DROP;
    return patch(f, { any: strList(f.any), label: str(f.label) });
  });
  return patch(x, {
    accepted: strList(x.accepted), features, coreWords: strList(x.coreWords), from: str(x.from), to: str(x.to),
    particleTolerance: str(x.particleTolerance, 'allomorph'), finalPunctOptional: typeof x.finalPunctOptional === 'boolean' ? x.finalPunctOptional : false,
  });
}
