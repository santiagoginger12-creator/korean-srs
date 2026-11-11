// Dashboard tile for the Anki-style drill (D84): due and new today, Start drill. D opens the drill
// from the dashboard (straight into a session when cards are waiting).
import { useEffect, useRef } from 'react';
import { DECK_META } from '../drill/deck.ts';
import { tz } from '../../state/clock.ts';
import { drillSummary, drillWaiting } from '../../state/drill.ts';
import { useApp } from '../../state/hooks.ts';
import { navigate } from '../../router.ts';

export function DrillTile({ t }: { t: number }): JSX.Element | null {
  const app = useApp();
  const c = drillSummary(app.drill, app.derived!.settings, DECK_META, t, tz);
  const waiting = drillWaiting(c);
  const href = waiting ? '#/drill/start' : '#/drill';
  const ref = useRef(href);
  ref.current = href;
  useEffect(() => {
    let used = false;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || used) return;
      if (e.key.toLowerCase() !== 'd' && e.code !== 'KeyD') return;
      e.preventDefault();
      used = true;
      navigate(ref.current);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (!DECK_META.count) return null;
  return (
    <section className="tile tile-drill" data-testid="drill-tile">
      <div className="drill-tile-body">
        <div>
          <h2>Drill <span className="muted small" lang="ko">단어 드릴</span></h2>
          <p className="tile-note" data-testid="drill-tile-note">
            <strong data-testid="drill-tile-due">{c.due}</strong> due · <strong data-testid="drill-tile-new">{c.newToday}</strong> new today
            {c.reviewsToday > 0 && <> · {c.reviewsToday} done</>}
          </p>
        </div>
        <a className={`btn ${waiting ? 'btn-primary' : 'btn-quiet'}`} href={href} data-testid="start-drill">
          {waiting ? 'Start drill' : 'Open drill'} <kbd>D</kbd>
        </a>
      </div>
    </section>
  );
}
