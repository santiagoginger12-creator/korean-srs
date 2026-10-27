// Backup / restore / manual-sync helpers (§12). Pure except for the stream-based gzip helpers,
// which use the standard CompressionStream API (browsers and Node 18+).
import type { AppEvent } from '@ksrs/srs-engine';
import { canonicalJson, sha256Hex, DAY } from '@ksrs/srs-engine';

export const BACKUP_REMINDER_DAYS = 7;

export interface RestorePreview {
  incoming: number;
  /** Events this device doesn't have yet. */
  fresh: number;
  alreadyPresent: number;
  /**
   * Ids present on both sides with different content. Events are immutable, so this means a
   * damaged or hand-edited file; a merge keeps this device's copy.
   */
  conflicts: number;
  /** Wall-clock range of the incoming events (ms), null when empty. */
  range: { from: number; to: number } | null;
  devices: { deviceId: string; count: number }[];
  quarantined: number;
  /** Counts by event type among the fresh events (what a merge would add). */
  freshByType: Record<string, number>;
}

export function restorePreview(local: readonly AppEvent[], incoming: readonly AppEvent[], quarantined: number): RestorePreview {
  const have = new Map(local.map((e) => [e.id, e] as const));
  let fresh = 0;
  let conflicts = 0;
  let from = Infinity;
  let to = -Infinity;
  const devices = new Map<string, number>();
  const freshByType: Record<string, number> = {};
  for (const e of incoming) {
    const mine = have.get(e.id);
    if (!mine) { fresh++; freshByType[e.type] = (freshByType[e.type] ?? 0) + 1; }
    else if (mine !== e && canonicalJson(mine) !== canonicalJson(e)) conflicts++;
    from = Math.min(from, e.at);
    to = Math.max(to, e.at);
    devices.set(e.deviceId, (devices.get(e.deviceId) ?? 0) + 1);
  }
  return {
    incoming: incoming.length, fresh, alreadyPresent: incoming.length - fresh, conflicts,
    range: incoming.length ? { from, to } : null,
    devices: [...devices].map(([deviceId, count]) => ({ deviceId, count })).sort((a, b) => b.count - a.count),
    quarantined, freshByType,
  };
}

/** Stable quarantine key: the event id when it has one, else a content hash. */
export function quarantineKey(raw: unknown): string {
  const id = typeof raw === 'object' && raw !== null ? (raw as { id?: unknown }).id : undefined;
  return typeof id === 'string' && id ? `id:${id}` : `h:${sha256Hex(canonicalJson(raw)).slice(0, 32)}`;
}

export function backupFilename(now: number, deviceName: string, gzip: boolean): string {
  const d = new Date(now);
  const p2 = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
  const dev = deviceName.trim().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'device';
  return `ksrs-${dev}-${stamp}.ksrs.json${gzip ? '.gz' : ''}`;
}

export function backupDue(lastBackupAt: number | undefined, now: number, eventCount: number): boolean {
  if (eventCount === 0) return false; // nothing to lose yet
  return lastBackupAt === undefined || now - lastBackupAt > BACKUP_REMINDER_DAYS * DAY;
}

export const canGzip = (): boolean => typeof CompressionStream !== 'undefined';

export async function encodeBackup(json: string, gzip: boolean): Promise<Blob> {
  const blob = new Blob([json], { type: 'application/json' });
  if (!gzip) return blob;
  const stream = blob.stream().pipeThrough(new CompressionStream('gzip'));
  return new Blob([await new Response(stream).arrayBuffer()], { type: 'application/gzip' });
}

/** Reads a backup file, transparently gunzipping when it starts with the gzip magic bytes. */
export async function decodeBackupFile(data: Blob | ArrayBuffer): Promise<string> {
  const buf = data instanceof ArrayBuffer ? data : await data.arrayBuffer();
  const head = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  if (head[0] === 0x1f && head[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open .gz files; export without compression instead.');
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  }
  return new TextDecoder().decode(buf);
}

/** Friendly wording for parseBackup errors. */
export function friendlyBackupError(error: string): string {
  if (/checksum/.test(error)) return 'This backup has been modified or damaged (checksum mismatch). Nothing was imported.';
  if (/eventCount/.test(error)) return 'This backup looks truncated (event count mismatch). Nothing was imported.';
  if (/not JSON/.test(error)) return 'That file isn\'t a readable backup (not JSON).';
  if (/not a ksrs backup/.test(error)) return 'That JSON file isn\'t a ksrs backup.';
  if (/formatVersion/.test(error)) return 'This backup was made by a newer version of the app. Update the app, then try again.';
  return `Couldn't read this backup: ${error}.`;
}
