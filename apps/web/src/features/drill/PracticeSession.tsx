// Practice (D88): a custom-study pass over a fixed list of cards that never changes the schedule.
// No events are written, so practising missed cards or leeches doesn't count as reviews.
// Again puts the card back near the end of the list (at most 3 times); any other grade clears it.
import { useEffect, useMemo, useState } from 'react';
import { parseCardId, type Rating } from '@ksrs/srs-engine';
import { useApp } from '../../state/hooks.ts';
import { speak, ttsPrefs } from '../../tts/tts.ts';
import { CardBack, CardFront } from './CardFaces.tsx';
import type { Deck } from './deck.ts';
import { drillAudio } from './DrillSession.tsx';
import { answerMode } from './modes/index.ts';

const MAX_AGAIN = 3;
const LABELS: Record<Rating, string> = { 1: 'again', 2: 'done', 3: 'done', 4: 'done' };

export function PracticeSession({ deck, cardIds, title, onDone }: {
  deck: Deck; cardIds: string[]; title: string; onDone: () => void;
}): JSX.Element {
  const app = useApp();
  const settings = app.derived!.settings;
  const [queue, setQueue] = useState<string[]>(() => cardIds.filter((id) => deck.byId.has(parseCardId(id).wordId)));
  const [revealed, setRevealed] = useState(false);
  const [again, setAgain] = useState<Map<string, number>>(new Map());
  const [done, setDone] = useState(0);
  const [step, setStep] = useState(0);
  const total = useMemo(() => queue.length, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cur = queue[0];
  const { wordId, dir } = cur ? parseCardId(cur) : { wordId: '', dir: 'f' as const };
  const word = deck.byId.get(wordId);

  const speakFor = (id: string | undefined) => {
    if (!id) return;
    const p = parseCardId(id);
    const w = deck.byId.get(p.wordId);
    if (w && p.dir === 'f' && (drillAudio(settings) === 'show' || settings['drill.answerMode'] === 'listen')) speak(w.headword, ttsPrefs(settings));
  };
  useEffect(() => { speakFor(queue[0]); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const reveal = () => {
    if (!word || revealed) return;
    setRevealed(true);
    const a = drillAudio(settings);
    if (a === 'reveal' || (a === 'show' && dir === 'r')) speak(word.headword, ttsPrefs(settings));
  };
  const grade = (r: Rating) => {
    if (!cur || !revealed) return;
    const n = again.get(cur) ?? 0;
    let next = queue.slice(1);
    if (r === 1 && n < MAX_AGAIN) {
      const at = Math.min(next.length, 4 + Math.floor(Math.random() * 3)); // a few cards later
      next = [...next.slice(0, at), cur, ...next.slice(at)];
      setAgain(new Map(again).set(cur, n + 1));
    } else setDone((d) => d + 1);
    setQueue(next);
    setStep((x) => x + 1);
    setRevealed(false);
    speakFor(next[0]);
  };

  if (!cur || !word) {
    const misses = [...again.values()].reduce((a, b) => a + b, 0);
    return (
      <div className="page narrow summary drill-summary" data-testid="practice-summary">
        <h1>{title}: done</h1>
        <p className="big-stat">{done} cards · {misses} again</p>
        <p className="muted">Practice doesn't change when cards are due.</p>
        <p><button type="button" className="btn btn-primary" onClick={onDone} data-testid="practice-back">Back to the drill</button></p>
      </div>
    );
  }

  const Mode = answerMode(settings['drill.answerMode']).Component;
  return (
    <div className="page narrow drill-session" data-testid="practice-session">
      <header className="drill-head">
        <button type="button" className="btn-text" onClick={onDone} data-testid="practice-end">End</button>
        <p className="drill-remaining" aria-label="Cards left"><span className="rem-review">{queue.length}</span></p>
        <span className="muted small">{done}/{total}</span>
      </header>
      <p className="drill-custom-title muted small" data-testid="drill-custom-title">{title} · practice, no schedule change</p>
      <Mode
        key={step}
        card={{ cardId: cur, dir, word }}
        front={<CardFront word={word} dir={dir} homograph={false} />}
        back={<CardBack word={word} dir={dir} credit={deck.credit} />}
        revealed={revealed}
        reveal={reveal}
        grade={grade}
        intervals={LABELS}
        paused={false}
      />
    </div>
  );
}
