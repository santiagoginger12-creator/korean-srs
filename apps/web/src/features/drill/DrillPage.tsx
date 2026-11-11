// #/drill — the Anki-style vocabulary drill (D78–D84): a home screen with counts, placement and
// Start; a session (DrillSession). #/drill/start opens straight into a session.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MasterRow } from '@ksrs/content';
import { readMasterExt, unseenByTier, type DrillPlacement } from '@ksrs/srs-engine';
import { decodeBaseline } from '../../data/master.ts';
import { now, tz } from '../../state/clock.ts';
import { ankiMasteredIds, drillSummary, sessionNewQueue, skipAheadIds } from '../../state/drill.ts';
import { useApp, useNow } from '../../state/hooks.ts';
import { store } from '../../state/store.ts';
import { DECK_META, useDeck, type Deck } from './deck.ts';
import { DrillSession } from './DrillSession.tsx';

export function DrillPage({ start }: { start: boolean }): JSX.Element {
  const { deck, error } = useDeck();
  const app = useApp();
  const [session, setSession] = useState<{ key: number; newQueue: string[] } | null>(null);
  const autoStarted = useRef(false);

  const begin = (d: Deck) => {
    const s = store.getState();
    setSession({ key: Date.now(), newQueue: sessionNewQueue(s.drill, d.words, DECK_META, s.derived!.settings, now(), tz) });
  };
  useEffect(() => {
    if (start && deck && !autoStarted.current) {
      autoStarted.current = true;
      history.replaceState(null, '', '#/drill');
      begin(deck);
    }
  }, [start, deck]);

  if (error) return <div className="page narrow"><p><a className="btn-text" href="#/">← Home</a></p><h1>Drill</h1><p className="notice">Couldn't load the word deck: {error}</p></div>;
  if (!deck) return <div className="page narrow"><h1>Drill</h1><p className="muted" aria-busy="true">Loading the deck…</p></div>;
  if (session) {
    return <DrillSession key={session.key} deck={deck} newQueue={session.newQueue}
      onRestart={() => begin(deck)} onHome={() => setSession(null)} />;
  }
  return <DrillHome deck={deck} onStart={() => begin(deck)} app={app} />;
}

type Confirm = { kind: 'tier'; tier: number; ids: string[] } | { kind: 'anki'; ids: string[] } | null;

function DrillHome({ deck, onStart, app }: { deck: Deck; onStart: () => void; app: ReturnType<typeof useApp> }): JSX.Element {
  const t = useNow();
  const d = app.derived!;
  const s = d.settings;
  const st = app.drill;
  const c = drillSummary(st, s, DECK_META, t, tz);
  const left = useMemo(() => unseenByTier(st, DECK_META), [st]);
  const waiting = c.due + c.newToday;
  const [skipTier, setSkipTier] = useState<number>(() => Math.min(3, DECK_META.tiers[DECK_META.tiers.length - 1]?.tier ?? 1));
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [done, setDone] = useState('');
  const baseline = useAnkiBaseline();
  const ankiIds = useMemo(() => (baseline ? ankiMasteredIds(st, deck.words, baseline) : []), [baseline, st, deck]);
  const skipIds = useMemo(() => skipAheadIds(st, deck.words, skipTier), [st, deck, skipTier]);

  // Space / Enter start a session from here (no field focused).
  const startRef = useRef({ onStart, waiting, confirm });
  startRef.current = { onStart, waiting, confirm };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'A') return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const k = startRef.current;
      if ((e.key === ' ' || e.key === 'Enter' || e.code === 'Space') && k.waiting > 0 && !k.confirm) { e.preventDefault(); k.onStart(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const apply = () => {
    if (!confirm) return;
    store.drillKnown(confirm.ids, confirm.kind === 'tier' ? `tier<${confirm.tier}` : 'anki');
    setDone(confirm.kind === 'tier' ? `Marked ${confirm.ids.length} words below tier ${confirm.tier} as known.` : `Marked ${confirm.ids.length} Anki-mastered words as known.`);
    setConfirm(null);
  };

  const batches = st.placements.filter((p) => p.reason !== 'card');
  const singles = st.placements.filter((p) => p.reason === 'card').reduce((n, p) => n + p.count, 0);
  const pct = c.retention30.rate === null ? '—' : `${Math.round(c.retention30.rate * 100)}%`;
  const tierLabel = (n: number) => DECK_META.tiers.find((x) => x.tier === n)?.label ?? `Tier ${n}`;

  return (
    <div className="page narrow drill-home" data-testid="drill-home">
      <p><a className="btn-text" href="#/">← Home</a></p>
      <header className="home-head">
        <div>
          <p className="eyebrow" lang="ko">단어 드릴</p>
          <h1>Drill</h1>
        </div>
        <a className="btn-text" href="#/settings" data-testid="drill-settings-link">Settings</a>
      </header>

      <section className="tile tile-drill drill-start-tile">
        <div className="drill-stats">
          <div><p className="tile-count" data-testid="drill-due">{c.due}</p><p className="tile-note">due</p></div>
          <div><p className="tile-count" data-testid="drill-new">{c.newToday}</p><p className="tile-note">new today <span className="muted">(limit {s['drill.newPerDay']}{c.newReverse ? ` + ${c.newReverse} reverse` : ''})</span></p></div>
        </div>
        <button type="button" className="btn btn-primary drill-start" onClick={onStart} disabled={waiting === 0} data-testid="drill-start">
          {waiting ? 'Start' : 'Nothing due'} <kbd>Space</kbd>
        </button>
        <label className="field drill-tier-field"><span>Start new cards at</span>
          <select value={String(s['drill.startTier'])} data-testid="drill-start-tier"
            onChange={(e: { target: HTMLSelectElement }) => void store.setAppSetting('drill.startTier', Number(e.target.value))}>
            <option value="0">First tier with new words{c.startTier !== null && s['drill.startTier'] === 0 ? ` (tier ${c.startTier})` : ''}</option>
            {DECK_META.tiers.map((x) => (
              <option key={x.tier} value={x.tier} disabled={(left.get(x.tier) ?? 0) === 0}>Tier {x.tier} · {x.label} ({left.get(x.tier) ?? 0} new)</option>
            ))}
          </select>
        </label>
      </section>

      <section className="card drill-today">
        <div className="drill-row">
          <span>Reviews today <strong data-testid="drill-reviews-today">{c.reviewsToday}</strong></span>
          <span>30-day retention <strong data-testid="drill-retention">{pct}</strong>{c.retention30.total ? <span className="muted small"> ({c.retention30.pass}/{c.retention30.total})</span> : null}</span>
        </div>
        <ul className="stage-row drill-states" data-testid="drill-states">
          {([['new', 'New'], ['learning', 'Learning'], ['young', 'Young'], ['mature', 'Mature'], ['known', 'Known']] as const).map(([k, label]) => (
            <li key={k} className={`stage drill-state-${k}`} data-state={k}>
              <span className="stage-count" data-testid={`drill-state-${k}`}>{c.byState[k]}</span>
              <span className="stage-label">{label}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card drill-placement" data-testid="drill-placement">
        <h3>Placement</h3>
        <p className="small muted">Already know the early words? Mark them known so new cards start where you are. Known words are never shown; you can undo any batch below.</p>
        <div className="drill-skip">
          <label className="field"><span>Skip ahead to</span>
            <select value={String(skipTier)} data-testid="drill-skip-tier" onChange={(e: { target: HTMLSelectElement }) => { setSkipTier(Number(e.target.value)); setConfirm(null); }}>
              {DECK_META.tiers.filter((x) => x.tier > DECK_META.tiers[0]!.tier).map((x) => <option key={x.tier} value={x.tier}>Tier {x.tier} · {x.label}</option>)}
            </select>
          </label>
          <button type="button" className="btn btn-quiet" disabled={!skipIds.length} data-testid="drill-skip"
            onClick={() => { setDone(''); setConfirm({ kind: 'tier', tier: skipTier, ids: skipIds }); }}>
            Mark {skipIds.length} words below tier {skipTier} known
          </button>
        </div>
        {baseline && (
          <p>
            <button type="button" className="btn btn-quiet" disabled={!ankiIds.length} data-testid="drill-skip-anki"
              onClick={() => { setDone(''); setConfirm({ kind: 'anki', ids: ankiIds }); }}>
              Skip {ankiIds.length} words you've mastered in Anki
            </button>
          </p>
        )}
        {confirm && (
          <div className="confirm drill-confirm" role="alertdialog" data-testid="drill-skip-confirm">
            <span>{confirm.kind === 'tier'
              ? <>Mark <strong>{confirm.ids.length}</strong> unseen words in {tierLabel(DECK_META.tiers[0]!.tier)}{confirm.tier - 1 > DECK_META.tiers[0]!.tier ? `–${tierLabel(confirm.tier - 1)}` : ''} as known?</>
              : <>Mark the <strong>{confirm.ids.length}</strong> words with status "mastered" in your Anki history as known?</>} You can undo this.</span>
            <button type="button" className="btn btn-primary btn-small" onClick={apply} data-testid="drill-skip-yes">Mark known</button>
            <button type="button" className="btn btn-quiet btn-small" onClick={() => setConfirm(null)}>Cancel</button>
          </div>
        )}
        {done && <p className="muted small" role="status" data-testid="drill-skip-done">{done}</p>}
        {(batches.length > 0 || singles > 0) && (
          <ul className="drill-batches" data-testid="drill-batches">
            {batches.map((p) => <Batch key={p.eventId} p={p} t={t} />)}
            {singles > 0 && <li className="small muted">{singles} marked known one at a time during sessions (undo with Z right after).</li>}
          </ul>
        )}
      </section>
    </div>
  );
}

function Batch({ p, t }: { p: DrillPlacement; t: number }): JSX.Element {
  const what = p.reason === 'anki' ? 'Anki-mastered words' : p.reason.startsWith('tier<') ? `words below tier ${p.reason.slice(5)}` : 'words';
  return (
    <li className="drill-batch" data-testid="drill-batch">
      <span>{p.count} {what} marked known <span className="muted small">{t - p.at < 60_000 ? 'just now' : new Date(p.at).toLocaleDateString()}</span></span>
      <button type="button" className="btn btn-quiet btn-small" onClick={() => store.drillUndo(p.eventId)} data-testid="drill-batch-undo">Undo</button>
    </li>
  );
}

/** The master list's Anki baseline rows (D61), decoded on demand; null when none is stored. */
function useAnkiBaseline(): MasterRow[] | null {
  const app = useApp();
  const blob = useMemo(() => readMasterExt(app.derived!).baseline, [app.derived]);
  const [rows, setRows] = useState<MasterRow[] | null>(null);
  useEffect(() => {
    if (!blob) { setRows(null); return; }
    let live = true;
    decodeBaseline(blob).then((r) => { if (live) setRows(r); }, () => { if (live) setRows(null); });
    return () => { live = false; };
  }, [blob]);
  return rows;
}
