// Settings → Sync (M6): GitHub sync through the owner's private data repo (§11, D8).
import { useState, useSyncExternalStore } from 'react';
import { expiresIn, expiryReminder } from '../../data/sync.ts';
import { isArtifact } from '../../host.ts';
import { localDateTime } from '../../state/format.ts';
import { useNow } from '../../state/hooks.ts';
import { sync } from '../../state/sync.ts';

export const SYNC_UNAVAILABLE = 'Sync isn\'t available on the claude.ai page, because its security policy blocks connections to GitHub. Use Data → Backup and Merge here, or sync from the installed app.';

export function useSync() { return useSyncExternalStore(sync.subscribe, sync.getState); }

export function SyncPage(): JSX.Element {
  const s = useSync();
  const t = useNow();
  const [token, setToken] = useState('');
  const [repoDraft, setRepoDraft] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  if (isArtifact || !s.available) {
    return (
      <div className="page narrow settings" data-testid="sync-page">
        <p><a className="btn-text" href="#/settings">← Settings</a></p>
        <h1>Sync</h1>
        <p className="muted" data-testid="sync-unavailable">{SYNC_UNAVAILABLE}</p>
      </div>
    );
  }
  const c = s.config;
  const remind = expiryReminder(c.tokenExpiry, t);
  const saveRepo = async () => {
    if (repoDraft === null) return;
    const err = await sync.setRepo(repoDraft);
    setMsg(err ? { ok: false, text: err } : null);
    if (!err) setRepoDraft(null);
  };

  return (
    <div className="page narrow settings sync-page" data-testid="sync-page">
      <p><a className="btn-text" href="#/settings">← Settings</a></p>
      <h1>Sync</h1>
      <p className="muted small">Keeps your devices in step through a private GitHub repository. Each device adds its own reviews there; nothing else is sent anywhere.</p>

      <section className="card form sync-status" data-testid="sync-card" data-enabled={c.enabled ? 'on' : 'off'} aria-busy={s.running}>
        <div className="sync-head">
          <span className={`sync-dot ${c.enabled ? (s.problem ? 'is-bad' : 'is-on') : ''}`} aria-hidden="true" />
          <strong>{c.enabled ? 'Sync is on' : 'Sync is off'}</strong>
        </div>
        <p className={s.problem ? 'error-text' : 'muted'} role="status" data-testid="sync-status">{s.running ? 'Syncing…' : s.status}</p>
        <dl className="kv">
          <dt>Last sync</dt><dd data-testid="sync-last">{c.lastSyncAt ? localDateTime(c.lastSyncAt) : 'never'}</dd>
          <dt>Repository</dt><dd><code>{c.repo}</code></dd>
        </dl>
        {s.skewMs !== undefined && (
          <p className="warn-text small" data-testid="sync-skew">This device's clock is {Math.round(Math.abs(s.skewMs) / 60_000)} min {s.skewMs > 0 ? 'ahead of' : 'behind'} GitHub's. Set the clock to automatic so reviews are ordered correctly.</p>
        )}
        <div className="row">
          {c.enabled
            ? <button type="button" className="btn btn-quiet" data-testid="sync-disable" onClick={() => void sync.setEnabled(false)}>Turn off</button>
            : <button type="button" className="btn btn-primary" data-testid="sync-enable" disabled={!s.hasToken} onClick={() => void sync.setEnabled(true)}>Turn on</button>}
          <button type="button" className="btn btn-quiet" data-testid="sync-now" disabled={!c.enabled || s.running} onClick={() => void sync.trigger('button')}>Sync now</button>
        </div>
        {!s.hasToken && <p className="muted small">Save a token below to turn sync on.</p>}
      </section>

      <section className="card form" data-testid="sync-connection">
        <h3>Connection</h3>
        <label className="field"><span>Repository (owner/name)</span>
          <input type="text" autoComplete="off" autoCapitalize="off" spellCheck={false} inputMode="url" data-testid="sync-repo"
            value={repoDraft ?? c.repo}
            onChange={(e: { target: HTMLInputElement }) => setRepoDraft(e.target.value)}
            onBlur={() => void saveRepo()}
            onKeyDown={(e: { key: string }) => { if (e.key === 'Enter') void saveRepo(); }} />
        </label>
        <label className="field"><span>Access token</span>
          <input type="password" autoComplete="off" spellCheck={false} placeholder={s.hasToken ? 'Paste a new token to replace it' : 'github_pat_…'}
            data-testid="sync-token" value={token} onChange={(e: { target: HTMLInputElement }) => setToken(e.target.value)} />
        </label>
        <div className="row">
          <button type="button" className="btn btn-quiet btn-small" data-testid="sync-save-token" disabled={!token.trim()} onClick={() => void (async () => {
            const err = await sync.saveToken(token);
            setMsg(err ? { ok: false, text: err } : { ok: true, text: 'Token saved on this device.' });
            if (!err) setToken('');
          })()}>Save token</button>
          {s.hasToken && <button type="button" className="btn-text" data-testid="sync-remove-token" onClick={() => void sync.removeToken().then(() => setMsg({ ok: true, text: 'Token removed from this device. Sync is off.' }))}>Remove token</button>}
        </div>
        <p className="muted small" data-testid="sync-token-status">{s.hasToken
          ? <>A token ending in <code>…{s.tokenHint}</code> is saved in this browser only. It is never included in backups or exports.</>
          : 'No token saved on this device.'}</p>
        <label className="field"><span>Token expires on (optional, for a reminder)</span>
          <input type="date" data-testid="sync-expiry" value={c.tokenExpiry ?? ''} onChange={(e: { target: HTMLInputElement }) => void sync.setExpiry(e.target.value)} />
        </label>
        {remind && <p className="warn-text small" data-testid="sync-expiry-note">{remind.expired ? 'This token has expired. Make a new one and paste it above.' : `This token expires ${expiresIn(remind.days)}. Make a new one before then.`}</p>}
        <div className="row">
          <button type="button" className="btn btn-quiet btn-small" data-testid="sync-test" disabled={!s.hasToken || testing} onClick={() => void (async () => {
            setTesting(true); setMsg(null);
            const r = await sync.testConnection();
            setMsg({ ok: r.ok, text: r.message });
            setTesting(false);
          })()}>{testing ? 'Testing…' : 'Test connection'}</button>
        </div>
        {msg && <p className={msg.ok ? 'ok-text' : 'error-text'} role={msg.ok ? 'status' : 'alert'} data-testid="sync-msg">{msg.text}</p>}
      </section>

      <details className="card sync-help" data-testid="sync-help">
        <summary>How to make a token</summary>
        <ol className="small">
          <li>On github.com: Settings → Developer settings → Personal access tokens → <strong>Fine-grained tokens</strong> → Generate new token.</li>
          <li>Expiration: 1 year (custom date). Note the date and enter it above.</li>
          <li>Repository access: <strong>Only select repositories</strong> → <code>ksrs-data</code> only.</li>
          <li>Permissions → Repository → <strong>Contents: Read and write</strong>. Nothing else.</li>
          <li>Generate, copy, and paste it here. Paste it only into this app, on each of your devices.</li>
        </ol>
      </details>
    </div>
  );
}

/** App-wide, non-modal: the current sync failure and the token-expiry reminder. */
export function SyncBanners(): JSX.Element | null {
  const s = useSync();
  const t = useNow(60 * 60_000);
  if (!s.available || !s.config.enabled) return null;
  const remind = expiryReminder(s.config.tokenExpiry, t);
  const showProblem = s.problem && !s.bannerDismissed;
  if (!showProblem && !remind) return null;
  return (
    <>
      {showProblem && (
        <div className="banner banner-error sync-banner" role="status" data-testid="sync-banner" data-code={s.problem!.code}>
          <span>{s.problem!.fix}</span>{' '}
          <a href="#/settings/sync" className="banner-link">Open Sync</a>
          <button type="button" className="banner-close" aria-label="Dismiss" onClick={() => sync.dismissBanner()}>×</button>
        </div>
      )}
      {remind && (
        <div className="banner banner-warn" role="status" data-testid="sync-expiry-banner">
          {remind.expired ? 'Your GitHub sync token has expired' : `Your GitHub sync token expires ${expiresIn(remind.days)}`}
          {' '}— make a new one and paste it in <a href="#/settings/sync" className="banner-link">Settings → Sync</a>.
        </div>
      )}
    </>
  );
}
