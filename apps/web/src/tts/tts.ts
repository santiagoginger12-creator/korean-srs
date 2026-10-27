// Text-to-speech via the Web Speech API (§13). Rules:
// - Only ever called from a user gesture handler (tap/click/submit). iOS ignores speech that
//   doesn't start inside a gesture, so there is no speech on page load or on a timer.
// - Korean voices only (lang ko*). Voices load asynchronously (`voiceschanged`), so the voice
//   list is a small external store that components subscribe to.
// - Never speak an answer before the user has submitted (callers enforce this; QuizRunner only
//   speaks from its submit/feedback handlers).
import type { AppSettings } from '@ksrs/srs-engine';

export interface TtsPrefs { rate: number; autoplay: boolean; voiceURI: string }

/** The M5 `tts.*` AppSettings keys (the M1 ttsRate/ttsAutoplay are superseded). */
export function ttsPrefs(settings: AppSettings): TtsPrefs {
  return {
    rate: Math.min(1.5, Math.max(0.5, settings['tts.rate'] ?? 1)),
    autoplay: settings['tts.autoplay'] === true,
    voiceURI: settings['tts.voiceURI'] ?? '',
  };
}

const synth = (): SpeechSynthesis | null => (typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null);

export const isKoVoice = (v: { lang: string }): boolean => /^ko([-_]|$)/i.test(v.lang);

type L = () => void;
const listeners = new Set<L>();
let voices: SpeechSynthesisVoice[] = [];
let wired = false;

function refresh(): void {
  const s = synth();
  const next = s ? s.getVoices().filter(isKoVoice) : [];
  const changed = next.length !== voices.length || next.some((v, i) => v.voiceURI !== voices[i]?.voiceURI);
  voices = next;
  if (changed) for (const l of listeners) l();
}

function wire(): void {
  if (wired) return;
  wired = true;
  const s = synth();
  if (!s) return;
  refresh();
  s.addEventListener?.('voiceschanged', refresh);
  // Some engines never fire voiceschanged; poll briefly after start-up.
  let n = 0;
  const id = setInterval(() => { refresh(); if (++n >= 10 || voices.length) clearInterval(id); }, 300);
}

export const koVoices = {
  subscribe(l: L): () => void { wire(); listeners.add(l); return () => { listeners.delete(l); }; },
  get(): SpeechSynthesisVoice[] { wire(); return voices; },
};

export const ttsAvailable = (): boolean => synth() !== null;

/** Speak Korean text. Returns false (and says nothing) when no Korean voice is available. */
export function speak(text: string, prefs: Pick<TtsPrefs, 'rate' | 'voiceURI'>): boolean {
  const s = synth();
  const t = text.trim();
  if (!s || !t) return false;
  const list = koVoices.get();
  const voice = list.find((v) => v.voiceURI === prefs.voiceURI) ?? list.find((v) => v.localService) ?? list[0];
  if (!voice) return false;
  s.cancel(); // tapping again restarts rather than queueing
  const u = new SpeechSynthesisUtterance(t);
  u.lang = voice.lang || 'ko-KR';
  u.voice = voice;
  u.rate = prefs.rate;
  s.speak(u);
  return true;
}
