// Particle (조사) tolerance for layer 5 (ARCHITECTURE.md §8.3).
//
// Conservative by design: an eojeol is only split into stem + particle when it
// is compared against an accepted eojeol with the same stem, and the accepted
// eojeol's ending is only treated as a particle when it is the phonologically
// correct allomorph for that stem. So 사과 (apple) or 나이 (age) in an accepted
// answer are never read as 사+과 / 나+이.
import type { ParticleTolerance } from '@ksrs/content';
import { finalOf, isSyllable } from './jamo.ts';

export type ParticleClass = 'topic' | 'subject' | 'object' | 'with' | 'direction';

interface ParticleDef { form: string; cls: ParticleClass }
/** Longest first so 으로 wins over 로. */
const PARTICLES: readonly ParticleDef[] = [
  { form: '으로', cls: 'direction' }, { form: '로', cls: 'direction' },
  { form: '은', cls: 'topic' }, { form: '는', cls: 'topic' },
  { form: '이', cls: 'subject' }, { form: '가', cls: 'subject' },
  { form: '을', cls: 'object' }, { form: '를', cls: 'object' },
  { form: '과', cls: 'with' }, { form: '와', cls: 'with' },
];

const TRAILING_PUNCT = /[.,!?~;:"'…]+$/u;

export interface ParticleSplit { stem: string; particle: string; cls: ParticleClass }

/** Every way an eojeol can be read as stem + particle (stem must end in a syllable). */
export function particleSplits(eojeol: string): ParticleSplit[] {
  const w = eojeol.replace(TRAILING_PUNCT, '');
  const out: ParticleSplit[] = [];
  for (const p of PARTICLES) {
    if (w.length > p.form.length && w.endsWith(p.form)) {
      const stem = w.slice(0, w.length - p.form.length);
      if (isSyllable(stem.slice(-1))) out.push({ stem, particle: p.form, cls: p.cls });
    }
  }
  return out;
}

/** The phonologically correct allomorph of `cls` after `stem`. */
export function correctAllomorph(stem: string, cls: ParticleClass): string {
  const f = finalOf(stem.slice(-1));
  const vowelFinal = f === '';
  switch (cls) {
    case 'topic': return vowelFinal ? '는' : '은';
    case 'subject': return vowelFinal ? '가' : '이';
    case 'object': return vowelFinal ? '를' : '을';
    case 'with': return vowelFinal ? '와' : '과';
    case 'direction': return vowelFinal || f === 'ㄹ' ? '로' : '으로';
  }
}

/** A split of an accepted eojeol counts only if it uses the correct allomorph. */
function acceptedSplit(eojeol: string): ParticleSplit | null {
  for (const s of particleSplits(eojeol)) if (correctAllomorph(s.stem, s.cls) === s.particle) return s;
  return null;
}

export type EojeolRelation =
  | { kind: 'same' }
  | { kind: 'wrongAllomorph'; fix: string }         // 책를 vs 책을
  | { kind: 'topicSubject'; from: string; to: string } // 책이 vs 책은 (loose only)
  | { kind: 'dropped'; particle: string }            // 계획 vs 계획은 (loose only)
  | { kind: 'different' };

/** How a response eojeol relates to an accepted eojeol under particle rules. */
export function compareEojeol(resp: string, acc: string, tol: ParticleTolerance): EojeolRelation {
  const r = resp.replace(TRAILING_PUNCT, '');
  const a = acc.replace(TRAILING_PUNCT, '');
  if (r === a) return { kind: 'same' };
  const as = acceptedSplit(a);
  if (!as) return { kind: 'different' };
  if (tol === 'loose' && r === as.stem) return { kind: 'dropped', particle: as.particle };
  for (const rs of particleSplits(r)) {
    if (rs.stem !== as.stem) continue;
    const right = correctAllomorph(rs.stem, rs.cls);
    if (rs.particle !== right) {
      // Wrong allomorph of the same (or, in loose mode, swappable) class.
      if (rs.cls === as.cls) return { kind: 'wrongAllomorph', fix: as.stem + as.particle };
      if (tol === 'loose' && isTopicSubject(rs.cls, as.cls)) return { kind: 'wrongAllomorph', fix: rs.stem + right };
      continue;
    }
    if (tol === 'loose' && isTopicSubject(rs.cls, as.cls)) return { kind: 'topicSubject', from: rs.particle, to: as.particle };
  }
  return { kind: 'different' };
}

const isTopicSubject = (x: ParticleClass, y: ParticleClass): boolean =>
  x !== y && (x === 'topic' || x === 'subject') && (y === 'topic' || y === 'subject');

export interface ParticleMatch {
  /** 'equal': same under the tolerance; 'wrongAllomorph': same apart from 책를-type errors. */
  kind: 'equal' | 'wrongAllomorph';
  notes: string[];
  fixes: { typed: string; fix: string }[];
}

/**
 * Compare two normalized sentences eojeol by eojeol. Returns null when they
 * differ in anything other than particles allowed by `tol` (wrong allomorphs
 * are always detected, even with tolerance 'none').
 */
export function particleMatch(response: string, accepted: string, tol: ParticleTolerance): ParticleMatch | null {
  const rw = response.split(' ');
  const aw = accepted.split(' ');
  if (rw.length !== aw.length) return null;
  const notes: string[] = [];
  const fixes: { typed: string; fix: string }[] = [];
  let changed = false;
  for (let i = 0; i < rw.length; i++) {
    const r = rw[i] as string;
    const a = aw[i] as string;
    const rel = compareEojeol(r, a, tol);
    switch (rel.kind) {
      case 'same': break;
      case 'different': return null;
      case 'wrongAllomorph': fixes.push({ typed: r, fix: rel.fix }); changed = true; break;
      case 'dropped': notes.push(`조사 생략: ${a} → ${r}`); changed = true; break;
      case 'topicSubject': notes.push(`조사: ${rel.from} ↔ ${rel.to} (${a})`); changed = true; break;
    }
  }
  if (!changed) return null;
  return { kind: fixes.length ? 'wrongAllomorph' : 'equal', notes, fixes };
}

/**
 * Find 책를-type errors in a response, comparing each response eojeol with any
 * accepted eojeol sharing its stem (alignment-free; used before granting a
 * layer-6 variant).
 */
export function findWrongAllomorphs(response: string, accepted: readonly string[]): { typed: string; fix: string }[] {
  const accEojeols = accepted.flatMap((a) => a.split(' '));
  const out: { typed: string; fix: string }[] = [];
  for (const r of response.split(' ')) {
    if (accEojeols.includes(r)) continue;
    for (const a of accEojeols) {
      const rel = compareEojeol(r, a, 'allomorph');
      if (rel.kind === 'wrongAllomorph') { out.push({ typed: r, fix: rel.fix }); break; }
    }
  }
  return out;
}
