import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_INTERVALS, getScheduler, wkAvailableAt, wkNextStage, wkScheduler, type Stage } from '../src/index.ts';
import { DAY, HOUR } from '../src/util.ts';
import { T0 } from './fixtures.ts';

// Hand-computed from §7.1: rows = stage 1..8, columns = incorrect 0..4.
const TABLE: Record<number, [number, number, number, number, number]> = {
  1: [2, 1, 1, 1, 1],
  2: [3, 1, 1, 1, 1],
  3: [4, 2, 2, 1, 1],
  4: [5, 3, 3, 2, 2],
  5: [6, 3, 3, 1, 1],
  6: [7, 4, 4, 2, 2],
  7: [8, 5, 5, 3, 3],
  8: [9, 6, 6, 4, 4],
};

describe('WK formula (§7.1)', () => {
  for (let s = 1; s <= 8; s++) {
    for (let inc = 0; inc <= 4; inc++) {
      test(`stage ${s}, incorrect ${inc} → ${TABLE[s]![inc]}`, () => {
        assert.equal(wkNextStage(s, inc), TABLE[s]![inc]);
      });
    }
  }

  test('§7.1 worked examples', () => {
    assert.equal(wkNextStage(7, 1), 5); // Master, 1 wrong → Guru 1
    assert.equal(wkNextStage(8, 3), 4); // Enlightened, 3 wrong: adj 2 × penalty 2 → Apprentice 4
    assert.equal(wkNextStage(3, 1), 2); // Apprentice 3, 1 wrong → 2
    assert.equal(wkNextStage(6, 2), 4); // Guru 2, 2 wrong → 4
  });

  test('next() applies interval[newStage] rounded down to the hour', () => {
    const at = T0 + 37 * 60_000 + 12_345; // 00:37:12.345
    for (let s = 1 as Stage; s <= 7; s = (s + 1) as Stage) {
      const r = wkScheduler.next({ stage: s, availableAt: 0 }, { incorrect: 0, closeAttempts: 0, at }, { intervals: DEFAULT_INTERVALS });
      assert.equal(r.stage, s + 1);
      assert.equal(r.availableAt, T0 + DEFAULT_INTERVALS[s]!, `stage ${s + 1}`);
    }
    const down = wkScheduler.next({ stage: 6, availableAt: 0 }, { incorrect: 2, closeAttempts: 0, at }, { intervals: DEFAULT_INTERVALS });
    assert.deepEqual(down, { stage: 4, availableAt: T0 + 2 * DAY });
  });

  test('Burned (9) has availableAt null; burned stays burned with no errors', () => {
    const r = wkScheduler.next({ stage: 8, availableAt: 0 }, { incorrect: 0, closeAttempts: 0, at: T0 }, { intervals: DEFAULT_INTERVALS });
    assert.deepEqual(r, { stage: 9, availableAt: null });
    assert.equal(wkNextStage(9, 0), 9);
    assert.equal(wkAvailableAt(9, T0, { intervals: DEFAULT_INTERVALS }), null);
  });

  test('custom intervals are honored; rounding is floor to the UTC hour', () => {
    const iv = [HOUR, 2 * HOUR, 3 * HOUR, 4 * HOUR, 5 * HOUR, 6 * HOUR, 7 * HOUR, 8 * HOUR];
    assert.equal(wkAvailableAt(3, T0 + 59 * 60_000, { intervals: iv }), T0 + 3 * HOUR);
    assert.equal(wkAvailableAt(1, T0 + HOUR - 1, { intervals: iv }), T0 + HOUR);
  });

  test('isGuruOrAbove', () => {
    assert.equal(wkScheduler.isGuruOrAbove({ stage: 4, availableAt: 0 }), false);
    assert.equal(wkScheduler.isGuruOrAbove({ stage: 5, availableAt: 0 }), true);
  });

  test('fsrs falls back to wk with a flag (D19)', () => {
    assert.deepEqual(getScheduler('wk'), { scheduler: wkScheduler, fallback: false });
    assert.deepEqual(getScheduler('fsrs'), { scheduler: wkScheduler, fallback: true });
  });
});
