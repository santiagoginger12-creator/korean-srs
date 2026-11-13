import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findBlank, gradeBlank, stemCandidates } from '../src/features/drill/modes/cloze.ts';

test('findBlank blanks the eojeol carrying the word, conjugated or with a particle', () => {
  assert.deepEqual(findBlank('저는 보통 일곱 시에 일어나요.', '일어나다'), { before: '저는 보통 일곱 시에 ', answer: '일어나요', after: '.' });
  assert.equal(findBlank('아침부터 머리가 좀 아파요.', '머리')?.answer, '머리가');
  assert.equal(findBlank('오늘 기분이 좀 나빠요.', '나쁘다')?.answer, '나빠요');
  assert.equal(findBlank('새 회사는 어때요?', '어떻다')?.answer, '어때요');
  assert.equal(findBlank('난 진짜 몰라.', '모르다')?.answer, '몰라');
  assert.equal(findBlank('어제 한국어를 공부했어요.', '공부하다')?.answer, '공부했어요');
  assert.equal(findBlank('주말에 보통 뭐 해요?', '하다')?.answer, '해요');
  assert.equal(findBlank('사장님은 지금 안 계세요.', '계시다')?.answer, '계세요');
});

test('findBlank returns null when the word is not clearly there (one syllable inside a compound)', () => {
  assert.equal(findBlank('녹차 한 잔 하실래요?', '차'), null);
  assert.equal(findBlank('완전히 다른 문장이에요.', '사과'), null);
});

test('stemCandidates are longest first and include the dictionary form', () => {
  const c = stemCandidates('배우다');
  assert.equal(c[0], '배우다');
  assert.ok(c.includes('배워'));
});

test('gradeBlank: exact, particle dropped, typo, dictionary form, Latin-typed, wrong, blank', () => {
  const b = findBlank('아침부터 머리가 좀 아파요.', '머리')!;
  assert.equal(gradeBlank('머리가', b, '머리'), 'correct');
  assert.equal(gradeBlank('머리', b, '머리'), 'correct');
  assert.equal(gradeBlank('ajfl', b, '머리'), 'correct'); // 두벌식 for 머리
  const v = findBlank('저는 보통 일곱 시에 일어나요.', '일어나다')!;
  assert.equal(gradeBlank('일어나요', v, '일어나다'), 'correct');
  assert.equal(gradeBlank('일어나다', v, '일어나다'), 'headword');
  assert.equal(gradeBlank('일어나여', v, '일어나다'), 'close');
  assert.equal(gradeBlank('자요', v, '일어나다'), 'wrong');
  assert.equal(gradeBlank('  ', v, '일어나다'), 'blank');
});
