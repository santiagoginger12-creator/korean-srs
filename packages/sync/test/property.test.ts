// Property: random interleavings of offline work, syncs (some failing mid-way, some racing a
// second tab) and clock skew always converge: after two clean rounds every device holds the
// union of all events and the same canonical projection as replaying that union, the remote has
// no duplicate lines, and a further round is a no-op.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forAll, type Gen, type Rng } from '@ksrs/test-support';
import { extPayload, replayAll, settingPayload, type AppEvent, type EventPayload } from '@ksrs/srs-engine';
import { MemoryRemote, memoryTransport, segmentPath } from '../src/index.ts';
import { answerP, FIXTURE, lessonP } from '../../srs-engine/test/fixtures.ts';
import { canon, Device, ids } from './harness.ts';

const H = 3_600_000;
const ITEMS = ['v:결정', 'v:망설이다', 'v:결제', 'v:덤', 'v:베개', 'g:는-바람에', 'x:눈코-뜰-새-없다'];
const QT: Record<string, ['meaning', 'production'] | ['meaning', 'cloze'] | ['meaning', 'nuance']> = {
  'g:는-바람에': ['meaning', 'cloze'], 'x:눈코-뜰-새-없다': ['meaning', 'nuance'],
};

type Op =
  | { k: 'work'; d: number; n: number; seed: number }
  | { k: 'wait'; d: number; ms: number }
  | { k: 'sync'; d: number; fault: 'none' | 'network' | 'conflict' | 'race' };

interface Case { devices: number; skews: number[]; ops: Op[] }

const genCase: Gen<Case> = (r, size) => {
  const devices = 2 + Math.floor(r() * 2);
  const skews = Array.from({ length: devices }, () => Math.floor((r() - 0.5) * 20) * 60_000);
  const ops: Op[] = [];
  for (let i = 0; i < 4 + size * 2; i++) {
    const d = Math.floor(r() * devices);
    const x = r();
    if (x < 0.45) ops.push({ k: 'work', d, n: 1 + Math.floor(r() * 4), seed: Math.floor(r() * 1e9) });
    else if (x < 0.65) ops.push({ k: 'wait', d, ms: [10_000, H, 4 * H, 9 * H, 30 * H][Math.floor(r() * 5)]! });
    else {
      const f = r();
      ops.push({ k: 'sync', d, fault: f < 0.7 ? 'none' : f < 0.8 ? 'network' : f < 0.9 ? 'conflict' : 'race' });
    }
  }
  return { devices, skews, ops };
};

function randomPayload(r: Rng, log: readonly AppEvent[], i: number): EventPayload {
  const pickOf = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const x = r();
  const item = pickOf(ITEMS);
  const req = QT[item] ?? ['meaning', 'production'];
  if (x < 0.2 || log.length === 0) return lessonP(item);
  if (x < 0.55) return answerP(item, pickOf(req), r() < 0.75 ? 'correct' : 'incorrect', [...req]);
  if (x < 0.62) {
    const t = log.filter((e) => e.type === 'review.answer');
    if (t.length) return { type: 'event.void', targetId: pickOf(t).id, reason: 'undo' };
  }
  if (x < 0.68) {
    const w = log.filter((e): e is AppEvent & { type: 'review.answer' } => e.type === 'review.answer' && e.grade === 'incorrect');
    if (w.length) { const t = pickOf(w); return answerP(t.itemId, t.qtype, 'correct', t.requiredQTypes, { selfGraded: true, overrides: t.id } as never); }
  }
  if (x < 0.78) return { type: 'note.set', itemId: item, field: pickOf(['meaning', 'usage', 'mnemonic'] as const), text: r() < 0.15 ? '' : `n${i}` };
  if (x < 0.83) return { type: 'settings.set', key: 'lessonBatch', value: pickOf([3, 5, 8]) };
  if (x < 0.86) return { type: 'settings.set', key: 'srs.intervals', value: r() < 0.5 ? Array(8).fill(H) : [4, 8, 24, 48, 168, 336, 720, 2880].map((h) => h * H) };
  if (x < 0.9) return extPayload(`ext.k${Math.floor(r() * 3)}`, { i });
  if (x < 0.94) return settingPayload('inbox.dismissed', [`d${i}`]);
  return { type: 'userAnswer.add', itemId: item, qtype: 'meaning', answer: pickOf(['x', 'y']) };
}

test('property: random interleavings of offline work and syncs converge', async () => {
  const cases: Case[] = [];
  forAll(genCase, (c) => { cases.push(c); }, { runs: 60, seed: 'sync-interleave', maxSize: 20 });
  for (const [ci, c] of cases.entries()) {
    const remote = new MemoryRemote();
    const tr = memoryTransport(remote);
    const devs = c.skews.map((s, i) => new Device(`dev${i}x${ci}`, { skewMs: s }));
    const all = new Map<string, AppEvent>();
    let n = 0;
    for (const op of c.ops) {
      const d = devs[op.d]!;
      if (op.k === 'wait') { d.advance(op.ms); continue; }
      if (op.k === 'work') {
        let s = op.seed;
        const r = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
        for (let j = 0; j < op.n; j++) {
          d.advance(1 + Math.floor(r() * 120_000));
          for (const e of d.emit(randomPayload(r, d.log(), n++))) all.set(e.id, e);
        }
        continue;
      }
      if (op.fault === 'network') remote.fail({ op: r0(n) ? 'get' : 'put', code: 'network' });
      if (op.fault === 'conflict') remote.fail({ op: 'put', path: segmentPath(d.id, d.t), code: 'conflict', status: 409 });
      if (op.fault === 'race') {
        // A second tab of the same device appends one of its own events just before our write.
        let done = false;
        remote.beforePut = (path) => {
          if (done || !path.includes(`/log/${d.id}/`)) return;
          done = true;
          const ev = d.emit(lessonP('v:결재'))[0]!; // the other tab's event (same IndexedDB)
          all.set(ev.id, ev);
          const cur = remote.files.get(path)?.content ?? '';
          remote.poke(path, `${cur}${JSON.stringify(ev)}\n`);
          d.store.pushed.add(ev.id);
        };
      }
      try { await d.sync(tr); } catch { /* injected failure: the next sync must recover */ }
      remote.beforePut = null;
      remote.clearFailures(); // an unused injected failure doesn't carry over
    }
    // Two clean rounds in a fixed order, then everything must agree.
    for (let round = 0; round < 2; round++) for (const d of devs) await d.sync(tr);
    const want = canon(replayAll(FIXTURE, [...all.values()]));
    for (const d of devs) {
      assert.equal(d.store.events.size, all.size, `case ${ci}: ${d.id} holds every event`);
      assert.equal(canon(d.derived()), want, `case ${ci}: ${d.id} equals replay(union)`);
      assert.equal(ids(d), ids(devs[0]!));
    }
    for (const [path, f] of remote.files) {
      if (!path.includes('/log/')) continue;
      const lines = f.content.split('\n').filter(Boolean).map((l) => (JSON.parse(l) as AppEvent).id);
      assert.equal(new Set(lines).size, lines.length, `case ${ci}: no duplicate lines in ${path}`);
    }
    const commits = remote.commits;
    for (const d of devs) { const r = await d.sync(tr); assert.equal(r.added + r.pushed, 0); }
    assert.equal(remote.commits, commits, `case ${ci}: a further round writes nothing`);
  }
});

const r0 = (n: number) => n % 2 === 0;
