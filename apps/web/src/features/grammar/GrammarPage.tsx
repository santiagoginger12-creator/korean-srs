// #/grammar: the grammar path at a glance — stages with their 90% gates, every pattern grouped
// by function tag (fn:*) with its stage chip, and the contrast sets.
import { itemHref, stageName } from '../../state/format.ts';
import { grammarPageView, type PatternRow } from '../../state/grammarView.ts';
import { useApp } from '../../state/hooks.ts';

export function GrammarPage(): JSX.Element {
  const app = useApp();
  const d = app.derived!;
  const v = grammarPageView(d);
  return (
    <div className="page narrow grammar-page k-grammar" data-testid="grammar-page">
      <p><a className="btn-text" href="#/">← Home</a></p>
      <h1>Grammar <span className="muted" lang="ko">문법</span></h1>
      {v.total === 0 && <p className="empty">No grammar content yet.</p>}

      {v.stages.length > 0 && (
        <section className="card" data-testid="grammar-stages">
          <h3>Stages</h3>
          <ul className="stage-list">
            {v.stages.map((g) => (
              <li key={g.level} className={g.open ? 'open' : 'locked'} data-testid="grammar-stage-row" data-open={g.open ? 'true' : 'false'}>
                <span className="chip-stage">S{g.stage}</span>
                <span className="small">Level {g.level}</span>
                <span className="mini-meter"><span style={{ width: `${g.gatingTotal ? (g.gatingPassed / g.gatingTotal) * 100 : 100}%` }} /><i style={{ left: '90%' }} /></span>
                <span className="small">{g.open ? `${g.gatingPassed}/${g.gatingTotal}` : 'locked'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {v.groups.map((g) => (
        <section key={g.key} className="card pattern-group" data-testid="pattern-group" data-group={g.key}>
          <h3>{g.label} <span className="muted small">{g.rows.length}</span></h3>
          <ul className="pattern-list">{g.rows.map((r) => <Row key={`${g.key}|${r.id}`} r={r} />)}</ul>
        </section>
      ))}

      {v.contrastSets.length > 0 && (
        <section className="card" data-testid="contrast-sets">
          <h3>Contrast sets</h3>
          <ul className="contrast-sets">
            {v.contrastSets.map((c) => (
              <li key={c.key} data-testid="contrast-set" data-set={c.key}>
                <span className="cs-label">{c.label}</span>
                <span className="chips">{c.rows.map((r) => <a key={r.id} className="item-link k-grammar" href={itemHref(r.id)} lang="ko">{r.pattern}</a>)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Row({ r }: { r: PatternRow }): JSX.Element {
  const srs = r.learned ? stageName(r.srsStage) : r.unlocked ? 'not learned' : 'locked';
  return (
    <li className="pattern-row" data-testid="pattern-row" data-item-id={r.id}>
      <a className="item-link k-grammar" href={itemHref(r.id)} lang="ko">{r.pattern}</a>
      <span className="rel-gloss">{r.meaning}</span>
      <span className="chip-stage" data-testid="pattern-stage" title={`Grammar stage ${r.stage} (level ${r.level})`}>S{r.stage}</span>
      <span className={`chip-stage ${r.learned ? '' : 'chip-stage-none'}`}>{srs}</span>
    </li>
  );
}
