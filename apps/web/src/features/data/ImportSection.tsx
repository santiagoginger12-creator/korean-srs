// Import items from CSV/JSON with a preview diff; export custom items; CSV templates (§9.5).
import { useState, type ChangeEvent } from 'react';
import type { Item, ItemKind } from '@ksrs/content';
import { headword } from '@ksrs/srs-engine';
import { csvTemplate, diffItems, exportCsv, importCsv, importJson, type ImportIssue, type ItemDiff } from '../../data/contract.ts';
import { downloadText } from '../../data/files.ts';
import { itemHref } from '../../state/format.ts';
import { useApp } from '../../state/hooks.ts';
import { store } from '../../state/store.ts';

const KINDS: ItemKind[] = ['vocab', 'grammar', 'expression', 'hanja'];
interface Pending { file: string; items: Item[]; issues: ImportIssue[]; diff: ItemDiff }

export function ImportSection(): JSX.Element {
  const app = useApp();
  const d = app.derived!;
  const [kind, setKind] = useState<ItemKind>('vocab');
  const [pending, setPending] = useState<Pending | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const existing = (): Map<string, Item> => new Map(d.index.byId);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    setPending(null); setMsg(null);
    if (!f) return;
    try {
      const text = await f.text();
      const ctx = { existing: existing(), defaultSource: { kind: 'import' as const, license: 'user-provided', attribution: `Imported from ${f.name}` } };
      const isJson = /\.json$/i.test(f.name) || /^\s*[[{]/.test(text);
      const r = isJson ? importJson(text, ctx) : importCsv(kind, text, ctx);
      setPending({ file: f.name, items: r.items, issues: r.issues, diff: diffItems(ctx.existing, r.items) });
    } catch (err) { setMsg({ kind: 'error', text: `Couldn't read ${f.name}: ${(err as Error).message}` }); }
  };

  const errors = pending?.issues.filter((i) => i.severity === 'error') ?? [];
  const warnings = pending?.issues.filter((i) => i.severity !== 'error') ?? [];
  const toWrite = pending ? pending.items.filter((it) => !pending.diff.unchanged.includes(it.id)) : [];

  const confirm = async () => {
    if (!pending || errors.length) return;
    setBusy(true);
    try {
      await store.emit(toWrite.map((item) => ({ type: 'customItem.upsert' as const, item })));
      setMsg({ kind: 'ok', text: `Imported ${toWrite.length} item${toWrite.length === 1 ? '' : 's'}. New ones appear in lessons when their level is open.` });
      setPending(null);
    } catch (err) { setMsg({ kind: 'error', text: `Import failed: ${(err as Error).message}` }); }
    finally { setBusy(false); }
  };

  // The index copy: partial items (from a backup or another device) are full-shaped there (D47).
  const custom = [...d.customItems.keys()].map((id) => d.index.byId.get(id)).filter((it): it is Item => !!it);
  return (
    <section className="card form" data-testid="import-card">
      <h3>Import items</h3>
      <p className="muted small">CSV (one file per kind) or JSON in the bundle format. You'll see a preview before anything changes.</p>
      <details className="format-help" data-testid="import-help">
        <summary>CSV format</summary>
        <ul className="small">
          <li>First row is the header; column names in any order. Required: <code>level</code> plus the headword and meaning columns for the kind (e.g. <code>word</code>, <code>meanings</code>).</li>
          <li><code>|</code> separates several values (<code>decision|determination</code>); <code>::</code> joins pairs (<code>결정을 내리다::to make a decision</code>); escape with <code>\|</code>, <code>\:</code>.</li>
          <li>Rows starting with <code>#</code> are comments. UTF-8; a BOM is fine (exports include one so Excel shows Korean).</li>
          <li>Import <strong>hanja before the vocabulary</strong> that links to them.</li>
          <li>Errors reject that row; warnings are informational. Full reference: <code>packages/content/IMPORT.md</code>. The template has every column and an example row.</li>
        </ul>
      </details>
      <div className="row">
        <label className="field inline"><span>Kind</span>
          <select value={kind} onChange={(e: { target: HTMLSelectElement }) => setKind(e.target.value as ItemKind)} data-testid="import-kind">
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <label className="btn btn-quiet file-btn">Choose CSV or JSON…
          <input type="file" accept=".csv,.json,text/csv,application/json" onChange={(e: ChangeEvent<HTMLInputElement>) => void onFile(e)} data-testid="import-file" />
        </label>
        <button type="button" className="btn-text" onClick={() => downloadText(csvTemplate(kind), `ksrs-${kind}-template.csv`, 'text/csv')} data-testid="csv-template">{kind} CSV template</button>
      </div>

      {pending && (
        <div className="preview" data-testid="import-preview">
          <p className="small"><strong>{pending.file}</strong>: {pending.diff.added.length} new · {pending.diff.changed.length} changed · {pending.diff.unchanged.length} unchanged</p>
          {errors.length > 0 && <IssueList title={`${errors.length} error${errors.length === 1 ? '' : 's'} (fix the file and try again)`} issues={errors} cls="error-text" />}
          {warnings.length > 0 && <IssueList title={`${warnings.length} warning${warnings.length === 1 ? '' : 's'}`} issues={warnings} cls="warn-text" />}
          <div className="table-wrap">
            <table className="diff-table">
              <thead><tr><th>Item</th><th>Change</th></tr></thead>
              <tbody>
                {pending.items.map((it) => {
                  const ch = pending.diff.changed.find((c) => c.id === it.id);
                  const status = pending.diff.added.includes(it.id) ? 'new' : ch ? `changed: ${ch.fields.join(', ')}` : 'unchanged';
                  // A built-in item with the same id: the import overrides it (progress is kept).
                  const builtIn = d.index.byId.get(it.id)?.source.kind === 'original';
                  return (
                    <tr key={it.id} data-status={status.split(':')[0]} data-builtin={builtIn ? 'true' : undefined}>
                      <td><span lang="ko">{headword(it) || it.id}</span> <code className="muted small">{it.id}</code></td>
                      <td>{status}{builtIn && <span className="warn-text"> · replaces the built-in item (your progress on it is kept)</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={busy || errors.length > 0 || toWrite.length === 0} onClick={() => void confirm()} data-testid="import-confirm">
              Import {toWrite.length} item{toWrite.length === 1 ? '' : 's'}
            </button>
            <button type="button" className="btn-text" onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div>
      )}
      {msg && <p className={msg.kind === 'error' ? 'error-text' : 'ok-text'} role="status" data-testid="import-msg">{msg.text}</p>}

      <h3>Your custom items ({custom.length})</h3>
      {custom.length > 0 && (
        <>
          <p className="chips">{custom.slice(0, 30).map((it) => <a key={it.id} className={`item-link k-${it.kind}`} href={itemHref(it.id)} lang="ko">{it.id}</a>)}</p>
          <div className="row">
            {KINDS.filter((k) => custom.some((it) => it.kind === k)).map((k) => (
              <button key={k} type="button" className="btn-text" onClick={() => downloadText(exportCsv(k, custom.filter((it) => it.kind === k)), `ksrs-custom-${k}.csv`, 'text/csv')}>Export {k} CSV</button>
            ))}
            <button type="button" className="btn-text" onClick={() => downloadText(JSON.stringify(custom, null, 2), 'ksrs-custom-items.json', 'application/json')} data-testid="export-custom-json">Export all as JSON</button>
          </div>
        </>
      )}
    </section>
  );
}

function IssueList({ title, issues, cls }: { title: string; issues: ImportIssue[]; cls: string }): JSX.Element {
  return (
    <details className="issues" open>
      <summary className={cls}>{title}</summary>
      <ul>{issues.slice(0, 100).map((i, n) => <li key={n} className="small">{i.row !== undefined ? `row ${i.row}: ` : ''}{i.id ? <code>{i.id}</code> : null} {i.path} {i.msg}</li>)}</ul>
    </details>
  );
}
