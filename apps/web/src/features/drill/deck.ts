// The drill deck (D83): its tier summary is compiled into the main bundle (build.ts defines
// __DRILL_META__), and the 10,878 words are fetched only when the drill opens. The service worker
// precaches drill/deck.json, so it works offline after the first load.
import { useEffect, useState } from 'react';
import type { DeckMeta } from '@ksrs/srs-engine';

export interface DeckWord {
  id: string;
  headword: string;
  homonym: number;
  pos: string;
  origin: string;
  tier: number;
  tier_label: string;
  freq_rank: number;
  gloss: string;
  gloss_source: 'original' | 'krdict';
  example?: { ko: string; en: string };
}

export interface Deck {
  version: string;
  credit: string;
  words: DeckWord[];
  byId: Map<string, DeckWord>;
}

declare const __DRILL_META__: (DeckMeta & { version: string }) | null | undefined;

export const DECK_META: DeckMeta & { version: string } =
  typeof __DRILL_META__ !== 'undefined' && __DRILL_META__ ? __DRILL_META__ : { version: '', count: 0, tiers: [] };

export const KRDICT_CREDIT_FALLBACK = 'English glosses for some words: 국립국어원 한국어기초사전 (CC BY-SA 2.0 KR)';

export function parseDeck(raw: unknown): Deck {
  const d = raw as { format?: unknown; version?: unknown; credit?: unknown; words?: unknown };
  if (d?.format !== 1 || !Array.isArray(d.words)) throw new Error('drill/deck.json is not a drill deck');
  const words = d.words as DeckWord[];
  return {
    version: String(d.version ?? ''), credit: typeof d.credit === 'string' ? d.credit : KRDICT_CREDIT_FALLBACK,
    words, byId: new Map(words.map((w) => [w.id, w] as const)),
  };
}

let loading: Promise<Deck> | null = null;

/** Fetches the deck once per page load (the service worker serves it offline). */
export function loadDeck(): Promise<Deck> {
  if (!loading) {
    loading = (async () => {
      const res = await fetch(new URL('drill/deck.json', document.baseURI).href);
      if (!res.ok) throw new Error(`drill/deck.json: HTTP ${res.status}`);
      return parseDeck(await res.json());
    })();
    loading.catch(() => { loading = null; });
  }
  return loading;
}

export function useDeck(): { deck: Deck | null; error: string | null } {
  const [st, setSt] = useState<{ deck: Deck | null; error: string | null }>({ deck: null, error: null });
  useEffect(() => {
    let live = true;
    loadDeck().then((deck) => { if (live) setSt({ deck, error: null }); },
      (e: unknown) => { if (live) setSt({ deck: null, error: (e as Error).message ?? String(e) }); });
    return () => { live = false; };
  }, []);
  return st;
}
