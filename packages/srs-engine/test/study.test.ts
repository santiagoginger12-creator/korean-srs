import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultAppSettings, extraStudyItems, replayAll, resetCandidates, settingPayload, variantsInbox, isLeech,
  type AppEvent, type EventPayload,
} from '../src/index.ts';
import { DAY, HOUR } from '../src/util.ts';
import { advance, answerP, bundle, device, FIXTURE, lessonP, T0, vocab } from './fixtures.ts';

const variantP = (itemId: string, response: string, o: Record<string, unknown> = {}): EventPayload =>
  answerP(itemId, 'production', 'correct', ['meaning', 'production'], {
    response, check: { layer: 'variant', closeAttempts: 0, matched: '망설이다' }, ...o,
  } as never);

describe('settings (M5 keys)', () => {
  test('tts.* are folded LWW, inbox.dismissed as a union; bad values ignored; unknown keys still ignored', () => {
    const a = device('a');
    const log: AppEvent[] = [
      a(settingPayload('tts.rate', 1.2), T0),
      a({ type: 'settings.set', key: 'tts.rate' as never, value: 3 }, T0 + 1),           // out of range
      a(settingPayload('tts.autoplay', true), T0 + 2),
      a({ type: 'settings.set', key: 'tts.autoplay' as never, value: 'yes' }, T0 + 3),   // wrong type
      a(settingPayload('tts.voiceURI', 'com.apple.voice.Yuna'), T0 + 4),
      a(settingPayload('inbox.dismissed', ['e1', 'e2', 'e1']), T0 + 5),
      a({ type: 'settings.set', key: 'inbox.dismissed' as never, value: ['ok', 7] }, T0 + 6), // not all strings
      a({ type: 'settings.set', key: 'future.key' as never, value: 1 }, T0 + 7),
      a(settingPayload('ttsRate', 0.8), T0 + 8),                                          // legacy M1 key still works
    ];
    const s = replayAll(FIXTURE, log).settings;
    assert.equal(s['tts.rate'], 1.2);
    assert.equal(s['tts.autoplay'], true);
    assert.equal(s['tts.voiceURI'], 'com.apple.voice.Yuna');
    assert.deepEqual(s['inbox.dismissed'], ['e1', 'e2']);
    assert.equal(s.ttsRate, 0.8);
    assert.equal((s as unknown as Record<string, unknown>)['future.key'], undefined);
    const d = replayAll(FIXTURE, []).settings;
    assert.deepEqual(d, defaultAppSettings());
    assert.deepEqual([d['inbox.dismissed'], d['tts.rate'], d['tts.autoplay'], d['tts.voiceURI']], [[], 1, false, '']);
    assert.equal(replayAll(FIXTURE, [a(settingPayload('tts.rate', 0.5), T0)]).settings['tts.rate'], 0.5);
    assert.equal(replayAll(FIXTURE, [a({ type: 'settings.set', key: 'tts.rate' as never, value: 0.49 }, T0)]).settings['tts.rate'], 1);
  });
});

describe('variantsInbox', () => {
  test('live variant answers, newest first, deduped, minus user answers and dismissals', () => {
    const a = device('a');
    const t = T0 + 5 * HOUR;
    const v1 = a(variantP('v:망설이다', '망설였다', { promptId: 'p1' }), t);
    const v2 = a(variantP('v:망설이다', '망설였다.  ', {}), t + 1);       // same normalized response → deduped
    const v3 = a(variantP('v:베개', '베게', {}), t + 2);
    const v4 = a(variantP('v:결제', '결제함', {}), t + 3);
    const v5 = a(variantP('v:덤', '덤으로', {}), t + 4);
    const notVariant = a(answerP('v:덤', 'meaning', 'correct', ['meaning'], { check: { layer: 'exact', closeAttempts: 0 } } as never), t + 5);
    const wrongVariant = a(answerP('v:덤', 'meaning', 'incorrect', ['meaning'], { response: 'x', check: { layer: 'variant', closeAttempts: 0 } } as never), t + 6);
    const log: AppEvent[] = [
      v1, v2, v3, v4, v5, notVariant, wrongVariant,
      a({ type: 'event.void', targetId: v4.id, reason: 'undo' }, t + 10),                       // undone → gone
      a({ type: 'userAnswer.add', itemId: 'v:베개', qtype: 'production', answer: '베게' }, t + 11), // curated → gone
      a(settingPayload('inbox.dismissed', [v5.id]), t + 12),                                     // dismissed → gone
    ];
    const s = replayAll(FIXTURE, log);
    const inbox = variantsInbox(s, log);
    assert.deepEqual(inbox, [{
      eventId: v2.id, itemId: 'v:망설이다', qtype: 'production', response: '망설였다.  ', at: t + 1, matched: '망설이다',
    }]);
    // Dismissing the shown (newest) id hides older duplicates too.
    const log2 = [...log, a(settingPayload('inbox.dismissed', [v5.id, v2.id]), t + 13)];
    assert.deepEqual(variantsInbox(replayAll(FIXTURE, log2), log2), []);
    // Removing the user answer brings 베게 back; ordering is newest first.
    const log3 = [...log, a({ type: 'userAnswer.remove', itemId: 'v:베개', qtype: 'production', answer: '베게' }, t + 14)];
    assert.deepEqual(variantsInbox(replayAll(FIXTURE, log3), log3).map((e) => e.response), ['베게', '망설였다.  ']);
    // The promptId of the newest duplicate is carried (v2 has none; v1's p1 is not leaked).
    assert.equal('promptId' in inbox[0]!, false);
    // Order-independent.
    assert.deepEqual(variantsInbox(s, [...log].reverse()), inbox);
  });
});

describe('variantsInbox across devices (QA)', () => {
  test('dismissals made on two devices offline both survive a merge (grow-only set, not LWW)', () => {
    const a = device('a');
    const b = device('b');
    const t = T0 + 5 * HOUR;
    const v1 = a(variantP('v:망설이다', '망설였다'), t);
    const v2 = a(variantP('v:베개', '베게'), t + 1);
    const shared = [v1, v2];
    // A dismisses v1, B (later HLC) dismisses v2 from a list that doesn't know about v1's dismissal.
    const onA = [...shared, a(settingPayload('inbox.dismissed', [v1.id]), t + 10)];
    const onB = [...shared, b(settingPayload('inbox.dismissed', [v2.id]), t + 20)];
    const merged = [...onA, ...onB.slice(shared.length)];
    const s = replayAll(FIXTURE, merged);
    assert.deepEqual([...s.settings['inbox.dismissed']].sort(), [v1.id, v2.id].sort());
    assert.deepEqual(variantsInbox(s, merged), []);
    // Order-independent and idempotent.
    const again = [...merged].reverse().concat(merged);
    assert.deepEqual(variantsInbox(replayAll(FIXTURE, again), again), []);
  });
});

/** Lesson + `clean` clean reviews, then `early` incorrect answers before the item is due (D5: leech stats, no stage change). */
function leech(emit: ReturnType<typeof device>, itemId: string, clean: number, early: number, log: AppEvent[]): AppEvent[] {
  const evs: AppEvent[] = [emit(lessonP(itemId), T0)];
  evs.push(...advance(FIXTURE, [...log, ...evs], emit, itemId, clean));
  const st = replayAll(FIXTURE, [...log, ...evs]).items.get(itemId)!;
  for (let i = 0; i < early; i++) evs.push(emit(answerP(itemId, 'meaning', 'incorrect', ['meaning', 'production']), st.availableAt! - DAY + i));
  return evs;
}

/** Lesson + `n` review groups that each start with one wrong answer (stage stays 1). */
function failing(emit: ReturnType<typeof device>, itemId: string, n: number, log: AppEvent[]): AppEvent[] {
  const evs: AppEvent[] = [emit(lessonP(itemId), T0)];
  for (let k = 0; k < n; k++) {
    const st = replayAll(FIXTURE, [...log, ...evs]).items.get(itemId)!;
    const t = st.availableAt!;
    evs.push(emit(answerP(itemId, 'meaning', 'incorrect', ['meaning', 'production']), t));
    evs.push(emit(answerP(itemId, 'meaning', 'correct', ['meaning', 'production']), t + 1));
    evs.push(emit(answerP(itemId, 'production', 'correct', ['meaning', 'production']), t + 2));
  }
  return evs;
}

describe('trouble list helpers', () => {
  const a = device('a');
  const log: AppEvent[] = [];
  log.push(...leech(a, 'v:결제', 4, 4, log));       // stage 5, score 4
  log.push(...failing(a, 'v:결재', 4, log));        // stage 1, score 4 → not a reset candidate
  log.push(...leech(a, 'v:베개', 4, 3, log));       // stage 5, score 3
  log.push(a(lessonP('v:망설이다'), T0 + 1));        // fine
  log.push(a(lessonP('h:決'), T0 + 2));             // hanja: never
  const now = T0 + 60 * DAY;
  const s = replayAll(FIXTURE, log);

  test('fixture sanity', () => {
    assert.equal(s.items.get('v:결제')!.stage, 5);
    assert.equal(s.items.get('v:결재')!.stage, 1);
    assert.equal(s.items.get('v:베개')!.stage, 5);
    for (const id of ['v:결제', 'v:결재', 'v:베개']) assert.ok(isLeech(s.items.get(id)!, now), id);
  });

  test('resetCandidates: leeches with stage > 1, worst first', () => {
    assert.deepEqual(resetCandidates(s, now), [{ itemId: 'v:결제', score: 4, stage: 5 }, { itemId: 'v:베개', score: 3, stage: 5 }]);
    // After a reset the item is at stage 1 and drops off (it stays a leech until it rebuilds a streak, D41).
    const st = s.items.get('v:결제')!;
    const after = [...log, a({ type: 'item.reset', itemId: 'v:결제', toStage: 1 }, st.availableAt! + 1)];
    assert.deepEqual(resetCandidates(replayAll(FIXTURE, after), now).map((c) => c.itemId), ['v:베개']);
  });

  test('extraStudyItems: trouble, recent lessons, filters; deterministic; reviewable only', () => {
    const trouble = extraStudyItems(s, { kind: 'trouble', limit: 2 }, now, 'seed');
    assert.deepEqual([...trouble].sort(), ['v:결재', 'v:결제']); // top 2 by score (tie 4/4), shuffled
    assert.deepEqual(extraStudyItems(s, { kind: 'trouble', limit: 2 }, now, 'seed'), trouble);

    const recent = extraStudyItems(s, { kind: 'recentLessons', days: 7 }, T0 + 2 * DAY, 's1');
    assert.deepEqual([...recent].sort(), ['v:결재', 'v:결제', 'v:망설이다', 'v:베개']); // no hanja
    assert.deepEqual(extraStudyItems(s, { kind: 'recentLessons', days: 7 }, T0 + 30 * DAY, 's1'), []);
    // limit keeps the most recent lessons: 망설이다 (T0+1) is the newest.
    assert.deepEqual(extraStudyItems(s, { kind: 'recentLessons', days: 7 }, T0 + DAY, 's1', 1), ['v:망설이다']);

    assert.deepEqual([...extraStudyItems(s, { kind: 'filter', stageGroup: 'guru' }, now, 'x')].sort(), ['v:결제', 'v:베개']);
    assert.deepEqual([...extraStudyItems(s, { kind: 'filter', stageGroup: 'apprentice' }, now, 'x')].sort(), ['v:결재', 'v:망설이다']);
    assert.deepEqual(extraStudyItems(s, { kind: 'filter', itemKind: 'hanja' }, now, 'x'), []);
    assert.deepEqual(extraStudyItems(s, { kind: 'filter', level: 2 }, now, 'x'), ['v:베개']);
    const all = extraStudyItems(s, { kind: 'filter' }, now, 'x');
    assert.equal(all.length, 4);
    assert.equal(extraStudyItems(s, { kind: 'filter' }, now, 'x', 2).length, 2);
    assert.deepEqual(extraStudyItems(s, { kind: 'filter' }, now, 'x', 2), extraStudyItems(s, { kind: 'filter' }, now, 'x', 2));
  });

  test('extraStudyItems skips items whose content is gone (deleted custom item)', () => {
    const b = device('b');
    const custom = vocab('커스텀', 1);
    const evs = [b({ type: 'customItem.upsert', item: custom }, T0), b(lessonP(custom.id), T0 + 1)];
    const s1 = replayAll(bundle([]), evs);
    assert.deepEqual(extraStudyItems(s1, { kind: 'filter' }, T0 + DAY, 'x'), [custom.id]);
    const s2 = replayAll(bundle([]), [...evs, b({ type: 'customItem.delete', itemId: custom.id }, T0 + 2)]);
    assert.deepEqual(extraStudyItems(s2, { kind: 'filter' }, T0 + DAY, 'x'), []);
  });
});

describe('imports over items with history (QA)', () => {
  test('a customItem.upsert that edits a seed item keeps its stage, schedule and stats', () => {
    const a = device('a');
    const item = FIXTURE.items.find((it) => it.kind === 'vocab')!;
    const req = (item as { questionTypes: import('@ksrs/content').QuestionType[] }).questionTypes.slice();
    const log: AppEvent[] = [a(lessonP(item.id), T0)];
    log.push(...advance(FIXTURE, log, a, item.id, 3, req));
    const before = replayAll(FIXTURE, log).items.get(item.id)!;
    assert.ok(before.stage >= 3);
    const edited = { ...item, meanings: ['an edited meaning'], source: { kind: 'import' as const, license: 'user-provided', attribution: 'x.csv' } };
    const log2 = [...log, a({ type: 'customItem.upsert', item: edited as never }, before.availableAt! - HOUR)];
    const s = replayAll(FIXTURE, log2);
    const after = s.items.get(item.id)!;
    assert.deepEqual([after.stage, after.availableAt, after.stats.reviews, after.lessonAt], [before.stage, before.availableAt, before.stats.reviews, before.lessonAt]);
    assert.deepEqual((s.index.byId.get(item.id) as { meanings: string[] }).meanings, ['an edited meaning']);
  });
});

describe('partial custom items (QA)', () => {
  test('the index gets a full-shaped copy; complete items pass through untouched; nothing downstream throws', async () => {
    const { repairCustomItem, relatedItems, buildQuestions, dueItems, troubleItems, availableLessons } = await import('../src/index.ts');
    for (const it of FIXTURE.items) assert.equal(repairCustomItem(it), it);
    const a = device('a');
    const partial = [
      { id: 'v:빈', kind: 'vocab', level: 1 },
      { id: 'g:빈', kind: 'grammar', level: 1, questionTypes: ['meaning', 'cloze'], questions: { cloze: 'nope' } },
      { id: 'x:빈', kind: 'expression', level: 1, examples: 'x' },
      { id: 'h:空', kind: 'hanja', level: 1, meanings: [1, 'empty'] },
      { id: 'v:결정', kind: 'vocab', level: 1, word: '결정', hanjaBreakdown: [{ syllable: '결', hanja: '決', hanjaId: 'h:決' }], contrasts: 3, unlockDeps: [null, { id: 'h:決', require: 'lesson' }] },
    ];
    const log: AppEvent[] = partial.map((item, i) => a({ type: 'customItem.upsert', item: item as never }, T0 + i));
    log.push(...partial.map((it, i) => a(lessonP(it.id), T0 + 100 + i)));
    const s = replayAll(FIXTURE, log);
    for (const p of partial) {
      const it = s.index.byId.get(p.id)!;
      assert.ok(it, p.id);
      assert.ok(Array.isArray(it.tags) && Array.isArray(it.unlockDeps), p.id);
      if (it.kind !== 'hanja') {
        assert.ok(Array.isArray(it.questionTypes), p.id);
        assert.doesNotThrow(() => buildQuestions(it, s, ['meaning', 'production', 'cloze', 'nuance', 'register'], 'x'), p.id);
      }
      assert.doesNotThrow(() => relatedItems(s.index, p.id), p.id);
    }
    assert.deepEqual((s.index.byId.get('g:빈') as { questionTypes: string[] }).questionTypes, []);
    assert.deepEqual((s.index.byId.get('h:空') as { meanings: string[] }).meanings, ['empty']);
    assert.deepEqual(s.customItems.get('v:빈'), partial[0]); // the raw item is kept (export, sync)
    assert.doesNotThrow(() => { dueItems(s, T0 + 30 * DAY); troubleItems(s, 50, T0); availableLessons(s.index, s); });
  });

  test('malformed prompts inside a non-empty prompt list are repaired or dropped (cloze without sentence crashed reviews)', async () => {
    const { repairCustomItem, buildQuestions } = await import('../src/index.ts');
    const item = {
      id: 'g:틀', kind: 'grammar', level: 1, pattern: '-틀', questionTypes: ['meaning', 'production', 'cloze', 'nuance', 'register'],
      questions: {
        meaning: { accepted: ['frame', 3] }, production: { accepted: ['틀'] },
        cloze: [{ id: 'c1' }, { id: 'c2', sentence: '그{{}}', accepted: ['는'] }],
        nuance: [{ id: 'n1', options: [{ text: 'a', correct: true }] }, { id: 'n2', situation: 's', options: [{ text: 'a', correct: true }, { text: 'b' }, 7] }],
        register: [{ id: 'r1', source: '했다', accepted: ['했어요'], features: [{ kind: 'endsWith' }, null] }, { id: 'r2' }],
      },
      examples: [{ ko: '예' }, {}, null], contrasts: [{ id: 'g:x' }], attachment: [{}],
    };
    const r = repairCustomItem(item as never) as unknown as { questions: Record<string, unknown[]>; questionTypes: string[]; examples: unknown[] };
    assert.deepEqual(r.questionTypes, ['meaning', 'production', 'cloze', 'nuance', 'register']);
    assert.deepEqual((r.questions.cloze as { id: string }[]).map((p) => p.id), ['c2']);
    assert.deepEqual((r.questions.nuance as { id: string }[]).map((p) => p.id), ['n2']);
    assert.deepEqual((r.questions.register as { id: string }[]).map((p) => p.id), ['r1']);
    assert.deepEqual(r.examples, [{ ko: '예', en: '' }]);
    const s = replayAll(FIXTURE, [device('a')({ type: 'customItem.upsert', item: item as never }, T0)]);
    for (let i = 0; i < 20; i++) {
      const qs = buildQuestions(s.index.byId.get('g:틀')!, s, ['meaning', 'production', 'cloze', 'nuance', 'register'], `seed${i}`);
      assert.equal(qs.length, 5);
    }
    // Only a cloze list with no usable prompt at all removes the qtype.
    const none = repairCustomItem({ ...item, questions: { cloze: [{ id: 'c1' }] }, questionTypes: ['cloze'] } as never) as unknown as { questionTypes: string[] };
    assert.deepEqual(none.questionTypes, []);
  });
});
