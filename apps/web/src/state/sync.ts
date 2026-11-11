// GitHub sync controller (M6, §11). Owns the device-local sync settings (kv `sync`) and the
// token (secrets), decides when to sync, and runs @ksrs/sync's syncOnce against the store.
//
// When: after the app's first paint, after a review or lesson session ends, when the tab
// becomes visible again, and from the button. Never while a review/lesson/practice session is
// on screen (deferred until it ends), never blocking the UI, one at a time (single-flight in
// this tab, navigator.locks across tabs). Disabled → nothing runs. On the claude.ai page
// (artifact target, D59) sync is unavailable: its CSP blocks api.github.com.

import { githubTransport, parseRepo, syncOnce, testConnection, type FetchLike, type GithubTransport, type SyncReport } from '@ksrs/sync';
import { SECRET_GITHUB_TOKEN, KV } from '../db/index.ts';
import {
  coerceSyncConfig, defaultSyncConfig, describeSyncError, MIN_AUTO_INTERVAL_MS, SKEW_WARN_MS, syncSummary,
  type SyncConfig, type SyncProblem,
} from '../data/sync.ts';
import { isArtifact } from '../host.ts';
import { parseRoute } from '../router.ts';
import { now } from './clock.ts';
import { APP_VERSION, store, type AppStore } from './store.ts';

export type SyncTrigger = 'open' | 'session' | 'visible' | 'button' | 'enable';

export interface SyncUiState {
  ready: boolean;
  available: boolean;
  config: SyncConfig;
  hasToken: boolean;
  /** Last 4 characters of the saved token, to tell tokens apart. */
  tokenHint: string;
  running: boolean;
  /** Short status line. */
  status: string;
  /** Current failure (banner), cleared by the next success. */
  problem: SyncProblem | null;
  /** Banner closed for this page load. */
  bannerDismissed: boolean;
  skewMs: number | undefined;
}

type Listener = () => void;

const SESSION_ROUTES = new Set(['reviews', 'lessons', 'practice', 'ghosts']);

export class SyncController {
  private state: SyncUiState = {
    ready: false, available: !isArtifact, config: defaultSyncConfig(), hasToken: false, tokenHint: '', running: false,
    status: '', problem: null, bannerDismissed: false, skewMs: undefined,
  };
  private listeners = new Set<Listener>();
  private inflight: Promise<void> | null = null;
  private pending = false;
  private lastAuto = 0;
  private started = false;

  constructor(private app: AppStore = store, private fetchImpl: FetchLike = (u, i) => fetch(u, i)) {}

  getState = (): SyncUiState => this.state;
  subscribe = (l: Listener): (() => void) => { this.listeners.add(l); return () => this.listeners.delete(l); };
  private set(p: Partial<SyncUiState>): void { this.state = { ...this.state, ...p }; for (const l of this.listeners) l(); }

  /** Wires the triggers once the store is ready. Safe to call more than once. */
  start(): void {
    if (this.started) return;
    this.started = true;
    const boot = async () => {
      await this.load();
      if (!this.state.available) return;
      // App open: after the first paint, off the critical path.
      const kick = () => void this.trigger('open');
      const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void };
      requestAnimationFrame(() => { if (w.requestIdleCallback) w.requestIdleCallback(kick, { timeout: 2000 }); else setTimeout(kick, 300); });
      this.app.onSessionEnd(() => { setTimeout(() => void this.trigger('session'), 0); });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void this.trigger('visible'); });
      // A sync deferred during a session runs once the session screen is left.
      window.addEventListener('hashchange', () => { if (this.pending && !this.busy()) { this.pending = false; void this.trigger('session'); } });
    };
    const ready = () => this.app.getState().status === 'ready';
    if (ready()) void boot();
    else { const un = this.app.subscribe(() => { if (ready()) { un(); void boot(); } }); }
  }

  private async load(): Promise<void> {
    const config = coerceSyncConfig(await this.app.kvGet(KV.sync));
    const token = await this.app.getSecret(SECRET_GITHUB_TOKEN);
    const problem = config.enabled && config.lastError ? { code: config.lastError.code, message: config.lastError.message, fix: this.fixFor(config.lastError.code, config) } : null;
    this.set({
      ready: true, config, hasToken: !!token, tokenHint: token ? token.slice(-4) : '', problem,
      status: !this.state.available ? 'Not available on this page.' : config.enabled ? statusFor(config) : 'Off.',
    });
  }

  private fixFor(code: string, config: SyncConfig): string {
    return describeSyncError(Object.assign(new Error(code), { name: 'SyncError', code }), config.repo).fix;
  }

  private async saveConfig(patch: Partial<SyncConfig>): Promise<SyncConfig> {
    const config = { ...this.state.config, ...patch };
    for (const k of Object.keys(patch) as (keyof SyncConfig)[]) if (patch[k] === undefined) delete config[k];
    this.set({ config });
    await this.app.kvSet({ [KV.sync]: config });
    return config;
  }

  /** A review/lesson/practice session is on screen or active. */
  busy(): boolean {
    if (this.app.getState().review?.status === 'active' || this.app.getState().drillActive) return true;
    return SESSION_ROUTES.has(parseRoute(location.hash).name);
  }

  // ------------------------------------------------------------------ settings

  async setRepo(input: string): Promise<string | null> {
    const parsed = parseRepo(input);
    if (!parsed) return 'Enter the repository as owner/name, e.g. santiagoginger12-creator/ksrs-data.';
    const repo = `${parsed.owner}/${parsed.repo}`;
    if (repo === this.state.config.repo) return null;
    await this.app.resetSyncState(); // another repo: re-read everything, re-check every event
    await this.saveConfig({ repo, lastSyncAt: undefined, lastSummary: undefined, lastError: undefined });
    this.set({ problem: null, status: this.state.config.enabled ? 'Repository changed. Sync to upload this device\'s history.' : 'Off.' });
    return null;
  }

  async saveToken(token: string): Promise<string | null> {
    const t = token.trim();
    if (!t) return 'Paste the token first.';
    if (/\s/.test(t) || t.length < 20) return 'That doesn\'t look like a GitHub token (they start with github_pat_).';
    await this.app.setSecret(SECRET_GITHUB_TOKEN, t);
    this.set({ hasToken: true, tokenHint: t.slice(-4), problem: null, bannerDismissed: false });
    if (this.state.config.lastError) await this.saveConfig({ lastError: undefined });
    return null;
  }

  async removeToken(): Promise<void> {
    await this.app.setSecret(SECRET_GITHUB_TOKEN, undefined);
    await this.saveConfig({ enabled: false, lastError: undefined });
    this.set({ hasToken: false, tokenHint: '', problem: null, status: 'Off. Token removed from this device.' });
  }

  async setExpiry(date: string): Promise<void> {
    await this.saveConfig({ tokenExpiry: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined });
  }

  async setEnabled(on: boolean): Promise<void> {
    if (on && !this.state.hasToken) { this.set({ status: 'Save a token first.' }); return; }
    await this.saveConfig({ enabled: on, lastError: on ? this.state.config.lastError : undefined });
    if (!on) { this.pending = false; this.set({ problem: null, status: 'Off. This device won\'t sync until you turn it back on.' }); return; }
    this.set({ status: 'On.' });
    void this.trigger('enable');
  }

  dismissBanner(): void { this.set({ bannerDismissed: true }); }

  // ------------------------------------------------------------------ running

  private async transport(): Promise<GithubTransport> {
    const token = await this.app.getSecret(SECRET_GITHUB_TOKEN);
    if (!token) throw new Error('no-token');
    const r = parseRepo(this.state.config.repo);
    if (!r) throw new Error(`bad repository name "${this.state.config.repo}"`);
    return githubTransport({ owner: r.owner, repo: r.repo, token, fetch: (u, i) => this.fetchImpl(u, i), now });
  }

  /** Read access + write this device's file. Doesn't need sync to be on. */
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    if (!this.state.available) return { ok: false, message: 'Not available on this page.' };
    try {
      const tr = await this.transport();
      const info = await tr.repoInfo();
      const r = await testConnection(this.app.syncStore(), tr, { now }, { deviceName: this.app.getState().deviceName, appVersion: APP_VERSION });
      const others = r.devices.filter((d) => d !== this.app.getState().deviceId).length;
      const warn = info.private ? '' : ' Warning: this repository is PUBLIC, so anyone can read your review history. Make it private on GitHub.';
      const message = `Connected to ${info.fullName}${info.private ? ' (private)' : ''}. Read and write OK; ${others === 0 ? 'no other devices have synced yet' : `${others} other device${others === 1 ? ' has' : 's have'} synced`}.${warn}`;
      this.set({ status: message, problem: null });
      return { ok: true, message };
    } catch (e) {
      const p = describeSyncError(e, this.state.config.repo);
      this.set({ status: p.fix });
      return { ok: false, message: p.fix };
    }
  }

  /** Runs a sync if allowed; resolves when it (or the one already running) finishes. */
  trigger(reason: SyncTrigger): Promise<void> {
    const s = this.state;
    if (!s.available || !s.ready || !s.config.enabled) return Promise.resolve();
    if (this.inflight) return this.inflight;
    if (reason !== 'button' && reason !== 'enable' && this.busy()) { this.pending = true; return Promise.resolve(); }
    if (reason === 'visible' && now() - this.lastAuto < MIN_AUTO_INTERVAL_MS) return Promise.resolve();
    this.lastAuto = now();
    const run = () => this.run();
    const locks = (navigator as unknown as { locks?: { request(n: string, o: { ifAvailable: boolean }, cb: (lock: unknown) => Promise<void>): Promise<void> } }).locks;
    const p = (locks
      ? locks.request('ksrs-sync', { ifAvailable: true }, async (lock) => { if (lock) await run(); else this.set({ status: 'Another tab is syncing…' }); })
      : run())
      .catch(() => { /* reported in state */ })
      .finally(() => { this.inflight = null; });
    this.inflight = p;
    return p;
  }

  private async run(): Promise<void> {
    this.set({ running: true, status: 'Syncing…' });
    try {
      const tr = await this.transport();
      const report: SyncReport = await syncOnce(this.app.syncStore(), tr, { now, observe: (h) => this.app.observeHlc(h) }, {
        deviceName: this.app.getState().deviceName, appVersion: APP_VERSION,
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      });
      await this.app.flush();
      const summary = syncSummary(report);
      const config = await this.saveConfig({ lastSyncAt: report.finishedAt, lastSummary: summary, lastError: undefined });
      const skew = report.skewMs !== undefined && Math.abs(report.skewMs) > SKEW_WARN_MS ? report.skewMs : undefined;
      this.set({ running: false, problem: null, bannerDismissed: false, skewMs: skew, status: statusFor(config) });
    } catch (e) {
      const p = describeSyncError(e, this.state.config.repo);
      // Only still-enabled syncs report (Disable during a run means "stop", not "fail").
      if (this.state.config.enabled) await this.saveConfig({ lastError: { code: p.code, message: p.message, at: now() } });
      this.set({ running: false, problem: this.state.config.enabled ? p : null, bannerDismissed: false, status: p.fix });
      throw e;
    }
  }
}

function statusFor(c: SyncConfig): string {
  if (!c.enabled) return 'Off.';
  if (c.lastError) return describeSyncError(Object.assign(new Error(c.lastError.message), { name: 'SyncError', code: c.lastError.code }), c.repo).fix;
  return c.lastSummary ? `Synced: ${c.lastSummary}` : 'On. Not synced yet.';
}

export const sync = new SyncController();
