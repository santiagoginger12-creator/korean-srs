// Keyboard shortcuts (D87): registry defaults, `keys.bindings` coercion, conflicts, key matching.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bindKey, canonicalCode, codeMatches, coerceAppSetting, coerceBindings, compactBindings, defaultAppSettings, findConflicts,
  formatCode, HOTKEY_ACTIONS, removeAlternate, replayAll, resolveBindings, settingPayload,
} from '../src/index.ts';
import { bundle, device, T0 } from './fixtures.ts';

test('registry defaults equal the pre-D87 hard-coded keys', () => {
  const d = resolveBindings(undefined);
  assert.deepEqual(d, {
    'lesson.next': ['ArrowRight'], 'lesson.prev': ['ArrowLeft'],
    'quiz.next': ['Enter'], 'quiz.undo': ['Backspace'], 'quiz.translation': ['KeyT'],
    'finish.home': ['ArrowRight'], 'finish.lessons': ['KeyL'], 'finish.grammar': ['KeyG'], 'finish.reviews': ['KeyR'], 'finish.drill': ['KeyD'],
    'drill.open': ['KeyD'], 'drill.start': ['Space', 'Enter'], 'drill.reveal': ['Space', 'Enter'],
    'drill.again': ['Digit1'], 'drill.hard': ['Digit2'], 'drill.good': ['Digit3'], 'drill.easy': ['Digit4'],
    'drill.undo': ['KeyZ'], 'drill.known': ['KeyK'], 'drill.translation': ['KeyT'],
  });
  assert.deepEqual(findConflicts(d), [], 'the defaults are conflict-free');
  assert.equal(new Set(HOTKEY_ACTIONS.map((a) => a.id)).size, HOTKEY_ACTIONS.length);
  assert.deepEqual(defaultAppSettings()['keys.bindings'], {});
  assert.deepEqual(compactBindings(d), {}, 'defaults store nothing');
});

test('coercion keeps valid overrides and drops bad input', () => {
  assert.deepEqual(coerceBindings({ 'drill.good': ['KeyJ'], 'drill.reveal': ['Space', 'KeyB'] }), { 'drill.good': ['KeyJ'], 'drill.reveal': ['Space', 'KeyB'] });
  assert.equal(coerceBindings(null), undefined);
  assert.equal(coerceBindings('KeyJ'), undefined);
  assert.equal(coerceBindings([['drill.good', ['KeyJ']]]), undefined);
  assert.deepEqual(coerceBindings({
    'made.up': ['KeyJ'], // unknown action
    'drill.good': ['Tab'], // refused
    'drill.hard': ['Escape'],
    'drill.easy': ['KeyJ', 'KeyK', 'KeyL'], // too many
    'drill.again': [], // none
    'drill.undo': ['KeyQ', 'KeyQ'], // duplicate
    'drill.known': 'KeyK', // not a list
    'drill.translation': ['MetaLeft'],
    'finish.home': ['Numpad1'], // stored form is Digit1
    'finish.drill': ['F5'],
    'lesson.next': ['Slash'], // punctuation is fine
  }), { 'lesson.next': ['Slash'] });
  // Through the settings path and replay.
  assert.equal(coerceAppSetting('keys.bindings', 42), undefined);
  assert.deepEqual(coerceAppSetting('keys.bindings', { 'drill.good': ['KeyJ'], x: [1] }), { 'drill.good': ['KeyJ'] });
});

test('replay folds keys.bindings LWW and ignores bad writes; unknown settings are ignored (older apps)', () => {
  const d = device('d');
  const st = replayAll(bundle([]), [
    d(settingPayload('keys.bindings', { 'drill.good': ['KeyJ'] }), T0),
    d({ type: 'settings.set', key: 'keys.bindings' as never, value: 'junk' }, T0 + 1),
    d({ type: 'settings.set', key: 'keys.futureSetting' as never, value: { a: 1 } }, T0 + 2),
  ]);
  assert.deepEqual(st.settings['keys.bindings'], { 'drill.good': ['KeyJ'] });
  assert.equal((st.settings as unknown as Record<string, unknown>)['keys.futureSetting'], undefined);
  // An app before D87 has no case for keys.bindings: coerceAppSetting's default path returns undefined.
  assert.equal(coerceAppSetting('keys.someFutureThing', { a: 1 }), undefined);
  const reset = replayAll(bundle([]), [d(settingPayload('keys.bindings', { 'drill.good': ['KeyJ'] }), T0), d(settingPayload('keys.bindings', {}), T0 + 1)]);
  assert.deepEqual(reset.settings['keys.bindings'], {});
});

test('conflicts: same screen clashes, separate screens may share, swap and reserved keys', () => {
  const d = resolveBindings(undefined);
  // Lesson → and finish-screen → never coexist.
  assert.equal(d['lesson.next']![0], d['finish.home']![0]);
  // Dashboard D and finish-screen D never coexist either.
  assert.equal(d['drill.open']![0], d['finish.drill']![0]);

  // Good → J: fine.
  const r1 = bindKey(d, 'drill.good', 0, 'KeyJ');
  assert.ok(r1.ok);
  if (r1.ok) assert.deepEqual(r1.bindings['drill.good'], ['KeyJ']);

  // Good → 1 clashes with Again; Swap gives Again the old 3.
  const r2 = bindKey(d, 'drill.good', 0, 'Digit1');
  assert.equal(r2.ok, false);
  if (!r2.ok && r2.reason === 'conflict') {
    assert.equal(r2.otherId, 'drill.again');
    assert.ok(r2.swap);
    assert.deepEqual(r2.swap!['drill.good'], ['Digit1']);
    assert.deepEqual(r2.swap!['drill.again'], ['Digit3']);
    assert.deepEqual(findConflicts(r2.swap!), []);
  } else assert.fail('expected a conflict');

  // Finish keys must not clash with each other (Home → L).
  const r3 = bindKey(d, 'finish.home', 0, 'KeyL');
  assert.ok(!r3.ok && r3.reason === 'conflict' && r3.otherId === 'finish.lessons');

  // Drill undo is live on the drill summary too, so it can't take a finish-screen key.
  const r4 = bindKey(d, 'drill.undo', 0, 'KeyR');
  assert.ok(!r4.ok && r4.reason === 'conflict' && r4.otherId === 'finish.reviews');

  // Lesson keys may take a drill key (the screens never coexist).
  assert.ok(bindKey(d, 'lesson.prev', 0, 'KeyK').ok);

  // Adding an alternate that is another action's only key: no valid swap.
  const r5 = bindKey(d, 'drill.known', 1, 'KeyT');
  assert.ok(!r5.ok && r5.reason === 'conflict' && r5.swap === null);

  // Reserved: 1–9 pick nuance options in quizzes; Y/N answer the known-confirm in the drill.
  const r6 = bindKey(d, 'quiz.translation', 0, 'Digit2');
  assert.ok(!r6.ok && r6.reason === 'reserved');
  const r7 = bindKey(d, 'drill.reveal', 1, 'KeyY');
  assert.ok(!r7.ok && r7.reason === 'reserved');

  // The action's own other key; invalid codes.
  const r8 = bindKey(d, 'drill.reveal', 0, 'Enter');
  assert.ok(!r8.ok && r8.reason === 'same-action');
  assert.ok(!bindKey(d, 'drill.good', 0, 'Tab').ok);
  assert.ok(!bindKey(d, 'drill.good', 0, 'Escape').ok);

  // Alternate add/remove.
  const r9 = bindKey(d, 'drill.good', 1, 'KeyJ');
  assert.ok(r9.ok);
  if (r9.ok) {
    assert.deepEqual(r9.bindings['drill.good'], ['Digit3', 'KeyJ']);
    assert.deepEqual(removeAlternate(r9.bindings, 'drill.good')['drill.good'], ['Digit3']);
  }
  assert.deepEqual(removeAlternate(d, 'drill.good'), d, 'the primary key is never removed');

  // A conflicting set (e.g. two devices' writes) is reported.
  assert.equal(findConflicts({ ...d, 'drill.good': ['Digit1'] }).length, 1);
});

test('matching by physical key: Korean input source, numpad, Enter, fallback to e.key', () => {
  assert.ok(codeMatches('KeyD', { key: 'ㅇ', code: 'KeyD' }), 'Korean input source: key ㅇ, code KeyD');
  assert.ok(codeMatches('KeyJ', { key: 'ㅓ', code: 'KeyJ' }));
  assert.ok(!codeMatches('KeyD', { key: 'ㅇ', code: 'KeyA' }));
  assert.ok(codeMatches('KeyD', { key: 'D', code: '' }), 'no code: US-layout key, any case');
  assert.ok(codeMatches('Digit3', { key: '3', code: 'Digit3' }));
  assert.ok(codeMatches('Digit3', { key: 'Unidentified', code: 'Numpad3' }));
  assert.ok(!codeMatches('Digit3', { key: '1', code: 'Digit1' }));
  assert.ok(codeMatches('Enter', { key: 'Enter', code: 'NumpadEnter' }));
  assert.ok(codeMatches('Space', { key: ' ', code: 'Space' }));
  assert.ok(codeMatches('ArrowRight', { key: 'ArrowRight', code: '' }));
  assert.ok(codeMatches('Slash', { key: '/', code: '' }));
  assert.equal(canonicalCode('Numpad7'), 'Digit7');
  assert.equal(canonicalCode('NumpadEnter'), 'Enter');
  assert.deepEqual(['ArrowRight', 'Space', 'Enter', 'Digit1', 'KeyD', 'Backspace', 'Comma'].map(formatCode), ['→', 'Space', 'Enter', '1', 'D', '⌫', ',']);
});
