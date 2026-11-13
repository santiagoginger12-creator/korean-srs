// Fill in the blank (D86): the card's example sentence with the word blanked, plus its English
// translation. Type the missing word (as it appears in the sentence) and press Enter; the site
// says how close you were, shows the back, and you still grade yourself 1–4 (Again is suggested
// after a miss, Good after a hit). Enter on an empty field = "show me". Cards without an example
// sentence (or where the word can't be found in it) fall back to Flip.
import { useEffect, useMemo, useRef, useState } from 'react';
import { RATINGS, RATING_LABELS, type Rating } from '@ksrs/srs-engine';
import { HangulInput, type HangulInputHandle } from '../../../components/HangulInput.tsx';
import { useApp } from '../../../state/hooks.ts';
import { findBlank, gradeBlank, type BlankVerdict } from './cloze.ts';
import { FLIP_MODE, isRevealKey, ratingFromKey } from './FlipMode.tsx';
import type { AnswerMode, AnswerModeProps } from './types.ts';

const VERDICT_TEXT: Record<BlankVerdict, string> = {
  correct: 'Correct',
  close: 'Close: check the spelling',
  headword: 'Right word, but the sentence needs a different form',
  wrong: 'Not quite',
  blank: 'Answer',
};

function ClozeMode(p: AnswerModeProps): JSX.Element {
  const ex = p.card.word.example;
  const blank = useMemo(() => (ex ? findBlank(ex.ko, p.card.word.headword) : null), [ex, p.card.word.headword]);
  if (!ex || !blank) return <FLIP_MODE.Component {...p} />;
  return <ClozeCard key={p.card.cardId} {...p} blank={blank} en={ex.en} />;
}

function ClozeCard(p: AnswerModeProps & { blank: NonNullable<ReturnType<typeof findBlank>>; en: string }): JSX.Element {
  const app = useApp();
  const input = useRef<HangulInputHandle | null>(null);
  const [verdict, setVerdict] = useState<BlankVerdict | null>(null);
  const [typed, setTyped] = useState('');
  // A learning card can come straight back with the same id: start it fresh.
  useEffect(() => { if (!p.revealed) { setVerdict(null); setTyped(''); } }, [p.revealed]);
  const suggested: Rating | null = verdict === null ? null : verdict === 'correct' ? 3 : verdict === 'close' || verdict === 'headword' ? 2 : 1;

  const submit = (value: string) => {
    if (p.revealed || p.paused) return;
    setTyped(value.trim());
    setVerdict(gradeBlank(value, p.blank, p.card.word.headword));
    (document.activeElement as HTMLElement | null)?.blur(); // hand the keyboard to 1–4
    p.reveal();
  };

  const ref = useRef({ p, submit });
  ref.current = { p, submit };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const cur = ref.current.p;
      if (cur.paused) return;
      if (!cur.revealed && isRevealKey(e)) { e.preventDefault(); ref.current.submit(input.current?.value() ?? ''); return; }
      const r = ratingFromKey(e);
      if (r && cur.revealed) { e.preventDefault(); cur.grade(r); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <div className={`drill-card drill-cloze ${p.revealed ? 'is-revealed' : ''}`} data-testid="drill-card" data-card-id={p.card.cardId}
        data-dir={p.card.dir} data-revealed={p.revealed} data-mode="cloze">
        <div className="drill-front" data-testid="drill-front">
          <p className="drill-dir">Fill in the blank</p>
          <p className="drill-cloze-ko" lang="ko" data-testid="drill-cloze">
            {p.blank.before}
            {p.revealed
              ? <mark className={`cloze-fill v-${verdict ?? 'blank'}`} data-testid="drill-cloze-answer">{p.blank.answer}</mark>
              : <span className="cloze-gap" aria-label="blank">＿＿＿</span>}
            {p.blank.after}
          </p>
          <p className="drill-cloze-en" data-testid="drill-cloze-en">{p.en}</p>
        </div>
        {!p.revealed ? (
          <HangulInput
            lang="ko"
            handle={input}
            label="The missing word"
            placeholder="Type the missing word, then Enter"
            onSubmit={submit}
            autoFocus
            readOnly={p.paused}
            autoConvert={app.derived?.settings['input.autoConvert'] !== false}
          />
        ) : (
          <>
            <p className={`drill-verdict v-${verdict}`} data-testid="drill-verdict" data-verdict={verdict ?? ''}>
              {VERDICT_TEXT[verdict ?? 'blank']}{typed && verdict !== 'correct' ? <> · you wrote <span lang="ko">{typed}</span></> : null}
            </p>
            <div className="drill-back" data-testid="drill-back">{p.back}</div>
          </>
        )}
      </div>
      {!p.revealed ? (
        <div className="drill-actions">
          <button type="button" className="btn btn-quiet drill-show" onClick={() => submit(input.current?.value() ?? '')} disabled={p.paused} data-testid="drill-show">
            Check <kbd>Enter</kbd>
          </button>
        </div>
      ) : (
        <div className="drill-actions drill-ratings" role="group" aria-label="How well did you know it?">
          {RATINGS.map((r) => (
            <button key={r} type="button" className={`btn drill-rate rate-${r} ${suggested === r ? 'is-suggested' : ''}`} onClick={() => p.grade(r)} disabled={p.paused}
              data-testid={`drill-rate-${r}`} aria-keyshortcuts={String(r)}>
              <span className="rate-ivl" data-testid={`drill-ivl-${r}`}>{p.intervals[r]}</span>
              <span className="rate-label">{RATING_LABELS[r]}</span>
              <kbd>{r}</kbd>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export const CLOZE_MODE: AnswerMode = {
  id: 'cloze',
  label: 'Fill in the blank',
  description: 'Type the missing word in an example sentence, check it, then grade yourself. Words without a sentence yet use Flip.',
  Component: ClozeMode,
};
