import { useSyncExternalStore, type MouseEvent } from 'react';
import { useApp } from '../state/hooks.ts';
import { koVoices, speak, ttsAvailable, ttsPrefs } from './tts.ts';

const empty = () => () => {};
const NONE: SpeechSynthesisVoice[] = [];
const none = (): SpeechSynthesisVoice[] => NONE;

/** Speaker button for a Korean text. Hidden when the browser has no speech synthesis at all. */
export function Speaker({ text, label = 'Listen', className = '' }: { text: string; label?: string; className?: string }): JSX.Element | null {
  const app = useApp();
  const voices = useSyncExternalStore(ttsAvailable() ? koVoices.subscribe : empty, ttsAvailable() ? koVoices.get : none);
  if (!ttsAvailable() || !app.derived || !text || !text.trim()) return null;
  const noVoice = voices.length === 0;
  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    speak(text, ttsPrefs(app.derived!.settings));
  };
  return (
    <button type="button" className={`speaker ${className}`} onClick={onClick} disabled={noVoice}
      aria-label={noVoice ? 'No Korean voice installed' : `${label}: ${text}`} title={noVoice ? 'No Korean voice installed' : label}
      data-testid="speaker">
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
        <path d="M3 8h3l4-3.5v11L6 12H3z" fill="currentColor" />
        <path d="M13 7.2a4 4 0 0 1 0 5.6M15.2 5a7 7 0 0 1 0 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </button>
  );
}
