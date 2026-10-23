import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  enTolerance, isConfusable, jamoDiff, jamoDistance, koTolerance, levenshtein, substitutionCost, toJamo, weightedDistance,
} from '../src/index.ts';
import { forAll, pick, arrayOf } from '../../test-support/src/index.ts';

test('confusable substitutions cost 0.5', () => {
  assert.equal(jamoDistance('베개', '배개'), 0.5);  // ㅔ/ㅐ
  assert.equal(jamoDistance('예', '얘'), 0.5);      // ㅖ/ㅒ
  assert.equal(jamoDistance('서', '소'), 0.5);      // ㅓ/ㅗ
  for (const [a, b] of [['가', '까'], ['다', '따'], ['바', '빠'], ['사', '싸'], ['자', '짜']] as const) {
    assert.equal(jamoDistance(a, b), 0.5, `${a}/${b}`);
  }
  assert.equal(substitutionCost('ㅐ', 'ㅔ'), 0.5);
  assert.equal(isConfusable('ㅔ', 'ㅐ'), true);
  assert.equal(isConfusable('ㅔ', 'ㅓ'), false);
});

test('ordinary edits cost 1', () => {
  assert.equal(jamoDistance('망설이다', '망서리다'), 1);  // missing ㅇ, resyllabified
  assert.equal(jamoDistance('가', '나'), 1);
  assert.equal(jamoDistance('가', '각'), 1);
  assert.equal(jamoDistance('과', '가'), 1);              // compound vowel = 2 jamo
  assert.equal(jamoDistance('', '가'), 2);
  assert.equal(jamoDistance('같다', '같다'), 0);
  assert.equal(jamoDistance('결제', '결재'), 0.5);
});

test('distance is a symmetric metric with identity', () => {
  const syl = pick([...'가각나난다닭라말바빠사싸아자짜차카타파하개게괴의']);
  const g = (r: () => number, s: number): [string, string, string] =>
    [arrayOf(syl, 0, 5)(r, s).join(''), arrayOf(syl, 0, 5)(r, s).join(''), arrayOf(syl, 0, 5)(r, s).join('')];
  forAll(g, ([a, b, c]) => {
    assert.equal(jamoDistance(a, a), 0);
    assert.equal(jamoDistance(a, b), jamoDistance(b, a));
    assert.ok(jamoDistance(a, c) <= jamoDistance(a, b) + jamoDistance(b, c) + 1e-9);
    const ops = jamoDiff(a, b);
    const cost = ops.reduce((s, o) => s + (o.op === 'sub' ? o.cost : 1), 0);
    assert.equal(cost, jamoDistance(a, b));
  }, { runs: 200, seed: 'dist' });
});

test('jamoDiff reports the edit for hints', () => {
  assert.deepEqual(jamoDiff('배개', '베개'), [{ op: 'sub', from: 'ㅐ', to: 'ㅔ', cost: 0.5 }]);
  assert.deepEqual(jamoDiff('망서리다', '망설이다'), [{ op: 'ins', ch: 'ㅇ' }]);
  assert.deepEqual(jamoDiff('갑니다', '가니다'), [{ op: 'del', ch: 'ㅂ' }]);
  assert.deepEqual(jamoDiff('가', '가'), []);
});

test('weightedDistance / levenshtein basics', () => {
  assert.equal(weightedDistance([], []), 0);
  assert.equal(levenshtein('kitten', 'sitting'), 3);
  assert.equal(levenshtein('', 'abc'), 3);
  assert.equal(levenshtein('hesitat', 'hesitate'), 1);
});

test('koTolerance thresholds (§8.2)', () => {
  assert.equal(koTolerance(toJamo('베개').length), 1);
  assert.equal(koTolerance(6), 1);
  assert.equal(koTolerance(7), 1.5);
  assert.equal(koTolerance(12), 1.5);
  assert.equal(koTolerance(13), 2);
  assert.equal(koTolerance(20), 2);
  assert.equal(koTolerance(30), 3);
  assert.equal(koTolerance(100), 4);
});

test('enTolerance thresholds (§8.2)', () => {
  assert.deepEqual([1, 3, 4, 5, 6, 7, 8, 11, 12, 20, 40].map(enTolerance), [0, 0, 1, 1, 2, 2, 2, 2, 3, 4, 4]);
});
