// In-memory fake of the GitHub data repo, with the same semantics the GitHub transport relies
// on: content-addressed blob shas, a create that fails if the file exists, an update that fails
// if the sha is stale (409/422 → SyncError 'conflict'), and injectable failures. Shared by the
// memory transport (unit tests), the fake GitHub HTTP handler (github transport tests, e2e), and
// nothing else. No @ksrs imports, so the e2e runner can load it directly.

import { fakeBlobSha } from '../base64.ts';
import { SyncError, type SyncErrorCode } from '../errors.ts';
import type { RemoteEntry, RemoteFile, SyncTransport } from '../types.ts';

export type RemoteOp = 'list' | 'get' | 'put';

export interface InjectedFailure {
  op: RemoteOp | 'any';
  /** Only for this path (put/get); default any path. */
  path?: string;
  code: SyncErrorCode;
  status?: number;
  message?: string;
  /** How many requests to fail (default 1). */
  times?: number;
}

export interface RemoteRequest { op: RemoteOp; path: string; ok: boolean }

export class MemoryRemote {
  readonly files = new Map<string, { content: string; sha: string }>();
  /** Every request, in order (tests assert idempotence and "Disable stops syncing" with it). */
  readonly requests: RemoteRequest[] = [];
  private failures: InjectedFailure[] = [];
  commits = 0;
  /**
   * Called just before a write is applied: lets a test simulate another writer (a second tab)
   * racing this one, e.g. by writing the same path so this write's sha goes stale.
   */
  beforePut: ((path: string) => void) | null = null;
  /** Server clock (ms) reported on writes, like a commit date; unset → not reported. */
  now: (() => number) | null = null;

  fail(f: InjectedFailure): void { this.failures.push({ times: 1, ...f }); }
  clearFailures(): void { this.failures = []; }

  /** Throws the first matching injected failure (and uses it up). */
  check(op: RemoteOp, path: string): void {
    const i = this.failures.findIndex((f) => (f.op === 'any' || f.op === op) && (f.path === undefined || f.path === path));
    if (i < 0) return;
    const f = this.failures[i]!;
    f.times = (f.times ?? 1) - 1;
    if (f.times <= 0) this.failures.splice(i, 1);
    this.requests.push({ op, path, ok: false });
    throw new SyncError(f.code, f.message ?? `injected ${f.code}`, { status: f.status });
  }

  list(prefix: string): RemoteEntry[] {
    const pre = prefix === '' || prefix.endsWith('/') ? prefix : `${prefix}/`;
    return [...this.files].filter(([p]) => p.startsWith(pre)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([path, f]) => ({ path, sha: f.sha, size: f.content.length }));
  }

  read(path: string): RemoteFile | null {
    const f = this.files.get(path);
    return f ? { path, sha: f.sha, content: f.content } : null;
  }

  readBlob(sha: string): string | null {
    for (const f of this.files.values()) if (f.sha === sha) return f.content;
    return null;
  }

  /** Same rules as PUT /contents: create needs no existing file; update needs the current sha. */
  write(path: string, content: string, sha: string | null): { sha: string; serverTime?: number } {
    this.beforePut?.(path);
    const cur = this.files.get(path);
    if (sha === null && cur) throw new SyncError('conflict', `"sha" wasn't supplied (${path} exists)`, { status: 422 });
    if (sha !== null && !cur) throw new SyncError('conflict', `${path} does not exist`, { status: 409 });
    if (sha !== null && cur && cur.sha !== sha) throw new SyncError('conflict', `${path} does not match ${sha}`, { status: 409 });
    const next = fakeBlobSha(content);
    this.files.set(path, { content, sha: next });
    this.commits++;
    const t = this.now?.();
    return t === undefined ? { sha: next } : { sha: next, serverTime: t };
  }

  /** Test helper: write directly, bypassing sha checks and failures (a hand edit on github.com). */
  poke(path: string, content: string): void {
    this.files.set(path, { content, sha: fakeBlobSha(content) });
    this.commits++;
  }

  count(op?: RemoteOp): number { return op ? this.requests.filter((r) => r.op === op).length : this.requests.length; }
}

/** SyncTransport straight over a MemoryRemote (no HTTP). */
export function memoryTransport(remote: MemoryRemote): SyncTransport {
  const log = (op: RemoteOp, path: string) => remote.requests.push({ op, path, ok: true });
  return {
    kind: 'memory',
    async list(prefix) { remote.check('list', prefix); log('list', prefix); return remote.list(prefix); },
    async get(path) { remote.check('get', path); log('get', path); return remote.read(path); },
    async put(path, content, sha) {
      remote.check('put', path);
      try { const r = remote.write(path, content, sha); log('put', path); return r; }
      catch (e) { remote.requests.push({ op: 'put', path, ok: false }); throw e; }
    },
  };
}
