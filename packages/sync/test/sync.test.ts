// M6 sync scenarios over the in-memory fake GitHub (and, at the end, the GitHub transport
// against the fake GitHub HTTP API): convergence, undo/override/notes under sync, settings and
// ext data, conflicts, truncation, quarantine and idempotence.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMasterList, extPayload, MASTER_EXT_BASELINE, readMasterExt, sessionKey, settingPayload, variantsInbox,
  type AppEvent, type EventPayload,
} from '@ksrs/srs-engine';
import {
  createFakeGithub, devicePath, githubTransport, manifestPath, MemoryRemote, memoryTransport, segmentPath, SyncError,
  type SyncTransport,
} from '../src/index.ts';
import { answerP, lessonP } from '../../srs-engine/test/fixtures.ts';
import { canon, Device, ids, T0 } from './harness.ts';

const H = 3_600_000;
const MIN = 60_000;

/** Lessons for a few fixture items, at the device's current time. */
const learn = (d: Device, items = ['v:결정', 'v:망설이다', 'v:덤']) => d.emit(...items.map(lessonP));

/** One review of an item at its due time on that device: all required qtypes, optionally a miss first. */
function review(d: Device, itemId: string, miss = false): AppEvent[] {
  const st = d.derived().items.get(itemId);
  assert.ok(st && st.availableAt !== null, `${itemId} has a due time on ${d.id}`);
  if (d.t < st.availableAt) d.t = st.availableAt + MIN;
  const req = ['meaning', 'production'] as const;
  const out: AppEvent[] = [];
  if (miss) out.push(...d.emit(answerP(itemId, 'meaning', 'incorrect', [...req])));
  for (const q of req) out.push(...d.emit(answerP(itemId, q, 'correct', [...req])));
  return out;
}

function converged(...ds: Device[]): void {
  const first = canon(ds[0]!.derived());
  for (const d of ds.slice(1)) {
    assert.equal(ids(d), ids(ds[0]!), `${d.id} has the same events as ${ds[0]!.id}`);
    assert.equal(canon(d.derived()), first, `${d.id} projection equals ${ds[0]!.id}`);
  }
}

/** Every event line on the remote, by id, must be unique per file. */
function remoteLines(remote: MemoryRemote): AppEvent[] {
  const out: AppEvent[] = [];
  for (const [path, f] of remote.files) {
    if (!path.includes('/log/')) continue;
    const seen = new Set<string>();
    for (const l of f.content.split('\n').filter(Boolean)) {
      const e = JSON.parse(l) as AppEvent;
      assert.ok(!seen.has(e.id), `duplicate ${e.id} in ${path}`);
      seen.add(e.id);
      out.push(e);
    }
  }
  return out;
}

function pair() {
  const remote = new MemoryRemote();
  const tr = memoryTransport(remote);
  return { remote, tr, A: new Device('aaaa1111'), B: new Device('bbbb2222') };
}

describe('two and three devices converge', () => {
  for (const order of [['A', 'B', 'A'], ['B', 'A', 'B'], ['A', 'B', 'B', 'A']]) {
    test(`offline reviews on both, then sync ${order.join('→')}`, async () => {
      const { tr, A, B, remote } = pair();
      learn(A); await A.sync(tr); await B.sync(tr); // shared history
      // Offline: both review the same due items; A clean, B misses meaning on two.
      A.advance(5 * H); B.advance(5 * H);
      for (const id of ['v:결정', 'v:망설이다', 'v:덤']) review(A, id);
      review(B, 'v:결정', true); review(B, 'v:망설이다', true);
      B.emit({ type: 'note.set', itemId: 'v:덤', field: 'meaning', text: 'bonus' });
      assert.notEqual(canon(A.derived()), canon(B.derived()));
      const dev = { A, B } as Record<string, Device>;
      for (const k of order) await dev[k]!.sync(tr);
      converged(A, B);
      assert.equal(remoteLines(remote).length, A.store.events.size);
      // Dueness gate (D5): the first review by HLC wins; the other device's duplicate is ignoredEarly.
      assert.equal(A.derived().items.get('v:덤')!.stage, 2);
    });
  }

  test('three devices sync in different orders → identical projections', async () => {
    const remote = new MemoryRemote();
    const tr = memoryTransport(remote);
    const A = new Device('aaaa1111');
    const B = new Device('bbbb2222', { skewMs: -7 * MIN }); // B's clock runs 7 min slow
    const C = new Device('cccc3333', { skewMs: 3 * MIN });
    learn(A, ['v:결정', 'v:결제']); learn(B, ['v:결재', 'v:베개']); learn(C, ['v:덤']);
    await C.sync(tr); await A.sync(tr);
    for (const d of [A, B, C]) d.advance(5 * H);
    review(A, 'v:결정'); review(B, 'v:결재', true); review(C, 'v:덤');
    await B.sync(tr); await C.sync(tr); await A.sync(tr); await B.sync(tr); await C.sync(tr);
    converged(A, B, C);
    assert.deepEqual([...A.derived().items.keys()].filter((k) => A.derived().items.get(k)!.lessonAt !== undefined).sort(),
      ['v:결재', 'v:결정', 'v:결제', 'v:덤', 'v:베개']);
  });
});

describe('undo, overrides and notes under sync (§6.2)', () => {
  test('undo on one device after the answer already synced elsewhere', async () => {
    const { tr, A, B } = pair();
    learn(A); A.advance(5 * H);
    const wrong = A.emit(answerP('v:결정', 'meaning', 'incorrect', ['meaning', 'production']))[0]!;
    await A.sync(tr); await B.sync(tr);
    assert.equal(B.derived().items.get('v:결정')!.pending?.incorrect, 1);
    A.emit({ type: 'event.void', targetId: wrong.id, reason: 'undo' });
    await A.sync(tr); await B.sync(tr);
    converged(A, B);
    assert.ok(!B.derived().items.get('v:결정')!.pending?.incorrect, 'the voided miss is gone on B');
  });

  test('"I was right" override plus "accept this answer in future"', async () => {
    const { tr, A, B } = pair();
    learn(A); await A.sync(tr); await B.sync(tr);
    A.advance(5 * H); B.advance(5 * H);
    const wrong = A.emit(answerP('v:결정', 'meaning', 'incorrect', ['meaning', 'production'], { response: 'resolution' }))[0]!;
    A.emit(
      answerP('v:결정', 'meaning', 'correct', ['meaning', 'production'], { response: 'resolution', selfGraded: true, overrides: wrong.id } as never),
      { type: 'userAnswer.add', itemId: 'v:결정', qtype: 'meaning', answer: 'resolution' },
      answerP('v:결정', 'production', 'correct', ['meaning', 'production']),
    );
    await A.sync(tr); await B.sync(tr);
    converged(A, B);
    const st = B.derived().items.get('v:결정')!;
    assert.equal(st.stage, 2, 'the override counts as a clean pass');
    assert.deepEqual([...B.derived().userAnswers.values()].flat(), ['resolution']);
  });

  test('LWW note edits on both devices; HLC observation lets a slow clock still win later', async () => {
    const remote = new MemoryRemote();
    const tr = memoryTransport(remote);
    const A = new Device('aaaa1111', { skewMs: 2 * H }); // A's clock is 2 h fast
    const B = new Device('bbbb2222');
    A.emit({ type: 'note.set', itemId: 'v:결정', field: 'mnemonic', text: 'from A' });
    B.emit({ type: 'note.set', itemId: 'v:결정', field: 'mnemonic', text: 'from B (offline, earlier HLC)' });
    await A.sync(tr); await B.sync(tr); await A.sync(tr);
    converged(A, B);
    assert.equal(A.derived().notes.get('v:결정#mnemonic'), 'from A');
    // B has now observed A's HLC, so B's next edit sorts after it even though B's wall clock is behind.
    B.advance(MIN);
    B.emit({ type: 'note.set', itemId: 'v:결정', field: 'mnemonic', text: 'from B, after syncing' });
    await B.sync(tr); await A.sync(tr);
    converged(A, B);
    assert.equal(A.derived().notes.get('v:결정#mnemonic'), 'from B, after syncing');
  });
});

describe('settings and ext data travel as events', () => {
  test('ext.* keys, srs settings and inbox dismissals', async () => {
    const { tr, A, B } = pair();
    learn(A); A.advance(5 * H);
    const v = A.emit(answerP('v:결정', 'meaning', 'correct', ['meaning', 'production'], { response: 'determination', check: { layer: 'variant', closeAttempts: 0 } } as never))[0]!;
    A.emit(extPayload('ext.anything', { n: 1 }), settingPayload('tts.rate', 1.2), { type: 'settings.set', key: 'lessonBatch', value: 8 });
    await A.sync(tr); await B.sync(tr);
    assert.equal(variantsInbox(B.derived(), B.log()).length, 1, 'B sees the variant');
    B.emit(settingPayload('inbox.dismissed', [v.id]));
    await B.sync(tr); await A.sync(tr);
    converged(A, B);
    const d = A.derived();
    assert.deepEqual(d.ext.get('ext.anything'), { n: 1 });
    assert.equal(d.settings['tts.rate'], 1.2);
    assert.equal(d.settings.lessonBatch, 8);
    assert.equal(variantsInbox(d, A.log()).length, 0, 'dismissal synced to A');
  });

  test('master list: baseline + the same session block recorded on two devices is counted once (D61)', async () => {
    const { tr, A, B } = pair();
    const baseline = { v: 1, enc: 'none', data: 'word,meaning\r\n' };
    A.emit(extPayload(MASTER_EXT_BASELINE, baseline));
    const block = (recordedAt: number) => ({
      v: 1, hash: 'f'.repeat(64), source: 'convo', recordedAt,
      rows: [{ word: '끼다', missed: 3, seen: 1, status: 'learning' }],
    });
    // Both devices paste the same SESSION LOG block offline: same hash → same ext key.
    A.emit(extPayload(sessionKey('f'.repeat(64)), block(A.t)));
    B.advance(10 * MIN);
    B.emit(extPayload(sessionKey('f'.repeat(64)), block(B.t)));
    await A.sync(tr); await B.sync(tr); await A.sync(tr);
    converged(A, B);
    const m = readMasterExt(A.derived());
    assert.equal(m.sessions.length, 1);
    const row = buildMasterList({ baseline: [], app: [], sessions: m.sessions }).find((r) => r.word === '끼다');
    assert.equal(row?.times_missed, 3, 'not 6');
    assert.deepEqual(A.derived().ext.get(MASTER_EXT_BASELINE), baseline);
  });

  test('concurrent inbox dismissals on two devices are both kept (grow-only set)', async () => {
    const { tr, A, B } = pair();
    A.emit(settingPayload('inbox.dismissed', ['x']));
    B.advance(MIN);
    B.emit(settingPayload('inbox.dismissed', ['y']));
    await A.sync(tr); await B.sync(tr); await A.sync(tr);
    converged(A, B);
    assert.deepEqual(A.derived().settings['inbox.dismissed'], ['x', 'y']);
  });
});

describe('robustness', () => {
  test('layout: manifest, device file, weekly segment; repeat sync is a no-op (idempotent)', async () => {
    const { tr, A, B, remote } = pair();
    learn(A);
    const r1 = await A.sync(tr);
    assert.equal(r1.pushed, 3);
    assert.ok(remote.files.has(manifestPath()));
    assert.ok(remote.files.has(devicePath('aaaa1111')));
    assert.ok(remote.files.has('ksrs/v1/log/aaaa1111/2026-W44.jsonl'));
    assert.equal(segmentPath('aaaa1111', A.t), 'ksrs/v1/log/aaaa1111/2026-W44.jsonl');
    assert.equal(JSON.parse(remote.files.get(devicePath('aaaa1111'))!.content).name, 'aaaa1111');
    await B.sync(tr);
    const before = remote.requests.length;
    const commits = remote.commits;
    const r2 = await A.sync(tr);
    const r3 = await B.sync(tr);
    assert.equal(remote.commits, commits, 'no writes');
    assert.equal(remote.requests.length - before, 2, 'one listing each');
    for (const r of [r2, r3]) { assert.equal(r.pushed + r.added + r.writes + r.segmentsRead, 0); }
    converged(A, B);
  });

  test('sha conflict (another tab wrote the same segment) → re-read, union, retry', async () => {
    const { tr, A, B, remote } = pair();
    learn(A);
    // A second tab of A pushes a different event first (same device, same weekly file).
    const tab2 = new Device('aaaa1111'); tab2.advance(1);
    const other = tab2.emit(lessonP('v:베개'))[0]!;
    let raced = false;
    remote.beforePut = (path) => {
      if (raced || !path.includes('/log/aaaa1111/')) return;
      raced = true;
      remote.poke(path, `${JSON.stringify(other)}\n`);
    };
    const r = await A.sync(tr);
    assert.equal(r.retries, 1);
    const lines = remoteLines(remote).map((e) => e.id).sort();
    assert.deepEqual(lines, [...A.store.events.keys(), other.id].sort());
    // B pulls A's file, including the other tab's line (two tabs share one IndexedDB, so A has it locally too).
    await B.sync(tr);
    assert.ok(B.store.events.has(other.id));
  });

  test('conflicts on every attempt → typed error; nothing marked pushed; next sync recovers', async () => {
    const { tr, A, remote } = pair();
    learn(A);
    remote.fail({ op: 'put', path: segmentPath('aaaa1111', A.t), code: 'conflict', status: 409, times: 4 });
    await assert.rejects(A.sync(tr, { retries: 3 }), (e: unknown) => e instanceof SyncError && e.code === 'conflict');
    assert.equal(A.store.pushed.size, 0);
    const r = await A.sync(tr);
    assert.equal(r.pushed, 3);
    assert.equal(remoteLines(remote).length, 3);
  });

  test('crash between the PUT and the bookkeeping does not duplicate lines', async () => {
    const { tr, A, remote } = pair();
    learn(A);
    A.store.failMarkPushed = true;
    await assert.rejects(A.sync(tr));
    const r = await A.sync(tr);
    assert.equal(r.pushed, 0, 'already on the remote');
    assert.equal(remoteLines(remote).length, 3);
    assert.equal(A.store.pushed.size, 3);
  });

  test('a truncated last line is left unread, then read once the writer completes it', async () => {
    const { tr, A, B, remote } = pair();
    const [e1, e2, e3] = learn(B);
    const path = segmentPath('bbbb2222', B.t);
    const partial = JSON.stringify(e3).slice(0, 40);
    remote.poke(path, `${JSON.stringify(e1)}\n${JSON.stringify(e2)}\n${partial}`);
    B.store.pushed.add(e1!.id); B.store.pushed.add(e2!.id); // B thinks only e3 is unpushed
    const r = await A.sync(tr);
    assert.equal(r.added, 2);
    assert.equal(r.quarantined, 0, 'a cut-off line is not an error');
    assert.equal(A.store.state.get(path)!.lines, 2);
    await B.sync(tr); // appends e3, replacing the fragment
    assert.ok(!remote.files.get(path)!.content.includes(`${partial}\n`));
    const r2 = await A.sync(tr);
    assert.equal(r2.added, 1);
    converged(A, B);
  });

  test('future-version and malformed lines are quarantined once and never block the rest', async () => {
    const { tr, A, B, remote } = pair();
    const [e1] = learn(B, ['v:결정']);
    const future = { ...e1!, id: 'future-1', v: 2, type: 'review.rated', hlc: e1!.hlc.replace(/^\w{9}/, 'zzzzzzzzz') };
    const voidOfVoid = { ...e1!, id: 'vv', type: 'event.void', targetId: 'v0', reason: 'undo' };
    const v0 = { ...e1!, id: 'v0', type: 'event.void', targetId: e1!.id, reason: 'undo' };
    const path = segmentPath('bbbb2222', B.t);
    remote.poke(path, [JSON.stringify(e1), JSON.stringify(future), '{not json', JSON.stringify(v0), JSON.stringify(voidOfVoid)].join('\n') + '\n');
    const r = await A.sync(tr);
    assert.equal(r.received, 2);
    assert.equal(r.quarantined, 3);
    assert.deepEqual(A.store.quarantined.map((q) => q.reason).sort(), ['future version', 'malformed line', 'void of a void']);
    // The future event's HLC is not observed (it isn't applied); A's clock stays sane.
    assert.ok(!A.hlc.last().startsWith('zzz'));
    const again = await A.sync(tr);
    assert.equal(again.quarantined + again.segmentsRead, 0);
    assert.equal(A.store.quarantined.length, 3);
  });

  test('a rewritten (not appended) segment is re-read from the top without duplicates', async () => {
    const { tr, A, B, remote } = pair();
    const evs = learn(B);
    await B.sync(tr); await A.sync(tr);
    const path = segmentPath('bbbb2222', B.t);
    remote.poke(path, evs.slice().reverse().map((e) => `${JSON.stringify(e)}\n`).join(''));
    const r = await A.sync(tr);
    assert.equal(r.segmentsRead, 1);
    assert.equal(r.received, 3);
    assert.equal(r.added, 0);
    converged(A, B);
  });

  test('remote HLCs advance the local clock (a device far behind still sorts its next event last)', async () => {
    const remote = new MemoryRemote();
    const tr = memoryTransport(remote);
    const A = new Device('aaaa1111', { skewMs: 3 * 24 * H });
    const B = new Device('bbbb2222');
    const [ea] = A.emit({ type: 'settings.set', key: 'lessonBatch', value: 3 });
    await A.sync(tr); await B.sync(tr);
    const [eb] = B.emit({ type: 'settings.set', key: 'lessonBatch', value: 10 });
    assert.ok(eb!.hlc > ea!.hlc);
    await B.sync(tr); await A.sync(tr);
    converged(A, B);
    assert.equal(A.derived().settings.lessonBatch, 10);
  });

  test('a newer remote format is refused with a typed error; an injected network failure is retried next time', async () => {
    const { tr, A, remote } = pair();
    learn(A);
    remote.fail({ op: 'put', code: 'network', message: 'offline' });
    await assert.rejects(A.sync(tr), (e: unknown) => e instanceof SyncError && e.code === 'network');
    const r = await A.sync(tr);
    assert.equal(r.pushed, 3);
    remote.poke(manifestPath(), '{"format":"ksrs-sync","version":2}\n');
    await assert.rejects(A.sync(tr), (e: unknown) => e instanceof SyncError && e.code === 'newer-format');
  });

  test('events from other devices that arrived by file (manual sync) are pushed too, once', async () => {
    const { tr, A, B, remote } = pair();
    const C = new Device('cccc3333');
    const fromC = learn(C, ['v:베개']);
    await A.store.ingest([]); for (const e of fromC) A.store.events.set(e.id, e); // merged from a backup
    await A.sync(tr); await B.sync(tr);
    assert.ok(B.store.events.has(fromC[0]!.id));
    assert.equal(remoteLines(remote).filter((e) => e.id === fromC[0]!.id).length, 1);
  });
});

describe('GitHub transport against the fake GitHub API', () => {
  const OWNER = 'santiagoginger12-creator';
  const REPO = 'ksrs-data';
  const TOKEN = 'test-token-not-real';
  const make = (remote: MemoryRemote, o: { token?: string; repo?: string; readOnly?: boolean; t?: () => number } = {}): SyncTransport & { rate(): { remaining?: number } } => {
    const fake = createFakeGithub(remote, { owner: OWNER, repo: REPO, token: TOKEN, readOnly: o.readOnly });
    return githubTransport({ owner: OWNER, repo: o.repo ?? REPO, token: o.token ?? TOKEN, fetch: fake.fetch as never, now: o.t ?? (() => T0) });
  };

  test('two devices converge through the REST API (empty repo, base64, sha updates)', async () => {
    const remote = new MemoryRemote();
    remote.now = () => T0 + 90_000;
    const tr = make(remote);
    const A = new Device('aaaa1111');
    const B = new Device('bbbb2222');
    assert.deepEqual(await tr.list('ksrs/v1'), [], 'empty repo (409) lists as nothing');
    learn(A); A.emit({ type: 'note.set', itemId: 'v:결정', field: 'usage', text: '결정을 내리다 — 한국어 ✓' });
    learn(B, ['v:베개']);
    const r = await A.sync(tr);
    assert.equal(r.skewMs, -90_000, 'skew from the commit date');
    await B.sync(tr); await A.sync(tr);
    converged(A, B);
    assert.ok([...B.derived().notes.values()].includes('결정을 내리다 — 한국어 ✓'));
    const r2 = await A.sync(tr);
    assert.equal(r2.writes + r2.segmentsRead, 0);
  });

  test('typed errors: bad token, read-only token, missing repo, rate limit; the token never appears in messages', async () => {
    const remote = new MemoryRemote();
    const A = new Device('aaaa1111');
    learn(A);
    const codeOf = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { assert.ok(!String((e as Error).message).includes(TOKEN)); return (e as SyncError).code; } };
    assert.equal(await codeOf(A.sync(make(remote, { token: 'wrong-token' }))), 'bad-token');
    assert.equal(await codeOf(A.sync(make(remote, { repo: 'nope' }))), 'repo-missing');
    assert.equal(await codeOf(A.sync(make(remote, { readOnly: true }))), 'no-access');
    const tr = make(remote);
    remote.fail({ op: 'list', code: 'rate-limited' });
    assert.equal(await codeOf(A.sync(tr)), 'rate-limited');
    assert.equal((tr as unknown as { rate(): { remaining?: number } }).rate().remaining, 0);
    const before = remote.requests.length;
    assert.equal(await codeOf(A.sync(tr)), 'rate-limited', 'short-circuits until the reset time');
    assert.equal(remote.requests.length, before, 'no request was sent');
    remote.fail({ op: 'put', code: 'server', status: 502 });
    assert.equal(await codeOf(A.sync(make(remote))), 'server');
    assert.equal(await codeOf(A.sync(make(remote))), 'ok');
  });

  test('a create that races another writer (422 "sha wasn\'t supplied") is a conflict and retried', async () => {
    const remote = new MemoryRemote();
    const tr = make(remote);
    const A = new Device('aaaa1111');
    learn(A);
    const tab2 = new Device('aaaa1111'); tab2.advance(5);
    const other = tab2.emit(lessonP('v:베개'))[0]!;
    let once = false;
    remote.beforePut = (p) => { if (!once && p.includes('/log/')) { once = true; remote.poke(p, `${JSON.stringify(other)}\n`); } };
    const r = await A.sync(tr);
    assert.equal(r.retries, 1);
    assert.equal(remoteLines(remote).length, 4);
  });

  test('files over 1 MB are read through the blob API', async () => {
    const remote = new MemoryRemote();
    const fake = createFakeGithub(remote, { owner: OWNER, repo: REPO, token: TOKEN });
    const big = 'x'.repeat(10) + '\n';
    remote.poke('ksrs/v1/big.txt', big);
    // Simulate GitHub's >1 MB contents response (no inline content).
    const fetchImpl = async (url: string, init: { method: string; headers: Record<string, string> }) => {
      const res = await fake.fetch(url, init);
      if (url.includes('/contents/ksrs/v1/big.txt')) {
        const b = await res.json() as Record<string, unknown>;
        return new Response(JSON.stringify({ ...b, content: '', encoding: 'none' }), { status: 200 });
      }
      return res;
    };
    const tr = githubTransport({ owner: OWNER, repo: REPO, token: TOKEN, fetch: fetchImpl as never, now: () => T0 });
    assert.equal((await tr.get('ksrs/v1/big.txt'))!.content, big);
    assert.equal(await tr.get('ksrs/v1/missing.txt'), null);
  });
});

export type { EventPayload };
