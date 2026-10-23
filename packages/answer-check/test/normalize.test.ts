import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basicClean, enAlternatives, hasHangul, hasHanja, hasLatin, looseKoKey, normalizeEn, normalizeKo } from '../src/index.ts';

test('normalizeEn: case, "to", articles, parentheticals, punctuation', () => {
  assert.equal(normalizeEn('To Hesitate'), 'hesitate');
  assert.equal(normalizeEn('to hesitate (of a person)'), 'hesitate');
  assert.equal(normalizeEn('(of a person) brave'), 'brave');
  assert.equal(normalizeEn('a pity'), 'pity');
  assert.equal(normalizeEn('An omen'), 'omen');
  assert.equal(normalizeEn('the outcome!'), 'outcome');
  assert.equal(normalizeEn('to'), 'to');                      // lone "to" survives
  assert.equal(normalizeEn('well-known'), 'well known');
  assert.equal(normalizeEn("one's   duty."), 'ones duty');
  assert.equal(normalizeEn('approval [formal] (sign-off)'), 'approval');
  assert.equal(normalizeEn('to be (nested (paren)) late'), 'be late');
  assert.equal(normalizeEn('  '), '');
});

test('normalizeEn: US/UK spelling map', () => {
  assert.equal(normalizeEn('Colour'), 'color');
  assert.equal(normalizeEn('to apologise'), 'apologize');
  assert.equal(normalizeEn('behaviour'), 'behavior');
  assert.equal(normalizeEn('travelled abroad'), 'traveled abroad');
  assert.equal(normalizeEn('grey'), normalizeEn('gray'));
  assert.equal(normalizeEn('ｃｏｌｏｕｒ'), 'color');           // full-width
});

test('enAlternatives splits on / and ; outside parentheses', () => {
  assert.deepEqual(enAlternatives('payment / settlement'), ['payment', 'settlement']);
  assert.deepEqual(enAlternatives('to be awkward; uncomfortable'), ['to be awkward', 'uncomfortable']);
  assert.deepEqual(enAlternatives('approval (sign-off/stamp)'), ['approval (sign-off/stamp)']);
  assert.deepEqual(enAlternatives(' / x'), ['x']);
});

test('normalizeKo: NFC, full-width, zero-width, whitespace', () => {
  assert.equal(normalizeKo('망설이다'.normalize('NFD')), '망설이다');
  assert.equal(normalizeKo('ＣＤ를　샀다'), 'CD를 샀다');
  assert.equal(normalizeKo('망​설‍이﻿다­'), '망설이다');
  assert.equal(normalizeKo('  쏟아지는 \t\n 바람에  '), '쏟아지는 바람에');
  assert.equal(normalizeKo(' 가　나'), '가 나');
  assert.equal(normalizeKo('“그래”라고'), '"그래"라고');
  assert.equal(normalizeKo('글쎄…'), '글쎄...');
});

test('normalizeKo: Hanja gloss stripping', () => {
  assert.equal(normalizeKo('결제(決濟)'), '결제');
  assert.equal(normalizeKo('결제 (決濟)를 했다'), '결제를 했다');
  assert.equal(normalizeKo('결제（決濟）'), '결제');           // full-width parens
  assert.equal(normalizeKo('결제(결재 아님)'), '결제(결재 아님)'); // non-Hanja parenthetical kept
  assert.equal(normalizeKo('결제()'), '결제()');
  assert.equal(hasHanja('決濟'), true);
});

test('normalizeKo: compatibility / conjoining / half-width jamo', () => {
  assert.equal(normalizeKo('가ㅂ니다'), '갑니다');            // interrupted IME composition
  assert.equal(normalizeKo('ᄀ'), 'ㄱ');                      // leftover conjoining choseong
  assert.equal(normalizeKo('ﾡﾢ'), 'ㄱㄲ');                    // half-width
  assert.equal(normalizeKo('ㄱ ㅏ'), 'ㄱ ㅏ');                 // separate words stay separate
  assert.equal(normalizeKo('갑'), '갑');
});

test('normalizeKo: optional final punctuation', () => {
  assert.equal(normalizeKo('베개.'), '베개.');
  assert.equal(normalizeKo('베개.', { stripFinalPunct: true }), '베개');
  assert.equal(normalizeKo('정말?!~', { stripFinalPunct: true }), '정말');
  assert.equal(normalizeKo('글쎄…', { stripFinalPunct: true }), '글쎄');
  assert.equal(normalizeKo('그래요。', { stripFinalPunct: true }), '그래요');
  assert.equal(normalizeKo('네, 알겠습니다.', { stripFinalPunct: true }), '네, 알겠습니다');
});

test('helpers', () => {
  assert.equal(looseKoKey('쏟아지는 바람에, 정말!'), '쏟아지는바람에정말');
  assert.equal(basicClean('  a  b '), 'a b');
  assert.equal(hasHangul('abc ㄱ'), true);
  assert.equal(hasHangul('abc'), false);
  assert.equal(hasLatin('가a'), true);
});
