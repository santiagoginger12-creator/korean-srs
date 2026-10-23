import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  coerceSetting, compareEvents, createEventFactory, createHlc, DEFAULT_SETTINGS, formatHlc, isUnknownFutureVersion,
  parseHlc, sortEvents, unionEvents, upcastEvent, uuidv7, UUIDV7_RE, validateEvent, validateLog, type AppEvent,
} from '../src/index.ts';
import { mulberry32 } from '../src/util.ts';
import { answerP, device, lessonP, T0 } from './fixtures.ts';

describe('HLC', () => {
  test('format is fixed-width and lexicographically sortable', () => {
    const a = formatHlc(T0, 0, 'devA');
    const b = formatHlc(T0, 1, 'devA');
    const c = formatHlc(T0 + 1, 0, 'devA');
    assert.match(a, /^[0-9a-z]{9}\.[0-9a-z]{4}\.devA$/);
    assert.ok(a < b && b < c);
    assert.deepEqual(parseHlc(b), { ms: T0, counter: 1, deviceId: 'devA' });
    assert.ok(formatHlc(9, 0, 'x') < formatHlc(10, 0, 'x')); // padding matters
  });

  test('now() is strictly increasing even if the wall clock stalls or goes backwards', () => {
    let t = T0;
    const h = createHlc('d1', () => t);
    const seen: string[] = [];
    for (const step of [0, 0, 5, -1000, 0, 3000]) { t += step; seen.push(h.now()); }
    for (let i = 1; i < seen.length; i++) assert.ok(seen[i - 1]! < seen[i]!, `${seen[i - 1]} < ${seen[i]}`);
  });

  test('observe() advances past a remote HLC from a device with a fast clock', () => {
    const local = createHlc('a', () => T0);
    const remote = formatHlc(T0 + 60_000, 7, 'b');
    local.observe(remote);
    const next = local.now();
    assert.ok(next > remote);
    assert.equal(parseHlc(next).ms, T0 + 60_000);
    assert.equal(parseHlc(next).counter, 8);
  });

  test('observe() with same ms/counter but different device still sorts after', () => {
    const local = createHlc('a', () => T0);
    const remote = formatHlc(T0, 3, 'zzz');
    local.observe(remote);
    assert.ok(local.now() > remote);
  });

  test('resumes from a persisted last value', () => {
    const h = createHlc('d', () => T0 - 10_000, formatHlc(T0, 5, 'd'));
    assert.equal(h.now(), formatHlc(T0, 6, 'd'));
  });
});

describe('UUIDv7', () => {
  test('format, version, variant, and time ordering', () => {
    const rng = mulberry32(1);
    const a = uuidv7(() => T0, rng);
    const b = uuidv7(() => T0 + 1, rng);
    assert.match(a, UUIDV7_RE);
    assert.ok(a < b);
    assert.equal(parseInt(a.replace(/-/g, '').slice(0, 12), 16), T0);
  });
  test('deterministic for a fixed clock and rng', () => {
    assert.equal(uuidv7(() => T0, mulberry32(9)), uuidv7(() => T0, mulberry32(9)));
  });
});

describe('events', () => {
  const emit = device('d1');
  const lesson = emit(lessonP('v:결정'), T0);
  const ans = emit(answerP('v:결정', 'meaning', 'incorrect'), T0 + 1);

  test('compareEvents orders by (hlc, id)', () => {
    const x = { ...lesson, hlc: 'a', id: '2' };
    const y = { ...lesson, hlc: 'a', id: '3' };
    const z = { ...lesson, hlc: 'b', id: '1' };
    assert.deepEqual([z, y, x].sort(compareEvents), [x, y, z]);
  });

  test('sortEvents/unionEvents dedupe by id', () => {
    assert.deepEqual(sortEvents([ans, lesson, ans]), [lesson, ans]);
    assert.deepEqual(unionEvents([ans], [lesson, ans]), [lesson, ans]);
  });

  test('validateEvent accepts valid events', () => {
    assert.equal(validateEvent(lesson).ok, true);
    assert.equal(validateEvent(ans).ok, true);
    assert.equal(validateEvent(emit({ type: 'settings.set', key: 'lessonBatch', value: 3 }, T0)).ok, true);
    assert.equal(validateEvent(emit({ type: 'note.set', itemId: 'v:x', field: 'mnemonic', text: '' }, T0)).ok, true);
  });

  test('validateEvent rejects malformed events', () => {
    const bad: unknown[] = [
      null, 5, { ...lesson, v: 2 }, { ...lesson, id: '' }, { ...lesson, hlc: 'nope' }, { ...lesson, deviceId: undefined },
      { ...lesson, at: 'x' }, { ...lesson, itemId: undefined }, { ...lesson, type: 'bogus' },
      { ...ans, qtype: 'essay' }, { ...ans, grade: 'meh' }, { ...ans, check: { layer: 'x' } },
      { ...ans, requiredQTypes: [] }, { ...ans, durationMs: -1 }, { ...ans, overrides: 'zzz' } /* not selfGraded */,
      { ...ans, response: undefined },
      { ...emit({ type: 'event.void', targetId: 'abc', reason: 'undo' }, T0), reason: 'oops' },
      { ...emit({ type: 'item.reset', itemId: 'v:x', toStage: 1 }, T0), toStage: 2 },
      { ...emit({ type: 'customItem.upsert', item: { id: 'c:1', kind: 'vocab', level: 1 } as never }, T0), item: { id: 'c:1', kind: 'alien', level: 1 } },
    ];
    for (const b of bad) assert.equal(validateEvent(b).ok, false, JSON.stringify(b));
  });

  test('a void of a void (and of itself) is rejected', () => {
    const v1 = emit({ type: 'event.void', targetId: ans.id, reason: 'undo' }, T0 + 2);
    const v2 = emit({ type: 'event.void', targetId: v1.id, reason: 'undo' }, T0 + 3);
    const self = { ...v1, targetId: v1.id };
    const { valid, invalid } = validateLog([lesson, ans, v1, v2]);
    assert.deepEqual(valid.map((e) => e.id), [lesson.id, ans.id, v1.id]);
    assert.equal(invalid[0]!.error, 'void of a void');
    assert.equal(validateEvent(self).ok, false);
  });

  test('upcastEvent: v1 identity, future versions flagged, junk throws', () => {
    assert.equal(upcastEvent(lesson), lesson);
    const fut = upcastEvent({ ...lesson, v: 2, newField: 1 });
    assert.ok(isUnknownFutureVersion(fut));
    assert.equal((fut as { raw: { v: number } }).raw.v, 2);
    assert.throws(() => upcastEvent({ type: 'x' }));
    assert.throws(() => upcastEvent('str'));
  });

  test('settings defaults and coercion', () => {
    assert.deepEqual(DEFAULT_SETTINGS['srs.intervals'].map((ms) => ms / 3_600_000), [4, 8, 24, 48, 168, 336, 720, 2880]);
    assert.equal(DEFAULT_SETTINGS['srs.scheduler'], 'wk');
    assert.equal(DEFAULT_SETTINGS.lessonBatch, 5);
    assert.equal(DEFAULT_SETTINGS.maxLessonsPerDay, 20);
    assert.equal(DEFAULT_SETTINGS.targetReviewMin, 45);
    assert.equal(DEFAULT_SETTINGS.dayStartHour, 4);
    assert.equal(coerceSetting('dayStartHour', 24), undefined);
    assert.equal(coerceSetting('srs.intervals', [1, 2]), undefined);
    assert.deepEqual(coerceSetting('enabledQTypes', ['meaning', 'meaning']), ['meaning']);
    assert.equal(coerceSetting('enabledQTypes', ['essay']), undefined);
  });

  test('createEventFactory produces valid, ordered events', () => {
    let t = T0;
    const rng = mulberry32(3);
    const mk = createEventFactory({ deviceId: 'dev', hlc: createHlc('dev', () => t), clock: () => t, rng });
    const a: AppEvent = mk(lessonP('v:x'));
    const b: AppEvent = mk(lessonP('v:y'), T0 - 5);
    assert.ok(validateEvent(a).ok && validateEvent(b).ok);
    assert.ok(compareEvents(a, b) < 0);
    assert.equal(b.at, T0 - 5);
  });
});
