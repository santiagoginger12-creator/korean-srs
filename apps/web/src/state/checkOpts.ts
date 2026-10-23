// answer-check options derived from content (layer 2 glosses for other items' headwords).
import type { CheckOptions } from '@ksrs/answer-check';
import { looseKoKey, normalizeKo } from '@ksrs/answer-check';
import type { ContentIndex } from '@ksrs/srs-engine';

const cache = new WeakMap<ContentIndex, CheckOptions>();

export function checkOptionsFor(index: ContentIndex): CheckOptions {
  const hit = cache.get(index);
  if (hit) return hit;
  const otherHeadwords = new Map<string, string>();
  for (const it of index.byId.values()) {
    if (it.kind !== 'vocab') continue;
    const n = normalizeKo(it.word);
    const gloss = it.meanings[0] ?? '';
    if (!otherHeadwords.has(n)) otherHeadwords.set(n, gloss);
    const k = looseKoKey(n);
    if (!otherHeadwords.has(k)) otherHeadwords.set(k, gloss);
  }
  const opts: CheckOptions = { otherHeadwords };
  cache.set(index, opts);
  return opts;
}
