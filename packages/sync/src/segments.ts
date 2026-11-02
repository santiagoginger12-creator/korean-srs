// Remote layout (§11.2) and append-only JSONL segments.
//
//   <root>/manifest.json                        { format: "ksrs-sync", version: 1 }
//   <root>/devices/<deviceId>.json              { name, lastSeen, appVersion }
//   <root>/log/<deviceId>/<YYYY>-W<ww>.jsonl    one event per line, append-only
//
// Each device writes only its own files. A line is complete when a newline follows it; a last
// line with no newline that doesn't parse is a truncated write and is left for later.

import type { AppEvent } from '@ksrs/srs-engine';

export const DEFAULT_ROOT = 'ksrs/v1';
export const SYNC_FORMAT = 'ksrs-sync';
export const SYNC_FORMAT_VERSION = 1;

/** Device ids are random hex in the app; anything path-unsafe is never written or read. */
export const DEVICE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const manifestPath = (root = DEFAULT_ROOT): string => `${root}/manifest.json`;
export const devicePath = (deviceId: string, root = DEFAULT_ROOT): string => `${root}/devices/${deviceId}.json`;
export const logDir = (deviceId: string, root = DEFAULT_ROOT): string => `${root}/log/${deviceId}`;

/** ISO-8601 week (UTC): weeks start Monday; week 1 contains the year's first Thursday. */
export function isoWeek(ms: number): { year: number; week: number } {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  const thursday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3);
  const year = new Date(thursday).getUTCFullYear();
  const week = 1 + Math.floor((thursday - Date.UTC(year, 0, 1)) / (7 * 86_400_000));
  return { year, week };
}

export function segmentName(ms: number): string {
  const { year, week } = isoWeek(ms);
  return `${year}-W${String(week).padStart(2, '0')}.jsonl`;
}

export const segmentPath = (deviceId: string, ms: number, root = DEFAULT_ROOT): string =>
  `${logDir(deviceId, root)}/${segmentName(ms)}`;

/** `<root>/log/<deviceId>/<YYYY>-W<ww>.jsonl` → deviceId, else null (anything else under log/ is ignored). */
export function parseSegmentPath(path: string, root = DEFAULT_ROOT): { deviceId: string } | null {
  const pre = `${root}/log/`;
  if (!path.startsWith(pre)) return null;
  const rest = path.slice(pre.length).split('/');
  if (rest.length !== 2) return null;
  const [deviceId, file] = rest as [string, string];
  if (!DEVICE_ID_RE.test(deviceId) || !/^\d{4}-W\d{2}\.jsonl$/.test(file)) return null;
  return { deviceId };
}

/** Short fingerprint of a line (FNV-1a), to detect a rewritten file. */
export function lineTag(line: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < line.length; i++) { h ^= line.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${line.length}:${h.toString(36)}`;
}

const parsesAsObject = (s: string): boolean => {
  try { const v: unknown = JSON.parse(s); return typeof v === 'object' && v !== null && !Array.isArray(v); } catch { return false; }
};

export interface SplitSegment {
  /** Complete lines (without the trailing newline, `\r` stripped), blank lines included. */
  lines: string[];
  /** A trailing partial line that didn't parse (left unread, never counted). */
  truncated: string | null;
}

export function splitSegment(text: string): SplitSegment {
  const parts = text.split('\n');
  const last = parts.pop() ?? '';
  const lines = parts.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  let truncated: string | null = null;
  if (last.trim() !== '') {
    // No newline after it: complete only if it is a whole JSON object (a writer that skipped
    // the final newline); otherwise the write was cut short.
    if (parsesAsObject(last)) lines.push(last);
    else truncated = last;
  }
  return { lines, truncated };
}

/**
 * The lines past what was already read. If the file is shorter than before or line
 * `seen - 1` no longer matches its fingerprint, the file was rewritten (not appended), so
 * everything is returned again; union by id makes that safe.
 */
export function newLines(text: string, seen: number, tail: string | undefined): { fresh: string[]; total: number; tail?: string; restarted: boolean } {
  const { lines } = splitSegment(text);
  let from = seen;
  let restarted = false;
  if (seen > lines.length || (seen > 0 && tail !== undefined && lineTag(lines[seen - 1]!) !== tail)) { from = 0; restarted = true; }
  const lastLine = lines.length ? lines[lines.length - 1]! : undefined;
  return { fresh: lines.slice(from), total: lines.length, tail: lastLine === undefined ? undefined : lineTag(lastLine), restarted };
}

/** One event per line. Key order is as given; readers don't depend on it. */
export const eventLine = (e: AppEvent): string => JSON.stringify(e);

/**
 * Appends events to a segment's text: drops a truncated partial last line (it was never
 * counted by any reader), makes sure the text ends with a newline, and ends with one too.
 */
export function appendLines(text: string, events: readonly AppEvent[]): string {
  const { lines } = splitSegment(text);
  const head = lines.length ? `${lines.join('\n')}\n` : '';
  return head + events.map((e) => `${eventLine(e)}\n`).join('');
}

/** Ids of the events in a segment's complete lines (malformed lines are skipped). */
export function segmentIds(text: string): Set<string> {
  const ids = new Set<string>();
  for (const l of splitSegment(text).lines) {
    if (!l.trim()) continue;
    try {
      const v = JSON.parse(l) as { id?: unknown };
      if (v && typeof v.id === 'string') ids.add(v.id);
    } catch { /* malformed: not ours to fix */ }
  }
  return ids;
}
