// App-side drill helpers (state/drill.ts) and the answer-mode registry, on a tiny inline deck.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHlc, defaultAppSettings, replayDrill, uuidv7, type AppEvent, type DeckMeta, type EventPayload } from '@ksrs/srs-engine';
import type { MasterStatus } from '@ksrs/content';
import { ankiMasteredIds, drillDay, drillSummary, drillWaiting, sessionNewQueue, skipAheadIds } from '../src/state/drill.ts';
import { parseDeck, type DeckWord } from '../src/features/drill/deck.ts';
import { answerMode, ANSWER_MODES } from '../src/features/drill/modes/index.ts';
import { ratingFromKey, isRevealKey } from '../src/features/drill/modes/FlipMode.tsx';

const T = Date.UTC(2026, 10, 1, 3, 0, 0);
const SEOUL = 540;
const w = (n: number, tier: number, headword: string): DeckWord => ({
  id: `kw${String(n).padStart(5, '0')}`, headword, homonym: 0, pos: 'noun', origin: '', tier, tier_label: `T${tier}`,
  freq_rank: n, gloss: `${headword}-en`, gloss_source: tier === 1 ? 'original' : 'krdict',
});
const WORDS = [w(1, 1, '거'), w(2, 1, '내'), w(3, 2, '공항'), w(4, 2, '작년'), w(5, 3, '당신'), w(6, 3, '그녀')];
const META: DeckMeta = { count: 6, tiers: [1, 2, 3].map((t) => ({ tier: t, label: `T${t}`, count: 2, first: WORDS[(t - 1) * 2]!.id, last: WORDS[(t - 1) * 2 + 1]!.id })) };

function emitter() {
  let cur = 0;
  const hlc = createHlc('dev', () => cur);
  let seed = 1;
  return (p: EventPayload, at: number): AppEvent => { cur = at; return { ...p, id: uuidv7(() => at, () => ((seed = (seed * 16807) % 2147483647) / 2147483647)), v: 1, hlc: hlc.now(), deviceId: 'dev', at } as AppEvent; };
}

test('study day follows dayStartHour in the device zone', () => {
  const s = defaultAppSettings();
  const d = drillDay(T, s, SEOUL); // 12:00 Seoul
  assert.equal(new Date(d.start + SEOUL * 60_000).toISOString().slice(11, 16), '04:00');
  assert.equal(d.end - d.start, 86_400_000);
});

test('session queue: start tier, daily limit, then counts; placement lists skip cards already studied', () => {
  const e = emitter();
  const s = { ...defaultAppSettings(), 'drill.newPerDay': 3 };
  let st = replayDrill([]);
  assert.deepEqual(sessionNewQueue(st, WORDS, META, s, T, SEOUL), ['kw00001:f', 'kw00002:f', 'kw00003:f']);
  assert.deepEqual(sessionNewQueue(st, WORDS, META, { ...s, 'drill.startTier': 2 }, T, SEOUL), ['kw00003:f', 'kw00004:f', 'kw00005:f']);
  const log = [e({ type: 'drill.review', cardId: 'kw00001:f', rating: 3 }, T)];
  st = replayDrill(log);
  assert.deepEqual(skipAheadIds(st, WORDS, 3), ['kw00002:f', 'kw00003:f', 'kw00004:f']);
  const c = drillSummary(st, s, META, T + 1000, SEOUL);
  assert.equal(c.newForward, 2);
  assert.equal(c.learning, 1);
  assert.equal(drillWaiting(c), 3);
  const rows = [['거', 'mastered'], ['공항', 'mastered'], ['작년', 'learning']].map(([word, status]) => ({ word, status: status as MasterStatus }));
  assert.deepEqual(ankiMasteredIds(st, WORDS, rows as never), ['kw00003:f'], '거 is already in study');
});

test('deck parsing and answer modes', () => {
  const d = parseDeck({ format: 1, version: 'v', credit: 'c', words: WORDS });
  assert.equal(d.byId.get('kw00003')!.headword, '공항');
  assert.throws(() => parseDeck({ words: [] }));
  assert.equal(answerMode('flip').id, 'flip');
  assert.equal(answerMode('typed-from-the-future').id, 'flip', 'unknown modes fall back to flip');
  assert.ok(ANSWER_MODES.length >= 1);
  assert.equal(ratingFromKey({ key: '3', code: 'Digit3' }), 3);
  assert.equal(ratingFromKey({ key: 'Unidentified', code: 'Numpad4' }), 4);
  assert.equal(ratingFromKey({ key: 'a', code: 'KeyA' }), null);
  assert.ok(isRevealKey({ key: ' ', code: 'Space' }) && isRevealKey({ key: 'Enter', code: 'NumpadEnter' }));
});
