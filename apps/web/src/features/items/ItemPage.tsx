import { useEffect, useRef, useState } from 'react';
import { navigate } from '../../router.ts';
import type { Item } from '@ksrs/content';
import { headword, noteKey, relatedItems, resolveId, type DerivedState, type NoteField } from '@ksrs/srs-engine';
import { ItemDetails, KindTag, NeedsReview } from '../../components/ItemDetails.tsx';
import { itemHref, localDateTime, relTime, stageName } from '../../state/format.ts';
import { useApp, useNow } from '../../state/hooks.ts';
import { srsView, unlockView } from '../../state/itemView.ts';
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
  // Hanja have no pages any more (D63): old links (even to hanja the content no longer has) land on Browse.
  const isHanja = item ? item.kind === 'hanja' : rid.startsWith('h:');
  useEffect(() => { if (isHanja) navigate('#/browse'); }, [isHanja]);
  if (isHanja) return <div className="page narrow"><p className="muted">Opening Browse…</p></div>;
  if (!item) {
    return <div className="page narrow"><h1>Not found</h1><p className="muted">No item <code>{id}</code>.</p><a href="#/browse">Browse items</a></div>;
  }
  const st = d.items.get(rid);
  const rel = relatedItems(d.index, rid);
  const unlock = unlockView(d, rid);
  const srs = srsView(d, rid, t);
  return (
    <div className={`page item-page k-${item.kind}`} data-testid="item-page" data-item-id={rid}>
      <p className="crumbs"><a className="btn-text" href="#/" onClick={(e: { preventDefault(): void }) => { if (history.length > 1) { e.preventDefault(); history.back(); } }}>← Back</a>
        <a className="btn-text" href="#/browse">Browse</a></p>
      <div className="card teach">
        <div className="q-head"><KindTag kind={item.kind} /><NeedsReview item={item} /><span className="muted">Level {item.level}</span>
          <UnlockBadge status={unlock.status} /></div>
        <ItemDetails item={item} index={d.index} hideRelations moreExamplesOpen />
      </div>

      {(unlock.deps.length > 0 || unlock.levelLocked !== null) && (
        <section className="card unlock" data-testid="unlock-status">
          <h3>{unlock.status === 'locked' ? 'Unlocks after' : 'Unlocked after'}</h3>
          <ul className="deps">
            {unlock.levelLocked !== null && <li className="dep">{unlock.grammarPath ? `Grammar stage for level ${unlock.levelLocked} opens` : `Level ${unlock.levelLocked} opens`}</li>}
            {unlock.deps.map((dep) => (
              <li key={dep.id} className={`dep ${dep.met ? 'met' : ''}`}>
                <span aria-hidden="true">{dep.met ? '✓' : '○'}</span>{' '}
                <a href={itemHref(dep.id)} lang="ko">{dep.label}</a> {dep.require === 'lesson' ? 'lesson' : 'reaches Guru'}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Related item={item} d={d} rel={rel} />

      <section className="card srs" data-testid="srs-status">
        <h3>Progress</h3>
        {!st || st.stage === 0 || st.lessonAt === undefined
            ? <p>{unlock.status === 'available' ? 'Lesson available.' : 'Not learned yet.'}</p>
            : (
              <dl className="kv">
                <dt>Stage</dt><dd data-testid="srs-stage">{stageName(st.stage)}</dd>
                <dt>Next review</dt><dd>{st.stage >= 9 ? '—' : st.availableAt !== null ? `${relTime(st.availableAt, t)} · ${localDateTime(st.availableAt)}` : '—'}</dd>
                <dt>Learned</dt><dd>{localDateTime(st.lessonAt)}</dd>
                {st.passedAt !== undefined && <><dt>Passed (Guru)</dt><dd>{localDateTime(st.passedAt)}</dd></>}
                {st.burnedAt !== undefined && <><dt>Burned</dt><dd>{localDateTime(st.burnedAt)}</dd></>}
                {srs && <>
                  <dt>Reviews</dt><dd>{srs.reviews}{srs.accuracy !== null ? ` · ${Math.round(srs.accuracy * 100)}% clean` : ''}</dd>
                  <dt>Wrong answers</dt><dd>{srs.incorrect}{srs.selfGraded ? ` · ${srs.selfGraded} self-graded` : ''}</dd>
                  <dt>Streak</dt><dd>{srs.streak}</dd>
                  {srs.leech && <><dt>Leech score</dt><dd>{srs.leech.score.toFixed(1)}{srs.leech.isLeech && <span className="badge badge-warn">leech</span>}</dd></>}
                </>}
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

function UnlockBadge({ status }: { status: 'learned' | 'available' | 'locked' }): JSX.Element | null {
  if (status === 'learned') return null;
  return <span className={`badge ${status === 'locked' ? '' : 'badge-ok'}`}>{status === 'locked' ? 'locked' : 'lesson available'}</span>;
}

function Related({ item, d, rel }: { item: Item; d: DerivedState; rel: ReturnType<typeof relatedItems> }): JSX.Element | null {
  const label = (id: string) => { const it = d.index.byId.get(id); return it ? headword(it) : id; };
  if (item.kind === 'grammar' && (rel.contrasts.length > 0 || rel.unlocks.length > 0)) {
    return (
      <section className="card related" data-testid="related">
        {rel.contrasts.length > 0 && <>
          <h3>Contrasts</h3>
          <ul className="contrasts">
            {rel.contrasts.map((c, i) => (
              <li key={`${c.id}|${c.direction}|${i}`} data-direction={c.direction}>
                <a className="item-link k-grammar" href={itemHref(c.id)} lang="ko">{label(c.id)}</a>
                <span>{c.note}{c.direction === 'in' && <span className="muted small"> (from {label(c.id)}'s page)</span>}</span>
              </li>
            ))}
          </ul>
        </>}
        {rel.unlocks.length > 0 && <>
          <h3>Unlocks</h3>
          <p className="chips">{rel.unlocks.map((id) => <a key={id} className="item-link k-grammar" href={itemHref(id)} lang="ko">{label(id)}</a>)}</p>
        </>}
      </section>
    );
  }
  return null;
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
