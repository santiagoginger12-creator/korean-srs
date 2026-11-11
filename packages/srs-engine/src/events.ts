// Event log format (ARCHITECTURE.md §6). FROZEN AT M1: any change needs a version bump,
// an upcaster in `upcastEvent`, and a DECISIONS.md entry.

import type { Item, ItemId, QuestionType } from '@ksrs/content';
import { DAY, HOUR } from './util.ts';

/** `${ms36.padStart(9,'0')}.${counter36.padStart(4,'0')}.${deviceId}`, lexicographically sortable. */
export type HLC = string;

export const EVENT_VERSION = 1 as const;

export interface EventBase {
  id: string; /* UUIDv7 */
  v: 1;
  type: string;
  hlc: HLC;
  deviceId: string;
  at: number; /* wall ms */
}

export type EventPayload =
  | { type: 'lesson.completed'; itemId: ItemId } // includes hanja
  | {
      type: 'review.answer'; itemId: ItemId; qtype: QuestionType; promptId?: string;
      response: string; grade: 'correct' | 'incorrect';
      check: { layer: string; closeAttempts: number; matched?: string };
      requiredQTypes: QuestionType[]; durationMs: number;
      selfGraded?: true; overrides?: string; /* event id it replaces */
    }
  | { type: 'event.void'; targetId: string; reason: 'undo' }
  | { type: 'item.reset'; itemId: ItemId; toStage: 1 } // leech reset or resurrect burned
  | { type: 'note.set'; itemId: ItemId; field: NoteField; text: string }
  | { type: 'userAnswer.add' | 'userAnswer.remove'; itemId: ItemId; qtype: QuestionType; answer: string }
  | { type: 'settings.set'; key: SettingKey; value: unknown }
  | { type: 'customItem.upsert'; item: Item } // user, CSV, and KRDict items
  | { type: 'customItem.delete'; itemId: ItemId }
  // Anki-style drill (D78–D80). Added after M1 with no version bump: an older app's validator
  // rejects these as "unknown type", so sync and restore quarantine them (kept, never dropped)
  // and they move into the log once that device updates (AppStore.resolveQuarantine).
  | { type: 'drill.review'; cardId: DrillCardId; rating: 1 | 2 | 3 | 4; durationMs?: number }
  | { type: 'drill.undo'; targetId: string } // voids one drill.review or drill.known
  | { type: 'drill.known'; cardIds: DrillCardId[]; reason?: string } // placement / "I already know this"
  | { type: 'drill.reset'; cardIds?: DrillCardId[] }; // back to new; no cardIds = the whole drill

/** `<wordId>:f` (Korean → English) or `<wordId>:r` (English → Korean). */
export type DrillCardId = string;
export const DRILL_CARD_RE = /^[A-Za-z0-9_-]{1,40}:[fr]$/;
export const DRILL_MAX_CARDS_PER_EVENT = 30_000;

export type AppEvent = EventBase & EventPayload;
export type EventType = EventPayload['type'];
export type EventOf<T extends EventType> = AppEvent & { type: T };
export type NoteField = 'meaning' | 'usage' | 'mnemonic';

// ---------------------------------------------------------------- settings

export const QUESTION_TYPES: readonly QuestionType[] = ['meaning', 'production', 'cloze', 'nuance', 'register'];

export interface Settings {
  /** ms intervals applied on *reaching* stage s = 1..8. Time-indexed (§6, D6). */
  'srs.intervals': number[];
  /** Time-indexed. 'fsrs' currently falls back to 'wk' (D19) and sets `flags.fsrsFallback`. */
  'srs.scheduler': 'wk' | 'fsrs';
  lessonBatch: number;
  maxLessonsPerDay: number;
  targetReviewMin: number;
  dayStartHour: number;
  enabledQTypes: QuestionType[];
  theme: 'system' | 'light' | 'dark';
  ttsRate: number;
  ttsAutoplay: boolean;
}
export type SettingKey = keyof Settings;
export const SRS_SETTING_KEYS: ReadonlySet<string> = new Set<SettingKey>(['srs.intervals', 'srs.scheduler']);

export const DEFAULT_INTERVALS: readonly number[] = Object.freeze([
  4 * HOUR, 8 * HOUR, DAY, 2 * DAY, 7 * DAY, 14 * DAY, 30 * DAY, 120 * DAY,
]);

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  'srs.intervals': DEFAULT_INTERVALS.slice(),
  'srs.scheduler': 'wk',
  lessonBatch: 5,
  maxLessonsPerDay: 20,
  targetReviewMin: 45,
  dayStartHour: 4,
  enabledQTypes: QUESTION_TYPES.slice(),
  theme: 'system',
  ttsRate: 1,
  ttsAutoplay: false,
} satisfies Settings);

export function defaultSettings(): Settings {
  return {
    ...DEFAULT_SETTINGS,
    'srs.intervals': DEFAULT_SETTINGS['srs.intervals'].slice(),
    enabledQTypes: DEFAULT_SETTINGS.enabledQTypes.slice(),
  };
}

const isInt = (x: unknown, lo: number, hi: number): x is number =>
  typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;
const isNum = (x: unknown, lo: number, hi: number): x is number =>
  typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;

/**
 * Returns the value if it is valid for `key`, else `undefined`. Replay ignores invalid or
 * unknown settings rather than failing, so a newer app's settings never break an older one.
 */
export function coerceSetting<K extends SettingKey>(key: K, value: unknown): Settings[K] | undefined;
export function coerceSetting(key: string, value: unknown): unknown {
  switch (key) {
    case 'srs.intervals':
      return Array.isArray(value) && value.length === 8 && value.every((x) => isNum(x, 1, 100 * 365 * DAY))
        ? (value as number[]).slice() : undefined;
    case 'srs.scheduler':
      return value === 'wk' || value === 'fsrs' ? value : undefined;
    case 'lessonBatch': return isInt(value, 1, 50) ? value : undefined;
    case 'maxLessonsPerDay': return isInt(value, 0, 500) ? value : undefined;
    case 'targetReviewMin': return isNum(value, 1, 1440) ? value : undefined;
    case 'dayStartHour': return isInt(value, 0, 23) ? value : undefined;
    case 'enabledQTypes':
      return Array.isArray(value) && value.length > 0 && value.every((q) => QUESTION_TYPES.includes(q as QuestionType))
        ? [...new Set(value as QuestionType[])] : undefined;
    case 'theme': return value === 'system' || value === 'light' || value === 'dark' ? value : undefined;
    case 'ttsRate': return isNum(value, 0.25, 4) ? value : undefined;
    case 'ttsAutoplay': return typeof value === 'boolean' ? value : undefined;
    default: return undefined;
  }
}

// ---------------------------------------------------------------- ordering

/** Total order `(hlc, id)` (§6). */
export function compareEvents(a: { hlc: string; id: string }, b: { hlc: string; id: string }): number {
  if (a.hlc !== b.hlc) return a.hlc < b.hlc ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/** Sorted by `(hlc, id)`, duplicates by id removed (first in order wins). Does not mutate. */
export function sortEvents<E extends { hlc: string; id: string }>(events: readonly E[]): E[] {
  const sorted = events.slice().sort(compareEvents);
  const out: E[] = [];
  let prevId: string | undefined;
  const seen = new Set<string>();
  for (const e of sorted) {
    if (e.id === prevId || seen.has(e.id)) continue;
    seen.add(e.id);
    prevId = e.id;
    out.push(e);
  }
  return out;
}

/** Set union by event id, sorted by `(hlc, id)`. Commutative, associative, idempotent. */
export function unionEvents<E extends { hlc: string; id: string }>(...logs: readonly (readonly E[])[]): E[] {
  return sortEvents(logs.flat());
}

// ---------------------------------------------------------------- validation

export type ValidationResult = { ok: true; event: AppEvent } | { ok: false; error: string };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isNonEmptyStr = (x: unknown): x is string => typeof x === 'string' && x.length > 0;
const isQType = (x: unknown): x is QuestionType => QUESTION_TYPES.includes(x as QuestionType);
const HLC_RE = /^[0-9a-z]{9}\.[0-9a-z]{4}\..+$/;
const isCardList = (x: unknown, allowEmpty: boolean): x is string[] => Array.isArray(x) && (allowEmpty || x.length > 0)
  && x.length <= DRILL_MAX_CARDS_PER_EVENT && x.every((c) => isStr(c) && DRILL_CARD_RE.test(c));
const ITEM_KINDS = new Set(['vocab', 'grammar', 'expression', 'hanja']);

/**
 * Structural validator for a single v1 event (used on sync ingest and backup restore).
 * `lookup` (optional) resolves other events by id so that a void of a void, or an override
 * of a non-answer, can be rejected. Replay independently ignores those cases, so it stays
 * correct even if an unvalidated log reaches it.
 */
export function validateEvent(raw: unknown, lookup?: (id: string) => AppEvent | undefined): ValidationResult {
  const fail = (error: string): ValidationResult => ({ ok: false, error });
  if (!isObj(raw)) return fail('not an object');
  if (raw.v !== 1) return fail(`unsupported version ${String(raw.v)}`);
  if (!isNonEmptyStr(raw.id)) return fail('missing id');
  if (!isStr(raw.hlc) || !HLC_RE.test(raw.hlc)) return fail('bad hlc');
  if (!isNonEmptyStr(raw.deviceId)) return fail('missing deviceId');
  if (typeof raw.at !== 'number' || !Number.isFinite(raw.at)) return fail('bad at');
  const needItem = (): string | null => (isNonEmptyStr(raw.itemId) ? null : 'missing itemId');
  let err: string | null = null;
  switch (raw.type) {
    case 'lesson.completed':
      err = needItem();
      break;
    case 'review.answer': {
      err = needItem();
      if (err) break;
      if (!isQType(raw.qtype)) { err = 'bad qtype'; break; }
      if (raw.promptId !== undefined && !isStr(raw.promptId)) { err = 'bad promptId'; break; }
      if (!isStr(raw.response)) { err = 'missing response'; break; }
      if (raw.grade !== 'correct' && raw.grade !== 'incorrect') { err = 'bad grade'; break; }
      const c = raw.check;
      if (!isObj(c) || !isStr(c.layer) || !isInt(c.closeAttempts, 0, 1e6) || (c.matched !== undefined && !isStr(c.matched))) {
        err = 'bad check'; break;
      }
      if (!Array.isArray(raw.requiredQTypes) || raw.requiredQTypes.length === 0 || !raw.requiredQTypes.every(isQType)) {
        err = 'bad requiredQTypes'; break;
      }
      if (typeof raw.durationMs !== 'number' || !Number.isFinite(raw.durationMs) || raw.durationMs < 0) { err = 'bad durationMs'; break; }
      if (raw.selfGraded !== undefined && raw.selfGraded !== true) { err = 'bad selfGraded'; break; }
      if (raw.overrides !== undefined) {
        if (!isNonEmptyStr(raw.overrides)) { err = 'bad overrides'; break; }
        if (raw.overrides === raw.id) { err = 'override of itself'; break; }
        if (raw.grade !== 'correct' || raw.selfGraded !== true) { err = 'override must be a self-graded correct answer'; break; }
        const t = lookup?.(raw.overrides);
        if (t && t.type !== 'review.answer') { err = 'override target is not an answer'; break; }
      }
      break;
    }
    case 'event.void': {
      if (!isNonEmptyStr(raw.targetId)) { err = 'missing targetId'; break; }
      if (raw.targetId === raw.id) { err = 'void of itself'; break; }
      if (raw.reason !== 'undo') { err = 'bad reason'; break; }
      const t = lookup?.(raw.targetId);
      if (t && t.type === 'event.void') err = 'void of a void';
      break;
    }
    case 'item.reset':
      err = needItem() ?? (raw.toStage === 1 ? null : 'bad toStage');
      break;
    case 'note.set':
      err = needItem() ?? (raw.field === 'meaning' || raw.field === 'usage' || raw.field === 'mnemonic' ? null : 'bad field')
        ?? (isStr(raw.text) ? null : 'missing text');
      break;
    case 'userAnswer.add':
    case 'userAnswer.remove':
      err = needItem() ?? (isQType(raw.qtype) ? null : 'bad qtype') ?? (isNonEmptyStr(raw.answer) ? null : 'missing answer');
      break;
    case 'settings.set':
      // Any non-empty key is structurally valid (forward compatible); replay ignores unknown keys.
      err = isNonEmptyStr(raw.key) ? ('value' in raw ? null : 'missing value') : 'missing key';
      break;
    case 'customItem.upsert': {
      const it = raw.item;
      err = isObj(it) && isNonEmptyStr(it.id) && ITEM_KINDS.has(it.kind as string) && isInt(it.level, 1, 1000)
        ? null : 'bad item';
      break;
    }
    case 'customItem.delete':
      err = needItem();
      break;
    case 'drill.review':
      if (!isStr(raw.cardId) || !DRILL_CARD_RE.test(raw.cardId)) err = 'bad cardId';
      else if (!isInt(raw.rating, 1, 4)) err = 'bad rating';
      else if (raw.durationMs !== undefined && (typeof raw.durationMs !== 'number' || !Number.isFinite(raw.durationMs) || raw.durationMs < 0)) err = 'bad durationMs';
      break;
    case 'drill.undo': {
      if (!isNonEmptyStr(raw.targetId)) { err = 'missing targetId'; break; }
      if (raw.targetId === raw.id) { err = 'undo of itself'; break; }
      const t = lookup?.(raw.targetId);
      if (t && t.type !== 'drill.review' && t.type !== 'drill.known') err = 'undo target is not a drill answer';
      break;
    }
    case 'drill.known':
      err = isCardList(raw.cardIds, false) ? (raw.reason === undefined || (isStr(raw.reason) && raw.reason.length <= 64) ? null : 'bad reason') : 'bad cardIds';
      break;
    case 'drill.reset':
      err = raw.cardIds === undefined || isCardList(raw.cardIds, true) ? null : 'bad cardIds';
      break;
    default:
      err = `unknown type ${String(raw.type)}`;
  }
  return err ? fail(err) : { ok: true, event: raw as unknown as AppEvent };
}

/** Rejects a void of a void (and other cross-event rules) across a whole batch. */
export function validateLog(raws: readonly unknown[]): { valid: AppEvent[]; invalid: { raw: unknown; error: string }[] } {
  const byId = new Map<string, AppEvent>();
  for (const r of raws) if (isObj(r) && isStr(r.id)) byId.set(r.id, r as unknown as AppEvent);
  const valid: AppEvent[] = [];
  const invalid: { raw: unknown; error: string }[] = [];
  for (const r of raws) {
    const res = validateEvent(r, (id) => byId.get(id));
    if (res.ok) valid.push(res.event);
    else invalid.push({ raw: r, error: res.error });
  }
  return { valid, invalid };
}

export interface UnknownFutureVersion { unknownFutureVersion: true; raw: unknown }

/**
 * Version dispatch: v1 is identity; anything newer is returned as `unknownFutureVersion` (to be
 * quarantined, never dropped). Throws on input without a usable `v`. Upcasting does not
 * validate; callers run `validateEvent` on the result.
 */
export function upcastEvent(raw: unknown): AppEvent | UnknownFutureVersion {
  if (!isObj(raw) || typeof raw.v !== 'number' || !Number.isInteger(raw.v) || raw.v < 1) {
    throw new Error('upcastEvent: not a versioned event');
  }
  if (raw.v === 1) return raw as unknown as AppEvent;
  return { unknownFutureVersion: true, raw };
}

export function isUnknownFutureVersion(x: AppEvent | UnknownFutureVersion): x is UnknownFutureVersion {
  return (x as UnknownFutureVersion).unknownFutureVersion === true;
}

/** The item an event concerns (before id redirects), if any. */
export function eventItemId(e: AppEvent): ItemId | undefined {
  switch (e.type) {
    case 'lesson.completed': case 'review.answer': case 'item.reset': case 'note.set':
    case 'userAnswer.add': case 'userAnswer.remove': case 'customItem.delete':
      return e.itemId;
    case 'customItem.upsert':
      return e.item.id;
    default:
      return undefined;
  }
}
