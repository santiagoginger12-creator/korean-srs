// Drill state derived from the event log (D80). Pure function of the drill events and the
// `drill.retention` setting timeline, in (hlc, id) order: input order and duplicate ids don't matter.
// The main replay (replay.ts) ignores every drill event, so the drill never touches WaniKani-style
// items, reviews, levels or lesson caps.

import { compareEvents, sortEvents, type AppEvent, type DrillCardId, type EventOf } from '../events.ts';
import { coerceAppSetting } from '../settings.ts';
import {
  DEFAULT_FSRS_PARAMS, newCardSched, schedule, type CardPhase, type CardSched, type FsrsParams, type Rating,
} from './fsrs.ts';

/** A forward card whose interval reaches this many days unlocks the word's reverse card (D78). */
export const REVERSE_UNLOCK_DAYS = 7;
/** Review-phase cards at or above this interval count as mature (Anki). */
export const MATURE_DAYS = 21;

export type DrillDir = 'f' | 'r';

export interface DrillCard extends CardSched {
  id: DrillCardId;
  wordId: string;
  dir: DrillDir;
  /** Marked known (placement or "I already know this"): never queued until reset or reviewed. */
  known: boolean;
  /** First review (ms) since the card was last new; counts toward the daily new limit. */
  firstAt: number | null;
}

export interface DrillReviewRec {
  eventId: string;
  cardId: DrillCardId;
  rating: Rating;
  at: number;
  /** Phase before the answer ('review' answers feed the retention stat). */
  phase: CardPhase;
  /** Interval after the answer, days (0 while (re)learning). */
  ivl: number;
  durationMs: number;
}

export interface DrillPlacement { eventId: string; at: number; count: number; reason: string }

export interface DrillState {
  /** Cards with any history (reviewed or marked known). Missing = new. */
  cards: Map<DrillCardId, DrillCard>;
  /** Live reviews in (hlc, id) order. */
  reviews: DrillReviewRec[];
  /** wordId → time its forward card first reached REVERSE_UNLOCK_DAYS (sticky). */
  reverseUnlockedAt: Map<string, number>;
  /** Live drill.known events (placement batches and single cards), oldest first. */
  placements: DrillPlacement[];
  /** Desired retention currently in effect. */
  retention: number;
  /** Last drill-relevant event applied, for the incremental path. */
  lastKey: { hlc: string; id: string } | null;
}

type DrillEvent = EventOf<'drill.review'> | EventOf<'drill.undo'> | EventOf<'drill.known'> | EventOf<'drill.reset'>;

export const isDrillEvent = (e: AppEvent): e is DrillEvent => e.type.startsWith('drill.');
const isRetentionSetting = (e: AppEvent): boolean => e.type === 'settings.set' && e.key === ('drill.retention' as string);
/** Events the drill projection reads. */
export const isDrillRelevant = (e: AppEvent): boolean => isDrillEvent(e) || isRetentionSetting(e);

export function parseCardId(id: DrillCardId): { wordId: string; dir: DrillDir } {
  const i = id.lastIndexOf(':');
  return { wordId: id.slice(0, i), dir: id.slice(i + 1) === 'r' ? 'r' : 'f' };
}
export const drillCardId = (wordId: string, dir: DrillDir): DrillCardId => `${wordId}:${dir}`;

export function emptyDrillState(): DrillState {
  return { cards: new Map(), reviews: [], reverseUnlockedAt: new Map(), placements: [], retention: DEFAULT_FSRS_PARAMS.retention, lastKey: null };
}

function freshCard(id: DrillCardId): DrillCard {
  const { wordId, dir } = parseCardId(id);
  return { ...newCardSched(), id, wordId, dir, known: false, firstAt: null };
}

/** FSRS params for a retention value (everything else is fixed, D79). */
export function drillParams(retention: number, base: FsrsParams = DEFAULT_FSRS_PARAMS): FsrsParams {
  return retention === base.retention ? base : { ...base, retention };
}

/** Mutable working copy; `apply` writes into it. */
interface Work { st: DrillState; params: FsrsParams }

function apply(w: Work, e: AppEvent): void {
  const st = w.st;
  st.lastKey = { hlc: e.hlc, id: e.id };
  if (e.type === 'settings.set') {
    const v = coerceAppSetting('drill.retention', e.value);
    if (v !== undefined) { st.retention = v; w.params = drillParams(v, w.params); }
    return;
  }
  switch (e.type) {
    case 'drill.review': {
      const prev = st.cards.get(e.cardId) ?? freshCard(e.cardId);
      const next = schedule(prev, e.rating, e.at, e.cardId, w.params);
      const card: DrillCard = { ...prev, ...next, known: false, firstAt: prev.firstAt ?? e.at };
      st.cards.set(e.cardId, card);
      st.reviews.push({ eventId: e.id, cardId: e.cardId, rating: e.rating, at: e.at, phase: prev.phase, ivl: next.ivl, durationMs: e.durationMs ?? 0 });
      if (card.dir === 'f' && card.phase === 'review' && card.ivl >= REVERSE_UNLOCK_DAYS && !st.reverseUnlockedAt.has(card.wordId)) {
        st.reverseUnlockedAt.set(card.wordId, e.at);
      }
      return;
    }
    case 'drill.known': {
      for (const id of e.cardIds) {
        const prev = st.cards.get(id) ?? freshCard(id);
        st.cards.set(id, { ...prev, known: true });
      }
      st.placements.push({ eventId: e.id, at: e.at, count: e.cardIds.length, reason: e.reason ?? '' });
      return;
    }
    case 'drill.reset': {
      if (!e.cardIds) {
        st.cards.clear(); st.reviews.length = 0; st.reverseUnlockedAt.clear(); st.placements.length = 0;
        return;
      }
      for (const id of e.cardIds) {
        st.cards.delete(id);
        const { wordId, dir } = parseCardId(id);
        if (dir === 'f' && !st.cards.has(drillCardId(wordId, 'r'))) st.reverseUnlockedAt.delete(wordId);
      }
      return;
    }
    default:
      return; // drill.undo is resolved before applying; anything else isn't ours
  }
}

/** Ids voided by live drill.undo events (an undo of an undo is ignored). */
function undone(sorted: readonly AppEvent[]): Set<string> {
  const byId = new Map<string, AppEvent>();
  for (const e of sorted) byId.set(e.id, e);
  const out = new Set<string>();
  for (const e of sorted) {
    if (e.type !== 'drill.undo' || e.targetId === e.id) continue;
    const t = byId.get(e.targetId);
    if (t && (t.type === 'drill.review' || t.type === 'drill.known' || t.type === 'drill.reset')) out.add(t.id);
  }
  return out;
}

/** Full replay of the drill from the whole log (any order; non-drill events are skipped). */
export function replayDrill(events: readonly AppEvent[], base: FsrsParams = DEFAULT_FSRS_PARAMS): DrillState {
  const sorted = sortEvents(events.filter(isDrillRelevant));
  const voided = undone(sorted);
  const w: Work = { st: { ...emptyDrillState(), retention: base.retention }, params: base };
  for (const e of sorted) {
    if (e.type === 'drill.undo' || voided.has(e.id)) { w.st.lastKey = { hlc: e.hlc, id: e.id }; continue; }
    apply(w, e);
  }
  return w.st;
}

/**
 * Incremental update after `newEvents` were added to a log whose drill projection is `prev`.
 * Takes the fast path when every new drill-relevant event sorts after `prev.lastKey` and none is
 * an undo or a reset; otherwise returns null and the caller replays (`replayDrill`).
 * Never mutates `prev`.
 */
export function applyDrillEvents(prev: DrillState, newEvents: readonly AppEvent[], base: FsrsParams = DEFAULT_FSRS_PARAMS): DrillState | null {
  const rel = sortEvents(newEvents.filter(isDrillRelevant));
  if (!rel.length) return prev;
  if (prev.lastKey && compareEvents(rel[0]!, prev.lastKey) <= 0) return null;
  if (rel.some((e) => e.type === 'drill.undo' || e.type === 'drill.reset')) return null;
  const w: Work = {
    st: {
      cards: new Map(prev.cards), reviews: prev.reviews.slice(), reverseUnlockedAt: new Map(prev.reverseUnlockedAt),
      placements: prev.placements.slice(), retention: prev.retention, lastKey: prev.lastKey,
    },
    params: drillParams(prev.retention, base),
  };
  for (const e of rel) apply(w, e);
  return w.st;
}
