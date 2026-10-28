// Cloze hint ladder (pure; unit-tested in test/hints.test.ts).
//   level 0: the sentence, its translation and the dictionary form only
//   level 1: the item's short meaning (never the pattern text)
//   level 2: the full pattern
// Cues are written "<dictionary form> + <pattern>". Without " + " the whole cue is the base
// (L04 sense cues like "걸치다 · throw on (clothing)") and there is no level 2.
// A correct answer given at level 2 counts as a miss; the level goes into check.layer
// ("exact+hint2"), which the frozen event format already carries as a free string.
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

export interface Graded { outcome: 'correct' | 'close' | 'incorrect'; layer: string; matched?: string }

/** Applies the hint level to a checker result: layer gets "+hintN"; a correct answer at level 2 becomes a miss. */
export function withHint<T extends Graded>(r: T, level: HintLevel): T & { hintPenalty: boolean } {
  if (level === 0) return { ...r, hintPenalty: false };
  const layer = `${r.layer}+hint${level}`;
  if (level === 2 && r.outcome === 'correct') return { ...r, layer, outcome: 'incorrect', hintPenalty: true };
  return { ...r, layer, hintPenalty: false };
}

export const HINT_MISS_TEXT = 'Correct, but with the full hint — counted as a miss';
