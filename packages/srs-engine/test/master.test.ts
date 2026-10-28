import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMasterCsv, serializeMasterCsv, type MasterRow } from '@ksrs/content';
import {
  appWords, applyEvents, buildMasterList, extPayload, extraStudyItems, MASTER_EXT_BASELINE, planSession, readMasterExt,
  replayAll, sessionHash, sessionKey, troubleItems, type AppEvent, type SessionRecord,
} from '../src/index.ts';
import { advance, answerP, bundle, device, FIXTURE, lessonP, passAll, T0, vocab, type Emit } from './fixtures.ts';

const appEventsFor = (a: Emit, id: string, at: number): AppEvent[] => passAll(a, id, ['meaning', 'production'], at);
import { DAY, seededShuffle } from '../src/util.ts';

const row = (word: string, o: Partial<MasterRow> = {}): MasterRow => ({
  word, meaning: `${word}-en`, hanja: '', pos: 'noun', status: 'mastered', times_missed: 0, times_seen: 10, last_seen: '2026-08-01',
  freq_rank: null, sources: ['anki'], tags: [], notes: '', ...o,
});
const SEOUL = 540;
const byWord = (rows: MasterRow[]) => new Map(rows.map((r) => [r.word, r]));

describe('ext. settings in replay', () => {
  test('LWW per key, null deletes, never leaks into settings; applyEvents keeps it current', () => {
    const a = device('a');
    const log: AppEvent[] = [
      a(extPayload('ext.x', { n: 1 }), T0),
      a(extPayload('ext.y', 'keep'), T0 + 1),
      a(extPayload('ext.x', { n: 2 }), T0 + 2),
      a(extPayload('ext.y', null), T0 + 3),
    ];
    const s = replayAll(FIXTURE, seededShuffle(log, 'x'));
    assert.deepEqual([...s.ext], [['ext.x', { n: 2 }]]);
    assert.equal((s.settings as unknown as Record<string, unknown>)['ext.x'], undefined);
    const e = a(extPayload('ext.z', [1]), T0 + 4);
    const next = applyEvents(s, FIXTURE, [...log, e], [e]).state;
    assert.deepEqual(next.ext.get('ext.z'), [1]);
    assert.deepEqual(applyEvents(s, FIXTURE, [...log, e], [e]).changed, [], 'ext writes re-replay no items');
    assert.throws(() => extPayload('tts.rate', 1));
  });

  test('readMasterExt ignores malformed values', () => {
    const a = device('a');
    const s = replayAll(FIXTURE, [
      a(extPayload(MASTER_EXT_BASELINE, { v: 1, enc: 'zip', data: '' }), T0),
      a(extPayload(sessionKey('ab'.repeat(32)), { v: 1, hash: 'h', source: 'convo', recordedAt: 5, rows: [{ word: '', missed: 1, seen: 0, status: 'new' }, { word: '끼다', missed: 2, seen: 1, status: 'learning' }] }), T0 + 1),
      a(extPayload('ext.master.session.bad', { v: 2 }), T0 + 2),
    ]);
    const m = readMasterExt(s);
    assert.equal(m.baseline, undefined);
    assert.equal(m.sessions.length, 1);
    assert.deepEqual(m.sessions[0]!.rows.map((r) => [r.word, r.missed]), [['끼다', 2]]);
  });
});

// Content: 결정 (seed, hanja), 망설이다 (seed), 걸치다 ×2 senses (native-verb track), 미처 (custom, anki-shaky).
const CONTENT = bundle([
  vocab('결정', 1, { hanjaBreakdown: [{ syllable: '결', hanja: '決' }, { syllable: '정', hanja: '定' }], meanings: ['decision', 'determination'] }),
  vocab('망설이다', 1, { pos: 'verb' }),
  vocab('걸치다', 4, { id: 'v:걸치다:1', track: 'native', pos: 'verb', meanings: ['to hang over'] }),
  vocab('걸치다', 4, { id: 'v:걸치다:2', track: 'native', pos: 'verb', meanings: ['to span (a period)'] }),
  vocab('미처', 1, { source: { kind: 'import', license: 'personal-use' }, tags: ['anki', 'anki-shaky'], gating: false }),
]);

function history(): AppEvent[] {
  const a = device('a');
  const log: AppEvent[] = [a(lessonP('v:결정'), T0), a(lessonP('v:망설이다'), T0), a(lessonP('v:걸치다:1'), T0)];
  // 결정 → Guru (4 clean reviews). 망설이다: one wrong answer, then right (stage stays low).
  log.push(...advance(CONTENT, log, a, 'v:결정', 4));
  const st = replayAll(CONTENT, log).items.get('v:망설이다')!;
  log.push(a(answerP('v:망설이다', 'meaning', 'incorrect', ['meaning', 'production']), st.availableAt!));
  log.push(a(answerP('v:망설이다', 'meaning', 'correct', ['meaning', 'production']), st.availableAt! + 1));
  log.push(a(answerP('v:망설이다', 'production', 'correct', ['meaning', 'production']), st.availableAt! + 2));
  return log;
}

describe('app history per headword', () => {
  test('seen = lessons + reviews, missed = wrong answers, status by stage, tags, hanja', () => {
    const s = replayAll(CONTENT, history());
    const w = new Map(appWords(s, SEOUL).map((x) => [x.word, x]));
    assert.deepEqual([...w.keys()].sort(), ['걸치다', '결정', '망설이다', '미처']);
    const g = w.get('결정')!;
    assert.deepEqual([g.status, g.seen, g.missed, g.hanja, g.meaning, g.tags], ['mastered', 5, 0, '決定', 'decision; determination', ['app-L1']]);
    const m = w.get('망설이다')!;
    assert.deepEqual([m.status, m.seen, m.missed], ['learning', 2, 1]);
    assert.match(m.last_seen, /^2026-10-0\d$/);
    const k = w.get('걸치다')!;
    assert.deepEqual([k.status, k.seen, k.tags], ['learning', 1, ['native-verb', 'app-L4']]);
    const mc = w.get('미처')!;
    assert.deepEqual([mc.status, mc.seen, mc.tags, mc.last_seen], ['new', 0, ['shaky'], '']);
  });

  test('hanja: native syllables inside are "-", native endings and spaces are dropped; two senses at most', () => {
    const C = bundle([
      vocab('결정하다', 1, { hanjaBreakdown: [{ syllable: '결', hanja: '決' }, { syllable: '정', hanja: '定' }], meanings: ['to decide', 'to settle', 'to fix'] }),
      vocab('개의치 않다', 1, { hanjaBreakdown: [{ syllable: '개', hanja: '介' }, { syllable: '의', hanja: '意' }] }),
      vocab('눈엣가시', 1, { hanjaBreakdown: [{ syllable: '가', hanja: '假' }] }),
      vocab('덤', 1),
    ]);
    const w = new Map(appWords(replayAll(C, []), 0).map((x) => [x.word, x]));
    assert.deepEqual([w.get('결정하다')!.hanja, w.get('결정하다')!.meaning], ['決定', 'to decide; to settle']);
    assert.equal(w.get('개의치 않다')!.hanja, '介意');
    assert.equal(w.get('눈엣가시')!.hanja, '--假');
    assert.equal(w.get('덤')!.hanja, '');
  });

  test('last_seen uses the given time zone', () => {
    const a = device('a');
    const lateUtc = Date.UTC(2026, 9, 1, 20, 0); // 05:00 next day in Seoul
    const s = replayAll(CONTENT, [a(lessonP('v:결정'), lateUtc)]);
    const get = (tz: number) => appWords(s, tz).find((x) => x.word === '결정')!.last_seen;
    assert.equal(get(0), '2026-10-01');
    assert.equal(get(SEOUL), '2026-10-02');
  });
});

describe('buildMasterList', () => {
  const baseline = [
    row('걸치다', { status: 'learning', times_missed: 78, times_seen: 320, tags: ['leech', 'shaky'], freq_rank: 5309 }),
    row('결정', { status: 'mastered', times_missed: 6, times_seen: 30, freq_rank: 300, sources: ['anki', 'app'], tags: ['app-L1'] }),
    row('보살피다', { status: 'suspended', times_missed: 2 }),
    row('다정하다', { status: 'mastered', times_missed: 1, freq_rank: 2000 }),
    row('겨우', { status: 'new', times_missed: 0, times_seen: 0, last_seen: '' }),
    row('앱전용', { sources: ['app'], status: 'new' }), // not from Anki: ignored
  ];

  test('merges baseline + app + sessions; status rules incl. the ≥ 8 rule; sorted', () => {
    const a = device('a');
    const log = history();
    // Two misses on 결정 after it reached Guru (stage drops but stays ≥ … let's check the rule via totals).
    const s0 = replayAll(CONTENT, log);
    const due = s0.items.get('v:결정')!.availableAt!;
    log.push(a(answerP('v:결정', 'meaning', 'incorrect', ['meaning', 'production']), due));
    log.push(a(answerP('v:결정', 'meaning', 'incorrect', ['meaning', 'production']), due + 1));
    const s = replayAll(CONTENT, log);
    const sessions: SessionRecord[] = [{
      v: 1, hash: 'h1', source: 'convo', recordedAt: T0 + 30 * DAY, itemIds: [],
      rows: [
        { word: '다정하다', meaning: '', hanja: '', pos: '', status: 'learning', missed: 3, seen: 2, reportedMissed: 4, last_seen: '2026-10-28', freq_rank: null, tags: ['shaky'], notes: 'mixed up with 다감하다', isNew: false },
        { word: '서먹하다', meaning: 'awkward', hanja: '', pos: 'adj', status: 'new', missed: 1, seen: 1, reportedMissed: 1, last_seen: '2026-10-28', freq_rank: null, tags: [], notes: '', isNew: true },
      ],
    }];
    const out = buildMasterList({ baseline, app: appWords(s, SEOUL), sessions });
    const m = byWord(out);
    assert.equal(m.has('앱전용'), false);
    // 결정: Anki 6 + app 2 = 8 misses → learning + leech, even though the app item is at Guru or it was mastered in Anki.
    const g = m.get('결정')!;
    assert.deepEqual([g.times_missed, g.times_seen, g.status, g.sources, g.tags], [8, 35, 'learning', ['anki', 'app'], ['leech', 'app-L1']]);
    assert.equal(g.hanja, '決定');
    // 걸치다: baseline learning, leech recomputed, app adds native-verb.
    const k = m.get('걸치다')!;
    assert.deepEqual([k.status, k.times_missed, k.times_seen, k.tags, k.sources], ['learning', 78, 321, ['leech', 'shaky', 'app-L4', 'native-verb'], ['anki', 'app']]);
    // 다정하다: session row (later) says learning; misses 1 + 3.
    const dj = m.get('다정하다')!;
    assert.deepEqual([dj.status, dj.times_missed, dj.times_seen, dj.last_seen, dj.sources, dj.tags, dj.notes],
      ['learning', 4, 12, '2026-10-28', ['anki', 'convo'], ['shaky'], 'mixed up with 다감하다']);
    // New conversation word.
    const sm = m.get('서먹하다')!;
    assert.deepEqual([sm.status, sm.times_missed, sm.sources, sm.meaning, sm.pos], ['new', 1, ['convo'], 'awkward', 'adj']);
    // Suspended stays suspended without newer evidence; Anki "new" stays new.
    assert.equal(m.get('보살피다')!.status, 'suspended');
    assert.equal(m.get('겨우')!.status, 'new');
    // App-only words: lesson done → learning; not done → new (미처 is anki-shaky → shaky).
    assert.equal(m.get('망설이다')!.status, 'learning');
    assert.deepEqual([m.get('미처')!.status, m.get('미처')!.tags, m.get('미처')!.sources], ['new', ['shaky'], ['app']]);
    // Sort: learning by misses desc, then new (also by misses), mastered, suspended.
    assert.deepEqual(out.map((r) => r.word), ['걸치다', '결정', '다정하다', '망설이다', '서먹하다', '겨우', '미처', '보살피다']);
  });

  test('app Guru+ is mastered under 8 misses; a newer app lesson outranks an older Anki status', () => {
    const s = replayAll(CONTENT, history());
    const out = byWord(buildMasterList({ baseline: [row('결정', { status: 'learning', times_missed: 3 })], app: appWords(s, SEOUL), sessions: [] }));
    assert.equal(out.get('결정')!.status, 'mastered');
    assert.equal(out.get('결정')!.times_missed, 3);
  });

  test('an Anki-mastered word stays mastered after its app lesson unless new misses are recorded', () => {
    // App: 걸치다:1 lesson done, no misses (stage 1); 망설이다 lesson done, 1 miss (stage < 5); 결정 at Guru.
    const s = replayAll(CONTENT, history());
    const app = appWords(s, SEOUL);
    const later = T0 + 60 * DAY;
    const sess = (rows: [string, MasterRow['status'], number][], hash = 'h'): SessionRecord => ({
      v: 1, hash, source: 'convo', recordedAt: later, itemIds: [],
      rows: rows.map(([word, status, missed]) => ({ word, meaning: '', hanja: '', pos: '', status, missed, seen: 1, reportedMissed: missed, last_seen: '2026-11-01', freq_rank: null, tags: [], notes: '', isNew: false })),
    });
    const base = [
      row('걸치다', { status: 'mastered', times_missed: 3 }),
      row('망설이다', { status: 'mastered', times_missed: 2 }),
      row('결정', { status: 'mastered', times_missed: 7 }),
    ];
    let m = byWord(buildMasterList({ baseline: base, app, sessions: [] }));
    assert.equal(m.get('걸치다')!.status, 'mastered', 'lesson done, no misses: still mastered');
    assert.equal(m.get('망설이다')!.status, 'learning', 'an app miss since the baseline: app evidence applies');
    assert.deepEqual([m.get('결정')!.status, m.get('결정')!.times_missed], ['mastered', 7]);

    // A session row saying `learning` without new misses doesn't demote it; one with a miss does.
    m = byWord(buildMasterList({ baseline: base, app, sessions: [sess([['걸치다', 'learning', 0]])] }));
    assert.equal(m.get('걸치다')!.status, 'mastered');
    m = byWord(buildMasterList({ baseline: base, app, sessions: [sess([['걸치다', 'learning', 1]])] }));
    assert.deepEqual([m.get('걸치다')!.status, m.get('걸치다')!.times_missed], ['learning', 4]);
    // ≥ 8 total misses is learning whatever else says so (7 + 1 session miss).
    m = byWord(buildMasterList({ baseline: base, app, sessions: [sess([['결정', 'mastered', 1]])] }));
    assert.deepEqual([m.get('결정')!.status, m.get('결정')!.tags.includes('leech')], ['learning', true]);
    // Deliberate suspension still applies.
    m = byWord(buildMasterList({ baseline: base, app, sessions: [sess([['걸치다', 'suspended', 0]])] }));
    assert.equal(m.get('걸치다')!.status, 'suspended');
    // Words not mastered in Anki keep the old rule: a done lesson below Guru is learning.
    m = byWord(buildMasterList({ baseline: [row('걸치다', { status: 'new', times_missed: 0 })], app, sessions: [] }));
    assert.equal(m.get('걸치다')!.status, 'learning');
    m = byWord(buildMasterList({ baseline: [], app, sessions: [] }));
    assert.equal(m.get('걸치다')!.status, 'learning');
  });

  test('deterministic: input order does not matter, output re-serializes identically', () => {
    const s = replayAll(CONTENT, history());
    const app = appWords(s, SEOUL);
    const sessions: SessionRecord[] = [
      { v: 1, hash: 'b', source: 'tutor', recordedAt: T0 + 5, itemIds: [], rows: [{ word: '겨우', meaning: '', hanja: '', pos: '', status: 'learning', missed: 2, seen: 2, reportedMissed: 2, last_seen: '2026-10-20', freq_rank: 900, tags: [], notes: 'a', isNew: false }] },
      { v: 1, hash: 'a', source: 'convo', recordedAt: T0 + 9, itemIds: [], rows: [{ word: '겨우', meaning: '', hanja: '', pos: '', status: 'learning', missed: 1, seen: 1, reportedMissed: 3, last_seen: '2026-10-22', freq_rank: null, tags: [], notes: 'b', isNew: false }] },
    ];
    const one = serializeMasterCsv(buildMasterList({ baseline, app, sessions }));
    for (const seed of ['1', '2', '3']) {
      const two = serializeMasterCsv(buildMasterList({ baseline: seededShuffle(baseline, seed), app: seededShuffle(app, seed), sessions }));
      assert.equal(two, one);
    }
    const r = byWord(parseMasterCsv(one).rows).get('겨우')!;
    assert.deepEqual([r.times_missed, r.sources, r.notes, r.freq_rank, r.last_seen], [3, ['anki', 'convo', 'tutor'], 'b', 900, '2026-10-22']);
  });
});

describe('session rows', () => {
  const current = [row('끼다', { status: 'learning', times_missed: 10, times_seen: 50 }), row('빌다', { times_missed: 2, times_seen: 20 })];

  test('existing words add max(0, reported − current); new words add their counts', () => {
    const pasted = [
      row('끼다', { status: 'learning', times_missed: 12, times_seen: 53, sources: ['anki', 'convo'] }),
      row('빌다', { times_missed: 1, times_seen: 20 }), // stale total: clamped to 0
      row('서먹하다', { status: 'new', times_missed: 1, times_seen: 1, sources: ['convo'] }),
    ];
    const rec = planSession(current, pasted, { source: 'convo', recordedAt: T0 });
    assert.deepEqual(rec.rows.map((r) => [r.word, r.missed, r.seen, r.isNew]), [['끼다', 2, 3, false], ['빌다', 0, 0, false], ['서먹하다', 1, 1, true]]);
    const merged = byWord(buildMasterList({ baseline: current, app: [], sessions: [rec] }));
    assert.equal(merged.get('끼다')!.times_missed, 12);
    assert.equal(merged.get('빌다')!.times_missed, 2);
    assert.equal(merged.get('서먹하다')!.times_missed, 1);
  });

  test('hash ignores header, fences, quoting and spacing; the same block maps to the same key (no double count)', () => {
    const plain = '끼다,to fit,,verb,learning,12,53,2026-10-28,,anki convo,,\n';
    const dressed = '```csv\nword,meaning,hanja,pos,status,times_missed,times_seen,last_seen,freq_rank,sources,tags,notes\n"끼다","to fit",, verb ,learning,12,53,2026-10-28,,anki  convo,,\n```\n';
    const h1 = sessionHash(parseMasterCsv(plain).rows);
    const h2 = sessionHash(parseMasterCsv(dressed).rows);
    assert.equal(h1, h2);
    assert.notEqual(h1, sessionHash(parseMasterCsv(plain.replace('12', '13')).rows));

    // Recording twice (even with different deltas, e.g. from another device) keeps one record.
    const a = device('a');
    const pasted = parseMasterCsv(plain).rows;
    const r1 = planSession(current, pasted, { source: 'convo', recordedAt: T0 });
    const after = buildMasterList({ baseline: current, app: [], sessions: [r1] });
    const r2 = planSession(after, pasted, { source: 'convo', recordedAt: T0 + 1 });
    assert.equal(r2.rows[0]!.missed, 0, 're-pasting against the updated list adds nothing');
    const s = replayAll(FIXTURE, [a(extPayload(sessionKey(r1.hash), r1), T0), a(extPayload(sessionKey(r1.hash), r1), T0 + 1)]);
    const sessions = readMasterExt(s).sessions;
    assert.equal(sessions.length, 1);
    assert.equal(byWord(buildMasterList({ baseline: current, app: [], sessions })).get('끼다')!.times_missed, 12);
  });
});

describe('Anki shaky items: trouble list and practice', () => {
  const C = bundle([
    vocab('미처', 1, { tags: ['anki-shaky'], gating: false }),
    vocab('왠지', 1, { tags: ['anki-shaky'], gating: false }),
    vocab('결정', 1),
  ]);
  test('an anki-shaky item joins the trouble list on its first app miss and leaves after 3 clean reviews', () => {
    const a = device('a');
    const log: AppEvent[] = [a(lessonP('v:미처'), T0), a(lessonP('v:결정'), T0)];
    for (const id of ['v:미처', 'v:결정']) {
      const st = replayAll(C, log).items.get(id)!;
      log.push(a(answerP(id, 'meaning', 'incorrect', ['meaning', 'production']), st.availableAt!));
      log.push(...appEventsFor(a, id, st.availableAt! + 1));
    }
    let s = replayAll(C, log);
    const now = s.items.get('v:미처')!.stats.lastAt! + 1;
    assert.deepEqual(troubleItems(s, 20, now).map((t) => t.itemId), ['v:미처']);
    assert.deepEqual(troubleItems(s).map((t) => t.itemId), ['v:미처']);
    log.push(...advance(C, log, a, 'v:미처', 3));
    s = replayAll(C, log);
    assert.deepEqual(troubleItems(s, 20, s.items.get('v:미처')!.stats.lastAt! + 1), []);
  });

  test('practice "tag" source: every tagged item, lesson or not, app-missed first', () => {
    const a = device('a');
    const log: AppEvent[] = [a(lessonP('v:왠지'), T0)];
    const st = replayAll(C, log).items.get('v:왠지')!;
    log.push(a(answerP('v:왠지', 'meaning', 'incorrect', ['meaning', 'production']), st.availableAt!));
    const s = replayAll(C, log);
    const ids = extraStudyItems(s, { kind: 'tag', tag: 'anki-shaky' }, T0 + DAY, 'seed', 1);
    assert.deepEqual(ids, ['v:왠지']);
    assert.deepEqual(extraStudyItems(s, { kind: 'tag', tag: 'anki-shaky' }, T0 + DAY, 'seed').sort(), ['v:미처', 'v:왠지']);
    assert.deepEqual(extraStudyItems(s, { kind: 'tag', tag: 'nope' }, T0, 'seed'), []);
  });
});

describe('7.3k-row baseline: size and speed', () => {
  // Synthetic stand-in for the owner's file (7,332 rows; the real one stays private).
  const N = 7332;
  const r = (i: number) => row(`단어${i}`, {
    meaning: `gloss ${i}, sense; another sense for ${i}`, status: (['mastered', 'learning', 'suspended', 'new'] as const)[i % 4]!,
    times_missed: i % 40, times_seen: 40 + (i % 300), last_seen: '2026-08-15', freq_rank: i + 1, tags: i % 5 ? [] : ['leech', 'shaky'],
  });
  const rows = Array.from({ length: N }, (_, i) => r(i));

  test('parse + build + serialize stay well under a second; the blob survives backup/merge', async () => {
    const { makeBackup, parseBackup, serializeBackup, mergeEventSets } = await import('../src/index.ts');
    let t0 = performance.now();
    const csv = serializeMasterCsv(rows);
    const parsed = parseMasterCsv(csv).rows;
    const tParse = performance.now() - t0;
    assert.equal(parsed.length, N);
    t0 = performance.now();
    const out = buildMasterList({ baseline: parsed, app: [], sessions: [] });
    const tBuild = performance.now() - t0;
    assert.equal(out.length, N);
    assert.ok(tParse < 2000 && tBuild < 1000, `parse ${tParse.toFixed(0)} ms, build ${tBuild.toFixed(0)} ms`);

    // Stored uncompressed here (the app deflates it in the browser): the worst case for size.
    const a = device('a');
    const blob = { v: 1, enc: 'csv', data: csv, rows: N, sha256: 'x', importedAt: T0, file: 'f.csv', statusCounts: {} };
    const log = [a(extPayload(MASTER_EXT_BASELINE, blob), T0), a(lessonP('v:결정'), T0 + 1)];
    t0 = performance.now();
    const s = replayAll(FIXTURE, log);
    const tReplay = performance.now() - t0;
    assert.equal((s.ext.get(MASTER_EXT_BASELINE) as { data: string }).data, csv);
    t0 = performance.now();
    const text = serializeBackup(makeBackup(log, { createdAt: 'x', appVersion: 'v', contentVersion: 'c', deviceId: 'a' }));
    const back = parseBackup(text);
    const tBackup = performance.now() - t0;
    assert.ok(back.ok);
    const merged = mergeEventSets(log, back.ok ? back.events : []);
    assert.equal(merged.length, log.length);
    assert.equal((replayAll(FIXTURE, merged).ext.get(MASTER_EXT_BASELINE) as { data: string }).data, csv);
    assert.ok(tReplay < 500 && tBackup < 2000, `replay ${tReplay.toFixed(0)} ms, backup round-trip ${tBackup.toFixed(0)} ms`);
    console.log(`  7.3k rows: csv ${(csv.length / 1024).toFixed(0)} KB · parse ${tParse.toFixed(0)} ms · build ${tBuild.toFixed(0)} ms · replay ${tReplay.toFixed(0)} ms · backup round-trip ${tBackup.toFixed(0)} ms`);
  });
});
