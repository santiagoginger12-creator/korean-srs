// Cloze hint ladders (pure; unit-tested in test/grammar.test.ts and test/hints.test.ts).
//
// Grammar (D66):
//   level 0: the sentence, its translation and the dictionary form only
//   level 1: the item's short meaning (never the pattern text)
//   level 2: the full pattern
// Grammar cues are written "<dictionary form> + <pattern>". Without " + " the whole cue is the
// base and there is no level 2.
//
// Vocab and expressions (D74: a question never shows its own answer):
//   level 0: the sentence, its translation and the English-only sense cue
//   level 1: the answer's initial consonants (초성) and syllable count, e.g. "ㅅㅈ (2)"
//   level 2: the dictionary form (the headword)
//
// Either way, a correct answer given at level 2 counts as a miss; the level goes into
// check.layer ("exact+hint2"), which the frozen event format already carries as a free string.
import type { Item } from '@ksrs/content';

export type HintLevel = 0 | 1 | 2;

export interface ClozeCue { base: string; pattern: string | null }

export function splitCue(cue: string): ClozeCue {
  const i = cue.indexOf(' + ');
  if (i < 0) return { base: cue.trim(), pattern: null };
  return { base: cue.slice(0, i).trim(), pattern: cue.slice(i + 3).trim() || null };
}

/** Highest hint level available for a cue (2 with a pattern, else 1). */
export const maxHintLevel = (cue: string): HintLevel => (splitCue(cue).pattern ? 2 : 1);

const HANGUL_RUN = /[\p{Script=Hangul}][\p{Script=Hangul}\s\-~()/·]*[\p{Script=Hangul})]/gu;
const LONE_HANGUL = /\p{Script=Hangul}/gu;
export const SHORT_MEANING_MAX = 80;

/**
 * The item's meaning, short and pattern-free: Korean text is replaced with "~" (it would give the
 * pattern away), the first clause is kept (up to ";" or a parenthetical), and long text is cut
 * at a word boundary with "…".
 */
export function shortMeaning(item: Item | undefined): string {
  if (!item) return '';
  let m = item.kind === 'grammar' || item.kind === 'expression' ? item.meaning
    : item.kind === 'vocab' ? (item.meanings ?? []).join('; ') : (item.meanings ?? []).join(', ');
  m = (m ?? '').replace(HANGUL_RUN, '~').replace(LONE_HANGUL, '~').replace(/[-(]*~[~\s)]*~?/g, '~ ').replace(/~ (?=[,.;:)]|$)/g, '~').replace(/\s+/g, ' ').trim();
  const semi = m.indexOf(';');
  if (semi > 0) m = m.slice(0, semi).trim();
  const paren = m.search(/\s\(/);
  if (paren > 20) m = m.slice(0, paren).trim();
  m = m.replace(/[,:;\s]+$/, '');
  if (m.length > SHORT_MEANING_MAX) {
    const cut = m.slice(0, SHORT_MEANING_MAX);
    const sp = cut.lastIndexOf(' ');
    m = `${(sp > 40 ? cut.slice(0, sp) : cut).replace(/[,:;\s]+$/, '')}…`;
  }
  return m;
}

// ---------------------------------------------------------------------------
// Vocab / expression ladder

/** True for vocab and expression clozes (the 초성 ladder); grammar keeps the D66 ladder. */
export function isLexicalCloze(itemId: string, item: Item | undefined): boolean {
  if (item) return item.kind === 'vocab' || item.kind === 'expression';
  return itemId.startsWith('v:') || itemId.startsWith('x:');
}

/** Highest hint level for a cloze: always 2 for vocab/expressions, else per the grammar cue. */
export const maxClozeHintLevel = (itemId: string, item: Item | undefined, cue: string): HintLevel =>
  (isLexicalCloze(itemId, item) ? 2 : maxHintLevel(cue));

const CHOSEONG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const SYL_FIRST = 0xac00, SYL_LAST = 0xd7a3;

/** Initial consonants of a word: 사정 → ㅅㅈ. Non-syllable characters are kept as they are. */
export function choseong(word: string): string {
  let out = '';
  for (const ch of word) {
    const c = ch.codePointAt(0)!;
    out += c >= SYL_FIRST && c <= SYL_LAST ? CHOSEONG[Math.floor((c - SYL_FIRST) / 588)] : ch;
  }
  return out;
}

const syllables = (word: string): number => [...word].filter((ch) => { const c = ch.codePointAt(0)!; return c >= SYL_FIRST && c <= SYL_LAST; }).length;

/** The headword (dictionary form) of a vocab or expression item. */
export function dictForm(item: Item | undefined): string {
  if (!item) return '';
  return item.kind === 'vocab' ? item.word : item.kind === 'expression' ? item.text : '';
}

/**
 * The headword words the blank stands for. A cloze on a proverb often blanks one word and shows
 * the rest ("핑계 없는 {{}} 없다더니"); a word counts as shown when a token outside the blank equals
 * it, or (for words of 2+ characters) starts with it, as in 없다 → 없다더니. If every word is shown,
 * the whole headword is used.
 */
export function blankedWords(headword: string, before = '', after = ''): string[] {
  const words = headword.trim().split(/\s+/).filter(Boolean);
  const tokens = `${before} ${after}`.split(/[\s.,!?'"“”‘’…:;()]+/).filter(Boolean);
  const shown = (w: string) => tokens.some((t) => t === w || ([...w].length >= 2 && t.startsWith(w)));
  const hidden = words.filter((w) => !shown(w));
  return hidden.length ? hidden : words;
}

/** Level-1 hint: 초성 per word plus syllable counts, e.g. "ㅅㅈ (2)" or "ㅊㄷㄹ ㅁㄷ (3+2)". */
export function initialsHint(headword: string, before = '', after = ''): string {
  const words = blankedWords(headword, before, after);
  if (!words.length) return '';
  return `${words.map(choseong).join(' ')} (${words.map(syllables).join('+')})`;
}

export interface Graded { outcome: 'correct' | 'close' | 'incorrect'; layer: string; matched?: string }

/** Applies the hint level to a checker result: layer gets "+hintN"; a correct answer at level 2 becomes a miss. */
export function withHint<T extends Graded>(r: T, level: HintLevel): T & { hintPenalty: boolean } {
  if (level === 0) return { ...r, hintPenalty: false };
  const layer = `${r.layer}+hint${level}`;
  if (level === 2 && r.outcome === 'correct') return { ...r, layer, outcome: 'incorrect', hintPenalty: true };
  return { ...r, layer, hintPenalty: false };
}

export const HINT_MISS_TEXT = 'Correct, but with the full hint — counted as a miss';
