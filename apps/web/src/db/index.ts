// The app's IndexedDB schema (§10, reduced for M2 per D3/D29):
//   events  keyPath id, index hlc        SOURCE OF TRUTH (append-only)
//   kv      out-of-line string keys      deviceId, last HLC, settings cache, session snapshot, …
//   content keyPath key                  { key: 'bundle', contentVersion, bundle }
// Derived state lives in memory (replayAll on load, applyEvents after writes); there are no
// projection stores yet, so "Rebuild from log" is simply a fresh replayAll.

import type { ContentBundle } from '@ksrs/content';
import type { AppEvent } from '@ksrs/srs-engine';
import { openDb, reqP, tx } from './idb.ts';

export const DB_NAME = 'ksrs';
export const DB_VERSION = 1;

export const KV = {
  deviceId: 'deviceId',
  hlc: 'hlc',
  settings: 'settingsCache',
  session: 'reviewSession',
  lessonOverride: 'lessonOverride',
} as const;

export interface StoredContent { key: 'bundle'; contentVersion: string; bundle: ContentBundle }

export interface AppDb {
  allEvents(): Promise<AppEvent[]>;
  /** Appends events (ids already present are left as-is) and applies kv writes, atomically. */
  append(events: readonly AppEvent[], kv?: Record<string, unknown>): Promise<void>;
  kvGet<T>(key: string): Promise<T | undefined>;
  kvSet(entries: Record<string, unknown>): Promise<void>;
  kvDelete(key: string): Promise<void>;
  getContent(): Promise<StoredContent | undefined>;
  putContent(bundle: ContentBundle): Promise<void>;
  close(): void;
}

export async function openAppDb(name = DB_NAME, factory?: IDBFactory): Promise<AppDb> {
  const db = await openDb(name, DB_VERSION, (d, oldVersion) => {
    if (oldVersion < 1) {
      const ev = d.createObjectStore('events', { keyPath: 'id' });
      ev.createIndex('hlc', 'hlc');
      d.createObjectStore('kv');
      d.createObjectStore('content', { keyPath: 'key' });
    }
  }, factory);

  const putKv = (store: IDBObjectStore, entries: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(entries)) {
      if (v === undefined) store.delete(k); else store.put(v, k);
    }
  };

  return {
    allEvents: () => tx(db, ['events'], 'readonly', (s) => reqP(s.events!.index('hlc').getAll() as IDBRequest<AppEvent[]>)),
    append: (events, kv) => tx(db, ['events', 'kv'], 'readwrite', (s) => {
      // `add` would abort the whole transaction on a duplicate id; `put` of an identical
      // immutable event is a no-op in effect, so union semantics hold.
      for (const e of events) s.events!.put(e);
      if (kv) putKv(s.kv!, kv);
    }),
    kvGet: <T,>(key: string) => tx(db, ['kv'], 'readonly', (s) => reqP(s.kv!.get(key) as IDBRequest<T | undefined>)),
    kvSet: (entries) => tx(db, ['kv'], 'readwrite', (s) => { putKv(s.kv!, entries); }),
    kvDelete: (key) => tx(db, ['kv'], 'readwrite', (s) => { s.kv!.delete(key); }),
    getContent: () => tx(db, ['content'], 'readonly', (s) => reqP(s.content!.get('bundle') as IDBRequest<StoredContent | undefined>)),
    putContent: (bundle) => tx(db, ['content'], 'readwrite', (s) => {
      s.content!.put({ key: 'bundle', contentVersion: bundle.contentVersion, bundle } satisfies StoredContent);
    }),
    close: () => db.close(),
  };
}

/** Best effort: ask the browser not to evict our storage (§10). */
export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}
