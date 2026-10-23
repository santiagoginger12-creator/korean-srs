import { useEffect, useRef, useState } from 'react';
import { noteKey, resolveId, type NoteField } from '@ksrs/srs-engine';
import { ItemDetails, KindTag, NeedsReview } from '../../components/ItemDetails.tsx';
import { relTime, stageName } from '../../state/format.ts';
import { useApp, useNow } from '../../state/hooks.ts';
import { store } from '../../state/store.ts';

export const NOTE_IDLE_MS = 2000;
const FIELDS: { field: NoteField; label: string }[] = [
  { field: 'meaning', label: 'Meaning note' },
  { field: 'usage', label: 'Usage note' },
  { field: 'mnemonic', label: 'Mnemonic note' },
];

export function ItemPage({ id }: { id: string }): JSX.Element {
  const app = useApp();
  const t = useNow();
  const d = app.derived!;
  const rid = resolveId(d.index.redirects, id);
  const item = d.index.byId.get(rid);
  if (!item) {
    return <div className="page narrow"><h1>Not found</h1><p className="muted">No item <code>{id}</code>.</p><a href="#/">Home</a></div>;
  }
  const st = d.items.get(rid);
  return (
    <div className={`page item-page k-${item.kind}`} data-testid="item-page">
      <p><a className="btn-text" href="#/" onClick={(e: { preventDefault(): void }) => { if (history.length > 1) { e.preventDefault(); history.back(); } }}>← Back</a></p>
      <div className="card teach">
        <div className="q-head"><KindTag kind={item.kind} /><NeedsReview item={item} /><span className="muted">Level {item.level}</span></div>
        <ItemDetails item={item} index={d.index} />
      </div>
      <section className="card srs" data-testid="srs-status">
        <h3>Progress</h3>
        {item.kind === 'hanja'
          ? <p>{st?.lessonAt !== undefined ? 'Lesson done (hanja are not reviewed).' : 'Not learned yet.'}</p>
          : !st || st.stage === 0
            ? <p>Not learned yet.</p>
            : (
              <dl className="kv">
                <dt>Stage</dt><dd>{stageName(st.stage)}</dd>
                <dt>Next review</dt><dd>{st.stage >= 9 ? '—' : st.availableAt !== null ? relTime(st.availableAt, t) : '—'}</dd>
                <dt>Reviews</dt><dd>{st.stats.reviews} ({st.stats.correct} clean)</dd>
                <dt>Streak</dt><dd>{st.stats.streak}</dd>
              </dl>
            )}
      </section>
      <section className="card notes">
        <h3>Your notes</h3>
        {FIELDS.map((f) => <NoteBox key={f.field} itemId={rid} field={f.field} label={f.label} saved={d.notes.get(noteKey(rid, f.field)) ?? ''} />)}
      </section>
    </div>
  );
}

/** note.set on blur or after 2 s idle, never per keystroke (§6). */
function NoteBox({ itemId, field, label, saved }: { itemId: string; field: NoteField; label: string; saved: string }): JSX.Element {
  const [text, setText] = useState(saved);
  const [status, setStatus] = useState<'' | 'saved'>('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastSaved = useRef(saved);
  const textRef = useRef(text);
  textRef.current = text;

  const save = () => {
    if (timer.current !== undefined) { clearTimeout(timer.current); timer.current = undefined; }
    const v = textRef.current;
    if (v === lastSaved.current) return;
    lastSaved.current = v;
    void store.setNote(itemId, field, v).then(() => setStatus('saved'));
  };
  useEffect(() => () => save(), []); // save on unmount (navigating away)

  return (
    <label className="note">
      <span className="note-label">{label}{status && <span className="muted"> · saved</span>}</span>
      <textarea lang="ko" rows={2} value={text} data-testid={`note-${field}`}
        onChange={(e: { target: HTMLTextAreaElement }) => {
          setText(e.target.value); setStatus('');
          if (timer.current !== undefined) clearTimeout(timer.current);
          timer.current = setTimeout(save, NOTE_IDLE_MS);
        }}
        onBlur={save} />
    </label>
  );
}
