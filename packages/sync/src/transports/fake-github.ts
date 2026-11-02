// A fake api.github.com over a MemoryRemote, speaking the REST v3 subset the GitHub transport
// uses. Used as an injected `fetch` in unit tests and behind Playwright route interception in
// the e2e tests (two browser contexts sharing one remote). No @ksrs imports.
//
//   GET  /repos/{o}/{r}                               repo info
//   GET  /repos/{o}/{r}/git/trees/HEAD?recursive=1    409 "Git Repository is empty." when empty
//   GET  /repos/{o}/{r}/contents/{path}               file (base64) or directory listing; 404
//   PUT  /repos/{o}/{r}/contents/{path}               create/update; 409 stale sha, 422 missing sha
//   GET  /repos/{o}/{r}/git/blobs/{sha}
// Auth: `Authorization: Bearer <token>`; anything else is 401 "Bad credentials".

import { base64ToUtf8, utf8ToBase64 } from '../base64.ts';
import { isSyncError } from '../errors.ts';
import type { MemoryRemote, RemoteOp } from './memory.ts';

export interface FakeGithubOptions {
  owner: string;
  repo: string;
  /** The one token that works. */
  token: string;
  /** Token may read but not write (fine-grained token with Contents: read-only) → PUT 403. */
  readOnly?: boolean;
  /** Rate limit remaining reported in headers (default 4999). */
  rateRemaining?: () => number;
}

export interface FakeRequest { method: string; url: string; headers: Record<string, string>; body?: string | null }
export interface FakeResponse { status: number; headers: Record<string, string>; body: string }

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'Authorization, Content-Type, Accept, X-GitHub-Api-Version',
  'access-control-allow-methods': 'GET, PUT, OPTIONS',
  'access-control-expose-headers': 'ETag, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-RateLimit-Used, X-RateLimit-Resource, Retry-After',
};

const wrap64 = (s: string) => s.replace(/.{1,60}/g, (m) => `${m}\n`);

export function createFakeGithub(remote: MemoryRemote, opts: FakeGithubOptions) {
  const json = (status: number, body: unknown, extra: Record<string, string> = {}): FakeResponse => ({
    status,
    headers: {
      ...CORS, 'content-type': 'application/json; charset=utf-8',
      'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': String(opts.rateRemaining?.() ?? 4999), 'x-ratelimit-reset': '1999999999',
      ...extra,
    },
    body: JSON.stringify(body),
  });
  const notFound = () => json(404, { message: 'Not Found', documentation_url: 'https://docs.github.com/rest', status: '404' });
  const log = (op: RemoteOp, path: string, ok: boolean) => remote.requests.push({ op, path, ok });

  /** Injected failures become the HTTP status a real server would send. */
  const injected = (op: RemoteOp, path: string): FakeResponse | null => {
    try { remote.check(op, path); return null; } catch (e) {
      if (!isSyncError(e)) throw e;
      const status = e.status ?? ({ 'bad-token': 401, 'no-access': 403, 'repo-missing': 404, conflict: 409, 'rate-limited': 403, server: 502 } as Record<string, number>)[e.code] ?? 500;
      if (e.code === 'rate-limited') return json(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0' });
      if (e.code === 'network') throw new TypeError('Failed to fetch');
      return json(status, { message: e.message });
    }
  };

  function handle(req: FakeRequest): FakeResponse {
    const method = req.method.toUpperCase();
    if (method === 'OPTIONS') return { status: 204, headers: { ...CORS }, body: '' };
    const auth = Object.entries(req.headers).find(([k]) => k.toLowerCase() === 'authorization')?.[1];
    if (auth !== `Bearer ${opts.token}`) return json(401, { message: 'Bad credentials', documentation_url: 'https://docs.github.com/rest', status: '401' });

    const u = new URL(req.url);
    const base = `/repos/${opts.owner}/${opts.repo}`;
    if (!u.pathname.startsWith(base)) return notFound();
    const rest = u.pathname.slice(base.length);

    if (rest === '' && method === 'GET') {
      return json(200, { full_name: `${opts.owner}/${opts.repo}`, private: true, default_branch: 'main', permissions: { pull: true, push: !opts.readOnly } });
    }
    if (rest === '/git/trees/HEAD' && method === 'GET') {
      const fail = injected('list', ''); if (fail) return fail;
      log('list', '', true);
      if (remote.files.size === 0) return json(409, { message: 'Git Repository is empty.' });
      const dirs = new Set<string>();
      const tree: { path: string; mode: string; type: string; sha: string; size?: number }[] = [];
      for (const e of remote.list('')) {
        const parts = e.path.split('/');
        for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
        tree.push({ path: e.path, mode: '100644', type: 'blob', sha: e.sha, size: e.size });
      }
      for (const d of dirs) tree.push({ path: d, mode: '040000', type: 'tree', sha: `tree-${d}` });
      tree.sort((a, b) => (a.path < b.path ? -1 : 1));
      return json(200, { sha: `c${remote.commits}`, tree, truncated: false });
    }
    if (rest.startsWith('/git/blobs/') && method === 'GET') {
      const sha = rest.slice('/git/blobs/'.length);
      const content = remote.readBlob(sha);
      if (content === null) return notFound();
      return json(200, { sha, size: content.length, encoding: 'base64', content: wrap64(utf8ToBase64(content)) });
    }
    if (rest.startsWith('/contents/')) {
      const path = rest.slice('/contents/'.length).split('/').map(decodeURIComponent).join('/');
      if (method === 'GET') {
        const fail = injected('get', path); if (fail) return fail;
        const f = remote.read(path);
        log('get', path, true);
        if (f) {
          return json(200, { type: 'file', encoding: 'base64', size: f.content.length, name: path.split('/').pop(), path, sha: f.sha, content: wrap64(utf8ToBase64(f.content)) });
        }
        const kids = remote.list(path);
        if (!kids.length) return notFound();
        const seen = new Map<string, { type: string; sha: string; path: string; name: string }>();
        for (const k of kids) {
          const name = k.path.slice(path.length + 1).split('/')[0]!;
          const isDir = k.path.slice(path.length + 1).includes('/');
          if (!seen.has(name)) seen.set(name, { type: isDir ? 'dir' : 'file', sha: isDir ? `tree-${path}/${name}` : k.sha, path: `${path}/${name}`, name });
        }
        return json(200, [...seen.values()]);
      }
      if (method === 'PUT') {
        if (opts.readOnly) return json(403, { message: 'Resource not accessible by personal access token' });
        const fail = injected('put', path); if (fail) return fail;
        let body: { message?: unknown; content?: unknown; sha?: unknown };
        try { body = JSON.parse(req.body ?? '') as typeof body; } catch { return json(400, { message: 'Problems parsing JSON' }); }
        if (typeof body.message !== 'string' || typeof body.content !== 'string') return json(422, { message: 'Invalid request.\n\n"message", "content" are required.' });
        const sha = typeof body.sha === 'string' ? body.sha : null;
        const existed = remote.files.has(path);
        try {
          const r = remote.write(path, base64ToUtf8(body.content), sha);
          log('put', path, true);
          const date = r.serverTime === undefined ? undefined : new Date(Math.floor(r.serverTime / 1000) * 1000).toISOString().replace('.000Z', 'Z');
          return json(existed ? 200 : 201, {
            content: { name: path.split('/').pop(), path, sha: r.sha, type: 'file' },
            commit: { sha: `c${remote.commits}`, message: body.message, ...(date ? { committer: { date }, author: { date } } : {}) },
          });
        } catch (e) {
          log('put', path, false);
          if (isSyncError(e) && e.code === 'conflict') {
            return sha === null
              ? json(422, { message: 'Invalid request.\n\n"sha" wasn\'t supplied.', status: '422' })
              : json(409, { message: `${path} does not match ${sha}`, status: '409' });
          }
          throw e;
        }
      }
    }
    return notFound();
  }

  /** `handle` as a fetch implementation (unit tests). */
  const fetchImpl = async (input: string | URL | { url: string }, init?: { method?: string; headers?: Record<string, string> | Headers; body?: unknown }): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    const h = init?.headers;
    if (typeof Headers !== 'undefined' && h instanceof Headers) h.forEach((v, k) => { headers[k] = v; });
    else if (h) Object.assign(headers, h);
    const r = handle({ method: init?.method ?? 'GET', url, headers, body: typeof init?.body === 'string' ? init.body : null });
    return new Response(r.status === 204 ? null : r.body, { status: r.status, headers: r.headers });
  };

  return { handle, fetch: fetchImpl };
}
