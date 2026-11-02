// Typed sync failures (§11). Transports translate HTTP status codes into these so the app can
// show a plain-English fix without knowing which transport is in use. No dependencies: the
// fake GitHub (fake-github.ts) imports this too and is loaded directly by the e2e tests.

export type SyncErrorCode =
  | 'bad-token'     // 401: token wrong, expired or revoked
  | 'no-access'     // 403: token can't read/write this repo (not granted, or Contents not read/write)
  | 'repo-missing'  // 404 on the repo: wrong name, or the token can't see it
  | 'conflict'      // 409/422 sha mismatch on write (retried by syncOnce)
  | 'rate-limited'  // primary or secondary rate limit; `resetAt` says when to try again
  | 'network'       // fetch failed (offline, DNS, CSP)
  | 'server'        // 5xx
  | 'invalid'       // unexpected response or request rejected for another reason
  | 'newer-format'; // the remote was written by a newer app (manifest version)

export class SyncError extends Error {
  readonly code: SyncErrorCode;
  readonly status: number | undefined;
  /** Epoch ms when a rate limit resets (rate-limited only). */
  readonly resetAt: number | undefined;
  constructor(code: SyncErrorCode, message: string, opts: { status?: number; resetAt?: number } = {}) {
    super(message);
    this.name = 'SyncError';
    this.code = code;
    this.status = opts.status;
    this.resetAt = opts.resetAt;
  }
}

export const isSyncError = (e: unknown): e is SyncError =>
  e instanceof SyncError || (typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'SyncError'
    && typeof (e as { code?: unknown }).code === 'string');

export const isConflict = (e: unknown): boolean => isSyncError(e) && e.code === 'conflict';
