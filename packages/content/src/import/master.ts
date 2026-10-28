// The master vocab list format (docs/MASTER_LIST.md): parse, serialize, and the custom item made
// for a word first met in a 대화 모드 / tutoring session. Pure and total: never throws.

import type { SourceInfo, VocabItem } from '../schema/types.ts';
import { parseCsv, toCsv } from './csv.ts';
import { generateId } from './pipeline.ts';
import type { ImportContext } from './types.ts';

/** Column order of korean_master_vocab.csv. Binding (MASTER_LIST.md). */
export const MASTER_COLUMNS = [
  'word', 'meaning', 'hanja', 'pos', 'status', 'times_missed', 'times_seen', 'last_seen', 'freq_rank', 'sources', 'tags', 'notes',
] as const;
export type MasterColumn = typeof MASTER_COLUMNS[number];
export const MASTER_STATUSES = ['new', 'learning', 'mastered', 'suspended'] as const;
export type MasterStatus = typeof MASTER_STATUSES[number];
export const MASTER_HEADER = MASTER_COLUMNS.join(',');

export interface MasterRow {
  word: string;
  meaning: string;
  hanja: string;
  pos: string;
  status: MasterStatus;
  times_missed: number;
  times_seen: number;
  /** YYYY-MM-DD or ''. */
  last_seen: string;
  freq_rank: number | null;
  sources: string[];
  tags: string[];
  notes: string;
}

export interface MasterIssue {
  /** 1-based line of the record within the parsed block (after fence stripping). */
  row: number;
  word?: string;
  msg: string;
  severity: 'error' | 'warning';
}

export interface MasterParseResult {
  rows: MasterRow[];
  issues: MasterIssue[];
  hadHeader: boolean;
  /** True when the text was taken from inside ``` fences. */
  fenced: boolean;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const nfc = (s: string): string => s.replace(/﻿/g, '').normalize('NFC').trim();
const splitSet = (s: string): string[] => [...new Set(nfc(s).split(/[\s,]+/).filter(Boolean))];

/**
 * The CSV part of a pasted report block. With ``` fences, only the fenced lines are kept (every
 * fenced block, in order; an unclosed fence runs to the end). Without fences, the whole text.
 */
export function stripFences(text: string): { body: string; fenced: boolean } {
  const lines = text.split(/\r\n|\n|\r/);
  if (!lines.some((l) => /^\s*```/.test(l))) return { body: text, fenced: false };
  const out: string[] = [];
  let inside = false;
  for (const l of lines) {
    if (/^\s*```/.test(l)) { inside = !inside; continue; }
    if (inside) out.push(l);
  }
  return { body: out.join('\n'), fenced: true };
}

/**
 * Parses master-format CSV: the full file (with header) or a pasted VOCAB ROWS block (header
 * optional, code fences and blank lines tolerated). Without a header the columns are positional
 * in MASTER_COLUMNS order; extra trailing cells are folded into `notes`. Rows with an error are
 * left out of `rows` and reported. A word that appears twice keeps its last row (warning).
 */
export function parseMasterCsv(text: string): MasterParseResult {
  const { body, fenced } = stripFences(text);
  const records = parseCsv(body);
  const issues: MasterIssue[] = [];
  let colIdx: Map<MasterColumn, number> | null = null;
  let hadHeader = false;
  const byWord = new Map<string, MasterRow>();

  for (let r = 0; r < records.length; r++) {
    const cells = records[r]!.map(nfc);
    const line = r + 1;
    if (cells.every((c) => c === '') || cells[0]!.startsWith('#')) continue;
    if (!hadHeader && byWord.size === 0 && isHeader(cells)) {
      hadHeader = true;
      colIdx = new Map();
      cells.forEach((c, i) => {
        const k = c.toLowerCase() as MasterColumn;
        if ((MASTER_COLUMNS as readonly string[]).includes(k)) { if (!colIdx!.has(k)) colIdx!.set(k, i); }
        else if (c) issues.push({ row: line, msg: `unknown column "${c}" ignored`, severity: 'warning' });
      });
      const missing = MASTER_COLUMNS.filter((k) => !colIdx!.has(k));
      if (missing.length) issues.push({ row: line, msg: `header has no ${missing.join(', ')} column${missing.length === 1 ? '' : 's'}; left blank (counts 0)`, severity: 'warning' });
      continue;
    }
    let get: (c: MasterColumn) => string;
    if (colIdx) {
      const m = colIdx;
      get = (c) => { const i = m.get(c); return i === undefined ? '' : cells[i] ?? ''; };
    } else {
      if (cells.length < 5) {
        const quote = records[r]!.some((c) => /[\r\n]/.test(c)) ? '; check for an unclosed " quote' : '';
        issues.push({ row: line, msg: `not a vocab row (${cells.length} column${cells.length === 1 ? '' : 's'}; expected ${MASTER_COLUMNS.length}${quote})`, severity: 'error' });
        continue;
      }
      if (cells.length < MASTER_COLUMNS.length) {
        issues.push({ row: line, word: cells[0], msg: `only ${cells.length} of ${MASTER_COLUMNS.length} columns; the missing ${MASTER_COLUMNS.slice(cells.length).join(', ')} left blank`, severity: 'warning' });
      }
      const c2 = cells.length > MASTER_COLUMNS.length
        ? [...cells.slice(0, MASTER_COLUMNS.length - 1), cells.slice(MASTER_COLUMNS.length - 1).filter(Boolean).join(', ')] : cells;
      if (cells.length > MASTER_COLUMNS.length) issues.push({ row: line, word: cells[0], msg: 'extra columns were joined into notes', severity: 'warning' });
      get = (c) => c2[MASTER_COLUMNS.indexOf(c)] ?? '';
    }
    const row = toRow(get, line, issues);
    if (!row) continue;
    if (byWord.has(row.word)) {
      issues.push({ row: line, word: row.word, msg: 'word appears more than once; the last row is used', severity: 'warning' });
      byWord.delete(row.word);
    }
    byWord.set(row.word, row);
  }
  return { rows: [...byWord.values()], issues, hadHeader, fenced };
}

/** A header row: names the `word` column and at least one other master column. */
function isHeader(cells: readonly string[]): boolean {
  const lc = cells.map((c) => c.toLowerCase());
  return lc.includes('word') && lc.some((c) => c !== 'word' && (MASTER_COLUMNS as readonly string[]).includes(c));
}

function toRow(get: (c: MasterColumn) => string, line: number, issues: MasterIssue[]): MasterRow | null {
  const word = get('word');
  const err = (msg: string): null => { issues.push({ row: line, ...(word ? { word } : {}), msg, severity: 'error' }); return null; };
  const warn = (msg: string) => issues.push({ row: line, ...(word ? { word } : {}), msg, severity: 'warning' });
  if (!word) return err('missing word');
  const count = (c: MasterColumn): number | null => {
    const v = get(c);
    if (v === '') return 0;
    return /^\d+$/.test(v) ? Number(v) : null;
  };
  const missed = count('times_missed');
  if (missed === null) return err(`times_missed "${get('times_missed')}" is not a whole number`);
  const seen = count('times_seen');
  if (seen === null) return err(`times_seen "${get('times_seen')}" is not a whole number`);
  let status = get('status').toLowerCase();
  if (status === '') { warn('no status; using "new"'); status = 'new'; }
  if (!(MASTER_STATUSES as readonly string[]).includes(status)) return err(`unknown status "${get('status')}"`);
  let last = get('last_seen');
  if (last && !DATE_RE.test(last)) { warn(`last_seen "${last}" is not YYYY-MM-DD; left blank`); last = ''; }
  const fr = get('freq_rank');
  let freq: number | null = null;
  if (fr !== '') {
    if (/^\d+$/.test(fr)) freq = Number(fr);
    else warn(`freq_rank "${fr}" is not a number; left blank`);
  }
  return {
    word, meaning: get('meaning'), hanja: get('hanja'), pos: get('pos'), status: status as MasterStatus,
    times_missed: missed, times_seen: seen, last_seen: last, freq_rank: freq,
    sources: splitSet(get('sources')), tags: splitSet(get('tags')), notes: get('notes'),
  };
}

/** One row as CSV cells, in MASTER_COLUMNS order. */
export function masterCells(r: MasterRow): string[] {
  return [
    r.word, r.meaning, r.hanja, r.pos, r.status, String(r.times_missed), String(r.times_seen), r.last_seen,
    r.freq_rank === null ? '' : String(r.freq_rank), r.sources.join(' '), r.tags.join(' '), r.notes,
  ];
}

/**
 * The file text: header plus one line per row, RFC 4180 quoting, CRLF line endings, no BOM (the
 * same shape as the owner's original file, so diffs between exports stay clean).
 */
export function serializeMasterCsv(rows: readonly MasterRow[], opts: { header?: boolean } = {}): string {
  const cells = rows.map(masterCells);
  const all = opts.header === false ? cells : [[...MASTER_COLUMNS], ...cells];
  return toCsv(all);
}

/** Splits a master `meaning` into accepted answers: senses on `;`, then comma-separated glosses. */
export function meaningAnswers(meaning: string): string[] {
  const out: string[] = [];
  for (const sense of meaning.split(';')) for (const g of sense.split(',')) {
    const t = g.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * The custom vocab item for a word first met in a session (meaning + production), so it enters
 * lessons. Examples are left empty (a warning, D52). Id: `v:<word>` unless taken (generateId).
 */
export function sessionWordItem(row: MasterRow, opts: { level: number; source: 'convo' | 'tutor'; existing: ImportContext['existing'] }): VocabItem {
  const answers = meaningAnswers(row.meaning);
  const firstSense = row.meaning.split(';')[0]!.trim() || answers[0] || row.word;
  const source: SourceInfo = {
    kind: 'user', license: 'user-provided',
    attribution: opts.source === 'tutor' ? 'Tutoring session (VOCAB ROWS)' : '대화 모드 session (VOCAB ROWS)',
  };
  const ctx: ImportContext = { existing: opts.existing, defaultSource: source };
  return {
    id: generateId('vocab', row.word, ctx, new Set()),
    kind: 'vocab', level: Math.max(1, Math.trunc(opts.level) || 1), track: opts.source, rev: 1,
    unlockDeps: [], gating: false, source, needs_review: false, tags: [opts.source],
    questionTypes: answers.length ? ['meaning', 'production'] : ['production'],
    questions: {
      ...(answers.length ? { meaning: { accepted: answers } } : {}),
      production: { promptEn: firstSense, accepted: [row.word] },
    },
    word: row.word, meanings: answers.length ? answers : [firstSense], pos: row.pos || '', register: 'neutral',
    collocations: [], examples: [],
  };
}
