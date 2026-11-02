// syncOnce(store, transport, clock) (§11.3). One pass:
//  1. list the remote (one request); create the manifest if missing, refuse a newer format
//  2. pull: every other device's segment whose sha changed → parse only lines past the cached
//     count → upcast + validate (engine) → quarantine the rest → observe HLCs → union into the
//     local store → remember sha/line count per path
//  3. push: local events not yet on the remote, appended to this device's weekly segments
//     (week of each event's `at`); on a sha conflict re-read, union, retry
//  4. refresh this device's file (name, lastSeen, appVersion) at most once a day
// Idempotent: a repeat with nothing new reads one listing and writes nothing.

import {
  isUnknownFutureVersion, parseHlc, sortEvents, upcastEvent, validateEvent, type AppEvent,
} from '@ksrs/srs-engine';
import { isConflict, SyncError } from './errors.ts';
import {
  appendLines, DEFAULT_ROOT, devicePath, manifestPath, newLines, parseSegmentPath, segmentIds, segmentPath,
  SYNC_FORMAT, SYNC_FORMAT_VERSION,
} from './segments.ts';
import type {
  EventStore, QuarantineItem, RemoteEntry, SyncClock, SyncOptions, SyncReport, SyncStateEntry, SyncTransport,
} from './types.ts';

const DAY = 86_400_000;

/** Parses, upcasts and validates remote lines. `lookup` resolves void/override targets. */
export function readLines(lines: readonly string[], source: string, lookup: (id: string) => AppEvent | undefined):
  { valid: AppEvent[]; quarantine: QuarantineItem[] } {
  const valid: AppEvent[] = [];
  const quarantine: QuarantineItem[] = [];
  const candidates: unknown[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let raw: unknown;
    try { raw = JSON.parse(line); } catch { quarantine.push({ raw: line, reason: 'malformed line', source }); continue; }
    try {
      const up = upcastEvent(raw);
      if (isUnknownFutureVersion(up)) quarantine.push({ raw, reason: 'future version', source });
      else candidates.push(up);
    } catch (e) {
      quarantine.push({ raw, reason: e instanceof Error ? e.message : 'invalid', source });
    }
  }
  const batch = new Map<string, AppEvent>();
  for (const c of candidates) {
    const id = (c as { id?: unknown }).id;
    if (typeof id === 'string' && !batch.has(id)) batch.set(id, c as AppEvent);
  }
  for (const c of candidates) {
    const r = validateEvent(c, (id) => batch.get(id) ?? lookup(id));
    if (r.ok) valid.push(r.event);
    else quarantine.push({ raw: c, reason: r.error, source });
  }
  return { valid, quarantine };
}

const targetsOf = (raws: readonly string[]): string[] => {
  const out = new Set<string>();
  for (const l of raws) {
    // Cheap pre-scan: only lines that mention a target need a local lookup.
    const m = /"(?:targetId|overrides)"\s*:\s*"([^"]+)"/.exec(l);
    if (m) out.add(m[1]!);
  }
  return [...out];
};

export async function syncOnce(store: EventStore, transport: SyncTransport, clock: SyncClock, opts: SyncOptions = {}): Promise<SyncReport> {
  const root = (opts.root ?? DEFAULT_ROOT).replace(/\/+$/, '');
  const retries = opts.retries ?? 3;
  const sleep = opts.sleep ?? (async () => {});
  const me = store.deviceId;
  const report: SyncReport = {
    startedAt: clock.now(), finishedAt: 0, segmentsRead: 0, received: 0, added: 0, conflicts: 0, quarantined: 0, pushed: 0, writes: 0, retries: 0,
  };
  const noteServerTime = (t: number | undefined) => { if (t !== undefined) report.skewMs = clock.now() - t; };

  const state = new Map((await store.syncState()).map((s) => [s.path, s] as const));
  const dirty: SyncStateEntry[] = [];
  const entries = await transport.list(root);
  const byPath = new Map(entries.map((e) => [e.path, e] as const));

  // ---- 1. manifest
  const mPath = manifestPath(root);
  const mEntry = byPath.get(mPath);
  if (!mEntry) {
    try {
      const r = await transport.put(mPath, `${JSON.stringify({ format: SYNC_FORMAT, version: SYNC_FORMAT_VERSION })}\n`, null, 'ksrs: create sync manifest');
      report.writes++;
      noteServerTime(r.serverTime);
      dirty.push({ path: mPath, sha: r.sha, lines: 0 });
    } catch (e) {
      if (!isConflict(e)) throw e; // another device created it first: fine
    }
  } else if (state.get(mPath)?.sha !== mEntry.sha) {
    const f = await transport.get(mPath);
    let m: { format?: unknown; version?: unknown } = {};
    try { m = JSON.parse(f?.content ?? '{}') as typeof m; } catch { /* unreadable: treat as v1 */ }
    if (typeof m.version === 'number' && m.version > SYNC_FORMAT_VERSION) {
      throw new SyncError('newer-format', `The sync data was written by a newer version of the app (format ${m.version}). Update the app.`);
    }
    dirty.push({ path: mPath, sha: mEntry.sha, lines: 0 });
  }

  // ---- 2. pull foreign segments whose sha changed
  const foreign = entries.filter((e) => { const p = parseSegmentPath(e.path, root); return p !== null && p.deviceId !== me; });
  const fresh: { entry: RemoteEntry; lines: string[]; total: number; tail?: string }[] = [];
  for (const entry of foreign) {
    const st = state.get(entry.path);
    if (st && st.sha === entry.sha) continue;
    const file = await transport.get(entry.path);
    if (!file) continue; // deleted since the listing
    report.segmentsRead++;
    const r = newLines(file.content, st?.lines ?? 0, st?.tail);
    fresh.push({ entry: { ...entry, sha: file.sha }, lines: r.fresh, total: r.total, tail: r.tail });
  }
  if (fresh.length) {
    const allLines = fresh.flatMap((f) => f.lines);
    const local = new Map((await store.getEvents(targetsOf(allLines))).map((e) => [e.id, e] as const));
    const valid: AppEvent[] = [];
    const quarantine: QuarantineItem[] = [];
    for (const f of fresh) {
      const r = readLines(f.lines, `sync:${f.entry.path}`, (id) => local.get(id));
      valid.push(...r.valid);
      quarantine.push(...r.quarantine);
    }
    report.received = valid.length;
    report.quarantined = quarantine.length;
    // HLC first: anything this device writes from now on sorts after what it has seen (D4).
    let maxHlc: string | undefined;
    for (const e of valid) if (maxHlc === undefined || e.hlc > maxHlc) maxHlc = e.hlc;
    if (maxHlc !== undefined) { try { parseHlc(maxHlc); clock.observe(maxHlc); } catch { /* validated; unreachable */ } }
    if (quarantine.length) await store.quarantine(quarantine);
    if (valid.length) {
      const r = await store.ingest(sortEvents(valid));
      report.added = r.added;
      report.conflicts = r.conflicts;
    }
    // Only after the events are stored: a crash in between re-reads the lines (union by id).
    for (const f of fresh) dirty.push({ path: f.entry.path, sha: f.entry.sha, lines: f.total, tail: f.tail });
  }
  if (dirty.length) { await store.putSyncState(dirty); dirty.length = 0; }

  // ---- 3. push local events not yet on the remote
  const unpushed = await store.unpushed();
  if (unpushed.length) {
    const groups = new Map<string, AppEvent[]>();
    for (const e of unpushed) {
      const p = segmentPath(me, e.at, root);
      const g = groups.get(p);
      if (g) g.push(e); else groups.set(p, [e]);
    }
    for (const path of [...groups.keys()].sort()) {
      const events = sortEvents(groups.get(path)!);
      for (let attempt = 0; ; attempt++) {
        const file = await transport.get(path);
        const have = file ? segmentIds(file.content) : new Set<string>();
        const add = events.filter((e) => !have.has(e.id));
        if (!add.length) break; // already there (an earlier push whose bookkeeping didn't land)
        try {
          const r = await transport.put(path, appendLines(file?.content ?? '', add), file?.sha ?? null, `ksrs: ${me} +${add.length} event${add.length === 1 ? '' : 's'}`);
          report.writes++;
          report.pushed += add.length;
          noteServerTime(r.serverTime);
          await store.putSyncState([{ path, sha: r.sha, lines: 0, at: clock.now() }]);
          break;
        } catch (e) {
          if (!isConflict(e) || attempt >= retries) throw e;
          report.retries++;
          await sleep(200 * (attempt + 1));
        }
      }
      await store.markPushed(events.map((e) => e.id));
    }
  }

  // ---- 4. this device's file (§11.2), refreshed at most daily or when its details change
  const dPath = devicePath(me, root);
  const meta = JSON.stringify({ name: opts.deviceName ?? '', appVersion: opts.appVersion ?? '' });
  const dState = state.get(dPath);
  const dEntry = byPath.get(dPath);
  const stale = !dState || !dEntry || dState.sha !== dEntry.sha || dState.meta !== meta
    || clock.now() - (dState.at ?? 0) >= (opts.deviceFileEveryMs ?? DAY);
  if (stale) await writeDeviceFile(store, transport, clock, { root, deviceName: opts.deviceName, appVersion: opts.appVersion, retries, sha: dEntry?.sha ?? null }, report);

  report.finishedAt = clock.now();
  return report;
}

/** Writes `<root>/devices/<deviceId>.json`. Also the write half of a connection test. */
export async function writeDeviceFile(store: Pick<EventStore, 'deviceId' | 'putSyncState'>, transport: SyncTransport, clock: Pick<SyncClock, 'now'>,
  o: { root?: string; deviceName?: string; appVersion?: string; retries?: number; sha?: string | null },
  report?: Pick<SyncReport, 'writes' | 'retries' | 'skewMs'>): Promise<{ sha: string }> {
  const root = (o.root ?? DEFAULT_ROOT).replace(/\/+$/, '');
  const path = devicePath(store.deviceId, root);
  const meta = JSON.stringify({ name: o.deviceName ?? '', appVersion: o.appVersion ?? '' });
  const t = clock.now();
  const body = `${JSON.stringify({ name: o.deviceName ?? '', lastSeen: new Date(t).toISOString(), appVersion: o.appVersion ?? '' }, null, 2)}\n`;
  let sha = o.sha === undefined ? (await transport.get(path))?.sha ?? null : o.sha;
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await transport.put(path, body, sha, `ksrs: device ${store.deviceId}`);
      if (report) { report.writes++; if (r.serverTime !== undefined) report.skewMs = clock.now() - r.serverTime; }
      await store.putSyncState([{ path, sha: r.sha, lines: 0, at: t, meta }]);
      return { sha: r.sha };
    } catch (e) {
      if (!isConflict(e) || attempt >= (o.retries ?? 3)) throw e;
      if (report) report.retries++;
      sha = (await transport.get(path))?.sha ?? null;
    }
  }
}

/**
 * Connection test: read access (a listing of the namespace) and write access (this device's
 * file). Returns what it found; throws a SyncError with the reason otherwise.
 */
export async function testConnection(store: Pick<EventStore, 'deviceId' | 'putSyncState'>, transport: SyncTransport, clock: Pick<SyncClock, 'now'>,
  o: { root?: string; deviceName?: string; appVersion?: string } = {}): Promise<{ files: number; devices: string[] }> {
  const root = (o.root ?? DEFAULT_ROOT).replace(/\/+$/, '');
  const entries = await transport.list(root);
  const devices = new Set<string>();
  for (const e of entries) { const p = parseSegmentPath(e.path, root); if (p) devices.add(p.deviceId); }
  const own = entries.find((e) => e.path === devicePath(store.deviceId, root));
  await writeDeviceFile(store, transport, clock, { ...o, root, sha: own?.sha ?? null });
  return { files: entries.length, devices: [...devices].sort() };
}

