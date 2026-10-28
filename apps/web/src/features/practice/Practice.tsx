// Extra study (§7.5): same QuizRunner, mode 'extra' — emits NO events and is labelled
// "Practice — not scheduled". Sources: recent lessons, trouble list, or a level/kind/stage filter.
import { useReducer, useState } from 'react';
import type { ItemKind } from '@ksrs/content';
import { ANKI_SHAKY_TAG, buildQuestions, emptySession, sessionReducer, type ReviewSession, type SessionAction, type StartItem } from '@ksrs/srs-engine';
import { extraStudy, type PracticeSource } from '../../data/contract.ts';
import { navigate } from '../../router.ts';
import { now } from '../../state/clock.ts';
import { useApp } from '../../state/hooks.ts';
import { QuizRunner } from '../reviews/QuizRunner.tsx';

const reducer = (s: ReviewSession, a: SessionAction): ReviewSession => sessionReducer(s, a).sess;
const STAGE_GROUPS = ['apprentice', 'guru', 'master', 'enlightened', 'burned'] as const;
export const PRACTICE_LIMIT = 20;

export function Practice({ preset }: { preset?: 'trouble' | 'recent' }): JSX.Element {
  const app = useApp();
  const d = app.derived!;
  const [kind, setKind] = useState<'recentLessons' | 'trouble' | 'filter' | 'tag'>(preset === 'trouble' ? 'trouble' : 'recentLessons');
  const [days, setDays] = useState(3);
  const [level, setLevel] = useState<number | ''>('');
  const [itemKind, setItemKind] = useState<ItemKind | ''>('');
  const [stage, setStage] = useState<typeof STAGE_GROUPS[number] | ''>('');
  const [sess, dispatch] = useReducer(reducer, undefined, emptySession);
  const [empty, setEmpty] = useState(false);
  const hasShaky = [...d.index.byId.values()].some((it) => it.kind !== 'hanja' && Array.isArray(it.tags) && it.tags.includes(ANKI_SHAKY_TAG));

  const start = () => {
    const src: PracticeSource = kind === 'recentLessons' ? { kind, days } : kind === 'trouble' ? { kind, limit: PRACTICE_LIMIT }
      : kind === 'tag' ? { kind, tag: ANKI_SHAKY_TAG }
      : { kind, ...(level !== '' ? { level } : {}), ...(itemKind ? { itemKind } : {}), ...(stage ? { stageGroup: stage } : {}) };
    const t = now();
    const seed = `practice|${t}`;
    const ids = extraStudy(d, src, t, seed, PRACTICE_LIMIT);
    const items: StartItem[] = ids.map((id) => d.index.byId.get(id)).filter((it) => it && it.kind !== 'hanja')
      .map((it) => ({ itemId: it!.id, instances: buildQuestions(it!, d, d.settings.enabledQTypes, seed) }))
      .filter((x) => x.instances.length > 0);
    setEmpty(items.length === 0);
    if (items.length) dispatch({ type: 'start', mode: 'extra', items, seed });
  };

  if (sess.status !== 'idle') {
    return (
      <QuizRunner sess={sess} dispatch={dispatch} index={d.index} mode="practice" onExit={() => navigate('#/')}
        done={(
          <div className="page narrow summary" data-testid="practice-done">
            <h1>Practice done</h1>
            <p className="big-stat"><span>{sess.tally.correct}</span> correct · <span>{sess.tally.incorrect}</span> incorrect</p>
            <p className="muted">Nothing was scheduled; your reviews are unchanged.</p>
            <div className="row"><button type="button" className="btn btn-primary" onClick={() => dispatch({ type: 'start', mode: 'extra', items: [], seed: 'reset' })}>Practice more</button><a className="btn btn-quiet" href="#/">Home</a></div>
          </div>
        )} />
    );
  }

  return (
    <div className="page narrow practice" data-testid="practice-page">
      <p><a className="btn-text" href="#/">← Home</a></p>
      <h1>Practice</h1>
      <p className="practice-label">Practice — not scheduled. Nothing you answer here changes your reviews.</p>
      <div className="card form">
        <fieldset className="field"><legend>What to practise</legend>
          <div className="segmented">
            {([['recentLessons', 'Recent lessons'], ['trouble', 'Trouble items'], ['filter', 'Filter'], ['tag', 'Anki shaky words']] as const)
              .filter(([k]) => k !== 'tag' || hasShaky).map(([k, label]) => (
                <label key={k} className={kind === k ? 'on' : ''}><input type="radio" name="src" checked={kind === k} onChange={() => setKind(k)} data-testid={`src-${k}`} />{label}</label>
              ))}
          </div>
        </fieldset>
        {kind === 'recentLessons' && (
          <label className="field"><span>Lessons from the last</span>
            <select value={String(days)} onChange={(e: { target: HTMLSelectElement }) => setDays(Number(e.target.value))}>
              {[1, 3, 7, 14, 30].map((n) => <option key={n} value={n}>{n} day{n === 1 ? '' : 's'}</option>)}
            </select>
          </label>
        )}
        {kind === 'filter' && (
          <>
            <label className="field"><span>Level</span>
              <select value={String(level)} onChange={(e: { target: HTMLSelectElement }) => setLevel(e.target.value ? Number(e.target.value) : '')}>
                <option value="">Any</option>{d.index.levels.map((L) => <option key={L} value={L}>Level {L}</option>)}
              </select>
            </label>
            <label className="field"><span>Kind</span>
              <select value={itemKind} onChange={(e: { target: HTMLSelectElement }) => setItemKind(e.target.value as ItemKind | '')}>
                <option value="">Any</option><option value="vocab">Vocabulary</option><option value="grammar">Grammar</option><option value="expression">Expressions</option>
              </select>
            </label>
            <label className="field"><span>Stage</span>
              <select value={stage} onChange={(e: { target: HTMLSelectElement }) => setStage(e.target.value as typeof STAGE_GROUPS[number] | '')}>
                <option value="">Any learned</option>{STAGE_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </label>
          </>
        )}
        {kind === 'tag' && <p className="muted small">Your imported Anki shaky words (tag <code>{ANKI_SHAKY_TAG}</code>), lesson or not; the ones you've missed in the app come first.</p>}
        <button type="button" className="btn btn-primary" onClick={start} data-testid="start-practice">Start practice</button>
        {empty && <p className="muted" role="status" data-testid="practice-empty">Nothing matches yet. Learn some lessons first, or widen the filter.</p>}
      </div>
    </div>
  );
}
