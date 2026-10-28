// Unlocks and levels (§7.3, D12).

import type { Item, ItemId } from '@ksrs/content';
import { KIND_ORDER, resolveId, type ContentIndex } from './content-index.ts';
import type { DerivedState, ItemState } from './state.ts';

export const LEVEL_THRESHOLD = 0.9;

function gatingCounts(index: ContentIndex, items: Map<ItemId, ItemState>, level: number): { total: number; passed: number } {
  let total = 0;
  let passed = 0;
  for (const it of index.byLevel.get(level) ?? []) {
    if (it.kind === 'hanja' || !it.gating) continue; // hanja never gate
    total++;
    if (items.get(it.id)?.passedAt !== undefined) passed++;
  }
  return { total, passed };
}

/** Integer comparison avoids float edge cases at exactly 90%. An empty level unlocks the next. */
const meetsThreshold = (passed: number, total: number): boolean => total === 0 || passed * 10 >= total * 9;

/** All implicit and explicit deps of `it`, resolved through idRedirects; unknown ids are ignored. */
export function unlockDepsOf(index: ContentIndex, it: Item): { id: ItemId; require: 'lesson' | 'guru' }[] {
  const out: { id: ItemId; require: 'lesson' | 'guru' }[] = [];
  for (const d of it.unlockDeps ?? []) {
    const id = resolveId(index.redirects, d.id);
    if (index.byId.has(id) && id !== it.id) out.push({ id, require: d.require });
  }
  if (it.kind === 'vocab' && it.hanjaBreakdown) {
    for (const hb of it.hanjaBreakdown) {
      if (!hb.hanjaId) continue;
      const id = resolveId(index.redirects, hb.hanjaId);
      if (index.byId.get(id)?.kind === 'hanja' && !out.some((d) => d.id === id)) out.push({ id, require: 'lesson' });
    }
  }
  return out;
}

function depsSatisfied(index: ContentIndex, items: Map<ItemId, ItemState>, it: Item): boolean {
  for (const d of unlockDepsOf(index, it)) {
    const st = items.get(d.id);
    if (d.require === 'lesson' ? st?.lessonAt === undefined : st?.passedAt === undefined) return false;
  }
  return true;
}

export function openLevels(index: ContentIndex, items: Map<ItemId, ItemState>): number[] {
  const open: number[] = [];
  for (const L of index.levels) {
    if (open.length > 0) {
      const prev = open[open.length - 1]!;
      const c = gatingCounts(index, items, prev);
      if (!meetsThreshold(c.passed, c.total)) break;
    }
    open.push(L);
  }
  return open;
}

export function computeUnlocks(index: ContentIndex, items: Map<ItemId, ItemState>): { userLevel: number; unlocked: Set<ItemId> } {
  const open = openLevels(index, items);
  const unlocked = new Set<ItemId>();
  for (const L of open) {
    for (const it of index.byLevel.get(L) ?? []) {
      if (it.kind === 'hanja' || depsSatisfied(index, items, it)) unlocked.add(it.id);
    }
  }
  // Anything already learned stays unlocked (e.g. a custom item learned before its level opened).
  for (const st of items.values()) if (st.lessonAt !== undefined && index.byId.has(st.itemId)) unlocked.add(st.itemId);
  return { userLevel: open.length ? open[open.length - 1]! : 1, unlocked };
}

export function levelProgress(index: ContentIndex, s: Pick<DerivedState, 'items'>, level: number):
  { gatingTotal: number; gatingPassed: number; threshold: number; unlocksNext: boolean } {
  const c = gatingCounts(index, s.items, level);
  return { gatingTotal: c.total, gatingPassed: c.passed, threshold: LEVEL_THRESHOLD, unlocksNext: meetsThreshold(c.passed, c.total) };
}

/** Unlocked items without a lesson: hanja first, then by level, kind (vocab, grammar, expression), content order. */
export function availableLessons(index: ContentIndex, s: Pick<DerivedState, 'items' | 'unlocked'>): ItemId[] {
  const out: Item[] = [];
  for (const id of s.unlocked) {
    const it = index.byId.get(id);
    if (!it || s.items.get(id)?.lessonAt !== undefined) continue;
    out.push(it);
  }
  out.sort((a, b) => {
    const ha = a.kind === 'hanja' ? 0 : 1;
    const hb = b.kind === 'hanja' ? 0 : 1;
    return ha - hb || a.level - b.level || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
      || (index.order.get(a.id) ?? 0) - (index.order.get(b.id) ?? 0);
  });
  // Imported, non-gating extras (e.g. a personal Anki import) are interleaved with the
  // curriculum instead of queuing ahead of it (D60): after hanja, every block of
  // CURRICULUM_RUN curriculum lessons is followed by up to EXTRA_RUN extras.
  const isExtra = (it: Item): boolean => it.kind !== 'hanja' && !it.gating && it.source?.kind !== 'original';
  const hanja = out.filter((it) => it.kind === 'hanja');
  const core = out.filter((it) => it.kind !== 'hanja' && !isExtra(it));
  const extras = out.filter(isExtra);
  const mixed: Item[] = [...hanja];
  let c = 0;
  let e = 0;
  while (c < core.length || e < extras.length) {
    for (let k = 0; k < CURRICULUM_RUN && c < core.length; k++) mixed.push(core[c++]!);
    for (let k = 0; k < EXTRA_RUN && e < extras.length; k++) mixed.push(extras[e++]!);
    if (c >= core.length) while (e < extras.length) mixed.push(extras[e++]!);
  }
  return mixed.map((it) => it.id);
}

/** Lesson interleave for imported extras: 3 curriculum, then 2 extras (a default batch of 5). */
export const CURRICULUM_RUN = 3;
export const EXTRA_RUN = 2;
