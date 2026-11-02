// GitHub REST v3 transport (§11.1 option a, D8): a private data repo and a fine-grained PAT
// scoped to that one repo with Contents read/write.
//
// - list: GET /git/trees/HEAD?recursive=1 (one request; an empty repo answers 409 → []).
// - get:  GET /contents/{path} (base64 JSON); files over 1 MB come back without content and are
//         read through GET /git/blobs/{sha}.
// - put:  PUT /contents/{path} with the base64 body and, for an update, the sha it was read at.
// fetch and the clock are injected (no globals), and the token is never put in an error.

import { base64ToUtf8, utf8ToBase64 } from '../base64.ts';
import { SyncError } from '../errors.ts';
import type { RemoteEntry, RemoteFile, SyncTransport } from '../types.ts';

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; cache?: 'no-store' }) => Promise<{
  status: number; headers: { get(name: string): string | null }; text(): Promise<string>;
}>;

export interface GithubOptions {
  owner: string;
  repo: string;
  token: string;
  fetch: FetchLike;
  now: () => number;
  apiBase?: string;
}

export interface RepoInfo { fullName: string; private: boolean; defaultBranch: string }

export interface GithubTransport extends SyncTransport {
  repoInfo(): Promise<RepoInfo>;
  /** Last rate-limit headers seen. */
  rate(): { remaining?: number; resetAt?: number };
}

/** "owner/name", a github.com URL, or "owner/name.git" → { owner, repo }; null if unusable. */
export function parseRepo(input: string): { owner: string; repo: string } | null {
  const s = input.trim().replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/^git@github\.com:/i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  const m = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/.exec(s);
  return m ? { owner: m[1]!, repo: m[2]! } : null;
}

const encPath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

export function githubTransport(o: GithubOptions): GithubTransport {
  const api = (o.apiBase ?? 'https://api.github.com').replace(/\/+$/, '');
  const repoUrl = `${api}/repos/${encodeURIComponent(o.owner)}/${encodeURIComponent(o.repo)}`;
  const repoName = `${o.owner}/${o.repo}`;
  const rate: { remaining?: number; resetAt?: number } = {};

  interface Res { status: number; body: unknown }

  async function request(method: 'GET' | 'PUT', url: string, body?: unknown, allow: number[] = []): Promise<Res> {
    if (rate.remaining === 0 && rate.resetAt !== undefined && o.now() < rate.resetAt) {
      throw new SyncError('rate-limited', `GitHub rate limit reached; resets at ${new Date(rate.resetAt).toISOString()}`, { resetAt: rate.resetAt });
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${o.token}`, Accept: 'application/vnd.github+json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await o.fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
    } catch (e) {
      throw new SyncError('network', `Couldn't reach GitHub (${e instanceof Error ? e.message : 'network error'})`);
    }
    const rem = res.headers.get('x-ratelimit-remaining');
    const reset = res.headers.get('x-ratelimit-reset');
    if (rem !== null && rem !== '' && Number.isFinite(Number(rem))) rate.remaining = Number(rem);
    if (reset !== null && reset !== '' && Number.isFinite(Number(reset))) rate.resetAt = Number(reset) * 1000;
    const text = await res.text().catch(() => '');
    let parsed: unknown = null;
    if (text) { try { parsed = JSON.parse(text); } catch { parsed = null; } }
    const s = res.status;
    if (s >= 200 && s < 300) return { status: s, body: parsed };
    if (allow.includes(s)) return { status: s, body: parsed };
    const msg = typeof parsed === 'object' && parsed !== null && typeof (parsed as { message?: unknown }).message === 'string'
      ? (parsed as { message: string }).message : `HTTP ${s}`;
    const retryAfter = Number(res.headers.get('retry-after'));
    if (s === 429 || (s === 403 && (rem === '0' || /rate limit/i.test(msg) || retryAfter > 0))) {
      const resetAt = retryAfter > 0 ? o.now() + retryAfter * 1000 : rate.resetAt;
      throw new SyncError('rate-limited', `GitHub rate limit: ${msg}`, { status: s, resetAt });
    }
    if (s === 401) throw new SyncError('bad-token', `GitHub rejected the token (${msg})`, { status: s });
    if (s === 403) throw new SyncError('no-access', `The token can't ${method === 'PUT' ? 'write to' : 'read'} ${repoName} (${msg})`, { status: s });
    if (s === 404) throw new SyncError('repo-missing', `${repoName} not found, or the token can't see it`, { status: s });
    if (s === 409) throw new SyncError('conflict', `Write conflict (${msg})`, { status: s });
    if (s === 422) {
      if (/sha/i.test(msg)) throw new SyncError('conflict', `Write conflict (${msg.replace(/\s+/g, ' ')})`, { status: s });
      throw new SyncError('invalid', `GitHub refused the request (${msg.replace(/\s+/g, ' ')})`, { status: s });
    }
    if (s >= 500) throw new SyncError('server', `GitHub is having trouble (HTTP ${s})`, { status: s });
    throw new SyncError('invalid', `Unexpected GitHub response (HTTP ${s}: ${msg})`, { status: s });
  }

  const asObj = (x: unknown): Record<string, unknown> => {
    if (typeof x !== 'object' || x === null || Array.isArray(x)) throw new SyncError('invalid', 'Unexpected GitHub response shape');
    return x as Record<string, unknown>;
  };

  async function walk(dir: string, out: RemoteEntry[]): Promise<void> {
    const r = await request('GET', `${repoUrl}/contents/${encPath(dir)}`, undefined, [404]);
    if (r.status === 404 || !Array.isArray(r.body)) return;
    for (const raw of r.body as unknown[]) {
      const e = asObj(raw);
      if (e.type === 'dir' && typeof e.path === 'string') await walk(e.path, out);
      else if (e.type === 'file' && typeof e.path === 'string' && typeof e.sha === 'string') out.push({ path: e.path, sha: e.sha, size: typeof e.size === 'number' ? e.size : undefined });
    }
  }

  return {
    kind: 'github',
    rate: () => ({ ...rate }),

    async repoInfo() {
      const b = asObj((await request('GET', repoUrl)).body);
      return { fullName: String(b.full_name ?? repoName), private: b.private === true, defaultBranch: String(b.default_branch ?? 'main') };
    },

    async list(prefix) {
      const pre = prefix.endsWith('/') ? prefix : `${prefix}/`;
      const r = await request('GET', `${repoUrl}/git/trees/HEAD?recursive=1`, undefined, [409]);
      if (r.status === 409) return []; // "Git Repository is empty."
      const b = asObj(r.body);
      if (b.truncated === true) {
        // Over the tree API's limit: walk the directory instead (one request per directory).
        const out: RemoteEntry[] = [];
        await walk(prefix.replace(/\/+$/, ''), out);
        return out.filter((e) => e.path.startsWith(pre));
      }
      const tree = Array.isArray(b.tree) ? (b.tree as unknown[]) : [];
      const out: RemoteEntry[] = [];
      for (const raw of tree) {
        const e = asObj(raw);
        if (e.type === 'blob' && typeof e.path === 'string' && typeof e.sha === 'string' && e.path.startsWith(pre)) {
          out.push({ path: e.path, sha: e.sha, size: typeof e.size === 'number' ? e.size : undefined });
        }
      }
      return out.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
    },

    async get(path): Promise<RemoteFile | null> {
      const r = await request('GET', `${repoUrl}/contents/${encPath(path)}`, undefined, [404]);
      if (r.status === 404) return null;
      const b = asObj(r.body);
      if (b.type !== 'file' || typeof b.sha !== 'string') throw new SyncError('invalid', `${path} is not a file`);
      if (b.encoding === 'base64' && typeof b.content === 'string' && (b.content !== '' || b.size === 0)) {
        return { path, sha: b.sha, content: base64ToUtf8(b.content) };
      }
      // > 1 MB: the contents API omits the body; the blob API serves up to 100 MB.
      const blob = asObj((await request('GET', `${repoUrl}/git/blobs/${encodeURIComponent(b.sha)}`)).body);
      if (typeof blob.content !== 'string') throw new SyncError('invalid', `${path}: blob without content`);
      return { path, sha: b.sha, content: blob.encoding === 'base64' ? base64ToUtf8(blob.content) : blob.content };
    },

    async put(path, content, sha, message) {
      const body: Record<string, string> = { message, content: utf8ToBase64(content) };
      if (sha !== null) body.sha = sha;
      const r = asObj((await request('PUT', `${repoUrl}/contents/${encPath(path)}`, body)).body);
      const c = asObj(r.content);
      if (typeof c.sha !== 'string') throw new SyncError('invalid', 'PUT response without a sha');
      const commit = typeof r.commit === 'object' && r.commit !== null ? (r.commit as Record<string, unknown>) : {};
      const committer = typeof commit.committer === 'object' && commit.committer !== null ? (commit.committer as Record<string, unknown>) : {};
      const t = typeof committer.date === 'string' ? Date.parse(committer.date) : NaN;
      return Number.isFinite(t) ? { sha: c.sha, serverTime: t } : { sha: c.sha };
    },
  };
}
