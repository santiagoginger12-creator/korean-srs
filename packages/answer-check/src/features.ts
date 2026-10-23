// Layer 6: target features + core words + lenient variant acceptance (ARCHITECTURE.md §8.4).
import type { FeatureRule } from '@ksrs/content';
import { weightedDistance } from './distance.ts';
import { toJamo } from './jamo.ts';

/** Features shorter than this (in jamo) never get a "near miss" close: 요 is 1 edit from anything. */
const MIN_NEAR_FEATURE_LEN = 3;
export const CORE_FUZZY_SIM = 0.75;
export const VARIANT_SIM = 0.7;

export type FeatureStatus = 'ok' | 'near' | 'missing';
export interface FeatureResult { status: FeatureStatus; failed?: FeatureRule }

const lastEojeol = (s: string): string => s.split(' ').pop() ?? s;

/** Minimum weighted distance between `pat` and any window of `text` (lengths |pat|±1). */
export function bestWindowDistance(text: readonly string[], pat: readonly string[]): number {
  if (pat.length === 0) return 0;
  let best = Infinity;
  for (let len = Math.max(1, pat.length - 1); len <= pat.length + 1; len++) {
    for (let i = 0; i + len <= text.length; i++) {
      const d = weightedDistance(text.slice(i, i + len), pat);
      if (d < best) best = d;
    }
  }
  if (text.length < pat.length - 1) best = Math.min(best, weightedDistance(text, pat));
  return best;
}

/** Distance from the end of `text` to `pat` (suffix windows of length |pat|±1). */
function suffixDistance(text: readonly string[], pat: readonly string[]): number {
  let best = Infinity;
  for (let len = Math.max(0, pat.length - 1); len <= pat.length + 1; len++) {
    if (len > text.length) break;
    best = Math.min(best, weightedDistance(text.slice(text.length - len), pat));
  }
  return best;
}

const jamoNoSpace = (s: string): string[] => toJamo(s).filter((j) => j !== ' ');
const endsWithSeq = (t: readonly string[], p: readonly string[]): boolean =>
  p.length <= t.length && p.every((x, k) => t[t.length - p.length + k] === x);
const containsSeq = (t: readonly string[], p: readonly string[]): boolean => {
  outer: for (let i = 0; i + p.length <= t.length; i++) {
    for (let k = 0; k < p.length; k++) if (t[i + k] !== p[k]) continue outer;
    return true;
  }
  return p.length === 0;
};

/** Evaluate one rule in jamo space. `response` is normalized, final punctuation stripped. */
export function evalFeature(rule: FeatureRule, response: string): FeatureStatus {
  if (rule.kind === 'endsWith') {
    const t = jamoNoSpace(response);
    let near = false;
    for (const opt of rule.any) {
      const p = jamoNoSpace(opt);
      if (endsWithSeq(t, p)) return 'ok';
      if (p.length >= MIN_NEAR_FEATURE_LEN && suffixDistance(t, p) <= 1) near = true;
    }
    return near ? 'near' : 'missing';
  }
  const scoped = rule.scope === 'lastEojeol' ? lastEojeol(response) : response;
  const t = jamoNoSpace(scoped);
  if (rule.kind === 'notContains') {
    return rule.any.some((opt) => containsSeq(t, jamoNoSpace(opt))) ? 'missing' : 'ok';
  }
  let near = false;
  for (const opt of rule.any) {
    const p = jamoNoSpace(opt);
    if (containsSeq(t, p)) return 'ok';
    if (p.length >= MIN_NEAR_FEATURE_LEN && bestWindowDistance(t, p) <= 1) near = true;
  }
  return near ? 'near' : 'missing';
}

/** All features must hold; the first missing one wins over any near miss. */
export function checkFeatures(rules: readonly FeatureRule[], response: string): FeatureResult {
  let near: FeatureRule | undefined;
  for (const r of rules) {
    const st = evalFeature(r, response);
    if (st === 'missing') return { status: 'missing', failed: r };
    if (st === 'near' && !near) near = r;
  }
  return near ? { status: 'near', failed: near } : { status: 'ok' };
}

export type CoreStatus = 'ok' | 'fuzzy' | 'missing';
export interface CoreResult { status: CoreStatus; word?: string }

/** Every core stem must appear (jamo-space substring); a close window downgrades to fuzzy. */
export function checkCoreWords(coreWords: readonly string[], response: string): CoreResult {
  const t = jamoNoSpace(response);
  let fuzzy: string | undefined;
  for (const w of coreWords) {
    const p = jamoNoSpace(w);
    if (containsSeq(t, p)) continue;
    const d = bestWindowDistance(t, p);
    const sim = 1 - d / Math.max(p.length, 1);
    if (sim >= CORE_FUZZY_SIM) { fuzzy ??= w; continue; }
    return { status: 'missing', word: w };
  }
  return fuzzy ? { status: 'fuzzy', word: fuzzy } : { status: 'ok' };
}

/** Jamo-space similarity 1 − d/maxLen, ignoring spaces. */
export function similarity(a: string, b: string): number {
  const x = jamoNoSpace(a);
  const y = jamoNoSpace(b);
  const m = Math.max(x.length, y.length);
  return m === 0 ? 1 : 1 - weightedDistance(x, y) / m;
}
