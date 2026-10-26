import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyLessonCap, dueItems, floorHour, HOUR, MINUTE, replayAll, type AppEvent, type LessonCapReport } from '@ksrs/srs-engine';
import { capNote, capView, detectLevelUp, forecastView, levelView, localTime } from '../src/state/dashboard.ts';
import { fakeFactory, seedBundle } from './helpers.ts';

const SEOUL = 540;

function learned(at: number) {
  const content = seedBundle();
  const f = fakeFactory(at);
  const ids = ['h:決', 'h:裁', 'v:결재', 'v:결제', 'v:얼버무리다'];
  const evs: AppEvent[] = ids.map((itemId) => f.mk({ type: 'lesson.completed', itemId }));
  return { content, f, evs, s: replayAll(content, evs) };
}

test('forecast: lessons at 12:10 KST land in the 16:00 KST hourly bucket and in today', () => {
  const t0 = Date.UTC(2026, 9, 23, 3, 10); // 12:10 KST
  const { s } = learned(t0);
  const v = forecastView(s, t0, SEOUL, dueItems(s, t0).length);
  assert.equal(v.hourly.length, 24);
  assert.equal(v.hourly[0]!.label, 'now');
  const i = v.hourly.findIndex((b) => b.count > 0);
  assert.equal(i, 4); // floorHour(+4h) → 16:00 KST, the 5th bucket after 12:00
  assert.equal(v.hourly[i]!.count, 3); // hanja are never reviewed
  assert.match(v.hourly[i]!.long, /16:00$/);
  assert.equal(v.hourly[23]!.cumulative, 3);
  assert.equal(v.next24h, 3);
  assert.equal(v.daily.length, 7);
  assert.equal(v.daily[0]!.label, 'Today');
  assert.equal(v.daily[0]!.count, 3);
  assert.match(v.daily[1]!.long, /^Sat 10\/24$/);
});

test('forecast: hourly axis labels every 6 local hours; daily days roll at dayStartHour, not midnight', () => {
  const t0 = Date.UTC(2026, 9, 23, 3, 10);
  const { s } = learned(t0);
  const v = forecastView(s, t0, SEOUL, 0);
  const labelled = v.hourly.filter((b) => b.label && b.label !== 'now').map((b) => b.label);
  assert.deepEqual(labelled, ['18', '00', '06']); // 24 buckets: 12:00 … 11:00
  // 17:10 now: 18 is the very next bucket, so it is skipped to keep 'now' readable.
  const t1 = Date.UTC(2026, 9, 23, 8, 10);
  assert.deepEqual(forecastView(s, t1, SEOUL, 0).hourly.filter((b) => b.label && b.label !== 'now').map((b) => b.label), ['00', '06', '12']);
  // An item due at 02:00 KST tomorrow still belongs to "today" (day starts at 04:00).
  const late = forecastView({ ...s, items: new Map([...s.items].map(([k, st]) =>
    [k, st.availableAt === null ? st : { ...st, availableAt: Date.UTC(2026, 9, 23, 17) }])) }, t0, SEOUL, 0);
  assert.equal(late.daily[0]!.count, 3);
});

test('localTime renders in the given zone', () => {
  assert.equal(localTime(Date.UTC(2026, 9, 23, 7, 5), SEOUL), '16:05');
  assert.equal(localTime(Date.UTC(2026, 9, 23, 7, 5), -240), '03:05');
});

test('level view: needed uses the engine integer rule; remaining sorted closest-first', () => {
  const content = seedBundle();
  const f = fakeFactory();
  const s0 = replayAll(content, []);
  const v0 = levelView(s0);
  assert.equal(v0.level, 1);
  assert.equal(v0.total, 10);
  assert.equal(v0.passed, 0);
  assert.equal(v0.needed, 9); // ceil(10 × 0.9)
  assert.equal(v0.unlocksNext, false);
  assert.deepEqual(v0.byKind.map((r) => [r.kind, r.total]), [['vocab', 6], ['grammar', 3], ['expression', 1]]);
  // One item at Apprentice 1 sorts ahead of unlearned ones.
  const s1 = replayAll(content, [f.mk({ type: 'lesson.completed', itemId: 'g:는-탓에' })]);
  assert.equal(levelView(s1).remaining[0]!.id, 'g:는-탓에');
  assert.equal(levelView(s1).remaining[0]!.stage, 1);
});

test('cap view explains the binding constraint and the backlog state', () => {
  const { s, evs, f } = learned(Date.UTC(2026, 9, 23, 3));
  const r = dailyLessonCap(s, evs, f.now, s.settings, SEOUL);
  const c = capView(r);
  assert.equal(c.dailyCap, Math.min(r.steadyCap, r.headroomCap, r.maxLessonsPerDay));
  assert.equal(c.dailyCap - r.lessonsDoneToday, r.cap);
  assert.equal(c.targetMin, 45);
  assert.match(c.why, /45 min/);
  const backlog: LessonCapReport = { ...r, clearReviewsFirst: true, cap: 0, dueCount: 300, dueLoadSec: 6000 };
  assert.match(capView(backlog).why, /^Clear reviews first: 300 due ≈ 100 min/);
  const maxed: LessonCapReport = { ...r, steadyCap: 50, headroomCap: 40, maxLessonsPerDay: 20 };
  assert.equal(capView(maxed).why, 'Daily maximum');
  assert.ok(c.reviewMinToday >= 0);
  void floorHour; void HOUR; void MINUTE;
});

test('level-up detection compares userLevel before and after', () => {
  assert.equal(detectLevelUp(1, 1), null);
  assert.deepEqual(detectLevelUp(1, 2), { from: 1, to: 2 });
  assert.equal(detectLevelUp(2, 1), null);
});

test('cap note: the limit shown is the one enforced, overrides are spelled out (QA)', () => {
  const { s, evs, f } = learned(Date.UTC(2026, 9, 23, 3));
  const r = dailyLessonCap(s, evs, f.now, s.settings, SEOUL);
  const maxed: LessonCapReport = { ...r, steadyCap: 50, headroomCap: 40, maxLessonsPerDay: 20, lessonsDoneToday: 25, clearReviewsFirst: false };
  assert.equal(capNote({ report: maxed, baseLimit: 20, limit: 35, overrideExtra: 15 }), 'Today: 25 of 35 done · 20 + 15 extra (daily maximum)');
  assert.equal(capNote({ report: { ...maxed, lessonsDoneToday: 3 }, baseLimit: 20, limit: 20, overrideExtra: 0 }), 'Today: 3 of 20 done · daily maximum');
  assert.equal(capNote({ report: { ...maxed, lessonsDoneToday: 12 }, baseLimit: 10, limit: 10, overrideExtra: 0 }), 'Today: 12 done (limit 10) · daily maximum');
  assert.equal(capNote({ report: { ...maxed, clearReviewsFirst: true, lessonsDoneToday: 2 }, baseLimit: 0, limit: 7, overrideExtra: 7 }), 'Today: 2 of 7 done · extra allowance');
});

test('forecast across the New York DST fall-back (tz function): 4 a.m. days, 25 h Saturday, overdue in bucket 0 (QA)', () => {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const ny = (t: number) => {
    const p = Object.fromEntries(fmt.formatToParts(t).map((x) => [x.type, x.value]));
    return Math.round((Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!) - Math.floor(t / MINUTE) * MINUTE) / MINUTE);
  };
  const now = Date.UTC(2026, 9, 30, 23, 30); // Fri 19:30 EDT; DST ends Sun Nov 1 02:00
  const { s } = learned(now);
  const base = [...s.items.values()].find((x) => x.kind !== 'hanja')!;
  const items = new Map<string, typeof base>();
  const h0 = floorHour(now);
  for (let i = -3; i < 24 * 8; i++) items.set(`i${i}`, { ...base, itemId: `i${i}`, stage: 2, availableAt: h0 + i * HOUR });
  items.set('burned', { ...base, itemId: 'burned', stage: 9, availableAt: null });
  items.set('h', { ...base, itemId: 'h', kind: 'hanja', stage: 2, availableAt: h0 });
  const v = forecastView({ ...s, items }, now, ny, 4);
  assert.equal(v.hourly[0]!.count, 4); // 3 overdue + the current hour
  assert.equal(v.next24h, v.hourly[23]!.cumulative - 4);
  // Fri 19:00 EDT → Sat 04:00 EDT: 3 overdue + 20:00…03:00 (9 hours, incl. 19:00) = 12.
  assert.deepEqual(v.daily.map((d) => d.count), [12, 25, 24, 24, 24, 24, 24]);
  assert.deepEqual(v.daily.map((d) => d.long), ['Today (Fri 10/30)', 'Sat 10/31', 'Sun 11/1', 'Mon 11/2', 'Tue 11/3', 'Wed 11/4', 'Thu 11/5']);
  assert.equal(new Set(v.hourly.map((b) => b.long)).size, 24);
});

test('level view: a level with 0 gating items is open (ratio 1, nothing needed) (QA)', () => {
  const content = seedBundle();
  const noGate = { ...content, items: content.items.map((it) => (it.level === 1 && it.kind !== 'hanja' ? { ...it, gating: false } : it)) };
  const v = levelView(replayAll(noGate, []), 1);
  assert.equal(v.total, 0);
  assert.equal(v.ratio, 1);
  assert.equal(v.needed, 0);
  assert.equal(v.unlocksNext, true);
  assert.deepEqual(v.remaining, []);
});
