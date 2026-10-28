// Master list (docs/MASTER_LIST.md): import the frozen Anki baseline, record VOCAB ROWS from
// 대화 모드 / tutoring reports, and export korean_master_vocab.csv.
import { useState, type ChangeEvent } from 'react';
import { MASTER_HEADER, parseMasterCsv, serializeMasterCsv, type MasterIssue, type MasterRow } from '@ksrs/content';
import { baselineRows, statusCounts, type BaselineBlob, type SessionRecord, type SessionSource } from '@ksrs/srs-engine';
import { downloadBlob } from '../../data/files.ts';
import {
  baselinePayload, encodeBaseline, lastExportPayload, MASTER_FILENAME, planSessionRows, removeSessionPayloads, sessionPayloads,
  useMasterList, type SessionPlan,
} from '../../data/master.ts';
import { now, tz } from '../../state/clock.ts';
import { localDateTime } from '../../state/format.ts';
import { useApp } from '../../state/hooks.ts';
import { store } from '../../state/store.ts';

type Msg = { kind: 'ok' | 'error'; text: string } | null;
const STATUSES = ['learning', 'new', 'mastered', 'suspended'] as const;
const plural = (n: number, w: string) => `${n.toLocaleString('en-US')} ${w}${n === 1 ? '' : 's'}`;

export function MasterSection(): JSX.Element {
  const app = useApp();
  const d = app.derived!;
  const view = useMasterList(d, tz);
  const { baseline, sessions, lastExport } = view.ext;
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  const counts = view.rows ? statusCounts(view.rows) : null;
  return (
    <section className="card form master" data-testid="master-card">
      <h3>Master list</h3>
      <p className="muted small">
        <code>{MASTER_FILENAME}</code> is built from your Anki baseline, the app's reviews and the session rows you record here.
        Export it and replace the project's copy; don't edit the file by hand.
      </p>
      <dl className="kv" data-testid="master-summary">
        <dt>Anki baseline</dt>
        <dd data-testid="baseline-status">{baseline
          ? <>{plural(baseline.rows, 'row')} from <code>{baseline.file}</code>, imported {localDateTime(baseline.importedAt)}{view.baseline === 'loading' ? ' · loading…' : ''}</>
          : 'not imported yet'}</dd>
        <dt>List</dt>
        <dd data-testid="master-counts">{view.baseline === 'error' ? <span className="error-text">{view.error}</span>
          : counts && view.rows ? <>{plural(view.rows.length, 'word')}: {STATUSES.map((s) => `${counts[s].toLocaleString('en-US')} ${s}`).join(' · ')}</> : '…'}</dd>
        <dt>Sessions</dt><dd data-testid="session-count">{sessions.length} recorded</dd>
        <dt>Last export</dt><dd data-testid="last-export">{lastExport ? localDateTime(lastExport.at) : 'never'}</dd>
      </dl>

      <BaselineImport current={baseline} busy={busy} setBusy={setBusy} setMsg={setMsg} />
      <SessionRows rows={view.rows} sessions={sessions} busy={busy} setBusy={setBusy} setMsg={setMsg} />

      <h4>Export</h4>
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={busy || !view.rows} data-testid="export-master"
          onClick={() => void (async () => {
            if (!view.rows) return;
            setBusy(true); setMsg(null);
            try {
              const text = serializeMasterCsv(view.rows);
              const saved = await downloadBlob(new Blob([text], { type: 'text/csv;charset=utf-8' }), MASTER_FILENAME);
              if (saved) {
                await store.emit([lastExportPayload(now(), view.rows)]);
                setMsg({ kind: 'ok', text: `Saved ${plural(view.rows.length, 'row')} as ${MASTER_FILENAME}.` });
              } else setMsg({ kind: 'error', text: 'Not saved: the save was declined.' });
            } catch (e) { setMsg({ kind: 'error', text: `Export failed: ${(e as Error).message}` }); }
            finally { setBusy(false); }
          })()}>Export {MASTER_FILENAME}</button>
        <CopyHeader />
      </div>
      {msg && <p className={msg.kind === 'error' ? 'error-text' : 'ok-text'} role="status" data-testid="master-msg">{msg.text}</p>}
    </section>
  );
}

interface Common { busy: boolean; setBusy: (b: boolean) => void; setMsg: (m: Msg) => void }

function BaselineImport({ current, busy, setBusy, setMsg }: Common & { current: BaselineBlob | undefined }): JSX.Element {
  const [pending, setPending] = useState<{ file: string; all: MasterRow[]; kept: MasterRow[]; issues: MasterIssue[] } | null>(null);
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    setPending(null); setMsg(null);
    if (!f) return;
    try {
      const r = parseMasterCsv(await f.text());
      if (!r.hadHeader) { setMsg({ kind: 'error', text: `${f.name} has no header row; expected ${MASTER_HEADER}` }); return; }
      setPending({ file: f.name, all: r.rows, kept: baselineRows(r.rows), issues: r.issues });
    } catch (err) { setMsg({ kind: 'error', text: `Couldn't read ${f.name}: ${(err as Error).message}` }); }
  };
  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const t0 = performance.now();
      const blob = await encodeBaseline(pending.kept, pending.file, now());
      await store.emit([baselinePayload(blob)]);
      setMsg({ kind: 'ok', text: `Stored ${plural(blob.rows, 'row')} as the Anki baseline (${Math.round(blob.data.length / 1024)} KB, ${Math.round(performance.now() - t0)} ms).` });
      setPending(null);
    } catch (err) { setMsg({ kind: 'error', text: `Import failed: ${(err as Error).message}` }); }
    finally { setBusy(false); }
  };
  const errors = pending?.issues.filter((i) => i.severity === 'error') ?? [];
  const warnings = pending?.issues.filter((i) => i.severity === 'warning') ?? [];
  const c = pending ? statusCounts(pending.kept) : null;
  return (
    <>
      <h4>Import Anki baseline</h4>
      <p className="muted small">A master-format CSV with a header. Rows with <code>anki</code> in <code>sources</code> become the frozen baseline; other rows are recomputed from the app and sessions. Importing again replaces the baseline.</p>
      <label className="btn btn-quiet file-btn">Choose master CSV…
        <input type="file" accept=".csv,text/csv" onChange={(e: ChangeEvent<HTMLInputElement>) => void onFile(e)} data-testid="baseline-file" />
      </label>
      {pending && c && (
        <div className="preview" data-testid="baseline-preview">
          <p className="small"><strong>{pending.file}</strong>: <span data-testid="baseline-rows">{pending.all.length}</span> rows · <strong data-testid="baseline-kept">{pending.kept.length}</strong> baseline (anki) · {pending.all.length - pending.kept.length} skipped (not from Anki)</p>
          <p className="small" data-testid="baseline-statuses">{STATUSES.map((s) => `${c[s]} ${s}`).join(' · ')}</p>
          {errors.length > 0 && <Issues title={`${errors.length} row${errors.length === 1 ? '' : 's'} with errors (left out)`} issues={errors} cls="error-text" />}
          {warnings.length > 0 && <Issues title={plural(warnings.length, 'warning')} issues={warnings} cls="warn-text" />}
          {current && <p className="warn-text small">Replaces the baseline imported {localDateTime(current.importedAt)} ({plural(current.rows, 'row')}).</p>}
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={busy || pending.kept.length === 0} onClick={() => void confirm()} data-testid="baseline-confirm">Store as Anki baseline</button>
            <button type="button" className="btn-text" onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}

function SessionRows({ rows, sessions, busy, setBusy, setMsg }: Common & { rows: MasterRow[] | null; sessions: SessionRecord[] }): JSX.Element {
  const app = useApp();
  const d = app.derived!;
  const [text, setText] = useState('');
  const [source, setSource] = useState<SessionSource>('convo');
  const [createItems, setCreateItems] = useState(true);
  const [plan, setPlan] = useState<{ plan: SessionPlan; issues: MasterIssue[] } | null>(null);

  const preview = () => {
    setMsg(null); setPlan(null);
    if (!rows) return;
    const r = parseMasterCsv(text);
    if (!r.rows.length) {
      setMsg({ kind: 'error', text: r.issues.length ? `No usable rows: ${r.issues[0]!.msg}` : 'Paste the VOCAB ROWS block first.' });
      return;
    }
    setPlan({ plan: planSessionRows(d, rows, r.rows, { source, recordedAt: now(), createItems }), issues: r.issues });
  };
  const record = async () => {
    if (!plan || plan.plan.duplicateOf) return;
    setBusy(true);
    try {
      await store.emit(sessionPayloads(plan.plan));
      const n = plan.plan.record.rows.length;
      const items = plan.plan.items.length;
      setMsg({ kind: 'ok', text: `Recorded ${plural(n, 'row')}${items ? `; ${plural(items, 'new item')} added to lessons` : ''}.` });
      setPlan(null); setText('');
    } catch (e) { setMsg({ kind: 'error', text: `Couldn't record: ${(e as Error).message}` }); }
    finally { setBusy(false); }
  };
  const p = plan?.plan;
  return (
    <>
      <h4>Add session rows</h4>
      <p className="muted small">
        Paste the VOCAB ROWS block from a 대화 모드 or tutoring report (header optional, code fences are fine).
        Report rows hold <em>updated totals</em>, so for a word already in the list only the increase counts:
        the new <code>times_missed</code> minus the list's current value (never below 0) is added as conversation misses, and the same for <code>times_seen</code>.
        Recording the same block twice changes nothing.
      </p>
      <textarea rows={6} lang="ko" value={text} spellCheck={false} placeholder={'```csv\n' + MASTER_HEADER + '\n…\n```'}
        onChange={(e: { target: HTMLTextAreaElement }) => { setText(e.target.value); setPlan(null); }} data-testid="session-text" />
      <div className="row">
        <div className="segmented" role="radiogroup" aria-label="Session type">
          {(['convo', 'tutor'] as const).map((s) => (
            <label key={s} className={source === s ? 'on' : ''}><input type="radio" name="session-source" checked={source === s} onChange={() => { setSource(s); setPlan(null); }} data-testid={`session-source-${s}`} />{s === 'convo' ? '대화 모드' : 'Tutoring'}</label>
          ))}
        </div>
        <label className="check"><input type="checkbox" checked={createItems} onChange={(e: { target: HTMLInputElement }) => { setCreateItems(e.target.checked); setPlan(null); }} data-testid="session-create-items" /> Add new words to lessons</label>
        <button type="button" className="btn btn-quiet" disabled={!text.trim() || !rows} onClick={preview} data-testid="session-preview-btn">Preview</button>
      </div>
      {p && (
        <div className="preview" data-testid="session-preview">
          {p.duplicateOf
            ? <p className="warn-text small" data-testid="session-duplicate">This block was already recorded on {localDateTime(p.duplicateOf.recordedAt)}. Nothing to add.</p>
            : <p className="small">{plural(p.record.rows.length, 'row')}: {p.record.rows.filter((r) => !r.isNew).length} existing, {p.record.rows.filter((r) => r.isNew).length} new</p>}
          {plan.issues.length > 0 && <Issues title={plural(plan.issues.length, 'issue')} issues={plan.issues} cls={plan.issues.some((i) => i.severity === 'error') ? 'error-text' : 'warn-text'} />}
          <div className="table-wrap">
            <table className="diff-table">
              <thead><tr><th>Word</th><th>Change</th></tr></thead>
              <tbody>
                {p.record.rows.map((r) => (
                  <tr key={r.word} data-testid="session-row" data-word={r.word} data-missed={r.missed} data-new={r.isNew ? 'true' : undefined}>
                    <td lang="ko">{r.word}</td>
                    <td>{r.isNew
                      ? <>new word ({r.status}){r.missed ? `, ${r.missed} missed` : ''}{p.items.some((i) => (i as { word?: string }).word === r.word) ? ' · added to lessons' : ''}</>
                      : <>+{r.missed} missed · +{r.seen} seen <span className="muted">(report total {r.reportedMissed})</span></>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={busy || !!p.duplicateOf} onClick={() => void record()} data-testid="session-record">Record {plural(p.record.rows.length, 'row')}</button>
            <button type="button" className="btn-text" onClick={() => setPlan(null)}>Cancel</button>
          </div>
        </div>
      )}
      {sessions.length > 0 && (
        <details className="sessions" data-testid="session-list">
          <summary className="small">Recorded sessions ({sessions.length})</summary>
          <ul className="plain-list">
            {sessions.slice().reverse().slice(0, 30).map((s) => (
              <li key={s.hash} className="small">
                {localDateTime(s.recordedAt)} · {s.source === 'convo' ? '대화 모드' : 'tutoring'} · {plural(s.rows.length, 'row')}
                {' '}<span lang="ko" className="muted">{s.rows.slice(0, 4).map((r) => r.word).join(', ')}{s.rows.length > 4 ? '…' : ''}</span>
                {' '}<button type="button" className="btn-text" disabled={busy} data-testid="session-remove" onClick={() => void (async () => {
                  const r = removeSessionPayloads(d, s);
                  try {
                    await store.emit(r.payloads);
                    setMsg({ kind: 'ok', text: `Removed the session (${plural(s.rows.length, 'row')})${r.deleted.length ? `; ${plural(r.deleted.length, 'unstudied item')} it added removed` : ''}${r.kept.length ? `; ${plural(r.kept.length, 'studied item')} kept` : ''}.` });
                  } catch (e) { setMsg({ kind: 'error', text: `Couldn't remove: ${(e as Error).message}` }); }
                })()}>Remove</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function CopyHeader(): JSX.Element {
  const [state, setState] = useState<'idle' | 'copied' | 'show'>('idle');
  const copy = async () => {
    try { await navigator.clipboard.writeText(MASTER_HEADER); setState('copied'); }
    catch { setState('show'); }
  };
  return (
    <>
      <button type="button" className="btn-text" onClick={() => void copy()} data-testid="copy-header">{state === 'copied' ? 'Header copied' : 'Copy VOCAB-format header'}</button>
      {state === 'show' && <code className="small" data-testid="header-text">{MASTER_HEADER}</code>}
    </>
  );
}

function Issues({ title, issues, cls }: { title: string; issues: MasterIssue[]; cls: string }): JSX.Element {
  return (
    <details className="issues">
      <summary className={cls}>{title}</summary>
      <ul>{issues.slice(0, 100).map((i, n) => <li key={n} className="small">line {i.row}{i.word ? <> <span lang="ko">{i.word}</span></> : null}: {i.msg}</li>)}</ul>
    </details>
  );
}
