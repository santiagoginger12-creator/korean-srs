// Dashboard (M3, §15): lessons vs cap, reviews due, 24 h / 7 d forecast, stage counts,
// level progress with the 90% marker, and a calm level-up banner.
import { dueGhosts, dueItems } from '@ksrs/srs-engine';
import { ForecastChart } from '../../components/ForecastChart.tsx';
import { tz } from '../../state/clock.ts';
import { capNote, capView, forecastView, grammarCapNote, grammarCardView, levelView, localTime, stageView } from '../../state/dashboard.ts';
import { itemHref, relTime } from '../../state/format.ts';
import { useApp, useNow } from '../../state/hooks.ts';
import { OVERRIDE_STEP, planAll } from '../../state/lessons.ts';
import { store } from '../../state/store.ts';
import { backupDue } from '../../data/backup.ts';
import { inboxEntries } from '../../data/contract.ts';
import { troubleRows } from '../../state/trouble.ts';
import { MasterLine } from './MasterLine.tsx';

const MAX_REMAINING_CHIPS = 12;

export function Dashboard(): JSX.Element {
  const app = useApp();
  const t = useNow();
  const d = app.derived!;
  const plans = planAll(d, app.events, t, tz, app.lessonOverride);
  const plan = plans.vocab;
  const cap = capView(plan.report);
  const dueIds = dueItems(d, t);
  const due = dueIds.length;
  const gv = grammarCardView(d, plans.grammar, dueIds);
  const ghosts = dueGhosts(d.index, app.events, t, app.ghostsDone).length;
  const fc = forecastView(d, t, tz, due);
  const lv = levelView(d);
  const stages = stageView(d);
  const active = app.review?.status === 'active' ? app.review : null;
  const left = active ? Object.values(active.items).filter((i) => !i.complete).length : 0;
  const nextAt = [...d.items.values()]
    .filter((s) => s.kind !== 'hanja' && s.stage >= 1 && s.stage <= 8 && s.availableAt !== null && s.availableAt > t)
    .map((s) => s.availableAt!).sort((a, b) => a - b)[0];
  const capped = plan.otherAvailable > plan.allowance;
  const lessons = plan.queue.length;
  const markerPct = lv.threshold * 100;
  const inbox = inboxEntries(d, app.events).length;
  const trouble = troubleRows(d, app.events, t).length;
  const needBackup = backupDue(app.lastBackupAt, t, app.events.length);

  return (
    <div className="page home dashboard">
      <header className="home-head">
        <div>
          <p className="eyebrow">오늘의 공부</p>
          <h1>Level <span data-testid="level">{d.userLevel}</span></h1>
        </div>
        <nav className="head-links">
          <a className="btn-text" href="#/practice">Practice</a>
          <a className="btn-text" href="#/browse">Browse</a>
          <a className="btn-text" href="#/settings">Settings</a>
        </nav>
      </header>

      {app.levelUp && (
        <div className="levelup" role="status" data-testid="level-up-banner">
          <div>
            <p className="levelup-title">레벨 업 · Level {app.levelUp.to}</p>
            <p className="levelup-body">
              90% of level {app.levelUp.to - 1} has reached Guru. {lessons > 0 ? `${lessons} new lesson${lessons === 1 ? ' is' : 's are'} waiting.` : 'New lessons unlock as you go.'}
            </p>
          </div>
          <button type="button" className="btn-text" onClick={() => store.dismissLevelUp()} aria-label="Dismiss">✕</button>
        </div>
      )}

      {needBackup && (
        <p className="notice" data-testid="backup-reminder">
          {app.lastBackupAt ? 'No backup in over a week.' : 'You haven\'t backed up yet.'} <a href="#/data">Download a backup</a> — your progress only lives on this device.
        </p>
      )}
      {(inbox > 0 || trouble > 0 || ghosts > 0) && (
        <nav className="pill-row" aria-label="Needs attention">
          {ghosts > 0 && <a className="pill on-soft" href="#/ghosts" data-testid="ghosts-link">Ghosts: <span className="count" data-testid="ghosts-count">{ghosts}</span></a>}
          {inbox > 0 && <a className="pill on-soft" href="#/inbox" data-testid="inbox-badge">Variants inbox <span className="count">{inbox}</span></a>}
          {trouble > 0 && <a className="pill on-soft" href="#/trouble" data-testid="trouble-link">Trouble items <span className="count">{trouble}</span></a>}
        </nav>
      )}

      <MasterLine />

      <div className="tiles">
        <section className="tile tile-lessons" data-testid="lessons-tile">
          <h2>{gv.separate ? 'Vocab lessons' : 'Lessons'}</h2>
          <p className="tile-count" data-testid="lessons-count">{lessons}</p>
          <p className="tile-note" data-testid="cap-note">
            {plan.report.clearReviewsFirst
              ? <><span className="warn-text">{cap.why}.</span>{plan.overrideExtra > 0 && <><br />{capNote(plan)}</>}</>
              : capNote(plan)}
          </p>
          <div className="row">
            <a className={`btn btn-primary ${lessons ? '' : 'is-disabled'}`} href="#/lessons" aria-disabled={!lessons} data-testid="start-lessons"
               onClick={(e: { preventDefault(): void }) => { if (!lessons) e.preventDefault(); }}>Start lessons</a>
            {(capped || plan.report.clearReviewsFirst) && plan.otherAvailable > 0 && (
              <button type="button" className="btn btn-quiet" onClick={() => void store.grantLessonOverride()} data-testid="lessons-override">+{OVERRIDE_STEP} anyway</button>
            )}
          </div>
        </section>

        <section className="tile tile-reviews" data-testid="reviews-tile">
          <h2>Reviews</h2>
          <p className="tile-count" data-testid="reviews-count">{due}</p>
          <p className="tile-note">
            {active ? `Session in progress: ${left} item${left === 1 ? '' : 's'} left`
              : due ? 'due now' : nextAt !== undefined ? `Next ${relTime(nextAt, t)} (${localTime(nextAt, tz)})` : 'Nothing scheduled yet'}
            {cap.reviewMinToday > 0 && <><br /><span className="muted" data-testid="review-estimate">≈{cap.reviewMinToday} min of reviews today · target {cap.targetMin}</span></>}
          </p>
          <a className={`btn btn-primary ${due || active ? '' : 'is-disabled'}`} href="#/reviews" data-testid="start-reviews" aria-disabled={!(due || active)}
             onClick={(e: { preventDefault(): void }) => { if (!(due || active)) e.preventDefault(); }}>{active ? 'Resume reviews' : 'Start reviews'}</a>
        </section>
      </div>

      {gv.separate && (
        <section className="card grammar-card k-grammar" data-testid="grammar-card" data-stage={gv.stage} data-passed={gv.passed} data-total={gv.total}>
          <div className="section-head">
            <h3>Grammar <span className="muted small" lang="ko">문법</span></h3>
            <a className="btn-text small" href="#/grammar" data-testid="grammar-progress-link">All patterns →</a>
          </div>
          <div className="grammar-row">
            <div>
              <p className="tile-count" data-testid="grammar-lessons-count">{gv.lessons}</p>
              <p className="tile-note" data-testid="grammar-cap-note">lessons · {grammarCapNote(gv, plans.grammar.report.clearReviewsFirst)}</p>
            </div>
            <div>
              <p className="tile-count" data-testid="grammar-reviews-count">{gv.reviewsDue}</p>
              <p className="tile-note">of {due} review{due === 1 ? '' : 's'} due</p>
            </div>
            <a className={`btn btn-primary ${gv.lessons ? '' : 'is-disabled'}`} href="#/lessons/grammar" aria-disabled={!gv.lessons} data-testid="start-grammar-lessons"
               onClick={(e: { preventDefault(): void }) => { if (!gv.lessons) e.preventDefault(); }}>Grammar lessons</a>
          </div>
          {gv.stageCount > 0 && (
            <>
              <div className="section-head">
                <span className="small">Stage <strong data-testid="grammar-stage">{gv.stage}</strong> of {gv.stageCount}</span>
                <span className="small"><strong>{gv.passed}</strong> / {gv.total} passed</span>
              </div>
              <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={gv.total} aria-valuenow={gv.passed}
                   aria-label={`Grammar stage ${gv.stage}: ${gv.passed} of ${gv.total} gating patterns passed; ${Math.ceil(gv.total * 0.9)} needed`}>
                <div className="meter-fill" style={{ width: `${gv.ratio * 100}%` }} />
                <div className="meter-mark" style={{ left: `${gv.threshold * 100}%` }} title="90%: next grammar stage unlocks" />
              </div>
              <p className="meter-note" data-testid="grammar-needed">
                {gv.isLastStage ? (gv.unlocksNext ? 'All grammar stages open.' : `${gv.needed} more to Guru to finish the last stage's 90%.`)
                  : gv.unlocksNext ? `Stage ${gv.stage + 1} is open.` : `${gv.needed} more to Guru to unlock grammar stage ${gv.stage + 1}.`}
              </p>
            </>
          )}
        </section>
      )}

      <section className="card forecast">
        <div className="section-head"><h3>Forecast</h3><span className="muted small">{fc.next24h} more in 24 h</span></div>
        <ForecastChart bars={fc.hourly} label="Next 24 hours" testId="forecast-24h" dueNow={fc.dueNow} />
        <ForecastChart bars={fc.daily} label="Next 7 days" testId="forecast-7d" />
      </section>

      <section className="card stages" data-testid="stage-counts">
        <h3>Stages</h3>
        <ul className="stage-row">
          {stages.map((s) => (
            <li key={s.key} className={`stage stage-${s.key}`} data-stage={s.key}>
              <span className="stage-count">{s.count}</span>
              <span className="stage-label">{s.label}</span>
              <span className="stage-ko" lang="ko">{s.ko}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card level" data-testid="level-progress" data-passed={lv.passed} data-total={lv.total}>
        <div className="section-head">
          <h3>Level {lv.level} progress</h3>
          <span className="small"><strong>{lv.passed}</strong> / {lv.total} passed</span>
        </div>
        <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={lv.total} aria-valuenow={lv.passed}
             aria-label={`Level ${lv.level}: ${lv.passed} of ${lv.total} gating items passed; ${Math.ceil(lv.total * 0.9)} needed`}>
          <div className="meter-fill" style={{ width: `${lv.ratio * 100}%` }} />
          <div className="meter-mark" style={{ left: `${markerPct}%` }} title="90%: next level unlocks" />
        </div>
        <p className="meter-note" data-testid="level-needed">
          {lv.isMaxLevel ? (lv.unlocksNext ? 'All levels open.' : `${lv.needed} more to Guru to finish the last level's 90%.`)
            : lv.unlocksNext ? `Level ${lv.level + 1} is open.`
            : `${lv.needed} more to Guru to unlock level ${lv.level + 1}.`}
        </p>
        {lv.byKind.length > 0 && (
          <ul className="kind-rows">
            {lv.byKind.map((r) => (
              <li key={r.kind} className={`k-${r.kind}`}>
                <span className="kind-dot" />{kindLabel(r.kind)}
                <span className="mini-meter"><span style={{ width: `${r.total ? (r.passed / r.total) * 100 : 0}%` }} /></span>
                <span className="small">{r.passed}/{r.total}</span>
              </li>
            ))}
          </ul>
        )}
        {!lv.unlocksNext && lv.remaining.length > 0 && (
          <>
            <p className="small muted">Still to pass (closest first):</p>
            <p className="chips">
              {lv.remaining.slice(0, MAX_REMAINING_CHIPS).map((r) => (
                <a key={r.id} className={`item-link k-${r.kind}`} href={itemHref(r.id)} title={r.stage ? `Apprentice ${r.stage}` : 'Not learned yet'}>
                  {r.label}{r.stage > 0 && <span className="chip-stage">A{r.stage}</span>}
                </a>
              ))}
              {lv.remaining.length > MAX_REMAINING_CHIPS && <span className="muted small">+{lv.remaining.length - MAX_REMAINING_CHIPS} more</span>}
            </p>
          </>
        )}
      </section>
    </div>
  );
}

const kindLabel = (k: string) => (k === 'vocab' ? 'Vocabulary' : k === 'grammar' ? 'Grammar' : 'Expressions');
