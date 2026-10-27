// Trouble items (§7.5): leeches with score, stage and last wrong answer; add a mnemonic, reset
// to Apprentice 1 (item.reset, D41 keeps leech history), or drill them in practice.
import { useState } from 'react';
import { noteKey } from '@ksrs/srs-engine';
import { itemHref, localDateTime, stageName } from '../../state/format.ts';
import { useApp, useNow } from '../../state/hooks.ts';
import { troubleRows } from '../../state/trouble.ts';
import { resetCandidateSet } from '../../data/contract.ts';
import { store } from '../../state/store.ts';

export function Trouble(): JSX.Element {
  const app = useApp();
  const t = useNow();
  const d = app.derived!;
  const rows = troubleRows(d, app.events, t);
  const resettable = resetCandidateSet(d, t);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState('');

  return (
    <div className="page narrow trouble" data-testid="trouble-page">
      <p><a className="btn-text" href="#/">← Home</a></p>
      <h1>Trouble items</h1>
      <p className="muted">Items you keep missing (score = wrong answers in 90 days ÷ streak<sup>1.5</sup>). A fresh mnemonic or a reset usually helps more than drilling.</p>
      {rows.length === 0 ? <p className="empty" data-testid="trouble-empty">No trouble items. 잘하고 있어요.</p> : (
        <>
          <a className="btn btn-quiet" href="#/practice/trouble" data-testid="drill-all">Drill all {rows.length} in practice</a>
          <ul className="trouble-list">
            {rows.map((r) => (
              <li key={r.itemId} className={`card trouble-row k-${r.kind}`} data-testid="trouble-row" data-item-id={r.itemId}>
                <div className="trouble-head">
                  <a className={`item-link k-${r.kind}`} href={itemHref(r.itemId)} lang="ko">{r.label}</a>
                  <span className="badge badge-warn">score {r.score.toFixed(1)}</span>
                  <span className="muted small">{stageName(r.stage)}</span>
                </div>
                {r.lastWrong && <p className="small">Last wrong: <span lang="ko">“{r.lastWrong.response || '—'}”</span> <span className="muted">({r.lastWrong.qtype}, {localDateTime(r.lastWrong.at)})</span></p>}
                {noteFor === r.itemId ? (
                  <div className="row">
                    <textarea rows={2} lang="ko" value={note} onChange={(e: { target: HTMLTextAreaElement }) => setNote(e.target.value)} placeholder="A new mnemonic…" data-testid="trouble-note" />
                    <button type="button" className="btn btn-primary btn-small" onClick={() => { void store.setNote(r.itemId, 'mnemonic', note); setNoteFor(null); }}>Save</button>
                  </div>
                ) : null}
                <div className="row">
                  <button type="button" className="btn btn-quiet btn-small" onClick={() => { setNoteFor(r.itemId); setNote(d.notes.get(noteKey(r.itemId, 'mnemonic')) ?? ''); }} data-testid="note">Mnemonic note</button>
                  {resettable.has(r.itemId) && (confirming === r.itemId ? (
                    <span className="confirm" role="group">
                      Reset to Apprentice 1?{' '}
                      <button type="button" className="btn btn-small btn-danger" onClick={() => { void store.emit([{ type: 'item.reset', itemId: r.itemId, toStage: 1 }]); setConfirming(null); }} data-testid="confirm-reset">Reset</button>
                      <button type="button" className="btn-text" onClick={() => setConfirming(null)}>Cancel</button>
                    </span>
                  ) : <button type="button" className="btn btn-quiet btn-small" onClick={() => setConfirming(r.itemId)} data-testid="reset">Reset to Apprentice 1</button>)}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
