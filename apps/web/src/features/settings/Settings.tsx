import { useState, useSyncExternalStore } from 'react';
import type { Settings as S } from '@ksrs/srs-engine';
import { useApp } from '../../state/hooks.ts';
import { store } from '../../state/store.ts';
import { koVoices, speak, ttsAvailable, ttsPrefs } from '../../tts/tts.ts';
import { DEFAULT_SOURCE } from '../../data/examples.ts';
import { useExamplesData } from '../../components/DictExamples.tsx';
import { isArtifact } from '../../host.ts';
import { SYNC_UNAVAILABLE, useSync } from './SyncPage.tsx';

const SAMPLE = '천천히 또박또박 읽어 볼게요.';

export function Settings(): JSX.Element {
  const app = useApp();
  const s = app.derived!.settings;
  const [rebuilt, setRebuilt] = useState<string>('');
  const set = <K extends keyof S>(k: K, v: S[K]) => { if (s[k] !== v) void store.setSetting(k, v); };
  const num = (v: string, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number(v) || lo)));

  return (
    <div className="page narrow settings">
      <p><a className="btn-text" href="#/">← Home</a></p>
      <h1>Settings</h1>
      <div className="card form">
        <label className="field"><span>Lesson batch size</span>
          <select value={String(s.lessonBatch)} data-testid="set-batch" onChange={(e: { target: HTMLSelectElement }) => set('lessonBatch', Number(e.target.value))}>
            {[3, 4, 5, 6, 8, 10, 15, 20].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="field"><span>Grammar lessons per day</span>
          <select value={String(s['grammar.dailyLessons'])} data-testid="set-grammar-daily" disabled={!s['grammar.separatePath']}
            onChange={(e: { target: HTMLSelectElement }) => void store.setAppSetting('grammar.dailyLessons', Number(e.target.value))}>
            {[0, 1, 2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={s['grammar.separatePath']} data-testid="set-grammar-separate"
          onChange={(e: { target: HTMLInputElement }) => void store.setAppSetting('grammar.separatePath', e.target.checked)} /> Grammar on its own path (separate lessons and stages)</label>
        <label className="field"><span>Daily review target (minutes)</span>
          <input type="number" min={5} max={180} step={5} defaultValue={s.targetReviewMin} inputMode="numeric"
            onBlur={(e: { target: HTMLInputElement }) => set('targetReviewMin', num(e.target.value, 5, 180))} />
        </label>
        <label className="field"><span>Day starts at</span>
          <select value={String(s.dayStartHour)} onChange={(e: { target: HTMLSelectElement }) => set('dayStartHour', Number(e.target.value))}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </select>
        </label>
        <fieldset className="field"><legend>Theme</legend>
          <div className="segmented">
            {(['system', 'light', 'dark'] as const).map((th) => (
              <label key={th} className={s.theme === th ? 'on' : ''}>
                <input type="radio" name="theme" value={th} checked={s.theme === th} onChange={() => set('theme', th)} />{th}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <TtsSettings />
      <div className="card form" data-testid="examples-settings">
        <h3>Example sentences</h3>
        <label className="check"><input type="checkbox" checked={s['examples.dictionary'] !== false} data-testid="set-dict-examples"
          onChange={(e: { target: HTMLInputElement }) => void store.setAppSetting('examples.dictionary', e.target.checked)} /> Dictionary examples in reviews</label>
        <p className="muted small">After you answer, a vocab or expression review shows one example, rotating through the item's own examples and 한국어기초사전 examples. Off: only the item's own.</p>
      </div>
      <SyncCard />
      <div className="card form">
        <h3>Data</h3>
        <p><a className="btn btn-quiet" href="#/data" data-testid="open-data">Backup, sync and import →</a></p>
        <p className="muted">Your progress is an event log on this device ({app.events.length} events). Rebuilding replays it from scratch.</p>
        <button type="button" className="btn btn-quiet" data-testid="rebuild" onClick={() => {
          setRebuilt('Rebuilding…');
          void store.rebuild().then((r) => setRebuilt(`Rebuilt from ${r.events} events in ${r.ms.toFixed(0)} ms.`));
        }}>Rebuild from log</button>
        {rebuilt && <p className="muted" role="status">{rebuilt}</p>}
        <p className="muted small">Device {app.deviceId}</p>
      </div>
      <ExamplesCredit />
    </div>
  );
}

function SyncCard(): JSX.Element {
  const s = useSync();
  return (
    <div className="card form" data-testid="sync-settings">
      <h3>Sync</h3>
      {isArtifact ? <p className="muted small" data-testid="sync-unavailable">{SYNC_UNAVAILABLE}</p> : (
        <>
          <p><a className="btn btn-quiet" href="#/settings/sync" data-testid="open-sync">GitHub sync: {s.config.enabled ? 'on' : 'off'} →</a></p>
          <p className="muted small">Keep your phone and laptop in step through your private GitHub repository.</p>
        </>
      )}
    </div>
  );
}

const noop = () => () => {};
const NONE: SpeechSynthesisVoice[] = [];

function TtsSettings(): JSX.Element {
  const app = useApp();
  const prefs = ttsPrefs(app.derived!.settings);
  const supported = ttsAvailable();
  const voices = useSyncExternalStore(supported ? koVoices.subscribe : noop, supported ? koVoices.get : () => NONE);
  const [rate, setRate] = useState(prefs.rate);
  return (
    <div className="card form" data-testid="tts-settings">
      <h3>Pronunciation (text-to-speech)</h3>
      {!supported ? <p className="muted">This browser has no speech synthesis.</p> : voices.length === 0 ? (
        <p className="muted" data-testid="no-ko-voice">No Korean voice installed. On iPhone: Settings → Accessibility → Spoken Content → Voices → Korean. Speaker buttons stay disabled until one is available.</p>
      ) : (
        <>
          <label className="field"><span>Voice</span>
            <select value={prefs.voiceURI} onChange={(e: { target: HTMLSelectElement }) => void store.setAppSetting('tts.voiceURI', e.target.value)} data-testid="tts-voice">
              <option value="">Default Korean voice</option>
              {voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang}){v.localService ? '' : ' · online'}</option>)}
            </select>
          </label>
          <label className="field"><span>Speed {rate.toFixed(2)}×</span>
            <input type="range" min={0.5} max={1.5} step={0.05} value={rate}
              onChange={(e: { target: HTMLInputElement }) => setRate(Number(e.target.value))}
              onPointerUp={() => void store.setAppSetting('tts.rate', rate)} onKeyUp={() => void store.setAppSetting('tts.rate', rate)}
              onBlur={() => { if (rate !== prefs.rate) void store.setAppSetting('tts.rate', rate); }} data-testid="tts-rate" />
          </label>
          <label className="check"><input type="checkbox" checked={prefs.autoplay} onChange={(e: { target: HTMLInputElement }) => void store.setAppSetting('tts.autoplay', e.target.checked)} data-testid="tts-autoplay" /> Read the answer aloud after I answer</label>
          <p><button type="button" className="btn btn-quiet btn-small" onClick={() => speak(SAMPLE, { rate, voiceURI: prefs.voiceURI })} data-testid="tts-test">Test voice</button></p>
        </>
      )}
    </div>
  );
}

/** About: where the dictionary example sentences come from (CC BY-SA attribution). */
function ExamplesCredit(): JSX.Element {
  const src = useExamplesData()?.source ?? DEFAULT_SOURCE;
  return (
    <div className="card form about" data-testid="examples-credit">
      <h3>About</h3>
      <p className="small"><strong>Example sentences.</strong> Additional examples come from{' '}
        <a href={src.url} target="_blank" rel="noopener">{src.name}</a> ({src.publisher}), licensed{' '}
        <a href={src.licenseUrl} target="_blank" rel="noopener license">{src.license}</a>
        {src.snapshot ? <>, snapshot {src.snapshot}</> : null}. They are shown as published, without English.
        The items' own examples and translations are original to this app.</p>
    </div>
  );
}
