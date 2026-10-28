// Lesson batch: teach pages → lesson quiz (extra-study mode, no events) → lesson.completed.
// Hanja need no quiz: their lesson.completed is emitted when the teach pages are finished.
import { useEffect, useReducer, useState } from 'react';
import type { Item } from '@ksrs/content';
import { buildQuestions, emptySession, sessionReducer, type ReviewSession, type SessionAction, type StartItem } from '@ksrs/srs-engine';
import { ItemDetails, KindTag, NeedsReview } from '../../components/ItemDetails.tsx';
import { navigate } from '../../router.ts';
import { now, tz } from '../../state/clock.ts';
import { useApp } from '../../state/hooks.ts';
import { nextBatch, queueFor } from '../../state/lessons.ts';
import type { LessonPath } from '@ksrs/srs-engine';
import { store } from '../../state/store.ts';
import { QuizRunner } from '../reviews/QuizRunner.tsx';

type Phase = 'teach' | 'quiz' | 'done';
/** Beyond this many pages the dot row would crowd a phone screen; show just the counter. */
const MAX_DOTS = 12;

const quizReducer = (s: ReviewSession, a: SessionAction): ReviewSession => sessionReducer(s, a).sess;

export function Lessons({ path = 'vocab' }: { path?: LessonPath }): JSX.Element {
  const app = useApp();
  const d = app.derived!;
  // Freeze the batch at mount: emitting events changes the plan underneath us.
  const [batch, setBatch] = useState<Item[]>(() => nextBatch(queueFor(path, d, app.events, now(), tz, app.lessonOverride), d));
  const [phase, setPhase] = useState<Phase>('teach');
  const [page, setPage] = useState(0);
  const [quiz, dispatch] = useReducer(quizReducer, undefined, emptySession);

  const others = batch.filter((it) => it.kind !== 'hanja');

  const startQuiz = () => {
    const hanja = batch.filter((it) => it.kind === 'hanja').map((it) => it.id);
    if (hanja.length) void store.completeLessons(hanja);
    if (!others.length) { setPhase('done'); return; }
    const items: StartItem[] = others
      .map((it) => ({ itemId: it.id, instances: buildQuestions(it, d, d.settings.enabledQTypes, `lesson|${now()}`) }))
      .filter((x) => x.instances.length > 0);
    dispatch({ type: 'start', mode: 'extra', items, seed: `lesson|${now()}` });
    setPhase('quiz');
  };

  // Passing the quiz (every question answered correctly at least once) completes the lessons.
  const [completing, setCompleting] = useState(false);
  const finishQuiz = () => {
    if (completing) return;
    setCompleting(true);
    void store.completeLessons(others.map((it) => it.id)).then(() => { setPhase('done'); setCompleting(false); });
  };

  // Arrow keys page through teach pages.
  useEffect(() => {
    if (phase !== 'teach') return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') setPage((p) => Math.min(p + 1, batch.length - 1));
      if (e.key === 'ArrowLeft') setPage((p) => Math.max(p - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, batch.length]);

  if (batch.length === 0) {
    return (
      <div className="page narrow">
        <h1>{path === 'grammar' ? 'Grammar lessons' : 'Lessons'}</h1>
        <p className="empty">{path === 'grammar' ? 'No grammar lessons available right now.' : 'No lessons available right now.'}</p>
        <a className="btn btn-primary" href="#/">Home</a>
      </div>
    );
  }

  if (phase === 'done') {
    const again = () => {
      const st = store.getState();
      const fresh = nextBatch(queueFor(path, st.derived!, st.events, now(), tz, st.lessonOverride), st.derived!);
      setBatch(fresh); setPage(0); setPhase('teach');
    };
    const more = queueFor(path, d, app.events, now(), tz, app.lessonOverride).queue.length;
    return (
      <div className="page narrow summary" data-testid="lessons-done">
        <h1>Lessons learned</h1>
        <p className="chips">{batch.map((it) => <a key={it.id} className={`item-link k-${it.kind}`} href={`#/item/${encodeURIComponent(it.id)}`}>{label(it)}</a>)}</p>
        <p className="muted">First reviews arrive in about 4 hours.</p>
        <div className="row">
          {more > 0 && <button type="button" className="btn btn-primary" onClick={again}>Next batch ({more})</button>}
          <a className={`btn ${more > 0 ? 'btn-quiet' : 'btn-primary'}`} href="#/">Home</a>
        </div>
      </div>
    );
  }

  if (phase === 'quiz') {
    return (
      <QuizRunner
        sess={quiz}
        dispatch={dispatch}
        index={d.index}
        mode="quiz"
        onExit={() => navigate('#/')}
        done={(
          <div className="page narrow summary" data-testid="quiz-done">
            <h1>Quiz passed</h1>
            <p className="muted">{others.length} item{others.length === 1 ? '' : 's'} will enter your review schedule.</p>
            <button type="button" className="btn btn-primary" onClick={finishQuiz} disabled={completing} autoFocus>Finish lessons</button>
          </div>
        )}
      />
    );
  }

  const it = batch[page]!;
  const last = page === batch.length - 1;
  return (
    <div className={`page lesson k-${it.kind}`} data-testid="lesson-page" data-item-id={it.id} data-path={path}>
      <div className="lesson-bar">
        <button type="button" className="btn-text" onClick={() => navigate('#/')} aria-label="Leave lessons">✕</button>
        {batch.length <= MAX_DOTS
          ? (
            <ol className="dots" aria-label="Lesson pages">
              {batch.map((b, i) => (
                <li key={b.id}><button type="button" className={`dot k-${b.kind} ${i === page ? 'on' : ''}`} onClick={() => setPage(i)} aria-label={`Page ${i + 1}`} /></li>
              ))}
            </ol>
          )
          : <span className="count-only" />}
        <span className="muted">{page + 1}/{batch.length}</span>
      </div>
      <div className="card teach">
        <div className="q-head"><KindTag kind={it.kind} /><NeedsReview item={it} /><span className="muted">Level {it.level}</span></div>
        <ItemDetails item={it} index={d.index} />
      </div>
      <div className="lesson-nav">
        <button type="button" className="btn btn-quiet" disabled={page === 0} onClick={() => setPage(page - 1)}>Back</button>
        {last
          ? <button type="button" className="btn btn-primary" onClick={startQuiz} data-testid="start-quiz">{others.length ? 'Start quiz' : 'Finish'}</button>
          : <button type="button" className="btn btn-primary" onClick={() => setPage(page + 1)}>Next</button>}
      </div>
    </div>
  );
}

function label(it: Item): string {
  switch (it.kind) {
    case 'hanja': return it.char;
    case 'vocab': return it.word;
    case 'grammar': return it.pattern;
    case 'expression': return it.text;
  }
}
