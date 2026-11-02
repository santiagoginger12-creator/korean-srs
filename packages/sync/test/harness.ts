// Simulated devices for sync tests: an in-memory EventStore (what apps/web's IndexedDB adapter
// does), a settable wall clock, and a real HLC + event factory per device.
import type { ContentBundle } from '@ksrs/content';
import {
  canonicalJson, createEventFactory, createHlc, replayAll, sortEvents,
  type AppEvent, type DerivedState, type EventPayload, type HlcClock,
} from '@ksrs/srs-engine';
import { fnv1a, mulberry32 } from '../../srs-engine/src/util.ts';
import { syncOnce, type EventStore, type QuarantineItem, type SyncOptions, type SyncReport, type SyncStateEntry, type SyncTransport } from '../src/index.ts';
import { canon as canonRaw, FIXTURE } from '../../srs-engine/test/fixtures.ts';

export const T0 = Date.UTC(2026, 9, 26, 1, 0, 0); // Mon 2026-10-26 01:00Z (ISO 2026-W44)

export class MemStore implements EventStore {
  readonly events = new Map<string, AppEvent>();
  readonly pushed = new Set<string>();
  readonly quarantined: QuarantineItem[] = [];
  readonly state = new Map<string, SyncStateEntry>();
  /** Test hook: throw from markPushed once (a crash between the PUT and the bookkeeping). */
  failMarkPushed = false;
  constructor(readonly deviceId: string) {}
  async unpushed() { return [...this.events.values()].filter((e) => !this.pushed.has(e.id)); }
  async markPushed(ids: readonly string[]) {
    if (this.failMarkPushed) { this.failMarkPushed = false; throw new Error('crash before markPushed'); }
    for (const id of ids) this.pushed.add(id);
  }
  async ingest(evs: readonly AppEvent[]) {
    let added = 0;
    let conflicts = 0;
    for (const e of evs) {
      const mine = this.events.get(e.id);
      if (!mine) { this.events.set(e.id, e); added++; } else if (canonicalJson(mine) !== canonicalJson(e)) conflicts++;
      this.pushed.add(e.id);
    }
    return { added, conflicts };
  }
  async quarantine(items: readonly QuarantineItem[]) { this.quarantined.push(...items); }
  async getEvents(ids: readonly string[]) { return ids.map((id) => this.events.get(id)).filter((e): e is AppEvent => !!e); }
  async syncState() { return [...this.state.values()]; }
  async putSyncState(entries: readonly SyncStateEntry[]) { for (const s of entries) this.state.set(s.path, { ...s }); }
}

export class Device {
  t: number;
  readonly store: MemStore;
  readonly hlc: HlcClock;
  private mk: (p: EventPayload, at?: number) => AppEvent;
  constructor(readonly id: string, opts: { t0?: number; skewMs?: number; content?: ContentBundle } = {}) {
    this.t = (opts.t0 ?? T0) + (opts.skewMs ?? 0);
    this.store = new MemStore(id);
    this.hlc = createHlc(id, () => this.t);
    const rng = mulberry32(fnv1a(`dev:${id}`));
    this.mk = createEventFactory({ deviceId: id, hlc: this.hlc, clock: () => this.t, rng });
  }
  advance(ms: number): this { this.t += ms; return this; }
  emit(...payloads: EventPayload[]): AppEvent[] {
    const out = payloads.map((p) => this.mk(p));
    for (const e of out) this.store.events.set(e.id, e);
    return out;
  }
  log(): AppEvent[] { return sortEvents([...this.store.events.values()]); }
  derived(content: ContentBundle = FIXTURE): DerivedState { return replayAll(content, this.log()); }
  sync(transport: SyncTransport, opts: SyncOptions = {}): Promise<SyncReport> {
    return syncOnce(this.store, transport, { now: () => this.t, observe: (h) => this.hlc.observe(h) }, { deviceName: this.id, appVersion: 'test', ...opts });
  }
}

/** Canonical projection (engine fixture `canon`, re-canonicalised so key order never matters). */
export const canon = (s: DerivedState): string => canonicalJson(JSON.parse(canonRaw(s)));
export const ids = (d: Device): string => [...d.store.events.keys()].sort().join(',');
