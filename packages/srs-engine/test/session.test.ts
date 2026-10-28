import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { QuestionInstance } from '@ksrs/content';
import {
  buildQuestions, createEventFactory, createHlc, currentQuestion, emptySession, replayAll, sessionReducer,
  validateEvent, type AppEvent, type CheckOutcome, type ReviewSession, type SessionAction, type SessionCtx,
} from '../src/index.ts';
import { mulberry32 } from '../src/util.ts';
import { HOUR } from '../src/util.ts';
import { device, FIXTURE, lessonP, T0, vocab } from './fixtures.ts';

describe('buildQuestions', () => {
  const d = device('d');
  const s = replayAll(FIXTURE, [
    d({ type: 'userAnswer.add', itemId: 'v:결제', qtype: 'production', answer: '결제하기' }, T0),
    d({ type: 'userAnswer.add', itemId: 'g:는-바람에', qtype: 'cloze', answer: 'mine' }, T0),
  ]);
  const ALL = ['meaning', 'production', 'cloze', 'nuance', 'register'] as const;

  test('meaning + production; userAnswers merged; other vocab headwords rejected', () => {
    const qs = buildQuestions(s.index.byId.get('v:결제')!, s, [...ALL], 'seed');
    assert.deepEqual(qs.map((q) => q.qtype), ['meaning', 'production']);
    const m = qs[0] as Extract<QuestionInstance, { qtype: 'meaning' }>;
    assert.equal(m.promptKo, '결제');
    assert.deepEqual(m.accepted, ['payment']);
    const p = qs[1] as Extract<QuestionInstance, { qtype: 'production' }>;
    assert.deepEqual(p.accepted, ['결제', '결제하기']);
    assert.ok(p.rejected.includes('xx') && p.rejected.includes('결재') && p.rejected.includes('결심'));
    assert.ok(!p.rejected.includes('결제'));
  });

  test('enabled qtypes filter; never for hanja', () => {
    assert.deepEqual(buildQuestions(s.index.byId.get('v:결제')!, s, ['meaning'], 'x').map((q) => q.qtype), ['meaning']);
    assert.deepEqual(buildQuestions(s.index.byId.get('h:決')!, s, [...ALL], 'x'), []);
  });

  test('cloze split at {{}}, prompt picked deterministically, userAnswers merged', () => {
    const g = s.index.byId.get('g:는-바람에')!;
    const a = buildQuestions(g, s, [...ALL], 'seed1');
    assert.deepEqual(a, buildQuestions(g, s, [...ALL], 'seed1'));
    const c = a.find((q) => q.qtype === 'cloze') as Extract<QuestionInstance, { qtype: 'cloze' }>;
    if (c.promptId === 'c1') { assert.equal(c.before, '비가 '); assert.equal(c.after, ' 뛰었다.'); assert.equal(c.spacingStrict, false); }
    else { assert.equal(c.before, ''); assert.equal(c.after, ' 늦었다.'); assert.equal(c.spacingStrict, true); assert.equal(c.nearMiss.length, 1); }
    assert.ok(c.accepted.includes('mine'));
    // Prompts rotate with the item's review count (D68), not with the session seed (see rotation.test.ts).
    const ids = new Set<string>();
    for (let i = 0; i < 10; i++) ids.add(buildQuestions(g, s, ['cloze'], `s${i}`)[0]!.promptId!);
    assert.equal(ids.size, 1);
  });

  test('nuance options shuffled deterministically with a correct key', () => {
    const x = s.index.byId.get('x:눈코-뜰-새-없다')!;
    const orders = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const n = buildQuestions(x, s, ['nuance'], `k${i}`)[0] as Extract<QuestionInstance, { qtype: 'nuance' }>;
      assert.deepEqual(n.options.map((o) => o.key), ['a', 'b', 'c']);
      assert.equal(n.options.find((o) => o.key === n.correctKey)!.text, 'B');
      orders.add(n.options.map((o) => o.text).join(''));
    }
    assert.ok(orders.size > 1);
  });
});

// ---------------------------------------------------------------- session reducer

const OK: CheckOutcome = { outcome: 'correct', layer: 'exact', matched: 'm' };
const BAD: CheckOutcome = { outcome: 'incorrect', layer: 'none' };
const CLOSE: CheckOutcome = { outcome: 'close', layer: 'jamo' };

function setup(mode: 'review' | 'extra' = 'review') {
  const t = { now: T0 + 5 * HOUR };
  const mk = createEventFactory({ deviceId: 'dev', hlc: createHlc('dev', () => t.now), clock: () => t.now, rng: mulberry32(7) });
  const ctx: SessionCtx = { mkEvent: (p, at) => mk(p, at) };
  const d = device('d');
  const s = replayAll(FIXTURE, [d(lessonP('v:망설이다'), T0), d(lessonP('v:결제'), T0)]);
  const items = ['v:망설이다', 'v:결제'].map((id) => ({ itemId: id, instances: buildQuestions(s.index.byId.get(id)!, s, ['meaning', 'production'], 'q') }));
  const emitted: AppEvent[] = [];
  let sess: ReviewSession = emptySession();
  const run = (a: SessionAction) => { const r = sessionReducer(sess, a); sess = r.sess; emitted.push(...r.emit); return r; };
  run({ type: 'start', mode, ctx: mode === 'review' ? ctx : undefined, items, seed: 'sess', requeueGap: 2 });
  return { get sess() { return sess; }, run, emitted, t };
}

const ans = (result: CheckOutcome, at = T0 + 5 * HOUR): SessionAction => ({ type: 'answer', response: 'r', result, durationMs: 5000, at });

describe('sessionReducer', () => {
  test('start queues every instance (seeded order)', () => {
    const x = setup();
    assert.equal(x.sess.queue.length, 4);
    assert.equal(x.sess.status, 'active');
    assert.equal(x.emitted.length, 0);
  });

  test('correct answers emit review.answer with requiredQTypes; completing all ends the session', () => {
    const x = setup();
    while (x.sess.status === 'active') x.run(ans(OK));
    assert.equal(x.emitted.length, 4);
    for (const e of x.emitted) {
      assert.ok(validateEvent(e).ok);
      assert.equal(e.type, 'review.answer');
      if (e.type === 'review.answer') assert.deepEqual(e.requiredQTypes, ['meaning', 'production']);
    }
    assert.deepEqual([...x.sess.tally.completed].sort(), ['v:결제', 'v:망설이다']);
    // Replaying the emitted events advances both items.
    const d = device('d');
    const s = replayAll(FIXTURE, [d(lessonP('v:망설이다'), T0), d(lessonP('v:결제'), T0), ...x.emitted]);
    assert.equal(s.items.get('v:망설이다')!.stage, 2);
    assert.equal(s.items.get('v:결제')!.stage, 2);
  });

  test('wrong answer requeues the question later in the session', () => {
    const x = setup();
    const q = currentQuestion(x.sess)!;
    x.run(ans(BAD));
    assert.equal(x.sess.queue.indexOf(q.qid), 2); // requeueGap 2
    assert.equal(x.sess.queue.length, 4);
    assert.equal(x.sess.items[q.itemId]!.incorrect, 1);
    assert.equal(x.emitted.length, 1);
    assert.equal((x.emitted[0] as AppEvent & { grade: string }).grade, 'incorrect');
  });

  test("'close' emits nothing; closeAttempts land in the eventual answer", () => {
    const x = setup();
    x.run(ans(CLOSE));
    x.run(ans(CLOSE));
    assert.equal(x.emitted.length, 0);
    assert.equal(x.sess.closeAttempts, 2);
    x.run(ans(OK));
    const e = x.emitted[0]!;
    assert.ok(e.type === 'review.answer' && e.check.closeAttempts === 2 && e.check.matched === 'm');
    assert.equal(x.sess.closeAttempts, 0);
  });

  test('undo emits event.void for the last answer and restores session state', () => {
    const x = setup();
    const before = x.sess;
    x.run(ans(BAD));
    const wrong = x.emitted[0]!;
    const r = x.run({ type: 'undo', at: T0 + 5 * HOUR + 1 });
    assert.equal(r.emit.length, 1);
    assert.deepEqual({ type: r.emit[0]!.type, targetId: (r.emit[0] as { targetId: string }).targetId }, { type: 'event.void', targetId: wrong.id });
    assert.equal(x.sess, before);
    assert.equal(sessionReducer(emptySession(), { type: 'undo', at: 0 }).emit.length, 0);
  });

  test("override ('I was right') emits a self-graded correct answer that overrides the wrong one", () => {
    const x = setup();
    const q = currentQuestion(x.sess)!;
    x.run(ans(BAD));
    const wrong = x.emitted[0]!;
    const r = x.run({ type: 'override', at: T0 + 5 * HOUR + 2, acceptAnswer: true });
    assert.equal(r.emit.length, 2);
    const o = r.emit[0]!;
    assert.ok(o.type === 'review.answer' && o.grade === 'correct' && o.selfGraded === true && o.overrides === wrong.id);
    assert.ok(validateEvent(o).ok);
    assert.deepEqual(r.emit[1]!.type, 'userAnswer.add');
    assert.equal(x.sess.queue.includes(q.qid), false); // treated as answered correctly
    assert.equal(x.sess.items[q.itemId]!.incorrect, 0);
    // Can't override twice; undoing the override goes back to the post-wrong state.
    assert.equal(x.run({ type: 'override', at: T0 }).emit.length, 0);
    const u = x.run({ type: 'undo', at: T0 + 5 * HOUR + 3 });
    assert.equal((u.emit[0] as { targetId: string }).targetId, o.id);
    assert.equal(x.sess.items[q.itemId]!.incorrect, 1);
  });

  test('override is only offered for an incorrect last answer', () => {
    const x = setup();
    x.run(ans(OK));
    assert.equal(x.run({ type: 'override', at: T0 }).emit.length, 0);
  });

  test('skip rotates; wrapUp keeps only started items', () => {
    const x = setup();
    const q0 = x.sess.queue[0]!;
    x.run({ type: 'skip' });
    assert.equal(x.sess.queue[x.sess.queue.length - 1], q0);
    const started = currentQuestion(x.sess)!.itemId;
    x.run(ans(OK));
    x.run({ type: 'wrapUp' });
    assert.ok(x.sess.wrappingUp);
    assert.ok(x.sess.queue.every((qid) => x.sess.questions[qid]!.itemId === started));
    while (x.sess.status === 'active') x.run(ans(OK));
    assert.deepEqual(x.sess.tally.completed, [started]);
  });

  test('resuming a pending group skips already-correct qtypes', () => {
    const s = replayAll(FIXTURE, []);
    const it = vocab('망설이다', 1);
    const r = sessionReducer(emptySession(), {
      type: 'start', ctx: { mkEvent: device('z') }, seed: 's',
      items: [{ itemId: it.id, instances: buildQuestions(it, s, ['meaning', 'production'], 'q'), alreadyCorrect: ['meaning'] }],
    });
    assert.equal(r.sess.queue.length, 1);
    assert.deepEqual(r.sess.items[it.id]!.required, ['meaning', 'production']);
  });

  test('extra-study mode emits zero events for every action', () => {
    const x = setup('extra');
    x.run(ans(BAD));
    x.run({ type: 'override', at: T0, acceptAnswer: true });
    x.run({ type: 'undo', at: T0 });
    x.run(ans(CLOSE));
    x.run({ type: 'skip' });
    while (x.sess.status === 'active') x.run(ans(OK));
    x.run({ type: 'undo', at: T0 });
    x.run({ type: 'wrapUp' });
    assert.equal(x.emitted.length, 0);
    assert.ok(x.sess.tally.correct > 0);
  });

  test('review mode without mkEvent is rejected', () => {
    assert.throws(() => sessionReducer(emptySession(), { type: 'start', items: [], seed: 's' }));
  });
});
