// Dashboard tile for the Anki-style drill (D84): due and new today, Start drill. D opens the drill
// from the dashboard (straight into a session when cards are waiting).
import { useRef } from 'react';
import { DECK_META } from '../drill/deck.ts';
import { tz } from '../../state/clock.ts';
import { drillSummary, drillWaiting } from '../../state/drill.ts';
import { useApp } from '../../state/hooks.ts';
import { navigate } from '../../router.ts';
import { Kbd, useHotkey } from '../../state/hotkeys.tsx';

export function DrillTile({ t }: { t: number }): JSX.Element | null {
  const app = useApp();
  const c = drillSummary(app.drill, app.derived!.settings, DECK_META, t, tz);
  const waiting = drillWaiting(c);
  const href = waiting ? '#/drill/start' : '#/drill';
  const ref = useRef(href);
  ref.current = href;
  useHotkey('drill.open', () => navigate(ref.current), true, { once: true });
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
          {waiting ? 'Start drill' : 'Open drill'} <Kbd id="drill.open" />
        </a>
      </div>
    </section>
  );
}
