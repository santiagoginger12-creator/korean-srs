// Keyboard shortcuts (D87): one registry of every rebindable action, the `keys.bindings` setting
// (overrides only, coerced on replay per D53), conflict rules and key matching. Pure: the web app
// wires DOM events to `eventMatches` and renders `formatCode`.
//
// Bindings are physical keys (`KeyboardEvent.code`), so they keep working with the Korean input
// source on (D73/D75). A digit binding also matches the numpad digit, and Enter matches
// NumpadEnter. Only modifier-free keys can be bound; Cmd/Ctrl/Alt combos stay with the browser.

export type HotkeyGroup = 'Lessons' | 'Reviews and quizzes' | 'Finish screens' | 'Drill';

/**
 * Screens a shortcut is live on. Two actions that share a screen may not share a key; actions that
 * never appear together (lesson → and finish-screen →) may.
 */
export type HotkeyScreen =
  | 'lesson-teach' | 'quiz' | 'quiz-done' | 'finish' | 'drill-summary' | 'drill-session' | 'drill-home' | 'dashboard';

export interface HotkeyAction {
  id: string;
  label: string;
  group: HotkeyGroup;
  /** Today's keys, primary first (at most 2). */
  defaults: readonly string[];
  screens: readonly HotkeyScreen[];
  /** Shown under the label in Settings. */
  note?: string;
}

const A = (id: string, label: string, group: HotkeyGroup, defaults: string[], screens: HotkeyScreen[], note?: string): HotkeyAction =>
  Object.freeze({ id, label, group, defaults: Object.freeze(defaults), screens: Object.freeze(screens), ...(note ? { note } : {}) });

/** Every rebindable action, in Settings order. Defaults equal the pre-D87 hard-coded keys. */
export const HOTKEY_ACTIONS: readonly HotkeyAction[] = Object.freeze([
  A('lesson.next', 'Next page / start quiz', 'Lessons', ['ArrowRight'], ['lesson-teach']),
  A('lesson.prev', 'Previous page', 'Lessons', ['ArrowLeft'], ['lesson-teach']),

  A('quiz.next', 'Next question (after answering)', 'Reviews and quizzes', ['Enter'], ['quiz'],
    'Enter in the answer field always submits and continues.'),
  A('quiz.undo', 'Undo the answer (after answering)', 'Reviews and quizzes', ['Backspace'], ['quiz']),
  A('quiz.translation', 'Show grammar translation', 'Reviews and quizzes', ['KeyT'], ['quiz']),

  A('finish.home', 'Home / Finish lessons', 'Finish screens', ['ArrowRight'], ['finish', 'drill-summary', 'quiz-done']),
  A('finish.lessons', 'Lessons', 'Finish screens', ['KeyL'], ['finish', 'drill-summary']),
  A('finish.grammar', 'Grammar lessons', 'Finish screens', ['KeyG'], ['finish', 'drill-summary']),
  A('finish.reviews', 'Reviews', 'Finish screens', ['KeyR'], ['finish', 'drill-summary']),
  A('finish.drill', 'Drill', 'Finish screens', ['KeyD'], ['finish', 'drill-summary']),

  A('drill.open', 'Open the drill (dashboard)', 'Drill', ['KeyD'], ['dashboard']),
  A('drill.start', 'Start a session (drill page)', 'Drill', ['Space', 'Enter'], ['drill-home']),
  A('drill.reveal', 'Show answer', 'Drill', ['Space', 'Enter'], ['drill-session']),
  A('drill.again', 'Again', 'Drill', ['Digit1'], ['drill-session']),
  A('drill.hard', 'Hard', 'Drill', ['Digit2'], ['drill-session']),
  A('drill.good', 'Good', 'Drill', ['Digit3'], ['drill-session']),
  A('drill.easy', 'Easy', 'Drill', ['Digit4'], ['drill-session']),
  A('drill.undo', 'Undo last answer', 'Drill', ['KeyZ'], ['drill-session', 'drill-summary'], 'Cmd/Ctrl+Z also undoes.'),
  A('drill.known', 'I already know this (and confirm)', 'Drill', ['KeyK'], ['drill-session'],
    'In the confirm, Enter and Y also confirm; Esc and N cancel.'),
  A('drill.translation', 'Show example translation', 'Drill', ['KeyT'], ['drill-session']),
]);

export const HOTKEY_GROUPS: readonly HotkeyGroup[] = ['Lessons', 'Reviews and quizzes', 'Finish screens', 'Drill'];
export const HOTKEY_BY_ID: ReadonlyMap<string, HotkeyAction> = new Map(HOTKEY_ACTIONS.map((a) => [a.id, a]));
export const MAX_KEYS_PER_ACTION = 2;

/** Keys that stay fixed on a screen (not rebindable), so no action there may take them. */
export const RESERVED_CODES: Readonly<Partial<Record<HotkeyScreen, readonly string[]>>> = Object.freeze({
  // Nuance questions: 1–9 pick an option.
  quiz: ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'],
  // Mark-as-known confirm: Y confirms, N cancels.
  'drill-session': ['KeyY', 'KeyN'],
});

const PUNCT: Record<string, string> = {
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';',
  Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
};
const ARROWS: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' };

/** Codes a shortcut may use: letters, digits, arrows, Space, Enter, Backspace, punctuation. Tab and Escape never. */
export function isBindableCode(code: unknown): code is string {
  if (typeof code !== 'string') return false;
  return /^Key[A-Z]$/.test(code) || /^Digit[0-9]$/.test(code) || code in ARROWS || code in PUNCT
    || code === 'Space' || code === 'Enter' || code === 'Backspace';
}

/** The stored form of a pressed key: numpad digits and NumpadEnter fold into their main-row codes. */
export function canonicalCode(code: string): string {
  const m = /^Numpad([0-9])$/.exec(code);
  if (m) return `Digit${m[1]}`;
  if (code === 'NumpadEnter') return 'Enter';
  return code;
}

/** What a keydown's `key` is for this code on a US layout (the e.key fallback the old handlers had). */
function keyFor(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (code === 'Space') return ' ';
  if (code in PUNCT) return PUNCT[code]!;
  return code; // Enter, Backspace, arrows: key and code agree
}

export interface KeyLike { key: string; code: string }

/** Does this keydown press `code`? Physical key first; the US-layout e.key as a fallback. */
export function codeMatches(code: string, e: KeyLike): boolean {
  if (e.code && canonicalCode(e.code) === code) return true;
  const k = keyFor(code);
  if (k === null) return false;
  return /^Key[A-Z]$/.test(code) ? (e.key ?? '').toLowerCase() === k : e.key === k;
}

/** Label for a code: "→", "Space", "Enter", "1", "D", "⌫"… */
export function formatCode(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (code in ARROWS) return ARROWS[code]!;
  if (code in PUNCT) return PUNCT[code]!;
  if (code === 'Backspace') return '⌫';
  return code; // Space, Enter
}

export type HotkeyBindings = Record<string, string[]>;

/**
 * Coerce `keys.bindings` (D53). Keeps only known action ids whose value is 1–2 distinct bindable
 * codes; anything else is dropped (per entry, so one bad entry doesn't lose the rest). Not an
 * object at all → undefined (the write is ignored).
 */
export function coerceBindings(value: unknown): HotkeyBindings | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: HotkeyBindings = {};
  for (const [id, codes] of Object.entries(value as Record<string, unknown>)) {
    if (!HOTKEY_BY_ID.has(id) || !Array.isArray(codes)) continue;
    if (codes.length < 1 || codes.length > MAX_KEYS_PER_ACTION) continue;
    if (!codes.every(isBindableCode) || new Set(codes).size !== codes.length) continue;
    out[id] = (codes as string[]).slice();
  }
  return out;
}

/** Every action's current keys: the override if there is one, else the defaults. */
export function resolveBindings(overrides: HotkeyBindings | undefined): Record<string, readonly string[]> {
  const out: Record<string, readonly string[]> = {};
  for (const a of HOTKEY_ACTIONS) out[a.id] = overrides?.[a.id] ?? a.defaults;
  return out;
}

/** Drop overrides equal to the defaults, so a reset row stores nothing. */
export function compactBindings(b: Record<string, readonly string[]>): HotkeyBindings {
  const out: HotkeyBindings = {};
  for (const a of HOTKEY_ACTIONS) {
    const v = b[a.id];
    if (!v) continue;
    if (v.length === a.defaults.length && v.every((c, i) => c === a.defaults[i])) continue;
    out[a.id] = v.slice();
  }
  return out;
}

export interface HotkeyConflict {
  code: string;
  /** The other action holding the key, or null for a key reserved on that screen. */
  otherId: string | null;
  screen: HotkeyScreen;
}

/** Who else would hold `code` on a screen `actionId` is live on (ignoring `actionId` itself). */
export function conflictFor(resolved: Record<string, readonly string[]>, actionId: string, code: string): HotkeyConflict | null {
  const a = HOTKEY_BY_ID.get(actionId);
  if (!a) return null;
  for (const screen of a.screens) {
    if (RESERVED_CODES[screen]?.includes(code)) return { code, otherId: null, screen };
    for (const b of HOTKEY_ACTIONS) {
      if (b.id === actionId || !b.screens.includes(screen)) continue;
      if ((resolved[b.id] ?? []).includes(code)) return { code, otherId: b.id, screen };
    }
  }
  return null;
}

/** Every clash in a full binding set (empty = valid). Each pair is reported once. */
export function findConflicts(resolved: Record<string, readonly string[]>): HotkeyConflict[] {
  const out: HotkeyConflict[] = [];
  const seen = new Set<string>();
  for (const a of HOTKEY_ACTIONS) {
    const codes = resolved[a.id] ?? [];
    if (codes.length === 0 || codes.length > MAX_KEYS_PER_ACTION || new Set(codes).size !== codes.length) {
      out.push({ code: codes[0] ?? '', otherId: a.id, screen: a.screens[0]! });
      continue;
    }
    for (const code of codes) {
      const c = conflictFor(resolved, a.id, code);
      if (!c) continue;
      const k = [a.id, c.otherId ?? '', code].sort().join('|');
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(c);
    }
  }
  return out;
}

export type BindResult =
  | { ok: true; bindings: Record<string, readonly string[]> }
  | { ok: false; reason: 'invalid' | 'reserved' | 'same-action' }
  | { ok: false; reason: 'conflict'; otherId: string; swap: Record<string, readonly string[]> | null };

/**
 * Put `code` in slot `slot` (0 = primary, 1 = alternate) of `actionId`. On a clash, `swap` is the
 * binding set where the other action takes this slot's old key instead (null when that wouldn't be
 * valid either, e.g. it would leave the other action with no key). Never returns an invalid set.
 */
export function bindKey(resolved: Record<string, readonly string[]>, actionId: string, slot: 0 | 1, code: string): BindResult {
  const a = HOTKEY_BY_ID.get(actionId);
  if (!a || !isBindableCode(code)) return { ok: false, reason: 'invalid' };
  const cur = (resolved[actionId] ?? a.defaults).slice();
  const at = Math.min(slot, cur.length);
  if (cur[at] === code) return { ok: true, bindings: resolved };
  if (cur.includes(code)) return { ok: false, reason: 'same-action' };
  const old = cur[at];
  const mine = cur.slice();
  mine[at] = code;
  const next = { ...resolved, [actionId]: mine };
  const c = conflictFor(resolved, actionId, code);
  if (!c) return { ok: true, bindings: next };
  if (!c.otherId) return { ok: false, reason: 'reserved' };
  const theirs = (resolved[c.otherId] ?? []).slice();
  const i = theirs.indexOf(code);
  let swapped: string[];
  if (old !== undefined && !theirs.includes(old)) { swapped = theirs; swapped[i] = old; }
  else swapped = theirs.filter((x) => x !== code);
  const swap = { ...next, [c.otherId]: swapped };
  return { ok: false, reason: 'conflict', otherId: c.otherId, swap: findConflicts(swap).length === 0 ? swap : null };
}

/** Remove the alternate key (the primary can't be removed). */
export function removeAlternate(resolved: Record<string, readonly string[]>, actionId: string): Record<string, readonly string[]> {
  const cur = resolved[actionId];
  if (!cur || cur.length < 2) return resolved;
  return { ...resolved, [actionId]: [cur[0]!] };
}
