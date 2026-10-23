// Minimal seeded property-testing helper (stand-in for fast-check; D19).
// Usage: forAll(gen, (value) => { assert... }, { runs: 200, seed: 'name' })
import { fnv1a, mulberry32 } from '../../srs-engine/src/util.ts';

export type Rng = () => number;
export type Gen<T> = (rng: Rng, size: number) => T;

export const int = (min: number, max: number): Gen<number> => (r) => min + Math.floor(r() * (max - min + 1));
export const pick = <T>(xs: readonly T[]): Gen<T> => (r) => xs[Math.floor(r() * xs.length)] as T;
export const bool = (pTrue = 0.5): Gen<boolean> => (r) => r() < pTrue;
export const arrayOf = <T>(g: Gen<T>, minLen = 0, maxLen?: number): Gen<T[]> => (r, size) => {
  const n = minLen + Math.floor(r() * ((maxLen ?? Math.max(minLen, size)) - minLen + 1));
  return Array.from({ length: n }, () => g(r, size));
};
export const tuple = <A extends unknown[]>(...gs: { [K in keyof A]: Gen<A[K]> }): Gen<A> =>
  (r, size) => gs.map((g) => (g as Gen<unknown>)(r, size)) as A;
export const map = <A, B>(g: Gen<A>, f: (a: A) => B): Gen<B> => (r, s) => f(g(r, s));

export function shuffle<T>(xs: readonly T[], r: Rng): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a;
}

export interface ForAllOpts { runs?: number; seed?: string; maxSize?: number }

/** Runs `prop` on `runs` generated values; on failure rethrows with the seed and case index for replay. */
export function forAll<T>(gen: Gen<T>, prop: (value: T, rng: Rng) => void, opts: ForAllOpts = {}): void {
  const runs = opts.runs ?? 100;
  const seed = opts.seed ?? 'ksrs';
  const maxSize = opts.maxSize ?? 30;
  for (let i = 0; i < runs; i++) {
    const rng = mulberry32(fnv1a(`${seed}#${i}`));
    const size = 1 + Math.floor((i / Math.max(1, runs - 1)) * (maxSize - 1));
    const value = gen(rng, size);
    try { prop(value, rng); }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`forAll failed (seed='${seed}', case=${i}, size=${size}): ${msg}\nvalue: ${safeJson(value)}`);
    }
  }
}
const safeJson = (v: unknown): string => { try { return JSON.stringify(v).slice(0, 2000); } catch { return String(v); } };
