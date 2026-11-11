// App store: wraps the event log, the derived (in-memory) projection and the active review
// session. React reads it through useSyncExternalStore (hooks.ts). All writes go through
// `commit`, which appends events + kv entries in one IndexedDB transaction, in order.

import type { ContentBundle, ItemId, QuestionType } from '@ksrs/content';
import {
  applyDrillEvents, isDrillRelevant, replayDrill, type DrillState, type Rating,
  applyEvents, buildQuestions, canonicalJson, pruneGhostDone, createEventFactory, createHlc, dueItems, emptySession, isUnknownFutureVersion, makeBackup, replayAll, serializeBackup, sessionReducer, settingPayload, sortEvents, upcastEvent, validateEvent,
  type AppSettingKey, type AppSettings,
  type AppEvent, type DerivedState, type EventPayload, type HlcClock, type NoteField, type ReviewSession,
  type SessionAction, type SessionCtx, type SettingKey, type Settings, type StartItem,
} from '@ksrs/srs-engine';
import type { EventStore, QuarantineItem } from '@ksrs/sync';
import { KV, openAppDb, requestPersistence, type AppDb, type QuarantineEntry } from '../db/index.ts';
import { backupFilename, encodeBackup, quarantineKey } from '../data/backup.ts';
import { cryptoRng, now, randomDeviceId, tz } from './clock.ts';
import { detectLevelUp } from './dashboard.ts';
import { grantOverride, planLessons, type LessonOverride } from './lessons.ts';
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
  /** Set when applying events raised userLevel (no event is stored for it); cleared on dismiss. */
  levelUp: { from: number; to: number } | null;
  /** Editable label for this device (kv; shown in manual sync, used in backup file names). */
  deviceName: string;
  lastBackupAt: number | undefined;
  /** navigator.storage.persist() outcome: true/false, or null when unsupported. */
  persisted: boolean | null;
  quarantineCount: number;
  /** Ghost-review slots finished on this device (kv only; ghosts never write events). */
  ghostsDone: string[];
  /** Anki-style drill projection (D80), derived from the drill events in the same log. */
  drill: DrillState;
  /** A drill session is on screen (sync waits, like for reviews). */
  drillActive: boolean;
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
    deviceId: '', bootTheme: 'system', levelUp: null, deviceName: '', lastBackupAt: undefined, persisted: null,
    quarantineCount: 0, ghostsDone: [], drill: replayDrill([]), drillActive: false,
  };
  private listeners = new Set<Listener>();
  private db: AppDb | null = null;
  private hlc: HlcClock | null = null;
  private mk: ((p: EventPayload, at?: number) => AppEvent) | null = null;
  private writes: Promise<void> = Promise.resolve();
  private sessionEndListeners = new Set<() => void>();
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
      void requestPersistence().then((persisted) => this.set({ persisted }));
      const cached = await db.kvGet<Partial<Settings>>(KV.settings);
      if (cached?.theme) this.set({ bootTheme: cached.theme });

      let deviceId = await db.kvGet<string>(KV.deviceId);
      if (!deviceId) { deviceId = randomDeviceId(); await db.kvSet({ [KV.deviceId]: deviceId }); }
      const lastHlc = await db.kvGet<string>(KV.hlc);
      await this.resolveQuarantine(db);
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
      const deviceName = (await db.kvGet<string>(KV.deviceName)) ?? defaultDeviceName(deviceId);
      const lastBackupAt = await db.kvGet<number>(KV.lastBackupAt);
      const quarantineCount = (await db.quarantineAll()).length;
      const storedGhosts = await db.kvGet<string[]>(KV.ghostsDone);
      const ghostsDone = Array.isArray(storedGhosts) ? pruneGhostDone(derived.index, events, now(), storedGhosts.filter((k) => typeof k === 'string')) : [];
      const drill = replayDrill(events);
      this.set({ status: 'ready', content, events, derived, review, lessonOverride, deviceId, deviceName, lastBackupAt, quarantineCount, ghostsDone, drill });
      void db.kvSet({ [KV.settings]: derived.settings });
    } catch (e) {
      this.set({ status: 'error', error: (e as Error).message ?? String(e) });
    }
  }

  /**
   * Quarantined events that this version of the app can read (it was updated since they
   * arrived) move into the log; the rest stay quarantined. Never drops anything.
   */
  private async resolveQuarantine(db: AppDb): Promise<void> {
    const q = await db.quarantineAll();
    if (!q.length) return;
    const ready: AppEvent[] = [];
    const keys: string[] = [];
    // Never let a quarantined copy overwrite an event already in the log (e.g. a conflicting
    // duplicate from a damaged file): the log copy wins and the other stays quarantined.
    const have = new Set((await db.allEvents()).map((e) => e.id));
    for (const entry of q) {
      try {
        const up = upcastEvent(entry.raw);
        if (isUnknownFutureVersion(up)) continue;
        const r = validateEvent(up);
        if (r.ok && !have.has(r.event.id)) { ready.push(r.event); keys.push(entry.key); have.add(r.event.id); }
      } catch { /* still unreadable: keep it */ }
    }
    if (ready.length) await db.quarantineResolve(ready, keys);
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
      const up = detectLevelUp(derived.userLevel, next.userLevel);
      if (up) patch = { ...patch, levelUp: { from: this.state.levelUp?.from ?? up.from, to: up.to } };
      const drill = nextDrill(this.state.drill, events, newEvents);
      if (drill !== this.state.drill) patch = { ...patch, drill };
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
    return this.emit(itemIds.map((itemId) => ({ type: 'lesson.completed', itemId }))).then(() => this.sessionEnded());
  }

  /** Called after a review or lesson session ends (sync trigger, §11.3). */
  onSessionEnd(cb: () => void): () => void { this.sessionEndListeners.add(cb); return () => this.sessionEndListeners.delete(cb); }
  private sessionEnded(): void { for (const l of this.sessionEndListeners) { try { l(); } catch { /* a listener never breaks the app */ } } }

  setSetting<K extends SettingKey>(key: K, value: Settings[K]): Promise<void> {
    return this.emit([{ type: 'settings.set', key, value }]);
  }

  /** settings.set for the M5 AppSettings keys (inbox.dismissed, tts.*). */
  setAppSetting<K extends AppSettingKey>(key: K, value: AppSettings[K]): Promise<void> {
    return this.emit([settingPayload(key, value)]);
  }

  setNote(itemId: ItemId, field: NoteField, text: string): Promise<void> {
    return this.emit([{ type: 'note.set', itemId, field, text }]);
  }

  grantLessonOverride(): Promise<void> {
    const d = this.state.derived;
    if (!d || !this.db) return Promise.resolve();
    const t = now();
    const plan = planLessons(d, this.state.events, t, tz, this.state.lessonOverride);
    const lessonOverride = grantOverride(this.state.lessonOverride, t, tz, d.settings.dayStartHour, plan);
    return this.commit([], { [KV.lessonOverride]: lessonOverride }, { lessonOverride });
  }

  dismissLevelUp(): void { this.set({ levelUp: null }); }

  /** Marks ghost slots as practised on this device (kv only; no events, D22/§6 untouched). */
  completeGhosts(keys: readonly string[]): Promise<void> {
    const cur = new Set(this.state.ghostsDone);
    if (keys.every((k) => cur.has(k))) return this.writes;
    for (const k of keys) cur.add(k);
    const ghostsDone = [...cur].sort();
    return this.commit([], { [KV.ghostsDone]: ghostsDone }, { ghostsDone });
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
    return this.commit([], { [KV.session]: undefined }, { review: null }).then(() => this.sessionEnded());
  }

  // ------------------------------------------------------------------ drill (D78–D84)

  /** Appends one event now and returns its id (used for the drill's undo stack). */
  private emitOne(payload: EventPayload): string {
    const e = this.mkEvent(payload, now());
    void this.commit([e]);
    return e.id;
  }

  drillAnswer(cardId: string, rating: Rating, durationMs: number): string {
    return this.emitOne({ type: 'drill.review', cardId, rating, durationMs: Math.max(0, Math.round(durationMs)) });
  }

  drillUndo(targetId: string): string {
    return this.emitOne({ type: 'drill.undo', targetId });
  }

  /** Marks cards known (placement or "I already know this"). Large lists go in chunks of 30,000. */
  drillKnown(cardIds: readonly string[], reason: string): string[] {
    const ids: string[] = [];
    for (let i = 0; i < cardIds.length; i += DRILL_CHUNK) ids.push(this.emitOne({ type: 'drill.known', cardIds: cardIds.slice(i, i + DRILL_CHUNK), reason }));
    return ids;
  }

  drillReset(cardIds?: string[]): string {
    return this.emitOne(cardIds ? { type: 'drill.reset', cardIds } : { type: 'drill.reset' });
  }

  setDrillActive(drillActive: boolean): void {
    if (this.state.drillActive !== drillActive) this.set({ drillActive });
  }

  /** A drill session ended (sync trigger, like a review session). */
  drillSessionEnded(): Promise<void> {
    this.setDrillActive(false);
    return this.writes.then(() => this.sessionEnded());
  }

  // ------------------------------------------------------------------ data (M5)

  async setDeviceName(name: string): Promise<void> {
    const deviceName = name.trim().slice(0, 40) || defaultDeviceName(this.state.deviceId);
    this.set({ deviceName });
    await this.db?.kvSet({ [KV.deviceName]: deviceName });
  }

  /** Full log as a checksummed backup (§12); records the time in kv. Secrets are never included. */
  async exportBackup(gzip: boolean): Promise<{ blob: Blob; filename: string; events: number }> {
    const { content, deviceId, deviceName } = this.state;
    if (!content || !this.db) throw new Error('store not ready');
    await this.writes;
    const t = now();
    const events = await this.db.allEvents();
    // Quarantined (future-version/malformed) events go into the backup too, so restoring it
    // elsewhere, even with Replace, never loses them (§12: kept, never dropped).
    const quarantined = (await this.db.quarantineAll()).map((q) => q.raw);
    const backup = makeBackup(events, { createdAt: new Date(t).toISOString(), appVersion: APP_VERSION, contentVersion: content.contentVersion, deviceId }, quarantined);
    const blob = await encodeBackup(serializeBackup(backup), gzip);
    await this.db.kvSet({ [KV.lastBackupAt]: t });
    this.set({ lastBackupAt: t });
    return { blob, filename: backupFilename(t, deviceName, gzip), events: events.length };
  }

  /**
   * Restore or manual sync. Merge = union by id (default); Replace = wipe local and take the
   * backup's log. Quarantined (future-version/malformed) events are stored, never dropped.
   */
  async restore(incoming: AppEvent[], quarantine: { raw: unknown; reason: string }[], mode: 'merge' | 'replace', source: string): Promise<{ added: number }> {
    const { content } = this.state;
    if (!content || !this.db || !this.hlc) throw new Error('store not ready');
    await this.writes;
    // QA: Replace must never turn a device with history into an empty one (e.g. a backup whose
    // events are all from a newer app, so all quarantined). Checked before anything is written.
    if (mode === 'replace' && incoming.length === 0 && (await this.db.allEvents()).length > 0) {
      throw new Error('this backup has no events this app can apply, so Replace would erase this device\'s history. Nothing was changed');
    }
    const t = now();
    if (quarantine.length) {
      await this.db.quarantineAdd(quarantine.map((q) => ({ key: quarantineKey(q.raw, q.reason), raw: q.raw, reason: q.reason, source, at: t })));
    }
    // Local HLC must move past everything we ingest (D4).
    for (const e of incoming) this.hlc.observe(e.hlc);
    const local = await this.db.allEvents();
    let events: AppEvent[];
    let added: number;
    let review = this.state.review;
    if (mode === 'replace') {
      events = sortEvents(incoming);
      added = events.length;
      await this.db.replaceEvents(events, { [KV.hlc]: this.hlc.last(), [KV.session]: undefined, [KV.lessonOverride]: undefined });
      review = null;
    } else {
      const have = new Set(local.map((e) => e.id));
      const fresh = incoming.filter((e) => !have.has(e.id));
      added = fresh.length;
      await this.db.append(fresh, { [KV.hlc]: this.hlc.last() });
      events = sortEvents([...local, ...fresh]);
    }
    const derived = replayAll(content, events);
    const settingsKv = { [KV.settings]: derived.settings };
    void this.db.kvSet(settingsKv);
    const quarantineCount = (await this.db.quarantineAll()).length;
    this.set({ events, derived, review, quarantineCount, drill: replayDrill(events), lessonOverride: mode === 'replace' ? undefined : this.state.lessonOverride });
    return { added };
  }

  listQuarantine(): Promise<QuarantineEntry[]> { return this.db ? this.db.quarantineAll() : Promise.resolve([]); }
  getSecret(key: string): Promise<string | undefined> { return this.db ? this.db.secretGet(key) : Promise.resolve(undefined); }
  setSecret(key: string, value: string | undefined): Promise<void> { return this.db ? this.db.secretSet(key, value) : Promise.resolve(); }

  // ------------------------------------------------------------------ GitHub sync (M6)

  /**
   * Remote events from @ksrs/sync: union by id (an id already here keeps the local copy, D58),
   * applied in memory at once, then persisted in order with the other writes. Everything passed
   * in is on the remote, so it is marked pushed too.
   */
  ingestRemote(incoming: readonly AppEvent[]): Promise<{ added: number; conflicts: number }> {
    const { content, derived } = this.state;
    const db = this.db;
    if (!content || !derived || !db || !this.hlc) return Promise.reject(new Error('store not ready'));
    const have = new Map(this.state.events.map((e) => [e.id, e] as const));
    const fresh: AppEvent[] = [];
    const known: string[] = [];
    let conflicts = 0;
    for (const e of incoming) {
      this.hlc.observe(e.hlc);
      const mine = have.get(e.id);
      if (!mine) { fresh.push(e); have.set(e.id, e); continue; }
      known.push(e.id);
      if (mine !== e && canonicalJson(mine) !== canonicalJson(e)) conflicts++;
    }
    const kv: Record<string, unknown> = { [KV.hlc]: this.hlc.last() };
    if (fresh.length) {
      const events = sortEvents([...this.state.events, ...fresh]);
      // A large first pull replays once; small ones only re-replay the touched items.
      const next = fresh.length > 2000 ? replayAll(content, events) : applyEvents(derived, content, events, fresh).state;
      const up = detectLevelUp(derived.userLevel, next.userLevel);
      const patch: Partial<AppState> = { events, derived: next };
      const drill = nextDrill(this.state.drill, events, fresh);
      if (drill !== this.state.drill) patch.drill = drill;
      if (up) patch.levelUp = { from: this.state.levelUp?.from ?? up.from, to: up.to };
      if (fresh.some((e) => e.type === 'settings.set')) kv[KV.settings] = next.settings;
      this.set(patch);
    }
    const p = this.writes.then(async () => {
      await db.appendRemote(fresh, kv);
      if (known.length) await db.markPushed(known);
    });
    this.writes = p.catch((e: unknown) => {
      this.set({ persistError: `Couldn't save synced data to this device's storage: ${(e as Error).message ?? e}` });
    });
    return p.then(() => ({ added: fresh.length, conflicts }));
  }

  /** The EventStore adapter @ksrs/sync runs against (§4 rule 3: sync never touches IndexedDB). */
  syncStore(): EventStore {
    const db = this.db;
    if (!db || !this.state.deviceId) throw new Error('store not ready');
    return {
      deviceId: this.state.deviceId,
      unpushed: async () => {
        await this.writes;
        const pushed = new Set(await db.pushedIds());
        return this.state.events.filter((e) => !pushed.has(e.id));
      },
      markPushed: (ids) => db.markPushed(ids),
      ingest: (events) => this.ingestRemote(events),
      quarantine: async (items: readonly QuarantineItem[]) => {
        const t = now();
        await db.quarantineAdd(items.map((q) => ({ key: quarantineKey(q.raw, q.reason), raw: q.raw, reason: q.reason, source: q.source, at: t })));
        this.set({ quarantineCount: (await db.quarantineAll()).length });
      },
      getEvents: async (ids) => {
        const want = new Set(ids);
        return want.size ? this.state.events.filter((e) => want.has(e.id)) : [];
      },
      syncState: () => db.syncStateAll(),
      putSyncState: (entries) => db.syncStatePut(entries),
    };
  }

  /** Device-local kv (never synced or backed up), e.g. the sync settings. */
  kvGet<T>(key: string): Promise<T | undefined> { return this.db ? this.db.kvGet<T>(key) : Promise.resolve(undefined); }
  kvSet(entries: Record<string, unknown>): Promise<void> { return this.db ? this.db.kvSet(entries) : Promise.resolve(); }

  /** Advance the HLC past a remote timestamp (D4); persisted with the next write. */
  observeHlc(h: string): void { this.hlc?.observe(h); }

  /** Forget sync bookkeeping (new repo): every remote file is re-read and every event re-checked. */
  resetSyncState(): Promise<void> { return this.db ? this.db.syncReset() : Promise.resolve(); }

  // ------------------------------------------------------------------ maintenance

  /** "Rebuild from log": re-reads the log from IndexedDB and replays it from scratch. */
  async rebuild(): Promise<{ events: number; ms: number }> {
    const { content } = this.state;
    if (!content || !this.db) throw new Error('store not ready');
    await this.writes;
    const events = await this.db.allEvents();
    const t0 = performance.now();
    const derived = replayAll(content, events);
    const drill = replayDrill(events);
    const ms = performance.now() - t0;
    this.set({ events, derived, drill });
    return { events: events.length, ms };
  }
}

const DRILL_CHUNK = 30_000;

/** The drill projection after `fresh` joined the log `events` (incremental when possible). */
function nextDrill(prev: DrillState, events: readonly AppEvent[], fresh: readonly AppEvent[]): DrillState {
  if (!fresh.some(isDrillRelevant)) return prev;
  return applyDrillEvents(prev, fresh) ?? replayDrill(events);
}

declare const __BUILD_ID__: string;
/** Build identifier (build.ts); differs per deploy, which is what triggers the update prompt. */
export const APP_VERSION = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
export const defaultDeviceName = (deviceId: string): string => `Device ${deviceId.slice(0, 4)}`;

export const store = new AppStore();
