// Ghost reviews: practice for recent grammar misses (+2 h and +24 h after each miss), derived
// from the review log. Same QuizRunner in the no-events ('extra') mode: nothing here changes
// SRS state. Finishing an item marks its due ghost slots done on this device (kv only).
import { useEffect, useReducer, useRef } from 'react';
import { buildQuestions, dueGhosts, emptySession, sessionReducer, type ReviewSession, type SessionAction, type StartItem } from '@ksrs/srs-engine';
import { navigate } from '../../router.ts';
import { now } from '../../state/clock.ts';
import { useApp } from '../../state/hooks.ts';
import { store } from '../../state/store.ts';
import { QuizRunner } from '../reviews/QuizRunner.tsx';

const reducer = (s: ReviewSession, a: SessionAction): ReviewSession => sessionReducer(s, a).sess;

export function Ghosts(): JSX.Element {
  const app = useApp();
  const d = app.derived!;
  const [sess, dispatch] = useReducer(reducer, undefined, emptySession);
  // Freeze the slots at start: completing them changes what's due underneath us.
  const slots = useRef<Map<string, string[]>>(new Map());

  useEffect(() => {
    const t = now();
    const due = dueGhosts(d.index, app.events, t, app.ghostsDone);
    slots.current = new Map(due.map((g) => [g.itemId, g.slots]));
    const seed = `ghost|${t}`;
    const items: StartItem[] = due.map((g) => d.index.byId.get(g.itemId)).filter((it) => it !== undefined)
      .map((it) => ({ itemId: it!.id, instances: buildQuestions(it!, d, d.settings.enabledQTypes, seed) }))
      .filter((x) => x.instances.length > 0);
    if (items.length) dispatch({ type: 'start', mode: 'extra', items, seed });
  }, []);

  // Each item finished in the ghost session clears its due slots.
  const completed = sess.tally.completed;
  useEffect(() => {
    const keys = completed.flatMap((id) => slots.current.get(id) ?? []);
    if (keys.length) void store.completeGhosts(keys);
  }, [completed.length]);

  if (sess.status === 'idle') {
    return (
      <div className="page narrow" data-testid="ghosts-empty">
        <h1>Ghost reviews</h1>
        <p className="empty">No ghost reviews are due.</p>
        <a className="btn btn-primary" href="#/">Home</a>
      </div>
    );
  }
  return (
    <QuizRunner sess={sess} dispatch={dispatch} index={d.index} mode="practice" onExit={() => navigate('#/')}
      label="Ghost review — practice, not scheduled"
      done={(
        <div className="page narrow summary" data-testid="ghosts-done">
          <h1>Ghosts cleared</h1>
          <p className="big-stat"><span>{sess.tally.correct}</span> correct · <span>{sess.tally.incorrect}</span> incorrect</p>
          <p className="muted">Practice only: your review schedule is unchanged.</p>
          <a className="btn btn-primary" href="#/">Home</a>
        </div>
      )} />
  );
}
