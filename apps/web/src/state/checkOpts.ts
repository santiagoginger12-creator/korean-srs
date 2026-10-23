// answer-check options derived from content (layer 2 glosses for other items' headwords).
import type { CheckOptions } from '@ksrs/answer-check';
import { looseKoKey, normalizeKo } from '@ksrs/answer-check';
import type { ContentIndex } from '@ksrs/srs-engine';

const cache = new WeakMap<ContentIndex, CheckOptions>();

export function checkOptionsFor(index: ContentIndex): CheckOptions {
  const hit = cache.get(index);
  if (hit) return hit;
  const otherHeadwords = new Map<string, string>();
  // Every item's accepted meanings, for the English real-word typo guard (D30).
  // The current item's own meanings are harmless here: exact accepted matches are checked first.
  const otherMeanings = new Set<string>();
  for (const it of index.byId.values()) {
    if (it.kind !== 'hanja') for (const m of it.questions.meaning?.accepted ?? []) otherMeanings.add(m);
    if (it.kind !== 'vocab') continue;
    const n = normalizeKo(it.word);
    const gloss = it.meanings[0] ?? '';
    if (!otherHeadwords.has(n)) otherHeadwords.set(n, gloss);
    const k = looseKoKey(n);
    if (!otherHeadwords.has(k)) otherHeadwords.set(k, gloss);
  }
  const opts: CheckOptions = { otherHeadwords, otherMeanings: [...otherMeanings] };
  cache.set(index, opts);
  return opts;
}
