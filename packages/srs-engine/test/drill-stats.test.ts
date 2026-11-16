import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  answersByDay, drillCounts, dueForecast, leeches, missedToday, pickNext, replayDrill, tierStats, validateEvent,
  type AppEvent, type DeckMeta, type EventPayload, type Rating,
} from '../src/index.ts';
import { DAY, HOUR, MINUTE } from '../src/util.ts';
import { device } from './fixtures.ts';

const T = Date.UTC(2026, 10, 1, 3, 0, 0);
const rev = (cardId: string, rating: Rating): EventPayload => ({ type: 'drill.review', cardId, rating, durationMs: 3000 });
const dayOf = (t: number) => { const start = Math.floor((t - 4 * HOUR) / DAY) * DAY + 4 * HOUR; return { start, end: start + DAY }; };
const META: DeckMeta = {
  count: 8,
  tiers: [
    { tier: 1, label: 'Beginner 1', count: 4, first: 'kw00001', last: 'kw00004' },
    { tier: 2, label: 'Beginner 2', count: 4, first: 'kw00005', last: 'kw00008' },
  ],
};
const SETTINGS = { newPerDay: 5, reverse: false, startTier: 0 };

/** Graduates a card (Good through the learning steps); returns the time of the last answer. */
function graduate(emit: ReturnType<typeof device>, log: AppEvent[], id: string, t: number): number {
  for (let i = 0; i < 6; i++) {
    log.push(emit(rev(id, 3), t));
    const c = replayDrill(log).cards.get(id)!;
    if (c.phase === 'review') return t;
    t = c.due;
  }
  throw new Error('no graduation');
}

describe('drill.suspend (D88)', () => {
  const emit = device('dev-s');
  test('validates', () => {
    assert.ok(validateEvent(emit({ type: 'drill.suspend', cardIds: ['kw00001:f'], suspended: true }, T)).ok);
    assert.equal(validateEvent(emit({ type: 'drill.suspend', cardIds: ['kw00001:f'] } as unknown as EventPayload, T)).ok, false);
    assert.equal(validateEvent(emit({ type: 'drill.suspend', cardIds: [], suspended: true }, T)).ok, false);
  });

  test('a suspended card leaves the queue and counts, keeps its history, and comes back on unsuspend or undo', () => {
    const log: AppEvent[] = [];
    const t1 = graduate(emit, log, 'kw00001:f', T);
    const due = replayDrill(log).cards.get('kw00001:f')!.due;
    const later = due + MINUTE;
    const day = dayOf(later);
    const sess = { newQueue: [], sinceNew: 0 };
    assert.deepEqual(pickNext(replayDrill(log), sess, later, day), { kind: 'card', cardId: 'kw00001:f', source: 'review' });
    const s = emit({ type: 'drill.suspend', cardIds: ['kw00001:f'], suspended: true }, t1 + 1000);
    log.push(s);
    const st = replayDrill(log);
    assert.equal(st.cards.get('kw00001:f')!.suspended, true);
    assert.equal(st.cards.get('kw00001:f')!.reps > 0, true);
    assert.equal(pickNext(st, sess, later, day).kind, 'done');
    const c = drillCounts(st, META, SETTINGS, later, day);
    assert.equal(c.due, 0);
    assert.equal(c.byState.suspended, 1);
    // undo restores
    const u = emit({ type: 'drill.undo', targetId: s.id }, t1 + 2000);
    assert.equal(replayDrill([...log, u]).cards.get('kw00001:f')!.suspended, false);
    // unsuspend restores
    log.push(emit({ type: 'drill.suspend', cardIds: ['kw00001:f'], suspended: false }, t1 + 3000));
    assert.equal(pickNext(replayDrill(log), sess, later, day).kind, 'card');
  });
});

describe('custom study filter (D88)', () => {
  test('pickNext only picks cards that pass `only`', () => {
    const emit = device('dev-c');
    const log: AppEvent[] = [];
    log.push(emit(rev('kw00001:f', 1), T), emit(rev('kw00005:f', 1), T));
    const st = replayDrill(log);
    const t = T + 5 * MINUTE;
    const day = dayOf(t);
    const only = (id: string) => id.startsWith('kw00005');
    const p = pickNext(st, { newQueue: [], sinceNew: 0, only }, t, day);
    assert.deepEqual(p, { kind: 'card', cardId: 'kw00005:f', source: 'learning' });
  });
});

describe('drill stats (D88)', () => {
  test('forecast, answers per day, per-tier retention, leeches and missed today', () => {
    const emit = device('dev-x');
    const log: AppEvent[] = [];
    const t1 = graduate(emit, log, 'kw00002:f', T);
    log.push(emit(rev('kw00006:f', 1), t1 + 1000));
    const st = replayDrill(log);
    const now = t1 + 2000;
    const day = dayOf(now);
    const f = dueForecast(st, day, 30);
    assert.equal(f.length, 30);
    assert.equal(f[0]!.learning, 1); // kw00006 relearn/learn step today
    const due2 = st.cards.get('kw00002:f')!.due;
    const k = due2 < day.end ? 0 : Math.floor((due2 - day.end) / DAY) + 1;
    assert.equal(f[k]!.review, 1);
    const h = answersByDay(st, day, 7);
    assert.equal(h[6]!.total, st.reviews.filter((r) => r.at >= day.start).length);
    assert.equal(h[6]!.again, 1);
    const ts = tierStats(st, META, 0);
    assert.equal(ts.find((x) => x.tier === 1)!.young, 1);
    assert.equal(ts.find((x) => x.tier === 2)!.learning, 1);
    assert.deepEqual(missedToday(st, day), ['kw00006:f']);
    assert.deepEqual(leeches(st), []);
    assert.equal(leeches(st, 0).length, 2);
  });
});
