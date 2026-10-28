// Master vocab list (docs/MASTER_LIST.md): the whole korean_master_vocab.csv as a deterministic
// function of (Anki baseline, app history, recorded session rows). Storage is `ext.` settings
// (D22, LWW per key); no new event types.
//
//   ext.master.baseline           BaselineBlob: the frozen Anki snapshot (rows with `anki` in sources)
//   ext.master.session.<hash16>   SessionRecord: one pasted VOCAB ROWS block (idempotent by key)
//   ext.master.lastExport         LastExport: when the file was last exported
//
// Session rows carry *deltas*, fixed when the block is recorded: a report row holds updated
// totals, so for a word already in the list we store `max(0, reported − master at paste time)`
// for times_missed and times_seen. Re-pasting the same block maps to the same key (no double
// count), and re-importing the baseline later doesn't change what a session added.

import type { Item, ItemId } from '@ksrs/content';
import { masterCells, type MasterRow, type MasterStatus } from '@ksrs/content';
import { headword } from './content-index.ts';
import { ANKI_SHAKY_TAG } from './leech.ts';
import type { DerivedState } from './state.ts';
import { offsetAt, type TzOffset } from './time.ts';
import { canonicalJson, MINUTE, sha256Hex } from './util.ts';

export const MASTER_EXT_BASELINE = 'ext.master.baseline';
export const MASTER_EXT_SESSION_PREFIX = 'ext.master.session.';
export const MASTER_EXT_LAST_EXPORT = 'ext.master.lastExport';
/** Misses at which a word counts as `learning` whatever Anki or the app says (and gets `leech`). */
export const MASTER_LEECH_MISSES = 8;

export type SessionSource = 'convo' | 'tutor';

export interface BaselineBlob {
  v: 1;
  /** `csv`: `data` is the CSV text; `deflate-raw+base64`: CompressionStream('deflate-raw') bytes, base64. */
  enc: 'csv' | 'deflate-raw+base64';
  data: string;
  rows: number;
  /** sha256 of the CSV text (checked after decoding). */
  sha256: string;
  importedAt: number;
  file: string;
  statusCounts: Record<MasterStatus, number>;
}

export interface SessionRowRec {
  word: string; meaning: string; hanja: string; pos: string; status: MasterStatus;
  /** Delta added to times_missed (≥ 0). */
  missed: number;
  /** Delta added to times_seen (≥ 0). */
  seen: number;
  /** times_missed as written in the report (for display only). */
  reportedMissed: number;
  last_seen: string; freq_rank: number | null; tags: string[]; notes: string;
  /** The word wasn't in the master list when the block was recorded. */
  isNew: boolean;
}

export interface SessionRecord {
  v: 1;
  hash: string;
  source: SessionSource;
  recordedAt: number;
  rows: SessionRowRec[];
  /** Custom items created for new words. */
  itemIds: string[];
}

export interface LastExport { at: number; rows: number; learning: number }

// ---------------------------------------------------------------- reading ext state

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNat = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;
const isStr = (x: unknown): x is string => typeof x === 'string';
const STATUSES: readonly string[] = ['new', 'learning', 'mastered', 'suspended'];

function asBaseline(v: unknown): BaselineBlob | undefined {
  if (!isObj(v) || v.v !== 1 || (v.enc !== 'csv' && v.enc !== 'deflate-raw+base64') || !isStr(v.data) || !isNat(v.rows)
    || !isStr(v.sha256) || typeof v.importedAt !== 'number' || !isStr(v.file)) return undefined;
  return v as unknown as BaselineBlob;
}

function asRowRec(v: unknown): SessionRowRec | undefined {
  if (!isObj(v) || !isStr(v.word) || !v.word || !isNat(v.missed) || !isNat(v.seen) || !STATUSES.includes(v.status as string)) return undefined;
  const s = (k: string): string => (isStr(v[k]) ? (v[k] as string) : '');
  const list = (k: string): string[] => (Array.isArray(v[k]) ? (v[k] as unknown[]).filter(isStr) : []);
  return {
    word: v.word, meaning: s('meaning'), hanja: s('hanja'), pos: s('pos'), status: v.status as MasterStatus,
    missed: v.missed, seen: v.seen, reportedMissed: isNat(v.reportedMissed) ? v.reportedMissed : v.missed,
    last_seen: /^\d{4}-\d{2}-\d{2}$/.test(s('last_seen')) ? s('last_seen') : '',
    freq_rank: isNat(v.freq_rank) ? v.freq_rank : null, tags: list('tags'), notes: s('notes'), isNew: v.isNew === true,
  };
}

function asSession(v: unknown): SessionRecord | undefined {
  if (!isObj(v) || v.v !== 1 || !isStr(v.hash) || (v.source !== 'convo' && v.source !== 'tutor')
    || typeof v.recordedAt !== 'number' || !Array.isArray(v.rows)) return undefined;
  const rows = v.rows.map(asRowRec).filter((r): r is SessionRowRec => !!r);
  return { v: 1, hash: v.hash, source: v.source, recordedAt: v.recordedAt, rows, itemIds: Array.isArray(v.itemIds) ? v.itemIds.filter(isStr) : [] };
}

export interface MasterExt {
  baseline: BaselineBlob | undefined;
  /** Recorded sessions, oldest first (recordedAt, then hash). */
  sessions: SessionRecord[];
  lastExport: LastExport | undefined;
}

/** The master-list inputs held in `ext.` settings; malformed values are ignored. */
export function readMasterExt(s: Pick<DerivedState, 'ext'>): MasterExt {
  const sessions: SessionRecord[] = [];
  for (const [k, v] of s.ext) {
    if (!k.startsWith(MASTER_EXT_SESSION_PREFIX)) continue;
    const r = asSession(v);
    if (r) sessions.push(r);
  }
  sessions.sort((a, b) => a.recordedAt - b.recordedAt || (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));
  const le = s.ext.get(MASTER_EXT_LAST_EXPORT);
  const lastExport = isObj(le) && typeof le.at === 'number' && isNat(le.rows) && isNat(le.learning) ? le as unknown as LastExport : undefined;
  return { baseline: asBaseline(s.ext.get(MASTER_EXT_BASELINE)), sessions, lastExport };
}

export const sessionKey = (hash: string): string => MASTER_EXT_SESSION_PREFIX + hash.slice(0, 16);

// ---------------------------------------------------------------- baseline

/** Rows that belong to the Anki baseline: `anki` in sources. */
export function baselineRows(rows: readonly MasterRow[]): MasterRow[] {
  return rows.filter((r) => r.sources.includes('anki'));
}

export function statusCounts(rows: readonly MasterRow[]): Record<MasterStatus, number> {
  const c: Record<MasterStatus, number> = { new: 0, learning: 0, mastered: 0, suspended: 0 };
  for (const r of rows) c[r.status]++;
  return c;
}

// ---------------------------------------------------------------- app history

export interface AppWord {
  word: string; meaning: string; hanja: string; pos: string;
  /** Lessons done + completed review groups, over every app item with this headword. */
  seen: number;
  /** Incorrect answers (including early ones, D5). */
  missed: number;
  last_seen: string;
  /** new: no lesson done; learning: some done item below Guru; mastered: every done item Guru+. */
  status: 'new' | 'learning' | 'mastered';
  /** Time of the latest app activity (0 when no lesson was done). */
  statusAt: number;
  tags: string[];
}

/** Local calendar date (YYYY-MM-DD) of `t` in `tz` (minutes east of UTC, or a function). */
export function localDate(t: number, tz: TzOffset | undefined): string {
  return new Date(t + offsetAt(tz, t) * MINUTE).toISOString().slice(0, 10);
}

const NATIVE_TRACKS = new Set(['native', 'native-verb']);

function hanjaOf(it: Item): string {
  if (it.kind === 'expression') return it.hanjaText ?? '';
  if (it.kind !== 'vocab' || !it.hanjaBreakdown?.length) return '';
  const hb = it.hanjaBreakdown;
  let p = 0;
  let out = '';
  for (const ch of it.word) {
    if (!/[\uAC00-\uD7A3]/.test(ch)) continue; // spaces, punctuation
    if (p < hb.length && hb[p]!.syllable === ch) { out += hb[p]!.hanja; p++; } else out += '-';
  }
  // Native endings (하다, 치 않다) aren't marked, as in the owner's file: 懇曲 for 간곡하다.
  return out.replace(/-+$/, '');
}

/**
 * App history per headword: every vocab and expression item in the content index (seed and
 * custom), so unstudied app words appear as `new`. Items are visited in id order (determinism).
 */
export function appWords(s: Pick<DerivedState, 'index' | 'items'>, tz: TzOffset | undefined): AppWord[] {
  const out = new Map<string, AppWord & { done: number; learning: number; levels: Set<number> }>();
  const ids = [...s.index.byId.keys()].sort();
  for (const id of ids) {
    const it = s.index.byId.get(id)!;
    if (it.kind !== 'vocab' && it.kind !== 'expression') continue;
    const word = headword(it).normalize('NFC').trim();
    if (!word) continue;
    let w = out.get(word);
    if (!w) {
      w = {
        // The first two senses, as in the owner's file (the item page has the rest).
        word, meaning: it.kind === 'vocab' ? (it.meanings ?? []).slice(0, 2).join('; ') : it.meaning ?? '', hanja: hanjaOf(it),
        pos: it.kind === 'vocab' ? it.pos ?? '' : it.subtype ?? '', seen: 0, missed: 0, last_seen: '', status: 'new', statusAt: 0,
        tags: [], done: 0, learning: 0, levels: new Set(),
      };
      out.set(word, w);
    }
    const tags = Array.isArray(it.tags) ? it.tags : [];
    if (it.source?.kind === 'original') w.levels.add(it.level);
    if (tags.includes(ANKI_SHAKY_TAG) && !w.tags.includes('shaky')) w.tags.push('shaky');
    if ((NATIVE_TRACKS.has(it.track) || tags.includes('native-verb')) && !w.tags.includes('native-verb')) w.tags.push('native-verb');
    const st = s.items.get(id);
    if (!st || st.lessonAt === undefined) continue;
    w.done++;
    if (st.stage < 5) w.learning++;
    w.seen += 1 + st.stats.reviews;
    w.missed += st.stats.incorrect;
    const last = Math.max(st.lessonAt, st.stats.lastAt ?? 0, ...st.recentIncorrectAts);
    w.statusAt = Math.max(w.statusAt, last);
  }
  return [...out.values()].map(({ done, learning, levels, ...w }) => ({
    ...w,
    status: done === 0 ? 'new' : learning > 0 ? 'learning' : 'mastered',
    last_seen: w.statusAt ? localDate(w.statusAt, tz) : '',
    tags: [...w.tags, ...[...levels].sort((a, b) => a - b).map((n) => `app-L${n}`)],
  }));
}

// ---------------------------------------------------------------- merge

const SOURCE_ORDER = ['anki', 'app', 'convo', 'tutor'];
const orderSources = (xs: Iterable<string>): string[] => {
  const set = new Set(xs);
  return [...SOURCE_ORDER.filter((x) => set.has(x)), ...[...set].filter((x) => !SOURCE_ORDER.includes(x)).sort()];
};
const tagRank = (t: string): number => (t === 'leech' ? 0 : t === 'shaky' ? 1 : /^app-L\d+$/.test(t) ? 2 : t === 'native-verb' ? 3 : 4);
const orderTags = (xs: Iterable<string>): string[] => [...new Set(xs)].sort((a, b) => {
  const r = tagRank(a) - tagRank(b);
  if (r) return r;
  if (tagRank(a) === 2) return Number(a.slice(5)) - Number(b.slice(5));
  return a < b ? -1 : a > b ? 1 : 0;
});
/** Recomputed on every export, so never carried over from inputs. */
const isComputedTag = (t: string): boolean => t === 'leech' || /^app-L\d+$/.test(t);
const STATUS_ORDER: Record<MasterStatus, number> = { learning: 0, new: 1, mastered: 2, suspended: 3 };
const maxDate = (a: string, b: string): string => (b > a ? b : a);

export interface MasterInputs {
  /** Anki baseline rows (only rows with `anki` in sources are used). */
  baseline: readonly MasterRow[];
  app: readonly AppWord[];
  sessions: readonly SessionRecord[];
}

/**
 * The whole master list. For each headword:
 * - times_missed / times_seen = baseline + app + Σ session deltas; last_seen = the latest date.
 * - meaning, hanja, pos: baseline, else the session row that introduced the word, else app, else
 *   the latest session row that has them.
 * - status: the latest non-`new` evidence wins (baseline is oldest; a session row counts at its
 *   record time; the app at its latest activity, once a lesson is done); `new` only when nothing
 *   else says otherwise. Exception: an Anki-`mastered` word stays `mastered` (doing its app
 *   lesson is no evidence it isn't known) unless the app or a session adds misses since the
 *   baseline. Then `new`/`mastered` with ≥ 8 misses → `learning`.
 * - tags: inputs' tags (minus `leech`, `app-L<n>`, which are recomputed) + app tags + `leech`.
 * - notes: the latest non-empty session note, else the baseline's.
 * Sorted learning (misses desc), new, mastered, suspended; ties by freq_rank, then word.
 */
export function buildMasterList(inp: MasterInputs): MasterRow[] {
  const base = new Map<string, MasterRow>();
  for (const r of inp.baseline) if (r.sources.includes('anki')) base.set(r.word, r);
  const app = new Map(inp.app.map((a) => [a.word, a] as const));
  const sess = new Map<string, { rec: SessionRecord; row: SessionRowRec }[]>();
  for (const rec of inp.sessions) for (const row of rec.rows) {
    const l = sess.get(row.word);
    if (l) l.push({ rec, row }); else sess.set(row.word, [{ rec, row }]);
  }
  const words = new Set([...base.keys(), ...app.keys(), ...sess.keys()]);
  const out: MasterRow[] = [];
  for (const word of words) {
    const b = base.get(word);
    const a = app.get(word);
    const ss = sess.get(word) ?? [];
    const latest = (f: (r: SessionRowRec) => string): string => {
      for (let i = ss.length - 1; i >= 0; i--) { const v = f(ss[i]!.row); if (v) return v; }
      return '';
    };
    // A word first met in a session keeps the gloss written then (its custom item re-joins senses).
    const intro = ss.find((x) => x.row.isNew)?.row;
    const pick = (f: (r: { meaning: string; hanja: string; pos: string }) => string): string =>
      (b && f(b)) || (intro && f(intro)) || (a && f(a)) || latest(f);

    let missed = (b?.times_missed ?? 0) + (a?.missed ?? 0);
    let seen = (b?.times_seen ?? 0) + (a?.seen ?? 0);
    let last = maxDate(b?.last_seen ?? '', a?.last_seen ?? '');
    const sources: string[] = b ? b.sources.filter((x) => x !== 'app') : [];
    const tags: string[] = b ? b.tags.filter((t) => !isComputedTag(t)) : [];
    if (a) { sources.push('app'); tags.push(...a.tags); }
    let freq = b?.freq_rank ?? null;
    // Status evidence: [time, status]; baseline is the oldest.
    let status: MasterStatus | null = b && b.status !== 'new' ? b.status : null;
    let statusAt = -Infinity;
    const offer = (st: MasterStatus, t: number) => { if (st !== 'new' && t >= statusAt) { status = st; statusAt = t; } };
    const ev: { t: number; st: MasterStatus; order: number }[] = [];
    if (a && a.status !== 'new') ev.push({ t: a.statusAt, st: a.status, order: 0 });
    for (const { rec, row } of ss) {
      missed += row.missed;
      seen += row.seen;
      last = maxDate(last, row.last_seen);
      sources.push(rec.source);
      tags.push(...row.tags.filter((t) => !isComputedTag(t)));
      if (freq === null && row.freq_rank !== null) freq = row.freq_rank;
      ev.push({ t: rec.recordedAt, st: row.status, order: 1 });
    }
    ev.sort((x, y) => x.t - y.t || x.order - y.order);
    // An Anki-mastered word with no new misses keeps `mastered`: only `suspended` can override it.
    const keepMastered = b?.status === 'mastered' && missed === b.times_missed;
    for (const e of ev) if (!keepMastered || e.st === 'suspended') offer(e.st, e.t);
    let final: MasterStatus = status ?? 'new';
    if ((final === 'new' || final === 'mastered') && missed >= MASTER_LEECH_MISSES) final = 'learning';
    if (missed >= MASTER_LEECH_MISSES) tags.push('leech');
    out.push({
      word, meaning: pick((r) => r.meaning), hanja: pick((r) => r.hanja), pos: pick((r) => r.pos), status: final,
      times_missed: missed, times_seen: seen, last_seen: last, freq_rank: freq,
      sources: orderSources(sources), tags: orderTags(tags), notes: latest((r) => r.notes) || b?.notes || '',
    });
  }
  return out.sort(compareMasterRows);
}

export function compareMasterRows(x: MasterRow, y: MasterRow): number {
  return STATUS_ORDER[x.status] - STATUS_ORDER[y.status]
    || y.times_missed - x.times_missed
    || (x.freq_rank ?? Infinity) - (y.freq_rank ?? Infinity)
    || (x.word < y.word ? -1 : x.word > y.word ? 1 : 0);
}

// ---------------------------------------------------------------- session rows

/** Idempotency key of a pasted block: sha256 of its parsed rows (header, fences, quoting and spacing don't matter). */
export function sessionHash(rows: readonly MasterRow[]): string {
  return sha256Hex(canonicalJson(rows.map(masterCells)));
}

/**
 * Turns pasted VOCAB ROWS into a session record against the current master list (`current`,
 * i.e. `buildMasterList` output right now). Existing words add `max(0, reported − current)`
 * misses and encounters; new words add their reported counts and are marked `isNew`.
 */
export function planSession(current: readonly MasterRow[], pasted: readonly MasterRow[],
                            opts: { source: SessionSource; recordedAt: number }): SessionRecord {
  const cur = new Map(current.map((r) => [r.word, r] as const));
  const rows: SessionRowRec[] = pasted.map((p) => {
    const c = cur.get(p.word);
    return {
      word: p.word, meaning: p.meaning, hanja: p.hanja, pos: p.pos, status: p.status,
      missed: c ? Math.max(0, p.times_missed - c.times_missed) : p.times_missed,
      seen: c ? Math.max(0, p.times_seen - c.times_seen) : p.times_seen,
      reportedMissed: p.times_missed,
      last_seen: p.last_seen, freq_rank: p.freq_rank, tags: p.tags.slice(), notes: p.notes, isNew: !c,
    };
  });
  return { v: 1, hash: sessionHash(pasted), source: opts.source, recordedAt: opts.recordedAt, rows, itemIds: [] };
}

/** Ids of items in the index whose headword is `word` (vocab/expression). */
export function itemsForWord(s: Pick<DerivedState, 'index'>, word: string): ItemId[] {
  const out: ItemId[] = [];
  for (const it of s.index.byId.values()) {
    if ((it.kind === 'vocab' || it.kind === 'expression') && headword(it).normalize('NFC').trim() === word) out.push(it.id);
  }
  return out.sort();
}
