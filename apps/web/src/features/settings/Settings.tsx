import { useState } from 'react';
import type { Settings as S } from '@ksrs/srs-engine';
import { useApp } from '../../state/hooks.ts';
import { store } from '../../state/store.ts';

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
      <div className="card form">
        <h3>Data</h3>
        <p className="muted">Your progress is an event log on this device ({app.events.length} events). Rebuilding replays it from scratch.</p>
        <button type="button" className="btn btn-quiet" data-testid="rebuild" onClick={() => {
          setRebuilt('Rebuilding…');
          void store.rebuild().then((r) => setRebuilt(`Rebuilt from ${r.events} events in ${r.ms.toFixed(0)} ms.`));
        }}>Rebuild from log</button>
        {rebuilt && <p className="muted" role="status">{rebuilt}</p>}
        <p className="muted small">Device {app.deviceId}</p>
      </div>
    </div>
  );
}
