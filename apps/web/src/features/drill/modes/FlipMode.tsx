// Flip and self-grade, Anki-style: Space / Enter (or a tap) shows the back; 1–4 grade.
// Space and Enter never grade. Keys match e.code too, so they work with the Korean input source on.
import { useEffect, useRef } from 'react';
import { RATINGS, RATING_LABELS, type Rating } from '@ksrs/srs-engine';
import type { AnswerMode, AnswerModeProps } from './types.ts';

export function ratingFromKey(e: Pick<KeyboardEvent, 'key' | 'code'>): Rating | null {
  for (const r of RATINGS) if (e.key === String(r) || e.code === `Digit${r}` || e.code === `Numpad${r}`) return r;
  return null;
}
export const isRevealKey = (e: Pick<KeyboardEvent, 'key' | 'code'>): boolean =>
  e.key === ' ' || e.key === 'Enter' || e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter';

function FlipMode(p: AnswerModeProps): JSX.Element {
  const ref = useRef(p);
  ref.current = p;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const cur = ref.current;
      if (cur.paused) return;
      if (isRevealKey(e)) {
        e.preventDefault(); // never grades, and doesn't click a focused button either
        if (!cur.revealed) cur.reveal();
        return;
      }
      const r = ratingFromKey(e);
      if (r && cur.revealed) { e.preventDefault(); cur.grade(r); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <div className={`drill-card ${p.revealed ? 'is-revealed' : ''}`} data-testid="drill-card" data-card-id={p.card.cardId}
        data-dir={p.card.dir} data-revealed={p.revealed}
        onClick={() => { if (!p.revealed && !p.paused) p.reveal(); }}>
        {p.front}
        {p.revealed && <div className="drill-back" data-testid="drill-back">{p.back}</div>}
      </div>
      {!p.revealed ? (
        <div className="drill-actions">
          <button type="button" className="btn btn-primary drill-show" onClick={p.reveal} disabled={p.paused} data-testid="drill-show">
            Show answer <kbd>Space</kbd>
          </button>
        </div>
      ) : (
        <div className="drill-actions drill-ratings" role="group" aria-label="How well did you know it?">
          {RATINGS.map((r) => (
            <button key={r} type="button" className={`btn drill-rate rate-${r}`} onClick={() => p.grade(r)} disabled={p.paused}
              data-testid={`drill-rate-${r}`} aria-keyshortcuts={String(r)}>
              <span className="rate-ivl" data-testid={`drill-ivl-${r}`}>{p.intervals[r]}</span>
              <span className="rate-label">{RATING_LABELS[r]}</span>
              <kbd>{r}</kbd>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export const FLIP_MODE: AnswerMode = {
  id: 'flip',
  label: 'Flip',
  description: 'See the card, recall the answer, flip it over, and grade yourself (Again / Hard / Good / Easy).',
  Component: FlipMode,
};
