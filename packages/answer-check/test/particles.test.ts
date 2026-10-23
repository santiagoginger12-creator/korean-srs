import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareEojeol, correctAllomorph, findWrongAllomorphs, particleMatch, particleSplits } from '../src/index.ts';

test('correctAllomorph follows the preceding final', () => {
  assert.equal(correctAllomorph('책', 'object'), '을');
  assert.equal(correctAllomorph('사과', 'object'), '를');
  assert.equal(correctAllomorph('집', 'direction'), '으로');
  assert.equal(correctAllomorph('길', 'direction'), '로');     // ㄹ takes 로
  assert.equal(correctAllomorph('학교', 'direction'), '로');
  assert.equal(correctAllomorph('친구', 'with'), '와');
  assert.equal(correctAllomorph('선생님', 'with'), '과');
  assert.equal(correctAllomorph('나', 'topic'), '는');
  assert.equal(correctAllomorph('물', 'subject'), '이');
});

test('particleSplits prefers 으로 and needs a syllable stem', () => {
  assert.deepEqual(particleSplits('집으로').map((s) => s.stem), ['집', '집으']);
  assert.deepEqual(particleSplits('은'), []);
  assert.deepEqual(particleSplits('CD를'), []);
  assert.deepEqual(particleSplits('책을.').map((s) => s.particle), ['을']);
});

test('wrong allomorph is detected for every tolerance', () => {
  for (const tol of ['none', 'allomorph', 'loose'] as const) {
    assert.deepEqual(compareEojeol('책를', '책을', tol), { kind: 'wrongAllomorph', fix: '책을' });
    assert.deepEqual(compareEojeol('사과을', '사과를', tol), { kind: 'wrongAllomorph', fix: '사과를' });
    assert.deepEqual(compareEojeol('집로', '집으로', tol), { kind: 'wrongAllomorph', fix: '집으로' });
    assert.deepEqual(compareEojeol('길으로', '길로', tol), { kind: 'wrongAllomorph', fix: '길로' });
    assert.deepEqual(compareEojeol('친구과', '친구와', tol), { kind: 'wrongAllomorph', fix: '친구와' });
  }
});

test('words that merely end in particle syllables are not split', () => {
  // 사과 (apple) / 나이 (age) / 고기 / 우리 in the accepted answer: 과, 이 here are not particles.
  assert.deepEqual(compareEojeol('사와', '사과', 'loose'), { kind: 'different' });
  assert.deepEqual(compareEojeol('나가', '나이', 'loose'), { kind: 'different' });
  assert.deepEqual(compareEojeol('나', '나이', 'loose'), { kind: 'different' });
  assert.deepEqual(compareEojeol('사', '사과', 'loose'), { kind: 'different' });
  assert.equal(particleMatch('나이가 많다', '나가 많다', 'loose'), null);
});

test('loose: topic ↔ subject and dropped particles', () => {
  assert.deepEqual(compareEojeol('책이', '책은', 'loose'), { kind: 'topicSubject', from: '이', to: '은' });
  assert.deepEqual(compareEojeol('계획', '계획은', 'loose'), { kind: 'dropped', particle: '은' });
  assert.deepEqual(compareEojeol('책이', '책은', 'allomorph'), { kind: 'different' });
  assert.deepEqual(compareEojeol('계획', '계획은', 'allomorph'), { kind: 'different' });
  assert.deepEqual(compareEojeol('책가', '책은', 'loose'), { kind: 'wrongAllomorph', fix: '책이' });
  assert.deepEqual(compareEojeol('책을', '책은', 'loose'), { kind: 'different' }); // object ≠ topic
});

test('particleMatch over a sentence', () => {
  const m = particleMatch('근데 그 계획 실현 안 됐어요', '근데 그 계획은 실현이 안 됐어요', 'loose');
  assert.equal(m?.kind, 'equal');
  assert.equal(m?.notes.length, 2);
  assert.equal(particleMatch('책를 읽었다', '책을 읽었다', 'allomorph')?.kind, 'wrongAllomorph');
  assert.equal(particleMatch('책을 읽었다', '책을 읽었다', 'loose'), null);          // nothing to do
  assert.equal(particleMatch('책을 샀다', '책을 읽었다', 'loose'), null);            // other change
  assert.equal(particleMatch('책을', '책을 읽었다', 'loose'), null);                 // eojeol count
});

test('findWrongAllomorphs is alignment-free and conservative', () => {
  assert.deepEqual(findWrongAllomorphs('어제 자료를 다시 책를 봤어요', ['어제 책을 다시 봤어요']), [{ typed: '책를', fix: '책을' }]);
  assert.deepEqual(findWrongAllomorphs('사과를 샀어요', ['사과를 샀어요']), []);
  assert.deepEqual(findWrongAllomorphs('사과 샀어요', ['사과를 샀어요']), []);
});
