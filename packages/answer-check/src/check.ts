// The layered answer checker (ARCHITECTURE.md §8.3–8.4). Pure and synchronous.
import type { FeatureRule, ParticleTolerance, QuestionInstance } from '@ksrs/content';
import { enTolerance, jamoDiff, jamoDistance, koTolerance, osaDistance, type EditOp } from './distance.ts';
import { isKnownEnglishWord } from './en-words.ts';
import { dubeolsikToHangul, looksLikeDubeolsik } from './dubeolsik.ts';
import { checkCoreWords, checkFeatures, similarity, VARIANT_SIM } from './features.ts';
import { toJamo } from './jamo.ts';
import { enAlternatives, hasHangul, hasLatin, looseKoKey, normalizeEn, normalizeKo } from './normalize.ts';
import { findWrongAllomorphs, particleMatch } from './particles.ts';

export type Outcome = 'correct' | 'close' | 'incorrect';
export type Layer =
  | 'empty'          // nothing typed (close: retry, no penalty)
  | 'script'         // layer 0: wrong keyboard / wrong language
  | 'rejected'       // layer 2: a listed wrong answer (결재 for 결제)
  | 'otherHeadword'  // layer 2: exactly another item's headword
  | 'nearMiss'       // layer 2b
  | 'exact'          // layer 3
  | 'spacing'        // layer 4
  | 'particle'       // layer 5
  | 'feature'        // layer 6.1
  | 'coreWord'       // layer 6.2
  | 'variant'        // layer 6.3
  | 'jamo'           // layer 7
  | 'typo'           // English typo tolerance
  | 'choice'         // nuance multiple choice
  | 'none';          // layer 8

export interface CheckResult {
  outcome: Outcome;
  layer: Layer;
  /** The accepted answer matched, or the best match revealed on incorrect. */
  matched?: string;
  distance?: number;
  hint?: string;
  /** Layer 0: the response converted from QWERTY, to pre-fill the input. */
  converted?: string;
  notes: string[];
}

export interface CheckOptions {
  /** Normalized KO headword → English gloss of other items (layer 2). */
  otherHeadwords?: Map<string, string>;
  /** Answers the owner accepted via "I was right". */
  userAccepted?: string[];
  /**
   * English meanings of other items (meaning questions). An exact match is
   * incorrect with a hint, and their words count as "real words" for the
   * typo guard, so typo tolerance never lands on another item's meaning.
   */
  otherMeanings?: string[];
}

const res = (outcome: Outcome, layer: Layer, extra: Partial<CheckResult> = {}): CheckResult =>
  ({ outcome, layer, notes: [], ...extra });

export function check(q: QuestionInstance, response: string, opts: CheckOptions = {}): CheckResult {
  if (response.replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, '') === '') {
    return res('close', 'empty', { hint: 'Type an answer.' });
  }
  switch (q.qtype) {
    case 'meaning': return checkMeaning(q.accepted, q.rejected, response, opts);
    case 'nuance': return checkNuance(q.options, q.correctKey, response);
    case 'production':
      return checkKo(response, {
        accepted: q.accepted, rejected: q.rejected, nearMiss: [], tol: 'allomorph', spacingStrict: false,
        stripFinalPunct: true, features: [], coreWords: [], allowHeadwords: true,
      }, opts);
    case 'cloze':
      return checkKo(stripClozeContext(response, q.before, q.after), {
        accepted: q.accepted, rejected: [], nearMiss: q.nearMiss, tol: q.particleTolerance,
        spacingStrict: q.spacingStrict, stripFinalPunct: true, features: [], coreWords: [], allowHeadwords: true,
      }, opts);
    case 'register':
      return checkKo(response, {
        accepted: q.accepted, rejected: [], nearMiss: [], tol: q.particleTolerance, spacingStrict: false,
        stripFinalPunct: q.finalPunctOptional, features: q.features, coreWords: q.coreWords, allowHeadwords: false,
      }, opts);
  }
}

// ---------------------------------------------------------------- meaning (EN)

function checkMeaning(accepted: string[], rejected: string[], response: string, opts: CheckOptions): CheckResult {
  if (hasHangul(response)) return res('close', 'script', { hint: 'Answer in English.' });
  const r = normalizeEn(response);
  if (r === '') return res('close', 'empty', { hint: 'Type an answer.' });
  // "to be cumbersome" also accepts plain "cumbersome" (descriptive verbs).
  const targets = (xs: readonly string[]): { raw: string; norm: string }[] =>
    xs.flatMap((raw) => enAlternatives(raw).flatMap((alt) => {
      const norm = normalizeEn(alt);
      return /^be \S/.test(norm) ? [{ raw, norm }, { raw, norm: norm.slice(3) }] : [{ raw, norm }];
    })).filter((t) => t.norm !== '');
  const acc = targets([...accepted, ...(opts.userAccepted ?? [])]);
  const rej = targets(rejected);

  const exact = acc.find((t) => t.norm === r);
  if (exact) return res('correct', 'exact', { matched: exact.raw, distance: 0 });
  const rejExact = rej.find((t) => t.norm === r);
  if (rejExact) return res('incorrect', 'rejected', { matched: accepted[0], hint: `"${response.trim()}" is not this word's meaning.` });

  // Another item's meaning, typed exactly (결재 "approval" for 결제 "payment").
  const others = (opts.otherMeanings ?? []).flatMap((m) => enAlternatives(m).map((alt) => ({ raw: m, norm: normalizeEn(alt) })));
  const other = others.find((t) => t.norm === r);
  if (other) {
    return res('incorrect', 'otherHeadword', { matched: accepted[0], hint: `"${other.raw}" is the meaning of a different word.` });
  }

  let best: { raw: string; norm: string; d: number; ok: boolean } | undefined;
  for (const t of acc) {
    const d = osaDistance(r, t.norm);
    const ok = d <= enTolerance([...t.norm].length);
    if (!best || (ok && !best.ok) || (ok === best.ok && d < best.d)) best = { raw: t.raw, norm: t.norm, d, ok };
  }
  if (best?.ok) {
    // Never let typo tolerance land on a meaning that is explicitly wrong.
    const rejD = Math.min(Infinity, ...rej.map((t) => osaDistance(r, t.norm)));
    // Nor on a different real word (shop for ship, desert for dessert).
    const extra = new Set(others.flatMap((t) => t.norm.split(' ')));
    const realWord = realWordSubstitution(r, best.norm, extra);
    if (realWord) {
      return res('incorrect', 'none', { matched: best.raw, distance: best.d, hint: `"${realWord}" is a different word.` });
    }
    if (rejD > best.d) {
      return res('correct', 'typo', { matched: best.raw, distance: best.d, notes: [`typo: expected "${best.raw}"`] });
    }
  }
  return res('incorrect', 'none', { matched: best?.raw ?? accepted[0], distance: best?.d });
}

/**
 * A word in the response that is not in the target but is itself a known
 * English word (and not just an inflection/derivation of a target word, as in
 * approve/approval or hesitates/hesitate). Returns that word, or null.
 */
export function realWordSubstitution(response: string, target: string, extra?: ReadonlySet<string>): string | null {
  const tw = target.split(' ');
  for (const w of response.split(' ')) {
    if (tw.includes(w)) continue;
    if (tw.some((t) => isDerivedForm(w, t))) continue;
    if (isKnownEnglishWord(w, extra)) return w;
  }
  return null;
}

/** approve/approval, hesitate/hesitates: same stem, different length, short tails. */
function isDerivedForm(a: string, b: string): boolean {
  if (a.length === b.length) return false; // stationary/stationery, principal/principle
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  return p >= 4 && Math.max(a.length, b.length) - p <= 3;
}

// ---------------------------------------------------------------- nuance

function checkNuance(options: { key: string; text: string }[], correctKey: string, response: string): CheckResult {
  const r = response.trim();
  const byKey = options.find((o) => o.key === r) ?? options.find((o) => o.key.toLowerCase() === r.toLowerCase());
  const norm = normalizeKo(r, { stripFinalPunct: true });
  const opt = byKey ?? options.find((o) => normalizeKo(o.text, { stripFinalPunct: true }) === norm)
    ?? options.find((o) => looseKoKey(normalizeKo(o.text)) === looseKoKey(norm));
  const correct = options.find((o) => o.key === correctKey);
  if (!opt) return res('close', 'choice', { hint: 'Pick one of the options.' });
  return opt.key === correctKey
    ? res('correct', 'choice', { matched: opt.text })
    : res('incorrect', 'choice', { matched: correct?.text });
}

// ---------------------------------------------------------------- Korean layers

interface KoSpec {
  accepted: string[]; rejected: string[]; nearMiss: { answer: string; hint: string }[];
  tol: ParticleTolerance; spacingStrict: boolean; stripFinalPunct: boolean;
  features: FeatureRule[]; coreWords: string[]; allowHeadwords: boolean;
}

/** If the whole sentence was typed into a cloze blank, keep only the blank. */
export function stripClozeContext(response: string, before: string, after: string): string {
  const r = normalizeKo(response, { stripFinalPunct: true });
  const b = normalizeKo(before);
  const a = normalizeKo(after, { stripFinalPunct: true });
  if ((b === '' && a === '') || !r.startsWith(b) || !r.endsWith(a) || r.length <= b.length + a.length) return response;
  return r.slice(b.length, r.length - a.length).trim();
}

function checkKo(response: string, s: KoSpec, opts: CheckOptions): CheckResult {
  // Latin inside Korean answers (SNS, CD) is compared case-insensitively.
  const norm = (x: string): string => normalizeKo(x, { stripFinalPunct: s.stripFinalPunct }).toLowerCase();
  const acc = [...s.accepted, ...(opts.userAccepted ?? [])].map((raw) => ({ raw, n: norm(raw) }));
  const accLatin = acc.some((a) => hasLatin(a.n));

  // Layer 0: script.
  if (hasLatin(response) && !accLatin) {
    if (looksLikeDubeolsik(response)) {
      const converted = normalizeKo(dubeolsikToHangul(normalizeKo(response)), { stripFinalPunct: s.stripFinalPunct });
      return res('close', 'script', { converted, hint: 'Switch to the Korean keyboard.' });
    }
    if (!hasHangul(response)) return res('close', 'script', { hint: 'Answer in Korean.' });
  }

  // Layer 1: normalize.
  const r = norm(response);
  if (r === '') return res('close', 'empty', { hint: 'Type an answer.' });
  const rKey = looseKoKey(r);
  const isAccepted = acc.some((a) => a.n === r || looseKoKey(a.n) === rKey);

  // Layer 2: rejected / other headword (an accepted answer always wins).
  if (!isAccepted) {
    const gloss = (w: string): string | undefined => opts.otherHeadwords?.get(w) ?? opts.otherHeadwords?.get(looseKoKey(w));
    const rej = s.rejected.find((x) => { const n = norm(x); return n === r || looseKoKey(n) === rKey; });
    if (rej !== undefined) {
      const g = gloss(r);
      return res('incorrect', 'rejected', { matched: acc[0]?.raw, hint: g ? `${r} = ${g}` : `${r} is a different word.` });
    }
    if (s.allowHeadwords) {
      const g = gloss(r);
      if (g !== undefined) return res('incorrect', 'otherHeadword', { matched: acc[0]?.raw, hint: `${r} = ${g}` });
    }
  }

  // Layer 2b: cloze near miss.
  const nm = s.nearMiss.find((x) => { const n = norm(x.answer); return n === r || looseKoKey(n) === rKey; });
  if (nm && !isAccepted) return res('close', 'nearMiss', { hint: nm.hint });

  // Layer 3: exact.
  const ex = acc.find((a) => a.n === r);
  if (ex) return res('correct', 'exact', { matched: ex.raw, distance: 0 });

  // Layer 4: spacing (and inner punctuation).
  const sp = acc.find((a) => looseKoKey(a.n) === rKey);
  if (sp) {
    return s.spacingStrict
      ? res('close', 'spacing', { matched: sp.raw, hint: `Check the spacing (띄어쓰기).` })
      : res('correct', 'spacing', { matched: sp.raw, notes: [`띄어쓰기: ${sp.n}`] });
  }

  // Layer 5: particles.
  let allomorphHit: { raw: string; fixes: { typed: string; fix: string }[] } | undefined;
  let ambiguousHit = false;
  for (const a of acc) {
    const m = particleMatch(r, a.n, s.tol);
    if (!m) continue;
    if (m.kind === 'equal') return res('correct', 'particle', { matched: a.raw, notes: m.notes });
    if (m.kind === 'ambiguous') { ambiguousHit = true; continue; }
    allomorphHit ??= { raw: a.raw, fixes: m.fixes };
  }
  if (allomorphHit) {
    return res('close', 'particle', { hint: allomorphHint(allomorphHit.fixes) });
  }
  if (ambiguousHit) {
    return res('close', 'particle', { hint: 'Incomplete word, or a dropped particle? Type the full form.' });
  }

  // Layer 6: target features + core words (register).
  if (s.features.length > 0 || s.coreWords.length > 0) {
    const l6 = layer6(r, acc, s);
    if (l6) return l6;
  }

  // Layer 7: jamo distance.
  let best: { raw: string; n: string; d: number; L: number } | undefined;
  for (const a of acc) {
    const d = Math.min(jamoDistance(r, a.n), jamoDistance(rKey, looseKoKey(a.n)));
    const L = toJamo(looseKoKey(a.n)).length;
    if (!best || d < best.d) best = { raw: a.raw, n: a.n, d, L };
  }
  if (best && best.d <= koTolerance(best.L)) {
    return res('close', 'jamo', { distance: best.d, hint: diffHint(jamoDiff(rKey, looseKoKey(best.n))) });
  }

  // Layer 8.
  return res('incorrect', 'none', { matched: best?.raw ?? acc[0]?.raw, distance: best?.d });
}

function layer6(r: string, acc: { raw: string; n: string }[], s: KoSpec): CheckResult | null {
  const f = checkFeatures(s.features, r);
  if (f.status === 'missing') return res('incorrect', 'feature', { matched: acc[0]?.raw, hint: f.failed?.label });
  const c = checkCoreWords(s.coreWords, r);
  if (c.status === 'missing') {
    return res('incorrect', 'coreWord', { matched: acc[0]?.raw, hint: `Content changed: "${c.word}" is missing.` });
  }
  if (f.status === 'near') return res('close', 'feature', { hint: f.failed?.label });
  if (c.status === 'fuzzy') return res('close', 'coreWord', { hint: `Check the spelling of "${c.word}".` });
  const wrong = findWrongAllomorphs(r, acc.map((a) => a.n));
  if (wrong.length) return res('close', 'particle', { hint: allomorphHint(wrong) });
  // A misspelled eojeol (시간애 for 시간에, 됬어요 for 됐어요) is a Korean typo (D9:
  // close), not a lenient variant.
  const typo = eojeolTypo(r, acc.map((a) => a.n));
  if (typo) return res('close', 'jamo', { distance: typo.d, hint: diffHint(typo.ops) });
  // Honorific -(으)시- dropped from the predicate (오십니다 → 옵니다) is a grammar
  // change, never a lenient variant.
  if (acc.length > 0 && acc.every((a) => hasHonorificSi(lastEojeolOf(a.n))) && !hasHonorificSi(lastEojeolOf(r))) {
    return res('close', 'feature', { hint: 'Check the honorific -(으)시-.' });
  }
  let best: { raw: string; sim: number } | undefined;
  for (const a of acc) {
    const sim = similarity(r, a.n);
    if (!best || sim > best.sim) best = { raw: a.raw, sim };
  }
  if (best && best.sim >= VARIANT_SIM) {
    return res('correct', 'variant', { matched: best.raw, notes: [`variant: not in accepted list (similarity ${best.sim.toFixed(2)})`] });
  }
  return null;
}

const lastEojeolOf = (s: string): string => s.split(' ').pop() ?? s;

/** Does the eojeol contain a 시/셔/세/십/신/실/심-type syllable (honorific -시- candidates)? */
export function hasHonorificSi(eojeol: string): boolean {
  for (const ch of eojeol) {
    const j = toJamo(ch);
    if (j[0] === 'ㅅ' && (j[1] === 'ㅣ' || j[1] === 'ㅕ' || j[1] === 'ㅔ')) return true;
  }
  return false;
}

/**
 * A response eojeol that is not in any accepted answer but is one jamo
 * substitution (or one confusable pair) away from an accepted eojeol.
 */
function eojeolTypo(r: string, accepted: readonly string[]): { d: number; ops: EditOp[] } | null {
  const accE = new Set(accepted.flatMap((a) => a.split(' ')));
  for (const w of r.split(' ')) {
    if (accE.has(w)) continue;
    for (const a of accE) {
      const d = jamoDistance(w, a);
      if (d === 0 || d > 1) continue;
      const ops = jamoDiff(w, a);
      if (ops.every((o) => o.op === 'sub')) return { d, ops };
    }
  }
  return null;
}

function allomorphHint(fixes: { typed: string; fix: string }[]): string {
  return fixes.map((f) => `${f.typed} → ${f.fix}`).join(', ') + ' (조사 형태 확인)';
}

/** Short, human hint from a jamo edit script: "check ㅔ/ㅐ", "missing ㅇ", "extra ㅅ". */
export function diffHint(ops: readonly EditOp[]): string {
  if (ops.length === 0) return 'Check the spacing.';
  const parts = ops.slice(0, 2).map((o) =>
    o.op === 'sub' ? `check ${o.to}/${o.from}` : o.op === 'ins' ? `missing ${o.ch}` : `extra ${o.ch}`);
  return parts.join('; ') + (ops.length > 2 ? '; …' : '');
}
