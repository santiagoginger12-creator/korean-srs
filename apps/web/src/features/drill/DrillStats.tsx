// #/drill/stats (D88): due forecast, recent answers, retention and card states per tier, and the
// leech list (cards forgotten LEECH_LAPSES+ times) with suspend / unsuspend / reset.
import { useMemo, useState } from 'react';
import {
  answersByDay, dueForecast, leeches, LEECH_LAPSES, parseCardId, tierStats, type DrillCard,
} from '@ksrs/srs-engine';
import { tz } from '../../state/clock.ts';
import { drillDay } from '../../state/drill.ts';
import { useApp, useNow } from '../../state/hooks.ts';
import { store } from '../../state/store.ts';
import { DECK_META, type Deck } from './deck.ts';
const DAY_MS = 86_400_000;

const FORECAST_DAYS = 30;
const HISTORY_DAYS = 30;

function Bars({ values, labels, testid, title, stack }: {
  values: number[]; labels: string[]; testid: string; title: string; stack?: number[];
}): JSX.Element {
  const max = Math.max(1, ...values.map((v, i) => v + (stack?.[i] ?? 0)));
  return (
    <div className="bars" role="img" aria-label={title} data-testid={testid}>
      {values.map((v, i) => {
        const extra = stack?.[i] ?? 0;
        return (
          <div key={i} className="bar-col" title={`${labels[i]}: ${v + extra}`}>
            <div className="bar-stack" style={{ height: `${((v + extra) / max) * 100}%` }}>
              {extra > 0 && <span className="bar bar-alt" style={{ flexGrow: extra }} />}
              {v > 0 && <span className="bar" style={{ flexGrow: v }} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function DrillStats({ deck }: { deck: Deck }): JSX.Element {
  const app = useApp();
  const t = useNow();
  const st = app.drill;
  const settings = app.derived!.settings;
  const day = drillDay(t, settings, tz);
  const forecast = useMemo(() => dueForecast(st, day, FORECAST_DAYS), [st, day.start]);
  const history = useMemo(() => answersByDay(st, day, HISTORY_DAYS), [st, day.start]);
  const tiers30 = useMemo(() => tierStats(st, DECK_META, t - 30 * DAY_MS), [st, day.start]);
  const tiersAll = useMemo(() => tierStats(st, DECK_META, 0), [st]);
  const leechList = useMemo(() => leeches(st), [st]);
  const suspendedOther = useMemo(() => [...st.cards.values()].filter((c) => c.suspended && c.lapses < LEECH_LAPSES), [st]);

  const sum = (a: number, b: number) => a + b;
  const dueTotals = forecast.map((f) => f.review + f.learning);
  const week = dueTotals.slice(0, 7).reduce(sum, 0);
  const month = dueTotals.reduce(sum, 0);
  const answered = history.map((h) => h.total).reduce(sum, 0);
  const activeDays = history.filter((h) => h.total > 0).length;
  const dayLabel = (k: number) => (k === 0 ? 'Today' : k === 1 ? 'Tomorrow' : new Date(day.start + k * DAY_MS).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  const pct = (r: number | null) => (r === null ? '—' : `${Math.round(r * 100)}%`);

  return (
    <div className="page narrow drill-stats-page" data-testid="drill-stats">
      <p><a className="btn-text" href="#/drill">← Drill</a></p>
      <header className="home-head"><div><p className="eyebrow" lang="ko">통계</p><h1>Drill stats</h1></div></header>

      <section className="card">
        <h3>Coming up</h3>
        <div className="drill-row">
          <span>Today <strong data-testid="stats-due-today">{dueTotals[0]}</strong></span>
          <span>Tomorrow <strong data-testid="stats-due-tomorrow">{dueTotals[1]}</strong></span>
          <span>Next 7 days <strong data-testid="stats-due-week">{week}</strong></span>
          <span>30 days <strong>{month}</strong></span>
        </div>
        <Bars testid="stats-forecast" title={`Cards due each day for the next ${FORECAST_DAYS} days`}
          values={forecast.map((f) => f.review)} stack={forecast.map((f) => f.learning)} labels={forecast.map((_, k) => dayLabel(k))} />
        <p className="muted small bars-axis"><span>Today</span><span>+{FORECAST_DAYS - 1} days</span></p>
        <p className="muted small">Reviews already scheduled, before any new cards. The lighter top of today's bar is learning cards.</p>
      </section>

      <section className="card">
        <h3>Last {HISTORY_DAYS} days</h3>
        <div className="drill-row">
          <span>Answers <strong data-testid="stats-answered">{answered}</strong></span>
          <span>Days studied <strong data-testid="stats-days">{activeDays}</strong>/{HISTORY_DAYS}</span>
          <span>Per study day <strong>{activeDays ? Math.round(answered / activeDays) : 0}</strong></span>
        </div>
        <Bars testid="stats-history" title={`Answers each day for the last ${HISTORY_DAYS} days`}
          values={history.map((h) => h.total - h.again)} stack={history.map((h) => h.again)}
          labels={history.map((_, k) => dayLabel(k - (HISTORY_DAYS - 1)))} />
        <p className="muted small bars-axis"><span>{HISTORY_DAYS - 1} days ago</span><span>Today</span></p>
        <p className="muted small">The lighter top of each bar is Again answers.</p>
      </section>

      <section className="card">
        <h3>By tier</h3>
        <div className="table-wrap">
          <table className="stats-table" data-testid="stats-tiers">
            <thead><tr><th>Tier</th><th title="Review answers that weren't Again, last 30 days">30d</th><th title="All-time retention">All</th><th title="Learning">Lrn</th><th>Young</th><th title="Mature">Mat</th><th>Known</th></tr></thead>
            <tbody>
              {tiers30.map((x, i) => (
                <tr key={x.tier} data-tier={x.tier}>
                  <th scope="row" title={x.label}>{x.tier} <span className="muted small tier-name">{x.label}</span></th>
                  <td title={`${x.pass}/${x.total}`}>{pct(x.rate)}</td>
                  <td title={`${tiersAll[i]!.pass}/${tiersAll[i]!.total}`}>{pct(tiersAll[i]!.rate)}</td>
                  <td>{x.learning}</td><td>{x.young}</td><td>{x.mature}</td><td>{x.known}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">30d and All are retention: answers on cards already past their learning steps (Anki's "true retention"). Lrn = learning; Young = intervals under 21 days; Mat = mature, 21 days or more.</p>
      </section>

      <Leeches deck={deck} list={leechList} />
      {suspendedOther.length > 0 && <SuspendedList deck={deck} list={suspendedOther} />}
    </div>
  );
}

function CardRow({ deck, c, children }: { deck: Deck; c: DrillCard; children: JSX.Element }): JSX.Element {
  const w = deck.byId.get(parseCardId(c.id).wordId);
  return (
    <li className="leech-row" data-testid="leech-row" data-card-id={c.id}>
      <span className="leech-word">
        <strong lang="ko">{w?.headword ?? c.wordId}</strong>{c.dir === 'r' && <span className="muted small"> (E→K)</span>}
        <span className="muted small"> {w?.gloss ?? ''}</span>
      </span>
      <span className="muted small leech-lapses">{c.lapses} lapses{c.suspended ? ' · suspended' : ''}</span>
      {children}
    </li>
  );
}

function Leeches({ deck, list }: { deck: Deck; list: DrillCard[] }): JSX.Element {
  const [undoId, setUndoId] = useState<string | null>(null);
  const active = list.filter((c) => !c.suspended);
  return (
    <section className="card" data-testid="stats-leeches">
      <h3>Leeches ({list.length})</h3>
      {list.length === 0
        ? <p className="muted small">No leeches. A card becomes a leech after you forget it {LEECH_LAPSES} times once it has graduated.</p>
        : (
          <>
            <p className="muted small">Cards you've forgotten {LEECH_LAPSES} or more times. Practise them from Custom study on the drill page, suspend them so they stop coming up, or reset them to start over as new.</p>
            <p className="row">
              <button type="button" className="btn btn-quiet btn-small" disabled={!active.length} data-testid="leech-suspend-all"
                onClick={() => setUndoId(store.drillSuspend(active.map((c) => c.id), true))}>Suspend all {active.length}</button>
              {undoId && <button type="button" className="btn-text small" onClick={() => { store.drillUndo(undoId); setUndoId(null); }}>Undo</button>}
            </p>
            <ul className="leech-list">
              {list.map((c) => (
                <CardRow key={c.id} deck={deck} c={c}>
                  <span className="leech-actions">
                    <button type="button" className="btn btn-quiet btn-small" data-testid="leech-suspend"
                      onClick={() => store.drillSuspend([c.id], !c.suspended)}>{c.suspended ? 'Unsuspend' : 'Suspend'}</button>
                    <button type="button" className="btn btn-quiet btn-small" data-testid="leech-reset"
                      onClick={() => store.drillReset([c.id])}>Reset</button>
                  </span>
                </CardRow>
              ))}
            </ul>
          </>
        )}
    </section>
  );
}

function SuspendedList({ deck, list }: { deck: Deck; list: DrillCard[] }): JSX.Element {
  return (
    <section className="card" data-testid="stats-suspended">
      <h3>Other suspended cards ({list.length})</h3>
      <ul className="leech-list">
        {list.map((c) => (
          <CardRow key={c.id} deck={deck} c={c}>
            <span className="leech-actions">
              <button type="button" className="btn btn-quiet btn-small" onClick={() => store.drillSuspend([c.id], false)}>Unsuspend</button>
            </span>
          </CardRow>
        ))}
      </ul>
    </section>
  );
}
