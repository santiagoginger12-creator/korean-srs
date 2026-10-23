// QA regression and spec-boundary tests (M1 review). Expected values here are
// derived from ARCHITECTURE.md by hand, never from the implementation.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ItemId } from '@ksrs/content';
import {
  buildContentIndex, buildQuestions, createEventFactory, createHlc, dueItems, emptySession, levelProgress, replayAll,
  sessionReducer, wkNextStage, type AppEvent, type CheckOutcome, type ItemState, type ReviewSession, type SessionAction,
} from '../src/index.ts';
import { DAY, HOUR, MINUTE, mulberry32 } from '../src/util.ts';
import { advance, answerP, bulkBundle, device, FIXTURE, lessonP, passAll, T0 } from './fixtures.ts';

const MP = ['meaning', 'production'] as const;

describe('BUG (medium): undoing "I was right" + "accept in future" left the answer accepted', () => {
  test('undo voids both the override and its userAnswer.add; replay forgets the answer', () => {
    const t = { now: T0 + 5 * HOUR };
    const mk = createEventFactory({ deviceId: 'dev', hlc: createHlc('dev', () => t.now), clock: () => t.now, rng: mulberry32(3) });
    const d = device('d');
    const base = [d(lessonP('v:망설이다'), T0)];
    const s = replayAll(FIXTURE, base);
    const items = [{ itemId: 'v:망설이다', instances: buildQuestions(s.index.byId.get('v:망설이다')!, s, ['meaning'], 'q') }];
    let sess: ReviewSession = emptySession();
    const emitted: AppEvent[] = [];
    const run = (a: SessionAction) => { t.now += 1000; const r = sessionReducer(sess, a); sess = r.sess; emitted.push(...r.emit); return r; };
    run({ type: 'start', mode: 'review', ctx: { mkEvent: (p, at) => mk(p, at) }, items, seed: 's', requeueGap: 2 });
    const BAD: CheckOutcome = { outcome: 'incorrect', layer: 'none' };
    run({ type: 'answer', response: 'to waver', result: BAD, durationMs: 4000, at: T0 + 5 * HOUR });
    const o = run({ type: 'override', at: T0 + 5 * HOUR + 1, acceptAnswer: true });
    assert.deepEqual(o.emit.map((e) => e.type), ['review.answer', 'userAnswer.add']);
    const afterOverride = replayAll(FIXTURE, [...base, ...emitted]);
    assert.deepEqual([...afterOverride.userAnswers.values()].flat(), ['to waver']);

    const u = run({ type: 'undo', at: T0 + 5 * HOUR + 2 });
    assert.deepEqual(u.emit.map((e) => (e as { targetId: string }).targetId), o.emit.map((e) => e.id));
    const afterUndo = replayAll(FIXTURE, [...base, ...emitted]);
    assert.equal(afterUndo.userAnswers.size, 0, 'retracted answer must not stay accepted');
    // And the wrong answer is back in effect: pending group holds 1 incorrect.
    assert.equal(afterUndo.items.get('v:망설이다')!.pending?.incorrect, 1);
  });
});

describe('§7.1 formula re-derived', () => {
  test('stage 9 and stage 0 inputs', () => {
    assert.equal(wkNextStage(0, 0), 1);
    assert.equal(wkNextStage(9, 0), 9);
    assert.equal(wkNextStage(5, 5), 1); // adj 3 × 2 = 6 → floor at 1
    assert.equal(wkNextStage(8, 1), 6);
  });
});

describe('90% gate boundary (§7.3): integer math, no float drift', () => {
  const index30 = buildContentIndex(bulkBundle(30));
  const passed = (n: number): Map<ItemId, ItemState> => {
    const m = new Map<ItemId, ItemState>();
    for (let i = 0; i < n; i++) {
      const id = `v:w${String(i).padStart(4, '0')}`;
      m.set(id, { itemId: id, kind: 'vocab', level: 1, stage: 5, availableAt: T0, lessonAt: T0, passedAt: T0, pending: null,
        stats: { reviews: 4, correct: 4, incorrect: 0, streak: 4, selfGraded: 0, ignoredEarly: 0 }, leechScore: 0, recentIncorrectAts: [] });
    }
    return m;
  };
  test('27/30 unlocks, 26/30 does not', () => {
    assert.equal(levelProgress(index30, { items: passed(27) }, 1).unlocksNext, true);
    assert.equal(levelProgress(index30, { items: passed(26) }, 1).unlocksNext, false);
  });
  test('9/10 yes, 8/9 (88.9%) no, 18/20 yes, 17/20 no', () => {
    for (const [n, total, want] of [[9, 10, true], [8, 9, false], [18, 20, true], [17, 20, false], [1, 1, true], [0, 1, false]] as const) {
      const ix = buildContentIndex(bulkBundle(total));
      assert.equal(levelProgress(ix, { items: passed(n) }, 1).unlocksNext, want, `${n}/${total}`);
    }
  });
});

describe('dueness gate, burned, hanja', () => {
  const V = 'v:망설이다';
  test('answers just beyond the 5-minute grace are ignored', () => {
    const d = device('d');
    const log = [d(lessonP(V), T0), ...passAll(d, V, [...MP], T0 + 4 * HOUR - 5 * MINUTE - 2)]; // at −2 ms and −1 ms
    const st = replayAll(FIXTURE, log).items.get(V)!;
    assert.equal(st.stage, 1);
    assert.equal(st.stats.ignoredEarly, 2);
  });
  test('burned items never come due and ignore further answers', () => {
    const d = device('d');
    const log: AppEvent[] = [d(lessonP(V), T0)];
    log.push(...advance(FIXTURE, log, d, V, 8, [...MP]));
    const burned = replayAll(FIXTURE, log).items.get(V)!;
    assert.equal(burned.stage, 9);
    assert.equal(burned.availableAt, null);
    const later = burned.burnedAt! + 400 * DAY;
    log.push(d(answerP(V, 'meaning', 'incorrect', [...MP]), later), ...passAll(d, V, [...MP], later + 1));
    const s = replayAll(FIXTURE, log);
    assert.equal(s.items.get(V)!.stage, 9);
    assert.deepEqual(dueItems(s, later + 1000 * DAY), []);
  });
  test('hanja: never due, never staged, never gate, even with review events', () => {
    const d = device('d');
    const s = replayAll(FIXTURE, [d(lessonP('h:決'), T0), ...passAll(d, 'h:決', ['meaning'], T0 + 5 * HOUR)]);
    const h = s.items.get('h:決')!;
    assert.equal(h.stage, 0);
    assert.equal(h.availableAt, null);
    assert.deepEqual(dueItems(s, T0 + 1000 * DAY), []);
  });
});
