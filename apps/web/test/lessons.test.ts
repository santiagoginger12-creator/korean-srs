import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replayAll, HOUR } from '@ksrs/srs-engine';
import { grantOverride, nextBatch, OVERRIDE_STEP, overrideExtraFor, planLessons } from '../src/state/lessons.ts';
import { fakeFactory, seedBundle } from './helpers.ts';

const UTC = 0;

test('no hanja lessons (D63); vocab lessons limited by the cap; grammar on its own queue', () => {
  const content = seedBundle();
  const f = fakeFactory();
  const s = replayAll(content, []);
  const plan = planLessons(s, [], f.now, UTC, undefined);
  const kinds = plan.queue.map((id) => s.index.byId.get(id)!.kind);
  assert.ok(!kinds.includes('hanja') && !kinds.includes('grammar'));
  assert.ok(plan.queue.length <= plan.allowance);
  assert.equal(nextBatch(plan, s).length, Math.min(s.settings.lessonBatch, plan.queue.length));
  // Even with the engine rollback (hanja.lessons on) the app never queues hanja.
  const on = replayAll(content, [f.mk({ type: 'settings.set', key: 'hanja.lessons' as never, value: true })]);
  assert.ok(!planLessons(on, [], f.now, UTC, undefined).queue.some((id) => id.startsWith('h:')));
});

test('+5 anyway raises the allowance for the current study day only', () => {
  const content = seedBundle();
  const f = fakeFactory(Date.UTC(2026, 9, 23, 12));
  const s = replayAll(content, []);
  const o = grantOverride(undefined, f.now, UTC, 4);
  assert.equal(o.extra, OVERRIDE_STEP);
  assert.equal(grantOverride(o, f.now + HOUR, UTC, 4).extra, 2 * OVERRIDE_STEP);
  const p0 = planLessons(s, [], f.now, UTC, undefined);
  const p1 = planLessons(s, [], f.now, UTC, o);
  assert.equal(p1.allowance, p0.allowance + OVERRIDE_STEP);
  // Next study day (after 04:00 tomorrow): the override has expired.
  assert.equal(overrideExtraFor(o, o.dayStart + 24 * HOUR), 0);
});

test('+5 anyway extends the day total: once used up, the allowance is 0 again (QA regression)', () => {
  const content = seedBundle();
  const f = fakeFactory(Date.UTC(2026, 9, 23, 12));
  const evs = [f.mk({ type: 'settings.set', key: 'maxLessonsPerDay', value: 2 })];
  const learn = (n: number, o?: ReturnType<typeof grantOverride>) => {
    const s = replayAll(content, evs);
    const plan = planLessons(s, evs, f.now, UTC, o);
    for (const id of plan.queue.filter((id) => s.index.byId.get(id)!.kind !== 'hanja').slice(0, n)) {
      evs.push(f.mk({ type: 'lesson.completed', itemId: id }));
    }
    return plan;
  };
  const p0 = learn(2);
  assert.equal(p0.allowance, 2);
  const s1 = replayAll(content, evs);
  const p1 = planLessons(s1, evs, f.now, UTC, undefined);
  assert.equal(p1.allowance, 0);
  const o = grantOverride(undefined, f.now, UTC, 4, p1);
  const p2 = learn(5, o);
  assert.equal(p2.allowance, OVERRIDE_STEP);
  assert.equal(p2.limit, 2 + OVERRIDE_STEP);
  const s3 = replayAll(content, evs);
  const p3 = planLessons(s3, evs, f.now, UTC, o);
  assert.equal(p3.report.lessonsDoneToday, 7);
  assert.equal(p3.allowance, 0, 'the extra 5 are spent, not reusable');
  // A second press gives exactly five more.
  assert.equal(planLessons(s3, evs, f.now, UTC, grantOverride(o, f.now, UTC, 4, p3)).allowance, OVERRIDE_STEP);
});

test('+5 anyway in the backlog state after lessons were already done today still grants 5', () => {
  const content = seedBundle();
  const f = fakeFactory(Date.UTC(2026, 9, 23, 12));
  const s = replayAll(content, []);
  const base = planLessons(s, [], f.now, UTC, undefined);
  const backlog = { ...base, baseLimit: 0, report: { ...base.report, clearReviewsFirst: true, cap: 0, lessonsDoneToday: 8 } };
  const o = grantOverride(undefined, f.now, UTC, 4, backlog);
  assert.equal(o.extra, 8 + OVERRIDE_STEP);
});
