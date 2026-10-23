// Convenience event factory for the app: wires HLC + UUIDv7 into `mkEvent` (SessionCtx).

import type { AppEvent, EventPayload } from './events.ts';
import type { HlcClock } from './hlc.ts';
import { uuidv7 } from './uuid7.ts';

export function createEventFactory(opts: { deviceId: string; hlc: HlcClock; clock: () => number; rng: () => number }):
  (payload: EventPayload, at?: number) => AppEvent {
  return (payload, at) => ({
    ...payload,
    id: uuidv7(opts.clock, opts.rng),
    v: 1,
    hlc: opts.hlc.now(),
    deviceId: opts.deviceId,
    at: at ?? opts.clock(),
  }) as AppEvent;
}
