// Backup, restore and manual device-to-device sync (§11 option d, §12).
import { useState, type ChangeEvent } from 'react';
import { parseBackup, type AppEvent } from '@ksrs/srs-engine';
import { canGzip, decodeBackupFile, friendlyBackupError, restorePreview, type RestorePreview } from '../../data/backup.ts';
import { downloadBlob } from '../../data/files.ts';
import { localDateTime } from '../../state/format.ts';
import { useApp } from '../../state/hooks.ts';
import { store } from '../../state/store.ts';

interface Pending { name: string; events: AppEvent[]; quarantine: { raw: unknown; reason: string }[]; preview: RestorePreview; fromDevice: string }

export function BackupSection(): JSX.Element {
  const app = useApp();
  const [gzip, setGzip] = useState(canGzip());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [confirmText, setConfirmText] = useState('');
  const [nameDraft, setNameDraft] = useState<string | null>(null);

  const doExport = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await store.exportBackup(gzip);
      downloadBlob(r.blob, r.filename);
      setMsg({ kind: 'ok', text: `Saved ${r.events} events as ${r.filename}.` });
    } catch (e) { setMsg({ kind: 'error', text: `Export failed: ${(e as Error).message}` }); }
    finally { setBusy(false); }
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    setMsg(null); setPending(null); setMode('merge'); setConfirmText('');
    if (!f) return;
    try {
      const text = await decodeBackupFile(f);
      const r = parseBackup(text);
      if (!r.ok) { setMsg({ kind: 'error', text: friendlyBackupError(r.error) }); return; }
      setPending({ name: f.name, events: r.events, quarantine: r.quarantine, preview: restorePreview(app.events, r.events, r.quarantine.length), fromDevice: r.meta.deviceId });
    } catch (err) { setMsg({ kind: 'error', text: `Couldn't open ${f.name}: ${(err as Error).message}` }); }
  };

  const apply = async () => {
    if (!pending) return;
    if (mode === 'replace' && confirmText !== 'REPLACE') return;
    setBusy(true);
    try {
      const r = await store.restore(pending.events, pending.quarantine, mode, pending.name);
      setMsg({ kind: 'ok', text: mode === 'merge'
        ? `Merged: ${r.added} new event${r.added === 1 ? '' : 's'} added.${pending.quarantine.length ? ` ${pending.quarantine.length} kept in quarantine.` : ''}`
        : `Replaced this device's history with ${r.added} events from the backup.` });
      setPending(null);
    } catch (e) { setMsg({ kind: 'error', text: `Restore failed: ${(e as Error).message}` }); }
    finally { setBusy(false); }
  };

  const p = pending?.preview;
  return (
    <>
      <section className="card form" data-testid="device-card">
        <h3>This device</h3>
        <label className="field"><span>Name (shown when syncing)</span>
          <input type="text" value={nameDraft ?? app.deviceName} onChange={(e: { target: HTMLInputElement }) => setNameDraft(e.target.value)}
            onBlur={() => { if (nameDraft !== null) { void store.setDeviceName(nameDraft); setNameDraft(null); } }} data-testid="device-name" />
        </label>
        <p className="muted small">Device id <code data-testid="device-id">{app.deviceId}</code></p>
      </section>

      <section className="card form" data-testid="backup-card">
        <h3>Back up</h3>
        <p className="muted">Your whole history in one file. API keys are never included.</p>
        <p className="small" data-testid="last-backup">Last backup: {app.lastBackupAt ? localDateTime(app.lastBackupAt) : 'never'}</p>
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={() => void doExport()} disabled={busy} data-testid="export-backup">Download backup</button>
          {canGzip() && <label className="check"><input type="checkbox" checked={gzip} onChange={(e: { target: HTMLInputElement }) => setGzip(e.target.checked)} data-testid="gzip" /> Compress (.gz)</label>}
        </div>
      </section>

      <section className="card form" data-testid="restore-card">
        <h3>Restore, or sync with another device</h3>
        <p className="muted small">To sync by hand: download a backup here, open it on the other device with <strong>Merge</strong>, then do the same in the other direction. Merging never loses answers from either side.</p>
        <label className="btn btn-quiet file-btn">Choose a backup file…
          <input type="file" accept=".json,.gz,application/json,application/gzip" onChange={(e: ChangeEvent<HTMLInputElement>) => void onFile(e)} data-testid="restore-file" />
        </label>
        {pending && p && (
          <div className="preview" data-testid="restore-preview">
            <p className="small"><strong>{pending.name}</strong> from <code>{pending.fromDevice || 'unknown device'}</code></p>
            <dl className="kv">
              <dt>Events</dt><dd>{p.incoming}</dd>
              <dt>New here</dt><dd data-testid="preview-new">{p.fresh}</dd>
              <dt>Already here</dt><dd>{p.alreadyPresent}</dd>
              {p.range && <><dt>Dates</dt><dd>{localDateTime(p.range.from)} – {localDateTime(p.range.to)}</dd></>}
              <dt>Devices</dt><dd>{p.devices.map((d) => `${d.deviceId === app.deviceId ? 'this device' : d.deviceId} (${d.count})`).join(', ') || '—'}</dd>
              {p.conflicts > 0 && <><dt>Conflicts</dt><dd className="warn-text" data-testid="preview-conflicts">{p.conflicts} event{p.conflicts === 1 ? '' : 's'} differ from this device's copy (the file may be damaged or edited); Merge keeps this device's version</dd></>}
              {p.quarantined > 0 && <><dt>Quarantined</dt><dd className="warn-text">{p.quarantined} from a newer app or malformed; kept, not applied</dd></>}
            </dl>
            <fieldset className="field"><legend>How</legend>
              <div className="segmented">
                <label className={mode === 'merge' ? 'on' : ''}><input type="radio" name="restore-mode" checked={mode === 'merge'} onChange={() => setMode('merge')} />Merge</label>
                <label className={mode === 'replace' ? 'on' : ''}><input type="radio" name="restore-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} data-testid="mode-replace" />Replace</label>
              </div>
            </fieldset>
            {mode === 'replace' && pending.events.length === 0 && app.events.length > 0 && (
              <p className="error-text" role="alert" data-testid="replace-empty">This backup has no events this app can apply, so Replace would erase this device's history. Use Merge (it keeps any newer-app events in quarantine), or update the app first.</p>
            )}
            {mode === 'replace' && !(pending.events.length === 0 && app.events.length > 0) && (
              <label className="field danger"><span>Replace deletes this device's {app.events.length} events and keeps only the backup's. Type <strong>REPLACE</strong> to confirm.</span>
                <input type="text" value={confirmText} onChange={(e: { target: HTMLInputElement }) => setConfirmText(e.target.value)} autoCapitalize="characters" data-testid="replace-confirm" />
              </label>
            )}
            <div className="row">
              <button type="button" className="btn btn-primary" onClick={() => void apply()} disabled={busy || (mode === 'replace' && confirmText !== 'REPLACE')} data-testid="apply-restore">
                {mode === 'merge' ? `Merge ${p.fresh} new event${p.fresh === 1 ? '' : 's'}` : 'Replace everything'}
              </button>
              <button type="button" className="btn-text" onClick={() => setPending(null)}>Cancel</button>
            </div>
          </div>
        )}
        {msg && <p className={msg.kind === 'error' ? 'error-text' : 'ok-text'} role={msg.kind === 'error' ? 'alert' : 'status'} data-testid="restore-msg">{msg.text}</p>}
      </section>
    </>
  );
}
