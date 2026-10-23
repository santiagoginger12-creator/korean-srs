// The ONLY module that reads the wall clock or the crypto RNG (§4: everything else gets
// them injected). Playwright fakes time with `page.clock`, which patches Date itself, so no
// test hook is needed here.

import type { TzOffset } from '@ksrs/srs-engine';

export const now = (): number => Date.now();

/** Uniform [0, 1) from the crypto RNG (UUIDv7 random bits). */
export function cryptoRng(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0]! / 4294967296;
}

export function randomDeviceId(): string {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Minutes east of UTC at `t` in the device's current zone (D18; DST-aware). */
export const tz: TzOffset = (t: number) => -new Date(t).getTimezoneOffset();
