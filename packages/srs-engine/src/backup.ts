// Backup format (§12). A backup is just the event log, canonically sorted and checksummed.

import {
  isUnknownFutureVersion, sortEvents, unionEvents, upcastEvent, validateLog, type AppEvent,
} from './events.ts';
import { canonicalJson, sha256Hex } from './util.ts';

export const BACKUP_FORMAT = 'ksrs-backup' as const;
export const BACKUP_FORMAT_VERSION = 1 as const;

export interface BackupMeta {
  /** ISO-8601, supplied by the caller (the engine has no clock). */
  createdAt: string;
  appVersion: string;
  contentVersion: string;
  deviceId: string;
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  createdAt: string;
  app: { version: string; contentVersion: string };
  deviceId: string;
  eventCount: number;
  events: AppEvent[];
  checksum: string;
}

export function eventsChecksum(events: readonly unknown[]): string {
  return 'sha256:' + sha256Hex(canonicalJson(events));
}

/**
 * Dedupes by id, sorts by (hlc, id), and checksums the canonical events JSON.
 *
 * `quarantined`: raw events this device holds but can't apply (newer app version, malformed).
 * They are appended after the sorted log (deduped, in canonical order) so a backup never
 * loses them; `parseBackup` puts them back in quarantine on any app that still can't read
 * them, and a newer app reads them as ordinary events.
 */
export function makeBackup(events: readonly AppEvent[], meta: BackupMeta, quarantined: readonly unknown[] = []): BackupFile {
  const sorted = sortEvents(events);
  const have = new Set(sorted.map((e) => e.id));
  const extra = new Map<string, unknown>();
  for (const raw of quarantined) {
    const id = typeof raw === 'object' && raw !== null ? (raw as { id?: unknown }).id : undefined;
    if (typeof id === 'string' && have.has(id)) continue;
    const c = canonicalJson(raw);
    extra.set(typeof id === 'string' ? `id:${id}` : `c:${c}`, raw);
  }
  const tail = [...extra].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, raw]) => raw as AppEvent);
  const all = tail.length ? [...sorted, ...tail] : sorted;
  return {
    format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION, createdAt: meta.createdAt,
    app: { version: meta.appVersion, contentVersion: meta.contentVersion }, deviceId: meta.deviceId,
    eventCount: all.length, events: all, checksum: eventsChecksum(all),
  };
}

/** Stable serialization (canonical key order) — equal logs give byte-identical files. */
export function serializeBackup(b: BackupFile): string {
  return canonicalJson(b);
}

export type ParseBackupResult =
  | { ok: true; meta: BackupMeta; events: AppEvent[]; quarantine: { raw: unknown; reason: string }[] }
  | { ok: false; error: string };

/**
 * Parses and verifies a backup (string or already-parsed object). The checksum covers the
 * events exactly as stored. Valid v1 events are returned; future-version or malformed events
 * are returned in `quarantine` (never dropped silently).
 */
export function parseBackup(json: string | unknown): ParseBackupResult {
  let raw: unknown = json;
  if (typeof json === 'string') {
    try { raw = JSON.parse(json); } catch { return { ok: false, error: 'not JSON' }; }
  }
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'not an object' };
  const b = raw as Record<string, unknown>;
  if (b.format !== BACKUP_FORMAT) return { ok: false, error: 'not a ksrs backup' };
  if (b.formatVersion !== BACKUP_FORMAT_VERSION) return { ok: false, error: `unsupported formatVersion ${String(b.formatVersion)}` };
  if (!Array.isArray(b.events)) return { ok: false, error: 'missing events' };
  if (typeof b.checksum !== 'string') return { ok: false, error: 'missing checksum' };
  if (eventsChecksum(b.events) !== b.checksum) return { ok: false, error: 'checksum mismatch' };
  if (typeof b.eventCount === 'number' && b.eventCount !== b.events.length) return { ok: false, error: 'eventCount mismatch' };

  const quarantine: { raw: unknown; reason: string }[] = [];
  const candidates: unknown[] = [];
  for (const e of b.events) {
    try {
      const up = upcastEvent(e);
      if (isUnknownFutureVersion(up)) quarantine.push({ raw: e, reason: 'future version' });
      else candidates.push(up);
    } catch (err) {
      quarantine.push({ raw: e, reason: err instanceof Error ? err.message : 'invalid' });
    }
  }
  const { valid, invalid } = validateLog(candidates);
  for (const x of invalid) quarantine.push({ raw: x.raw, reason: x.error });

  const app = (typeof b.app === 'object' && b.app !== null ? b.app : {}) as Record<string, unknown>;
  return {
    ok: true,
    meta: {
      createdAt: String(b.createdAt ?? ''), appVersion: String(app.version ?? ''),
      contentVersion: String(app.contentVersion ?? ''), deviceId: String(b.deviceId ?? ''),
    },
    events: sortEvents(valid),
    quarantine,
  };
}

/** Restore in Merge mode: union by id (§12). */
export function mergeBackup(local: readonly AppEvent[], incoming: readonly AppEvent[]): AppEvent[] {
  return unionEvents(local, incoming);
}

/**
 * Manual file sync (§11 option d, M5): the union of two devices' logs. Same as `mergeBackup`
 * (named for the sync use). Replace-mode restore is just `parsed.events` on an empty store.
 */
export function mergeEventSets(a: readonly AppEvent[], b: readonly AppEvent[]): AppEvent[] {
  return unionEvents(a, b);
}
