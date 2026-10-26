// Browse/search filtering (pure). Unit-tested in test/browse.test.ts.
import type { Item, ItemKind } from '@ksrs/content';
import type { ContentIndex } from '@ksrs/srs-engine';

export interface BrowseFilter { level: number | 'all'; kind: ItemKind | 'all'; query: string }

/** All searchable text for an item: headword, readings, meanings, hanja forms. */
export function searchText(it: Item): string {
  switch (it.kind) {
    case 'hanja': return [it.char, it.hun, it.eum, `${it.hun} ${it.eum}`, ...it.meanings].join('\n');
    case 'vocab': return [it.word, ...it.meanings, ...(it.hanjaBreakdown ?? []).map((h) => h.hanja)].join('\n');
    case 'grammar': return [it.pattern, it.meaning].join('\n');
    case 'expression': return [it.text, it.hanjaText ?? '', it.meaning, it.literal].join('\n');
  }
}

const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

export function browse(index: ContentIndex, f: BrowseFilter): Map<number, Item[]> {
  const q = norm(f.query);
  const qNoSpace = q.replace(/ /g, '');
  const out = new Map<number, Item[]>();
  for (const L of index.levels) {
    if (f.level !== 'all' && L !== f.level) continue;
    const items = (index.byLevel.get(L) ?? []).filter((it) => {
      if (f.kind !== 'all' && it.kind !== f.kind) return false;
      if (!q) return true;
      const t = norm(searchText(it));
      return t.includes(q) || t.replace(/ /g, '').includes(qNoSpace);
    });
    if (items.length) out.set(L, items);
  }
  return out;
}
