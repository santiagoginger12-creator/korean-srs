// Dubeolsik (2-set) keyboard → Hangul, for answers typed with the wrong
// keyboard layout active (ARCHITECTURE.md §8.3 layer 0).
import { fromJamo, isCompatJamo, isSyllable, toJamo } from './jamo.ts';

const LOWER: Record<string, string> = {
  q: 'ㅂ', w: 'ㅈ', e: 'ㄷ', r: 'ㄱ', t: 'ㅅ', y: 'ㅛ', u: 'ㅕ', i: 'ㅑ', o: 'ㅐ', p: 'ㅔ',
  a: 'ㅁ', s: 'ㄴ', d: 'ㅇ', f: 'ㄹ', g: 'ㅎ', h: 'ㅗ', j: 'ㅓ', k: 'ㅏ', l: 'ㅣ',
  z: 'ㅋ', x: 'ㅌ', c: 'ㅊ', v: 'ㅍ', b: 'ㅠ', n: 'ㅜ', m: 'ㅡ',
};
/** Shifted keys that produce a different jamo; other capitals behave as lowercase (caps lock). */
const SHIFT: Record<string, string> = { Q: 'ㅃ', W: 'ㅉ', E: 'ㄸ', R: 'ㄲ', T: 'ㅆ', O: 'ㅒ', P: 'ㅖ' };

/** Jamo → the QWERTY key that types it (tense consonants and ㅒ/ㅖ need Shift). */
const KEY_OF: Record<string, string> = {
  ...Object.fromEntries(Object.entries(LOWER).map(([k, j]) => [j, k])),
  ...Object.fromEntries(Object.entries(SHIFT).map(([k, j]) => [j, k])),
};

/** Map one QWERTY key to its dubeolsik jamo (or return it unchanged). */
export function dubeolsikKey(ch: string): string {
  return SHIFT[ch] ?? LOWER[ch.toLowerCase()] ?? ch;
}

/**
 * Convert QWERTY keystrokes to Hangul as a dubeolsik IME would compose them.
 * Non-letters (spaces, digits, punctuation) and existing Hangul pass through.
 * "rkskek" → "가나다", "akdtjfdlek" → "망설이다", "RKa" → "깜".
 */
export function dubeolsikToHangul(ascii: string): string {
  // Compose each whitespace-separated chunk independently so spaces stay put.
  return ascii.split(/(\s+)/).map((chunk) =>
    /^\s*$/.test(chunk) ? chunk : fromJamo([...chunk].map(dubeolsikKey))).join('');
}

/**
 * Heuristic: does this Latin text look like Korean typed on the wrong layout?
 * True when it has Latin letters and their conversion yields mostly complete
 * syllables (few stranded jamo). English words usually leave many lone jamo
 * ("hesitate" → "ㅗㄷ냣ㅁㅅㄷ").
 */
export function looksLikeDubeolsik(s: string): boolean {
  if (!/[A-Za-z]/.test(s)) return false;
  let syllables = 0;
  let lone = 0;
  for (const run of s.match(/[A-Za-z]+/g) ?? []) {
    for (const ch of dubeolsikToHangul(run)) {
      if (isSyllable(ch)) syllables++;
      else if (isCompatJamo(ch)) lone++;
    }
  }
  return syllables > 0 && lone <= Math.max(0, Math.floor(syllables / 4));
}

/**
 * Inverse of `dubeolsikToHangul`: the QWERTY keys that type this Hangul on a dubeolsik
 * layout, for English typed while the Korean keyboard was active. Compound vowels and
 * finals split into their keystrokes; anything that isn't Hangul passes through.
 * "ㅗ디ㅣㅐ" → "hello", "망설이다" → "akdtjfdlek", "깎다" → "RkRek".
 */
export function hangulToDubeolsik(s: string): string {
  return toJamo(s).map((j) => KEY_OF[j] ?? j).join('');
}

