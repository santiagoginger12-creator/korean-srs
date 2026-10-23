// Pure local-day arithmetic (D18: day rolls over at settings.dayStartHour, default 4:00,
// in the device's *current* timezone). The engine never reads the system zone: callers
// pass the offset (minutes east of UTC, e.g. Seoul = 540) or a function of UTC ms
// (so DST-aware callers can supply `t => -new Date(t).getTimezoneOffset()` from the app).

import { DAY, HOUR, MINUTE } from './util.ts';

export type TzOffset = number | ((utcMs: number) => number);

export function offsetAt(tz: TzOffset | undefined, t: number): number {
  if (tz === undefined) return 0;
  return typeof tz === 'number' ? tz : tz(t);
}

/** UTC ms at which the local "study day" containing `t` began. */
export function localDayStart(t: number, tz: TzOffset | undefined, dayStartHour = 4): number {
  const off = offsetAt(tz, t);
  const shift = dayStartHour * HOUR;
  const local = t + off * MINUTE;
  const startLocal = Math.floor((local - shift) / DAY) * DAY + shift;
  let guess = startLocal - off * MINUTE;
  const off2 = offsetAt(tz, guess);
  if (off2 !== off) guess = startLocal - off2 * MINUTE;
  // A DST jump can push the guess past t; never return a start after t.
  if (guess > t) guess -= DAY;
  return guess;
}

/** Start of the study day after the one starting at `dayStart` (handles 23h/25h days). */
export function nextLocalDayStart(dayStart: number, tz: TzOffset | undefined, dayStartHour = 4): number {
  return localDayStart(dayStart + 26 * HOUR, tz, dayStartHour);
}

/** `n + 1` consecutive day boundaries starting with the day containing `t`. */
export function localDayBoundaries(t: number, n: number, tz: TzOffset | undefined, dayStartHour = 4): number[] {
  const out = [localDayStart(t, tz, dayStartHour)];
  for (let i = 0; i < n; i++) out.push(nextLocalDayStart(out[i]!, tz, dayStartHour));
  return out;
}
