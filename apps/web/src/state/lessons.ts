// Lesson planning (§7.4): which lessons the home screen offers and what the next batch is.
// Pure (time and tz injected); unit-tested in test/lessons.test.ts.

import type { Item, ItemId } from '@ksrs/content';
import {
  availableLessons, dailyLessonCap, localDayStart,
  type AppEvent, type DerivedState, type LessonCapReport, type TzOffset,
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
  /** Non-hanja lessons allowed today = cap + override extra. */
  allowance: number;
  overrideExtra: number;
  report: LessonCapReport;
}

export function overrideExtraFor(o: LessonOverride | undefined, dayStart: number): number {
  return o && o.dayStart === dayStart ? o.extra : 0;
}

export function planLessons(s: DerivedState, events: readonly AppEvent[], now: number, tz: TzOffset,
                            override: LessonOverride | undefined): LessonPlan {
  const report = dailyLessonCap(s, events, now, s.settings, tz);
  const dayStart = localDayStart(now, tz, s.settings.dayStartHour);
  const overrideExtra = overrideExtraFor(override, dayStart);
  const allowance = report.cap + overrideExtra;
  const all = availableLessons(s.index, s);
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
  return { queue, hanjaAvailable, otherAvailable, allowance, overrideExtra, report };
}

export function grantOverride(prev: LessonOverride | undefined, now: number, tz: TzOffset, dayStartHour: number): LessonOverride {
  const dayStart = localDayStart(now, tz, dayStartHour);
  return { dayStart, extra: overrideExtraFor(prev, dayStart) + OVERRIDE_STEP };
}

export function nextBatch(plan: LessonPlan, s: DerivedState): Item[] {
  return plan.queue.slice(0, Math.max(1, s.settings.lessonBatch))
    .map((id) => s.index.byId.get(id))
    .filter((x): x is Item => x !== undefined);
}
