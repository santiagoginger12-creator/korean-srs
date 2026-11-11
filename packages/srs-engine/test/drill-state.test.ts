import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  afterAnswer, applyDrillEvents, drillCounts, dueReviews, effectiveStartTier, isUnknownFutureVersion, makeBackup, mixNew,
  newForwardIds, parseBackup, pickNext, replayAll, replayDrill, reverseNewIds, schedule, newCardSched, settingPayload,
  upcastEvent, validateEvent, validateLog, canonicalJson, type AppEvent, type DeckMeta, type DrillSession, type DrillState,
  type EventPayload, type Rating,
} from '../src/index.ts';
import { DAY, HOUR, MINUTE, seededShuffle } from '../src/util.ts';
import { device, FIXTURE, lessonP, passAll } from './fixtures.ts';

const T = Date.UTC(2026, 10, 1, 3, 0, 0); // 12:00 Seoul
const rev = (cardId: string, rating: Rating, durationMs = 4000): EventPayload => ({ type: 'drill.review', cardId, rating, durationMs });
const dayOf = (t: number) => { const start = Math.floor((t - 4 * HOUR) / DAY) * DAY + 4 * HOUR; return { start, end: start + DAY }; };

const META: DeckMeta = {
  count: 12,
  tiers: [
    { tier: 1, label: 'Beginner 1', count: 4, first: 'kw00001', last: 'kw00004' },
    { tier: 2, label: 'Beginner 2', count: 4, first: 'kw00005', last: 'kw00008' },
    { tier: 3, label: 'Intermediate 1', count: 4, first: 'kw00009', last: 'kw00012' },
  ],
};
const IDS = Array.from({ length: 12 }, (_, i) => `kw${String(i + 1).padStart(5, '0')}`);
const SETTINGS = { newPerDay: 3, reverse: true, startTier: 0 };

/** Answers `cardId` with Good whenever due until its forward interval passes `days`. */
function growTo(emit: ReturnType<typeof device>, log: AppEvent[], cardId: string, days: number, start: number): number {
  let t = start;
  for (let guard = 0; guard < 30; guard++) {
    log.push(emit(rev(cardId, 3), t));
    const c = replayDrill(log).cards.get(cardId)!;
    if (c.phase === 'review' && c.ivl >= days) return t;
    t = c.due;
  }
  throw new Error('never grew');
}

describe('drill events: validation and old-app safety', () => {
  const emit = device('dev-a');
  test('valid drill events pass validateEvent', () => {
    for (const p of [rev('kw00001:f', 3), { type: 'drill.known', cardIds: ['kw00001:f', 'kw00002:r'], reason: 'tier' },
      { type: 'drill.reset' }, { type: 'drill.reset', cardIds: ['kw00001:f'] }] as EventPayload[]) {
      const r = validateEvent(emit(p, T));
      assert.ok(r.ok, JSON.stringify(r));
    }
  });

  test('malformed drill events are rejected', () => {
    const bad: Record<string, unknown>[] = [
      { type: 'drill.review', cardId: 'kw00001', rating: 3 },
      { type: 'drill.review', cardId: 'kw00001:f', rating: 5 },
      { type: 'drill.review', cardId: 'kw00001:x', rating: 1 },
      { type: 'drill.review', cardId: 'kw00001:f', rating: 2, durationMs: -1 },
      { type: 'drill.known', cardIds: [] },
      { type: 'drill.known', cardIds: ['nope'] },
      { type: 'drill.reset', cardIds: 'kw00001:f' },
      { type: 'drill.undo' },
    ];
    for (const p of bad) assert.equal(validateEvent(emit(p as EventPayload, T)).ok, false, JSON.stringify(p));
  });

  test('undo of an undo, or of a non-drill event, is rejected across a batch', () => {
    const a = emit(rev('kw00001:f', 3), T);
    const u = emit({ type: 'drill.undo', targetId: a.id }, T + 1);
    const uu = emit({ type: 'drill.undo', targetId: u.id }, T + 2);
    const l = emit(lessonP('v:가다'), T + 3);
    const ul = emit({ type: 'drill.undo', targetId: l.id }, T + 4);
    const { valid, invalid } = validateLog([a, u, uu, l, ul]);
    assert.deepEqual(valid.map((e) => e.id), [a.id, u.id, l.id]);
    assert.equal(invalid.length, 2);
  });

  test('the WaniKani replay ignores drill events entirely', () => {
    const d = device('dev-b');
    const base: AppEvent[] = [d(lessonP('v:가다'), T), ...passAll(d, 'v:가다', ['meaning', 'production'], T + 4 * HOUR)];
    const withDrill = [...base, d(rev('kw00001:f', 3), T + 5 * HOUR), d({ type: 'drill.known', cardIds: ['kw00002:f'] }, T + 6 * HOUR),
      d(settingPayload('drill.newPerDay', 50), T + 7 * HOUR)];
    const a = replayAll(FIXTURE, base);
    const b = replayAll(FIXTURE, withDrill);
    assert.deepEqual([...a.items.entries()], [...b.items.entries()]);
    assert.equal(a.userLevel, b.userLevel);
    assert.equal(b.settings['drill.newPerDay'], 50);
  });

  test('an app that does not know a drill event type quarantines it in a backup (never drops it)', () => {
    // Simulates an older app: a type it has no case for fails validation; parseBackup quarantines it.
    const d = device('dev-c');
    const future = { ...d(rev('kw00001:f', 3), T), type: 'drill.future-thing' } as unknown as AppEvent;
    const ok = d(rev('kw00002:f', 3), T + 1);
    const parsed = parseBackup(JSON.stringify(makeBackup([ok], { createdAt: '', appVersion: 't', contentVersion: 'c', deviceId: 'x' }, [future])));
    assert.ok(parsed.ok);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.events.map((e) => e.id), [ok.id]);
    assert.equal(parsed.quarantine.length, 1);
    assert.match(parsed.quarantine[0]!.reason, /unknown type/);
    assert.equal(isUnknownFutureVersion(upcastEvent(future)), false, 'still v1: it only needs a newer validator');
  });

  test('drill events survive a backup round trip and replay identically', () => {
    const d = device('dev-d');
    const log: AppEvent[] = [];
    growTo(d, log, 'kw00001:f', 10, T);
    log.push(d({ type: 'drill.known', cardIds: ['kw00005:f', 'kw00006:f'], reason: 'tier' }, T + 2 * DAY));
    const bk = makeBackup(log, { createdAt: '', appVersion: 't', contentVersion: 'c', deviceId: 'x' });
    const parsed = parseBackup(JSON.stringify(bk));
    assert.ok(parsed.ok && parsed.quarantine.length === 0);
    if (!parsed.ok) return;
    assert.equal(canonicalJson(ser(replayDrill(parsed.events))), canonicalJson(ser(replayDrill(log))));
  });
});

const ser = (s: DrillState) => ({ ...s, cards: [...s.cards.entries()].sort(), reverseUnlockedAt: [...s.reverseUnlockedAt.entries()].sort() });

describe('replayDrill', () => {
  test('applies FSRS per card in (hlc, id) order, independent of input order', () => {
    const a = device('a'), b = device('b');
    const log: AppEvent[] = [];
    let t = T;
    for (let i = 0; i < 30; i++) {
      const e = (i % 2 ? a : b)(rev(`kw0000${1 + (i % 4)}:f`, ([1, 3, 3, 4, 2] as Rating[])[i % 5]!), t);
      log.push(e);
      t += 7 * MINUTE + i * HOUR;
    }
    const ref = canonicalJson(ser(replayDrill(log)));
    for (const seed of ['x', 'y', 'z']) assert.equal(canonicalJson(ser(replayDrill(seededShuffle(log, seed)))), ref);
    assert.equal(canonicalJson(ser(replayDrill([...log, ...log.slice(0, 5)]))), ref, 'duplicates ignored');
  });

  test('a card follows the scheduler exactly (deterministic replay)', () => {
    const d = device('d');
    const ratings: Rating[] = [3, 3, 3, 1, 3, 4];
    const log: AppEvent[] = [];
    let card = newCardSched();
    let t = T;
    for (const g of ratings) { log.push(d(rev('kw00003:f', g), t)); card = schedule(card, g, t, 'kw00003:f'); t = card.due + MINUTE; }
    const c = replayDrill(log).cards.get('kw00003:f')!;
    assert.equal(c.due, card.due); assert.equal(c.ivl, card.ivl); assert.equal(c.s, card.s); assert.equal(c.lapses, 1);
    assert.equal(c.firstAt, T);
  });

  test('drill.undo removes one review; undo of the undo is ignored', () => {
    const d = device('d');
    const r1 = d(rev('kw00001:f', 3), T);
    const r2 = d(rev('kw00001:f', 1), T + 10 * MINUTE);
    const u = d({ type: 'drill.undo', targetId: r2.id }, T + 11 * MINUTE);
    const uu = d({ type: 'drill.undo', targetId: u.id }, T + 12 * MINUTE);
    const s = replayDrill([r1, r2, u, uu]);
    assert.equal(s.reviews.length, 1);
    assert.equal(s.cards.get('kw00001:f')!.step, 1, 'back to the state after the first Good');
    assert.equal(canonicalJson(ser(s)).replace(/"hlc":"[^"]+","id":"[^"]+"/, ''), canonicalJson(ser(replayDrill([r1]))).replace(/"hlc":"[^"]+","id":"[^"]+"/, ''));
  });

  test('drill.known marks cards known (not queued); undoing it restores them; reviewing clears known', () => {
    const d = device('d');
    const k = d({ type: 'drill.known', cardIds: ['kw00001:f', 'kw00002:f'], reason: 'tier' }, T);
    let s = replayDrill([k]);
    assert.ok(s.cards.get('kw00001:f')!.known);
    assert.equal(s.placements[0]!.count, 2);
    assert.equal(newForwardIds(s, IDS, 2).join(), 'kw00003:f,kw00004:f');
    s = replayDrill([k, d({ type: 'drill.undo', targetId: k.id }, T + 1)]);
    assert.equal(s.cards.size, 0);
    assert.equal(s.placements.length, 0);
    s = replayDrill([k, d(rev('kw00001:f', 3), T + 2)]);
    assert.equal(s.cards.get('kw00001:f')!.known, false);
  });

  test('drill.reset: listed cards back to new; no list = everything', () => {
    const d = device('d');
    const log: AppEvent[] = [];
    growTo(d, log, 'kw00001:f', 7, T);
    log.push(d(rev('kw00002:f', 3), T + 1000));
    let s = replayDrill([...log, d({ type: 'drill.reset', cardIds: ['kw00001:f'] }, T + 30 * DAY)]);
    assert.equal(s.cards.has('kw00001:f'), false);
    assert.equal(s.reverseUnlockedAt.has('kw00001'), false);
    assert.ok(s.cards.has('kw00002:f'));
    s = replayDrill([...log, d({ type: 'drill.reset' }, T + 30 * DAY)]);
    assert.equal(s.cards.size, 0); assert.equal(s.reviews.length, 0);
  });

  test('drill.retention is time-indexed: only later reviews use it', () => {
    const d = device('d');
    const before: AppEvent[] = [];
    const t1 = growTo(d, before, 'kw00001:f', 1, T);
    const c = replayDrill(before).cards.get('kw00001:f')!;
    const set = d(settingPayload('drill.retention', 0.97), t1 + 1000);
    const s1 = replayDrill([...before, set]);
    assert.equal(s1.cards.get('kw00001:f')!.ivl, c.ivl, 'existing schedule unchanged');
    assert.equal(s1.retention, 0.97);
    const next = d(rev('kw00001:f', 3), c.due);
    const lo = replayDrill([...before, next]).cards.get('kw00001:f')!;
    const hi = replayDrill([...before, set, next]).cards.get('kw00001:f')!;
    assert.ok(hi.ivl < lo.ivl, `${hi.ivl} < ${lo.ivl}`);
  });

  test('reverse card unlocks when the forward interval reaches 7 days, and enters the queue the next day', () => {
    const d = device('d');
    const log: AppEvent[] = [];
    const t = growTo(d, log, 'kw00001:f', 7, T);
    const s = replayDrill(log);
    assert.equal(s.reverseUnlockedAt.get('kw00001'), t);
    assert.deepEqual(reverseNewIds(s, dayOf(t), true), [], 'not the same day');
    assert.deepEqual(reverseNewIds(s, dayOf(t + DAY), true), ['kw00001:r']);
    assert.deepEqual(reverseNewIds(s, dayOf(t + DAY), false), [], 'setting off');
    // Sticky: a later lapse doesn't take it away.
    const s2 = replayDrill([...log, d(rev('kw00001:f', 1), t + 8 * DAY)]);
    assert.ok(s2.reverseUnlockedAt.has('kw00001'));
  });

  test('incremental apply equals full replay; undo/reset/out-of-order fall back', () => {
    const d = device('d');
    const log: AppEvent[] = [];
    let s = replayDrill([]);
    let t = T;
    for (let i = 0; i < 25; i++) {
      const e = d(i === 7 ? { type: 'drill.known', cardIds: ['kw00009:f'] } : i === 12 ? settingPayload('drill.retention', 0.85) : rev(`kw0000${1 + (i % 3)}:f`, ((i % 4) + 1) as Rating), t);
      log.push(e);
      const inc = applyDrillEvents(s, [e]);
      assert.ok(inc);
      s = inc!;
      assert.equal(canonicalJson(ser(s)), canonicalJson(ser(replayDrill(log))), `step ${i}`);
      t += 3 * HOUR;
    }
    assert.equal(applyDrillEvents(s, [d({ type: 'drill.undo', targetId: log[3]!.id }, t)]), null);
    assert.equal(applyDrillEvents(s, [d({ type: 'drill.reset' }, t)]), null);
    assert.equal(applyDrillEvents(s, [log[0]!]), null, 'not after lastKey');
    assert.equal(applyDrillEvents(s, [d(lessonP('v:가다'), t)]), s, 'nothing relevant: same object');
  });
});

describe('queue, counts and session picking', () => {
  test('counts: due, new today (limit and start tier), states', () => {
    const d = device('d');
    const log: AppEvent[] = [d({ type: 'drill.known', cardIds: IDS.slice(0, 4).map((i) => `${i}:f`), reason: 'tier' }, T)];
    log.push(d(rev('kw00005:f', 3), T + MINUTE));
    const s = replayDrill(log);
    const c = drillCounts(s, META, SETTINGS, T + 2 * MINUTE, dayOf(T));
    assert.equal(c.startTier, 2);
    assert.equal(c.newForward, 2, 'limit 3, one introduced today');
    assert.equal(c.learning, 1);
    assert.equal(c.byState.known, 4);
    assert.equal(c.byState.new, 7);
    assert.equal(c.reviewsToday, 1);
    assert.equal(effectiveStartTier(s, META, 3), 3);
    assert.equal(effectiveStartTier(s, META, 1), 2, 'tier 1 has nothing left');
    // Next day: full limit again.
    assert.equal(drillCounts(s, META, SETTINGS, T + DAY, dayOf(T + DAY)).newForward, 3);
  });

  test('retention over 30 days counts review-phase answers only', () => {
    const d = device('d');
    const log: AppEvent[] = [];
    const t = growTo(d, log, 'kw00001:f', 3, T);
    const c = replayDrill(log).cards.get('kw00001:f')!;
    log.push(d(rev('kw00001:f', 1), c.due));
    const r = drillCounts(replayDrill(log), META, SETTINGS, c.due + 1, dayOf(c.due)).retention30;
    assert.ok(r.total >= 1);
    assert.ok(t < c.due);
    assert.equal(r.total - r.pass, 1);
  });

  test('mixNew spreads reverse cards among forward ones', () => {
    assert.deepEqual(mixNew(['a', 'b', 'c', 'd'], ['R']), ['a', 'b', 'R', 'c', 'd']);
    assert.deepEqual(mixNew([], ['R1', 'R2']), ['R1', 'R2']);
    assert.equal(mixNew(['a', 'b', 'c', 'd', 'e', 'f'], ['R1', 'R2']).join(), 'a,b,R1,c,d,R2,e,f');
  });

  test('pickNext: learning first, reviews with new cards spread, learn-ahead, wait, done', () => {
    const d = device('d');
    const log: AppEvent[] = [];
    // Three review cards due today.
    for (const w of ['kw00001', 'kw00002', 'kw00003']) log.push(d(rev(`${w}:f`, 4), T - 20 * DAY));
    let s = replayDrill(log);
    const now = T;
    assert.equal(dueReviews(s, dayOf(now)).length, 3);
    let sess: DrillSession = { newQueue: ['kw00009:f', 'kw00010:f'], sinceNew: 0 };
    // gap = floor(3 / 3) = 1 → review first, then new.
    let p = pickNext(s, sess, now, dayOf(now));
    assert.deepEqual(p, { kind: 'card', cardId: 'kw00001:f', source: 'review' });
    log.push(d(rev('kw00001:f', 3), now)); s = replayDrill(log); sess = afterAnswer(sess, s, 'review');
    p = pickNext(s, sess, now + 1, dayOf(now));
    assert.deepEqual(p, { kind: 'card', cardId: 'kw00009:f', source: 'new' });
    log.push(d(rev('kw00009:f', 1), now + 1)); s = replayDrill(log); sess = afterAnswer(sess, s, 'new');
    assert.deepEqual(sess.newQueue, ['kw00010:f']);
    // The Again card (1m) is learning; before it's due, reviews continue.
    p = pickNext(s, sess, now + 2, dayOf(now));
    assert.equal(p.kind === 'card' && p.source, 'review');
    // Once due, it comes back first.
    p = pickNext(s, sess, now + 1 + MINUTE, dayOf(now));
    assert.deepEqual(p, { kind: 'card', cardId: 'kw00009:f', source: 'learning' });
    // Clear everything else; the learning card is then shown within the learn-ahead limit.
    log.push(d(rev('kw00002:f', 3), now + 3), d(rev('kw00003:f', 3), now + 4), d(rev('kw00010:f', 4), now + 5));
    log.push(d(rev('kw00009:f', 3), now + 2 * MINUTE)); // → 10m step
    s = replayDrill(log); sess = afterAnswer(sess, s, 'new');
    p = pickNext(s, sess, now + 3 * MINUTE, dayOf(now));
    assert.deepEqual(p, { kind: 'card', cardId: 'kw00009:f', source: 'ahead' });
    p = pickNext(s, sess, now + 3 * MINUTE, dayOf(now), 0);
    assert.deepEqual(p, { kind: 'wait', until: now + 12 * MINUTE });
    log.push(d(rev('kw00009:f', 3), now + 12 * MINUTE)); s = replayDrill(log);
    assert.deepEqual(pickNext(s, sess, now + 13 * MINUTE, dayOf(now)), { kind: 'done' });
  });

  test('known cards and K-marked queue entries are skipped', () => {
    const d = device('d');
    const s = replayDrill([d({ type: 'drill.known', cardIds: ['kw00009:f'] }, T)]);
    const p = pickNext(s, { newQueue: ['kw00009:f', 'kw00010:f'], sinceNew: 0 }, T, dayOf(T));
    assert.deepEqual(p, { kind: 'card', cardId: 'kw00010:f', source: 'new' });
  });
});
