// M5 helpers: Variants inbox (D11), extra-study selection (§7.5, emits no events), reset candidates.

import type { ItemId, ItemKind, QuestionType } from '@ksrs/content';
import { resolveId } from './content-index.ts';
import type { AppEvent } from './events.ts';
import { stageGroup, type StageGroup } from './forecast.ts';
import { troubleItems } from './leech.ts';
import { liveEvents } from './replay.ts';
import type { Stage } from './scheduler/index.ts';
import { userAnswerKey, type DerivedState, type ItemState } from './state.ts';
import { DAY, seededShuffle } from './util.ts';

// ---------------------------------------------------------------- variants inbox

export interface VariantEntry {
  eventId: string; itemId: ItemId; qtype: QuestionType; promptId?: string; response: string; at: number; matched?: string;
}

/** Comparison key for responses: NFC, collapsed whitespace, no final punctuation, lowercase. */
export function normalizeResponse(s: string): string {
  return s.normalize('NFC').replace(/\s+/g, ' ').trim().replace(/[.!?~…。！？～]+$/u, '').trim().toLowerCase();
}

/**
 * Correct answers accepted by the checker's variant layer (`check.layer === 'variant'`) that the
 * owner hasn't curated yet. Live events only (undone/overridden answers are gone). Excludes
 * responses already in the item's user answers for that qtype, and every (item, qtype, response)
 * whose event id is listed in the `inbox.dismissed` setting. Newest first, one entry per
 * (item, qtype, normalized response), carrying the newest event's id.
 */
export function variantsInbox(s: DerivedState, events: readonly AppEvent[]): VariantEntry[] {
  const live = liveEvents(events);
  const R = s.index.redirects;
  const keyOf = (e: AppEvent & { type: 'review.answer' }) =>
    `${resolveId(R, e.itemId)}\u0000${e.qtype}\u0000${normalizeResponse(e.response)}`;
  const isVariant = (e: AppEvent): e is AppEvent & { type: 'review.answer' } =>
    e.type === 'review.answer' && e.grade === 'correct' && e.check.layer === 'variant';

  const dismissedIds = new Set(s.settings['inbox.dismissed'] ?? []);
  const dismissedKeys = new Set<string>();
  for (const e of live) if (isVariant(e) && dismissedIds.has(e.id)) dismissedKeys.add(keyOf(e));

  const seen = new Set<string>();
  const out: VariantEntry[] = [];
  for (let i = live.length - 1; i >= 0; i--) {
    const e = live[i]!;
    if (!isVariant(e)) continue;
    const norm = normalizeResponse(e.response);
    if (!norm) continue;
    const key = keyOf(e);
    if (seen.has(key) || dismissedKeys.has(key)) continue;
    seen.add(key);
    const itemId = resolveId(R, e.itemId);
    const accepted = s.userAnswers.get(userAnswerKey(itemId, e.qtype)) ?? [];
    if (accepted.some((a) => normalizeResponse(a) === norm)) continue;
    const entry: VariantEntry = { eventId: e.id, itemId, qtype: e.qtype, response: e.response, at: e.at };
    if (e.promptId !== undefined) entry.promptId = e.promptId;
    if (e.check.matched !== undefined) entry.matched = e.check.matched;
    out.push(entry);
  }
  return out;
}

// ---------------------------------------------------------------- extra study

export type ExtraStudySource =
  | { kind: 'recentLessons'; days: number }
  | { kind: 'trouble'; limit: number }
  | { kind: 'filter'; level?: number; itemKind?: ItemKind; stageGroup?: StageGroup }
  /** Every reviewable item with this tag, lesson or not (practice emits no events): app-missed first, worst first. */
  | { kind: 'tag'; tag: string };

const byId = (a: ItemState, b: ItemState) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0);

/**
 * Items for an extra-study session (which emits no events, §7.5): reviewable (non-hanja) items
 * that have had their lesson and still exist in the content index. Selection is by priority
 * (most recent lessons / worst leech score) or a seeded random sample (filter), cut to `limit`,
 * then shuffled by `seed`. Deterministic for equal inputs.
 */
export function extraStudyItems(s: DerivedState, src: ExtraStudySource, now: number, seed: string, limit?: number): ItemId[] {
  const pool = [...s.items.values()]
    .filter((st) => st.kind !== 'hanja' && st.lessonAt !== undefined && st.stage > 0 && s.index.byId.has(st.itemId))
    .sort(byId);
  let ranked: ItemId[];
  switch (src.kind) {
    case 'recentLessons': {
      const from = now - Math.max(0, src.days) * DAY;
      ranked = pool.filter((st) => st.lessonAt! >= from && st.lessonAt! <= now)
        .sort((a, b) => b.lessonAt! - a.lessonAt! || byId(a, b)).map((st) => st.itemId);
      break;
    }
    case 'trouble': {
      const ok = new Set(pool.map((st) => st.itemId));
      ranked = troubleItems(s, Math.max(0, src.limit), now).map((t) => t.itemId).filter((id) => ok.has(id));
      break;
    }
    case 'tag': {
      const tagged = [...s.index.byId.values()]
        .filter((it) => it.kind !== 'hanja' && Array.isArray(it.tags) && it.tags.includes(src.tag)).map((it) => it.id).sort();
      const missed = tagged.map((id) => s.items.get(id)).filter((st): st is ItemState => !!st && st.stats.incorrect > 0)
        .sort((a, b) => b.leechScore - a.leechScore || b.stats.incorrect - a.stats.incorrect || byId(a, b)).map((st) => st.itemId);
      const first = new Set(missed);
      ranked = [...missed, ...seededShuffle(tagged.filter((id) => !first.has(id)), `${seed}#pick`)];
      break;
    }
    case 'filter':
      ranked = seededShuffle(pool.filter((st) =>
        (src.level === undefined || st.level === src.level)
        && (src.itemKind === undefined || st.kind === src.itemKind)
        && (src.stageGroup === undefined || stageGroup(st.stage) === src.stageGroup)).map((st) => st.itemId), `${seed}#pick`);
      break;
    default:
      ranked = [];
  }
  const picked = limit === undefined ? ranked : ranked.slice(0, Math.max(0, limit));
  return seededShuffle(picked, seed);
}

// ---------------------------------------------------------------- leech reset

/** Trouble items worth an `item.reset` (stage > 1, so a reset changes something), worst first. */
export function resetCandidates(s: DerivedState, now: number): { itemId: ItemId; score: number; stage: Stage }[] {
  const out: { itemId: ItemId; score: number; stage: Stage }[] = [];
  for (const t of troubleItems(s, Number.MAX_SAFE_INTEGER, now)) {
    const st = s.items.get(t.itemId);
    if (st && st.stage > 1) out.push({ ...t, stage: st.stage as Stage });
  }
  return out;
}
