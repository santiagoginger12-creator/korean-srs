import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Item } from '@ksrs/content';
import { forAll, shuffle, type Gen } from '@ksrs/test-support';
import { applyEvents, replayAll, unionEvents, type AppEvent, type EventPayload } from '../src/index.ts';
import { DAY, HOUR, MINUTE } from '../src/util.ts';
import { answerP, canon, device, FIXTURE, lessonP, T0 } from './fixtures.ts';

const ITEMS: Item[] = FIXTURE.items;
const REVIEWABLE = ITEMS.filter((it): it is Exclude<Item, { kind: 'hanja' }> => it.kind !== 'hanja');
const STEPS = [0, MINUTE, 10 * MINUTE, HOUR, 4 * HOUR, 8 * HOUR, DAY, 3 * DAY];

/** Random two-device logs over the fixture: lessons, answers, voids (incl. void-of-void), overrides, resets, settings, notes. */
const genLog: Gen<AppEvent[]> = (r, size) => {
  const pickOf = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const devs = [device('a', `a${r()}`), device('b', `b${r()}`)];
  const out: AppEvent[] = [];
  let t = T0;
  const n = 4 + size * 4;
  for (let i = 0; i < n; i++) {
    t += pickOf(STEPS);
    const emit = pickOf(devs);
    const roll = r();
    let p: EventPayload;
    if (roll < 0.2 || out.length === 0) p = lessonP(pickOf(ITEMS).id);
    else if (roll < 0.62) {
      const it = pickOf(REVIEWABLE);
      p = answerP(it.id, pickOf(it.questionTypes), r() < 0.7 ? 'correct' : 'incorrect', it.questionTypes.slice(),
        { check: { layer: 'x', closeAttempts: Math.floor(r() * 2) } });
    } else if (roll < 0.72) p = { type: 'event.void', targetId: pickOf(out).id, reason: 'undo' };
    else if (roll < 0.8) {
      const wrongs = out.filter((e): e is AppEvent & { type: 'review.answer' } => e.type === 'review.answer' && e.grade === 'incorrect');
      if (!wrongs.length) continue;
      const w = pickOf(wrongs);
      p = answerP(w.itemId, w.qtype, 'correct', w.requiredQTypes, { selfGraded: true, overrides: w.id });
    } else if (roll < 0.84) p = { type: 'item.reset', itemId: pickOf(REVIEWABLE).id, toStage: 1 };
    else if (roll < 0.88) {
      const fast = r() < 0.5;
      p = { type: 'settings.set', key: 'srs.intervals', value: fast ? Array(8).fill(HOUR) : [4, 8, 24, 48, 168, 336, 720, 2880].map((h) => h * HOUR) };
    } else if (roll < 0.94) p = { type: 'note.set', itemId: pickOf(ITEMS).id, field: 'mnemonic', text: `n${i}` };
    else p = { type: r() < 0.6 ? 'userAnswer.add' : 'userAnswer.remove', itemId: pickOf(REVIEWABLE).id, qtype: 'meaning', answer: pickOf(['x', 'y']) };
    out.push(emit(p, t));
  }
  return out;
};

const RUNS = { runs: 150, maxSize: 40 };
const stripHlc = (s: string) => s.replace(/"lastHlc":"[^"]*"/, '');

describe('replay properties', () => {
  test('generator coverage: logs reach real progression, overrides, voids of voids, gated answers', () => {
    const seen = { stage3: 0, guru: 0, override: 0, voidOfVoid: 0, ignoredEarly: 0, pending: 0, selfGraded: 0 };
    forAll(genLog, (log) => {
      const byId = new Map(log.map((e) => [e.id, e]));
      const s = replayAll(FIXTURE, log);
      for (const st of s.items.values()) {
        if (st.stage >= 3) seen.stage3++;
        if (st.passedAt !== undefined) seen.guru++;
        if (st.stats.ignoredEarly) seen.ignoredEarly++;
        if (st.pending) seen.pending++;
        if (st.stats.selfGraded) seen.selfGraded++;
      }
      for (const e of log) {
        if (e.type === 'review.answer' && e.overrides) seen.override++;
        if (e.type === 'event.void' && byId.get(e.targetId)?.type === 'event.void') seen.voidOfVoid++;
      }
    }, { ...RUNS, seed: 'shuffle' });
    for (const [k, v] of Object.entries(seen)) assert.ok(v > 0, `generator never produced ${k}`);
    console.log('generator coverage', JSON.stringify(seen));
  });

  test('replay is invariant under input shuffle', () => {
    forAll(genLog, (log, r) => {
      assert.equal(canon(replayAll(FIXTURE, shuffle(log, r))), canon(replayAll(FIXTURE, log)));
    }, { ...RUNS, seed: 'shuffle' });
  });

  test('union is commutative and idempotent: replay(A∪B) = replay(B∪A), replay(A∪A) = replay(A)', () => {
    forAll(genLog, (log, r) => {
      const A = log.filter(() => r() < 0.6);
      const B = log.filter(() => r() < 0.6);
      assert.equal(canon(replayAll(FIXTURE, unionEvents(A, B))), canon(replayAll(FIXTURE, unionEvents(B, A))));
      assert.equal(canon(replayAll(FIXTURE, [...B, ...A])), canon(replayAll(FIXTURE, [...A, ...B])));
      assert.equal(canon(replayAll(FIXTURE, [...A, ...A])), canon(replayAll(FIXTURE, A)));
      assert.deepEqual(unionEvents(A, A), unionEvents(A));
    }, { ...RUNS, seed: 'union' });
  });

  test('stage ∈ [0,9] always; availableAt is null exactly for stage 0/9; hanja never staged', () => {
    forAll(genLog, (log) => {
      for (const st of replayAll(FIXTURE, log).items.values()) {
        assert.ok(Number.isInteger(st.stage) && st.stage >= 0 && st.stage <= 9, `stage ${st.stage}`);
        if (st.kind === 'hanja') { assert.equal(st.stage, 0); assert.equal(st.availableAt, null); continue; }
        assert.ok(st.stage >= 1);
        assert.equal(st.availableAt === null, st.stage === 9);
        if (st.availableAt !== null) assert.equal(st.availableAt % HOUR, 0);
        if (st.stage >= 5) assert.notEqual(st.passedAt, undefined);
      }
    }, { ...RUNS, seed: 'stage' });
  });

  test('adding void(X) ≡ removing X (for any non-void X)', () => {
    forAll(genLog, (log, r) => {
      const candidates = log.filter((e) => e.type !== 'event.void');
      if (!candidates.length) return;
      const X = candidates[Math.floor(r() * candidates.length)]!;
      const v = device('v', `v${r()}`)({ type: 'event.void', targetId: X.id, reason: 'undo' }, T0 + 400 * DAY);
      const voided = replayAll(FIXTURE, [...log, v]);
      const removed = replayAll(FIXTURE, log.filter((e) => e.id !== X.id));
      assert.equal(stripHlc(canon(voided)), stripHlc(canon(removed)));
    }, { ...RUNS, seed: 'void' });
  });

  test('applyEvents(prefix state, all, suffix) ≡ replayAll(all)', () => {
    forAll(genLog, (log, r) => {
      const k = Math.floor(r() * (log.length + 1));
      const prev = replayAll(FIXTURE, log.slice(0, k));
      const { state } = applyEvents(prev, FIXTURE, log, log.slice(k));
      assert.equal(canon(state), canon(replayAll(FIXTURE, log)));
    }, { ...RUNS, seed: 'apply' });
  });
});
