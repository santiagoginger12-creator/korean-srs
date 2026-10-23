import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dubeolsikKey, dubeolsikToHangul, looksLikeDubeolsik, toJamo } from '../src/index.ts';
import { forAll, pick, arrayOf } from '../../test-support/src/index.ts';

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
