// End-of-session actions (D75): Home, Lessons, Grammar lessons, Reviews, Drill, each with a key.
// → goes Home; L / G / R / D jump straight to lessons, grammar lessons, reviews or the drill (D84)
// when any are waiting. Keys are the `finish.*` shortcuts (D87), rebindable in Settings.
import { useEffect, useRef } from 'react';
import { dueItems } from '@ksrs/srs-engine';
import { navigate } from '../router.ts';
import { now, tz } from '../state/clock.ts';
import { useApp } from '../state/hooks.ts';
import { planAll } from '../state/lessons.ts';
import { drillSummary, drillWaiting } from '../state/drill.ts';
import { DECK_META } from '../features/drill/deck.ts';
import { inField, Kbd, matches, useHotkey } from '../state/hotkeys.tsx';

type Action = () => void;

export function NextSteps(props: {
  /** Runs before leaving (e.g. close the review session). */
  beforeLeave?: () => Promise<void> | void;
  /** Override where a destination goes (e.g. "next batch" in place, or restart reviews here). */
  onLessons?: Action;
  onGrammar?: Action;
  onReviews?: Action;
  onDrill?: Action;
}): JSX.Element {
  const app = useApp();
  const d = app.derived!;
  const t = now();
  const plans = planAll(d, app.events, t, tz, app.lessonOverride);
  const lessons = plans.vocab.queue.length;
  const grammar = plans.grammar.queue.length;
  const due = dueItems(d, t).length;
  const drill = DECK_META.count ? drillWaiting(drillSummary(app.drill, d.settings, DECK_META, t, tz)) : 0;

  const leave = (go: Action) => () => {
    const r = props.beforeLeave?.();
    if (r && typeof (r as Promise<void>).then === 'function') void (r as Promise<void>).then(go);
    else go();
  };
  const home = leave(() => navigate('#/'));
  const toLessons = lessons ? (props.onLessons ?? leave(() => navigate('#/lessons'))) : null;
  const toGrammar = grammar ? (props.onGrammar ?? leave(() => navigate('#/lessons/grammar'))) : null;
  const toReviews = due ? (props.onReviews ?? leave(() => navigate('#/reviews'))) : null;
  const toDrill = drill ? (props.onDrill ?? leave(() => navigate('#/drill/start'))) : null;

  const keys = useRef({ home, toLessons, toGrammar, toReviews, toDrill });
  keys.current = { home, toLessons, toGrammar, toReviews, toDrill };
  useEffect(() => {
    let used = false; // one key press leaves once, even if held down
    const onKey = (e: KeyboardEvent) => {
      if (inField(e) || e.repeat || used) return;
      const k = keys.current;
      // Physical keys (e.code), so they work while the Korean input source is on (D75, D87).
      const act = matches('finish.home', e) ? k.home
        : matches('finish.lessons', e) ? k.toLessons
        : matches('finish.grammar', e) ? k.toGrammar
        : matches('finish.reviews', e) ? k.toReviews
        : matches('finish.drill', e) ? k.toDrill : null;
      if (!act) return;
      e.preventDefault();
      used = true;
      act();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="row next-steps" data-testid="next-steps">
      <button type="button" className="btn btn-primary" onClick={home} data-testid="next-home">Home <Kbd id="finish.home" /></button>
      {toLessons && <button type="button" className="btn btn-quiet" onClick={toLessons} data-testid="next-lessons">Lessons ({lessons}) <Kbd id="finish.lessons" /></button>}
      {toGrammar && <button type="button" className="btn btn-quiet" onClick={toGrammar} data-testid="next-grammar">Grammar lessons ({grammar}) <Kbd id="finish.grammar" /></button>}
      {toReviews && <button type="button" className="btn btn-quiet" onClick={toReviews} data-testid="next-reviews">Reviews ({due}) <Kbd id="finish.reviews" /></button>}
      {toDrill && <button type="button" className="btn btn-quiet" onClick={toDrill} data-testid="next-drill">Drill ({drill}) <Kbd id="finish.drill" /></button>}
    </div>
  );
}

/** Presses `run` on the finish-screen Home key (→; used where one step remains, e.g. "Finish lessons"). Renders nothing. */
export function ArrowRightDoes({ run }: { run: Action }): null {
  useHotkey('finish.home', () => run(), true, { once: true });
  return null;
}
