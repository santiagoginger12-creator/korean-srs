// Interfaces between syncOnce and its environment (§4 rule 3: sync never imports IndexedDB;
// apps/web provides the EventStore adapter, and the transports below provide SyncTransport).

import type { AppEvent, HLC } from '@ksrs/srs-engine';

/** One file on the remote. `sha` is the blob sha (content-addressed). */
export interface RemoteEntry { path: string; sha: string; size?: number }
export interface RemoteFile { path: string; sha: string; content: string }

export interface SyncTransport {
  readonly kind: string;
  /** Every file under `prefix` (recursive). A missing prefix or an empty repo gives []. */
  list(prefix: string): Promise<RemoteEntry[]>;
  /** The file, or null if it doesn't exist. */
  get(path: string): Promise<RemoteFile | null>;
  /**
   * Creates (`sha` null) or replaces (`sha` = the sha it was read at) a file. Throws
   * SyncError('conflict') when the file changed since (or exists, for a create).
   * Returns the new blob sha and, when the server says, its time for the write (skew check).
   */
  put(path: string, content: string, sha: string | null, message: string): Promise<{ sha: string; serverTime?: number }>;
}

/** Per-path bookkeeping in the `syncState` store. */
export interface SyncStateEntry {
  path: string;
  /** Blob sha when last read (foreign segments) or written (own files). */
  sha: string;
  /** Complete lines already ingested (foreign segments). */
  lines: number;
  /** Fingerprint of line `lines - 1`; a mismatch means the file was rewritten, so it is re-read from the top. */
  tail?: string;
  /** Own device file / manifest: when it was last written or checked, and what was written. */
  at?: number;
  meta?: string;
}

export interface QuarantineItem { raw: unknown; reason: string; source: string }

export interface EventStore {
  readonly deviceId: string;
  /** Local events not yet known to be on the remote (any order). */
  unpushed(): Promise<AppEvent[]>;
  markPushed(ids: readonly string[]): Promise<void>;
  /**
   * Union by id: ids already present locally are left as they are (local copy wins, D58).
   * Everything passed in is on the remote, so it also counts as pushed.
   */
  ingest(events: readonly AppEvent[]): Promise<{ added: number; conflicts: number }>;
  /** Kept, never dropped (§12). */
  quarantine(items: readonly QuarantineItem[]): Promise<void>;
  /** Local events by id (to validate voids and overrides that target them). */
  getEvents(ids: readonly string[]): Promise<AppEvent[]>;
  syncState(): Promise<SyncStateEntry[]>;
  putSyncState(entries: readonly SyncStateEntry[]): Promise<void>;
}

export interface SyncClock {
  /** Wall-clock ms. */
  now(): number;
  /** Advance the local HLC past a remote one (D4). */
  observe(remote: HLC): void;
}

export interface SyncOptions {
  /** Remote namespace, default 'ksrs/v1' (§11.2; §12 "starting fresh" uses a new one). */
  root?: string;
  deviceName?: string;
  appVersion?: string;
  /** Extra attempts after a sha conflict (default 3). */
  retries?: number;
  /** Backoff between conflict retries (default none). */
  sleep?: (ms: number) => Promise<void>;
  /** Refresh the device file at most this often (default 24 h). */
  deviceFileEveryMs?: number;
}

export interface SyncReport {
  startedAt: number;
  finishedAt: number;
  /** Foreign segments fetched (sha changed). */
  segmentsRead: number;
  /** Valid remote events read from new lines. */
  received: number;
  /** Of those, new to this device. */
  added: number;
  /** Same id, different content: the local copy was kept. */
  conflicts: number;
  quarantined: number;
  /** Local events written to the remote this time. */
  pushed: number;
  /** Files written (segments, device file, manifest). */
  writes: number;
  /** Conflict retries taken. */
  retries: number;
  /** Local clock minus server clock (ms), when a write reported the server time. */
  skewMs?: number;
}
