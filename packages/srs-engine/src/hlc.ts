// Hybrid logical clock (§6, D4). Format: `${ms36.padStart(9,'0')}.${counter36.padStart(4,'0')}.${deviceId}`.
// Fixed-width base-36 fields make plain string comparison equal to (ms, counter, deviceId) order.

import type { HLC } from './events.ts';

const MAX_COUNTER = 36 ** 4 - 1;
const MAX_MS = 36 ** 9 - 1;

export interface ParsedHlc { ms: number; counter: number; deviceId: string }

export function formatHlc(ms: number, counter: number, deviceId: string): HLC {
  if (!Number.isInteger(ms) || ms < 0 || ms > MAX_MS) throw new Error(`hlc: ms out of range: ${ms}`);
  if (!Number.isInteger(counter) || counter < 0 || counter > MAX_COUNTER) throw new Error(`hlc: counter out of range: ${counter}`);
  return `${ms.toString(36).padStart(9, '0')}.${counter.toString(36).padStart(4, '0')}.${deviceId}`;
}

export function parseHlc(h: HLC): ParsedHlc {
  const a = h.indexOf('.');
  const b = h.indexOf('.', a + 1);
  if (a !== 9 || b !== 14) throw new Error(`hlc: malformed ${h}`);
  const ms = parseInt(h.slice(0, a), 36);
  const counter = parseInt(h.slice(a + 1, b), 36);
  if (!Number.isFinite(ms) || !Number.isFinite(counter)) throw new Error(`hlc: malformed ${h}`);
  return { ms, counter, deviceId: h.slice(b + 1) };
}

export interface HlcClock {
  /** Next timestamp for a local event; strictly greater than every HLC issued or observed. */
  now(): HLC;
  /** Advance past a remote HLC (call on ingest). */
  observe(remote: HLC): void;
  /** Last issued/observed state, for persisting across restarts. */
  last(): HLC;
}

/**
 * `last` (optional, an addition to the §7.2 signature) resumes from a persisted HLC so a
 * device whose wall clock went backwards still issues increasing timestamps.
 */
export function createHlc(deviceId: string, clock: () => number, last?: HLC): HlcClock {
  if (deviceId.length === 0) throw new Error('hlc: empty deviceId');
  let l = 0;
  let c = 0;
  if (last) { const p = parseHlc(last); l = p.ms; c = p.counter; }

  const bump = () => {
    if (c >= MAX_COUNTER) { l += 1; c = 0; } else c += 1;
  };

  return {
    now() {
      const pt = Math.floor(clock());
      if (pt > l) { l = pt; c = 0; } else bump();
      return formatHlc(l, c, deviceId);
    },
    observe(remote) {
      const r = parseHlc(remote);
      const pt = Math.floor(clock());
      const lOld = l;
      const nl = Math.max(lOld, r.ms, pt);
      if (nl === lOld && nl === r.ms) c = Math.max(c, r.counter);
      else if (nl === r.ms) c = r.counter;
      else if (nl !== lOld) c = 0;
      l = nl;
      // State is now ≥ remote; the next `now()` increments, so it sorts strictly after `remote`.
    },
    last() {
      return formatHlc(l, c, deviceId);
    },
  };
}
