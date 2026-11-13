// Runtime shortcut matching (D87): `matches` on the registry defaults (no store state in node).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyLabel, matches } from '../src/state/hotkeys.tsx';
import { isRevealKey, ratingFromKey } from '../src/features/drill/modes/FlipMode.tsx';

const ev = (key: string, code: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) =>
  ({ key, code, metaKey: false, ctrlKey: false, altKey: false, ...mods });

test('matches: physical keys under the Korean input source, numpad, no modifier combos', () => {
  assert.ok(matches('finish.drill', ev('ㅇ', 'KeyD')), 'D with the Korean input source on');
  assert.ok(matches('drill.open', ev('ㅇ', 'KeyD')));
  assert.ok(matches('finish.lessons', ev('ㅣ', 'KeyL')));
  assert.ok(matches('quiz.translation', ev('ㅅ', 'KeyT')));
  assert.ok(matches('finish.home', ev('ArrowRight', 'ArrowRight')));
  assert.ok(matches('drill.good', ev('3', 'Numpad3')));
  assert.ok(matches('drill.reveal', ev('Enter', 'NumpadEnter')) && matches('drill.reveal', ev(' ', 'Space')));
  assert.ok(!matches('drill.undo', ev('z', 'KeyZ', { metaKey: true })), 'Cmd+Z stays a separate fixed binding');
  assert.ok(!matches('finish.reviews', ev('r', 'KeyR', { ctrlKey: true })), 'Ctrl+R stays with the browser');
  assert.ok(!matches('drill.good', ev('1', 'Digit1')));
  assert.equal(ratingFromKey({ key: 'ㅓ', code: 'KeyJ' }), null);
  assert.equal(ratingFromKey({ key: '2', code: 'Digit2' }), 2);
  assert.ok(isRevealKey({ key: 'Enter', code: 'Enter' }));
  assert.deepEqual(['finish.home', 'drill.reveal', 'drill.good', 'finish.drill', 'quiz.undo'].map(keyLabel), ['→', 'Space', '3', 'D', '⌫']);
});
