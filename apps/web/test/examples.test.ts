import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_SOURCE, dictExampleText, examplesStore, headwordMatch, highlight, krdictSearchUrl, loadExamples, parseExamplesFile,
} from '../src/data/examples.ts';

const FIXTURE = fileURLToPath(new URL('../tests/e2e/fixture-examples.json', import.meta.url));

test('parseExamplesFile: the fixture (data contract shape) parses completely', () => {
  const raw = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const d = parseExamplesFile(raw)!;
  assert.ok(d);
  assert.equal(d.source.name, '한국어기초사전');
  assert.equal(d.source.snapshot, '2019-06-26');
  assert.equal(d.items.size, Object.keys(raw.items).length);
  const m = d.items.get('v:망설이다')!;
  assert.equal(m.length, 3);
  assert.deepEqual(m[2], { kind: 'dialogue', lines: ['가: 그 회사에 지원할 거야?', '나: 아직 망설이고 있어.'], match: '망설이고', matchLine: 1 });
});

test('parseExamplesFile: rejects unusable top levels', () => {
  for (const bad of [null, undefined, 42, 'x', [], {}, { format: 2, items: {} }, { format: '1', items: {} }, { format: 1 }, { format: 1, items: [] }, { format: 1, items: null }]) {
    assert.equal(parseExamplesFile(bad), null, JSON.stringify(bad));
  }
});

test('parseExamplesFile: drops bad entries and empty items, keeps good ones; source falls back to defaults', () => {
  const d = parseExamplesFile({
    format: 1,
    source: { name: 42, licenseUrl: 'javascript:alert(1)', url: 'ftp://x', license: 'CC BY-SA 2.0 KR' },
    items: {
      'v:a': [
        { kind: 'sentence', ko: '좋은 예문.', match: '예문' },
        { kind: 'sentence', ko: '' },                         // empty
        { kind: 'sentence', ko: 7 },                          // wrong type
        { kind: 'poem', ko: '시' },                            // unknown kind
        null, 'str', [],
        { kind: 'dialogue', lines: [] },                       // no lines
        { kind: 'dialogue', lines: ['가: 응', 3] },            // non-string line
        { kind: 'dialogue', lines: ['가: 뭐 해?', '나: 그냥.'], match: '그냥', matchLine: 5 }, // matchLine out of range → dropped field
        { kind: 'sentence', ko: '매치 없음', match: '' },      // empty match → no match field
      ],
      'v:b': [{ kind: 'nope' }],
      'v:c': 'not an array',
    },
  })!;
  assert.deepEqual([...d.items.keys()], ['v:a']);
  assert.deepEqual(d.items.get('v:a'), [
    { kind: 'sentence', ko: '좋은 예문.', match: '예문' },
    { kind: 'dialogue', lines: ['가: 뭐 해?', '나: 그냥.'], match: '그냥' },
    { kind: 'sentence', ko: '매치 없음' },
  ]);
  assert.equal(d.source.name, DEFAULT_SOURCE.name);
  assert.equal(d.source.licenseUrl, DEFAULT_SOURCE.licenseUrl, 'non-http(s) URLs are never used');
  assert.equal(d.source.url, DEFAULT_SOURCE.url);
  assert.equal(d.source.license, 'CC BY-SA 2.0 KR');
  assert.ok(parseExamplesFile({ format: 1, items: {} }), 'an empty file is valid (no examples)');
});

test('loadExamples: fails silently on throw, 404 (null) and malformed data; loads good data once', async () => {
  for (const f of [() => Promise.reject(new Error('offline')), () => Promise.resolve(null), () => Promise.resolve({ format: 9 })]) {
    examplesStore.reset();
    await loadExamples(f);
    assert.equal(examplesStore.get(), null);
  }
  examplesStore.reset();
  let calls = 0;
  const ok = () => { calls++; return Promise.resolve({ format: 1, items: { 'v:a': [{ kind: 'sentence', ko: '가', match: '가' }] } }); };
  let notified = 0;
  const un = examplesStore.subscribe(() => { notified++; });
  await loadExamples(ok);
  await loadExamples(ok);
  un();
  assert.equal(calls, 1, 'fetched once');
  assert.ok(notified >= 1);
  assert.equal(examplesStore.get()!.items.get('v:a')!.length, 1);
  examplesStore.reset();
});

test('highlight: splits around the first match; no match → one plain segment', () => {
  assert.deepEqual(highlight('그는 망설였다.', '망설였다'), [{ text: '그는 ', hit: false }, { text: '망설였다', hit: true }, { text: '.', hit: false }]);
  assert.deepEqual(highlight('덤이에요', '덤'), [{ text: '덤', hit: true }, { text: '이에요', hit: false }]);
  assert.deepEqual(highlight('덤 덤', '덤'), [{ text: '덤', hit: true }, { text: ' 덤', hit: false }]);
  assert.deepEqual(highlight('문장', '없음'), [{ text: '문장', hit: false }]);
  assert.deepEqual(highlight('문장', undefined), [{ text: '문장', hit: false }]);
  assert.deepEqual(highlight('문장', '  '), [{ text: '문장', hit: false }]);
  // Segments always reassemble to the original text.
  for (const [t, m] of [['가나다라', '나다'], ['가나다라', '라'], ['가나다라', '가나다라']] as const) {
    assert.equal(highlight(t, m).map((s) => s.text).join(''), t);
  }
});

test('headwordMatch: headword, then a shortened stem, never below half the word', () => {
  assert.equal(headwordMatch('팀장님 결재가 나야 해요.', '결재'), '결재');
  assert.equal(headwordMatch('시장에서 덤으로 주셨다.', '덤'), '덤');
  assert.equal(headwordMatch('잠시 망설이다가 눌렀다.', '망설이다'), '망설이다');
  assert.equal(headwordMatch('망설이지 말고 연락해.', '망설이다'), '망설이');
  assert.equal(headwordMatch('대답을 얼버무렸다.', '얼버무리다'), '얼버무');
  assert.equal(headwordMatch('꼭 발등에 불이 떨어져야 움직인다.', '발등에 불이 떨어지다'), '발등에 불이 떨어');
  assert.equal(headwordMatch('결심이 섰다.', '결재'), undefined, '결재 does not degrade to 결');
  assert.equal(headwordMatch('아무 관계 없는 문장', '망설이다'), undefined);
  assert.equal(headwordMatch('x', ''), undefined);
});

test('krdictSearchUrl and dictExampleText', () => {
  assert.equal(krdictSearchUrl('망설이다'), 'https://krdict.korean.go.kr/dicSearch/search?mainSearchWord=%EB%A7%9D%EC%84%A4%EC%9D%B4%EB%8B%A4');
  assert.equal(krdictSearchUrl('발등에 불이 떨어지다'), `https://krdict.korean.go.kr/dicSearch/search?mainSearchWord=${encodeURIComponent('발등에 불이 떨어지다')}`);
  assert.equal(dictExampleText({ kind: 'sentence', ko: '문장.' }), '문장.');
  assert.equal(dictExampleText({ kind: 'dialogue', lines: ['가: 뭐 해?', '나: 그냥 있어.'] }), '뭐 해? 그냥 있어.');
});
