// Custom study (D88), on the drill page. Two kinds:
// - Study: a normal, scheduled session limited to a tier and/or word type: due cards that match,
//   plus up to N new cards from the filter (they count toward today's new cards).
// - Practice: a pass over a fixed list (missed today, leeches, recently learned, or a sample of
//   studied cards in the filter) that writes nothing and never changes the schedule.
import { useMemo, useState } from 'react';
import {
  drillCardId, dueLearning, dueReviews, leeches, missedToday, parseCardId, recentlyLearned, type DrillState,
} from '@ksrs/srs-engine';
import { now, tz } from '../../state/clock.ts';
import { drillDay } from '../../state/drill.ts';
import { useApp } from '../../state/hooks.ts';
import { DECK_META, type Deck, type DeckWord } from './deck.ts';

export type CustomStart =
  | { kind: 'study'; title: string; only: (cardId: string) => boolean; newQueue: string[] }
  | { kind: 'practice'; title: string; cardIds: string[] };

const POS_GROUPS: { id: string; label: string; test: (pos: string) => boolean }[] = [
  { id: 'all', label: 'All word types', test: () => true },
  { id: 'noun', label: 'Nouns', test: (p) => p === 'noun' || p === 'bound noun' || p === 'pronoun' },
  { id: 'verb', label: 'Verbs', test: (p) => p === 'verb' || p === 'auxiliary verb' },
  { id: 'adjective', label: 'Adjectives', test: (p) => p === 'adjective' || p === 'auxiliary adjective' },
  { id: 'adverb', label: 'Adverbs', test: (p) => p === 'adverb' },
  { id: 'determiner', label: 'Determiners', test: (p) => p === 'determiner' },
  { id: 'other', label: 'Other (numerals, particles, interjections…)', test: (p) => !['noun', 'bound noun', 'pronoun', 'verb', 'auxiliary verb', 'adjective', 'auxiliary adjective', 'adverb', 'determiner'].includes(p) },
];

type Source = 'missed' | 'leeches' | 'recent' | 'studied';
const WEEK = 7 * 86_400_000;
const PRACTICE_MAX = 50;

function shuffle<T>(a: T[]): T[] {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j]!, b[i]!]; }
  return b;
}

export function CustomStudy({ deck, onStart }: { deck: Deck; onStart: (s: CustomStart) => void }): JSX.Element {
  const app = useApp();
  const st: DrillState = app.drill;
  const settings = app.derived!.settings;
  const [tier, setTier] = useState(0);
  const [pos, setPos] = useState('all');
  const [newCount, setNewCount] = useState('10');
  const [source, setSource] = useState<Source>('missed');

  const t = now();
  const day = drillDay(t, settings, tz);
  const group = POS_GROUPS.find((g) => g.id === pos)!;
  const matchWord = (w: DeckWord | undefined) => !!w && (tier === 0 || w.tier === tier) && group.test(w.pos);
  const matchCard = (id: string) => matchWord(deck.byId.get(parseCardId(id).wordId));

  const study = useMemo(() => {
    const due = new Set([...dueLearning(st, day.end), ...dueReviews(st, day)].map((c) => c.id).filter(matchCard));
    const unseen = deck.words.filter((w) => matchWord(w) && !st.cards.has(drillCardId(w.id, 'f'))).map((w) => drillCardId(w.id, 'f'));
    return { due: due.size, unseen };
  }, [st, tier, pos, day.start]); // eslint-disable-line react-hooks/exhaustive-deps

  const practiceLists = useMemo(() => ({
    missed: missedToday(st, day).filter(matchCard),
    leeches: leeches(st).map((c) => c.id).filter(matchCard),
    recent: recentlyLearned(st, t, WEEK).filter(matchCard),
    studied: [...st.cards.values()].filter((c) => !c.known && c.phase !== 'new' && matchCard(c.id)).map((c) => c.id),
  }), [st, tier, pos, day.start]); // eslint-disable-line react-hooks/exhaustive-deps

  const n = Math.max(0, Math.min(200, Math.floor(Number(newCount) || 0)));
  const newQueue = study.unseen.slice(0, n);
  const scope = [tier ? `Tier ${tier}` : '', pos !== 'all' ? group.label.split(' (')[0]! : ''].filter(Boolean).join(' · ') || 'All words';
  const sourceLabel: Record<Source, string> = {
    missed: 'Missed today', leeches: 'Leeches', recent: 'Learned in the last 7 days', studied: `Random studied cards (up to ${PRACTICE_MAX})`,
  };
  const practiceIds = source === 'studied' ? shuffle(practiceLists.studied).slice(0, PRACTICE_MAX)
    : source === 'recent' ? practiceLists.recent.slice(-PRACTICE_MAX) : practiceLists[source].slice(0, PRACTICE_MAX * 2);

  return (
    <section className="card drill-custom" data-testid="drill-custom">
      <h3>Custom study</h3>
      <div className="drill-custom-filters">
        <label className="field"><span>Tier</span>
          <select value={String(tier)} data-testid="custom-tier" onChange={(e: { target: HTMLSelectElement }) => setTier(Number(e.target.value))}>
            <option value="0">All tiers</option>
            {DECK_META.tiers.map((x) => <option key={x.tier} value={x.tier}>Tier {x.tier} · {x.label}</option>)}
          </select>
        </label>
        <label className="field"><span>Word type</span>
          <select value={pos} data-testid="custom-pos" onChange={(e: { target: HTMLSelectElement }) => setPos(e.target.value)}>
            {POS_GROUPS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        </label>
      </div>

      <div className="drill-custom-block">
        <p><strong>Study</strong> <span className="muted small">— a normal session for these words only; answers are scheduled as usual.</span></p>
        <div className="row">
          <label className="custom-inline"><span>New cards</span>
            <input type="number" min={0} max={200} value={newCount} inputMode="numeric" data-testid="custom-new"
              onChange={(e: { target: HTMLInputElement }) => setNewCount(e.target.value)} />
          </label>
          <button type="button" className="btn btn-primary btn-small" data-testid="custom-study-start"
            disabled={study.due + newQueue.length === 0}
            onClick={() => {
              const ids = new Set(newQueue);
              onStart({ kind: 'study', title: `Custom study: ${scope}`, newQueue, only: (id) => ids.has(id) || matchCard(id) });
            }}>
            Study {study.due} due + {newQueue.length} new
          </button>
        </div>
        <p className="muted small">{study.unseen.length} unseen words match. New cards studied here count toward today's new-card limit.</p>
      </div>

      <div className="drill-custom-block">
        <p><strong>Practice</strong> <span className="muted small">— go over cards again without changing when they're due.</span></p>
        <div className="custom-practice-row">
          <label className="custom-inline custom-grow"><span>Cards</span>
            <select value={source} data-testid="custom-source" onChange={(e: { target: HTMLSelectElement }) => setSource(e.target.value as Source)}>
              {(Object.keys(sourceLabel) as Source[]).map((k) => <option key={k} value={k}>{sourceLabel[k]} ({practiceLists[k].length})</option>)}
            </select>
          </label>
          <button type="button" className="btn btn-quiet btn-small" data-testid="custom-practice-start" disabled={!practiceIds.length}
            onClick={() => onStart({ kind: 'practice', title: `${sourceLabel[source].split(' (')[0]}${scope !== 'All words' ? ` · ${scope}` : ''}`, cardIds: practiceIds })}>
            Practice {practiceIds.length}
          </button>
        </div>
      </div>
    </section>
  );
}
