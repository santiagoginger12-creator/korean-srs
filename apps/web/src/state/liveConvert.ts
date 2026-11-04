// Live keyboard-layout conversion for answer fields (ARCHITECTURE.md §8.6). A web page can't
// switch the OS keyboard, so a Korean field turns Latin keystrokes into 두벌식 Hangul as a
// Korean IME would, and an English field turns Hangul back into the Latin keys it came from.
//
// Pure: the component feeds it the field's (value, selection, run) and writes back the result,
// so the composition logic is testable without a DOM.
//
// A *run* is the current stretch of Latin keystrokes at the caret. Its keys are kept raw and the
// whole run is re-rendered with dubeolsikToHangul on every keystroke, so syllables recompose as
// you type (ㅁ → 마 → 망 → 망ㅅ → 망서 …) and Backspace removes one keystroke (one jamo).

import { dubeolsikToHangul, hangulToDubeolsik, hasHangul } from '@ksrs/answer-check';

export interface Run {
  /** Where the run's rendered Hangul starts in `value`. */
  start: number;
  /** The raw Latin keys typed so far (case matters: Shift-R = ㄲ). */
  keys: string;
}

export interface FieldState {
  value: string;
  selStart: number;
  selEnd: number;
  run: Run | null;
}

export type KeyAction = { kind: 'letter'; key: string } | { kind: 'backspace' } | { kind: 'commit' };

export interface KeyResult {
  state: FieldState;
  /** True → the caller cancels the browser's default and writes `state` back to the field. */
  handled: boolean;
}

export const isConvertibleKey = (key: string): boolean => key.length === 1 && /^[A-Za-z]$/.test(key);

/** Keys that never touch the text or the caret: pressing them must not end a run (Shift before R). */
const INERT = new Set(['Shift', 'CapsLock', 'Control', 'Meta', 'Alt', 'AltGraph', 'Fn', 'FnLock', 'Hyper', 'Super', 'OS', 'Unidentified', 'Dead', 'Process']);

export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
}

/**
 * What a keydown means for the run. 'ignore' while an IME is composing (the OS Korean keyboard
 * is active: never intercept) and for inert modifier keys. Ctrl/Meta/Alt shortcuts, Space,
 * digits, punctuation, Enter, Tab and navigation keys all commit the run.
 */
export function classifyKey(e: KeyLike): KeyAction | 'ignore' {
  if (e.isComposing || e.keyCode === 229) return 'ignore';
  if (INERT.has(e.key)) return 'ignore';
  if (e.ctrlKey || e.metaKey || e.altKey) return { kind: 'commit' };
  if (isConvertibleKey(e.key)) return { kind: 'letter', key: e.key };
  if (e.key === 'Backspace') return { kind: 'backspace' };
  return { kind: 'commit' };
}

/** The run is still live: its rendered text sits immediately before a collapsed caret. */
export function runIsLive(s: FieldState): boolean {
  const r = s.run;
  if (!r || r.keys === '' || s.selStart !== s.selEnd) return false;
  const seg = dubeolsikToHangul(r.keys);
  return s.selStart === r.start + seg.length && s.value.slice(r.start, s.selStart) === seg;
}

const render = (value: string, start: number, oldLen: number, keys: string): FieldState => {
  const seg = dubeolsikToHangul(keys);
  const caret = start + seg.length;
  return { value: value.slice(0, start) + seg + value.slice(start + oldLen), selStart: caret, selEnd: caret, run: keys ? { start, keys } : null };
};

/** Apply one key to a Korean-expected field. */
export function applyKey(s: FieldState, a: KeyAction): KeyResult {
  const live = runIsLive(s);
  switch (a.kind) {
    case 'letter': {
      if (live) {
        const r = s.run as Run;
        return { handled: true, state: render(s.value, r.start, s.selStart - r.start, r.keys + a.key) };
      }
      // A new run replaces any selection.
      const start = Math.min(s.selStart, s.selEnd);
      const end = Math.max(s.selStart, s.selEnd);
      return { handled: true, state: render(s.value, start, end - start, a.key) };
    }
    case 'backspace': {
      if (!live) return { handled: false, state: { ...s, run: null } };
      const r = s.run as Run;
      return { handled: true, state: render(s.value, r.start, s.selStart - r.start, r.keys.slice(0, -1)) };
    }
    case 'commit':
      return { handled: false, state: { ...s, run: null } };
  }
}

/** Run a whole key sequence (tests and the e2e mental model): letters, '⌫' for Backspace, anything else commits and is inserted as typed. */
export function typeKeys(s: FieldState, keys: readonly string[]): FieldState {
  let st = s;
  for (const k of keys) {
    const a = k === '⌫' ? ({ kind: 'backspace' } as const) : isConvertibleKey(k) ? ({ kind: 'letter', key: k } as const) : ({ kind: 'commit' } as const);
    const r = applyKey(st, a);
    st = r.state;
    if (r.handled) continue;
    // Not handled: the browser's default action.
    const lo = Math.min(st.selStart, st.selEnd);
    const hi = Math.max(st.selStart, st.selEnd);
    if (k === '⌫') {
      const from = lo === hi ? Math.max(0, lo - 1) : lo;
      st = { ...st, value: st.value.slice(0, from) + st.value.slice(hi), selStart: from, selEnd: from };
    } else {
      st = { ...st, value: st.value.slice(0, lo) + k + st.value.slice(hi), selStart: lo + k.length, selEnd: lo + k.length };
    }
  }
  return st;
}

/**
 * English-expected field: Hangul (typed with the Korean keyboard active) → the Latin keys it
 * came from, keeping the caret after the same keystroke. Returns null when there's no Hangul.
 */
export function toLatinField(value: string, caret: number): { value: string; caret: number } | null {
  if (!hasHangul(value)) return null;
  const v = value.normalize('NFC');
  const c = Math.min(caret, v.length);
  return { value: hangulToDubeolsik(v), caret: hangulToDubeolsik(v.slice(0, c)).length };
}
