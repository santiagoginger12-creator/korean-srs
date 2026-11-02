// Example sentences beyond the item's own: the one-example strip in review feedback and the
// "More examples · 한국어기초사전" section on item and lesson pages. Dictionary data is optional
// (examples.json, loaded lazily); without it the feedback strip rotates the originals only.
import { useState, useSyncExternalStore } from 'react';
import type { Example, Item } from '@ksrs/content';
import { headword, pickExample, type DictExample } from '@ksrs/srs-engine';
import {
  CREDIT_TEXT, DEFAULT_SOURCE, dictExampleText, examplesStore, headwordMatch, highlight, krdictSearchUrl, stripSpeaker,
  type ExamplesData, type ExamplesSource,
} from '../data/examples.ts';
import { Speaker } from '../tts/Speaker.tsx';

const NO_EXAMPLES: DictExample[] = [];

export function useExamplesData(): ExamplesData | null {
  return useSyncExternalStore(examplesStore.subscribe, examplesStore.get);
}

export function useDictExamples(itemId: string): DictExample[] {
  return useExamplesData()?.items.get(itemId) ?? NO_EXAMPLES;
}

/** Original examples of a reviewable item ([] for hanja). */
export function originalExamples(item: Item | undefined): Example[] {
  if (!item || item.kind === 'hanja') return [];
  return Array.isArray(item.examples) ? item.examples.filter((e) => e && typeof e.ko === 'string' && e.ko.trim()) : [];
}

export function Highlighted({ text, match }: { text: string; match: string | undefined }): JSX.Element {
  return <>{highlight(text, match).map((s, i) => (s.hit ? <mark key={i} className="ex-hit" data-testid="ex-hit">{s.text}</mark> : <span key={i}>{s.text}</span>))}</>;
}

/** One dictionary example: a sentence, or a dialogue with one line each (match highlighted on its line). */
function DictBody({ ex }: { ex: DictExample }): JSX.Element {
  if (ex.kind === 'sentence') return <p className="ko ex-line" lang="ko"><span className="ex-text"><Highlighted text={ex.ko} match={ex.match} /></span><Speaker text={ex.ko} label="Listen to the example" className="speaker-inline" /></p>;
  const hitLine = ex.matchLine ?? ex.lines.findIndex((l) => ex.match !== undefined && l.includes(ex.match));
  return (
    <div className="dialogue" lang="ko" data-testid="ex-dialogue">
      {ex.lines.map((l, i) => (
        <p key={i} className="ko dialogue-line ex-line"><span className="ex-text"><Highlighted text={l} match={i === hitLine ? ex.match : undefined} /></span>
          <Speaker text={stripSpeaker(l)} label="Listen to this line" className="speaker-inline" /></p>
      ))}
    </div>
  );
}

export function Credit({ word, source = DEFAULT_SOURCE, withLicense }: { word: string; source?: ExamplesSource; withLicense?: boolean }): JSX.Element {
  return (
    <p className="ex-credit" data-testid="ex-credit">
      {withLicense
        ? (<><a href={krdictSearchUrl(word)} target="_blank" rel="noopener" data-testid="ex-credit-link">{source.name} ({source.publisher})</a>
          {' · '}<a href={source.licenseUrl} target="_blank" rel="noopener license" data-testid="ex-license-link">{source.license}</a></>)
        : <a href={krdictSearchUrl(word)} target="_blank" rel="noopener" data-testid="ex-credit-link">{CREDIT_TEXT}</a>}
    </p>
  );
}

/**
 * The single example shown after an answer (never before: QuizRunner renders this only inside
 * the feedback panel). Chosen by pickExample with the item's review count at answer time.
 */
export function FeedbackExample({ item, reviewCount, includeDict }: { item: Item | undefined; reviewCount: number; includeDict: boolean }): JSX.Element | null {
  const data = useExamplesData();
  const [showEn, setShowEn] = useState(false);
  if (!item || (item.kind !== 'vocab' && item.kind !== 'expression')) return null;
  const word = headword(item);
  const dict = includeDict ? (data?.items.get(item.id) ?? NO_EXAMPLES) : NO_EXAMPLES;
  const picked = pickExample(item.id, originalExamples(item), dict, reviewCount);
  if (!picked) return null;
  const key = `${picked.source}:${picked.index}`;
  return (
    <div className="fb-example" data-testid="fb-example" data-source={picked.source} data-example-key={key}>
      <span className="label">Example</span>
      {picked.source === 'original'
        ? (<>
          <p className="ko ex-line" lang="ko"><span className="ex-text"><Highlighted text={picked.example.ko} match={headwordMatch(picked.example.ko, word)} /></span>
            <Speaker text={picked.example.ko} label="Listen to the example" className="speaker-inline" /></p>
          {showEn
            ? <p className="en" data-testid="fb-example-en">{picked.example.en}</p>
            : <button type="button" className="btn-reveal" onClick={() => setShowEn(true)}>Show English</button>}
        </>)
        : (<>
          <DictBody ex={picked.example} />
          <Credit word={word} source={data?.source} />
        </>)}
    </div>
  );
}

/** "More examples · 한국어기초사전": every dictionary example for the item. Nothing when there are none. */
export function MoreExamples({ item, defaultOpen }: { item: Item; defaultOpen: boolean }): JSX.Element | null {
  const data = useExamplesData();
  const list = data?.items.get(item.id);
  if (item.kind === 'hanja' || !list?.length) return null;
  const word = headword(item);
  return (
    <details className="section more-examples" open={defaultOpen} data-testid="more-examples">
      <summary><h3>More examples · 한국어기초사전 <span className="muted small">({list.length})</span></h3></summary>
      <ul className="examples dict-examples">
        {list.map((ex, i) => <li key={i} data-testid="dict-example" data-text={dictExampleText(ex)}><DictBody ex={ex} /></li>)}
      </ul>
      <Credit word={word} source={data?.source} withLicense />
    </details>
  );
}
