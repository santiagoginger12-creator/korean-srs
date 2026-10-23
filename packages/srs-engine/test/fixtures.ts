// Small inline content fixture + event helpers for engine tests.
import type {
  ContentBundle, ExpressionItem, GrammarItem, HanjaItem, Item, ItemId, QuestionType, VocabItem,
} from '@ksrs/content';
import type { AppEvent, DerivedState, EventPayload } from '../src/index.ts';
import { createHlc, replayAll } from '../src/index.ts';
import { uuidv7 } from '../src/uuid7.ts';
import { fnv1a, mulberry32, HOUR } from '../src/util.ts';

export const T0 = Date.UTC(2026, 9, 1, 0, 0, 0); // 2026-10-01T00:00Z, hour-aligned

const base = { track: 'core', rev: 1, source: { kind: 'original' as const, license: 'original-owned' }, needs_review: false, tags: [] };

export function hanja(char: string, level: number, o: Partial<HanjaItem> = {}): HanjaItem {
  return { ...base, id: `h:${char}`, kind: 'hanja', level, unlockDeps: [], gating: false, char, hun: '훈', eum: '음',
    meanings: ['meaning'], mnemonic: 'm', ...o };
}

export function vocab(word: string, level: number, o: Partial<VocabItem> = {}): VocabItem {
  return {
    ...base, id: `v:${word}`, kind: 'vocab', level, unlockDeps: [], gating: true, word, meanings: [`${word}-en`],
    pos: 'noun', register: 'neutral', collocations: [], examples: [],
    questionTypes: ['meaning', 'production'],
    questions: { meaning: { accepted: [`${word}-en`] }, production: { promptEn: `${word}-en`, accepted: [word] } },
    ...o,
  };
}

export function grammar(pattern: string, level: number, o: Partial<GrammarItem> = {}): GrammarItem {
  return {
    ...base, id: `g:${pattern}`, kind: 'grammar', level, unlockDeps: [], gating: true, pattern, meaning: `${pattern}-en`,
    attachment: [], nuance: '', contrasts: [], examples: [],
    questionTypes: ['meaning', 'cloze'],
    questions: {
      meaning: { accepted: [`${pattern}-en`] },
      cloze: [
        { id: 'c1', sentence: `비가 {{}} 뛰었다.`, en: 'e1', cue: `cue ${pattern}`, accepted: [`a1${pattern}`], particleTolerance: 'none' },
        { id: 'c2', sentence: `{{}} 늦었다.`, en: 'e2', cue: `cue2 ${pattern}`, accepted: [`a2${pattern}`],
          nearMiss: [{ answer: 'nm', hint: 'h' }], particleTolerance: 'allomorph', spacingStrict: true },
      ],
    },
    ...o,
  };
}

export function expression(text: string, level: number, o: Partial<ExpressionItem> = {}): ExpressionItem {
  return {
    ...base, id: `x:${text}`, kind: 'expression', level, unlockDeps: [], gating: true, subtype: '관용구', text,
    meaning: 'very busy', literal: 'lit', usage: 'u', examples: [],
    questionTypes: ['meaning', 'nuance'],
    questions: {
      meaning: { accepted: ['very busy'] },
      nuance: [{ id: 'n1', situation: '상황', options: [
        { text: 'A', correct: false, why: 'wa' }, { text: 'B', correct: true, why: 'wb' }, { text: 'C', correct: false, why: 'wc' },
      ] }],
    },
    ...o,
  };
}

export function bundle(items: Item[], idRedirects: Record<ItemId, ItemId> = {}, contentVersion = 'sha256:test'): ContentBundle {
  return { formatVersion: 1, contentVersion, items, idRedirects };
}

/** 2 levels: hanja, Sino-Korean vocab (implicit hanja deps), native vocab, grammar with a guru dep, expression. */
export const FIXTURE: ContentBundle = bundle([
  hanja('決', 1), hanja('定', 1),
  vocab('결정', 1, { hanjaBreakdown: [{ syllable: '결', hanja: '決', hanjaId: 'h:決' }, { syllable: '정', hanja: '定', hanjaId: 'h:定' }] }),
  vocab('망설이다', 1, { pos: 'verb' }),
  vocab('결제', 1, { questions: { meaning: { accepted: ['payment'] }, production: { promptEn: 'payment', accepted: ['결제'], rejected: ['xx'] } } }),
  vocab('결재', 1),
  vocab('덤', 1, { gating: false }),
  grammar('는-바람에', 1),
  grammar('는-통에', 1, { unlockDeps: [{ id: 'g:는-바람에', require: 'guru' }] }),
  expression('눈코-뜰-새-없다', 1),
  hanja('心', 2),
  vocab('결심', 2, { hanjaBreakdown: [{ syllable: '결', hanja: '決', hanjaId: 'h:決' }, { syllable: '심', hanja: '心', hanjaId: 'h:心' }] }),
  vocab('베개', 2),
  grammar('느라고', 2),
]);

/** Bulk bundle: level 1 has `n` gating vocab (+1 hanja with gating:true to prove hanja never gate), level 2 a few items. */
export function bulkBundle(n: number, qtypes: QuestionType[] = ['meaning', 'production']): ContentBundle {
  const items: Item[] = [hanja('一', 1, { gating: true })];
  for (let i = 0; i < n; i++) items.push(vocab(`w${String(i).padStart(4, '0')}`, 1, { questionTypes: qtypes }));
  items.push(vocab('lvl2a', 2), vocab('lvl2b', 2), hanja('二', 2));
  return bundle(items);
}

// ---------------------------------------------------------------- events

export type Emit = (payload: EventPayload, at: number) => AppEvent;

/** A device: real HLC (clock = event time) + seeded UUIDv7. */
export function device(deviceId: string, seed = deviceId): Emit {
  let cur = 0;
  const hlc = createHlc(deviceId, () => cur);
  const rng = mulberry32(fnv1a(seed));
  return (payload, at) => {
    cur = at;
    return { ...payload, id: uuidv7(() => at, rng), v: 1, hlc: hlc.now(), deviceId, at } as AppEvent;
  };
}

export const lessonP = (itemId: ItemId): EventPayload => ({ type: 'lesson.completed', itemId });

export function answerP(itemId: ItemId, qtype: QuestionType, grade: 'correct' | 'incorrect',
                        required: QuestionType[] = [qtype], o: Partial<EventPayload & { type: 'review.answer' }> = {}): EventPayload {
  return {
    type: 'review.answer', itemId, qtype, response: grade === 'correct' ? 'ok' : 'nope', grade,
    check: { layer: grade === 'correct' ? 'exact' : 'none', closeAttempts: 0 }, requiredQTypes: required, durationMs: 8000, ...o,
  } as EventPayload;
}

/** Answers every required qtype correctly at `at`. */
export function passAll(emit: Emit, itemId: ItemId, required: QuestionType[], at: number): AppEvent[] {
  return required.map((q, i) => emit(answerP(itemId, q, 'correct', required), at + i));
}

/**
 * Drives an item through `n` clean reviews, each at its availableAt. Returns the new events.
 * Replays after each review (fine for tests).
 */
export function advance(content: ContentBundle, log: AppEvent[], emit: Emit, itemId: ItemId, n: number,
                        required: QuestionType[] = ['meaning', 'production']): AppEvent[] {
  const added: AppEvent[] = [];
  for (let k = 0; k < n; k++) {
    const st = replayAll(content, [...log, ...added]).items.get(itemId);
    if (!st || st.availableAt === null) break;
    added.push(...passAll(emit, itemId, required, st.availableAt));
  }
  return added;
}

/** Order-independent, comparable projection of DerivedState (drops the content index). */
export function canon(s: DerivedState): string {
  const sortEntries = <V>(m: Map<string, V>) => [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return JSON.stringify({
    items: sortEntries(s.items), userLevel: s.userLevel, unlocked: [...s.unlocked].sort(), notes: sortEntries(s.notes),
    settings: s.settings, userAnswers: sortEntries(s.userAnswers), customItems: sortEntries(s.customItems),
    lastHlc: s.lastHlc, flags: s.flags,
  });
}

export const at = (h: number, m = 0) => T0 + h * HOUR + m * 60_000;
