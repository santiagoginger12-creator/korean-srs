// Listening mode (D88): a Korean → English card shows no text, only a play button; the word is
// spoken as the card appears (DrillSession does that from the answer handler, so iOS allows it).
// Recall the meaning, flip, and grade as in Flip. The back shows the written word first.
// English → Korean cards, and devices without a Korean voice, fall back to the normal front.
import { useSyncExternalStore } from 'react';
import { koVoices, speak, ttsAvailable, ttsPrefs } from '../../../tts/tts.ts';
import { useApp } from '../../../state/hooks.ts';
import { Kbd } from '../../../state/hotkeys.tsx';
import { Speaker } from '../../../tts/Speaker.tsx';
import { FLIP_MODE } from './FlipMode.tsx';
import type { AnswerMode, AnswerModeProps } from './types.ts';

const empty = () => () => {};
const NONE: SpeechSynthesisVoice[] = [];
const none = (): SpeechSynthesisVoice[] => NONE;

export function useHasKoVoice(): boolean {
  const voices = useSyncExternalStore(ttsAvailable() ? koVoices.subscribe : empty, ttsAvailable() ? koVoices.get : none);
  return ttsAvailable() && voices.length > 0;
}

function ListenMode(p: AnswerModeProps): JSX.Element {
  const app = useApp();
  const hasVoice = useHasKoVoice();
  const Flip = FLIP_MODE.Component;
  if (p.card.dir === 'r') return <Flip {...p} />;
  if (!hasVoice) {
    return (
      <>
        <p className="notice small" data-testid="drill-listen-novoice">No Korean voice on this device, so the word is shown instead. Add a Korean voice in your system settings to use listening mode.</p>
        <Flip {...p} />
      </>
    );
  }
  const play = () => speak(p.card.word.headword, ttsPrefs(app.derived!.settings));
  const front = (
    <div className="drill-front drill-listen-front" data-testid="drill-front">
      <p className="drill-dir">Listen</p>
      <button type="button" className="drill-listen-play" data-testid="drill-listen-play" aria-label="Play the word"
        onClick={(e: { stopPropagation(): void }) => { e.stopPropagation(); play(); }}>
        <svg viewBox="0 0 20 20" width="44" height="44" aria-hidden="true">
          <path d="M3 8h3l4-3.5v11L6 12H3z" fill="currentColor" />
          <path d="M13 7.2a4 4 0 0 1 0 5.6M15.2 5a7 7 0 0 1 0 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      <p className="muted small">Replay <Kbd id="drill.speak" /></p>
    </div>
  );
  const back = (
    <>
      <div className="drill-answer-ko">
        <p className="drill-word" lang="ko" data-testid="drill-listen-word">{p.card.word.headword}</p>
        <Speaker text={p.card.word.headword} />
      </div>
      {p.back}
    </>
  );
  return <Flip {...p} front={p.revealed ? <></> : front} back={back} />;
}

export const LISTEN_MODE: AnswerMode = {
  id: 'listen',
  label: 'Listening',
  description: 'Hear the word without seeing it, recall the meaning, then flip and grade yourself. Needs a Korean voice on the device.',
  Component: ListenMode,
};
