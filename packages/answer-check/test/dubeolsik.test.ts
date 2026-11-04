import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dubeolsikKey, dubeolsikToHangul, hangulToDubeolsik, looksLikeDubeolsik, toJamo } from '../src/index.ts';
import { forAll, pick, arrayOf, int, map } from '../../test-support/src/index.ts';

test('dubeolsik examples', () => {
  assert.equal(dubeolsikToHangul('rkskek'), '가나다');
  assert.equal(dubeolsikToHangul('akdtjfdlek'), '망설이다');
  assert.equal(dubeolsikToHangul('RKa'), '깜');           // Shift-R = ㄲ, K behaves as k
  assert.equal(dubeolsikToHangul('Tkd'), '쌍');
  assert.equal(dubeolsikToHangul('Ehd'), '똥');
  assert.equal(dubeolsikToHangul('Qkd'), '빵');
  assert.equal(dubeolsikToHangul('Wkd'), '짱');
  assert.equal(dubeolsikToHangul('dO'), '얘');
  assert.equal(dubeolsikToHangul('dP'), '예');
  assert.equal(dubeolsikToHangul('rhkwp'), '과제');         // compound vowel
  assert.equal(dubeolsikToHangul('dlfrek'), '읽다');        // compound final
  assert.equal(dubeolsikToHangul('dksgdk'), '않아');
  assert.equal(dubeolsikToHangul('ckarp rkqtl'), '참게 갑시'); // spaces preserved
  assert.equal(dubeolsikToHangul('vhrdn!'), '폭우!');
  assert.equal(dubeolsikToHangul('wjdakf?'), '정말?');
  assert.equal(dubeolsikToHangul(''), '');
});

test('every key maps', () => {
  assert.equal([...'qwertyuiopasdfghjklzxcvbnm'].map(dubeolsikKey).join(''), 'ㅂㅈㄷㄱㅅㅛㅕㅑㅐㅔㅁㄴㅇㄹㅎㅗㅓㅏㅣㅋㅌㅊㅍㅠㅜㅡ');
  assert.equal(dubeolsikKey('1'), '1');
  assert.equal(dubeolsikKey('A'), 'ㅁ');
});

test('random keystrokes always produce only Hangul/space', () => {
  forAll(arrayOf(pick([...'qwertyuiopasdfghjklzxcvbnmQWERTOP ']), 1, 30), (ks) => {
    const out = dubeolsikToHangul(ks.join(''));
    for (const ch of out) assert.match(ch, /[\s가-힣ㄱ-ㅣ]/u);
    assert.ok(toJamo(out).length > 0 || out.trim() === '');
  }, { runs: 200, seed: 'dubeolsik' });
});

test('looksLikeDubeolsik', () => {
  assert.equal(looksLikeDubeolsik('akdtjfdlek'), true);
  assert.equal(looksLikeDubeolsik('rkskek'), true);
  assert.equal(looksLikeDubeolsik('qpro'), true);           // 베개
  assert.equal(looksLikeDubeolsik('hesitate'), false);
  assert.equal(looksLikeDubeolsik('pillow'), false);
  assert.equal(looksLikeDubeolsik('approval'), false);
  assert.equal(looksLikeDubeolsik('zz'), false);
  assert.equal(looksLikeDubeolsik('망설이다'), false);
  assert.equal(looksLikeDubeolsik(''), false);
});

test('hangulToDubeolsik: Hangul typed on the Korean layout → the Latin keys', () => {
  assert.equal(hangulToDubeolsik('ㅗ디ㅣㅐ'), 'hello');
  assert.equal(hangulToDubeolsik('헬로'), 'gpffh');          // 헬 로 = g p f · f h
  assert.equal(hangulToDubeolsik('망설이다'), 'akdtjfdlek');
  assert.equal(hangulToDubeolsik('깎다'), 'RkRek');          // tense initial and tense final ㄲ
  assert.equal(hangulToDubeolsik('얘기'), 'dOrl');
  assert.equal(hangulToDubeolsik('읽다'), 'dlfrek');         // compound final ㄺ → f r
  assert.equal(hangulToDubeolsik('과제'), 'rhkwp');          // compound vowel ㅘ → h k
  assert.equal(hangulToDubeolsik('ㅅㅐ ㅡㄷ'), 'to me');      // spaces kept
  assert.equal(hangulToDubeolsik('ㅁ ㅔ두 2!'), 'a pen 2!');  // digits, punctuation pass through
  assert.equal(hangulToDubeolsik('abc'), 'abc');
  assert.equal(hangulToDubeolsik(''), '');
});

test('hangulToDubeolsik inverts dubeolsikToHangul on whole syllables', () => {
  const syl = map(int(0, 11171), (n) => String.fromCodePoint(0xac00 + n));
  forAll(arrayOf(syl, 1, 6), (xs) => {
    const s = xs.join('');
    const keys = hangulToDubeolsik(s);
    assert.match(keys, /^[A-Za-z]+$/);
    // Re-typing the keys gives the same jamo (an IME may regroup e.g. 갃아 vs 갂사, never the letters).
    assert.deepEqual(toJamo(dubeolsikToHangul(keys)), toJamo(s));
  }, { runs: 300, seed: 'reverse' });
});
