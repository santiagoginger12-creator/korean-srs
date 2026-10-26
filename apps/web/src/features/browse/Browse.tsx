// Browse and search all items by level and kind (M3): a way to reach item pages outside lessons.
import { useState, type FormEvent } from 'react';
import type { ItemKind } from '@ksrs/content';
import { headword } from '@ksrs/srs-engine';
import { browse, type BrowseFilter } from '../../state/browse.ts';
import { itemHref, KIND_LABEL, stageName } from '../../state/format.ts';
import { useApp } from '../../state/hooks.ts';

const KINDS: (ItemKind | 'all')[] = ['all', 'hanja', 'vocab', 'grammar', 'expression'];

export function Browse(): JSX.Element {
  const app = useApp();
  const d = app.derived!;
  const [f, setF] = useState<BrowseFilter>({ level: 'all', kind: 'all', query: '' });
  const groups = browse(d.index, f);
  const count = [...groups.values()].reduce((a, xs) => a + xs.length, 0);
  // Uncontrolled search box: React never rewrites value, so Hangul composition is safe.
  const onInput = (e: FormEvent<HTMLInputElement>) => {
    const v = e.currentTarget.value;
    setF((p) => ({ ...p, query: v }));
  };

  return (
    <div className="page browse" data-testid="browse">
      <p><a className="btn-text" href="#/">← Home</a></p>
      <h1>Browse</h1>
      <div className="card form browse-filters">
        <input type="search" lang="ko" placeholder="Search 한자, 단어, meaning…" aria-label="Search items" onInput={onInput}
          autoCapitalize="off" autoCorrect="off" autoComplete="off" spellCheck={false} data-testid="browse-search" />
        <div className="filter-row" role="group" aria-label="Level">
          <button type="button" className={`pill ${f.level === 'all' ? 'on' : ''}`} onClick={() => setF({ ...f, level: 'all' })}>All levels</button>
          {d.index.levels.map((L) => (
            <button key={L} type="button" className={`pill ${f.level === L ? 'on' : ''} ${L > d.userLevel ? 'pill-locked' : ''}`} onClick={() => setF({ ...f, level: L })}>L{L}</button>
          ))}
        </div>
        <div className="filter-row" role="group" aria-label="Kind">
          {KINDS.map((k) => (
            <button key={k} type="button" className={`pill ${k !== 'all' ? `k-${k}` : ''} ${f.kind === k ? 'on' : ''}`} onClick={() => setF({ ...f, kind: k })}>
              {k === 'all' ? 'All kinds' : KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </div>
      <p className="muted small" role="status">{count} item{count === 1 ? '' : 's'}</p>
      {[...groups.entries()].map(([L, items]) => (
        <section key={L} className="section">
          <h3>Level {L}{L > d.userLevel ? ' · locked' : ''}</h3>
          <ul className="browse-grid">
            {items.map((it) => {
              const st = d.items.get(it.id);
              const learned = st?.lessonAt !== undefined;
              const locked = !learned && !d.unlocked.has(it.id);
              return (
                <li key={it.id}>
                  <a className={`browse-item k-${it.kind} ${locked ? 'is-locked' : ''}`} href={itemHref(it.id)} data-item-id={it.id}>
                    <span className={it.kind === 'hanja' ? 'hanja-small' : 'browse-head'} lang={it.kind === 'hanja' ? 'ko-Hani' : 'ko'}>{headword(it)}</span>
                    <span className="browse-sub">{it.kind === 'hanja' ? `${it.hun} ${it.eum}` : it.kind === 'vocab' ? it.meanings[0] : it.kind === 'grammar' ? it.meaning : it.meaning}</span>
                    <span className="browse-stage">{learned ? (it.kind === 'hanja' ? 'learned' : stageName(st!.stage)) : locked ? 'locked' : 'new'}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
