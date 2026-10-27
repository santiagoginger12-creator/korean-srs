// Data (M5): backup/restore/manual sync, item import/export, KRDict, storage status.
import { useEffect, useState } from 'react';
import type { QuarantineEntry } from '../../db/index.ts';
import { localDateTime } from '../../state/format.ts';
import { useApp } from '../../state/hooks.ts';
import { APP_VERSION, store } from '../../state/store.ts';
import { BackupSection } from './BackupSection.tsx';
import { ImportSection } from './ImportSection.tsx';
import { KrdictSection } from './KrdictSection.tsx';

export function DataPage(): JSX.Element {
  const app = useApp();
  return (
    <div className="page narrow data-page" data-testid="data-page">
      <p><a className="btn-text" href="#/settings">← Settings</a></p>
      <h1>Data</h1>
      <section className="card" data-testid="storage-status">
        <h3>Storage</h3>
        <dl className="kv">
          <dt>Persistent storage</dt>
          <dd data-testid="persisted">{app.persisted === true ? 'Granted: the browser won\'t evict your data' : app.persisted === false ? 'Not granted: back up regularly' : 'Not supported by this browser'}</dd>
          <dt>History</dt><dd>{app.events.length} events</dd>
          <dt>App version</dt><dd data-testid="app-version">{APP_VERSION}</dd>
          <dt>Content</dt><dd><code>{app.content?.contentVersion.slice(0, 12)}</code></dd>
        </dl>
      </section>
      <BackupSection />
      {app.quarantineCount > 0 && <QuarantineList count={app.quarantineCount} />}
      <ImportSection />
      <KrdictSection />
    </div>
  );
}

function QuarantineList({ count }: { count: number }): JSX.Element {
  const [rows, setRows] = useState<QuarantineEntry[]>([]);
  useEffect(() => { void store.listQuarantine().then(setRows); }, [count]);
  return (
    <section className="card" data-testid="quarantine">
      <h3>Quarantine ({count})</h3>
      <p className="muted small">Events from a newer version of the app, or ones that failed validation. They are kept (never deleted) and will be applied once the app understands them; update the app if this list grows.</p>
      <ul className="plain-list">
        {rows.slice(0, 50).map((q) => (
          <li key={q.key}><code>{typeof q.raw === 'object' && q.raw && 'type' in (q.raw as object) ? String((q.raw as { type: unknown }).type) : 'event'}</code> · {q.reason} · <span className="muted">{q.source}, {localDateTime(q.at)}</span></li>
        ))}
      </ul>
    </section>
  );
}
