// Hangul jamo decomposition and (re)composition (ARCHITECTURE.md §8.2).
// All jamo are represented as Hangul Compatibility Jamo (U+3131–U+3163) so that
// decomposed text is human-readable and initial/final consonants compare equal.

const SBASE = 0xac00;
const SCOUNT = 11172;
const NCOUNT = 588; // 21 * 28
const TCOUNT = 28;

export const CHOSEONG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
export const JUNGSEONG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
// index 0 = no final
export const JONGSEONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ',
  'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'] as const;

const COMPOUND_VOWELS: Record<string, string> = {
  'ㅘ': 'ㅗㅏ', 'ㅙ': 'ㅗㅐ', 'ㅚ': 'ㅗㅣ', 'ㅝ': 'ㅜㅓ', 'ㅞ': 'ㅜㅔ', 'ㅟ': 'ㅜㅣ', 'ㅢ': 'ㅡㅣ',
};
const COMPOUND_FINALS: Record<string, string> = {
  'ㄳ': 'ㄱㅅ', 'ㄵ': 'ㄴㅈ', 'ㄶ': 'ㄴㅎ', 'ㄺ': 'ㄹㄱ', 'ㄻ': 'ㄹㅁ', 'ㄼ': 'ㄹㅂ',
  'ㄽ': 'ㄹㅅ', 'ㄾ': 'ㄹㅌ', 'ㄿ': 'ㄹㅍ', 'ㅀ': 'ㄹㅎ', 'ㅄ': 'ㅂㅅ',
};
const invert = (m: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [v, k]));
const VOWEL_COMBINE = invert(COMPOUND_VOWELS);
const FINAL_COMBINE = invert(COMPOUND_FINALS);

export const isSyllable = (ch: string): boolean => {
  const c = ch.codePointAt(0) ?? 0;
  return c >= SBASE && c < SBASE + SCOUNT;
};
/** Compatibility jamo block U+3131–U+3163 (modern letters). */
export const isCompatJamo = (ch: string): boolean => {
  const c = ch.codePointAt(0) ?? 0;
  return c >= 0x3131 && c <= 0x3163;
};
export const isVowel = (ch: string): boolean => {
  const c = ch.codePointAt(0) ?? 0;
  return c >= 0x314f && c <= 0x3163;
};
export const isConsonant = (ch: string): boolean => {
  const c = ch.codePointAt(0) ?? 0;
  return c >= 0x3131 && c <= 0x314e;
};
export const isHangul = (ch: string): boolean => isSyllable(ch) || isCompatJamo(ch);

export interface Syllable { cho: string; jung: string; jong: string }

/** Split one precomposed syllable into its three positional jamo (compounds intact). */
export function decomposeSyllable(ch: string): Syllable | null {
  if (!isSyllable(ch)) return null;
  const s = (ch.codePointAt(0) as number) - SBASE;
  return {
    cho: CHOSEONG[Math.floor(s / NCOUNT)] as string,
    jung: JUNGSEONG[Math.floor((s % NCOUNT) / TCOUNT)] as string,
    jong: JONGSEONG[s % TCOUNT] as string,
  };
}

/** Inverse of decomposeSyllable. Returns null for invalid combinations. */
export function composeSyllable(cho: string, jung: string, jong = ''): string | null {
  const l = CHOSEONG.indexOf(cho);
  const v = JUNGSEONG.indexOf(jung);
  const t = (JONGSEONG as readonly string[]).indexOf(jong);
  if (l < 0 || v < 0 || t < 0 || cho.length !== 1 || jung.length !== 1) return null;
  return String.fromCodePoint(SBASE + l * NCOUNT + v * TCOUNT + t);
}

const splitJamo = (j: string): string[] => [...(COMPOUND_VOWELS[j] ?? COMPOUND_FINALS[j] ?? j)];

/**
 * Fully decompose: syllables → initial, medial, final; compound vowels and
 * compound finals → their parts. Tense initials (ㄲ ㄸ ㅃ ㅆ ㅉ) stay single.
 * Standalone compatibility jamo are decomposed the same way. Other characters
 * (spaces, punctuation, Latin, Hanja) pass through as single elements.
 */
export function toJamo(s: string): string[] {
  const out: string[] = [];
  // NFC first so NFD input (conjoining jamo) decomposes the same as precomposed text.
  for (const ch of s.normalize('NFC')) {
    const syl = decomposeSyllable(ch);
    if (syl) {
      out.push(syl.cho, ...splitJamo(syl.jung));
      if (syl.jong) out.push(...splitJamo(syl.jong));
    } else if (isCompatJamo(ch)) {
      out.push(...splitJamo(ch));
    } else {
      out.push(ch);
    }
  }
  return out;
}

const canBeFinal = (c: string): boolean => (JONGSEONG as readonly string[]).includes(c) && c !== '';

/**
 * Assemble a jamo sequence into syllables the way a dubeolsik IME would
 * (greedy, with lookahead so a consonant before a vowel starts a new syllable).
 * Accepts strings or arrays; compound jamo in the input are split first.
 */
export function fromJamo(input: string | readonly string[]): string {
  const a = typeof input === 'string' ? toJamo(input) : input.flatMap((x) => toJamo(x));
  const n = a.length;
  const at = (k: number): string => (k < n ? (a[k] as string) : '');
  let out = '';
  let i = 0;
  while (i < n) {
    const c = at(i);
    if (isConsonant(c) && CHOSEONG.includes(c) && isVowel(at(i + 1))) {
      let v = at(i + 1);
      i += 2;
      const cv = VOWEL_COMBINE[v + at(i)];
      if (cv) { v = cv; i++; }
      let jong = '';
      if (isConsonant(at(i)) && canBeFinal(at(i)) && !isVowel(at(i + 1))) {
        jong = at(i);
        i++;
        const cf = FINAL_COMBINE[jong + at(i)];
        if (cf && isConsonant(at(i)) && !isVowel(at(i + 1))) { jong = cf; i++; }
      }
      out += composeSyllable(c, v, jong) as string;
    } else if (isVowel(c)) {
      const cv = VOWEL_COMBINE[c + at(i + 1)];
      out += cv ?? c;
      i += cv ? 2 : 1;
    } else if (isConsonant(c) && FINAL_COMBINE[c + at(i + 1)] && !isVowel(at(i + 2))) {
      // A lone consonant cluster (ㄱ+ㅅ → ㄳ), as an IME composes it.
      out += FINAL_COMBINE[c + at(i + 1)] as string;
      i += 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** True when the syllable has a final consonant (받침). */
export function hasFinal(ch: string): boolean {
  const s = decomposeSyllable(ch);
  return !!s && s.jong !== '';
}
/** The final consonant of a syllable ('' if none or not a syllable). */
export function finalOf(ch: string): string {
  return decomposeSyllable(ch)?.jong ?? '';
}
