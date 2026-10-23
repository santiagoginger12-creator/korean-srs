import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dailyLessonCap, forecast, replayAll, rollingAccuracy, secPerQEstimates, stageCounts, type AppEvent,
} from '../src/index.ts';
import { DAY, HOUR, MINUTE } from '../src/util.ts';
import { advance, answerP, bulkBundle, bundle, device, FIXTURE, hanja, lessonP, T0, vocab } from './fixtures.ts';

describe('forecast', () => {
  // Lessons → availableAt = floorHour(lesson + 4h).
  const d = device('d');
  const log = [
    d(lessonP('v:망설이다'), T0 + 14 * HOUR + 10 * MINUTE), // A: avail Oct 1 18:00Z (Seoul Oct 2 03:00)
    d(lessonP('v:결제'), T0 + 15 * HOUR),                   // B: avail Oct 1 19:00Z (Seoul Oct 2 04:00)
    d(lessonP('v:결재'), T0 + DAY + 14 * HOUR + 30 * MINUTE), // C: avail Oct 2 18:00Z (Seoul Oct 3 03:00)
    d(lessonP('v:덤'), T0 + DAY + 15 * HOUR),               // D: avail Oct 2 19:00Z (Seoul Oct 3 04:00)
    d(lessonP('h:決'), T0),                                  // hanja: never forecast
  ];
  const s = replayAll(FIXTURE, log);
  const now = T0 + 18 * HOUR + 30 * MINUTE; // Oct 1 18:30Z = Seoul Oct 2 03:30 (still Oct 1's study day)

  test('day buckets honor the 4 a.m. boundary in Seoul (+540)', () => {
    const f = forecast(s, now, 168, 'day', 540);
    assert.equal(f.length, 7);
    assert.equal(f[0]!.t, Date.UTC(2026, 8, 30, 19)); // Seoul Oct 1 04:00
    assert.equal(f[1]!.t, Date.UTC(2026, 9, 1, 19));
    assert.deepEqual(f.map((b) => b.count), [1, 2, 1, 0, 0, 0, 0]);
    assert.deepEqual(f.map((b) => b.cumulative), [1, 3, 4, 4, 4, 4, 4]);
  });

  test('same items in UTC split differently', () => {
    const f = forecast(s, now, 168, 'day', 0);
    assert.equal(f[0]!.t, T0 + 4 * HOUR);
    assert.deepEqual(f.map((b) => b.count).slice(0, 3), [2, 2, 0]);
  });

  test('hour buckets: overdue in bucket 0, horizon excludes later items', () => {
    const f = forecast(s, now, 24, 'hour');
    assert.equal(f.length, 24);
    assert.equal(f[0]!.t, T0 + 18 * HOUR);
    assert.equal(f[0]!.count, 1);
    assert.equal(f[1]!.count, 1);
    assert.equal(f[23]!.cumulative, 2);
  });

  test('stageCounts', () => {
    const e: AppEvent[] = [d(lessonP('v:망설이다'), T0)];
    e.push(...advance(FIXTURE, e, d, 'v:망설이다', 4));
    e.push(d(lessonP('v:결제'), T0), d(lessonP('h:決'), T0));
    assert.deepEqual(stageCounts(replayAll(FIXTURE, e)), { apprentice: 1, guru: 1, master: 0, enlightened: 0, burned: 0 });
  });
});

describe('load estimator (§7.4)', () => {
  test('secPerQ EMA (α=0.2, clamped 3–120 s) and 30-day accuracy', () => {
    const d = device('d');
    const ev = [
      d(answerP('v:a', 'production', 'correct', ['production'], { durationMs: 10_000 }), T0 - 40 * DAY),
      d(answerP('v:a', 'meaning', 'correct', ['meaning'], { durationMs: 20_000 }), T0),
      d(answerP('v:a', 'meaning', 'incorrect', ['meaning'], { durationMs: 500_000 }), T0 + 1),
      d(answerP('v:a', 'production', 'correct', ['production'], { durationMs: 1_000 }), T0 + 2),
    ];
    const spq = secPerQEstimates(ev);
    // production: older 10 s sample first (no change from 10), then 1 s → clamped 3: 10 + 0.2×(3−10) = 8.6
    assert.ok(Math.abs(spq.meaning - (7 + 0.2 * 13 + 0.2 * (120 - 9.6))) < 1e-9); // 9.6 → 31.68
    assert.ok(Math.abs(spq.production - 8.6) < 1e-9);
    assert.equal(spq.cloze, 14);
    assert.equal(rollingAccuracy(ev, T0 + 10), 2 / 3); // the 40-day-old answer is outside the window
    assert.equal(rollingAccuracy([], T0), 0.85);
  });

  test('cap vs a hand-computed fixture', () => {
    // 20 vocab (meaning+production) + 1 hanja. 3 vocab lessons at 09:00Z, now 10:00Z, UTC, 4 a.m. day start.
    // avgItemCost = (7+10)×1.15 = 19.55 s; reviewsPerItem = 8/0.85; steady = ⌊2700 / 184⌋ = 14.
    // Today's 3 items each project reviews at 13:00 d0, 21:00 d0, d1 21:00, d3 21:00.
    // A new item learned now adds 14:00 d0, 22:00 d0, d1, d3 → [2,1,0,1,0,0,0].
    const b = bundle([hanja('一', 1), ...Array.from({ length: 20 }, (_, i) => vocab(`n${i}`, 1))]);
    const d = device('d');
    const now = T0 + 10 * HOUR;
    const log = [d(lessonP('v:n0'), T0 + 9 * HOUR), d(lessonP('v:n1'), T0 + 9 * HOUR), d(lessonP('v:n2'), T0 + 9 * HOUR),
      d(lessonP('h:一'), T0 + 9 * HOUR), d(lessonP('v:n3'), T0 + 3 * HOUR) /* before 4 a.m.: yesterday */];
    const s = replayAll(b, log);
    const r = dailyLessonCap(s, log, now, s.settings, 0);
    assert.ok(Math.abs(r.avgItemCost - 19.55) < 1e-9);
    assert.equal(r.steadyCap, 14);
    assert.deepEqual(r.newItemReviewsPerDay, [2, 1, 0, 1, 0, 0, 0]);
    // Yesterday's lesson n3 (03:00) is overdue since 07:00 → projected at now (d0), then 18:00 d0, d1, d3:
    // d0 = (3×2 + 2) × 19.55, so day 0 binds at ⌊(2700 − 156.4)/39.1⌋ = 65; cap is still min(14, 65, 20) − 3 = 11.
    assert.ok(Math.abs(r.projectedDaySec[0]! - (3 * 2 + 2) * 19.55) < 1e-9);
    assert.equal(r.headroomCap, Math.floor((2700 - 8 * 19.55) / (2 * 19.55)));
    assert.equal(r.lessonsDoneToday, 3); // hanja and yesterday's lesson excluded
    assert.equal(r.cap, 11);
    assert.equal(r.clearReviewsFirst, false);
    assert.equal(r.dayStart, T0 + 4 * HOUR);
  });

  test('maxLessonsPerDay clamps the cap', () => {
    const b = bundle(Array.from({ length: 5 }, (_, i) => vocab(`n${i}`, 1)));
    const s = replayAll(b, []);
    const r = dailyLessonCap(s, [], T0 + 10 * HOUR, { ...s.settings, maxLessonsPerDay: 6 }, 0);
    assert.equal(r.cap, 6);
  });

  test('backlog over 1.5 × T sets the cap to 0', () => {
    const b = bulkBundle(250);
    const d = device('d');
    const log = Array.from({ length: 250 }, (_, i) => d(lessonP(`v:w${String(i).padStart(4, '0')}`), T0 - 10 * DAY));
    const s = replayAll(b, log);
    const r = dailyLessonCap(s, log, T0, s.settings, 0);
    assert.equal(r.dueCount, 250);
    assert.ok(r.dueLoadSec > 1.5 * 2700);
    assert.equal(r.clearReviewsFirst, true);
    assert.equal(r.cap, 0);
    // 200 due (≈3910 s) is under the 4050 s threshold
    const s2 = replayAll(b, log.slice(0, 200));
    assert.equal(dailyLessonCap(s2, log.slice(0, 200), T0, s2.settings, 0).clearReviewsFirst, false);
  });
});
