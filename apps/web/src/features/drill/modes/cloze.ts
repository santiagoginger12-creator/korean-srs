// Fill-in-the-blank helpers for the drill (D86). Pure, so they're unit-tested on their own.
import { dubeolsikToHangul, jamoDistance, koTolerance, looksLikeDubeolsik } from '@ksrs/answer-check';

export interface Blank {
  before: string;
  answer: string; // the word as it appears in the sentence (conjugated, maybe with a particle)
  after: string;
}

const SBASE = 0xac00;
const isSyl = (c: string) => c.length === 1 && c.charCodeAt(0) >= SBASE && c.charCodeAt(0) <= 0xd7a3;
const parts = (c: string) => { const n = c.charCodeAt(0) - SBASE; return [Math.floor(n / 588), Math.floor((n % 588) / 28), n % 28] as const; };
const syl = (l: number, v: number, t = 0) => String.fromCharCode(SBASE + l * 588 + v * 28 + t);
// ㅗ→ㅘ ㅜ→ㅝ ㅣ→ㅕ ㅡ→ㅓ ㅚ→ㅙ: the 아/어 contraction of a vowel-final stem.
const CONTRACT: Record<number, number> = { 8: 9, 13: 14, 20: 6, 18: 4, 11: 10 };

/** Candidate spellings of a headword inside a sentence, longest first. */
export function stemCandidates(headword: string): string[] {
  const out = new Set<string>([headword]);
  if (headword.endsWith('다') && headword.length >= 2) {
    const st = headword.slice(0, -1);
    out.add(st);
    const head = st.slice(0, -1);
    const last = st.slice(-1);
    if (st.endsWith('하') && st.length >= 2) out.add(head); // 공부하 → 공부(해요/했어요)
    if (isSyl(last)) {
      const [l, v, t] = parts(last);
      if (t !== 0) {
        out.add(head + syl(l, v));            // ㅂ/ㅅ/ㄹ-irregular: 춥→추(워), 낫→나(아), 살→사(세요)
        out.add(head + syl(l, v, 8));         // ㄷ-irregular: 듣→들(어)
        if (t === 27) out.add(head + syl(l, 1)); // ㅎ-irregular: 그렇→그래, 어떻→어때
      } else {
        if (last === '하') out.add(head + '해');   // 하다 → 해(요)
        if (v === 18) out.add(head + syl(l, 0));   // ㅡ-drop after ㅏ/ㅗ: 나쁘→나빠, 바쁘→바빠
        if (v === 20) out.add(head + syl(l, 5));   // honorific 시→세(요): 계시→계세
        if (CONTRACT[v] !== undefined) {
          out.add(head + syl(l, CONTRACT[v]!));      // 오→와, 배우→배워, 마시→마셔, 쓰→써
          out.add(head + syl(l, CONTRACT[v]!, 20));  // ...+ past ㅆ
        }
        out.add(head + syl(l, v, 4)); out.add(head + syl(l, v, 8)); out.add(head + syl(l, v, 17)); out.add(head + syl(l, v, 20)); // ㄴ ㄹ ㅂ ㅆ
        if (last === '르' && head && isSyl(head.slice(-1))) {
          const [hl, hv, ht] = parts(head.slice(-1));
          if (ht === 0) out.add(head.slice(0, -1) + syl(hl, hv, 8)); // 모르 → 몰(라)
        }
      }
    }
  }
  return [...out].filter((s) => s.length > 0).sort((a, b) => b.length - a.length);
}

/**
 * Finds the word (eojeol) in the sentence that carries the headword and blanks it. Returns null
 * when no token clearly contains it; the card then falls back to its normal front.
 */
export function findBlank(ko: string, headword: string): Blank | null {
  const tokens = [...ko.matchAll(/[^\s]+/g)];
  const cands = stemCandidates(headword);
  const strip = (tok: string) => tok.replace(/^[“"'‘(]+|[.,!?…"”'’)~]+$/g, '');
  for (const c of cands) {
    // Prefer a token that starts with the candidate; one-syllable candidates must start the token.
    let hit = tokens.find((m) => strip(m[0]).startsWith(c));
    if (!hit && c.length >= 2) hit = tokens.find((m) => strip(m[0]).includes(c));
    if (!hit) continue;
    const raw = hit[0];
    const word = strip(raw);
    const lead = raw.indexOf(word);
    const start = hit.index! + lead;
    return { before: ko.slice(0, start), answer: word, after: ko.slice(start + word.length) };
  }
  return null;
}

export type BlankVerdict = 'correct' | 'close' | 'headword' | 'wrong' | 'blank';

const PARTICLES = ['은', '는', '이', '가', '을', '를', '도', '만', '에', '에서', '에게', '한테', '로', '으로', '와', '과', '랑', '이랑', '의', '까지', '부터', '보다', '처럼', '이에요', '예요', '이야', '야'];

/** Grades a typed answer against the blanked word. Lenient: typos, Latin-typed 두벌식, a dropped particle. */
export function gradeBlank(response: string, blank: Blank, headword: string): BlankVerdict {
  let r = response.trim().replace(/[.,!?]+$/, '');
  if (!r) return 'blank';
  if (looksLikeDubeolsik(r)) r = dubeolsikToHangul(r);
  const target = blank.answer;
  if (r === target) return 'correct';
  const bare = PARTICLES.filter((p) => target.endsWith(p) && target.length > p.length).map((p) => target.slice(0, -p.length));
  if (bare.includes(r)) return 'correct';
  if (r === headword) return 'headword';
  // One-syllable words get no typo allowance: a single changed jamo is usually another word (내/너).
  const tol = (w: string) => (w.length <= 1 ? 0 : koTolerance(w.length));
  if (jamoDistance(r, target) <= tol(target) || bare.some((b) => b.length > 1 && jamoDistance(r, b) <= tol(b))) return 'close';
  return 'wrong';
}
