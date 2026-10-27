// CSV ⇄ Item codecs, one file per kind (IMPORT.md). Header-defined columns (order-free,
// case-insensitive); `|` separates values; `::` separates the parts of a pair.

import type {
  Example, ExpressionItem, GrammarItem, HanjaItem, Item, ItemKind, QuestionSpecs, QuestionType, SourceInfo, VocabItem,
} from '../schema/types.ts';
import {
  escColon, escList, escPair, parseCsv, sniffDelimiter, splitEsc, splitList, toCsv, unesc,
} from './csv.ts';
import { finalize, type Candidate } from './pipeline.ts';
import type { ImportContext, ImportIssue, ImportKind, ImportResult } from './types.ts';

type Obj = Record<string, unknown>;
type Row = Record<string, string>;

// ---------------------------------------------------------------------------
// Columns

const HEAD_COLS: Record<ItemKind, string[]> = {
  vocab: ['word', 'meanings', 'pos', 'register', 'hanja', 'collocations', 'examples'],
  grammar: ['pattern', 'meaning', 'attachment', 'nuance', 'contrasts', 'examples'],
  expression: ['subtype', 'text', 'hanja_text', 'meaning', 'literal', 'usage', 'examples'],
  hanja: ['char', 'hun', 'eum', 'meanings', 'mnemonic'],
};
const QUESTION_COLS = [
  'question_types', 'meaning_accepted', 'meaning_rejected',
  'production_prompt', 'production_hint', 'production_accepted', 'production_rejected',
  'cloze_sentence', 'cloze_answer', 'cloze_en', 'cloze_cue', 'cloze_tolerance', 'cloze_near_miss',
  'questions_json',
];
const TAIL_COLS = [
  'mnemonic', 'tags', 'gating', 'needs_review', 'unlock_deps', 'track', 'rev',
  'source_kind', 'source_license', 'source_attribution', 'source_url', 'source_retrieved_at', 'krdict_target_code',
];

/** All columns for a kind, in template/export order. */
export function csvColumns(kind: ImportKind): string[] {
  const tail = kind === 'hanja' ? TAIL_COLS.filter((c) => c !== 'mnemonic') : TAIL_COLS;
  return ['id', 'level', ...HEAD_COLS[kind], ...(kind === 'hanja' ? [] : QUESTION_COLS), ...tail];
}

/** Columns the header must contain. */
const REQUIRED: Record<ItemKind, string[]> = {
  vocab: ['level', 'word', 'meanings', 'pos'],
  grammar: ['level', 'pattern', 'meaning'],
  expression: ['level', 'text', 'meaning'],
  hanja: ['level', 'char', 'hun', 'eum', 'meanings'],
};
/** Columns export always writes (others only when some item uses them). */
const ALWAYS = new Set(['id', 'level', 'question_types', 'tags', 'gating', 'needs_review', 'source_kind', 'source_license']);

const ALIASES: Record<string, string> = {
  hanja_breakdown: 'hanja', hanjabreakdown: 'hanja', hanjatext: 'hanja_text',
  questiontypes: 'question_types', unlockdeps: 'unlock_deps', deps: 'unlock_deps', needsreview: 'needs_review',
  example: 'examples', collocation: 'collocations', tag: 'tags', contrast: 'contrasts',
};

function normHeader(h: string, kind: ImportKind): string {
  const k = h.normalize('NFC').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if ((kind === 'vocab' || kind === 'hanja') && k === 'meaning') return 'meanings';
  if ((kind === 'grammar' || kind === 'expression') && k === 'meanings') return 'meaning';
  return ALIASES[k] ?? k;
}

// ---------------------------------------------------------------------------
// Cell decoders

class RowCtx {
  constructor(readonly row: Row, readonly rowNo: number, readonly kind: ImportKind, readonly issues: ImportIssue[]) {}
  bad = false;
  err(col: string, msg: string): void { this.bad = true; this.issues.push({ row: this.rowNo, path: col, msg, severity: 'error' }); }
  warn(col: string, msg: string): void { this.issues.push({ row: this.rowNo, path: col, msg, severity: 'warning' }); }
  s(col: string): string { return (this.row[col] ?? '').trim(); }
  list(col: string): string[] { return splitList(this.row[col] ?? ''); }
  int(col: string, dflt?: number): number | undefined {
    const v = this.s(col);
    if (!v) { if (dflt === undefined) this.err(col, 'required'); return dflt; }
    const n = Number(v);
    if (!Number.isInteger(n)) { this.err(col, `"${v}" is not a whole number`); return dflt; }
    return n;
  }
  bool(col: string, dflt: boolean): boolean {
    const v = this.s(col).toLowerCase();
    if (!v) return dflt;
    if (['true', 'yes', 'y', '1', 't'].includes(v)) return true;
    if (['false', 'no', 'n', '0', 'f'].includes(v)) return false;
    this.err(col, `"${v}" is not true/false`);
    return dflt;
  }
  /** `a::b::c|…` → parts per entry (unescaped, trimmed). */
  pairs(col: string): string[][] {
    const cell = this.row[col] ?? '';
    if (!cell.trim()) return [];
    return splitEsc(cell, '|').map((e) => splitEsc(e, '::').map((p) => unesc(p.trim()))).filter((ps) => ps.some((p) => p !== ''));
  }
}

const FLAG_TRUE = new Set(['review', 'needs_review', 'true', 'yes', '1']);
const FLAG_FALSE = new Set(['ok', 'false', 'no', '0']);

function decodeExamples(c: RowCtx): Example[] {
  return c.pairs('examples').flatMap(([ko = '', en = '', register = '', flag = ''], i) => {
    if (!ko || !en) { c.err('examples', `example ${i + 1} needs "ko::en"`); return []; }
    const ex: Example = { ko, en };
    if (register) ex.register = register as Example['register'];
    const f = flag.toLowerCase();
    if (FLAG_TRUE.has(f)) ex.needs_review = true;
    else if (FLAG_FALSE.has(f)) ex.needs_review = false;
    else if (f) c.err('examples', `example ${i + 1}: unknown flag "${flag}" (use "review")`);
    return [ex];
  });
}

function decodeKoEn(c: RowCtx, col: string): { ko: string; en: string }[] {
  return c.pairs(col).flatMap(([ko = '', en = ''], i) => {
    if (!ko || !en) { c.err(col, `entry ${i + 1} needs "ko::en"`); return []; }
    return [{ ko, en }];
  });
}

function decodeSource(c: RowCtx, ctx: ImportContext): SourceInfo {
  const kind = c.s('source_kind');
  const src: SourceInfo = kind
    ? { kind: kind as SourceInfo['kind'], license: c.s('source_license') }
    : { ...ctx.defaultSource };
  if (!kind && c.s('source_license')) src.license = c.s('source_license');
  const set = (col: string, key: 'attribution' | 'url' | 'retrievedAt') => { const v = c.s(col); if (v) src[key] = v; };
  set('source_attribution', 'attribution');
  set('source_url', 'url');
  set('source_retrieved_at', 'retrievedAt');
  if (c.s('krdict_target_code')) {
    const n = c.int('krdict_target_code');
    if (n !== undefined) src.krdictTargetCode = n;
  }
  return src;
}

function decodeBase(c: RowCtx, ctx: ImportContext): Obj {
  const kind = c.kind;
  const o: Obj = {
    kind,
    level: c.int('level'),
    track: c.s('track') || 'core',
    rev: c.int('rev', 1),
    gating: c.bool('gating', kind !== 'hanja'),
    needs_review: c.bool('needs_review', false),
    tags: c.list('tags'),
    unlockDeps: c.list('unlock_deps').map((d) => {
      const at = d.lastIndexOf('@');
      const req = at > 0 ? d.slice(at + 1).trim().toLowerCase() : '';
      const id = at > 0 && (req === 'lesson' || req === 'guru') ? d.slice(0, at).trim() : d;
      if (at > 0 && req !== 'lesson' && req !== 'guru') c.err('unlock_deps', `"${d}": requirement must be @lesson or @guru`);
      return { id, require: req === 'lesson' || req === 'guru' ? req : id.startsWith('h:') ? 'lesson' : 'guru' };
    }),
    source: decodeSource(c, ctx),
  };
  const id = c.s('id');
  if (id) o.id = id;
  const m = c.s('mnemonic');
  if (m) o.mnemonic = m;
  return o;
}

function decodeQuestions(c: RowCtx, defaults: { meaning: string[]; prompt: string; head: string }): { qt: QuestionType[]; q: QuestionSpecs } {
  let json: Obj = {};
  const raw = c.s('questions_json');
  if (raw) {
    try {
      const v = JSON.parse(raw) as unknown;
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) json = v as Obj;
      else c.err('questions_json', 'must be a JSON object');
    } catch { c.err('questions_json', 'is not valid JSON'); }
  }
  const q: Obj = { ...json };
  const qtCell = c.list('question_types');
  const hasCloze = !!c.s('cloze_sentence');
  const qt = (qtCell.length ? qtCell : ['meaning', 'production', ...(hasCloze ? ['cloze'] : [])]) as QuestionType[];
  const clash = (k: string) => { if (k in json) c.err('questions_json', `"${k}" is given both in columns and in questions_json`); };

  const mAcc = c.list('meaning_accepted');
  const mRej = c.list('meaning_rejected');
  if (mAcc.length || mRej.length || (qt.includes('meaning') && !('meaning' in json))) {
    clash('meaning');
    q.meaning = { accepted: mAcc.length ? mAcc : defaults.meaning, ...(mRej.length ? { rejected: mRej } : {}) };
  }
  const pCols = ['production_prompt', 'production_hint', 'production_accepted', 'production_rejected'];
  if (pCols.some((k) => c.s(k)) || (qt.includes('production') && !('production' in json))) {
    clash('production');
    const pAcc = c.list('production_accepted');
    const pRej = c.list('production_rejected');
    const hint = c.s('production_hint');
    q.production = {
      promptEn: c.s('production_prompt') || defaults.prompt,
      ...(hint ? { contextHint: hint } : {}),
      accepted: pAcc.length ? pAcc : [defaults.head],
      ...(pRej.length ? { rejected: pRej } : {}),
    };
  }
  if (hasCloze) {
    clash('cloze');
    const nm = c.pairs('cloze_near_miss').flatMap(([answer = '', hint = ''], i) => {
      if (!answer || !hint) { c.err('cloze_near_miss', `entry ${i + 1} needs "answer::hint"`); return []; }
      return [{ answer, hint }];
    });
    q.cloze = [{
      id: 'c1', sentence: c.s('cloze_sentence'), en: c.s('cloze_en'), cue: c.s('cloze_cue'),
      accepted: c.list('cloze_answer'), ...(nm.length ? { nearMiss: nm } : {}),
      particleTolerance: c.s('cloze_tolerance') || 'none',
    }];
  } else {
    for (const k of ['cloze_answer', 'cloze_en', 'cloze_cue', 'cloze_near_miss']) {
      if (c.s(k)) c.warn(k, 'ignored without cloze_sentence');
    }
  }
  return { qt, q: q as QuestionSpecs };
}

function decodeRow(c: RowCtx, ctx: ImportContext): Obj | undefined {
  const o = decodeBase(c, ctx);
  switch (c.kind) {
    case 'hanja': {
      Object.assign(o, { char: c.s('char'), hun: c.s('hun'), eum: c.s('eum'), meanings: c.list('meanings'), mnemonic: c.s('mnemonic') });
      break;
    }
    case 'vocab': {
      const word = c.s('word');
      const meanings = c.list('meanings');
      const hb = c.list('hanja').length ? splitEsc(c.row.hanja ?? '', '|').filter((x) => x.trim()).map((e, i) => {
        const [syl = '', han = '', rest] = splitEsc(e.trim(), ':', 3);
        const h: { syllable: string; hanja: string; hanjaId?: string } = { syllable: unesc(syl.trim()), hanja: unesc(han.trim()) };
        if (!h.syllable || !h.hanja) c.err('hanja', `entry ${i + 1} needs "syllable:hanja"`);
        const r = rest === undefined ? undefined : unesc(rest.trim());
        if (r === undefined || r === '') { if (ctx.existing.get(`h:${h.hanja}`)?.kind === 'hanja') h.hanjaId = `h:${h.hanja}`; }
        else if (r !== '-') h.hanjaId = r;
        return h;
      }) : undefined;
      const { qt, q } = decodeQuestions(c, { meaning: meanings, prompt: meanings.join('; '), head: word });
      Object.assign(o, {
        word, meanings, pos: c.s('pos'), register: c.s('register') || 'neutral',
        ...(hb ? { hanjaBreakdown: hb } : {}),
        collocations: decodeKoEn(c, 'collocations'), examples: decodeExamples(c),
        questionTypes: qt, questions: q,
      } as Partial<VocabItem>);
      break;
    }
    case 'grammar': {
      const pattern = c.s('pattern');
      const meaning = c.s('meaning');
      const attachment = c.pairs('attachment').flatMap(([stem = '', fin = '', tense = '', form = '', example = ''], i) => {
        if (!stem || !form) { c.err('attachment', `entry ${i + 1} needs "stem::final::tense::form::example"`); return []; }
        return [{ stem, ...(fin ? { final: fin } : {}), tense: tense || 'any', form, example }];
      });
      const contrasts = c.pairs('contrasts').flatMap(([id = '', note = ''], i) => {
        if (!id) { c.err('contrasts', `entry ${i + 1} needs "id::note"`); return []; }
        return [{ id, note }];
      });
      const { qt, q } = decodeQuestions(c, { meaning: [meaning], prompt: meaning, head: pattern });
      Object.assign(o, {
        pattern, meaning, attachment, nuance: c.s('nuance'), contrasts, examples: decodeExamples(c),
        questionTypes: qt, questions: q,
      } as Partial<GrammarItem>);
      break;
    }
    case 'expression': {
      const text = c.s('text');
      const meaning = c.s('meaning');
      const ht = c.s('hanja_text');
      const { qt, q } = decodeQuestions(c, { meaning: [meaning], prompt: meaning, head: text });
      Object.assign(o, {
        subtype: c.s('subtype') || '관용구', text, ...(ht ? { hanjaText: ht } : {}), meaning,
        literal: c.s('literal'), usage: c.s('usage'), examples: decodeExamples(c), questionTypes: qt, questions: q,
      } as Partial<ExpressionItem>);
      break;
    }
  }
  return c.bad ? undefined : o;
}

// ---------------------------------------------------------------------------
// importCsv

const isComment = (r: readonly string[]) => (r[0] ?? '').trim().startsWith('#');
const isBlank = (r: readonly string[]) => r.every((v) => v.trim() === '');

export function importCsv(kind: ImportKind, text: string, ctx: ImportContext): ImportResult {
  const issues: ImportIssue[] = [];
  if (!(kind in HEAD_COLS)) return { items: [], issues: [{ path: '$', msg: `unknown kind "${String(kind)}"`, severity: 'error' }] };
  const rows = parseCsv(text, { delimiter: sniffDelimiter(text) });
  const hi = rows.findIndex((r) => !isBlank(r) && !isComment(r));
  if (hi < 0) return { items: [], issues: [{ path: '$', msg: 'no header row', severity: 'error' }] };
  const known = new Set(csvColumns(kind));
  const header = rows[hi]!.map((h) => normHeader(h, kind));
  const firstAt = new Map<string, number>();
  header.forEach((h, i) => {
    if (!h) return;
    if (firstAt.has(h)) { issues.push({ row: hi + 1, path: h, msg: 'duplicate column; the first one is used', severity: 'warning' }); return; }
    firstAt.set(h, i);
    if (!known.has(h)) issues.push({ row: hi + 1, path: h, msg: `unknown column for ${kind} (ignored)`, severity: 'warning' });
  });
  const missing = REQUIRED[kind].filter((c) => !firstAt.has(c));
  if (missing.length) {
    issues.push({ row: hi + 1, path: missing.join(', '), msg: `missing required column(s) for ${kind}`, severity: 'error' });
    return { items: [], issues };
  }
  const cands: Candidate[] = [];
  for (let ri = hi + 1; ri < rows.length; ri++) {
    const r = rows[ri]!;
    if (isBlank(r) || isComment(r)) continue;
    const rowNo = ri + 1;
    if (r.length > header.length && r.slice(header.length).some((v) => v.trim())) {
      issues.push({ row: rowNo, path: '$', msg: `${r.length - header.length} cell(s) beyond the header ignored`, severity: 'warning' });
    }
    const row: Row = {};
    for (const [h, i] of firstAt) if (known.has(h)) row[h] = r[i] ?? '';
    const before = issues.length;
    const o = decodeRow(new RowCtx(row, rowNo, kind, issues), ctx);
    for (let k = before; k < issues.length; k++) if (row.id?.trim()) issues[k]!.id = row.id.trim();
    if (o) cands.push({ raw: o, row: rowNo });
  }
  return finalize(cands, ctx, issues);
}

// ---------------------------------------------------------------------------
// exportCsv

const list = (xs: readonly string[] | undefined) => (xs ?? []).map(escList).join('|');
const pairs = (xss: readonly (readonly string[])[]) =>
  xss.map((ps) => { const a = [...ps]; while (a.length > 2 && a[a.length - 1] === '') a.pop(); return a.map(escPair).join('::'); }).join('|');

function encodeExamples(exs: readonly Example[]): string {
  return pairs(exs.map((e) => [e.ko, e.en, e.register ?? '', e.needs_review === true ? 'review' : e.needs_review === false ? 'false' : '']));
}

function encodeQuestions(it: Exclude<Item, HanjaItem>, out: Row): void {
  const q = it.questions;
  out.question_types = list(it.questionTypes);
  const rest: Obj = { ...q };
  if (q.meaning) {
    out.meaning_accepted = list(q.meaning.accepted);
    if (q.meaning.rejected) out.meaning_rejected = list(q.meaning.rejected);
    // An empty accepted list or rejected: [] can't be told apart from "absent" in a cell.
    if (q.meaning.accepted.length && (q.meaning.rejected === undefined || q.meaning.rejected.length)) delete rest.meaning;
    else { delete out.meaning_accepted; delete out.meaning_rejected; }
  }
  if (q.production) {
    const p = q.production;
    const ok = p.promptEn.trim() !== '' && p.accepted.length > 0 && (p.rejected === undefined || p.rejected.length > 0)
      && (p.contextHint === undefined || p.contextHint.trim() !== '');
    if (ok) {
      out.production_prompt = p.promptEn;
      if (p.contextHint !== undefined) out.production_hint = p.contextHint;
      out.production_accepted = list(p.accepted);
      if (p.rejected) out.production_rejected = list(p.rejected);
      delete rest.production;
    }
  }
  const z = q.cloze;
  if (z && z.length === 1 && z[0]!.id === 'c1' && z[0]!.spacingStrict === undefined && z[0]!.sentence.trim()
      && (z[0]!.nearMiss === undefined || z[0]!.nearMiss.length > 0)) {
    const c = z[0]!;
    out.cloze_sentence = c.sentence;
    out.cloze_answer = list(c.accepted);
    out.cloze_en = c.en;
    out.cloze_cue = c.cue;
    out.cloze_tolerance = c.particleTolerance;
    if (c.nearMiss) out.cloze_near_miss = pairs(c.nearMiss.map((n) => [n.answer, n.hint]));
    delete rest.cloze;
  }
  const leftover = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  if (Object.keys(leftover).length) out.questions_json = JSON.stringify(leftover);
}

function encodeItem(it: Item): Row {
  const out: Row = { id: it.id, level: String(it.level) };
  switch (it.kind) {
    case 'hanja':
      Object.assign(out, { char: it.char, hun: it.hun, eum: it.eum, meanings: list(it.meanings), mnemonic: it.mnemonic });
      break;
    case 'vocab':
      Object.assign(out, {
        word: it.word, meanings: list(it.meanings), pos: it.pos, register: it.register,
        collocations: pairs(it.collocations.map((k) => [k.ko, k.en])), examples: encodeExamples(it.examples),
      });
      if (it.hanjaBreakdown) {
        out.hanja = it.hanjaBreakdown.map((h) => {
          const head = `${escColon(h.syllable)}:${escColon(h.hanja)}`;
          if (h.hanjaId === `h:${h.hanja}`) return head;
          return `${head}:${h.hanjaId === undefined ? '-' : escList(h.hanjaId)}`;
        }).join('|');
      }
      encodeQuestions(it, out);
      break;
    case 'grammar':
      Object.assign(out, {
        pattern: it.pattern, meaning: it.meaning, nuance: it.nuance,
        attachment: pairs(it.attachment.map((a) => [a.stem, a.final ?? '', a.tense, a.form, a.example])),
        contrasts: pairs(it.contrasts.map((k) => [k.id, k.note])), examples: encodeExamples(it.examples),
      });
      encodeQuestions(it, out);
      break;
    case 'expression':
      Object.assign(out, {
        subtype: it.subtype, text: it.text, meaning: it.meaning, literal: it.literal, usage: it.usage,
        examples: encodeExamples(it.examples),
      });
      if (it.hanjaText !== undefined) out.hanja_text = it.hanjaText;
      encodeQuestions(it, out);
      break;
  }
  if (it.kind !== 'hanja' && it.mnemonic !== undefined) out.mnemonic = it.mnemonic;
  out.tags = list(it.tags);
  out.gating = String(it.gating);
  out.needs_review = String(it.needs_review);
  out.unlock_deps = it.unlockDeps.map((d) => `${escList(d.id)}@${d.require}`).join('|');
  if (it.track !== 'core') out.track = it.track;
  if (it.rev !== 1) out.rev = String(it.rev);
  const s = it.source;
  out.source_kind = s.kind;
  out.source_license = s.license;
  if (s.attribution !== undefined) out.source_attribution = s.attribution;
  if (s.url !== undefined) out.source_url = s.url;
  if (s.retrievedAt !== undefined) out.source_retrieved_at = s.retrievedAt;
  if (s.krdictTargetCode !== undefined) out.krdict_target_code = String(s.krdictTargetCode);
  return out;
}

const BOM = '﻿';

/** CSV for the items of `kind` (others are skipped). Round-trips through importCsv. UTF-8 BOM for Excel. */
export function exportCsv(kind: ImportKind, items: readonly Item[]): string {
  const rows = items.filter((it) => it.kind === kind).map(encodeItem);
  const cols = csvColumns(kind).filter((c) => ALWAYS.has(c) || REQUIRED[kind].includes(c) || HEAD_COLS[kind].includes(c) || rows.some((r) => (r[c] ?? '') !== ''));
  return BOM + toCsv([cols, ...rows.map((r) => cols.map((c) => r[c] ?? ''))]);
}

// ---------------------------------------------------------------------------
// Templates

const EXAMPLES: Record<ItemKind, Row> = {
  vocab: {
    id: 'v:결정', level: '4', word: '결정', meanings: 'decision|determination', pos: '명사', register: 'neutral',
    hanja: '결:決|정:定', collocations: '결정을 내리다::to make a decision|결정이 나다::a decision is reached',
    examples: '결정은 내일까지 미루기로 했다.::We agreed to put off the decision until tomorrow.::written|'
      + '이제 네가 결정해.::It\'s your call now.::spoken',
    question_types: 'meaning|production', production_hint: 'a choice that has been made',
    tags: 'sino-korean|work', gating: 'true', needs_review: 'false',
  },
  grammar: {
    id: 'g:는-김에', level: '4', pattern: '-는 김에', meaning: 'while (doing X anyway), take the chance to do Y',
    attachment: 'V::any::present::V-는 김에::나가는 김에|V::any::past::V-(으)ㄴ 김에::온 김에',
    nuance: 'The second action piggybacks on the first; it is an opportunity, not the purpose.',
    examples: '시장에 가는 김에 우유도 사 올게.::Since I\'m going to the market anyway, I\'ll pick up milk too.::spoken',
    question_types: 'meaning|cloze', cloze_sentence: '서울에 {{}} 친구도 만났어요.', cloze_answer: '간 김에|온 김에',
    cloze_en: 'While I was in Seoul anyway, I met a friend too.', cloze_cue: '가다 + -(으)ㄴ 김에', cloze_tolerance: 'none',
    tags: 'opportunity', gating: 'true', needs_review: 'false',
  },
  expression: {
    id: 'x:손이-크다', level: '4', subtype: '관용구', text: '손이 크다', meaning: 'to be generous; to make or buy things in large quantities',
    literal: 'one\'s hands are big', usage: 'Often about cooking or shopping for others; affectionate.',
    examples: '어머니는 손이 커서 음식을 항상 넉넉하게 하신다.::Mom is generous, so she always cooks plenty.::neutral',
    question_types: 'meaning|production', tags: '관용구', gating: 'true', needs_review: 'false',
  },
  hanja: {
    id: 'h:定', level: '4', char: '定', hun: '정할', eum: '정', meanings: 'decide|fix|settle',
    mnemonic: 'A roof (宀) over feet that have stopped (正): you settle down and decide to stay.',
    tags: 'hanja', gating: 'false', needs_review: 'false',
  },
};

/** Header with every column for `kind`, plus one commented-out (`#`) example row. */
export function csvTemplate(kind: ImportKind): string {
  const cols = csvColumns(kind);
  const ex = EXAMPLES[kind];
  const row = cols.map((c) => ex[c] ?? '');
  row[0] = `#${row[0]}`;
  return BOM + toCsv([cols, row]);
}
