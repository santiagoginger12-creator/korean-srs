// Weighted edit distance in jamo space, plain Levenshtein for English,
// and length-relative tolerances (ARCHITECTURE.md §8.2).
import { toJamo } from './jamo.ts';

/** Unordered confusable pairs; substituting one for the other costs 0.5. */
const CONFUSABLE: ReadonlyArray<readonly [string, string]> = [
  ['ㅔ', 'ㅐ'], ['ㅖ', 'ㅒ'], ['ㅓ', 'ㅗ'],
  ['ㄱ', 'ㄲ'], ['ㄷ', 'ㄸ'], ['ㅂ', 'ㅃ'], ['ㅅ', 'ㅆ'], ['ㅈ', 'ㅉ'],
];
const CONF_KEY = new Set(CONFUSABLE.flatMap(([a, b]) => [a + b, b + a]));

export const isConfusable = (a: string, b: string): boolean => CONF_KEY.has(a + b);

export function substitutionCost(a: string, b: string): number {
  if (a === b) return 0;
  return CONF_KEY.has(a + b) ? 0.5 : 1;
}

export type EditOp =
  | { op: 'sub'; from: string; to: string; cost: number }
  | { op: 'ins'; ch: string }
  | { op: 'del'; ch: string };

function table(a: readonly string[], b: readonly string[], sub: (x: string, y: string) => number): number[][] {
  const d: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    const row: number[] = new Array(b.length + 1);
    row[0] = i;
    d.push(row);
  }
  const r0 = d[0] as number[];
  for (let j = 0; j <= b.length; j++) r0[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const prev = d[i - 1] as number[];
    const cur = d[i] as number[];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        (prev[j] as number) + 1,
        (cur[j - 1] as number) + 1,
        (prev[j - 1] as number) + sub(a[i - 1] as string, b[j - 1] as string),
      );
    }
  }
  return d;
}

/** Weighted Levenshtein over arbitrary token sequences. */
export function weightedDistance(a: readonly string[], b: readonly string[]): number {
  const d = table(a, b, substitutionCost);
  return (d[a.length] as number[])[b.length] as number;
}

/** Weighted Levenshtein in fully decomposed jamo space (spaces count as tokens). */
export function jamoDistance(a: string, b: string): number {
  return weightedDistance(toJamo(a), toJamo(b));
}

/** Edit script turning `from` into `to` (jamo space), minimal-cost, for hints. */
export function jamoDiff(from: string, to: string): EditOp[] {
  const a = toJamo(from);
  const b = toJamo(to);
  const d = table(a, b, substitutionCost);
  const ops: EditOp[] = [];
  let i = a.length;
  let j = b.length;
  const D = (x: number, y: number): number => (d[x] as number[])[y] as number;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const c = substitutionCost(a[i - 1] as string, b[j - 1] as string);
      if (D(i, j) === D(i - 1, j - 1) + c) {
        if (c > 0) ops.push({ op: 'sub', from: a[i - 1] as string, to: b[j - 1] as string, cost: c });
        i--; j--; continue;
      }
    }
    if (i > 0 && D(i, j) === D(i - 1, j) + 1) { ops.push({ op: 'del', ch: a[i - 1] as string }); i--; continue; }
    ops.push({ op: 'ins', ch: b[j - 1] as string }); j--;
  }
  return ops.reverse();
}

/** Plain (unit-cost) Levenshtein over code points. */
export function levenshtein(a: string, b: string): number {
  const d = table([...a], [...b], (x, y) => (x === y ? 0 : 1));
  return (d[[...a].length] as number[])[[...b].length] as number;
}

/** Korean close tolerance by target jamo length L (§8.2). */
export function koTolerance(L: number): number {
  if (L <= 6) return 1;
  if (L <= 12) return 1.5;
  if (L <= 20) return 2;
  return Math.min(4, 0.1 * L);
}

/** English typo tolerance by normalized target length n (§8.2). */
export function enTolerance(n: number): number {
  if (n <= 3) return 0;
  if (n <= 5) return 1;
  if (n <= 7) return 2;
  return Math.min(4, Math.floor(0.25 * n));
}
