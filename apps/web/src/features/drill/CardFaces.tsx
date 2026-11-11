// Card faces for the drill. Forward (Korean → English): the headword on the front; gloss, part of
// speech, hanja/origin (muted), tier and the example on the back. Reverse (English → Korean): the
// gloss on the front and the headword first on the back. Example English is behind a tap (D76).
import { useEffect, useState } from 'react';
import { Speaker } from '../../tts/Speaker.tsx';
import type { DeckWord } from './deck.ts';

export const NO_GLOSS = 'No English gloss yet';

export function CardFront({ word, dir, homograph }: { word: DeckWord; dir: 'f' | 'r'; homograph: boolean }): JSX.Element {
  if (dir === 'r') {
    return (
      <div className="drill-front" data-testid="drill-front">
        <p className="drill-dir">English → Korean</p>
        <p className="drill-gloss-front" data-testid="drill-prompt">{word.gloss || NO_GLOSS}</p>
        <p className="drill-meta muted">{word.pos}</p>
      </div>
    );
  }
  return (
    <div className="drill-front" data-testid="drill-front">
      <p className="drill-word" lang="ko" data-testid="drill-prompt">{word.headword}</p>
      <div className="drill-front-row">
        {homograph && <span className="drill-meta muted" data-testid="drill-homograph">{word.pos}</span>}
        <Speaker text={word.headword} />
      </div>
    </div>
  );
}

export function CardBack({ word, dir, credit }: { word: DeckWord; dir: 'f' | 'r'; credit: string }): JSX.Element {
  const [showEn, setShowEn] = useState(false);
  useEffect(() => { setShowEn(false); }, [word.id, dir]);
  useEffect(() => {
    if (!word.example) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (e.key.toLowerCase() === 't' || e.code === 'KeyT') { e.preventDefault(); setShowEn(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [word.id, word.example]);

  const meta = (
    <p className="drill-meta" data-testid="drill-meta">
      <span>{word.pos}</span>
      {word.origin && <span className="drill-origin" lang="ko">{word.origin}</span>}
      <span className="drill-tier">{word.tier_label}</span>
    </p>
  );
  return (
    <>
      {dir === 'r' ? (
        <div className="drill-answer-ko">
          <p className="drill-word" lang="ko" data-testid="drill-answer">{word.headword}</p>
          <Speaker text={word.headword} />
        </div>
      ) : (
        <p className={`drill-gloss ${word.gloss ? '' : 'muted'}`} data-testid="drill-answer">{word.gloss || NO_GLOSS}</p>
      )}
      {meta}
      {word.example && (
        <div className="drill-example" data-testid="drill-example">
          <p lang="ko">{word.example.ko} <Speaker text={word.example.ko} label="Listen to the example" /></p>
          {showEn
            ? <p className="muted" data-testid="drill-example-en">{word.example.en}</p>
            : <button type="button" className="btn-reveal" data-testid="drill-show-translation"
                onClick={(e: { stopPropagation(): void }) => { e.stopPropagation(); setShowEn(true); }}>Show translation <kbd>T</kbd></button>}
        </div>
      )}
      {word.gloss_source === 'krdict' && word.gloss && <p className="drill-credit" data-testid="drill-credit">{credit}</p>}
    </>
  );
}
