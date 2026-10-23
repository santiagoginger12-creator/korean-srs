import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replayAll, HOUR } from '@ksrs/srs-engine';
import { grantOverride, nextBatch, OVERRIDE_STEP, overrideExtraFor, planLessons } from '../src/state/lessons.ts';
import { fakeFactory, seedBundle } from './helpers.ts';

const UTC = 0;

test('hanja come first and are never capped; others are limited by the cap', () => {
  const content = seedBundle();
  const f = fakeFactory();
  const s = replayAll(content, []);
  const plan = planLessons(s, [], f.now, UTC, undefined);
  const kinds = plan.queue.map((id) => s.index.byId.get(id)!.kind);
  assert.ok(plan.hanjaAvailable > 0);
  assert.deepEqual(kinds.slice(0, plan.hanjaAvailable), Array(plan.hanjaAvailable).fill('hanja'));
  assert.ok(plan.queue.length - plan.hanjaAvailable <= plan.allowance);
  assert.equal(nextBatch(plan, s).length, Math.min(s.settings.lessonBatch, plan.queue.length));
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

test('lesson.completed for hanja unlocks their vocab in the next plan', () => {
  const content = seedBundle();
  const f = fakeFactory();
  const s0 = replayAll(content, []);
  const hanja = planLessons(s0, [], f.now, UTC, undefined).queue.filter((id) => s0.index.byId.get(id)!.kind === 'hanja');
  const evs = hanja.map((itemId) => f.mk({ type: 'lesson.completed', itemId }));
  const s1 = replayAll(content, evs);
  const before = planLessons(s0, [], f.now, UTC, undefined).otherAvailable;
  const after = planLessons(s1, evs, f.now, UTC, undefined).otherAvailable;
  assert.ok(after > before, `${after} > ${before}`);
});
