import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ItemId } from '@ksrs/content';
import {
  availableLessons, buildContentIndex, computeUnlocks, dailyLessonCap, dueItems, forecast, levelProgress, replayAll, settingPayload,
  stageCounts, type AppEvent, type ItemState,
} from '../src/index.ts';
import { DAY, HOUR } from '../src/util.ts';
import { advance, answerP, bulkBundle, bundle, device, FIXTURE, hanja, lessonP, passAll, T0, vocab } from './fixtures.ts';

const MP = ['meaning', 'production'] as const;
const MC = ['meaning', 'cloze'] as const;

/** Legacy mode: `hanja.lessons` on (hanja are lesson nodes again, D12). */
const HANJA_ON = { 'hanja.lessons': true } as const;
const hanjaOn = () => device('settings')(settingPayload('hanja.lessons', true), T0 - 1000);

describe('unlocks (§7.3)', () => {
  test('default (D63): hanja are never unlocked or offered; Sino-Korean vocab needs no hanja lesson', () => {
    const s = replayAll(FIXTURE, []);
    assert.equal([...s.unlocked].some((id) => id.startsWith('h:')), false);
    assert.ok(s.unlocked.has('v:결정'));
    assert.deepEqual(availableLessons(s.index, s, { path: 'vocab' }), ['v:결정', 'v:망설이다', 'v:결제', 'v:결재', 'v:덤', 'x:눈코-뜰-새-없다']);
    // Explicit deps on a hanja are dropped too.
    const b = bundle([hanja('一', 1), vocab('일', 1, { unlockDeps: [{ id: 'h:一', require: 'lesson' }] })]);
    assert.ok(replayAll(b, []).unlocked.has('v:일'));
  });

  test('default (D63): old hanja lesson.completed events replay harmlessly and never count', () => {
    const d = device('d');
    const log = [d(lessonP('h:決'), T0), d(lessonP('h:定'), T0 + 1), d(lessonP('v:망설이다'), T0 + 2),
      d(answerP('h:決', 'meaning', 'correct'), T0 + 5 * HOUR)];
    const s = replayAll(FIXTURE, log);
    assert.equal(s.items.get('h:決')!.stage, 0);
    assert.equal(s.unlocked.has('h:決'), false);
    assert.deepEqual(dueItems(s, T0 + 100 * DAY), ['v:망설이다']);
    assert.deepEqual(stageCounts(s), { apprentice: 1, guru: 0, master: 0, enlightened: 0, burned: 0 });
    assert.equal(forecast(s, T0, 168, 'day').reduce((a, b) => a + b.count, 0), 1);
    const r = dailyLessonCap(s, log, T0 + HOUR, s.settings, 0);
    assert.equal(r.lessonsDoneToday, 1, 'only the vocab lesson counts');
    assert.ok(!availableLessons(s.index, s).some((id) => id.startsWith('h:')));
    assert.equal(levelProgress(s.index, s, 1).gatingTotal, 5); // 4 gating vocab + 1 expression; hanja never gate
  });

  test('at start: level 1 open; hanja, deps-free vocab/grammar/expressions unlocked; Sino-Korean vocab waits for hanja', () => {
    const s = replayAll(FIXTURE, [hanjaOn()]);
    assert.equal(s.userLevel, 1);
    assert.deepEqual([...s.unlocked].sort(), ['g:는-바람에', 'h:決', 'h:定', 'v:결재', 'v:결제', 'v:덤', 'v:망설이다', 'x:눈코-뜰-새-없다'].sort());
    assert.equal(s.unlocked.has('v:결정'), false);
    assert.equal(s.unlocked.has('g:는-통에'), false);
    assert.equal(s.unlocked.has('h:心'), false); // level 2 is closed
  });

  test('hanja lessons unlock their vocab (all referenced hanja required)', () => {
    const d = device('d');
    const one = replayAll(FIXTURE, [hanjaOn(), d(lessonP('h:決'), T0)]);
    assert.equal(one.unlocked.has('v:결정'), false);
    const both = replayAll(FIXTURE, [hanjaOn(), d(lessonP('h:決'), T0), d(lessonP('h:定'), T0 + 1)]);
    assert.equal(both.unlocked.has('v:결정'), true);
  });

  test("explicit 'guru' dep: 는-통에 unlocks once 는-바람에 reaches Guru (passedAt)", () => {
    const d = device('d');
    const G = 'g:는-바람에';
    const log: AppEvent[] = [d(lessonP(G), T0)];
    log.push(...advance(FIXTURE, log, d, G, 3, [...MC])); // stage 4
    assert.equal(replayAll(FIXTURE, log).unlocked.has('g:는-통에'), false);
    log.push(...advance(FIXTURE, log, d, G, 1, [...MC])); // stage 5
    const s = replayAll(FIXTURE, log);
    assert.equal(s.items.get(G)!.stage, 5);
    assert.equal(s.unlocked.has('g:는-통에'), true);
    // Dropping back below Guru keeps it unlocked (passedAt is sticky).
    const t = s.items.get(G)!.availableAt!;
    log.push(d(answerP(G, 'meaning', 'incorrect', [...MC]), t), d(answerP(G, 'meaning', 'incorrect', [...MC]), t + 1), ...passAll(d, G, [...MC], t + 2));
    const s2 = replayAll(FIXTURE, log);
    assert.equal(s2.items.get(G)!.stage, 3);
    assert.equal(s2.unlocked.has('g:는-통에'), true);
  });

  test('90% boundary via computeUnlocks: 89/100 stays, 90/100 levels up; hanja (even gating:true) never count', () => {
    const b = bulkBundle(100);
    const index = buildContentIndex(b);
    const mk = (n: number) => {
      const items = new Map<ItemId, ItemState>();
      for (let i = 0; i < n; i++) {
        const id = `v:w${String(i).padStart(4, '0')}`;
        items.set(id, { itemId: id, kind: 'vocab', level: 1, stage: 5, availableAt: T0, lessonAt: T0, passedAt: T0, pending: null,
          stats: { reviews: 4, correct: 4, incorrect: 0, streak: 4, selfGraded: 0, ignoredEarly: 0 }, leechScore: 0, recentIncorrectAts: [] });
      }
      return items;
    };
    const r89 = computeUnlocks(index, mk(89));
    assert.equal(r89.userLevel, 1);
    assert.equal(r89.unlocked.has('v:lvl2a'), false);
    const r90 = computeUnlocks(index, mk(90), HANJA_ON);
    assert.equal(r90.userLevel, 2);
    assert.ok(r90.unlocked.has('v:lvl2a') && r90.unlocked.has('h:二'));
    assert.equal(computeUnlocks(index, mk(90)).unlocked.has('h:二'), false);
    assert.deepEqual(levelProgress(index, { items: mk(89) }, 1), { gatingTotal: 100, gatingPassed: 89, threshold: 0.9, unlocksNext: false });
    assert.deepEqual(levelProgress(index, { items: mk(90) }, 1), { gatingTotal: 100, gatingPassed: 90, threshold: 0.9, unlocksNext: true });
  });

  test('90% of a non-multiple of 10 (the real L1 has 51): 45/51 stays, 46/51 = ceil(45.9) levels up (QA)', () => {
    const index = buildContentIndex(bulkBundle(51));
    const mk = (n: number) => {
      const items = new Map<ItemId, ItemState>();
      for (let i = 0; i < n; i++) {
        const id = `v:w${String(i).padStart(4, '0')}`;
        items.set(id, { itemId: id, kind: 'vocab', level: 1, stage: 4, availableAt: T0, lessonAt: T0, passedAt: T0, pending: null,
          stats: { reviews: 4, correct: 3, incorrect: 1, streak: 0, selfGraded: 0, ignoredEarly: 0 }, leechScore: 0, recentIncorrectAts: [] });
      }
      return items;
    };
    assert.equal(computeUnlocks(index, mk(45)).userLevel, 1);
    assert.equal(computeUnlocks(index, mk(46)).userLevel, 2); // stage 4 now: passed stays sticky
  });

  test('90% boundary via replay: 8/10 no, 9/10 yes; non-gating items do not count', () => {
    const b = bulkBundle(10);
    const d = device('d');
    const ids = Array.from({ length: 10 }, (_, i) => `v:w${String(i).padStart(4, '0')}`);
    const log: AppEvent[] = ids.map((id, i) => d(lessonP(id), T0 + i));
    // Lessons at T0..T0+9 ms share an hour, so all items move in lockstep: 4 clean reviews → Guru.
    const guru = (n: number): AppEvent[] => {
      const out: AppEvent[] = [];
      let t = T0 + 4 * HOUR;
      const iv = [8 * HOUR, DAY, 2 * DAY, 0];
      for (let r = 0; r < 4; r++) {
        ids.slice(0, n).forEach((id, k) => out.push(...passAll(d, id, [...MP], t + k * 10)));
        t += iv[r]!;
      }
      return out;
    };
    assert.equal(replayAll(b, [...log, ...guru(8)]).userLevel, 1);
    const s9 = replayAll(b, [...log, ...guru(9)]);
    assert.equal(s9.userLevel, 2);
    assert.equal([...s9.items.values()].filter((x) => x.passedAt !== undefined).length, 9);
  });

  test('hanja never appear in dueItems', () => {
    const d = device('d');
    const s = replayAll(FIXTURE, [d(lessonP('h:決'), T0), d(lessonP('v:망설이다'), T0)]);
    assert.deepEqual(dueItems(s, T0 + 100 * DAY), ['v:망설이다']);
  });

  test('availableLessons order: hanja first, then level, kind (vocab, grammar, expression), content order', () => {
    const d = device('d');
    const s = replayAll(FIXTURE, [hanjaOn(), d(lessonP('h:定'), T0)]);
    assert.deepEqual(availableLessons(s.index, s), ['h:決', 'v:망설이다', 'v:결제', 'v:결재', 'v:덤', 'g:는-바람에', 'x:눈코-뜰-새-없다']);
    const s2 = replayAll(FIXTURE, [hanjaOn(), d(lessonP('h:定'), T0), d(lessonP('h:決'), T0)]);
    assert.deepEqual(availableLessons(s2.index, s2).slice(0, 2), ['v:결정', 'v:망설이다']);
  });
});

test('imported non-gating extras interleave 3 curriculum : 2 extras after hanja (D60)', () => {
  const imp = { kind: 'import' as const, license: 'personal-use', attribution: 'Anki' };
  const items = [
    hanja('一', 1),
    ...Array.from({ length: 6 }, (_, i) => vocab(`c${i}`, 1)),
    ...Array.from({ length: 5 }, (_, i) => vocab(`x${i}`, 1, { gating: false, source: imp })),
  ];
  const b = bundle(items);
  const s = replayAll(b, [hanjaOn()]);
  const order = availableLessons(s.index, s);
  assert.deepEqual(order, [
    'h:一', 'v:c0', 'v:c1', 'v:c2', 'v:x0', 'v:x1', 'v:c3', 'v:c4', 'v:c5', 'v:x2', 'v:x3', 'v:x4',
  ]);
  // With no extras the order is unchanged.
  const plain = replayAll(bundle(items.slice(0, 7)), [hanjaOn()]);
  assert.deepEqual(availableLessons(plain.index, plain), ['h:一', 'v:c0', 'v:c1', 'v:c2', 'v:c3', 'v:c4', 'v:c5']);
});
