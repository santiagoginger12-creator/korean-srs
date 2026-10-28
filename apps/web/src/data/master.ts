// Master vocab list on the web side: baseline blob encoding (deflate-raw + base64 through
// CompressionStream, plain CSV where that's missing), a decode cache, the full-list hook, and
// the event payloads for each action. The list itself is @ksrs/srs-engine `buildMasterList`.
import { useEffect, useMemo, useState } from 'react';
import { parseMasterCsv, serializeMasterCsv, sessionWordItem, type Item, type MasterRow } from '@ksrs/content';
import {
  appWords, baselineRows, buildMasterList, extPayload, itemsForWord, MASTER_EXT_BASELINE, MASTER_EXT_LAST_EXPORT, planSession,
  readMasterExt, sessionKey, sha256Hex, statusCounts,
  type BaselineBlob, type DerivedState, type EventPayload, type MasterExt, type SessionRecord, type SessionSource, type TzOffset,
} from '@ksrs/srs-engine';

export const MASTER_FILENAME = 'korean_master_vocab.csv';

// ---------------------------------------------------------------- compression

const hasCompression = (): boolean => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

async function pipeBytes(bytes: Uint8Array, ts: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(ts as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** The stored baseline for these rows (only rows with `anki` in sources are kept). */
export async function encodeBaseline(rows: readonly MasterRow[], file: string, at: number, opts: { compress?: boolean } = {}): Promise<BaselineBlob> {
  const kept = baselineRows(rows);
  const csv = serializeMasterCsv(kept);
  const compress = opts.compress ?? hasCompression();
  const data = compress
    ? toBase64(await pipeBytes(new TextEncoder().encode(csv), new CompressionStream('deflate-raw' as CompressionFormat)))
    : csv;
  return {
    v: 1, enc: compress ? 'deflate-raw+base64' : 'csv', data, rows: kept.length, sha256: sha256Hex(csv),
    importedAt: at, file, statusCounts: statusCounts(kept),
  };
}

let cache: { key: string; rows: Promise<MasterRow[]> } | null = null;

/** Decoded baseline rows (memoized on the blob, so replays and re-renders don't re-parse). */
export function decodeBaseline(blob: BaselineBlob): Promise<MasterRow[]> {
  const key = `${blob.sha256}|${blob.importedAt}|${blob.data.length}`;
  if (cache?.key === key) return cache.rows;
  const rows = (async () => {
    let csv: string;
    if (blob.enc === 'csv') csv = blob.data;
    else {
      if (!hasCompression()) throw new Error('this browser can\'t decompress the stored Anki baseline; import it again here');
      csv = new TextDecoder().decode(await pipeBytes(fromBase64(blob.data), new DecompressionStream('deflate-raw' as CompressionFormat)));
    }
    if (sha256Hex(csv) !== blob.sha256) throw new Error('the stored Anki baseline is damaged (checksum mismatch); import it again');
    return parseMasterCsv(csv).rows;
  })();
  cache = { key, rows };
  rows.catch(() => { if (cache?.key === key) cache = null; });
  return rows;
}

// ---------------------------------------------------------------- the full list

const NO_ROWS: readonly MasterRow[] = Object.freeze([]);

export interface MasterView {
  ext: MasterExt;
  /** 'none': no baseline imported (the list still has app and session words). */
  baseline: 'none' | 'loading' | 'ready' | 'error';
  error?: string;
  /** The full list; null while the baseline is decoding (or failed). */
  rows: MasterRow[] | null;
  learning: number;
}

export function masterRows(d: DerivedState, baseline: readonly MasterRow[], tz: TzOffset): MasterRow[] {
  return buildMasterList({ baseline, app: appWords(d, tz), sessions: readMasterExt(d).sessions });
}

/** The current master list for `d` (decodes the baseline once, recomputes when `d` changes). */
export function useMasterList(d: DerivedState, tz: TzOffset): MasterView {
  const ext = useMemo(() => readMasterExt(d), [d]);
  const blob = ext.baseline;
  const [dec, setDec] = useState<{ blob: BaselineBlob; rows?: MasterRow[]; error?: string } | null>(null);
  useEffect(() => {
    if (!blob) return;
    let live = true;
    decodeBaseline(blob).then((rows) => { if (live) setDec({ blob, rows }); },
      (e: unknown) => { if (live) setDec({ blob, error: (e as Error).message }); });
    return () => { live = false; };
  }, [blob]);
  const cur = blob && dec?.blob === blob ? dec : null;
  const base: readonly MasterRow[] | null = !blob ? NO_ROWS : cur?.rows ?? null;
  const rows = useMemo(() => (base ? masterRows(d, base, tz) : null), [d, base, tz]);
  return {
    ext, rows,
    baseline: !blob ? 'none' : cur?.error ? 'error' : cur?.rows ? 'ready' : 'loading',
    ...(cur?.error ? { error: cur.error } : {}),
    learning: rows ? rows.filter((r) => r.status === 'learning').length : 0,
  };
}

// ---------------------------------------------------------------- actions → events

export function baselinePayload(blob: BaselineBlob): EventPayload {
  return extPayload(MASTER_EXT_BASELINE, blob);
}

export function lastExportPayload(at: number, rows: readonly MasterRow[]): EventPayload {
  return extPayload(MASTER_EXT_LAST_EXPORT, { at, rows: rows.length, learning: rows.filter((r) => r.status === 'learning').length });
}

export interface SessionPlan {
  record: SessionRecord;
  /** Already recorded (same block): recording again would change nothing. */
  duplicateOf: SessionRecord | undefined;
  /** Custom items for new words (when requested). */
  items: Item[];
}

/** Plans recording a pasted block against the current list `current`. */
export function planSessionRows(d: DerivedState, current: readonly MasterRow[], pasted: readonly MasterRow[],
                                opts: { source: SessionSource; recordedAt: number; createItems: boolean }): SessionPlan {
  const record = planSession(current, pasted, opts);
  const duplicateOf = readMasterExt(d).sessions.find((s) => sessionKey(s.hash) === sessionKey(record.hash));
  const items: Item[] = [];
  if (opts.createItems) {
    const existing = new Map(d.index.byId);
    for (const r of record.rows) {
      if (!r.isNew || itemsForWord(d, r.word).length) continue;
      const row = pasted.find((p) => p.word === r.word)!;
      const it = sessionWordItem(row, { level: d.userLevel, source: opts.source, existing });
      existing.set(it.id, it);
      items.push(it);
    }
  }
  record.itemIds = items.map((i) => i.id);
  return { record, duplicateOf, items };
}

/** Items first, then the record (so the record's item ids already exist when it lands). */
export function sessionPayloads(plan: SessionPlan): EventPayload[] {
  return [
    ...plan.items.map((item): EventPayload => ({ type: 'customItem.upsert', item })),
    extPayload(sessionKey(plan.record.hash), plan.record),
  ];
}

/** Removing a recorded block's record only (its deltas stop counting). */
export const removeSessionPayload = (hash: string): EventPayload => extPayload(sessionKey(hash), null);

/**
 * Undoing a recorded block exactly: its record, plus the items it created that are still
 * unstudied (no lesson done) and not claimed by another recorded block. Studied items stay, so
 * no app history is lost; `kept` lists them.
 */
export function removeSessionPayloads(d: DerivedState, rec: SessionRecord): { payloads: EventPayload[]; deleted: string[]; kept: string[] } {
  const others = new Set(readMasterExt(d).sessions.filter((s) => s.hash !== rec.hash).flatMap((s) => s.itemIds));
  const deleted: string[] = [];
  const kept: string[] = [];
  for (const id of rec.itemIds) {
    if (!d.customItems.has(id) || others.has(id)) continue;
    if (d.items.get(id)?.lessonAt !== undefined) kept.push(id); else deleted.push(id);
  }
  return {
    payloads: [removeSessionPayload(rec.hash), ...deleted.map((itemId): EventPayload => ({ type: 'customItem.delete', itemId }))],
    deleted, kept,
  };
}
