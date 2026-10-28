// Dashboard view models (pure: time and tz are injected). Unit-tested in test/dashboard.test.ts.

import type { Item, ItemId, ItemKind } from '@ksrs/content';
import {
  forecast, grammarProgress, headword, isSeparatePath, LEVEL_THRESHOLD, levelProgress, stageCounts, vocabLevels, HOUR, MINUTE,
  type DerivedState, type LessonCapReport, type TzOffset,
} from '@ksrs/srs-engine';
import type { GrammarPlan, LessonPlan } from './lessons.ts';

const offsetAt = (tz: TzOffset, t: number): number => (typeof tz === 'number' ? tz : tz(t));
/** A Date whose UTC fields read as local wall-clock time in `tz`. */
const local = (t: number, tz: TzOffset): Date => new Date(t + offsetAt(tz, t) * MINUTE);
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface Bar {
  t: number;
  /** Axis label in local time ("14", "Tue"); empty when thinned out for narrow screens. */
  label: string;
  /** Full local description for titles / aria ("Tue 14:00", "Today"). */
  long: string;
  count: number;
  cumulative: number;
}

export interface ForecastView {
  hourly: Bar[];
  daily: Bar[];
  /** Due right now (overdue included), = the first hourly bucket's items available ≤ now. */
  dueNow: number;
  /** Reviews arriving in the next 24 h after "now" (excluding those already due). */
  next24h: number;
}

export function forecastView(s: DerivedState, now: number, tz: TzOffset, dueNow: number): ForecastView {
  const hourlyRaw = forecast(s, now, 24, 'hour', tz);
  const dailyRaw = forecast(s, now, 168, 'day', tz);
  const hourly = hourlyRaw.map((b, i): Bar => {
    const d = local(b.t, tz);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    return {
      t: b.t, count: b.count, cumulative: b.cumulative,
      // Every 6 local hours, but never crowding the 'now' label.
      label: i === 0 ? 'now' : i >= 3 && d.getUTCHours() % 6 === 0 ? hh : '',
      long: i === 0 ? `Now (${hh}:00 hour)` : `${WEEKDAYS[d.getUTCDay()]} ${hh}:00`,
    };
  });
  const daily = dailyRaw.map((b, i): Bar => {
    // Label the study day by the calendar date at its middle (robust to dayStartHour/DST).
    const d = local(b.t + 12 * HOUR, tz);
    const wd = WEEKDAYS[d.getUTCDay()]!;
    return {
      t: b.t, count: b.count, cumulative: b.cumulative,
      label: i === 0 ? 'Today' : wd,
      long: i === 0 ? `Today (${wd} ${d.getUTCMonth() + 1}/${d.getUTCDate()})` : `${wd} ${d.getUTCMonth() + 1}/${d.getUTCDate()}`,
    };
  });
  const total24 = hourly.length ? hourly[hourly.length - 1]!.cumulative : 0;
  return { hourly, daily, dueNow, next24h: Math.max(0, total24 - dueNow) };
}

/** Local "HH:MM" for a timestamp (dashboard copy). */
export function localTime(t: number, tz: TzOffset): string {
  const d = local(t, tz);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- level progress

export interface LevelKindRow { kind: Exclude<ItemKind, 'hanja'>; total: number; passed: number }
export interface LevelView {
  level: number;
  total: number;
  passed: number;
  /** passed / total in [0, 1] (1 for an empty level). */
  ratio: number;
  threshold: number;
  /** Additional gating items that must pass (reach Guru once) to unlock the next level. */
  needed: number;
  unlocksNext: boolean;
  isMaxLevel: boolean;
  byKind: LevelKindRow[];
  /** Gating items not yet passed, closest to Guru first (stage desc, then content order). */
  remaining: { id: ItemId; label: string; kind: Item['kind']; stage: number }[];
}

export function levelView(s: DerivedState, level = s.userLevel): LevelView {
  const p = levelProgress(s.index, s, level);
  const sep = isSeparatePath(s.settings);
  // With the separate grammar path, grammar has its own card and doesn't gate levels.
  const kinds: LevelKindRow['kind'][] = sep ? ['vocab', 'expression'] : ['vocab', 'grammar', 'expression'];
  const byKind = kinds.map((kind) => ({ kind, total: 0, passed: 0 }));
  const remaining: LevelView['remaining'] = [];
  for (const it of s.index.byLevel.get(level) ?? []) {
    if (it.kind === 'hanja' || !it.gating) continue;
    const row = byKind.find((r) => r.kind === it.kind);
    if (!row) continue;
    row.total++;
    const st = s.items.get(it.id);
    if (st?.passedAt !== undefined) row.passed++;
    else remaining.push({ id: it.id, label: headword(it), kind: it.kind, stage: st?.stage ?? 0 });
  }
  remaining.sort((a, b) => b.stage - a.stage || (s.index.order.get(a.id) ?? 0) - (s.index.order.get(b.id) ?? 0));
  // Same integer rule as the engine: passed * 10 >= total * 9.
  const neededTotal = Math.ceil((p.gatingTotal * 9) / 10);
  return {
    level, total: p.gatingTotal, passed: p.gatingPassed,
    ratio: p.gatingTotal ? p.gatingPassed / p.gatingTotal : 1,
    threshold: LEVEL_THRESHOLD,
    needed: Math.max(0, neededTotal - p.gatingPassed),
    unlocksNext: p.unlocksNext,
    isMaxLevel: level >= Math.max(0, ...vocabLevels(s.index, sep)),
    byKind: byKind.filter((r) => r.total > 0),
    remaining,
  };
}

// ---------------------------------------------------------------- grammar path

export interface GrammarCardView {
  /** False in combined mode (`grammar.separatePath: false`): no grammar card. */
  separate: boolean;
  /** Grammar lessons offered now (capped by today's allowance). */
  lessons: number;
  available: number;
  /** Today's grammar limit and how many were done. */
  limit: number;
  doneToday: number;
  /** Grammar items among the due reviews (reviews share one queue). */
  reviewsDue: number;
  /** The current (highest open) stage: 1-based position, its content level and gating progress. */
  stage: number;
  stageLevel: number | null;
  stageCount: number;
  total: number;
  passed: number;
  ratio: number;
  threshold: number;
  needed: number;
  unlocksNext: boolean;
  isLastStage: boolean;
}

export function grammarCardView(s: DerivedState, plan: GrammarPlan, due: readonly string[]): GrammarCardView {
  const gp = grammarProgress(s.index, s);
  const cur = gp.current;
  const total = cur?.gatingTotal ?? 0;
  const passed = cur?.gatingPassed ?? 0;
  return {
    separate: gp.separate,
    lessons: plan.queue.length, available: plan.available, limit: plan.limit, doneToday: plan.doneToday,
    reviewsDue: due.filter((id) => s.index.byId.get(id)?.kind === 'grammar').length,
    stage: cur?.stage ?? 0, stageLevel: cur?.level ?? null, stageCount: gp.stages.length,
    total, passed, ratio: total ? passed / total : 1, threshold: LEVEL_THRESHOLD,
    needed: Math.max(0, Math.ceil((total * 9) / 10) - passed),
    unlocksNext: cur?.unlocksNext ?? false,
    isLastStage: !cur || cur.stage >= gp.stages.length,
  };
}

/** "Today: 1 of 3 done" for the grammar card. */
export function grammarCapNote(g: Pick<GrammarCardView, 'limit' | 'doneToday' | 'available'>, clearReviewsFirst: boolean): string {
  if (clearReviewsFirst) return 'Clear reviews first';
  const head = `Today: ${g.doneToday} of ${g.limit} done`;
  return g.available > 0 ? head : `${head} · none unlocked`;
}

// ---------------------------------------------------------------- stages and load

export const STAGE_GROUPS = [
  { key: 'apprentice', label: 'Apprentice', ko: '견습' },
  { key: 'guru', label: 'Guru', ko: '숙련' },
  { key: 'master', label: 'Master', ko: '능숙' },
  { key: 'enlightened', label: 'Enlightened', ko: '통달' },
  { key: 'burned', label: 'Burned', ko: '완료' },
] as const;

export function stageView(s: DerivedState): { key: string; label: string; ko: string; count: number }[] {
  const c = stageCounts(s);
  return STAGE_GROUPS.map((g) => ({ ...g, count: c[g.key] }));
}

export interface CapView {
  /** Lessons allowed today in total (including those already done). */
  dailyCap: number;
  /** One-line explanation of where the cap comes from. */
  why: string;
  /** Estimated review minutes for today (due now + success-path arrivals before the next day boundary). */
  reviewMinToday: number;
  targetMin: number;
}

export function capView(r: LessonCapReport): CapView {
  const targetMin = Math.round(r.targetSec / 60);
  const reviewMinToday = Math.round((r.projectedDaySec[0] ?? r.dueLoadSec) / 60);
  // The day's limit itself (lessons already done count against it), before any "+5 anyway".
  const dailyCap = r.clearReviewsFirst ? 0 : Math.min(r.steadyCap, r.headroomCap, r.maxLessonsPerDay);
  let why: string;
  if (r.clearReviewsFirst) {
    why = `Clear reviews first: ${r.dueCount} due ≈ ${Math.round(r.dueLoadSec / 60)} min, over 1.5× your ${targetMin}-min target`;
  } else if (r.maxLessonsPerDay <= Math.min(r.steadyCap, r.headroomCap)) {
    why = 'Daily maximum';
  } else if (r.headroomCap < r.steadyCap) {
    why = `Keeps the busiest day this week under ≈${targetMin} min of reviews`;
  } else {
    why = `Keeps reviews ≈${targetMin} min/day long-term`;
  }
  return { dailyCap, why, reviewMinToday, targetMin };
}

/**
 * The lessons tile's one-line summary, e.g. "Today: 3 of 11 done · keeps reviews ≈45 min/day
 * long-term" or, after "+5 anyway", "Today: 25 of 35 done · 20 + 15 extra (daily maximum)".
 * The number shown as the limit is always what the queue actually enforces for the day.
 */
export function capNote(p: Pick<LessonPlan, 'baseLimit' | 'limit' | 'overrideExtra' | 'report'>): string {
  const done = p.report.lessonsDoneToday;
  const why = capView(p.report).why;
  const head = done > p.limit ? `Today: ${done} done (limit ${p.limit})` : `Today: ${done} of ${p.limit} done`;
  if (p.report.clearReviewsFirst) return p.overrideExtra ? `${head} · extra allowance` : head;
  const lower = why.charAt(0).toLowerCase() + why.slice(1);
  return p.overrideExtra ? `${head} · ${p.baseLimit} + ${p.overrideExtra} extra (${lower})` : `${head} · ${lower}`;
}

/** Level-up detection for the banner: compare userLevel before/after applying events (no events). */
export function detectLevelUp(before: number, after: number): { from: number; to: number } | null {
  return after > before ? { from: before, to: after } : null;
}

