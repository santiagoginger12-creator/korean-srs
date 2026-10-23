// App store: wraps the event log, the derived (in-memory) projection and the active review
// session. React reads it through useSyncExternalStore (hooks.ts). All writes go through
// `commit`, which appends events + kv entries in one IndexedDB transaction, in order.

import type { ContentBundle, ItemId, QuestionType } from '@ksrs/content';
import {
  applyEvents, buildQuestions, createEventFactory, createHlc, dueItems, emptySession, replayAll, sessionReducer, sortEvents,
  type AppEvent, type DerivedState, type EventPayload, type HlcClock, type NoteField, type ReviewSession,
  type SessionAction, type SessionCtx, type SettingKey, type Settings, type StartItem,
} from '@ksrs/srs-engine';
import { KV, openAppDb, requestPersistence, type AppDb } from '../db/index.ts';
import { cryptoRng, now, randomDeviceId, tz } from './clock.ts';
import { grantOverride, type LessonOverride } from './lessons.ts';
import { reviveSession, toSnapshot } from './snapshot.ts';

export interface AppState {
  status: 'loading' | 'ready' | 'error';
  error?: string;
  content: ContentBundle | null;
  /** Full log, sorted by (hlc, id). */
  events: AppEvent[];
  derived: DerivedState | null;
  /** The active review session (persisted to kv on every change). */
  review: ReviewSession | null;
  lessonOverride: LessonOverride | undefined;
  /** Last persistence failure, shown as a banner. */
  persistError?: string;
  deviceId: string;
  /** Theme known before replay finishes (from the kv settings cache). */
  bootTheme: Settings['theme'];
}

type Listener = () => void;

export interface StoreDeps {
  openDb: () => Promise<AppDb>;
  fetchContent: () => Promise<ContentBundle>;
}

const contentUrl = (): string => new URL('content.bundle.json', document.baseURI).href;

const defaultDeps: StoreDeps = {
  openDb: () => openAppDb(),
  fetchContent: async () => {
    const res = await fetch(contentUrl(), { cache: 'no-cache' });
    if (!res.ok) throw new Error(`content.bundle.json: HTTP ${res.status}`);
    return (await res.json()) as ContentBundle;
  },
};

export class AppStore {
  private state: AppState = {
    status: 'loading', content: null, events: [], derived: null, review: null, lessonOverride: undefined,
    deviceId: '', bootTheme: 'system',
  };
  private listeners = new Set<Listener>();
  private db: AppDb | null = null;
  private hlc: HlcClock | null = null;
  private mk: ((p: EventPayload, at?: number) => AppEvent) | null = null;
  private writes: Promise<void> = Promise.resolve();
  readonly ctx: SessionCtx = { mkEvent: (p, at) => this.mkEvent(p, at) };

  constructor(private deps: StoreDeps = defaultDeps) {}

  getState = (): AppState => this.state;
  subscribe = (l: Listener): (() => void) => { this.listeners.add(l); return () => this.listeners.delete(l); };
  private set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  // ------------------------------------------------------------------ boot

  async init(): Promise<void> {
    try {
      const db = await this.deps.openDb();
      this.db = db;
      void requestPersistence();
      const cached = await db.kvGet<Partial<Settings>>(KV.settings);
      if (cached?.theme) this.set({ bootTheme: cached.theme });

      let deviceId = await db.kvGet<string>(KV.deviceId);
      if (!deviceId) { deviceId = randomDeviceId(); await db.kvSet({ [KV.deviceId]: deviceId }); }
      const lastHlc = await db.kvGet<string>(KV.hlc);
      const events = await db.allEvents();
      // Resume after the max of the persisted HLC and every HLC in the log (D4).
      const maxLogged = events.length ? events[events.length - 1]!.hlc : undefined;
      const resumeFrom = [lastHlc, maxLogged].filter((x): x is string => !!x).sort().pop();
      this.hlc = createHlc(deviceId, now, resumeFrom);
      this.mk = createEventFactory({ deviceId, hlc: this.hlc, clock: now, rng: cryptoRng });

      const content = await this.loadContent(db);
      const derived = replayAll(content, events);
      const lessonOverride = await db.kvGet<LessonOverride>(KV.lessonOverride);
      const review = reviveSession(await db.kvGet(KV.session), this.ctx, (id) => derived.index.byId.has(id));
      this.set({ status: 'ready', content, events, derived, review, lessonOverride, deviceId });
      void db.kvSet({ [KV.settings]: derived.settings });
    } catch (e) {
      this.set({ status: 'error', error: (e as Error).message ?? String(e) });
    }
  }

  private async loadContent(db: AppDb): Promise<ContentBundle> {
    const stored = await db.getContent();
    try {
      const fresh = await this.deps.fetchContent();
      if (!stored || stored.contentVersion !== fresh.contentVersion) await db.putContent(fresh);
      return fresh;
    } catch (e) {
      if (stored) return stored.bundle;
      throw new Error(`Content isn't available offline yet. Open the app once while online. (${(e as Error).message})`);
    }
  }

  // ------------------------------------------------------------------ writes

  private mkEvent(p: EventPayload, at?: number): AppEvent {
    if (!this.mk) throw new Error('store not initialised');
    return this.mk(p, at);
  }

  /** Applies events in memory immediately, then persists them (with kv entries) in order. */
  private commit(newEvents: AppEvent[], kv: Record<string, unknown> = {}, patch: Partial<AppState> = {}): Promise<void> {
    const { content, derived } = this.state;
    if (!content || !derived || !this.db || !this.hlc) throw new Error('store not ready');
    let events = this.state.events;
    let next = derived;
    if (newEvents.length) {
      const last = events[events.length - 1];
      const inOrder = newEvents.every((e, i) => (i === 0 ? !last || e.hlc > last.hlc : e.hlc > newEvents[i - 1]!.hlc));
      events = inOrder ? [...events, ...newEvents] : sortEvents([...events, ...newEvents]);
      next = applyEvents(derived, content, events, newEvents).state;
      kv = { ...kv, [KV.hlc]: this.hlc.last() };
      if (newEvents.some((e) => e.type === 'settings.set')) kv[KV.settings] = next.settings;
    }
    this.set({ ...patch, events, derived: next });
    const db = this.db;
    const p = this.writes.then(() => db.append(newEvents, kv));
    this.writes = p.catch((e: unknown) => {
      this.set({ persistError: `Couldn't save to this device's storage: ${(e as Error).message ?? e}` });
    });
    return this.writes;
  }

  /** Resolves when every queued write has committed (tests, page hide). */
  flush(): Promise<void> { return this.writes; }

  emit(payloads: EventPayload[], kv?: Record<string, unknown>): Promise<void> {
    const at = now();
    return this.commit(payloads.map((p) => this.mkEvent(p, at)), kv);
  }

  completeLessons(itemIds: ItemId[]): Promise<void> {
    return this.emit(itemIds.map((itemId) => ({ type: 'lesson.completed', itemId })));
  }

  setSetting<K extends SettingKey>(key: K, value: Settings[K]): Promise<void> {
    return this.emit([{ type: 'settings.set', key, value }]);
  }

  setNote(itemId: ItemId, field: NoteField, text: string): Promise<void> {
    return this.emit([{ type: 'note.set', itemId, field, text }]);
  }

  grantLessonOverride(): Promise<void> {
    const d = this.state.derived;
    if (!d || !this.db) return Promise.resolve();
    const lessonOverride = grantOverride(this.state.lessonOverride, now(), tz, d.settings.dayStartHour);
    return this.commit([], { [KV.lessonOverride]: lessonOverride }, { lessonOverride });
  }

  // ------------------------------------------------------------------ reviews

  startReview(): ReviewSession | null {
    const d = this.state.derived;
    if (!d) return null;
    if (this.state.review?.status === 'active') return this.state.review;
    const t = now();
    const items: StartItem[] = [];
    for (const id of dueItems(d, t)) {
      const it = d.index.byId.get(id);
      if (!it) continue;
      const instances = buildQuestions(it, d, d.settings.enabledQTypes, `review|${t}`);
      if (!instances.length) continue;
      const pending = d.items.get(id)?.pending;
      const si: StartItem = { itemId: id, instances };
      if (pending?.answered.length) si.alreadyCorrect = pending.answered.slice() as QuestionType[];
      items.push(si);
    }
    if (!items.length) return null;
    const { sess } = sessionReducer(emptySession(), { type: 'start', ctx: this.ctx, items, seed: `review|${t}` });
    void this.commit([], { [KV.session]: toSnapshot(sess, t) }, { review: sess });
    return sess;
  }

  reviewDispatch(action: SessionAction): void {
    const cur = this.state.review;
    if (!cur) return;
    const { sess, emit } = sessionReducer(cur, action);
    if (sess === cur && emit.length === 0) return;
    const snap = sess.status === 'active' ? toSnapshot(sess, now()) : undefined;
    void this.commit(emit, { [KV.session]: snap }, { review: sess });
  }

  endReview(): Promise<void> {
    return this.commit([], { [KV.session]: undefined }, { review: null });
  }

  // ------------------------------------------------------------------ maintenance

  /** "Rebuild from log": re-reads the log from IndexedDB and replays it from scratch. */
  async rebuild(): Promise<{ events: number; ms: number }> {
    const { content } = this.state;
    if (!content || !this.db) throw new Error('store not ready');
    await this.writes;
    const events = await this.db.allEvents();
    const t0 = performance.now();
    const derived = replayAll(content, events);
    const ms = performance.now() - t0;
    this.set({ events, derived });
    return { events: events.length, ms };
  }
}

export const store = new AppStore();
