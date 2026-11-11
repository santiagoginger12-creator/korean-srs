import { useEffect, useState } from 'react';
import { dueItems } from '@ksrs/srs-engine';
import { navigate } from '../../router.ts';
import { now } from '../../state/clock.ts';
import { relTime } from '../../state/format.ts';
import { useApp } from '../../state/hooks.ts';
import { store } from '../../state/store.ts';
import { ItemLink } from '../../components/ItemDetails.tsx';
import { QuizRunner } from './QuizRunner.tsx';
import { NextSteps } from '../../components/NextSteps.tsx';

export function Reviews(): JSX.Element {
  const app = useApp();
  const [tried, setTried] = useState(false);
  const d = app.derived!;

  useEffect(() => {
    if (!app.review && !tried) { store.startReview(); setTried(true); }
  }, [app.review, tried]);

  const sess = app.review;
  if (!sess) {
    const t = now();
    const upcoming = [...d.items.values()]
      .filter((s) => s.kind !== 'hanja' && s.stage >= 1 && s.stage <= 8 && s.availableAt !== null && s.availableAt > t)
      .map((s) => s.availableAt!).sort((a, b) => a - b)[0];
    return (
      <div className="page narrow">
        <h1>Reviews</h1>
        <p className="empty">{dueItems(d, t).length ? 'Starting…' : 'No reviews are due right now.'}</p>
        {upcoming !== undefined && <p className="muted">Next review {relTime(upcoming, t)}.</p>}
        <a className="btn btn-primary" href="#/">Home</a>
      </div>
    );
  }

  const done = (
    <div className="page narrow summary" data-testid="review-summary">
      <h1>Session complete</h1>
      <p className="big-stat"><span>{sess.tally.correct}</span> correct · <span>{sess.tally.incorrect}</span> incorrect</p>
      {sess.tally.completed.length > 0 && (
        <section className="section">
          <h3>Items reviewed</h3>
          <p className="chips">{sess.tally.completed.map((id) => <ItemLink key={id} index={d.index} id={id} />)}</p>
        </section>
      )}
      <NextSteps beforeLeave={() => store.endReview()} onReviews={() => { void store.endReview().then(() => { store.startReview(); }); }} />
    </div>
  );

  return (
    <QuizRunner
      sess={sess}
      dispatch={(a) => store.reviewDispatch(a)}
      index={d.index}
      mode="review"
      done={done}
      onWrapUp={() => store.reviewDispatch({ type: 'wrapUp' })}
      onExit={() => navigate('#/')}
    />
  );
}
