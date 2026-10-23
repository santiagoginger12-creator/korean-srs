// Minimal home (M3 builds the full dashboard): lessons, reviews, level.
import { dueItems } from '@ksrs/srs-engine';
import { tz } from '../../state/clock.ts';
import { relTime } from '../../state/format.ts';
import { useApp, useNow } from '../../state/hooks.ts';
import { OVERRIDE_STEP, planLessons } from '../../state/lessons.ts';
import { store } from '../../state/store.ts';

export function Home(): JSX.Element {
  const app = useApp();
  const t = useNow();
  const d = app.derived!;
  const plan = planLessons(d, app.events, t, tz, app.lessonOverride);
  const due = dueItems(d, t).length;
  const active = app.review?.status === 'active' ? app.review : null;
  const left = active ? Object.values(active.items).filter((i) => !i.complete).length : 0;
  const nextAt = [...d.items.values()]
    .filter((s) => s.kind !== 'hanja' && s.stage >= 1 && s.stage <= 8 && s.availableAt !== null && s.availableAt > t)
    .map((s) => s.availableAt!).sort((a, b) => a - b)[0];
  const capped = plan.otherAvailable > plan.allowance;
  const lessons = plan.queue.length;

  return (
    <div className="page home">
      <header className="home-head">
        <div>
          <p className="eyebrow">오늘의 공부</p>
          <h1>Level <span data-testid="level">{d.userLevel}</span></h1>
        </div>
        <a className="btn-text" href="#/settings">Settings</a>
      </header>

      <div className="tiles">
        <section className="tile tile-lessons" data-testid="lessons-tile">
          <h2>Lessons</h2>
          <p className="tile-count" data-testid="lessons-count">{lessons}</p>
          <p className="tile-note">
            {plan.report.clearReviewsFirst
              ? 'Clear reviews first: the backlog is over your daily target.'
              : `Today: ${plan.report.lessonsDoneToday} done · cap ${plan.report.cap + plan.report.lessonsDoneToday}${plan.overrideExtra ? ` (+${plan.overrideExtra})` : ''}`}
            {plan.hanjaAvailable > 0 ? ` · ${plan.hanjaAvailable} hanja (uncapped)` : ''}
          </p>
          <div className="row">
            <a className={`btn btn-primary ${lessons ? '' : 'is-disabled'}`} href="#/lessons" aria-disabled={!lessons} data-testid="start-lessons"
               onClick={(e: { preventDefault(): void }) => { if (!lessons) e.preventDefault(); }}>Start lessons</a>
            {capped && <button type="button" className="btn btn-quiet" onClick={() => void store.grantLessonOverride()} data-testid="lessons-override">+{OVERRIDE_STEP} anyway</button>}
          </div>
        </section>

        <section className="tile tile-reviews" data-testid="reviews-tile">
          <h2>Reviews</h2>
          <p className="tile-count" data-testid="reviews-count">{due}</p>
          <p className="tile-note">
            {active ? `Session in progress: ${left} item${left === 1 ? '' : 's'} left` : due ? 'due now' : nextAt !== undefined ? `Next ${relTime(nextAt, t)}` : 'Nothing scheduled yet'}
          </p>
          <a className={`btn btn-primary ${due || active ? '' : 'is-disabled'}`} href="#/reviews" data-testid="start-reviews" aria-disabled={!(due || active)}
             onClick={(e: { preventDefault(): void }) => { if (!(due || active)) e.preventDefault(); }}>{active ? 'Resume reviews' : 'Start reviews'}</a>
        </section>
      </div>
    </div>
  );
}
