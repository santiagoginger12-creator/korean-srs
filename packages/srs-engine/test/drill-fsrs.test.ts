import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyFuzz, DEFAULT_FSRS_PARAMS, FACTOR, forgetStability, formatInterval, FSRS5_DEFAULT_W as W, fuzzRange, initDifficulty,
  initStability, newCardSched, nextDifficulty, nextIntervalDays, rawInterval, recallStability, retrievability, schedule,
  scheduleAll, shortTermStability, type CardSched, type FsrsParams, type Rating,
} from '../src/index.ts';
import { DAY, MINUTE } from '../src/util.ts';

const T = Date.UTC(2026, 10, 1, 3, 0, 0);
const near = (a: number, b: number, eps: number, msg?: string) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≉ ${b} (±${eps})`);
const NOFUZZ: FsrsParams = { ...DEFAULT_FSRS_PARAMS, fuzz: false };

// Reference values. Source: the FSRS-5 formulas and default parameters as published in the
// open-spaced-repetition/fsrs4anki wiki ("The Algorithm", FSRS-5) and the worked numbers in
// F. Borretti, "Implementing FSRS in 100 Lines" (https://borretti.me/article/implementing-fsrs-in-100-lines),
// which uses the same 19-weight default vector: R(10, 3.173) ≈ 0.758; D0(Good) ≈ 5.282;
// D0(Easy) ≈ 3.225; Good at t = 3 from (S 3.173, D 5.2824) → S' ≈ 10.73, D'' ≈ 5.273;
// Again in the same state → S' ≈ 1.054 (min with S).
describe('FSRS-5 formulas (reference values)', () => {
  test('default parameter vector is FSRS-5 (19 weights)', () => {
    assert.equal(W.length, 19);
    assert.deepEqual(W.slice(0, 4), [0.40255, 1.18385, 3.173, 15.69105]);
    assert.equal(W[18], 0.6621);
  });

  test('F = 19/81 makes R(S, S) = 0.9 and I(0.9, S) = S', () => {
    near(FACTOR, 19 / 81, 1e-15);
    for (const s of [0.4, 1, 3.173, 15.7, 400]) {
      near(retrievability(s, s), 0.9, 1e-12, `R(${s},${s})`);
      near(rawInterval(s, 0.9), s, 1e-9, `I(${s})`);
    }
  });

  test('retrievability', () => {
    near(retrievability(10, 3.173), 0.758, 5e-4);
    near(retrievability(3, 3.173), 0.9048, 5e-4);
    assert.equal(retrievability(0, 5), 1);
  });

  test('initial stability and difficulty', () => {
    assert.deepEqual(([1, 2, 3, 4] as Rating[]).map((g) => initStability(W, g)), [0.40255, 1.18385, 3.173, 15.69105]);
    near(initDifficulty(W, 1), 7.1949, 1e-9);
    near(initDifficulty(W, 3), 5.282, 1e-3);
    near(initDifficulty(W, 4), 3.225, 1e-3);
  });

  test('difficulty update: linear damping + mean reversion to D0(Easy)', () => {
    near(nextDifficulty(W, 5.2824, 3), 5.273, 1e-3);
    assert.ok(nextDifficulty(W, 5, 1) > 5 && nextDifficulty(W, 5, 4) < 5);
    assert.ok(nextDifficulty(W, 10, 1) <= 10);
    assert.ok(nextDifficulty(W, 1, 4) >= 1);
  });

  test('stability after recall and after forgetting', () => {
    const r = retrievability(3, 3.173);
    near(recallStability(W, 5.2824, 3.173, r, 3), 10.73, 0.02);
    near(forgetStability(W, 5.2824, 3.173, r), 1.054, 0.005);
    assert.ok(forgetStability(W, 2, 0.5, 0.2) <= 0.5, 'never above the old stability');
    assert.ok(recallStability(W, 5, 10, 0.9, 2) < recallStability(W, 5, 10, 0.9, 3), 'hard penalty');
    assert.ok(recallStability(W, 5, 10, 0.9, 4) > recallStability(W, 5, 10, 0.9, 3), 'easy bonus');
  });

  test('short-term stability: S·e^(w17·(G−3+w18))', () => {
    near(shortTermStability(W, 3.173, 3), 3.173 * Math.exp(0.51655 * 0.6621), 1e-12);
    assert.ok(shortTermStability(W, 2, 1) < 2 && shortTermStability(W, 2, 3) > 2);
  });

  test('interval rounding, minimum and maximum', () => {
    assert.equal(nextIntervalDays(0.4, 0.9, 36500), 1);
    assert.equal(nextIntervalDays(3.173, 0.9, 36500), 3);
    assert.equal(nextIntervalDays(1e9, 0.9, 36500), 36500);
    assert.ok(nextIntervalDays(10, 0.97, 36500) < nextIntervalDays(10, 0.8, 36500), 'higher retention, shorter interval');
  });
});

describe('fuzz', () => {
  test('no fuzz below 3 days; ranges match Anki', () => {
    assert.equal(applyFuzz(2, 0.99, 36500), 2);
    assert.deepEqual(fuzzRange(10, 36500), { min: 8, max: 12 }); // delta = 1 + 0.15·4.5 + 0.1·3 = 1.975
    assert.deepEqual(fuzzRange(100, 36500), { min: 93, max: 107 }); // delta = 1 + .675 + 1.3 + 4 = 6.975
    for (let f = 0; f < 1; f += 0.05) {
      const v = applyFuzz(30, f, 36500);
      const { min, max } = fuzzRange(30, 36500);
      assert.ok(v >= min && v <= max);
    }
  });

  test('deterministic from card id + review count', () => {
    let c = newCardSched();
    let t = T;
    for (const g of [3, 3, 3, 3] as Rating[]) { c = schedule(c, g, t, 'kw00042:f'); t = c.due; }
    const again = (() => { let d = newCardSched(); let u = T; for (const g of [3, 3, 3, 3] as Rating[]) { d = schedule(d, g, u, 'kw00042:f'); u = d.due; } return d; })();
    assert.deepEqual(c, again);
    // Different ids spread out (not all the same interval).
    const ivls = new Set<number>();
    for (let i = 0; i < 40; i++) ivls.add(scheduleAll({ ...c }, c.due, `kw${i}:f`)[3].ivl);
    assert.ok(ivls.size > 1);
  });
});

describe('learning steps (Anki 1m 10m, relearn 10m)', () => {
  test('new card: Again 1m, Hard 5.5m, Good 10m, Easy graduates', () => {
    const a = scheduleAll(newCardSched(), T, 'x:f', NOFUZZ);
    assert.equal(a[1].phase, 'learning'); assert.equal(a[1].due - T, 1 * MINUTE); assert.equal(a[1].step, 0);
    assert.equal(a[2].phase, 'learning'); assert.equal(a[2].due - T, 5.5 * MINUTE); assert.equal(a[2].step, 0);
    assert.equal(a[3].phase, 'learning'); assert.equal(a[3].due - T, 10 * MINUTE); assert.equal(a[3].step, 1);
    assert.equal(a[4].phase, 'review'); assert.equal(a[4].ivl, 16); assert.equal(a[4].due - T, 16 * DAY);
    assert.equal(formatInterval(a[1].due - T), '<1m');
    assert.equal(formatInterval(a[2].due - T), '6m');
    assert.equal(formatInterval(a[3].due - T), '10m');
    assert.equal(formatInterval(a[4].due - T), '16d');
  });

  test('Good on the last step graduates with the FSRS interval (short-term stability)', () => {
    const s1 = schedule(newCardSched(), 3, T, 'x:f', NOFUZZ);
    const s2 = scheduleAll(s1, T + 10 * MINUTE, 'x:f', NOFUZZ);
    assert.equal(s2[3].phase, 'review');
    near(s2[3].s, 3.173 * Math.exp(0.51655 * 0.6621), 1e-9);
    assert.equal(s2[3].ivl, 4);
    assert.equal(s2[2].phase, 'learning'); assert.equal(s2[2].due - (T + 10 * MINUTE), 10 * MINUTE, 'Hard repeats the step');
    assert.equal(s2[1].phase, 'learning'); assert.equal(s2[1].step, 0);
    assert.equal(s2[1].lapses, 0, 'Again while learning is not a lapse');
  });

  test('lapse: Again on a review card relearns for 10m, counts a lapse, then returns to review', () => {
    let c = schedule(newCardSched(), 4, T, 'x:f', NOFUZZ); // review, 16d
    const at = c.due;
    const lapse = schedule(c, 1, at, 'x:f', NOFUZZ);
    assert.equal(lapse.phase, 'relearning');
    assert.equal(lapse.due - at, 10 * MINUTE);
    assert.equal(lapse.lapses, 1);
    assert.ok(lapse.s < c.s, 'stability drops');
    const hard = schedule(lapse, 2, at + 10 * MINUTE, 'x:f', NOFUZZ);
    assert.equal(hard.phase, 'relearning');
    assert.equal(hard.due - (at + 10 * MINUTE), 15 * MINUTE, 'one step: Hard = 1.5×');
    c = schedule(lapse, 3, at + 10 * MINUTE, 'x:f', NOFUZZ);
    assert.equal(c.phase, 'review');
    assert.equal(c.lapses, 1);
    assert.ok(c.ivl >= 1);
  });
});

describe('monotonicity: Easy ≥ Good ≥ Hard ≥ Again', () => {
  const walk = (ratings: Rating[], id: string): CardSched[] => {
    const out: CardSched[] = [newCardSched()];
    let c = out[0]!;
    let t = T;
    for (const g of ratings) { c = schedule(c, g, t, id); out.push(c); t = Math.max(c.due, t + MINUTE); }
    return out;
  };
  const states: [CardSched, number][] = [];
  const pattern: Rating[][] = [[3, 3, 3, 3, 3, 3], [4, 3, 2, 3, 1, 3, 3], [1, 1, 3, 3, 2, 2, 4], [3, 3, 1, 3, 3, 3, 4, 4]];
  pattern.forEach((p, i) => walk(p, `m${i}:f`).forEach((c) => states.push([c, c.phase === 'new' ? T : Math.max(c.due, (c.last ?? T) + MINUTE)])));

  for (const [k, [c, at]] of states.entries()) {
    test(`state ${k} (${c.phase}, ivl ${c.ivl})`, () => {
      for (const retention of [0.8, 0.9, 0.97]) {
        for (const id of ['a:f', 'b:r', 'kw01234:f']) {
          const all = scheduleAll(c, at, id, { ...DEFAULT_FSRS_PARAMS, retention });
          const due = ([1, 2, 3, 4] as Rating[]).map((g) => all[g].due);
          assert.ok(due[0]! <= due[1]! && due[1]! <= due[2]! && due[2]! <= due[3]!, `due order ${due.map((d) => formatInterval(d - at))}`);
          if (all[3].phase === 'review' && all[4].phase === 'review') assert.ok(all[4].ivl > all[3].ivl);
          if (all[2].phase === 'review' && all[3].phase === 'review') assert.ok(all[3].ivl > all[2].ivl);
          assert.ok(all[4].s >= all[3].s && all[3].s >= all[2].s && all[2].s >= all[1].s, 'stability order');
        }
      }
    });
  }

  test('maximum interval holds', () => {
    const c: CardSched = { phase: 'review', step: 0, s: 1e7, d: 1, due: T, ivl: 36000, last: T - 36000 * DAY, reps: 30, lapses: 0 };
    const all = scheduleAll(c, T, 'big:f');
    for (const g of [2, 3, 4] as Rating[]) assert.ok(all[g].ivl <= 36500);
  });
});

describe('formatInterval', () => {
  test('labels', () => {
    assert.equal(formatInterval(30_000), '<1m');
    assert.equal(formatInterval(MINUTE), '<1m');
    assert.equal(formatInterval(10 * MINUTE), '10m');
    assert.equal(formatInterval(3 * 3_600_000), '3h');
    assert.equal(formatInterval(4 * DAY), '4d');
    assert.equal(formatInterval(45 * DAY), '1.5mo');
    assert.equal(formatInterval(800 * DAY), '2.2y');
  });
});
