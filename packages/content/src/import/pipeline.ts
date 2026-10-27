// Shared import pipeline: id generation, defaults, structural + semantic validation against the
// merged set (existing + incoming), and diffs. Never throws on bad input.

import type { Item, ItemId, ItemKind } from '../schema/types.ts';
import { ID_PREFIX, headword, validateBundle, validateItem } from '../validate.ts';
import type { ImportContext, ImportIssue, ImportResult } from './types.ts';

const KINDS: readonly ItemKind[] = ['vocab', 'grammar', 'expression', 'hanja'];
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A raw item plus where it came from (for issue row numbers). */
export interface Candidate { raw: unknown; row?: number }

// ---------------------------------------------------------------------------
// Ids

/** Headword → id slug: whitespace runs become `-`; grammar patterns lose their leading hyphen. */
export function idSlug(kind: ItemKind, head: string): string {
  let s = head.normalize('NFC').trim().replace(/\s+/g, '-');
  if (kind === 'grammar') s = s.replace(/^[-~]+/, '');
  return s;
}

function rawHeadword(o: Obj): string | undefined {
  const h = o.kind === 'vocab' ? o.word : o.kind === 'grammar' ? o.pattern : o.kind === 'expression' ? o.text : o.kind === 'hanja' ? o.char : undefined;
  return typeof h === 'string' && h.trim() ? h.trim() : undefined;
}

/**
 * Deterministic id for an item without one. Reuses an existing id whose item has the same kind
 * and headword (so re-importing updates it); otherwise disambiguates with `:2`, `:3`, …
 * Ids already claimed earlier in the same import are never reused.
 */
export function generateId(kind: ItemKind, head: string, ctx: ImportContext, claimed: ReadonlySet<ItemId>): ItemId {
  const base = `${ID_PREFIX[kind]}${ctx.idPrefixUser ?? ''}${idSlug(kind, head)}`;
  for (let n = 1; n < 10_000; n++) {
    const id = n === 1 ? base : `${base}:${n}`;
    if (claimed.has(id)) continue;
    const ex = ctx.existing.get(id);
    if (!ex) return id;
    if (ex.kind === kind && headword(ex).trim() === head.trim()) return id;
  }
  return `${base}:${claimed.size + 1}`;
}

// ---------------------------------------------------------------------------
// Defaults for loosely-specified JSON items

/** Fills base defaults a hand-written JSON item may omit. Returns a shallow copy. */
export function withDefaults(o: Obj, ctx: ImportContext): Obj {
  const out: Obj = { ...o };
  const kind = out.kind;
  out.source ??= { ...ctx.defaultSource };
  out.track ??= 'core';
  out.rev ??= 1;
  out.tags ??= [];
  out.unlockDeps ??= [];
  out.needs_review ??= false;
  out.gating ??= kind !== 'hanja';
  if (kind === 'vocab') { out.collocations ??= []; out.examples ??= []; }
  if (kind === 'grammar') { out.contrasts ??= []; out.examples ??= []; }
  if (kind === 'expression') out.examples ??= [];
  return out;
}

// ---------------------------------------------------------------------------
// Validation

const relPath = (id: string | undefined, p: string): string => {
  let s = p;
  if (s.startsWith('$')) s = s.slice(1);
  else if (id && s.startsWith(id)) s = s.slice(id.length);
  return s.replace(/^\./, '') || '$';
};

/**
 * Validates candidates and returns the ones that pass. Structural problems come from
 * `validateItem`; semantic ones (refs, cycles, attribution, examples…) from `validateBundle`
 * over existing ∪ incoming, iterated so an item that only fails because it references a
 * rejected item is rejected too.
 */
export function finalize(cands: readonly Candidate[], ctx: ImportContext, issues: ImportIssue[] = []): ImportResult {
  const claimed = new Set<ItemId>();
  const rowOf = new Map<ItemId, number | undefined>();
  const accepted: Item[] = [];
  const push = (i: ImportIssue) => {
    if (i.row === undefined) delete i.row;
    if (i.id === undefined) delete i.id;
    issues.push(i);
  };

  for (const c of cands) {
    if (!isObj(c.raw)) { push({ row: c.row, path: '$', msg: 'item must be an object', severity: 'error' }); continue; }
    let o = c.raw;
    const kind = o.kind;
    if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) {
      push({ row: c.row, id: typeof o.id === 'string' ? o.id : undefined, path: 'kind', msg: `must be one of ${KINDS.join(' | ')}`, severity: 'error' });
      continue;
    }
    if (o.id === undefined || o.id === '') {
      const head = rawHeadword(o);
      if (!head) { push({ row: c.row, path: 'id', msg: 'no id and no headword to generate one from', severity: 'error' }); continue; }
      o = { ...o, id: generateId(kind as ItemKind, head, ctx, claimed) };
    }
    const id = typeof o.id === 'string' ? o.id : undefined;
    if (id !== undefined && claimed.has(id)) {
      const prev = rowOf.get(id);
      push({ row: c.row, id, path: 'id', msg: `duplicate id in this import${prev !== undefined ? ` (also row ${prev})` : ''}`, severity: 'error' });
      continue;
    }
    if (id !== undefined) { claimed.add(id); rowOf.set(id, c.row); }
    const r = validateItem(o);
    if (!r.ok || !r.item) {
      for (const e of r.errors) push({ row: c.row, id, path: relPath(undefined, e.path), msg: e.msg, severity: 'error' });
      continue;
    }
    const ex = ctx.existing.get(r.item.id);
    if (ex && ex.kind !== r.item.kind) {
      push({ row: c.row, id, path: 'kind', msg: `id already belongs to a ${ex.kind} item`, severity: 'error' });
      continue;
    }
    // Re-importing an item whose row has no source of its own keeps the source it already has
    // (QA M5): otherwise the same rows from a renamed copy ("words (1).csv") show every item
    // as changed only because the default attribution names the file.
    if (ex && ex.source.kind === ctx.defaultSource.kind && stableJson(r.item.source) === stableJson(ctx.defaultSource)) {
      accepted.push({ ...r.item, source: ex.source });
      continue;
    }
    accepted.push(r.item);
  }

  // Semantic pass over the merged set.
  let live = accepted;
  const seen = new Set<string>();
  const add = (i: ImportIssue) => {
    const k = `${i.severity}|${i.id}|${i.path}|${i.msg}`;
    if (seen.has(k)) return;
    seen.add(k);
    push(i);
  };
  let warnings: ImportIssue[] = [];
  for (let pass = 0; pass < 8; pass++) {
    const incoming = new Map(live.map((it) => [it.id, it] as const));
    const merged = new Map(ctx.existing);
    for (const it of live) merged.set(it.id, it);
    const rep = validateBundle([...merged.values()]);
    const bad = new Set<ItemId>();
    for (const e of rep.errors) {
      if (!e.itemId || !incoming.has(e.itemId)) continue;
      bad.add(e.itemId);
      add({ row: rowOf.get(e.itemId), id: e.itemId, path: relPath(e.itemId, e.path), msg: e.msg, severity: 'error' });
    }
    warnings = rep.warnings
      .filter((w) => w.itemId && incoming.has(w.itemId))
      .map((w) => ({ row: rowOf.get(w.itemId!), id: w.itemId, path: relPath(w.itemId, w.path), msg: w.msg, severity: 'warning' as const }));
    if (!bad.size) break;
    live = live.filter((it) => !bad.has(it.id));
  }
  for (const w of warnings) add(w);
  for (const it of live) {
    if (ctx.existing.get(it.id)?.source.kind === 'original' && it.source.kind !== 'original') {
      add({ row: rowOf.get(it.id), id: it.id, path: 'id', msg: 'replaces a built-in item on this device', severity: 'warning' });
    }
  }
  issues.sort((a, b) => (a.row ?? 0) - (b.row ?? 0));
  return { items: live, issues };
}

/** Validates already-built items (e.g. KRDict drafts the user edited) the same way imports are. */
export function importItems(raw: readonly unknown[], ctx: ImportContext): ImportResult {
  return finalize(raw.map((r, i) => ({ raw: isObj(r) ? withDefaults(r, ctx) : r, row: i + 1 })), ctx);
}

// ---------------------------------------------------------------------------
// JSON import

/** Accepts a ContentBundle, an Item[], or `{ items: Item[] }`. */
export function importJson(text: string, ctx: ImportContext): ImportResult {
  let data: unknown;
  try { data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text); }
  catch (e) {
    return { items: [], issues: [{ path: '$', msg: `not valid JSON: ${e instanceof Error ? e.message : String(e)}`, severity: 'error' }] };
  }
  let list: unknown[];
  const pre: ImportIssue[] = [];
  if (Array.isArray(data)) list = data;
  else if (isObj(data) && Array.isArray(data.items)) {
    list = data.items;
    if (isObj(data.idRedirects) && Object.keys(data.idRedirects).length) {
      pre.push({ path: 'idRedirects', msg: 'idRedirects are not imported (custom items have no rename history)', severity: 'warning' });
    }
  } else if (isObj(data) && typeof data.kind === 'string') list = [data];
  else return { items: [], issues: [{ path: '$', msg: 'expected a content bundle, an array of items, or { "items": [...] }', severity: 'error' }] };
  return finalize(list.map((r, i) => ({ raw: isObj(r) ? withDefaults(r, ctx) : r, row: i + 1 })), ctx, pre);
}

// ---------------------------------------------------------------------------
// Diff

/** Canonical JSON: sorted keys, undefined members dropped. */
export function stableJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : stableJson(x))).join(',')}]`;
  const o = v as Obj;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(',')}}`;
}

export function diffItems(existing: ReadonlyMap<ItemId, Item>, incoming: readonly Item[]):
  { added: ItemId[]; changed: { id: ItemId; fields: string[] }[]; unchanged: ItemId[] } {
  const added: ItemId[] = [];
  const changed: { id: ItemId; fields: string[] }[] = [];
  const unchanged: ItemId[] = [];
  const done = new Set<ItemId>();
  for (const it of incoming) {
    if (done.has(it.id)) continue;
    done.add(it.id);
    const ex = existing.get(it.id);
    if (!ex) { added.push(it.id); continue; }
    const a = ex as unknown as Obj;
    const b = it as unknown as Obj;
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    const fields = keys.filter((k) => stableJson(a[k]) !== stableJson(b[k]));
    if (fields.length) changed.push({ id: it.id, fields }); else unchanged.push(it.id);
  }
  return { added, changed, unchanged };
}
