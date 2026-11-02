// Example-sentence rotation for review feedback. Pure; the app supplies the item's original
// examples (from content) and its dictionary examples (examples.json, 한국어기초사전).

import { seededShuffle } from './util.ts';

/** A 한국어기초사전 example as shipped in examples.json (format 1). */
export type DictExample =
  | { kind: 'sentence'; ko: string; match?: string }
  | { kind: 'dialogue'; lines: string[]; match?: string; matchLine?: number };

export type PickedExample<O, D> =
  | { source: 'original'; example: O; index: number }
  | { source: 'dict'; example: D; index: number };

/**
 * One example per review (same idea as D68 prompt rotation). The pool is the item's original
 * examples followed by its dictionary ones; it is put in a fixed per-item shuffled order and
 * review n shows entry n mod pool size. Every entry appears once before any repeat, and two
 * consecutive reviews never show the same entry (when the pool has 2+ entries).
 * `index` is the entry's position in its own list (originals or dictExamples).
 */
export function pickExample<O, D>(
  itemId: string, originals: readonly O[], dictExamples: readonly D[], reviewCount: number,
): PickedExample<O, D> | undefined {
  const pool: PickedExample<O, D>[] = [
    ...originals.map((example, index) => ({ source: 'original' as const, example, index })),
    ...dictExamples.map((example, index) => ({ source: 'dict' as const, example, index })),
  ];
  if (pool.length === 0) return undefined;
  const order = seededShuffle(pool, `${itemId}|examples`);
  const n = Number.isFinite(reviewCount) ? Math.trunc(reviewCount) : 0;
  return order[((n % order.length) + order.length) % order.length];
}
