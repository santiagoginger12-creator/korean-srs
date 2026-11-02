// GitHub sync (M6): pure helpers for the Sync screen and banners. No DOM, no storage.
import { DAY } from '@ksrs/srs-engine';
import { isSyncError, parseRepo } from '@ksrs/sync';

export const DEFAULT_SYNC_REPO = 'santiagoginger12-creator/ksrs-data';
/** Show the token-expiry reminder this many days ahead (§11.1). */
export const EXPIRY_REMINDER_DAYS = 14;
/** Automatic (visibility) syncs no closer together than this. */
export const MIN_AUTO_INTERVAL_MS = 15_000;

/** Device-local sync settings (kv, never synced or exported). The token is in `secrets`. */
export interface SyncConfig {
  repo: string;
  enabled: boolean;
  /** Token expiry date as entered (YYYY-MM-DD), optional. */
  tokenExpiry?: string;
  lastSyncAt?: number;
  /** One-line summary of the last successful sync. */
  lastSummary?: string;
  lastError?: { code: string; message: string; at: number };
}

export const defaultSyncConfig = (): SyncConfig => ({ repo: DEFAULT_SYNC_REPO, enabled: false });

export function coerceSyncConfig(raw: unknown): SyncConfig {
  const d = defaultSyncConfig();
  if (typeof raw !== 'object' || raw === null) return d;
  const r = raw as Record<string, unknown>;
  const out: SyncConfig = {
    repo: typeof r.repo === 'string' && r.repo.trim() ? r.repo.trim() : d.repo,
    enabled: r.enabled === true,
  };
  if (typeof r.tokenExpiry === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.tokenExpiry)) out.tokenExpiry = r.tokenExpiry;
  if (typeof r.lastSyncAt === 'number') out.lastSyncAt = r.lastSyncAt;
  if (typeof r.lastSummary === 'string') out.lastSummary = r.lastSummary;
  const e = r.lastError as Record<string, unknown> | undefined;
  if (e && typeof e.code === 'string' && typeof e.message === 'string' && typeof e.at === 'number') out.lastError = { code: e.code, message: e.message, at: e.at };
  return out;
}

export { parseRepo };

/**
 * Calendar days until the token's expiry date (0 = expires today), when the reminder should
 * show: within EXPIRY_REMINDER_DAYS, or already expired. Null otherwise or with no date.
 */
export function expiryReminder(expiry: string | undefined, now: number): { days: number; expired: boolean } | null {
  if (!expiry) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiry);
  if (!m) return null;
  const end = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  const n = new Date(now);
  const today = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  if (!Number.isFinite(end)) return null;
  const days = Math.round((end - today) / DAY);
  if (days < 0) return { days: 0, expired: true };
  return days <= EXPIRY_REMINDER_DAYS ? { days, expired: false } : null;
}

/** "in 3 days", "tomorrow", "today". */
export const expiresIn = (days: number): string => (days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`);

export interface SyncProblem { code: string; message: string; fix: string }

/** Plain-English wording for a failed sync (banner + status line). */
export function describeSyncError(e: unknown, repo: string): SyncProblem {
  if (!isSyncError(e)) {
    const message = e instanceof Error ? e.message : String(e);
    if (message === 'no-token') return { code: 'no-token', message, fix: 'No GitHub token on this device — paste one in Settings → Sync.' };
    return { code: 'unknown', message, fix: `Sync failed (${message}). It will try again next time.` };
  }
  const fix = ((): string => {
    switch (e.code) {
      case 'bad-token': return 'Token expired or revoked — paste a new one in Settings → Sync.';
      case 'no-access': return `This token can't write to ${repo}. Make a fine-grained token for only that repo with Contents: Read and write, and paste it in Settings → Sync.`;
      case 'repo-missing': return `Repository ${repo} wasn't found. Check the name in Settings → Sync, and that the token was given access to it.`;
      case 'rate-limited': return `GitHub's rate limit was reached. Sync will try again${e.resetAt ? ` after ${new Date(e.resetAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ' later'}.`;
      case 'network': return 'Couldn\'t reach GitHub (offline?). Sync will try again when you\'re back online.';
      case 'server': return 'GitHub is having trouble right now. Sync will try again later.';
      case 'conflict': return 'Another tab or device was writing at the same moment. Sync will try again.';
      case 'newer-format': return 'Your sync data was written by a newer version of the app. Reload to update this app, then sync again.';
      default: return `Sync failed (${e.message}). It will try again next time.`;
    }
  })();
  return { code: e.code, message: e.message, fix };
}

/** "Synced: 3 new from other devices, 5 sent." */
export function syncSummary(r: { added: number; pushed: number; quarantined: number; conflicts: number }): string {
  const parts: string[] = [];
  parts.push(r.added ? `${r.added} new from other devices` : 'nothing new from other devices');
  parts.push(r.pushed ? `${r.pushed} sent` : 'nothing to send');
  if (r.quarantined) parts.push(`${r.quarantined} set aside (see Data → Quarantine)`);
  if (r.conflicts) parts.push(`${r.conflicts} conflicting kept as this device's copy`);
  return `${parts.join(', ')}.`;
}

/** Clock-skew warning threshold (§11.3 step 5). */
export const SKEW_WARN_MS = 5 * 60_000;
