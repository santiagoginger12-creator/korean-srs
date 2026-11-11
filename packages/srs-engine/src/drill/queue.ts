// Drill queue, counts and session picking (D81, D82). Pure: callers pass `now` and the study-day
// bounds (localDayStart with settings.dayStartHour), plus the deck's tier ranges (DeckMeta), so
// counts need no deck download. Deck order is word-id order (tier 1→6, then frequency).

import { DAY, MINUTE } from '../util.ts';
import { drillCardId, MATURE_DAYS, type DrillCard, type DrillState } from './state.ts';

export interface DeckTier { tier: number; label: string; count: number; first: string; last: string }
export interface DeckMeta { count: number; tiers: DeckTier[] }
export interface DrillDay { start: number; end: number }

/** Anki's default learn-ahead limit: with nothing else left, learning cards due this soon are shown. */
export const LEARN_AHEAD_MS = 20 * MINUTE;

export function tierOf(meta: DeckMeta, wordId: string): DeckTier | undefined {
  return meta.tiers.find((t) => wordId >= t.first && wordId <= t.last);
}

const active = (c: DrillCard) => !c.known && c.phase !== 'new';
const isLearning = (c: DrillCard) => c.phase === 'learning' || c.phase === 'relearning';
const byDue = (a: DrillCard, b: DrillCard) => a.due - b.due || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Learning / relearning cards due by `t`, earliest first. */
export function dueLearning(st: DrillState, t: number): DrillCard[] {
  return [...st.cards.values()].filter((c) => active(c) && isLearning(c) && c.due <= t).sort(byDue);
}

/** Review cards due today (due before the day ends), earliest first. */
export function dueReviews(st: DrillState, day: DrillDay): DrillCard[] {
  return [...st.cards.values()].filter((c) => active(c) && c.phase === 'review' && c.due < day.end).sort(byDue);
}

/** The next learning card due after `t`, if any. */
export function nextLearningDue(st: DrillState, t: number): number | null {
  let best: number | null = null;
  for (const c of st.cards.values()) if (active(c) && isLearning(c) && c.due > t && (best === null || c.due < best)) best = c.due;
  return best;
}

/** Forward cards first studied today (they use up the daily new limit). */
export function newIntroducedToday(st: DrillState, day: DrillDay): number {
  let n = 0;
  for (const c of st.cards.values()) if (c.dir === 'f' && c.firstAt !== null && c.firstAt >= day.start && c.firstAt < day.end) n++;
  return n;
}

export function reviewsToday(st: DrillState, day: DrillDay): number {
  let n = 0;
  for (const r of st.reviews) if (r.at >= day.start && r.at < day.end) n++;
  return n;
}

/** Share of review-phase answers in the window that weren't Again (Anki's "true retention"). */
export function drillRetention(st: DrillState, since: number, until: number): { pass: number; total: number; rate: number | null } {
  let pass = 0, total = 0;
  for (const r of st.reviews) {
    if (r.phase !== 'review' || r.at < since || r.at >= until) continue;
    total++;
    if (r.rating > 1) pass++;
  }
  return { pass, total, rate: total ? pass / total : null };
}

const isUnseen = (st: DrillState, wordId: string) => !st.cards.has(drillCardId(wordId, 'f'));

/** Unseen forward cards (never reviewed, not known) in tiers ≥ fromTier. */
export function unseenForward(st: DrillState, meta: DeckMeta, fromTier = 0): number {
  let total = 0;
  for (const t of meta.tiers) if (t.tier >= fromTier) total += t.count;
  for (const c of st.cards.values()) {
    if (c.dir !== 'f') continue;
    const t = tierOf(meta, c.wordId);
    if (t && t.tier >= fromTier) total--;
  }
  return Math.max(0, total);
}

/** Unseen forward cards per tier. */
export function unseenByTier(st: DrillState, meta: DeckMeta): Map<number, number> {
  const out = new Map(meta.tiers.map((t) => [t.tier, t.count] as const));
  for (const c of st.cards.values()) {
    if (c.dir !== 'f') continue;
    const t = tierOf(meta, c.wordId);
    if (t) out.set(t.tier, out.get(t.tier)! - 1);
  }
  return out;
}

/** The tier new cards come from: the setting if it still has unseen cards, else the first tier that does. */
export function effectiveStartTier(st: DrillState, meta: DeckMeta, setting: number): number | null {
  const left = unseenByTier(st, meta);
  const open = meta.tiers.filter((t) => (left.get(t.tier) ?? 0) > 0).map((t) => t.tier);
  if (!open.length) return null;
  if (setting > 0) return open.find((t) => t >= setting) ?? open[0]!;
  return open[0]!;
}

/** Reverse cards that are new and unlocked before today began (they enter the queue the next day). */
export function reverseNewIds(st: DrillState, day: DrillDay, enabled: boolean): string[] {
  if (!enabled) return [];
  const out: string[] = [];
  for (const [wordId, at] of st.reverseUnlockedAt) {
    if (at >= day.start) continue;
    const r = st.cards.get(drillCardId(wordId, 'r'));
    const f = st.cards.get(drillCardId(wordId, 'f'));
    if (r || f?.known) continue;
    out.push(drillCardId(wordId, 'r'));
  }
  return out.sort();
}

export interface DrillSettingsView { newPerDay: number; reverse: boolean; startTier: number }

/** How many forward new cards may still be introduced today. */
export function newLeftToday(st: DrillState, s: DrillSettingsView, day: DrillDay): number {
  return Math.max(0, s.newPerDay - newIntroducedToday(st, day));
}

export interface DrillCounts {
  /** Learning cards due today + reviews due today. */
  due: number;
  learning: number;
  reviews: number;
  /** Forward new cards available today (limit and deck permitting) + unlocked reverse cards. */
  newToday: number;
  newForward: number;
  newReverse: number;
  reviewsToday: number;
  retention30: { pass: number; total: number; rate: number | null };
  byState: { new: number; learning: number; young: number; mature: number; known: number };
  startTier: number | null;
}

export function drillCounts(st: DrillState, meta: DeckMeta, s: DrillSettingsView, now: number, day: DrillDay): DrillCounts {
  const learning = [...st.cards.values()].filter((c) => active(c) && isLearning(c) && c.due < day.end).length;
  const reviews = dueReviews(st, day).length;
  const startTier = effectiveStartTier(st, meta, s.startTier);
  const newForward = startTier === null ? 0 : Math.min(newLeftToday(st, s, day), unseenForward(st, meta, startTier));
  const newReverse = reverseNewIds(st, day, s.reverse).length;
  const byState = { new: unseenForward(st, meta), learning: 0, young: 0, mature: 0, known: 0 };
  for (const c of st.cards.values()) {
    if (c.known) byState.known++;
    else if (isLearning(c)) byState.learning++;
    else if (c.phase === 'review') { if (c.ivl >= MATURE_DAYS) byState.mature++; else byState.young++; }
    else if (c.dir === 'r') byState.new++;
  }
  if (s.reverse) {
    for (const wordId of st.reverseUnlockedAt.keys()) if (!st.cards.has(drillCardId(wordId, 'r')) && !st.cards.get(drillCardId(wordId, 'f'))?.known) byState.new++;
  }
  return {
    due: learning + reviews, learning, reviews, newToday: newForward + newReverse, newForward, newReverse,
    reviewsToday: reviewsToday(st, day), retention30: drillRetention(st, now - 30 * DAY, now + 1), byState, startTier,
  };
}

/** The next `limit` unseen forward card ids in deck order, from `orderedWordIds` (already tier-filtered). */
export function newForwardIds(st: DrillState, orderedWordIds: readonly string[], limit: number): string[] {
  const out: string[] = [];
  for (const id of orderedWordIds) {
    if (out.length >= limit) break;
    if (isUnseen(st, id)) out.push(drillCardId(id, 'f'));
  }
  return out;
}

/** Forward new cards with reverse cards spread evenly between them. */
export function mixNew(forward: readonly string[], reverse: readonly string[]): string[] {
  if (!reverse.length) return forward.slice();
  if (!forward.length) return reverse.slice();
  const out: string[] = [];
  const total = forward.length + reverse.length;
  let fi = 0, ri = 0;
  for (let k = 0; k < total; k++) {
    // Place reverse card ri at evenly spaced positions.
    const wantR = ri < reverse.length && (fi >= forward.length || (ri + 1) * total / (reverse.length + 1) <= k + 1);
    if (wantR) out.push(reverse[ri++]!); else out.push(forward[fi++]!);
  }
  return out;
}

// ---------------------------------------------------------------- session picking

export interface DrillSession {
  /** New cards planned for this session (card ids, in order); taken from the front. */
  newQueue: string[];
  /** Reviews (non-new, non-learning answers) since the last new card. */
  sinceNew: number;
}

export type PickSource = 'learning' | 'review' | 'new' | 'ahead';
export type DrillPick =
  | { kind: 'card'; cardId: string; source: PickSource }
  | { kind: 'wait'; until: number }
  | { kind: 'done' };

/** A queued new card that is still new (not reviewed or marked known since the session began). */
function stillNew(st: DrillState, id: string): boolean {
  const c = st.cards.get(id);
  return !c || (c.phase === 'new' && !c.known);
}

/**
 * Anki-style order: learning cards that are due, then reviews due today with the session's new
 * cards spread among them, then learning cards within the learn-ahead limit. When only later
 * learning cards remain, the session waits for them.
 */
export function pickNext(st: DrillState, sess: DrillSession, now: number, day: DrillDay, learnAheadMs = LEARN_AHEAD_MS): DrillPick {
  const lrn = dueLearning(st, now);
  if (lrn.length) return { kind: 'card', cardId: lrn[0]!.id, source: 'learning' };
  const revs = dueReviews(st, day);
  const news = sess.newQueue.filter((id) => stillNew(st, id));
  if (revs.length || news.length) {
    const gap = Math.floor(revs.length / (news.length + 1));
    if (news.length && (!revs.length || sess.sinceNew >= gap)) return { kind: 'card', cardId: news[0]!, source: 'new' };
    return { kind: 'card', cardId: revs[0]!.id, source: 'review' };
  }
  const ahead = dueLearning(st, now + learnAheadMs);
  if (ahead.length) return { kind: 'card', cardId: ahead[0]!.id, source: 'ahead' };
  const next = nextLearningDue(st, now);
  if (next !== null && next < day.end) return { kind: 'wait', until: next };
  return { kind: 'done' };
}

/** Session bookkeeping after answering a card picked from `source`. */
export function afterAnswer(sess: DrillSession, st: DrillState, source: PickSource): DrillSession {
  const newQueue = sess.newQueue.filter((id) => stillNew(st, id));
  if (source === 'new') return { newQueue, sinceNew: 0 };
  if (source === 'review') return { newQueue, sinceNew: sess.sinceNew + 1 };
  return { ...sess, newQueue };
}
