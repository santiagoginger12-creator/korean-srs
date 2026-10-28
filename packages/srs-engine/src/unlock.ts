// Unlocks and levels (§7.3, D12), with grammar on its own path (separate-path redesign).
//
// Two paths, both pure functions of (content index, item states, settings):
// - Vocab path (vocab + expressions; hanja ride along as lesson-only nodes). Its levels are the
//   levels that hold at least one non-grammar item. Level N+1 opens at ≥ 90% of level N's gating
//   vocab and expression items passed.
// - Grammar path. Its stages are the distinct `level` values of grammar items, ascending (gaps are
//   fine: 1, 2, 3, 5, 6, 7). Stage k+1 opens at ≥ 90% of stage k's gating grammar items passed.
// Within an open level/stage, explicit (and implicit hanja) unlockDeps still apply.
// `grammar.separatePath: false` restores the combined behaviour (one ladder over every level,
// gating counts vocab, grammar and expressions).
// Hanja are not lesson nodes (D63, supersedes D12): unless `hanja.lessons` is on, hanja items are
// never unlocked or offered, and neither implicit hanja-lesson deps nor explicit deps on a hanja
// apply. Old `lesson.completed` events for hanja replay harmlessly (lessonAt only, never counted).

import type { Item, ItemId } from '@ksrs/content';
import { KIND_ORDER, resolveId, type ContentIndex } from './content-index.ts';
import type { DerivedState, ItemState } from './state.ts';

export const LEVEL_THRESHOLD = 0.9;

export type LessonPath = 'vocab' | 'grammar';

/** Engine-side view of the path settings. Missing means the default (separate grammar, no hanja lessons). */
export interface PathSettings { 'grammar.separatePath'?: boolean; 'hanja.lessons'?: boolean }
export const isSeparatePath = (st: PathSettings | undefined): boolean => st?.['grammar.separatePath'] !== false;
export const hanjaLessonsOn = (st: PathSettings | undefined): boolean => st?.['hanja.lessons'] === true;

const isGrammar = (it: Item): boolean => it.kind === 'grammar';
type Filter = (it: Item) => boolean;
const ALL: Filter = () => true;
const NOT_GRAMMAR: Filter = (it) => !isGrammar(it);

function gatingCounts(index: ContentIndex, items: Map<ItemId, ItemState>, level: number, filter: Filter): { total: number; passed: number } {
  let total = 0;
  let passed = 0;
  for (const it of index.byLevel.get(level) ?? []) {
    if (it.kind === 'hanja' || !it.gating || !filter(it)) continue; // hanja never gate
    total++;
    if (items.get(it.id)?.passedAt !== undefined) passed++;
  }
  return { total, passed };
}

/** Integer comparison avoids float edge cases at exactly 90%. An empty level unlocks the next. */
const meetsThreshold = (passed: number, total: number): boolean => total === 0 || passed * 10 >= total * 9;

/**
 * All implicit and explicit deps of `it`, resolved through idRedirects; unknown ids are ignored.
 * With hanja lessons off (the default), deps on hanja items don't exist.
 */
export function unlockDepsOf(index: ContentIndex, it: Item, opts?: PathSettings): { id: ItemId; require: 'lesson' | 'guru' }[] {
  const hanja = hanjaLessonsOn(opts);
  const out: { id: ItemId; require: 'lesson' | 'guru' }[] = [];
  for (const d of it.unlockDeps ?? []) {
    const id = resolveId(index.redirects, d.id);
    const target = index.byId.get(id);
    if (target && id !== it.id && (hanja || target.kind !== 'hanja')) out.push({ id, require: d.require });
  }
  if (hanja && it.kind === 'vocab' && it.hanjaBreakdown) {
    for (const hb of it.hanjaBreakdown) {
      if (!hb.hanjaId) continue;
      const id = resolveId(index.redirects, hb.hanjaId);
      if (index.byId.get(id)?.kind === 'hanja' && !out.some((d) => d.id === id)) out.push({ id, require: 'lesson' });
    }
  }
  return out;
}

function depsSatisfied(index: ContentIndex, items: Map<ItemId, ItemState>, it: Item, opts?: PathSettings): boolean {
  for (const d of unlockDepsOf(index, it, opts)) {
    const st = items.get(d.id);
    if (d.require === 'lesson' ? st?.lessonAt === undefined : st?.passedAt === undefined) return false;
  }
  return true;
}

/** Levels that hold at least one item matching `filter`, ascending. */
function levelsWith(index: ContentIndex, filter: Filter): number[] {
  return index.levels.filter((L) => (index.byLevel.get(L) ?? []).some(filter));
}

/** Vocab-path levels (any level with a non-grammar item); every level in combined mode. */
export function vocabLevels(index: ContentIndex, separate = true): number[] {
  return separate ? levelsWith(index, NOT_GRAMMAR) : index.levels.slice();
}

/** Grammar-path stages: the distinct levels of grammar items, ascending. */
export function grammarStages(index: ContentIndex): number[] {
  return levelsWith(index, isGrammar);
}

/** Walks a ladder of levels: the first is open; each next opens when the previous meets 90%. */
function walk(index: ContentIndex, items: Map<ItemId, ItemState>, ladder: number[], filter: Filter): number[] {
  const open: number[] = [];
  for (const L of ladder) {
    if (open.length > 0) {
      const c = gatingCounts(index, items, open[open.length - 1]!, filter);
      if (!meetsThreshold(c.passed, c.total)) break;
    }
    open.push(L);
  }
  return open;
}

/** Open vocab-path levels (combined mode: open levels over everything). */
export function openLevels(index: ContentIndex, items: Map<ItemId, ItemState>, opts?: PathSettings): number[] {
  const sep = isSeparatePath(opts);
  return walk(index, items, vocabLevels(index, sep), sep ? NOT_GRAMMAR : ALL);
}

/** Open grammar stages. Combined mode: the grammar stages at or below an open level. */
export function openGrammarStages(index: ContentIndex, items: Map<ItemId, ItemState>, opts?: PathSettings): number[] {
  if (!isSeparatePath(opts)) {
    const open = new Set(openLevels(index, items, opts));
    return grammarStages(index).filter((L) => open.has(L));
  }
  return walk(index, items, grammarStages(index), isGrammar);
}

export function computeUnlocks(index: ContentIndex, items: Map<ItemId, ItemState>, opts?: PathSettings):
  { userLevel: number; grammarStage: number | null; unlocked: Set<ItemId> } {
  const sep = isSeparatePath(opts);
  const hanja = hanjaLessonsOn(opts);
  const open = openLevels(index, items, opts);
  const gOpen = openGrammarStages(index, items, opts);
  const unlocked = new Set<ItemId>();
  const consider = (L: number, filter: Filter) => {
    for (const it of index.byLevel.get(L) ?? []) {
      if (!filter(it)) continue;
      if (it.kind === 'hanja') { if (hanja) unlocked.add(it.id); continue; }
      if (depsSatisfied(index, items, it, opts)) unlocked.add(it.id);
    }
  };
  for (const L of open) consider(L, sep ? NOT_GRAMMAR : ALL);
  if (sep) for (const L of gOpen) consider(L, isGrammar);
  // Anything already learned stays unlocked (e.g. a custom item learned before its level opened).
  // Hanja with old lesson events stay out when hanja lessons are off (D63).
  for (const st of items.values()) {
    if (st.lessonAt !== undefined && index.byId.has(st.itemId) && (hanja || st.kind !== 'hanja')) unlocked.add(st.itemId);
  }
  return {
    userLevel: open.length ? open[open.length - 1]! : 1,
    grammarStage: gOpen.length ? gOpen[gOpen.length - 1]! : null,
    unlocked,
  };
}

type ProgressState = Pick<DerivedState, 'items'> & { settings?: PathSettings };

/** Gating progress of a vocab-path level (separate mode: vocab + expressions only; combined: all). */
export function levelProgress(index: ContentIndex, s: ProgressState, level: number):
  { gatingTotal: number; gatingPassed: number; threshold: number; unlocksNext: boolean } {
  const c = gatingCounts(index, s.items, level, isSeparatePath(s.settings) ? NOT_GRAMMAR : ALL);
  return { gatingTotal: c.total, gatingPassed: c.passed, threshold: LEVEL_THRESHOLD, unlocksNext: meetsThreshold(c.passed, c.total) };
}

export interface GrammarStageProgress {
  /** The content level this stage is made of. */
  level: number;
  /** 1-based position on the grammar path. */
  stage: number;
  gatingTotal: number;
  gatingPassed: number;
  threshold: number;
  /** ≥ 90% of this stage's gating grammar has passed (the next stage opens). */
  unlocksNext: boolean;
  open: boolean;
}
export interface GrammarProgress {
  separate: boolean;
  stages: GrammarStageProgress[];
  /** The highest open stage (the one being worked on), or null with no grammar content. */
  current: GrammarStageProgress | null;
}

/** Progress along the grammar path, one entry per grammar stage. */
export function grammarProgress(index: ContentIndex, s: ProgressState): GrammarProgress {
  const separate = isSeparatePath(s.settings);
  const open = new Set(openGrammarStages(index, s.items, s.settings));
  const stages = grammarStages(index).map((level, i): GrammarStageProgress => {
    const c = gatingCounts(index, s.items, level, isGrammar);
    return {
      level, stage: i + 1, gatingTotal: c.total, gatingPassed: c.passed, threshold: LEVEL_THRESHOLD,
      unlocksNext: meetsThreshold(c.passed, c.total), open: open.has(level),
    };
  });
  const openStages = stages.filter((g) => g.open);
  return { separate, stages, current: openStages.length ? openStages[openStages.length - 1]! : null };
}

/**
 * Unlocked items without a lesson. Hanja only with `hanja.lessons` on (D63). `path: 'vocab'` is everything except grammar; `path: 'grammar'`
 * is grammar only, by level then content order. Without `path`, everything (combined order).
 * Vocab/combined order: hanja first, then by level, kind (vocab, grammar, expression), content order,
 * with imported extras interleaved (D60).
 */
export function availableLessons(index: ContentIndex, s: Pick<DerivedState, 'items' | 'unlocked'> & { settings?: PathSettings },
                                 opts: { path?: LessonPath } = {}): ItemId[] {
  const hanjaOn = hanjaLessonsOn(s.settings);
  const out: Item[] = [];
  for (const id of s.unlocked) {
    const it = index.byId.get(id);
    if (!it || s.items.get(id)?.lessonAt !== undefined) continue;
    if (it.kind === 'hanja' && !hanjaOn) continue;
    if (opts.path === 'vocab' && isGrammar(it)) continue;
    if (opts.path === 'grammar' && !isGrammar(it)) continue;
    out.push(it);
  }
  out.sort((a, b) => {
    const ha = a.kind === 'hanja' ? 0 : 1;
    const hb = b.kind === 'hanja' ? 0 : 1;
    return ha - hb || a.level - b.level || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
      || (index.order.get(a.id) ?? 0) - (index.order.get(b.id) ?? 0);
  });
  if (opts.path === 'grammar') return out.map((it) => it.id);
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
