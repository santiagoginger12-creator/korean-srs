import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyEvents, createHlc, DEFAULT_INTERVALS, dueItems, isLeech, noteKey, replayAll, troubleItems, userAnswerKey, type AppEvent,
} from '../src/index.ts';
import { DAY, HOUR, MINUTE } from '../src/util.ts';
import { advance, answerP, bundle, canon, device, FIXTURE, lessonP, passAll, T0, vocab } from './fixtures.ts';

const MP = ['meaning', 'production'] as const;
const V = 'v:망설이다';

describe('replay: lessons and the success path', () => {
  test('lesson sets stage 1 and availableAt = floorHour(at + 4h)', () => {
    const d = device('d1');
    const s = replayAll(FIXTURE, [d(lessonP(V), T0 + 37 * MINUTE)]);
    const st = s.items.get(V)!;
    assert.equal(st.stage, 1);
    assert.equal(st.availableAt, T0 + 4 * HOUR);
    assert.equal(st.lessonAt, T0 + 37 * MINUTE);
    assert.equal(st.pending, null);
  });

  test('8 clean reviews burn the item; passedAt set on first reaching stage 5', () => {
    const d = device('d1');
    const log: AppEvent[] = [d(lessonP(V), T0)];
    log.push(...advance(FIXTURE, log, d, V, 8, [...MP]));
    const st = replayAll(FIXTURE, log).items.get(V)!;
    assert.equal(st.stage, 9);
    assert.equal(st.availableAt, null);
    const reviewTimes = [...new Set(log.filter((e) => e.type === 'review.answer').map((e) => e.at - (e.type === 'review.answer' && e.qtype === 'production' ? 1 : 0)))];
    assert.equal(reviewTimes.length, 8);
    assert.equal(st.passedAt, reviewTimes[3]! + 1); // 4th review completes at the production answer
    assert.equal(st.burnedAt, reviewTimes[7]! + 1);
    assert.equal(st.stats.reviews, 8);
    assert.equal(st.stats.correct, 8);
    assert.equal(st.stats.streak, 8);
    // Expected review times: cumulative default intervals from T0.
    let t = T0;
    for (let i = 0; i < 8; i++) { t += DEFAULT_INTERVALS[i]!; assert.equal(reviewTimes[i], t, `review ${i + 1}`); t += 1; t = Math.floor(t / HOUR) * HOUR; }
  });

  test('duplicate lesson.completed (two devices offline) is a no-op', () => {
    const a = device('a');
    const b = device('b');
    const s = replayAll(FIXTURE, [a(lessonP(V), T0), b(lessonP(V), T0 + 2 * HOUR)]);
    assert.equal(s.items.get(V)!.availableAt, T0 + 4 * HOUR);
  });

  test('reviews before any lesson are ignored', () => {
    const d = device('d');
    const s = replayAll(FIXTURE, [d(answerP(V, 'meaning', 'correct', ['meaning']), T0)]);
    assert.equal(s.items.has(V), false);
  });
});

describe('replay: dueness gate (§6.1.3, D5)', () => {
  test('answer more than 5 min early is ignored but counts toward leech stats', () => {
    const d = device('d');
    const log = [d(lessonP(V), T0)]; // available at T0+4h
    log.push(d(answerP(V, 'meaning', 'incorrect', [...MP]), T0 + 4 * HOUR - 6 * MINUTE));
    log.push(d(answerP(V, 'production', 'correct', [...MP]), T0 + 4 * HOUR - 6 * MINUTE));
    const st = replayAll(FIXTURE, log).items.get(V)!;
    assert.equal(st.stage, 1);
    assert.equal(st.pending, null);
    assert.equal(st.stats.ignoredEarly, 2);
    assert.equal(st.stats.incorrect, 1);
    assert.equal(st.recentIncorrectAts.length, 1);
    assert.equal(st.stats.reviews, 0);
  });

  test('answer exactly 5 min early takes effect', () => {
    const d = device('d');
    const log = [d(lessonP(V), T0), ...passAll(d, V, [...MP], T0 + 4 * HOUR - 5 * MINUTE)];
    const st = replayAll(FIXTURE, log).items.get(V)!;
    assert.equal(st.stage, 2);
    assert.equal(st.stats.ignoredEarly, 0);
  });

  test('concurrent offline reviews: first by HLC wins, second is a no-op', () => {
    const a = device('a');
    const b = device('b');
    const lesson = a(lessonP(V), T0);
    const due = T0 + 4 * HOUR;
    const fromA = passAll(a, V, [...MP], due + MINUTE);
    const fromB = [b(answerP(V, 'meaning', 'incorrect', [...MP]), due + 2 * MINUTE), ...passAll(b, V, [...MP], due + 3 * MINUTE)];
    const st = replayAll(FIXTURE, [lesson, ...fromB, ...fromA]).items.get(V)!;
    assert.equal(st.stage, 2); // A's clean review; B's answers gated (next due is +8h)
    assert.equal(st.stats.ignoredEarly, 3);
    assert.equal(st.stats.incorrect, 1); // B's wrong answer still feeds leech stats
    assert.equal(st.stats.streak, 0);
  });
});

describe('replay: pending groups across qtypes (§6.1.4)', () => {
  const C3 = bundle([vocab('셋', 1, {
    questionTypes: ['meaning', 'production', 'cloze'],
    questions: {
      meaning: { accepted: ['three'] }, production: { promptEn: 'three', accepted: ['셋'] },
      cloze: [{ id: 'c', sentence: '{{}}', en: 'e', cue: 'c', accepted: ['셋'], particleTolerance: 'none' }],
    },
  })]);
  const ID = 'v:셋';
  const R3 = ['meaning', 'production', 'cloze'] as const;

  test('wrong answers interleaved across 3 qtypes; incorrect counts every wrong submission', () => {
    const d = device('d');
    const log: AppEvent[] = [d(lessonP(ID), T0)];
    log.push(...advance(C3, log, d, ID, 3, [...R3])); // → stage 4
    const due = replayAll(C3, log).items.get(ID)!.availableAt!;
    const seq = [
      answerP(ID, 'meaning', 'incorrect', [...R3]),
      answerP(ID, 'production', 'correct', [...R3]),
      answerP(ID, 'meaning', 'incorrect', [...R3]),
      answerP(ID, 'meaning', 'correct', [...R3]),
      answerP(ID, 'cloze', 'incorrect', [...R3]),
    ].map((p, i) => d(p, due + i * MINUTE));
    const mid = replayAll(C3, [...log, ...seq]).items.get(ID)!;
    assert.equal(mid.stage, 4);
    assert.deepEqual(mid.pending, { answered: ['production', 'meaning'], incorrect: 3, since: due, closeAttempts: 0 });
    const done = d(answerP(ID, 'cloze', 'correct', [...R3]), due + 10 * MINUTE);
    const st = replayAll(C3, [...log, ...seq, done]).items.get(ID)!;
    assert.equal(st.pending, null);
    assert.equal(st.stage, 2); // 4 − ceil(3/2)×1
    assert.equal(st.availableAt, Math.floor((due + 10 * MINUTE + 8 * HOUR) / HOUR) * HOUR);
    assert.equal(st.stats.streak, 0);
  });

  test('a group can be completed across devices', () => {
    const a = device('a');
    const b = device('b');
    const log = [a(lessonP(ID), T0)];
    const due = T0 + 4 * HOUR;
    log.push(a(answerP(ID, 'meaning', 'correct', [...R3]), due), b(answerP(ID, 'production', 'correct', [...R3]), due + 1),
      a(answerP(ID, 'cloze', 'correct', [...R3]), due + 2));
    assert.equal(replayAll(C3, log).items.get(ID)!.stage, 2);
  });

  test('requiredQTypes are taken from the latest answer in the group', () => {
    const d = device('d');
    const log = [d(lessonP(ID), T0)];
    const due = T0 + 4 * HOUR;
    log.push(d(answerP(ID, 'meaning', 'correct', [...R3]), due), d(answerP(ID, 'production', 'correct', ['meaning', 'production']), due + 1));
    assert.equal(replayAll(C3, log).items.get(ID)!.stage, 2);
  });

  test('closeAttempts accumulate in the pending group', () => {
    const d = device('d');
    const log = [d(lessonP(ID), T0), d(answerP(ID, 'meaning', 'correct', [...R3], { check: { layer: 'exact', closeAttempts: 2 } }), T0 + 4 * HOUR)];
    assert.equal(replayAll(C3, log).items.get(ID)!.pending!.closeAttempts, 2);
  });
});

describe('replay: undo and overrides (§6.2)', () => {
  const d = device('d');
  const lesson = d(lessonP(V), T0);
  const due = T0 + 4 * HOUR;
  const wrong = d(answerP(V, 'meaning', 'incorrect', [...MP]), due);
  const m = d(answerP(V, 'meaning', 'correct', [...MP]), due + 1);
  const p = d(answerP(V, 'production', 'correct', [...MP]), due + 2);

  test('X then void(X) ≡ log without X', () => {
    const v = d({ type: 'event.void', targetId: wrong.id, reason: 'undo' }, due + 3);
    const withVoid = replayAll(FIXTURE, [lesson, wrong, m, p, v]);
    const without = replayAll(FIXTURE, [lesson, m, p]);
    assert.deepEqual(withVoid.items.get(V), without.items.get(V));
    assert.equal(withVoid.items.get(V)!.stage, 2);
  });

  test('a void of a void is ignored by replay', () => {
    const v1 = d({ type: 'event.void', targetId: wrong.id, reason: 'undo' }, due + 3);
    const v2 = d({ type: 'event.void', targetId: v1.id, reason: 'undo' }, due + 4);
    const s = replayAll(FIXTURE, [lesson, wrong, m, p, v1, v2]);
    assert.equal(s.items.get(V)!.stage, 2); // wrong stays voided
  });

  test('override ≡ correct answer in place of the wrong one', () => {
    const o = device('d2')(answerP(V, 'meaning', 'correct', [...MP], { selfGraded: true, overrides: wrong.id }), due + 1);
    const over = replayAll(FIXTURE, [lesson, wrong, o, p]).items.get(V)!;
    const clean = replayAll(FIXTURE, [lesson, m, p]).items.get(V)!;
    assert.equal(over.stats.selfGraded, 1);
    assert.deepEqual({ ...over, stats: { ...over.stats, selfGraded: 0 } }, clean);
  });

  test('voiding the override restores the wrong answer', () => {
    const o = device('d3')(answerP(V, 'meaning', 'correct', [...MP], { selfGraded: true, overrides: wrong.id }), due + 1);
    const vo = d({ type: 'event.void', targetId: o.id, reason: 'undo' }, due + 2);
    const st = replayAll(FIXTURE, [lesson, wrong, o, vo, m, p]).items.get(V)!;
    assert.equal(st.stage, 1); // 1 wrong at Apprentice 1 → stays 1
    assert.equal(st.stats.incorrect, 1);
  });
});

describe('replay: item.reset, hanja, unknown ids, redirects', () => {
  test('item.reset resurrects a burned item to Apprentice 1; passedAt stays sticky', () => {
    const d = device('d');
    const log: AppEvent[] = [d(lessonP(V), T0)];
    log.push(...advance(FIXTURE, log, d, V, 8, [...MP]));
    const burned = replayAll(FIXTURE, log).items.get(V)!;
    const tReset = burned.burnedAt! + DAY + 17 * MINUTE;
    log.push(d({ type: 'item.reset', itemId: V, toStage: 1 }, tReset));
    const st = replayAll(FIXTURE, log).items.get(V)!;
    assert.equal(st.stage, 1);
    assert.equal(st.availableAt, Math.floor((tReset + 4 * HOUR) / HOUR) * HOUR);
    assert.equal(st.burnedAt, undefined);
    assert.equal(st.passedAt, burned.passedAt);
  });

  test('hanja lesson records lessonAt only: no stage, never due, reviews and resets ignored', () => {
    const d = device('d');
    const H = 'h:決';
    const log = [d(lessonP(H), T0), d(answerP(H, 'meaning', 'correct'), T0 + 5 * HOUR), d({ type: 'item.reset', itemId: H, toStage: 1 }, T0 + 6 * HOUR)];
    const s = replayAll(FIXTURE, log);
    const st = s.items.get(H)!;
    assert.equal(st.stage, 0);
    assert.equal(st.availableAt, null);
    assert.equal(st.lessonAt, T0);
    assert.deepEqual(dueItems(s, T0 + 365 * DAY), []);
  });

  test('unknown item ids are handled gracefully', () => {
    const d = device('d');
    const s = replayAll(FIXTURE, [d(lessonP('v:없는-단어'), T0), d(answerP('v:없는-단어', 'meaning', 'correct'), T0 + 5 * HOUR),
      d({ type: 'note.set', itemId: 'v:없는-단어', field: 'meaning', text: 'n' }, T0)]);
    assert.equal(s.items.has('v:없는-단어'), false);
    assert.equal(s.notes.get(noteKey('v:없는-단어', 'meaning')), 'n'); // registers are kept
  });

  test('idRedirects: history on a renamed id applies to the new id', () => {
    const b = bundle([vocab('새', 1)], { 'v:옛': 'v:중간', 'v:중간': 'v:새' });
    const d = device('d');
    const s = replayAll(b, [d(lessonP('v:옛'), T0), ...passAll(d, 'v:옛', [...MP], T0 + 4 * HOUR),
      d({ type: 'note.set', itemId: 'v:옛', field: 'usage', text: 'u' }, T0)]);
    assert.equal(s.items.get('v:새')!.stage, 2);
    assert.equal(s.items.has('v:옛'), false);
    assert.equal(s.notes.get(noteKey('v:새', 'usage')), 'u');
  });
});

describe('replay: LWW registers', () => {
  test('notes from two devices: latest HLC wins regardless of arrival order', () => {
    const a = device('a');
    const b = device('b');
    const na = a({ type: 'note.set', itemId: V, field: 'mnemonic', text: 'from A' }, T0 + 10_000);
    const nb = b({ type: 'note.set', itemId: V, field: 'mnemonic', text: 'from B' }, T0 + 5_000);
    for (const order of [[na, nb], [nb, na]]) {
      assert.equal(replayAll(FIXTURE, order).notes.get(noteKey(V, 'mnemonic')), 'from A');
    }
  });

  test('a device with a slow clock that observed the other device still wins with its later edit', () => {
    const a = device('a');
    const na = a({ type: 'note.set', itemId: V, field: 'meaning', text: 'A' }, T0 + HOUR);
    // B's wall clock is an hour behind, but it ingested A's event first (hlc.observe).
    const hb = createHlc('b', () => T0);
    hb.observe(na.hlc);
    const nb: AppEvent = { id: 'b-1', v: 1, hlc: hb.now(), deviceId: 'b', at: T0, type: 'note.set', itemId: V, field: 'meaning', text: 'B' };
    assert.equal(replayAll(FIXTURE, [nb, na]).notes.get(noteKey(V, 'meaning')), 'B');
  });

  test('empty note text clears the note', () => {
    const d = device('d');
    const s = replayAll(FIXTURE, [d({ type: 'note.set', itemId: V, field: 'usage', text: 'x' }, T0),
      d({ type: 'note.set', itemId: V, field: 'usage', text: '' }, T0 + 1)]);
    assert.equal(s.notes.has(noteKey(V, 'usage')), false);
  });

  test('settings: latest wins, invalid values ignored', () => {
    const d = device('d');
    const s = replayAll(FIXTURE, [d({ type: 'settings.set', key: 'lessonBatch', value: 7 }, T0),
      d({ type: 'settings.set', key: 'lessonBatch', value: -3 }, T0 + 1), d({ type: 'settings.set', key: 'unknownKey' as never, value: 1 }, T0 + 2)]);
    assert.equal(s.settings.lessonBatch, 7);
    assert.equal('unknownKey' in s.settings, false);
  });

  test('userAnswers add/remove per answer, latest wins', () => {
    const d = device('d');
    const k = userAnswerKey(V, 'meaning');
    const s = replayAll(FIXTURE, [
      d({ type: 'userAnswer.add', itemId: V, qtype: 'meaning', answer: 'waver' }, T0),
      d({ type: 'userAnswer.add', itemId: V, qtype: 'meaning', answer: 'dither' }, T0 + 1),
      d({ type: 'userAnswer.remove', itemId: V, qtype: 'meaning', answer: 'waver' }, T0 + 2),
    ]);
    assert.deepEqual(s.userAnswers.get(k), ['dither']);
  });

  test('custom items join the content index; delete removes their state', () => {
    const d = device('d');
    const item = vocab('사용자', 1);
    const up = d({ type: 'customItem.upsert', item }, T0);
    const s = replayAll(FIXTURE, [up, d(lessonP(item.id), T0 + 1)]);
    assert.equal(s.customItems.get(item.id), item);
    assert.equal(s.index.byId.get(item.id), item);
    assert.equal(s.items.get(item.id)!.stage, 1);
    assert.ok(s.unlocked.has(item.id));
    const s2 = replayAll(FIXTURE, [up, d(lessonP(item.id), T0 + 1), d({ type: 'customItem.delete', itemId: item.id }, T0 + 2)]);
    assert.equal(s2.items.has(item.id), false);
    assert.equal(s2.customItems.size, 0);
  });
});

describe('replay: time-indexed SRS settings (D6)', () => {
  test('interval change applies only to reviews after it, never rewrites history', () => {
    const d = device('d');
    const fast = [HOUR, HOUR, HOUR, HOUR, HOUR, HOUR, HOUR, HOUR];
    const log = [d(lessonP(V), T0)]; // availableAt T0+4h under defaults
    log.push(d({ type: 'settings.set', key: 'srs.intervals', value: fast }, T0 + HOUR));
    let st = replayAll(FIXTURE, log).items.get(V)!;
    assert.equal(st.availableAt, T0 + 4 * HOUR); // lesson's availableAt not rewritten
    log.push(...passAll(d, V, [...MP], T0 + 4 * HOUR));
    st = replayAll(FIXTURE, log).items.get(V)!;
    assert.equal(st.stage, 2);
    assert.equal(st.availableAt, T0 + 5 * HOUR); // new interval for stage 2 = 1h
  });

  test('a review before the change uses the old intervals', () => {
    const d = device('d');
    const log = [d(lessonP(V), T0), ...passAll(d, V, [...MP], T0 + 4 * HOUR)];
    log.push(d({ type: 'settings.set', key: 'srs.intervals', value: [1, 1, 1, 1, 1, 1, 1, 1].map((x) => x * HOUR) }, T0 + 5 * HOUR));
    assert.equal(replayAll(FIXTURE, log).items.get(V)!.availableAt, T0 + 12 * HOUR);
  });

  test("scheduler 'fsrs' falls back to wk and sets flags.fsrsFallback", () => {
    const d = device('d');
    const log = [d({ type: 'settings.set', key: 'srs.scheduler', value: 'fsrs' }, T0), d(lessonP(V), T0), ...passAll(d, V, [...MP], T0 + 4 * HOUR)];
    const s = replayAll(FIXTURE, log);
    assert.equal(s.flags.fsrsFallback, true);
    assert.equal(s.settings['srs.scheduler'], 'fsrs');
    assert.equal(s.items.get(V)!.stage, 2);
    assert.equal(replayAll(FIXTURE, []).flags.fsrsFallback, false);
  });
});

describe('replay: leeches', () => {
  test('repeated failures make a leech; trouble list sorted by score', () => {
    const d = device('d');
    const log: AppEvent[] = [d(lessonP(V), T0)];
    for (let r = 0; r < 5; r++) {
      const st = replayAll(FIXTURE, log).items.get(V)!;
      const t = st.availableAt!;
      log.push(d(answerP(V, 'meaning', 'incorrect', [...MP]), t), ...passAll(d, V, [...MP], t + 1));
    }
    const s = replayAll(FIXTURE, log);
    const st = s.items.get(V)!;
    assert.equal(st.stats.reviews, 5);
    assert.equal(st.stats.incorrect, 5);
    assert.equal(st.stats.streak, 0);
    assert.equal(st.leechScore, 5);
    assert.ok(isLeech(st));
    assert.deepEqual(troubleItems(s), [{ itemId: V, score: 5 }]);
    // Outside the 90-day window the score decays to 0.
    assert.deepEqual(troubleItems(s, 10, T0 + 200 * DAY), []);
  });
});

describe('applyEvents ≡ replayAll', () => {
  test('incremental answers, voids, notes, and SRS settings', () => {
    const d = device('d');
    const A: AppEvent[] = [d(lessonP(V), T0), d(lessonP('h:決'), T0), d(lessonP('h:定'), T0)];
    const prev = replayAll(FIXTURE, A);
    const wrong = d(answerP(V, 'meaning', 'incorrect', [...MP]), T0 + 4 * HOUR);
    const batches: AppEvent[][] = [
      [wrong, ...passAll(d, V, [...MP], T0 + 4 * HOUR + 1), d(lessonP('v:결정'), T0 + 5 * HOUR)],
      [d({ type: 'event.void', targetId: wrong.id, reason: 'undo' }, T0 + 5 * HOUR)],
      [d({ type: 'note.set', itemId: V, field: 'meaning', text: 'x' }, T0 + 6 * HOUR)],
      [d({ type: 'settings.set', key: 'srs.intervals', value: Array(8).fill(HOUR) }, T0 + 2 * HOUR)],
      [d({ type: 'customItem.upsert', item: vocab('추가', 1) }, T0 + 7 * HOUR)],
    ];
    let all = A;
    let state = prev;
    for (const B of batches) {
      all = [...all, ...B];
      const r = applyEvents(state, FIXTURE, all, B);
      state = r.state;
      assert.equal(canon(state), canon(replayAll(FIXTURE, all)));
    }
    const r = applyEvents(prev, FIXTURE, [...A, wrong], [wrong]);
    assert.deepEqual(r.changed, [V]);
  });
});
