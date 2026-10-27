// Hand-written content validator (D19: no Zod). Pure: no I/O, clock, or RNG.
//
// validateItem  — field-level structural checks for one raw item, per schema/types.ts.
// validateBundle — structural + semantic checks across a set of items (ARCHITECTURE.md §9).

import type {
  ClozePrompt, ExpressionItem, FeatureRule, GrammarItem, HanjaItem, Item, ItemId, ItemKind,
  NuancePrompt, QuestionType, RegisterPrompt, VocabItem,
} from './schema/types.ts';

export interface Issue { path: string; msg: string }
export interface BundleIssue extends Issue { itemId?: ItemId }

export interface ItemResult { ok: boolean; item?: Item; errors: Issue[] }

export interface NeedsReviewEntry { id: ItemId; level: number; kind: ItemKind; item: boolean; examples: number[] }

export interface ValidationReport {
  ok: boolean;
  errors: BundleIssue[];
  warnings: BundleIssue[];
  /** Items that passed structural validation (semantic errors may still apply). */
  items: Item[];
  counts: {
    total: number;
    byKind: Record<ItemKind, number>;
    byLevel: Record<number, Record<ItemKind, number>>;
    needsReviewItems: number;
    needsReviewExamples: number;
  };
  needsReview: NeedsReviewEntry[];
}

export interface ValidateBundleOptions {
  /** Human-readable origin of each raw item (e.g. "seed/L01/vocab.json#2"), parallel to `items`. */
  origins?: string[];
  /** Renamed ids → current ids; keys must not be live ids, values must resolve. */
  idRedirects?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Constants

export const ID_PREFIX: Record<ItemKind, string> = { vocab: 'v:', grammar: 'g:', expression: 'x:', hanja: 'h:' };
const KINDS: readonly ItemKind[] = ['vocab', 'grammar', 'expression', 'hanja'];
const QTYPES: readonly QuestionType[] = ['meaning', 'production', 'cloze', 'nuance', 'register'];
const REGISTERS = ['formal', 'written', 'neutral', 'spoken', 'slang'] as const;
const SPEECH_LEVELS = ['hapsyo', 'haeyo', 'hae', 'haera', 'written', 'spoken'] as const;
const PARTICLE_TOL = ['none', 'allomorph', 'loose'] as const;
const SOURCE_KINDS = ['original', 'krdict', 'user', 'import'] as const;
const STEMS = ['V', 'A', 'N', 'N이다', 'V/A'] as const;
const FINALS = ['vowel', 'consonant', 'ㄹ', 'any'] as const;
const TENSES = ['present', 'past', 'future', 'any'] as const;
const SUBTYPES = ['관용구', '속담', '사자성어'] as const;
const CLOZE_GAP = '{{}}';

// ---------------------------------------------------------------------------
// Structural helpers

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

class Ctx {
  errors: Issue[] = [];
  err(path: string, msg: string): void { this.errors.push({ path, msg }); }

  obj(o: Obj, k: string, path: string): Obj | undefined {
    const v = o[k];
    if (!isObj(v)) { this.err(`${path}.${k}`, 'must be an object'); return undefined; }
    return v;
  }
  str(o: Obj, k: string, path: string, opts: { optional?: boolean; allowEmpty?: boolean } = {}): void {
    const v = o[k];
    if (v === undefined && opts.optional) return;
    if (typeof v !== 'string') { this.err(`${path}.${k}`, 'must be a string'); return; }
    if (!opts.allowEmpty && v.trim() === '') this.err(`${path}.${k}`, 'must be a non-empty string');
  }
  bool(o: Obj, k: string, path: string, optional = false): void {
    const v = o[k];
    if (v === undefined && optional) return;
    if (typeof v !== 'boolean') this.err(`${path}.${k}`, 'must be a boolean');
  }
  int(o: Obj, k: string, path: string, min: number, optional = false): void {
    const v = o[k];
    if (v === undefined && optional) return;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min) this.err(`${path}.${k}`, `must be an integer ≥ ${min}`);
  }
  oneOf(o: Obj, k: string, path: string, allowed: readonly string[], optional = false): void {
    const v = o[k];
    if (v === undefined && optional) return;
    if (typeof v !== 'string' || !allowed.includes(v)) this.err(`${path}.${k}`, `must be one of ${allowed.join(' | ')}`);
  }
  /** Array whose elements are checked by `each`. Returns the array or undefined. */
  arr(o: Obj, k: string, path: string, each?: (el: unknown, p: string) => void,
      opts: { optional?: boolean; min?: number } = {}): unknown[] | undefined {
    const v = o[k];
    if (v === undefined && opts.optional) return undefined;
    if (!Array.isArray(v)) { this.err(`${path}.${k}`, 'must be an array'); return undefined; }
    if (opts.min !== undefined && v.length < opts.min) this.err(`${path}.${k}`, `must have at least ${opts.min} element(s)`);
    if (each) v.forEach((el, i) => each(el, `${path}.${k}[${i}]`));
    return v;
  }
  strEl = (el: unknown, p: string): void => {
    if (typeof el !== 'string' || el.trim() === '') this.err(p, 'must be a non-empty string');
  };
  objEl(el: unknown, p: string, f: (o: Obj, p: string) => void): void {
    if (!isObj(el)) { this.err(p, 'must be an object'); return; }
    f(el, p);
  }
}

// ---------------------------------------------------------------------------
// validateItem

export function validateItem(raw: unknown): ItemResult {
  const c = new Ctx();
  if (!isObj(raw)) return { ok: false, errors: [{ path: '$', msg: 'item must be an object' }] };
  const p = '$';
  const kind = raw.kind;
  if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) {
    c.err(`${p}.kind`, `must be one of ${KINDS.join(' | ')}`);
    return { ok: false, errors: c.errors };
  }
  checkBase(c, raw, p);
  switch (kind as ItemKind) {
    case 'hanja': checkHanja(c, raw, p); break;
    case 'vocab': checkReviewable(c, raw, p); checkVocab(c, raw, p); break;
    case 'grammar': checkReviewable(c, raw, p); checkGrammar(c, raw, p); break;
    case 'expression': checkReviewable(c, raw, p); checkExpression(c, raw, p); break;
  }
  return c.errors.length ? { ok: false, errors: c.errors } : { ok: true, item: raw as unknown as Item, errors: [] };
}

function checkBase(c: Ctx, o: Obj, p: string): void {
  c.str(o, 'id', p);
  c.int(o, 'level', p, 1);
  c.str(o, 'track', p);
  c.int(o, 'rev', p, 1);
  c.bool(o, 'gating', p);
  c.bool(o, 'needs_review', p);
  c.str(o, 'mnemonic', p, { optional: true });
  c.arr(o, 'tags', p, c.strEl);
  c.arr(o, 'unlockDeps', p, (el, ep) => c.objEl(el, ep, (d, dp) => {
    c.str(d, 'id', dp);
    c.oneOf(d, 'require', dp, ['lesson', 'guru']);
  }));
  const src = c.obj(o, 'source', p);
  if (src) {
    const sp = `${p}.source`;
    c.oneOf(src, 'kind', sp, SOURCE_KINDS);
    c.str(src, 'license', sp);
    c.str(src, 'attribution', sp, { optional: true });
    c.str(src, 'url', sp, { optional: true });
    c.str(src, 'retrievedAt', sp, { optional: true });
    c.int(src, 'krdictTargetCode', sp, 0, true);
  }
}

function checkHanja(c: Ctx, o: Obj, p: string): void {
  c.str(o, 'char', p);
  c.str(o, 'hun', p);
  c.str(o, 'eum', p);
  c.arr(o, 'meanings', p, c.strEl, { min: 1 });
  c.str(o, 'mnemonic', p); // required for hanja (D20)
}

function checkExamples(c: Ctx, o: Obj, p: string): void {
  c.arr(o, 'examples', p, (el, ep) => c.objEl(el, ep, (e, epp) => {
    c.str(e, 'ko', epp);
    c.str(e, 'en', epp);
    c.oneOf(e, 'register', epp, REGISTERS, true);
    c.bool(e, 'needs_review', epp, true);
  }));
}

function checkReviewable(c: Ctx, o: Obj, p: string): void {
  c.arr(o, 'questionTypes', p, (el, ep) => {
    if (typeof el !== 'string' || !(QTYPES as readonly string[]).includes(el)) c.err(ep, `must be one of ${QTYPES.join(' | ')}`);
  });
  const q = c.obj(o, 'questions', p);
  if (!q) return;
  const qp = `${p}.questions`;
  for (const k of Object.keys(q)) if (!(QTYPES as readonly string[]).includes(k)) c.err(`${qp}.${k}`, 'unknown question type');
  if (q.meaning !== undefined) {
    const m = c.obj(q, 'meaning', qp);
    if (m) { c.arr(m, 'accepted', `${qp}.meaning`, c.strEl); c.arr(m, 'rejected', `${qp}.meaning`, c.strEl, { optional: true }); }
  }
  if (q.production !== undefined) {
    const m = c.obj(q, 'production', qp);
    if (m) {
      const pp = `${qp}.production`;
      c.str(m, 'promptEn', pp);
      c.str(m, 'contextHint', pp, { optional: true });
      c.arr(m, 'accepted', pp, c.strEl);
      c.arr(m, 'rejected', pp, c.strEl, { optional: true });
    }
  }
  c.arr(q, 'cloze', qp, (el, ep) => c.objEl(el, ep, (z, zp) => {
    c.str(z, 'id', zp); c.str(z, 'sentence', zp); c.str(z, 'en', zp); c.str(z, 'cue', zp);
    c.arr(z, 'accepted', zp, c.strEl);
    c.arr(z, 'nearMiss', zp, (nel, np) => c.objEl(nel, np, (n, npp) => { c.str(n, 'answer', npp); c.str(n, 'hint', npp); }), { optional: true });
    c.oneOf(z, 'particleTolerance', zp, PARTICLE_TOL);
    c.bool(z, 'spacingStrict', zp, true);
  }), { optional: true });
  c.arr(q, 'nuance', qp, (el, ep) => c.objEl(el, ep, (n, np) => {
    c.str(n, 'id', np); c.str(n, 'situation', np);
    c.arr(n, 'options', np, (oel, op) => c.objEl(oel, op, (opt, opp) => {
      c.str(opt, 'text', opp); c.bool(opt, 'correct', opp); c.str(opt, 'why', opp);
    }));
  }), { optional: true });
  c.arr(q, 'register', qp, (el, ep) => c.objEl(el, ep, (r, rp) => {
    c.str(r, 'id', rp);
    c.oneOf(r, 'from', rp, SPEECH_LEVELS); c.oneOf(r, 'to', rp, SPEECH_LEVELS);
    c.str(r, 'source', rp);
    c.arr(r, 'accepted', rp, c.strEl);
    c.arr(r, 'features', rp, (fel, fp) => c.objEl(fel, fp, (f, ffp) => checkFeature(c, f, ffp)));
    c.arr(r, 'coreWords', rp, c.strEl);
    c.oneOf(r, 'particleTolerance', rp, PARTICLE_TOL);
    c.bool(r, 'finalPunctOptional', rp);
  }), { optional: true });
}

function checkFeature(c: Ctx, f: Obj, p: string): void {
  c.oneOf(f, 'kind', p, ['endsWith', 'contains', 'notContains']);
  c.arr(f, 'any', p, c.strEl, { min: 1 });
  c.str(f, 'label', p);
  if (f.kind === 'endsWith') { if (f.scope !== undefined) c.err(`${p}.scope`, 'endsWith takes no scope'); }
  else c.oneOf(f, 'scope', p, ['lastEojeol', 'all'], true);
}

function checkVocab(c: Ctx, o: Obj, p: string): void {
  c.str(o, 'word', p);
  c.arr(o, 'meanings', p, c.strEl, { min: 1 });
  c.str(o, 'pos', p);
  c.oneOf(o, 'register', p, REGISTERS);
  c.arr(o, 'hanjaBreakdown', p, (el, ep) => c.objEl(el, ep, (h, hp) => {
    c.str(h, 'syllable', hp); c.str(h, 'hanja', hp); c.str(h, 'hanjaId', hp, { optional: true });
  }), { optional: true });
  c.arr(o, 'collocations', p, (el, ep) => c.objEl(el, ep, (k, kp) => { c.str(k, 'ko', kp); c.str(k, 'en', kp); }));
  checkExamples(c, o, p);
}

function checkGrammar(c: Ctx, o: Obj, p: string): void {
  c.str(o, 'pattern', p);
  c.str(o, 'meaning', p);
  c.arr(o, 'attachment', p, (el, ep) => c.objEl(el, ep, (a, ap) => {
    c.oneOf(a, 'stem', ap, STEMS);
    c.oneOf(a, 'final', ap, FINALS, true);
    c.oneOf(a, 'tense', ap, TENSES);
    c.str(a, 'form', ap); c.str(a, 'example', ap);
  }), { min: 1 });
  c.str(o, 'nuance', p);
  c.arr(o, 'contrasts', p, (el, ep) => c.objEl(el, ep, (k, kp) => { c.str(k, 'id', kp); c.str(k, 'note', kp); }));
  checkExamples(c, o, p);
}

function checkExpression(c: Ctx, o: Obj, p: string): void {
  c.oneOf(o, 'subtype', p, SUBTYPES);
  c.str(o, 'text', p);
  c.str(o, 'hanjaText', p, { optional: true });
  c.str(o, 'meaning', p); c.str(o, 'literal', p); c.str(o, 'usage', p);
  checkExamples(c, o, p);
}

// ---------------------------------------------------------------------------
// validateBundle

type Reviewable = VocabItem | GrammarItem | ExpressionItem;

/** The Korean headword shown for an item (word / pattern / text / char). */
export function headword(it: Item): string {
  switch (it.kind) {
    case 'vocab': return it.word;
    case 'grammar': return it.pattern;
    case 'expression': return it.text;
    case 'hanja': return it.char;
  }
}

/** Explicit unlockDeps plus implicit `lesson` deps from hanjaBreakdown (§7.3). */
export function effectiveDeps(it: Item): { id: ItemId; require: 'lesson' | 'guru'; implicit: boolean }[] {
  const out = it.unlockDeps.map((d) => ({ ...d, implicit: false }));
  if (it.kind === 'vocab') {
    for (const h of it.hanjaBreakdown ?? []) {
      if (h.hanjaId && !out.some((d) => d.id === h.hanjaId)) out.push({ id: h.hanjaId, require: 'lesson', implicit: true });
    }
  }
  return out;
}

export function validateBundle(rawItems: readonly unknown[], opts: ValidateBundleOptions = {}): ValidationReport {
  const errors: BundleIssue[] = [];
  const warnings: BundleIssue[] = [];
  const items: Item[] = [];
  const where = (i: number) => opts.origins?.[i] ?? `items[${i}]`;

  // 1. Structural
  rawItems.forEach((raw, i) => {
    const r = validateItem(raw);
    const id = isObj(raw) && typeof raw.id === 'string' ? raw.id : undefined;
    const label = id ? `${where(i)} (${id})` : where(i);
    if (!r.ok || !r.item) {
      for (const e of r.errors) errors.push({ itemId: id, path: `${label}${e.path.slice(1)}`, msg: e.msg });
      return;
    }
    // Hanja must not carry review fields (structurally they'd be silently ignored).
    if (r.item.kind === 'hanja' && isObj(raw) && ('questionTypes' in raw || 'questions' in raw)) {
      errors.push({ itemId: id, path: `${label}.questionTypes`, msg: 'hanja are lesson-only: must not have questionTypes/questions' });
    }
    items.push(r.item);
  });

  const err = (it: Item, path: string, msg: string) => errors.push({ itemId: it.id, path: `${it.id}${path}`, msg });
  const warn = (it: Item, path: string, msg: string) => warnings.push({ itemId: it.id, path: `${it.id}${path}`, msg });
  // Draft tolerance (M5): user/KRDict/imported items may be saved before their examples are
  // written, so example-count rules are warnings for them. Seed (`original`) items stay strict.
  const exErr = (it: Item, path: string, msg: string) => (isDraftSource(it) ? warn : err)(it, path, msg);

  // 2. Ids
  const byId = new Map<ItemId, Item>();
  for (const it of items) {
    if (byId.has(it.id)) err(it, '', `duplicate id`);
    else byId.set(it.id, it);
    const pre = ID_PREFIX[it.kind];
    if (!it.id.startsWith(pre) || it.id.length <= pre.length) err(it, '.id', `id of a ${it.kind} item must start with "${pre}"`);
  }

  // 3. Per-item semantics + references
  for (const it of items) {
    // Attribution
    if (it.source.license !== 'original-owned' && !(it.source.attribution ?? '').trim()) {
      err(it, '.source.attribution', `attribution is required when license is "${it.source.license}"`);
    }
    if (it.source.kind === 'krdict' && !it.source.url && it.source.krdictTargetCode === undefined) {
      warn(it, '.source', 'krdict item has neither url nor krdictTargetCode');
    }
    // References
    const seenDep = new Set<ItemId>();
    it.unlockDeps.forEach((d, i) => {
      if (d.id === it.id) err(it, `.unlockDeps[${i}]`, 'item depends on itself');
      if (seenDep.has(d.id)) err(it, `.unlockDeps[${i}]`, `duplicate dep ${d.id}`);
      seenDep.add(d.id);
      const t = byId.get(d.id);
      if (!t) { err(it, `.unlockDeps[${i}].id`, `unresolved reference ${d.id}`); return; }
      if (t.level > it.level) err(it, `.unlockDeps[${i}]`, `dep ${d.id} is level ${t.level} > item level ${it.level}`);
      if (t.kind === 'hanja' && d.require === 'guru') err(it, `.unlockDeps[${i}]`, `hanja ${d.id} are never reviewed: require must be "lesson"`);
    });

    if (it.kind === 'hanja') { checkHanjaSem(it, err); continue; }
    checkReviewableSem(it, err, warn);

    if (it.kind === 'vocab') {
      (it.hanjaBreakdown ?? []).forEach((h, i) => {
        const hp = `.hanjaBreakdown[${i}]`;
        if (!it.word.includes(h.syllable)) err(it, `${hp}.syllable`, `"${h.syllable}" does not occur in "${it.word}"`);
        if (!h.hanjaId) return;
        const t = byId.get(h.hanjaId);
        if (!t) { err(it, `${hp}.hanjaId`, `unresolved reference ${h.hanjaId}`); return; }
        if (t.kind !== 'hanja') { err(it, `${hp}.hanjaId`, `${h.hanjaId} is a ${t.kind}, not hanja`); return; }
        if (t.char !== h.hanja) err(it, `${hp}.hanja`, `"${h.hanja}" does not match ${h.hanjaId} char "${t.char}"`);
        if (t.eum !== h.syllable) warn(it, `${hp}.syllable`, `"${h.syllable}" differs from ${h.hanjaId} reading "${t.eum}" (ok only for 두음법칙 etc.)`);
        if (t.level > it.level) err(it, `${hp}.hanjaId`, `hanja ${h.hanjaId} is level ${t.level} > item level ${it.level}`);
      });
      if (it.examples.length < 2 || it.examples.length > 3) exErr(it, '.examples', `vocab needs 2–3 examples (has ${it.examples.length})`);
    } else if (it.examples.length < 1) {
      exErr(it, '.examples', `${it.kind} needs at least 1 example`);
    }

    if (it.kind === 'grammar') {
      const seenC = new Set<ItemId>();
      it.contrasts.forEach((k, i) => {
        if (k.id === it.id) err(it, `.contrasts[${i}]`, 'item contrasts with itself');
        if (seenC.has(k.id)) err(it, `.contrasts[${i}]`, `duplicate contrast ${k.id}`);
        seenC.add(k.id);
        const t = byId.get(k.id);
        if (!t) err(it, `.contrasts[${i}].id`, `unresolved reference ${k.id}`);
        else if (t.kind === 'hanja') err(it, `.contrasts[${i}].id`, `cannot contrast with hanja ${k.id}`);
      });
    }
  }

  // 4. Cycles (explicit + implicit hanja deps)
  for (const cyc of findCycles(items, byId)) {
    errors.push({ itemId: cyc[0], path: `${cyc[0]}.unlockDeps`, msg: `dependency cycle: ${cyc.join(' → ')}` });
  }

  // 5. idRedirects
  for (const [from, to] of Object.entries(opts.idRedirects ?? {})) {
    if (byId.has(from)) errors.push({ path: `idRedirects.${from}`, msg: 'redirect source is still a live id' });
    if (!byId.has(to)) errors.push({ path: `idRedirects.${from}`, msg: `redirect target ${to} does not resolve` });
  }

  // 6. Counts + needs_review
  const zero = (): Record<ItemKind, number> => ({ vocab: 0, grammar: 0, expression: 0, hanja: 0 });
  const byKind = zero();
  const byLevel: Record<number, Record<ItemKind, number>> = {};
  const needsReview: NeedsReviewEntry[] = [];
  let nrItems = 0, nrEx = 0;
  for (const it of items) {
    byKind[it.kind]++;
    (byLevel[it.level] ??= zero())[it.kind]++;
    const exIdx = it.kind === 'hanja' ? [] : it.examples.flatMap((e, i) => (e.needs_review ? [i] : []));
    if (it.needs_review || exIdx.length) {
      needsReview.push({ id: it.id, level: it.level, kind: it.kind, item: it.needs_review, examples: exIdx });
      if (it.needs_review) nrItems++;
      nrEx += exIdx.length;
    }
  }
  if (nrItems) warnings.push({ path: 'needs_review', msg: `${nrItems} item(s) flagged needs_review` });
  if (nrEx) warnings.push({ path: 'needs_review', msg: `${nrEx} example(s) flagged needs_review` });

  return {
    ok: errors.length === 0, errors, warnings, items,
    counts: { total: items.length, byKind, byLevel, needsReviewItems: nrItems, needsReviewExamples: nrEx },
    needsReview,
  };
}

type ErrFn = (it: Item, path: string, msg: string) => void;

/** Items whose example-count rules are warnings rather than errors (anything not seed content). */
export function isDraftSource(it: Pick<Item, 'source'>): boolean {
  return it.source.kind !== 'original';
}

function checkHanjaSem(it: HanjaItem, err: ErrFn): void {
  if (it.gating !== false) err(it, '.gating', 'hanja must have gating: false (they never gate levels)');
  if (!it.mnemonic.trim()) err(it, '.mnemonic', 'hanja require a mnemonic');
  if (it.unlockDeps.length) err(it, '.unlockDeps', 'hanja are available immediately within their level: unlockDeps must be empty');
  if ([...it.char].length !== 1) err(it, '.char', 'must be a single character');
}

function checkReviewableSem(it: Reviewable, err: ErrFn, warn: ErrFn): void {
  const qt = it.questionTypes;
  if (qt.length < 1 || qt.length > 3) err(it, '.questionTypes', `must list 1–3 question types (has ${qt.length})`);
  if (new Set(qt).size !== qt.length) err(it, '.questionTypes', 'duplicate question type');
  const q = it.questions;
  for (const t of qt) {
    const spec = q[t];
    if (spec === undefined || (Array.isArray(spec) && spec.length === 0)) err(it, `.questions.${t}`, `questionTypes lists "${t}" but no spec is given`);
  }
  for (const t of QTYPES) if (q[t] !== undefined && !qt.includes(t)) warn(it, `.questions.${t}`, `spec for "${t}" is not listed in questionTypes (unused)`);

  const disjoint = (path: string, acc: string[], rej: string[] | undefined) => {
    if (acc.length === 0) err(it, `${path}.accepted`, 'must have at least one accepted answer');
    if (new Set(acc).size !== acc.length) err(it, `${path}.accepted`, 'duplicate accepted answer');
    for (const r of rej ?? []) if (acc.includes(r)) err(it, `${path}.rejected`, `"${r}" is both accepted and rejected`);
  };
  if (q.meaning) disjoint('.questions.meaning', q.meaning.accepted, q.meaning.rejected);
  if (q.production) disjoint('.questions.production', q.production.accepted, q.production.rejected);

  const promptIds = new Set<string>();
  const uniq = (path: string, id: string) => {
    if (promptIds.has(id)) err(it, path, `duplicate prompt id "${id}"`);
    promptIds.add(id);
  };
  (q.cloze ?? []).forEach((z: ClozePrompt, i) => {
    const zp = `.questions.cloze[${i}]`;
    uniq(`${zp}.id`, z.id);
    const gaps = z.sentence.split(CLOZE_GAP).length - 1;
    if (gaps !== 1) err(it, `${zp}.sentence`, `cloze must contain exactly one "${CLOZE_GAP}" (found ${gaps})`);
    disjoint(zp, z.accepted, z.nearMiss?.map((n) => n.answer));
  });
  (q.nuance ?? []).forEach((n: NuancePrompt, i) => {
    const np = `.questions.nuance[${i}]`;
    uniq(`${np}.id`, n.id);
    if (n.options.length < 2 || n.options.length > 3) err(it, `${np}.options`, `nuance needs 2–3 options (has ${n.options.length})`);
    const nc = n.options.filter((o) => o.correct).length;
    if (nc !== 1) err(it, `${np}.options`, `nuance needs exactly one correct option (has ${nc})`);
    if (new Set(n.options.map((o) => o.text)).size !== n.options.length) err(it, `${np}.options`, 'duplicate option text');
  });
  (q.register ?? []).forEach((r: RegisterPrompt, i) => {
    const rp = `.questions.register[${i}]`;
    uniq(`${rp}.id`, r.id);
    if (r.from === r.to) err(it, rp, 'register prompt from and to must differ');
    if (r.accepted.length < 1) err(it, `${rp}.accepted`, 'register prompt needs at least one accepted answer');
    if (r.features.length < 1) err(it, `${rp}.features`, 'register prompt needs at least one feature rule');
    if (r.coreWords.length < 1) err(it, `${rp}.coreWords`, 'register prompt needs at least one core word');
    // Core words must survive in every accepted answer (exact substring; jamo-space checks are the self-check's job).
    for (const a of r.accepted) for (const w of r.coreWords) {
      if (!a.replace(/\s+/g, '').includes(w.replace(/\s+/g, ''))) err(it, `${rp}.coreWords`, `core word "${w}" missing from accepted "${a}"`);
    }
    // contains/notContains are plain-substring checkable here (endsWith is jamo-space; left to the self-check).
    r.features.forEach((f: FeatureRule, j) => {
      if (f.kind === 'endsWith') return;
      for (const a of r.accepted) {
        const hay = f.scope === 'lastEojeol' ? (a.trim().split(/\s+/).pop() ?? '') : a;
        const hit = f.any.some((s) => hay.includes(s));
        if (f.kind === 'contains' && !hit) err(it, `${rp}.features[${j}]`, `accepted "${a}" fails its own feature "${f.label}"`);
        if (f.kind === 'notContains' && hit) err(it, `${rp}.features[${j}]`, `accepted "${a}" fails its own feature "${f.label}"`);
      }
    });
  });
}

/** Returns each distinct cycle once, as a closed path [a, b, …, a]. */
function findCycles(items: Item[], byId: Map<ItemId, Item>): ItemId[][] {
  const WHITE = 0, GREY = 1, BLACK = 2;
  const color = new Map<ItemId, number>();
  const stack: ItemId[] = [];
  const cycles: ItemId[][] = [];
  const seen = new Set<string>();
  const visit = (id: ItemId) => {
    color.set(id, GREY);
    stack.push(id);
    const it = byId.get(id);
    for (const d of it ? effectiveDeps(it) : []) {
      if (!byId.has(d.id)) continue; // reported as unresolved
      const c = color.get(d.id) ?? WHITE;
      if (c === GREY) {
        const cyc = stack.slice(stack.indexOf(d.id));
        const key = [...cyc].sort().join('|');
        if (!seen.has(key)) { seen.add(key); cycles.push([...cyc, d.id]); }
      } else if (c === WHITE) visit(d.id);
    }
    stack.pop();
    color.set(id, BLACK);
  };
  for (const it of items) if ((color.get(it.id) ?? WHITE) === WHITE) visit(it.id);
  return cycles;
}
