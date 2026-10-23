// A tiny promise wrapper over IndexedDB (D29: stands in for Dexie). Only src/db/ may touch
// IndexedDB (§4 rule 4). Every multi-store write goes through `tx`, which resolves only when
// the transaction commits, so callers get all-or-nothing durability.

export type StoreName = string;

export function reqP<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

export function openDb(name: string, version: number, upgrade: (db: IDBDatabase, oldVersion: number, tx: IDBTransaction) => void,
                       factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = factory.open(name, version);
    r.onupgradeneeded = (e) => upgrade(r.result, e.oldVersion, r.transaction!);
    r.onsuccess = () => {
      const db = r.result;
      // Another tab upgraded the schema: close so it can proceed; this tab reloads on next use.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    r.onerror = () => reject(r.error ?? new Error(`open ${name} failed`));
    r.onblocked = () => reject(new Error(`open ${name} blocked by another tab`));
  });
}

/**
 * Runs `body` in one transaction over `stores` and resolves with its result after commit.
 * `body` must only issue requests synchronously or chain them via the stores it is given
 * (no awaiting unrelated promises, which would auto-commit the transaction early).
 */
export function tx<T>(db: IDBDatabase, stores: StoreName[], mode: IDBTransactionMode,
                      body: (s: Record<string, IDBObjectStore>, t: IDBTransaction) => T | Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(stores, mode);
    const map: Record<string, IDBObjectStore> = {};
    for (const n of stores) map[n] = t.objectStore(n);
    let result: T;
    let failed: unknown = null;
    t.oncomplete = () => (failed ? reject(failed) : resolve(result));
    t.onabort = () => reject(failed ?? t.error ?? new Error('transaction aborted'));
    t.onerror = () => { /* surfaced via onabort */ };
    Promise.resolve()
      .then(() => body(map, t))
      .then((r) => { result = r; })
      .catch((e: unknown) => { failed = e; try { t.abort(); } catch { /* already finished */ } });
  });
}
