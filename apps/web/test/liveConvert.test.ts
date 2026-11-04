import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyKey, classifyKey, runIsLive, toLatinField, typeKeys, type FieldState } from '../src/state/liveConvert.ts';

const empty: FieldState = { value: '', selStart: 0, selEnd: 0, run: null };
const at = (value: string, caret = value.length): FieldState => ({ value, selStart: caret, selEnd: caret, run: null });

/** The value after each keystroke. */
function steps(keys: string, from: FieldState = empty): string[] {
  const out: string[] = [];
  let s = from;
  for (const k of keys) { s = typeKeys(s, [k]); out.push(s.value); }
  return out;
}

test('망설이다: syllables recompose as you type, like a Korean IME', () => {
  const s = typeKeys(empty, [...'akdtjfdlek']);
  assert.equal(s.value, '망설이다');
  assert.equal(s.selStart, 4);
  assert.deepEqual(s.run, { start: 0, keys: 'akdtjfdlek' });
});

test('exact intermediate states for 망설이다', () => {
  assert.deepEqual(steps('akdtjfdlek'), ['ㅁ', '마', '망', '망ㅅ', '망서', '망설', '망설ㅇ', '망설이', '망설읻', '망설이다']);
});

test('깎다: Shift-R is ㄲ, initial and final', () => {
  assert.deepEqual(steps('RkRek'), ['ㄲ', '까', '깎', '깎ㄷ', '깎다']);
});

test('얘기: Shift-O is ㅒ', () => {
  assert.deepEqual(steps('dOrl'), ['ㅇ', '얘', '얙', '얘기']);
});

test('읽다: compound final ㄺ forms, then splits when a vowel follows', () => {
  assert.deepEqual(steps('dlfrek'), ['ㅇ', '이', '일', '읽', '읽ㄷ', '읽다']);
  assert.equal(typeKeys(empty, [...'dlfrdj']).value, '읽어');
});

test('Backspace inside a run removes one keystroke (one jamo) and recomposes', () => {
  let s = typeKeys(empty, [...'akdtjf']);
  assert.equal(s.value, '망설');
  const seen: string[] = [];
  for (let i = 0; i < 6; i++) { s = typeKeys(s, ['⌫']); seen.push(s.value); }
  assert.deepEqual(seen, ['망서', '망ㅅ', '망', '마', 'ㅁ', '']);
  assert.equal(s.run, null);
  // Compound vowel: ㅘ (h k) → ㅗ.
  assert.equal(typeKeys(empty, [...'rhk', '⌫']).value, '고');
});

test('Backspace with no live run is the browser default (whole character)', () => {
  const r = applyKey(at('망설'), { kind: 'backspace' });
  assert.equal(r.handled, false);
  assert.equal(typeKeys(at('망설'), ['⌫']).value, '망');
});

test('space commits the run: the next letters start a new run and never merge back', () => {
  const s = typeKeys(empty, [...'rkqtl', ' ', ...'dkssud']);
  assert.equal(s.value, '갑시 안녕');
  // After a commit, Backspace deletes whole characters again.
  const committed = typeKeys(empty, [...'rk', ' ']);
  assert.equal(committed.run, null);
  assert.equal(typeKeys(committed, ['⌫', '⌫']).value, '');
});

test('digits and punctuation pass through and commit', () => {
  assert.equal(typeKeys(empty, [...'tp', '3', ...'tkf', '!']).value, '세3살!');
  assert.equal(typeKeys(empty, [...'dk', '.', ...'k']).value, '아.ㅏ');
});

test('mid-string insertion keeps the text before and after the caret', () => {
  const s = typeKeys(at('나는  좋아', 3), [...'akdtjfdla']);
  assert.equal(s.value, '나는 망설임 좋아');
  assert.equal(s.selStart, 6);
  // Backspace mid-string also only touches the run.
  assert.equal(typeKeys(s, ['⌫']).value, '나는 망설이 좋아');
});

test('a letter replaces a selection and starts a fresh run there', () => {
  const s = typeKeys({ value: '가나다', selStart: 1, selEnd: 2, run: null }, [...'ak']);
  assert.equal(s.value, '가마다');
  assert.equal(s.selStart, 2);
});

test('a run whose text or caret moved is no longer live (click elsewhere = commit)', () => {
  const s = typeKeys(empty, [...'ak']);
  assert.ok(runIsLive(s));
  assert.equal(runIsLive({ ...s, selStart: 0, selEnd: 0 }), false);
  assert.equal(runIsLive({ ...s, value: 'X마' }), false);
  // Typing after moving the caret starts a new run instead of rewriting the old one.
  assert.equal(typeKeys({ ...s, selStart: 0, selEnd: 0 }, ['r']).value, 'ㄱ마');
});

test('classifyKey: composition and modifiers', () => {
  assert.deepEqual(classifyKey({ key: 'a' }), { kind: 'letter', key: 'a' });
  assert.deepEqual(classifyKey({ key: 'R' }), { kind: 'letter', key: 'R' }); // Shift allowed
  assert.equal(classifyKey({ key: 'a', isComposing: true }), 'ignore');
  assert.equal(classifyKey({ key: 'Process', keyCode: 229 }), 'ignore');
  assert.equal(classifyKey({ key: 'Shift' }), 'ignore');
  assert.deepEqual(classifyKey({ key: 'a', metaKey: true }), { kind: 'commit' });
  assert.deepEqual(classifyKey({ key: 'v', ctrlKey: true }), { kind: 'commit' });
  assert.deepEqual(classifyKey({ key: 'a', altKey: true }), { kind: 'commit' });
  for (const k of [' ', 'Enter', 'ArrowLeft', 'Home', 'Tab', '1', '.', 'Delete']) assert.deepEqual(classifyKey({ key: k }), { kind: 'commit' }, k);
  assert.deepEqual(classifyKey({ key: 'Backspace' }), { kind: 'backspace' });
  assert.deepEqual(classifyKey({ key: 'ㅁ' }), { kind: 'commit' }); // a Hangul key value is the OS IME's, not ours
});

test('toLatinField: Hangul back to Latin keys, caret after the same keystroke', () => {
  assert.deepEqual(toLatinField('ㅗ디ㅣㅐ', 4), { value: 'hello', caret: 5 });
  assert.deepEqual(toLatinField('to 헬로', 6), { value: 'to gpffh', caret: 8 });
  assert.deepEqual(toLatinField('ㅅㅐ ㅗ', 2), { value: 'to h', caret: 2 });
  assert.equal(toLatinField('hello', 5), null);
});
