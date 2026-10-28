// Separate grammar path: independent ladders, split lesson queues, two caps in one budget,
// ghost reviews, hint-level layers.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Item, ItemId } from '@ksrs/content';
import {
  availableLessons, buildContentIndex, computeUnlocks, dailyLessonCap, dueGhosts, emptySession, ghostSlots, grammarProgress,
  levelProgress, nextGhostAt, pruneGhostDone, replayAll, sessionReducer, settingPayload, validateEvent, variantsInbox,
  type AppEvent, type ItemState,
} from '../src/index.ts';
import { DAY, HOUR } from '../src/util.ts';
import { answerP, bundle, device, grammar, hanja, lessonP, T0, vocab } from './fixtures.ts';

const passedState = (id: ItemId, kind: Item['kind'], level: number): ItemState => ({
  itemId: id, kind, level, stage: 5, availableAt: T0 + 7 * DAY, lessonAt: T0, passedAt: T0, pending: null,
  stats: { reviews: 4, correct: 4, incorrect: 0, streak: 4, selfGraded: 0, ignoredEarly: 0 }, leechScore: 0, recentIncorrectAts: [],
});
const pad = (i: number) => String(i).padStart(3, '0');

/** L1: 100 gating vocab + 100 gating grammar; L2: vocab + grammar; L3 vocab only; L5 grammar only (a gap). */
function twoPaths() {
  const items: Item[] = [hanja('一', 1)];
  for (let i = 0; i < 100; i++) items.push(vocab(`v${pad(i)}`, 1));
  for (let i = 0; i < 100; i++) items.push(grammar(`g${pad(i)}`, 1));
  items.push(vocab('v2', 2), grammar('g2', 2), grammar('g2dep', 2, { unlockDeps: [{ id: 'g:g2', require: 'guru' }] }));
  items.push(vocab('v3', 3), grammar('g5', 5));
  return bundle(items);
}
const passVocab = (n: number, m = new Map<ItemId, ItemState>()) => {
  for (let i = 0; i < n; i++) m.set(`v:v${pad(i)}`, passedState(`v:v${pad(i)}`, 'vocab', 1));
  return m;
};
const passGrammar = (n: number, m = new Map<ItemId, ItemState>()) => {
  for (let i = 0; i < n; i++) m.set(`g:g${pad(i)}`, passedState(`g:g${pad(i)}`, 'grammar', 1));
  return m;
};

describe('separate grammar path: unlocks', () => {
  const index = buildContentIndex(twoPaths());

  test('vocab gate at 89% vs 90% counts vocab/expressions only (grammar 0/100 does not hold it back)', () => {
    const r89 = computeUnlocks(index, passVocab(89));
    assert.equal(r89.userLevel, 1);
    assert.equal(r89.unlocked.has('v:v2'), false);
    const r90 = computeUnlocks(index, passVocab(90));
    assert.equal(r90.userLevel, 2);
    assert.ok(r90.unlocked.has('v:v2'));
    // Grammar stage 2 stays closed: vocab progress never opens grammar.
    assert.equal(r90.grammarStage, 1);
    assert.equal(r90.unlocked.has('g:g2'), false);
    assert.deepEqual(levelProgress(index, { items: passVocab(90) }, 1), { gatingTotal: 100, gatingPassed: 90, threshold: 0.9, unlocksNext: true });
  });

  test('grammar stage gate at 89% vs 90%, independent of vocab', () => {
    const r89 = computeUnlocks(index, passGrammar(89));
    assert.equal(r89.grammarStage, 1);
    assert.equal(r89.unlocked.has('g:g2'), false);
    const r90 = computeUnlocks(index, passGrammar(90));
    assert.equal(r90.grammarStage, 2);
    assert.ok(r90.unlocked.has('g:g2'));
    // Explicit deps still apply inside an open stage.
    assert.equal(r90.unlocked.has('g:g2dep'), false);
    // Grammar progress never opens vocab level 2.
    assert.equal(r90.userLevel, 1);
    assert.equal(r90.unlocked.has('v:v2'), false);
    const gp = grammarProgress(index, { items: passGrammar(90) });
    assert.deepEqual(gp.stages.map((s) => [s.level, s.stage, s.open]), [[1, 1, true], [2, 2, true], [5, 3, false]]);
    assert.deepEqual({ ...gp.current }, { level: 2, stage: 2, gatingTotal: 2, gatingPassed: 0, threshold: 0.9, unlocksNext: false, open: true });
    assert.equal(grammarProgress(index, { items: passGrammar(89) }).stages[0]!.unlocksNext, false);
  });

  test('stages skip level gaps (2 → 5); grammar-only levels are not vocab levels', () => {
    const m = passGrammar(100);
    m.set('g:g2', passedState('g:g2', 'grammar', 2));
    m.set('g:g2dep', passedState('g:g2dep', 'grammar', 2));
    const r = computeUnlocks(index, m);
    assert.equal(r.grammarStage, 5);
    assert.ok(r.unlocked.has('g:g5'));
    assert.ok(r.unlocked.has('g:g2dep'), 'a learned item stays unlocked');
    // Vocab: 1 → 2 → 3 with L5 (grammar-only) never a vocab level.
    const v = passVocab(100);
    v.set('v:v2', passedState('v:v2', 'vocab', 2));
    v.set('v:v3', passedState('v:v3', 'vocab', 3));
    assert.equal(computeUnlocks(index, v).userLevel, 3);
  });

  test('grammar.separatePath=false restores the combined ladder (grammar gates levels again)', () => {
    const off = { 'grammar.separatePath': false };
    const both = passGrammar(90, passVocab(90));
    // Combined: 180/200 = 90% → level 2 opens and grammar with it.
    const r = computeUnlocks(index, both, off);
    assert.equal(r.userLevel, 2);
    assert.ok(r.unlocked.has('g:g2'));
    // 90 vocab alone is only 45% of the combined gate.
    assert.equal(computeUnlocks(index, passVocab(90), off).userLevel, 1);
    assert.equal(computeUnlocks(index, passGrammar(90), off).unlocked.has('g:g2'), false);
    assert.deepEqual(levelProgress(index, { items: both, settings: off }, 1), { gatingTotal: 200, gatingPassed: 180, threshold: 0.9, unlocksNext: true });
    assert.equal(grammarProgress(index, { items: both, settings: off }).separate, false);
  });

  test('the setting is coerced on replay; invalid values are ignored', () => {
    const d = device('d');
    const b = twoPaths();
    const off = replayAll(b, [d(settingPayload('grammar.separatePath', false), T0)]);
    assert.equal(off.settings['grammar.separatePath'], false);
    const bad = replayAll(b, [d({ type: 'settings.set', key: 'grammar.separatePath' as never, value: 'no' }, T0),
      d({ type: 'settings.set', key: 'grammar.dailyLessons' as never, value: 2.5 }, T0 + 1),
      d({ type: 'settings.set', key: 'grammar.dailyLessons' as never, value: 99 }, T0 + 2)]);
    assert.equal(bad.settings['grammar.separatePath'], true);
    assert.equal(bad.settings['grammar.dailyLessons'], 3);
    assert.equal(replayAll(b, [d(settingPayload('grammar.dailyLessons', 0), T0)]).settings['grammar.dailyLessons'], 0);
  });
});

describe('separate lesson queues', () => {
  const b = bundle([
    hanja('決', 1),
    vocab('결정', 1, { hanjaBreakdown: [{ syllable: '결', hanja: '決', hanjaId: 'h:決' }] }),
    vocab('망설이다', 1), grammar('는-바람에', 1), grammar('느라고', 1),
    vocab('덤', 1, { gating: false, source: { kind: 'import', license: 'x', attribution: 'Anki' } }),
  ]);
  test('vocab = everything except grammar (hanja first, D60 interleave); grammar = grammar only', () => {
    const d = device('d');
    const s = replayAll(b, [d(lessonP('h:決'), T0)]);
    assert.deepEqual(availableLessons(s.index, s, { path: 'vocab' }), ['v:결정', 'v:망설이다', 'v:덤']);
    assert.deepEqual(availableLessons(s.index, s, { path: 'grammar' }), ['g:는-바람에', 'g:느라고']);
    assert.deepEqual(availableLessons(s.index, replayAll(b, []), { path: 'vocab' })[0], 'h:決');
    assert.deepEqual(availableLessons(s.index, s), ['v:결정', 'v:망설이다', 'g:는-바람에', 'v:덤', 'g:느라고']); // combined (D60 3:2)
  });
});

describe('two caps in one review budget', () => {
  // Vocab: meaning+production; grammar: meaning+cloze. Defaults: acc 0.85 → 9.41 reviews/item.
  const items: Item[] = [];
  for (let i = 0; i < 30; i++) items.push(vocab(`v${pad(i)}`, 1));
  for (let i = 0; i < 10; i++) items.push(grammar(`g${pad(i)}`, 1));
  const b = bundle(items);
  const NOW = T0 + 12 * HOUR;
  const rpi = 8 / 0.85;
  const cV = (7 + 10) * 1.15;
  const cG = (7 + 14) * 1.15;

  test('grammar allowance is reserved at its real cost before the vocab cap', () => {
    const s = replayAll(b, []);
    const r = dailyLessonCap(s, [], NOW, s.settings, 0);
    assert.equal(r.separateGrammar, true);
    assert.equal(r.grammar.allowance, 3);
    assert.equal(r.grammar.limit, 3);
    assert.equal(r.grammar.cap, 3);
    assert.equal(r.grammar.reserved, 3);
    assert.ok(Math.abs(r.grammar.avgItemCost - cG) < 1e-9);
    assert.ok(Math.abs(r.avgItemCost - cV) < 1e-9);
    assert.ok(Math.abs(r.grammar.reservedSec - 3 * rpi * cG) < 1e-6);
    const expectSteady = Math.floor((2700 - 3 * rpi * cG) / (rpi * cV)); // ⌊(2700 − 682.0) / 184.0⌋ = 10
    assert.equal(r.steadyCap, expectSteady);
    assert.equal(r.steadyCap, 10);
    assert.equal(r.cap, Math.min(r.steadyCap, r.headroomCap, 20));
    // Without the reservation the same vocab would get ⌊2700 / 184.0⌋ = 14.
    const none = dailyLessonCap(s, [], NOW, { ...s.settings, 'grammar.dailyLessons': 0 }, 0);
    assert.equal(none.steadyCap, 14);
    assert.equal(none.grammar.cap, 0);
  });

  test('no reservation for grammar that cannot happen today; done-today grammar counts against the allowance', () => {
    const onlyVocab = bundle(items.filter((it) => it.kind === 'vocab').concat(grammar('locked', 1, { unlockDeps: [{ id: 'v:v000', require: 'guru' }] })));
    const s0 = replayAll(onlyVocab, []);
    const r0 = dailyLessonCap(s0, [], NOW, s0.settings, 0);
    assert.equal(r0.grammar.available, 0);
    assert.equal(r0.grammar.reserved, 0);
    assert.equal(r0.steadyCap, 14);

    const d = device('d');
    const log: AppEvent[] = [d(lessonP('g:g000'), NOW - HOUR), d(lessonP('g:g001'), NOW - HOUR + 1), d(lessonP('v:v000'), NOW - HOUR + 2)];
    const s = replayAll(b, log);
    const r = dailyLessonCap(s, log, NOW, s.settings, 0);
    assert.equal(r.grammar.doneToday, 2);
    assert.equal(r.grammar.cap, 1);
    assert.equal(r.lessonsDoneToday, 1, 'vocab path counts only vocab');
    assert.equal(r.grammar.reserved, 3);
  });

  test('the grammar limit never exceeds what the budget alone carries; backlog zeroes both', () => {
    const s = replayAll(b, []);
    const tight = dailyLessonCap(s, [], NOW, { ...s.settings, targetReviewMin: 10, 'grammar.dailyLessons': 50 }, 0);
    assert.equal(tight.grammar.steadyCap, Math.floor(600 / (rpi * cG)));
    assert.equal(tight.grammar.limit, Math.min(tight.grammar.steadyCap, tight.grammar.headroomCap));
    // Grammar took the whole (small) budget: nothing left for vocab.
    assert.equal(tight.steadyCap, Math.max(0, Math.floor((600 - tight.grammar.reserved * rpi * cG) / (rpi * cV))));

    const d = device('d');
    const log = items.map((it, i) => d(lessonP(it.id), T0 - 2 * DAY + i));
    const s2 = replayAll(b, log);
    const back = dailyLessonCap(s2, log, T0 + 30 * DAY, { ...s2.settings, targetReviewMin: 1 }, 0);
    assert.equal(back.clearReviewsFirst, true);
    assert.equal(back.cap, 0);
    assert.equal(back.grammar.cap, 0);
  });

  test('combined mode (separatePath=false) is the original single cap', () => {
    const s = replayAll(b, []);
    const r = dailyLessonCap(s, [], NOW, { ...s.settings, 'grammar.separatePath': false }, 0);
    assert.equal(r.separateGrammar, false);
    assert.equal(r.grammar.cap, 0);
    assert.equal(r.grammar.reserved, 0);
    const avg = (30 * cV + 10 * cG) / 40;
    assert.ok(Math.abs(r.avgItemCost - avg) < 1e-9);
    assert.equal(r.steadyCap, Math.floor(2700 / (rpi * avg)));
  });
});

describe('ghost reviews', () => {
  const b = bundle([vocab('망설이다', 1), grammar('는-바람에', 1), grammar('느라고', 1)]);
  const index = buildContentIndex(b);
  const d = device('d');
  const G = 'g:는-바람에';
  const miss = d(answerP(G, 'cloze', 'incorrect', ['meaning', 'cloze']), T0 + 4 * HOUR);
  const vocabMiss = d(answerP('v:망설이다', 'meaning', 'incorrect', ['meaning', 'production']), T0 + 4 * HOUR + 1);
  const log = [d(lessonP(G), T0), d(lessonP('v:망설이다'), T0), miss, vocabMiss];

  test('a grammar miss opens slots at +2 h and +24 h; vocab misses do not', () => {
    const slots = ghostSlots(index, log);
    assert.deepEqual(slots.map((g) => [g.itemId, g.dueAt - miss.at]), [[G, 2 * HOUR], [G, 24 * HOUR]]);
    assert.deepEqual(dueGhosts(index, log, miss.at + 2 * HOUR - 1), []);
    assert.equal(nextGhostAt(index, log, miss.at), miss.at + 2 * HOUR);
    const due = dueGhosts(index, log, miss.at + 2 * HOUR);
    assert.deepEqual(due.map((g) => [g.itemId, g.slots.length]), [[G, 1]]);
    // Done (per device) → gone; the +24 h slot still comes.
    assert.deepEqual(dueGhosts(index, log, miss.at + 3 * HOUR, due[0]!.slots), []);
    assert.equal(nextGhostAt(index, log, miss.at + 3 * HOUR, due[0]!.slots), miss.at + 24 * HOUR);
    assert.equal(dueGhosts(index, log, miss.at + 25 * HOUR).length, 1);
    assert.equal(dueGhosts(index, log, miss.at + 25 * HOUR)[0]!.slots.length, 2, 'both slots, one item');
  });

  test('slots lapse after 7 days; overridden ("I was right") misses open none; pruning keeps live keys', () => {
    assert.deepEqual(dueGhosts(index, log, miss.at + 2 * HOUR + 7 * DAY).map((g) => g.slots.length), [1]); // the +2 h slot lapsed
    assert.deepEqual(dueGhosts(index, log, miss.at + 24 * HOUR + 7 * DAY), []);
    const ov = d({ ...answerP(G, 'cloze', 'correct', ['meaning', 'cloze']), selfGraded: true, overrides: miss.id } as never, miss.at + 1000);
    assert.deepEqual(ghostSlots(index, [...log, ov]), []);
    const keys = ghostSlots(index, log).map((g) => g.key);
    assert.deepEqual(pruneGhostDone(index, log, miss.at + 3 * HOUR, [...keys, 'stale@2h']), [...keys].sort());
    assert.deepEqual(pruneGhostDone(index, log, miss.at + 10 * DAY, keys), []);
  });

  test('ghosts never change SRS state: the practice (extra) session emits zero events', () => {
    const before = replayAll(b, log);
    const { sess } = sessionReducer(emptySession(), {
      type: 'start', mode: 'extra', seed: 's',
      items: [{ itemId: G, instances: [{ qid: `${G}#meaning`, itemId: G, qtype: 'meaning', promptKo: 'x', accepted: ['a'], rejected: [] }] }],
    });
    const r1 = sessionReducer(sess, { type: 'answer', response: 'b', result: { outcome: 'incorrect', layer: 'none' }, durationMs: 1, at: miss.at + 2 * HOUR });
    const r2 = sessionReducer(r1.sess, { type: 'answer', response: 'a', result: { outcome: 'correct', layer: 'exact' }, durationMs: 1, at: miss.at + 2 * HOUR + 1 });
    assert.equal(r1.emit.length + r2.emit.length, 0);
    assert.deepEqual(r2.sess.tally.completed, [G]);
    assert.deepEqual(replayAll(b, log).items.get(G), before.items.get(G));
  });
});

describe('hint level in check.layer', () => {
  test('validateEvent accepts "exact+hint2"; a hint-2 answer is a miss; variant+hint1 still reaches the inbox', () => {
    const d = device('d');
    const G = 'g:는-바람에';
    const b = bundle([grammar('는-바람에', 1)]);
    const lesson = d(lessonP(G), T0);
    const hint2 = d(answerP(G, 'cloze', 'incorrect', ['cloze'], { response: 'a1는-바람에', check: { layer: 'exact+hint2', closeAttempts: 0 } }), T0 + 4 * HOUR);
    const v = validateEvent(JSON.parse(JSON.stringify(hint2)));
    assert.equal(v.ok, true);
    const s = replayAll(b, [lesson, hint2]);
    assert.equal(s.items.get(G)!.stats.incorrect, 1);
    const variant = d(answerP(G, 'cloze', 'correct', ['cloze'], { response: '다른 답', check: { layer: 'variant+hint1', closeAttempts: 0 } }), T0 + 4 * HOUR + 5);
    assert.equal(validateEvent(variant).ok, true);
    assert.equal(variantsInbox(replayAll(b, [lesson, variant]), [lesson, variant]).length, 1);
  });
});
