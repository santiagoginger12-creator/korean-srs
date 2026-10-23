import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuestions, emptySession, replayAll, sessionReducer, type AppEvent, type ReviewSession, type SessionAction, type StartItem } from '@ksrs/srs-engine';
import { compactSession, reviveSession, toSnapshot } from '../src/state/snapshot.ts';
import { fakeFactory, seedBundle } from './helpers.ts';

function startSession() {
  const content = seedBundle();
  const f = fakeFactory();
  const state = replayAll(content, []);
  const items: StartItem[] = content.items.filter((i) => i.kind !== 'hanja')
    .map((it) => ({ itemId: it.id, instances: buildQuestions(it, state, state.settings.enabledQTypes, 's') }));
  const ctx = { mkEvent: f.mk };
  let sess = sessionReducer(emptySession(), { type: 'start', ctx, items, seed: 's' }).sess;
  const emitted: AppEvent[] = [];
  const run = (a: SessionAction) => { const r = sessionReducer(sess, a); sess = r.sess; emitted.push(...r.emit); return r; };
  return { content, ctx, run, get sess(): ReviewSession { return sess; }, emitted };
}

const wrong = { outcome: 'incorrect' as const, layer: 'none' };
const right = { outcome: 'correct' as const, layer: 'exact' };

test('snapshot JSON stays small as history grows (no exponential prev chain)', () => {
  const s = startSession();
  for (let i = 0; i < 30; i++) s.run({ type: 'answer', response: 'x', result: i % 3 ? right : wrong, durationMs: 1000, at: 1 });
  const json = JSON.stringify(toSnapshot(s.sess, 0));
  const one = JSON.stringify(compactSession(s.sess, 0)).length;
  assert.ok(json.length < one * 4, `snapshot ${json.length} vs base ${one}`);
});

test('revive restores queue, tally and the ctx, and undo still works after reload', () => {
  const s = startSession();
  s.run({ type: 'answer', response: 'a', result: right, durationMs: 1, at: 1 });
  s.run({ type: 'answer', response: 'b', result: wrong, durationMs: 1, at: 2 });
  const raw = JSON.parse(JSON.stringify(toSnapshot(s.sess, 5)));
  const back = reviveSession(raw, s.ctx, () => true);
  assert.ok(back);
  assert.deepEqual(back.queue, s.sess.queue);
  assert.deepEqual(back.tally, s.sess.tally);
  assert.equal(back.ctx, s.ctx);
  // "I was right" on the restored wrong answer, then undo it, then undo the answer itself.
  const o = sessionReducer(back, { type: 'override', at: 3 });
  assert.equal(o.emit.length, 1);
  assert.equal(o.emit[0]!.type, 'review.answer');
  const u1 = sessionReducer(o.sess, { type: 'undo', at: 4 });
  assert.equal(u1.emit[0]!.type, 'event.void');
  assert.equal(u1.sess.history.at(-1)?.grade, 'incorrect');
  const u2 = sessionReducer(u1.sess, { type: 'undo', at: 5 });
  assert.equal(u2.emit[0]!.type, 'event.void');
});

test('revive rejects unusable snapshots', () => {
  const s = startSession();
  assert.equal(reviveSession(null, s.ctx, () => true), null);
  assert.equal(reviveSession({ v: 99, session: compactSession(s.sess) }, s.ctx, () => true), null);
  assert.equal(reviveSession(toSnapshot(s.sess, 0), s.ctx, () => false), null, 'content no longer has the item');
  const done = { ...s.sess, status: 'done' as const, queue: [] };
  assert.equal(reviveSession(toSnapshot(done, 0), s.ctx, () => true), null);
});
