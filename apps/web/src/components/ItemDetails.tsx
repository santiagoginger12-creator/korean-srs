// Full item presentation per kind. Used by lesson teach pages and the item page.
import { useState } from 'react';
import type { Example, ExpressionItem, GrammarItem, Item, VocabItem } from '@ksrs/content';
import { headword, type ContentIndex } from '@ksrs/srs-engine';
import { itemHref, KIND_KO, KIND_LABEL, REGISTER_LABEL } from '../state/format.ts';
import { Speaker } from '../tts/Speaker.tsx';
import { displayNuance, htskRefs } from '../state/htsk.ts';
import { MoreExamples } from './DictExamples.tsx';

export function KindTag({ kind }: { kind: Item['kind'] }): JSX.Element {
  return <span className={`kind-tag k-${kind}`}>{KIND_KO[kind]} · {KIND_LABEL[kind]}</span>;
}

export function NeedsReview({ item }: { item: Item }): JSX.Element | null {
  if (!item.needs_review) return null;
  return <span className="badge badge-warn" title="Flagged for owner review (D15)">needs review</span>;
}

export function ItemLink({ index, id }: { index: ContentIndex; id: string }): JSX.Element {
  const it = index.byId.get(id);
  return <a className={`item-link k-${it?.kind ?? 'vocab'}`} href={itemHref(id)}>{it ? headword(it) : id}</a>;
}

export function Examples({ examples, title = 'Examples' }: { examples: Example[]; title?: string }): JSX.Element | null {
  const [showAll, setShowAll] = useState(false);
  const [shown, setShown] = useState<Record<number, boolean>>({});
  if (!examples.length) return null;
  return (
    <section className="section">
      <div className="section-head">
        <h3>{title}</h3>
        <button type="button" className="btn-text" onClick={() => setShowAll((v) => !v)} aria-pressed={showAll}>
          {showAll ? 'Hide English' : 'Show English'}
        </button>
      </div>
      <ul className="examples">
        {examples.map((ex, i) => (
          <li key={i}>
            <p className="ko" lang="ko">{ex.ko}<Speaker text={ex.ko} label="Listen to the example" className="speaker-inline" />{ex.register ? <span className="reg">{REGISTER_LABEL[ex.register] ?? ex.register}</span> : null}
              {ex.needs_review ? <span className="badge badge-warn">needs review</span> : null}</p>
            {showAll || shown[i]
              ? <p className="en">{ex.en}</p>
              : <button type="button" className="btn-reveal" onClick={() => setShown((s) => ({ ...s, [i]: true }))}>English</button>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Mnemonic({ text }: { text?: string }): JSX.Element | null {
  if (!text) return null;
  return <section className="section"><h3>Mnemonic</h3><p className="prose">{text}</p></section>;
}

/** The hanja behind a Sino-Korean word as one muted line (e.g. 決裁). Not a link, not a lesson (D63). */
export function vocabHanja(item: VocabItem): string {
  return (Array.isArray(item.hanjaBreakdown) ? item.hanjaBreakdown : []).map((b) => b.hanja ?? '').join('');
}

function HanjaLine({ item }: { item: VocabItem }): JSX.Element | null {
  const h = vocabHanja(item);
  return h ? <p className="hanja-line" lang="ko-Hani" data-testid="hanja-line" title="Hanja">{h}</p> : null;
}

export function VocabDetails({ item, index }: { item: VocabItem; index: ContentIndex }): JSX.Element {
  return (
    <div className="details">
      <div className="hero">
        <div className="headword-row"><div className="headword" lang="ko">{item.word}</div><Speaker text={item.word} /></div>
        <p className="meanings">{(item.meanings ?? []).join('; ')}</p>
        <HanjaLine item={item} />
        <p className="meta">{item.pos ? <span>{item.pos}</span> : null}{item.register ? <span>{REGISTER_LABEL[item.register] ?? item.register} ({item.register})</span> : null}</p>
      </div>
      <Mnemonic text={item.mnemonic} />
      {(item.collocations ?? []).length > 0 && (
        <section className="section">
          <h3>Collocations</h3>
          <ul className="collocations">
            {(item.collocations ?? []).map((c, i) => <li key={i}><span className="ko" lang="ko">{c.ko}</span><span className="en">{c.en}</span></li>)}
          </ul>
        </section>
      )}
      <Examples examples={(item.examples ?? [])} />
    </div>
  );
}

export function GrammarDetails({ item, index, hideRelations }: { item: GrammarItem; index: ContentIndex; hideRelations?: boolean }): JSX.Element {
  return (
    <div className="details">
      <div className="hero">
        <div className="headword" lang="ko">{item.pattern}</div>
        <p className="meanings">{item.meaning}</p>
      </div>
      <section className="section">
        <h3>Attachment</h3>
        <div className="table-wrap">
          <table className="attach">
            <thead><tr><th>Stem</th><th>Final</th><th>Tense</th><th>Form</th><th>Example</th></tr></thead>
            <tbody>
              {(item.attachment ?? []).map((a, i) => (
                <tr key={i}><td data-label="Stem">{a.stem}</td><td data-label="Final">{a.final ?? 'any'}</td><td data-label="Tense">{a.tense}</td><td data-label="Form" lang="ko">{a.form}</td><td data-label="Example" lang="ko">{a.example}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {item.nuance ? <section className="section"><h3>Nuance</h3><p className="prose" data-testid="nuance">{displayNuance(item)}</p></section> : null}
      {!hideRelations && (item.contrasts ?? []).length > 0 && (
        <section className="section">
          <h3>Contrasts</h3>
          <ul className="contrasts">
            {(item.contrasts ?? []).map((c, i) => <li key={i}><ItemLink index={index} id={c.id} /> <span>{c.note}</span></li>)}
          </ul>
        </section>
      )}
      <Mnemonic text={item.mnemonic} />
      <Examples examples={(item.examples ?? [])} />
    </div>
  );
}

export function ExpressionDetails({ item }: { item: ExpressionItem; index: ContentIndex }): JSX.Element {
  return (
    <div className="details">
      <div className="hero">
        <p className="subtype" lang="ko">{item.subtype}</p>
        <div className="headword-row"><div className="headword headword-long" lang="ko">{item.text}</div><Speaker text={item.text} /></div>
        <p className="meanings">{item.meaning}</p>
        {item.hanjaText ? <p className="hanja-line" lang="ko-Hani" data-testid="hanja-line">{item.hanjaText}</p> : null}
        {item.literal ? <p className="literal"><span className="label">Literally</span> {item.literal}</p> : null}
      </div>
      {item.usage ? <section className="section"><h3>Usage</h3><p className="prose">{item.usage}</p></section> : null}
      <Mnemonic text={item.mnemonic} />
      <Examples examples={(item.examples ?? [])} />
    </div>
  );
}

/** Credit line for imported content (KRDict CC BY-SA, CSV/JSON imports, user items). */
export function Attribution({ item }: { item: Item }): JSX.Element | null {
  const src = item.source;
  if (!src || src.kind === 'original') return null;
  return (
    <p className="attribution" data-testid="attribution">
      <span className="label">Source</span>{' '}
      {src.attribution ?? (src.kind === 'user' ? 'Your own item' : 'Imported')}
      {src.license && src.license !== 'original-owned' ? ` · ${src.license}` : ''}
      {/* The url comes from imported/synced data: only ever link http(s). */}
      {src.url && /^https?:\/\//i.test(src.url) ? <> · <a href={src.url} target="_blank" rel="noopener noreferrer">link</a></> : null}
    </p>
  );
}

/** "HowtoStudyKorean Lesson n" links from `htsk:<n>` tags (external, new tab). */
export function HtskLinks({ item }: { item: Item }): JSX.Element | null {
  const refs = htskRefs(item);
  if (!refs.length) return null;
  return (
    <p className="htsk" data-testid="htsk">
      <span className="label">See also</span>{' '}
      {refs.map((r, i) => (
        <span key={r.lesson}>
          {i > 0 ? ' · ' : ''}
          {r.url ? <a href={r.url} target="_blank" rel="noopener" data-testid="htsk-link">{r.label} ↗</a> : <span>{r.label}</span>}
        </span>
      ))}
    </p>
  );
}

/**
 * `hideRelations`: the item page renders richer related-item sections itself (M3).
 * `moreExamplesOpen`: the 한국어기초사전 section starts expanded (item page) or collapsed (lessons).
 */
export function ItemDetails(props: { item: Item; index: ContentIndex; hideRelations?: boolean; moreExamplesOpen?: boolean }): JSX.Element {
  return (<>{renderDetails(props)}
    <MoreExamples key={props.item.id} item={props.item} defaultOpen={!!props.moreExamplesOpen} />
    <HtskLinks item={props.item} /><Attribution item={props.item} /></>);
}

function renderDetails({ item, index, hideRelations }: { item: Item; index: ContentIndex; hideRelations?: boolean }): JSX.Element {
  switch (item.kind) {
    case 'hanja': return <div className="details"><p className="muted">Hanja aren't studied as items.</p></div>;
    case 'vocab': return <VocabDetails item={item} index={index} />;
    case 'grammar': return <GrammarDetails item={item} index={index} hideRelations={hideRelations} />;
    case 'expression': return <ExpressionDetails item={item} index={index} />;
  }
}
