// Lesson planning (§7.4): which lessons the home screen offers and what the next batch is.
// Pure (time and tz injected); unit-tested in test/lessons.test.ts.

import type { Item, ItemId } from '@ksrs/content';
import {
  availableLessons, dailyLessonCap, isSeparatePath, localDayStart,
  type AppEvent, type DerivedState, type LessonCapReport, type LessonPath, type TzOffset,
} from '@ksrs/srs-engine';

export const OVERRIDE_STEP = 5;

/** "+5 anyway" allowance, stored in kv and valid only for the study day it was granted. */
export interface LessonOverride { dayStart: number; extra: number }

export interface LessonPlan {
  /** Lessons the user may take now, in engine order (hanja are never capped). */
  queue: ItemId[];
  hanjaAvailable: number;
  /** Non-hanja lessons unlocked (before the cap). */
  otherAvailable: number;
  /** Non-hanja lessons still allowed now = max(0, limit − lessons done today). */
  allowance: number;
  /** The estimator's limit for the whole study day (0 in the backlog state), before overrides. */
  baseLimit: number;
  /** Total non-hanja lessons allowed today = baseLimit + overrideExtra. */
  limit: number;
  overrideExtra: number;
  report: LessonCapReport;
}

export function overrideExtraFor(o: LessonOverride | undefined, dayStart: number): number {
  return o && o.dayStart === dayStart ? o.extra : 0;
}

/** Whether grammar runs on its own path (`grammar.separatePath`, default true). */
export const separateGrammar = (s: DerivedState): boolean => isSeparatePath(s.settings);

/**
 * The vocab path's plan (combined mode: every lesson). With the separate grammar path, grammar
 * lessons are planned by `planGrammarLessons` instead and never appear here.
 */
export function planLessons(s: DerivedState, events: readonly AppEvent[], now: number, tz: TzOffset,
                            override: LessonOverride | undefined, report = dailyLessonCap(s, events, now, s.settings, tz)): LessonPlan {
  const dayStart = localDayStart(now, tz, s.settings.dayStartHour);
  const overrideExtra = overrideExtraFor(override, dayStart);
  // The override extends the day's total limit. (Adding it to the remaining cap instead let the
  // extra be reused forever once lessons done exceeded the cap, since the cap clamps at 0.)
  const baseLimit = report.clearReviewsFirst ? 0 : Math.min(report.steadyCap, report.headroomCap, report.maxLessonsPerDay);
  const limit = baseLimit + overrideExtra;
  const allowance = Math.max(0, limit - report.lessonsDoneToday);
  const all = availableLessons(s.index, s, separateGrammar(s) ? { path: 'vocab' } : {});
  const queue: ItemId[] = [];
  let hanjaAvailable = 0;
  let otherAvailable = 0;
  let others = 0;
  for (const id of all) {
    const it = s.index.byId.get(id);
    if (!it) continue;
    if (it.kind === 'hanja') { hanjaAvailable++; queue.push(id); continue; }
    otherAvailable++;
    if (others < allowance) { queue.push(id); others++; }
  }
  return { queue, hanjaAvailable, otherAvailable, allowance, baseLimit, limit, overrideExtra, report };
}

/**
 * "+5 anyway": always yields exactly OVERRIDE_STEP more lessons from now. If lessons done today
 * already exceed the limit (the backlog state, or a headroom cap that shrank), the extra first
 * catches up to what was done, so the press is never swallowed. Pass the current plan for that.
 */
export function grantOverride(prev: LessonOverride | undefined, now: number, tz: TzOffset, dayStartHour: number,
                              plan?: Pick<LessonPlan, 'baseLimit' | 'report'>): LessonOverride {
  const dayStart = localDayStart(now, tz, dayStartHour);
  const cur = overrideExtraFor(prev, dayStart);
  const overDone = plan ? plan.report.lessonsDoneToday - plan.baseLimit : 0;
  return { dayStart, extra: Math.max(cur, overDone) + OVERRIDE_STEP };
}

export interface GrammarPlan {
  /** Grammar lessons the user may take now (content order), at most `allowance`. */
  queue: ItemId[];
  /** Unlocked grammar lessons not yet taken (before the allowance). */
  available: number;
  /** Grammar lessons still allowed now = report.grammar.cap. */
  allowance: number;
  /** Today's grammar limit (allowance setting, capped by the budget). */
  limit: number;
  doneToday: number;
  report: LessonCapReport;
}

/** The grammar path's plan: its own queue and daily allowance inside the shared review budget. */
export function planGrammarLessons(s: DerivedState, events: readonly AppEvent[], now: number, tz: TzOffset,
                                   report = dailyLessonCap(s, events, now, s.settings, tz)): GrammarPlan {
  const all = separateGrammar(s) ? availableLessons(s.index, s, { path: 'grammar' }) : [];
  const g = report.grammar;
  return { queue: all.slice(0, g.cap), available: all.length, allowance: g.cap, limit: g.limit, doneToday: g.doneToday, report };
}

/** Both plans from one estimator run. */
export function planAll(s: DerivedState, events: readonly AppEvent[], now: number, tz: TzOffset,
                        override: LessonOverride | undefined): { vocab: LessonPlan; grammar: GrammarPlan } {
  const report = dailyLessonCap(s, events, now, s.settings, tz);
  return { vocab: planLessons(s, events, now, tz, override, report), grammar: planGrammarLessons(s, events, now, tz, report) };
}

/** The plan for a lesson route: `grammar` → the grammar queue, else the vocab (or combined) queue. */
export function queueFor(path: LessonPath, s: DerivedState, events: readonly AppEvent[], now: number, tz: TzOffset,
                         override: LessonOverride | undefined): Pick<LessonPlan, 'queue'> {
  return path === 'grammar' && separateGrammar(s) ? planGrammarLessons(s, events, now, tz) : planLessons(s, events, now, tz, override);
}

export function nextBatch(plan: Pick<LessonPlan, 'queue'>, s: DerivedState): Item[] {
  return plan.queue.slice(0, Math.max(1, s.settings.lessonBatch))
    .map((id) => s.index.byId.get(id))
    .filter((x): x is Item => x !== undefined);
}
