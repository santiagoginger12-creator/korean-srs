// The question/answer loop shared by reviews (events) and the lesson quiz (extra-study mode,
// no events). The engine's sessionReducer owns the queue; this component owns only transient
// UI state (feedback panel, close-attempt hint, shake).
//
// Keyboard: Enter submits; on the feedback panel Enter (or the Next button) advances and
// Backspace undoes the answer (the input is read-only there, so Backspace can't mean "edit").
// Nuance options: 1–3 pick an option.

import { useEffect, useRef, useState, type KeyboardEvent as RKeyboardEvent } from 'react';
import type { Item, QuestionInstance } from '@ksrs/content';
import { check, type CheckResult } from '@ksrs/answer-check';
import { currentQuestion, type ContentIndex, type ReviewSession, type SessionAction } from '@ksrs/srs-engine';
import { HangulInput, type HangulInputHandle } from '../../components/HangulInput.tsx';
import { checkOptionsFor } from '../../state/checkOpts.ts';
import { dictForm, HINT_MISS_TEXT, initialsHint, isLexicalCloze, maxClozeHintLevel, shortMeaning, splitCue, withHint, type HintLevel } from '../../state/hints.ts';
import { now } from '../../state/clock.ts';
import { itemHref, KIND_KO, QTYPE_LABEL, SPEECH_LEVEL } from '../../state/format.ts';
import { useApp } from '../../state/hooks.ts';
import { Speaker } from '../../tts/Speaker.tsx';
import { FeedbackExample } from '../../components/DictExamples.tsx';
import { speak, ttsPrefs } from '../../tts/tts.ts';

export interface Feedback {
  q: QuestionInstance;
  response: string;
  result: CheckResult;
  grade: 'correct' | 'incorrect';
  overridden: boolean;
  /** Correct, but after the full (level-2) cloze hint: graded as a miss. */
  hintPenalty?: boolean;
  /** The item's completed-review count when this answer was submitted (picks the example). */
  reviewCount: number;
}

interface Props {
  sess: ReviewSession;
  dispatch: (a: SessionAction) => void;
  index: ContentIndex;
  mode: 'review' | 'quiz' | 'practice';
  /** Rendered when the session is done and no feedback is open. */
  done: JSX.Element;
  /** Review mode: wrap-up and exit controls. */
  onWrapUp?: () => void;
  onExit: () => void;
  /** Practice-mode banner text (default "Practice — not scheduled"). */
  label?: string;
}

const isKoInput = (q: QuestionInstance): boolean => q.qtype !== 'meaning' && q.qtype !== 'nuance';

export function QuizRunner({ sess, dispatch, index, mode, done, onWrapUp, onExit, label }: Props): JSX.Element {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [hint, setHint] = useState<{ text: string; converted?: string } | null>(null);
  const [shake, setShake] = useState(0);
  const [acceptFuture, setAcceptFuture] = useState(false);
  const [hintLevel, setHintLevel] = useState<HintLevel>(0);
  const input = useRef<HangulInputHandle | null>(null);
  const nextBtn = useRef<HTMLButtonElement | null>(null);
  const startedAt = useRef(now());
  const app = useApp();
  const q = feedback ? feedback.q : currentQuestion(sess);
  const qKey = q ? `${q.qid}|${sess.history.length}` : 'none';

  // A new question starts its timer and clears transient state.
  useEffect(() => {
    if (feedback) return;
    startedAt.current = now();
    setHint(null);
    setAcceptFuture(false);
    input.current?.focus();
  }, [qKey, feedback]);
  // The hint ladder restarts only when a different question comes up (not after a close retry).
  useEffect(() => { setHintLevel(0); }, [qKey]);

  const submit = (response: string) => {
    if (feedback) { next(); return; }
    if (!q) return;
    const checked = check(q, response, checkOptionsFor(index));
    // Cloze hint ladder: the level goes into check.layer; a correct answer at level 2 is a miss.
    const { hintPenalty, ...result } = q.qtype === 'cloze' ? withHint(checked, hintLevel) : { ...checked, hintPenalty: false };
    const at = now();
    // Read before dispatching: completing the item's review group bumps the count.
    const reviewCount = app.derived?.items.get(q.itemId)?.stats.reviews ?? 0;
    if (result.outcome === 'close') {
      setHint({ text: result.hint ?? 'Almost. Try again.', converted: result.converted });
      setShake((n) => n + 1);
      dispatch({ type: 'answer', qid: q.qid, response, result: { outcome: 'close', layer: result.layer }, durationMs: at - startedAt.current, at });
      return;
    }
    const outcome = { outcome: result.outcome, layer: result.layer, ...(result.matched !== undefined ? { matched: result.matched } : {}) };
    dispatch({ type: 'answer', qid: q.qid, response, result: outcome, durationMs: Math.max(0, at - startedAt.current), at });
    setHint(null);
    // Autoplay only after a graded submit (a user gesture), never before (§13).
    if (app.derived) {
      const prefs = ttsPrefs(app.derived.settings);
      if (prefs.autoplay) speak(spokenAnswer(q, result), prefs);
    }
    setFeedback({ q, response, result, grade: result.outcome, overridden: false, hintPenalty, reviewCount });
  };

  const next = () => {
    setFeedback(null);
    input.current?.clear();
  };

  const undo = () => {
    const last = sess.history[sess.history.length - 1];
    if (!last) return;
    dispatch({ type: 'undo', at: now() });
    if (feedback?.overridden) { setFeedback({ ...feedback, overridden: false, grade: 'incorrect' }); return; }
    setFeedback(null);
    // Put the previous response back so it can be corrected (input is uncontrolled).
    setTimeout(() => { input.current?.setValue(last.response); input.current?.focus(); }, 0);
  };

  const iWasRight = () => {
    if (!feedback || feedback.grade !== 'incorrect') return;
    dispatch({ type: 'override', at: now(), acceptAnswer: mode === 'review' && acceptFuture && isKoOrEn(feedback.q) });
    setFeedback({ ...feedback, grade: 'correct', overridden: true, hintPenalty: false });
  };

  // Document-level keys for when focus isn't in the answer input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      const editable = (tag === 'INPUT' && !(t as HTMLInputElement).readOnly) || tag === 'TEXTAREA' || tag === 'SELECT';
      if (feedback) {
        if (e.key === 'Enter' && tag !== 'INPUT' && tag !== 'BUTTON' && tag !== 'A') { e.preventDefault(); next(); }
        else if (e.key === 'Backspace' && !editable) { e.preventDefault(); undo(); }
        return;
      }
      if (q?.qtype === 'nuance' && !editable && /^[1-9]$/.test(e.key)) {
        const opt = q.options[Number(e.key) - 1];
        if (opt) { e.preventDefault(); submit(opt.key); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (feedback && feedback.q.qtype === 'nuance') nextBtn.current?.focus();
  }, [feedback]);

  if (!q) return done;

  const item = index.byId.get(q.itemId);
  const kind = item?.kind ?? 'vocab';
  const remaining = Object.values(sess.items).filter((i) => !i.complete).length;
  const total = Object.keys(sess.items).length;
  const answered = sess.tally.correct + sess.tally.incorrect;
  const pct = answered ? Math.round((sess.tally.correct / answered) * 100) : 100;

  return (
    <div className={`quiz k-${kind}`} data-mode={mode}>
      <div className="quiz-bar">
        <button type="button" className="btn-text" onClick={onExit} aria-label="Leave session">✕</button>
        <div className="progress" aria-label="Progress">
          <div className="progress-fill" style={{ width: `${total ? ((total - remaining) / total) * 100 : 0}%` }} />
        </div>
        <span className="quiz-stats" data-testid="remaining">{remaining} left · {pct}%</span>
      </div>
      {mode === 'quiz' && <p className="practice-label">Lesson quiz · practice, not scheduled</p>}
      {mode === 'practice' && <p className="practice-label" data-testid="practice-label">{label ?? 'Practice — not scheduled'}</p>}
      {sess.wrappingUp && <p className="practice-label">Wrapping up: finishing items already started</p>}

      <article className="card question" data-testid="question" data-qtype={q.qtype} data-item-id={q.itemId}
               data-prompt-id={q.promptId ?? ''} data-qid={q.qid} data-hint-level={q.qtype === 'cloze' ? hintLevel : undefined}>
        <div className="q-head">
          <span className={`kind-tag k-${kind}`}>{KIND_KO[kind]}</span>
          <span className="qtype">{QTYPE_LABEL[q.qtype]}</span>
          {q.qtype === 'cloze' && !feedback && hintLevel < maxClozeHintLevel(q.itemId, item, q.cue) && (
            <button type="button" className="btn btn-small btn-quiet hint-btn" data-testid="hint-btn"
                    onClick={() => { setHintLevel((l) => (Math.min(maxClozeHintLevel(q.itemId, item, q.cue), l + 1) as HintLevel)); input.current?.focus(); }}>
              {hintLevel === 0 ? 'Hint' : 'More hint'}
            </button>
          )}
        </div>
        <Prompt q={q} item={item} hintLevel={feedback ? 2 : hintLevel} />
      </article>

      {q.qtype === 'nuance'
        ? <NuanceOptions q={q} feedback={feedback} onPick={(key) => submit(key)} />
        : (
          <HangulInput
            key={q.qid}
            handle={input}
            lang={isKoInput(q) ? 'ko' : 'en'}
            label={isKoInput(q) ? 'Answer in Korean' : 'Answer in English'}
            placeholder={isKoInput(q) ? '한글로 입력' : 'Type in English'}
            autoConvert={app.derived?.settings['input.autoConvert'] !== false}
            readOnly={!!feedback}
            onSubmit={submit}
            autoFocus
            className="answer-form"
            inputClassName={`answer ${feedback ? (feedback.grade === 'correct' ? 'is-correct' : 'is-incorrect') : ''} ${shake ? 'shake' : ''}`}
            onAnimationEnd={() => setShake(0)}
          >
            <button type="submit" className="btn btn-submit" aria-label={feedback ? 'Continue' : 'Submit'}>{feedback ? '→' : '↵'}</button>
          </HangulInput>
        )}

      {hint && !feedback && (
        <div className="hint" role="status" data-testid="hint">
          <span>{hint.text}</span>
          {hint.converted && (
            <button type="button" className="btn btn-small" onClick={() => { input.current?.setValue(hint.converted!); input.current?.focus(); setHint(null); }}>
              Use <span lang={q && !isKoInput(q) ? 'en' : 'ko'}>{hint.converted}</span>
            </button>
          )}
        </div>
      )}

      {feedback && (
        <FeedbackPanel fb={feedback} index={index} includeDict={app.derived?.settings['examples.dictionary'] !== false} acceptFuture={acceptFuture} setAcceptFuture={setAcceptFuture}
                       persists={mode === 'review'} onUndo={undo} onRight={iWasRight} onNext={next} nextRef={nextBtn} />
      )}

      {!feedback && (
        <div className="quiz-actions">
          {sess.history.length > 0 && <button type="button" className="btn-text" onClick={undo}>Undo last answer</button>}
          {mode === 'review' && onWrapUp && !sess.wrappingUp && <button type="button" className="btn-text" onClick={onWrapUp}>Wrap up</button>}
        </div>
      )}
    </div>
  );
}

const isKoOrEn = (q: QuestionInstance): boolean => q.qtype !== 'nuance';

/** The Korean to read aloud once a question has been answered (the right answer in context). */
export function spokenAnswer(q: QuestionInstance, result: { matched?: string }): string {
  switch (q.qtype) {
    case 'meaning': return q.promptKo;
    case 'production': return result.matched ?? q.accepted[0] ?? '';
    case 'cloze': return `${q.before}${result.matched ?? q.accepted[0] ?? ''}${q.after}`;
    case 'register': return result.matched ?? q.accepted[0] ?? '';
    case 'nuance': return q.options.find((o) => o.key === q.correctKey)?.text ?? '';
  }
}

function Prompt({ q, item, hintLevel }: { q: QuestionInstance; item: Item | undefined; hintLevel: HintLevel }): JSX.Element {
  switch (q.qtype) {
    case 'meaning':
      return (<><div className="prompt-ko" lang="ko">{q.promptKo}</div><p className="ask">What does it mean? <span className="muted">(English)</span></p></>);
    case 'production':
      return (<><div className="prompt-en">{q.promptEn}</div>
        {q.contextHint ? <p className="context-hint">{q.contextHint}</p> : null}
        <p className="ask">Say it in Korean</p></>);
    case 'cloze': {
      if (isLexicalCloze(q.itemId, item)) {
        // Vocab/expression ladder (D74): English cue → 초성 + syllable count → dictionary form.
        const initials = initialsHint(dictForm(item), q.before, q.after);
        const dict = dictForm(item);
        return (<>
          <p className="cloze-sentence" lang="ko">{q.before}<span className="blank" aria-label="blank">　　　</span>{q.after}</p>
          <p className="cue" lang="en" data-testid="cue-en">{q.cue}</p>
          {hintLevel >= 1 && initials && <p className="hint-initials" lang="ko" data-testid="hint-initials" aria-label={`Initial consonants: ${initials}`}>{initials}</p>}
          {hintLevel >= 2 && dict && <p className="hint-dict" lang="ko" data-testid="hint-dict">{dict}</p>}
          <p className="gloss-en">{q.en}</p>
        </>);
      }
      const cue = splitCue(q.cue);
      const meaning = shortMeaning(item);
      return (<>
        <p className="cloze-sentence" lang="ko">{q.before}<span className="blank" aria-label="blank">　　　</span>{q.after}</p>
        <p className="cue" lang="ko"><span data-testid="cue-base">{cue.base}</span>
          {cue.pattern && hintLevel >= 2 && <> + <span className="cue-pattern" data-testid="hint-pattern">{cue.pattern}</span></>}</p>
        {hintLevel >= 1 && meaning && <p className="hint-meaning" data-testid="hint-meaning">{meaning}</p>}
        <p className="gloss-en">{q.en}</p>
      </>);
    }
    case 'register': {
      const from = SPEECH_LEVEL[q.from];
      const to = SPEECH_LEVEL[q.to];
      return (<>
        <p className="register-source" lang="ko">{q.source}</p>
        <p className="register-arrow"><span lang="ko">{from.ko}</span> → <strong lang="ko">{to.ko}</strong> <span className="muted">({to.en})</span></p>
        <p className="ask">Rewrite it in the target speech level</p>
      </>);
    }
    case 'nuance':
      return (<><p className="situation" lang="ko">{q.situation}</p><p className="ask">Which fits best?</p></>);
  }
}

function NuanceOptions({ q, feedback, onPick }: { q: Extract<QuestionInstance, { qtype: 'nuance' }>; feedback: Feedback | null; onPick: (key: string) => void }): JSX.Element {
  return (
    <ol className="options">
      {q.options.map((o, i) => {
        const picked = feedback?.response === o.key;
        const isCorrect = o.key === q.correctKey;
        const cls = feedback ? (isCorrect ? 'opt-correct' : picked ? 'opt-wrong' : 'opt-dim') : '';
        return (
          <li key={o.key}>
            <button type="button" className={`option ${cls}`} disabled={!!feedback} onClick={() => onPick(o.key)} data-key={o.key}>
              <span className="opt-num">{i + 1}</span><span lang="ko">{o.text}</span>
            </button>
            {feedback && <p className="why">{isCorrect ? '✓ ' : picked ? '✗ ' : ''}{o.why}</p>}
          </li>
        );
      })}
    </ol>
  );
}

interface FbProps {
  fb: Feedback; index: ContentIndex; includeDict: boolean; acceptFuture: boolean; setAcceptFuture: (v: boolean) => void;
  /** False in practice and lesson quizzes, which emit no events: nothing is saved, so don't offer to. */
  persists: boolean;
  onUndo: () => void; onRight: () => void; onNext: () => void; nextRef: { current: HTMLButtonElement | null };
}

function FeedbackPanel({ fb, index, includeDict, acceptFuture, setAcceptFuture, persists, onUndo, onRight, onNext, nextRef }: FbProps): JSX.Element {
  const { q, result } = fb;
  const correct = fb.grade === 'correct';
  const shown = q.qtype === 'nuance' ? q.options.find((o) => o.key === q.correctKey)?.text : result.matched ?? acceptedOf(q)[0];
  const onKeyDownNext = (e: RKeyboardEvent<HTMLButtonElement>) => { if (e.key === 'Backspace') { e.preventDefault(); onUndo(); } };
  return (
    <section className={`feedback ${correct ? 'fb-correct' : 'fb-incorrect'}`} role="status" data-testid="feedback" data-grade={fb.grade}
             data-hint-penalty={fb.hintPenalty ? 'true' : undefined}>
      <p className="fb-verdict">
        {correct ? (fb.overridden ? 'Marked correct (self-graded)' : 'Correct') : fb.hintPenalty ? HINT_MISS_TEXT : 'Incorrect'}
        {result.layer.split('+')[0] === 'variant' && correct && !fb.overridden ? <span className="badge">variant</span> : null}
      </p>
      {shown && q.qtype !== 'nuance' && (
        <p className="fb-answer"><span className="label">{correct ? 'Matched' : 'Answer'}</span> <span lang={q.qtype === 'meaning' ? 'en' : 'ko'}>{shown}</span></p>
      )}
      {q.qtype !== 'nuance' && (!correct || fb.overridden) && (
        <p className="fb-response"><span className="label">You wrote</span> <span data-testid="fb-response" lang={q.qtype === 'meaning' ? 'en' : 'ko'}>{fb.response}</span></p>
      )}
      {!correct && result.hint && !fb.hintPenalty && <p className="fb-hint">{result.hint}</p>}
      {result.notes.length > 0 && <ul className="fb-notes">{result.notes.map((n, i) => <li key={i} lang="ko">{n}</li>)}</ul>}
      <FeedbackExample item={index.byId.get(q.itemId)} reviewCount={fb.reviewCount} includeDict={includeDict} />
      <div className="fb-actions">
        <button type="button" className="btn btn-quiet" onClick={onUndo}>Undo</button>
        {!correct && (
          <>
            <button type="button" className="btn btn-quiet" onClick={onRight}>I was right</button>
            {persists && !fb.hintPenalty && q.qtype !== 'nuance' && fb.response.trim() !== '' && (
              <label className="check"><input type="checkbox" checked={acceptFuture} onChange={(e: { target: HTMLInputElement }) => setAcceptFuture(e.target.checked)} /> Accept this answer in future</label>
            )}
          </>
        )}
        <Speaker text={spokenAnswer(q, result)} label="Listen to the answer" />
        <a className="btn-text" href={itemHref(q.itemId)} target="_self">View item</a>
        <button type="button" className="btn btn-primary" ref={nextRef} onClick={onNext} onKeyDown={onKeyDownNext}>Next</button>
      </div>
    </section>
  );
}

function acceptedOf(q: QuestionInstance): string[] {
  return q.qtype === 'nuance' ? [] : q.accepted;
}
