// Deterministic replay of the event log (§6, §6.1). Pure function of (content, events):
// input order and duplicate ids do not matter.

import type { ContentBundle, Item, ItemId, QuestionType } from '@ksrs/content';
import { buildContentIndex, resolveId, type ContentIndex } from './content-index.ts';
import {
  coerceSetting, compareEvents, DEFAULT_INTERVALS, eventItemId, sortEvents, SRS_SETTING_KEYS,
  type AppEvent, type EventOf,
} from './events.ts';
import { coerceAppSetting, defaultAppSettings, type AppSettings } from './settings.ts';
import { leechScore, LEECH_WINDOW_MS } from './leech.ts';
import { wkAvailableAt } from './scheduler/wk.ts';
import { getScheduler } from './scheduler/wk.ts';
import type { Stage } from './scheduler/index.ts';
import { noteKey, userAnswerKey, type DerivedState, type ItemState } from './state.ts';
import { computeUnlocks } from './unlock.ts';
import { MINUTE } from './util.ts';

export const DUENESS_GRACE_MS = 5 * MINUTE;

// ---------------------------------------------------------------- SRS settings timeline (D6)

interface SrsSnapshot { intervals: readonly number[]; scheduler: 'wk' | 'fsrs' }
interface Timeline { keys: { hlc: string; id: string }[]; snaps: SrsSnapshot[]; anyFsrs: boolean }

const DEFAULT_SNAP: SrsSnapshot = { intervals: DEFAULT_INTERVALS, scheduler: 'wk' };

function buildTimeline(live: readonly AppEvent[]): Timeline {
  const tl: Timeline = { keys: [], snaps: [], anyFsrs: false };
  let cur = DEFAULT_SNAP;
  for (const e of live) {
    if (e.type !== 'settings.set' || !SRS_SETTING_KEYS.has(e.key)) continue;
    if (e.key === 'srs.intervals') {
      const v = coerceSetting('srs.intervals', e.value);
      if (!v) continue;
      cur = { ...cur, intervals: v };
    } else {
      const v = coerceSetting('srs.scheduler', e.value);
      if (!v) continue;
      cur = { ...cur, scheduler: v };
      if (v === 'fsrs') tl.anyFsrs = true;
    }
    tl.keys.push({ hlc: e.hlc, id: e.id });
    tl.snaps.push(cur);
  }
  return tl;
}

/** SRS params in effect for an event: the last SRS setting strictly before it in (hlc, id) order. */
function snapAt(tl: Timeline, e: { hlc: string; id: string }): SrsSnapshot {
  let lo = 0;
  let hi = tl.keys.length; // first index with key >= e
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (compareEvents(tl.keys[mid]!, e) < 0) lo = mid + 1; else hi = mid;
  }
  return lo === 0 ? DEFAULT_SNAP : tl.snaps[lo - 1]!;
}

// ---------------------------------------------------------------- log scan

type SrsEvent = EventOf<'lesson.completed'> | EventOf<'review.answer'> | EventOf<'item.reset'>;

interface Scan {
  sorted: AppEvent[];
  byId: Map<string, AppEvent>;
  voided: Set<string>;
  timeline: Timeline;
  settings: AppSettings;
  notes: Map<string, string>;
  userAnswers: Map<string, string[]>;
  customItems: Map<ItemId, Item>;
  /** Live SRS events per (redirect-resolved) item id, in (hlc, id) order. */
  itemEvents: Map<ItemId, SrsEvent[]>;
  lastHlc: string;
}

/** Event ids that replay drops: voids (not of voids) and targets of live overrides (§6.1 step 1). */
function computeVoided(sorted: readonly AppEvent[], byId: Map<string, AppEvent>): Set<string> {
  const voided = new Set<string>();
  for (const e of sorted) {
    if (e.type !== 'event.void' || e.targetId === e.id) continue;
    if (byId.get(e.targetId)?.type === 'event.void') continue; // a void of a void is ignored
    voided.add(e.targetId);
  }
  // Overrides, latest first, so an override that is itself overridden/voided voids nothing.
  for (let i = sorted.length - 1; i >= 0; i--) {
    const e = sorted[i]!;
    if (e.type !== 'review.answer' || !e.overrides || voided.has(e.id) || e.overrides === e.id) continue;
    if (byId.get(e.overrides)?.type === 'event.void') continue;
    voided.add(e.overrides);
  }
  return voided;
}

/** The log in (hlc, id) order with duplicates, voided events and overridden answers removed. */
export function liveEvents(events: readonly AppEvent[]): AppEvent[] {
  const sorted = sortEvents(events);
  const byId = new Map<string, AppEvent>();
  for (const e of sorted) byId.set(e.id, e);
  const voided = computeVoided(sorted, byId);
  return sorted.filter((e) => !voided.has(e.id) && e.type !== 'event.void');
}

function scanLog(content: ContentBundle, events: readonly AppEvent[]): Scan {
  const sorted = sortEvents(events);
  const byId = new Map<string, AppEvent>();
  for (const e of sorted) byId.set(e.id, e);
  const voided = computeVoided(sorted, byId);
  const live = voided.size ? sorted.filter((e) => !voided.has(e.id)) : sorted;

  const settings = defaultAppSettings();
  const notes = new Map<string, string>();
  const answerRegs = new Map<string, Map<string, boolean>>();
  const customItems = new Map<ItemId, Item>();
  const itemEvents = new Map<ItemId, SrsEvent[]>();
  const R = content.idRedirects;
  const push = (id: ItemId, e: SrsEvent) => {
    const arr = itemEvents.get(id);
    if (arr) arr.push(e); else itemEvents.set(id, [e]);
  };

  for (const e of live) {
    switch (e.type) {
      case 'lesson.completed': case 'review.answer': case 'item.reset':
        push(resolveId(R, e.itemId), e);
        break;
      case 'settings.set': {
        const v = coerceAppSetting(e.key, e.value);
        // `inbox.dismissed` is a grow-only set (union of every write), not LWW: two devices that
        // dismiss different variants offline both keep their dismissals after a merge.
        if (v !== undefined && e.key === ('inbox.dismissed' as string)) {
          settings['inbox.dismissed'] = [...new Set([...settings['inbox.dismissed'], ...(v as string[])])];
        } else if (v !== undefined) (settings as unknown as Record<string, unknown>)[e.key] = v;
        break;
      }
      case 'note.set': {
        const k = noteKey(resolveId(R, e.itemId), e.field);
        if (e.text === '') notes.delete(k); else notes.set(k, e.text);
        break;
      }
      case 'userAnswer.add': case 'userAnswer.remove': {
        const k = userAnswerKey(resolveId(R, e.itemId), e.qtype);
        let reg = answerRegs.get(k);
        if (!reg) answerRegs.set(k, (reg = new Map()));
        reg.set(e.answer, e.type === 'userAnswer.add');
        break;
      }
      case 'customItem.upsert':
        customItems.set(e.item.id, e.item);
        break;
      case 'customItem.delete':
        customItems.delete(e.itemId);
        break;
      case 'event.void':
        break;
    }
  }

  const userAnswers = new Map<string, string[]>();
  for (const [k, reg] of answerRegs) {
    const list = [...reg].filter(([, present]) => present).map(([a]) => a);
    if (list.length) userAnswers.set(k, list);
  }

  return {
    sorted, byId, voided, timeline: buildTimeline(live), settings, notes, userAnswers, customItems, itemEvents,
    lastHlc: sorted.length ? sorted[sorted.length - 1]!.hlc : '',
  };
}

// ---------------------------------------------------------------- per-item replay (§6.1)

function newState(item: Item, at: number): ItemState {
  return {
    itemId: item.id, kind: item.kind, level: item.level,
    stage: 0, availableAt: null, lessonAt: at, pending: null,
    stats: { reviews: 0, correct: 0, incorrect: 0, streak: 0, selfGraded: 0, ignoredEarly: 0 },
    leechScore: 0, recentIncorrectAts: [],
  };
}

/** Replays one item's live SRS events. Returns undefined if the item never had a lesson. */
export function replayItem(item: Item, evs: readonly SrsEvent[], tl: Timeline): ItemState | undefined {
  let st: ItemState | undefined;
  const incorrectAts: number[] = [];
  const isHanja = item.kind === 'hanja';

  for (const e of evs) {
    if (e.type === 'lesson.completed') {
      if (st) continue; // duplicate lesson (e.g. two devices offline) is a no-op
      st = newState(item, e.at);
      if (!isHanja) { // hanja: lessonAt only, never staged or due (D12)
        st.stage = 1;
        st.availableAt = wkAvailableAt(1, e.at, snapAt(tl, e));
      }
      continue;
    }
    if (!st || isHanja) continue; // no lesson yet, or hanja: ignore
    if (e.type === 'item.reset') {
      st.stage = 1;
      st.availableAt = wkAvailableAt(1, e.at, snapAt(tl, e));
      st.pending = null;
      st.burnedAt = undefined;
      continue;
    }
    // review.answer
    const wrong = e.grade === 'incorrect';
    const due = st.availableAt !== null && e.at >= st.availableAt - DUENESS_GRACE_MS;
    if (!due) {
      st.stats.ignoredEarly++;
      if (wrong) { st.stats.incorrect++; st.stats.streak = 0; incorrectAts.push(e.at); }
      continue;
    }
    const p = (st.pending ??= { answered: [], incorrect: 0, since: e.at, closeAttempts: 0 });
    st.stats.lastAt = e.at;
    if (e.selfGraded) st.stats.selfGraded++;
    p.closeAttempts += e.check.closeAttempts;
    if (wrong) {
      p.incorrect++;
      st.stats.incorrect++;
      st.stats.streak = 0;
      incorrectAts.push(e.at);
    } else if (!p.answered.includes(e.qtype)) {
      p.answered.push(e.qtype);
    }
    const required: readonly QuestionType[] = e.requiredQTypes.length ? e.requiredQTypes : [e.qtype];
    if (!required.every((q) => p.answered.includes(q))) continue;

    const snap = snapAt(tl, e);
    const { scheduler } = getScheduler(snap.scheduler);
    const next = scheduler.next(st, { incorrect: p.incorrect, closeAttempts: p.closeAttempts, at: e.at }, { intervals: snap.intervals });
    st.stage = next.stage as Stage;
    st.availableAt = next.availableAt;
    st.stats.reviews++;
    if (p.incorrect === 0) { st.stats.correct++; st.stats.streak++; }
    if (st.passedAt === undefined && st.stage >= 5) st.passedAt = e.at;
    if (st.burnedAt === undefined && st.stage === 9) st.burnedAt = e.at;
    st.pending = null;
  }

  if (st && !isHanja) {
    const ref = Math.max(st.stats.lastAt ?? 0, incorrectAts.length ? incorrectAts[incorrectAts.length - 1]! : 0);
    st.recentIncorrectAts = incorrectAts.filter((t) => t > ref - LEECH_WINDOW_MS);
    st.leechScore = leechScore(st.recentIncorrectAts, st.stats.streak, ref);
  }
  return st;
}

// ---------------------------------------------------------------- public API

function assemble(scan: Scan, index: ContentIndex, items: Map<ItemId, ItemState>): DerivedState {
  const { userLevel, unlocked } = computeUnlocks(index, items);
  return {
    items, userLevel, unlocked,
    notes: scan.notes, settings: scan.settings, userAnswers: scan.userAnswers, customItems: scan.customItems,
    lastHlc: scan.lastHlc, index, flags: { fsrsFallback: scan.timeline.anyFsrs },
  };
}

function replayScan(content: ContentBundle, scan: Scan): DerivedState {
  const index = buildContentIndex(content, scan.customItems.values());
  const items = new Map<ItemId, ItemState>();
  for (const [id, evs] of scan.itemEvents) {
    const it = index.byId.get(id);
    if (!it) continue; // unknown item (deleted custom item, unsynced import…): keep events, skip state
    const st = replayItem(it, evs, scan.timeline);
    if (st) items.set(id, st);
  }
  return assemble(scan, index, items);
}

export function replayAll(content: ContentBundle, events: readonly AppEvent[]): DerivedState {
  return replayScan(content, scanLog(content, events));
}

/**
 * Incremental replay after `newEvents` were added to the log. `all` is the full log (including
 * `newEvents`). Only the items touched by `newEvents` are re-replayed; anything that changes
 * the content index or the SRS settings timeline triggers a full replay. Registers (notes,
 * settings, user answers) are recomputed in one linear pass.
 */
export function applyEvents(prev: DerivedState, content: ContentBundle, all: readonly AppEvent[],
                            newEvents: readonly AppEvent[]): { state: DerivedState; changed: ItemId[] } {
  const scan = scanLog(content, all);
  const R = content.idRedirects;
  let full = prev.index.contentVersion !== content.contentVersion || prev.index.redirects !== R;
  const changed = new Set<ItemId>();

  const touch = (e: AppEvent | undefined) => {
    if (!e) return;
    if (e.type === 'customItem.upsert' || e.type === 'customItem.delete'
      || (e.type === 'settings.set' && SRS_SETTING_KEYS.has(e.key))) { full = true; return; }
    const id = eventItemId(e);
    if (id !== undefined) changed.add(resolveId(R, id));
  };
  for (const e of newEvents) {
    touch(e);
    if (e.type === 'event.void') touch(scan.byId.get(e.targetId));
    if (e.type === 'review.answer' && e.overrides) touch(scan.byId.get(e.overrides));
  }

  if (full) {
    const state = replayScan(content, scan);
    const ids = new Set<ItemId>([...prev.items.keys(), ...state.items.keys()]);
    return { state, changed: [...ids].sort() };
  }

  const index = prev.index;
  const items = new Map(prev.items);
  for (const id of changed) {
    const it = index.byId.get(id);
    const evs = scan.itemEvents.get(id);
    const st = it && evs ? replayItem(it, evs, scan.timeline) : undefined;
    if (st) items.set(id, st); else items.delete(id);
  }
  return { state: assemble(scan, index, items), changed: [...changed].sort() };
}
