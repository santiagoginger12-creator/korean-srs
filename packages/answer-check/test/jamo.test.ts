import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHOSEONG, JONGSEONG, JUNGSEONG, composeSyllable, decomposeSyllable, finalOf, fromJamo, hasFinal, toJamo,
} from '../src/index.ts';
import { forAll, int, pick, arrayOf, bool, type Gen } from '../../test-support/src/index.ts';

const SIMPLE_V = [...'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅛㅜㅠㅡㅣ'];
const COMPOUND_V = [...'ㅘㅙㅚㅝㅞㅟㅢ'];
const COMPOUND_F = [...'ㄳㄵㄶㄺㄻㄼㄽㄾㄿㅀㅄ'];
const SIMPLE_F = (JONGSEONG as readonly string[]).filter((f) => !COMPOUND_F.includes(f));

const syllable = (compound: boolean): Gen<string> => (r) => {
  const cho = pick([...CHOSEONG])(r, 0);
  const jung = compound ? pick([...JUNGSEONG])(r, 0) : pick(SIMPLE_V)(r, 0);
  const jong = compound ? pick([...JONGSEONG])(r, 0) : pick(SIMPLE_F)(r, 0);
  return composeSyllable(cho, jung, jong) as string;
};
const text = (compound: boolean): Gen<string> => (r, size) =>
  arrayOf(syllable(compound), 1, Math.max(1, size))(r, size).map((s) => (bool(0.15)(r, 0) ? s + ' ' : s)).join('').trim();

test('toJamo → fromJamo round-trips simple syllable strings', () => {
  forAll(text(false), (s) => assert.equal(fromJamo(toJamo(s)), s), { runs: 300, seed: 'jamo-simple' });
});

test('toJamo → fromJamo round-trips strings with compound vowels and finals', () => {
  forAll(text(true), (s) => assert.equal(fromJamo(toJamo(s)), s), { runs: 300, seed: 'jamo-compound' });
});

test('fromJamo accepts a jamo array as well as a string', () => {
  forAll(text(true), (s) => assert.equal(fromJamo(toJamo(s)), fromJamo(s)), { runs: 100, seed: 'jamo-array' });
});

test('NFD input decomposes identically to NFC', () => {
  forAll(text(true), (s) => {
    assert.deepEqual(toJamo(s.normalize('NFD')), toJamo(s));
    assert.equal(fromJamo(s.normalize('NFD')), s);
  }, { runs: 200, seed: 'jamo-nfd' });
});

test('decompose/compose are inverse over all 11172 syllables', () => {
  for (let c = 0xac00; c <= 0xd7a3; c++) {
    const ch = String.fromCodePoint(c);
    const d = decomposeSyllable(ch);
    assert.ok(d);
    assert.equal(composeSyllable(d.cho, d.jung, d.jong), ch);
  }
});

test('toJamo splits compound vowels and finals, keeps tense initials', () => {
  assert.deepEqual(toJamo('과'), ['ㄱ', 'ㅗ', 'ㅏ']);
  assert.deepEqual(toJamo('닭'), ['ㄷ', 'ㅏ', 'ㄹ', 'ㄱ']);
  assert.deepEqual(toJamo('의'), ['ㅇ', 'ㅡ', 'ㅣ']);
  assert.deepEqual(toJamo('값'), ['ㄱ', 'ㅏ', 'ㅂ', 'ㅅ']);
  assert.deepEqual(toJamo('쌍'), ['ㅆ', 'ㅏ', 'ㅇ']);
  assert.deepEqual(toJamo('밖'), ['ㅂ', 'ㅏ', 'ㄲ']);
  assert.deepEqual(toJamo('a 가!'), ['a', ' ', 'ㄱ', 'ㅏ', '!']);
  assert.deepEqual(toJamo('ㅘ'), ['ㅗ', 'ㅏ']);
  assert.deepEqual(toJamo(''), []);
});

test('fromJamo composes like a dubeolsik IME', () => {
  assert.equal(fromJamo('가ㅂ니다'), '갑니다');       // interrupted composition
  assert.equal(fromJamo('ㄷㅏㄹㄱㅇㅣ'), '닭이');
  assert.equal(fromJamo('ㄷㅏㄹㄱㅏ'), '달가');        // final moves to next syllable
  assert.equal(fromJamo('ㅇㅏㄴㅈㅇㅏ'), '앉아');
  assert.equal(fromJamo('ㅇㅗㅏ'), '와');
  assert.equal(fromJamo('ㄱㅅ'), 'ㄳ');              // lone cluster
  assert.equal(fromJamo('ㄱㅅㅏ'), 'ㄱ사');
  assert.equal(fromJamo('ㅋㅋ'), 'ㅋㅋ');
  assert.equal(fromJamo('ㅏ'), 'ㅏ');
  assert.equal(fromJamo('ㄸㅏㄸ'), '따ㄸ');          // ㄸ cannot be a final
  assert.equal(fromJamo('abc 가'), 'abc 가');
  assert.equal(fromJamo(''), '');
});

test('composeSyllable rejects invalid parts', () => {
  assert.equal(composeSyllable('ㅏ', 'ㅏ'), null);
  assert.equal(composeSyllable('ㄱ', 'ㄱ'), null);
  assert.equal(composeSyllable('ㄱ', 'ㅏ', 'ㄸ'), null);
  assert.equal(composeSyllable('ㄳ', 'ㅏ'), null);
  assert.equal(decomposeSyllable('a'), null);
});

test('hasFinal / finalOf', () => {
  assert.equal(hasFinal('책'), true);
  assert.equal(hasFinal('사'), false);
  assert.equal(finalOf('길'), 'ㄹ');
  assert.equal(finalOf('닭'), 'ㄺ');
  assert.equal(finalOf('x'), '');
  assert.equal(int(1, 1)(() => 0, 0), 1);
});
