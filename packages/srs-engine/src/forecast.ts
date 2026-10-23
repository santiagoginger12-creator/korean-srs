// Dashboard forecast and stage counts.

import type { DerivedState } from './state.ts';
import { localDayBoundaries, type TzOffset } from './time.ts';
import { floorHour, HOUR } from './util.ts';

export interface ForecastBucket { t: number; count: number; cumulative: number }

/**
 * Upcoming reviews bucketed by hour (starting at the current UTC hour) or by local study day
 * (starting at the current day's `settings.dayStartHour` boundary in `tz`, D18). Overdue items
 * fall in the first bucket. `tz` is an addition to the §7.2 signature (the engine never reads
 * the system zone); it defaults to UTC.
 */
export function forecast(s: DerivedState, now: number, horizonH: 24 | 168, bucket: 'hour' | 'day',
                         tz?: TzOffset): ForecastBucket[] {
  let starts: number[];
  let end: number;
  if (bucket === 'hour') {
    const h0 = floorHour(now);
    starts = Array.from({ length: horizonH }, (_, i) => h0 + i * HOUR);
    end = h0 + horizonH * HOUR;
  } else {
    const b = localDayBoundaries(now, Math.ceil(horizonH / 24), tz, s.settings.dayStartHour);
    starts = b.slice(0, -1);
    end = b[b.length - 1]!;
  }
  const counts = new Array<number>(starts.length).fill(0);
  for (const st of s.items.values()) {
    if (st.kind === 'hanja' || st.stage < 1 || st.stage > 8 || st.availableAt === null) continue;
    const t = st.availableAt;
    if (t >= end) continue;
    let i = 0;
    // Binary search for the last bucket start ≤ t (overdue → 0).
    let lo = 0;
    let hi = starts.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (starts[mid]! <= t) { i = mid; lo = mid + 1; } else hi = mid - 1;
    }
    counts[i]!++;
  }
  let cum = 0;
  return starts.map((t, i) => {
    cum += counts[i]!;
    return { t, count: counts[i]!, cumulative: cum };
  });
}

export type StageGroup = 'apprentice' | 'guru' | 'master' | 'enlightened' | 'burned';

export function stageGroup(stage: number): StageGroup | null {
  if (stage >= 1 && stage <= 4) return 'apprentice';
  if (stage === 5 || stage === 6) return 'guru';
  if (stage === 7) return 'master';
  if (stage === 8) return 'enlightened';
  if (stage === 9) return 'burned';
  return null;
}

export function stageCounts(s: DerivedState): Record<StageGroup, number> {
  const out: Record<StageGroup, number> = { apprentice: 0, guru: 0, master: 0, enlightened: 0, burned: 0 };
  for (const st of s.items.values()) {
    if (st.kind === 'hanja') continue;
    const g = stageGroup(st.stage);
    if (g) out[g]++;
  }
  return out;
}
