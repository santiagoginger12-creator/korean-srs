// The one place the UI touches the M5 import/curation contract (Data agent: packages/content
// import + packages/srs-engine helpers). Thin adapters normalize shapes for the pages, so a
// contract change is a one-file fix.
import type { ItemId } from '@ksrs/content';
import { diffItems as diffItemsC, type KrdictSense } from '@ksrs/content';
import { normalizeKo } from '@ksrs/answer-check';
import {
  extraStudyItems, resetCandidates, userAnswerKey, variantsInbox, type AppEvent, type DerivedState, type ExtraStudySource, type VariantEntry,
} from '@ksrs/srs-engine';

export {
  csvTemplate, exportCsv, importCsv, importItems, importJson, krdictToVocab, parseKrdict,
  type ImportIssue, type KrdictSense,
} from '@ksrs/content';
export { settingPayload } from '@ksrs/srs-engine';

export type ItemDiff = ReturnType<typeof diffItemsC>;
export const diffItems = diffItemsC;

/** Display fields for a KRDict sense. */
export function senseView(s: KrdictSense): { word: string; sup?: number; pos: string; definitionKo: string; en: string } {
  const en = [s.transWord, s.transDfn].filter(Boolean).join(' — ');
  return { word: s.word, ...(s.supNo ? { sup: s.supNo } : {}), pos: s.pos ?? '', definitionKo: s.definitionKo ?? '', en };
}

// ---------------------------------------------------------------- variants inbox

export type InboxEntry = VariantEntry;

/** The checker's comparison key for a Korean answer (answer-check layer 1, final punctuation optional). */
const checkerKey = (s: string): string => normalizeKo(s, { stripFinalPunct: true }).toLowerCase();

/**
 * The form stored by Promote: the checker's own normalization (NFC, widths, quotes, zero-width
 * characters, spacing), so the stored answer and a re-typed one compare equal at layer 3.
 */
export const promotedAnswer = (response: string): string => normalizeKo(response);

/**
 * `variantsInbox`, minus entries that already grade exact against a user answer under the
 * checker's normalization (the engine's own dedupe is coarser), deduped by that key too.
 */
export const inboxEntries = (s: DerivedState, events: readonly AppEvent[]): InboxEntry[] => {
  const seen = new Set<string>();
  return variantsInbox(s, events).filter((e) => {
    const k = checkerKey(e.response);
    const dedupe = `${e.itemId}\u0000${e.qtype}\u0000${k}`;
    if (seen.has(dedupe)) return false;
    seen.add(dedupe);
    return !(s.userAnswers.get(userAnswerKey(e.itemId, e.qtype)) ?? []).some((a) => checkerKey(a) === k);
  });
};

/** settings `inbox.dismissed` (event ids of dismissed variants). */
export const dismissedList = (s: DerivedState): string[] => s.settings['inbox.dismissed'] ?? [];

// ---------------------------------------------------------------- extra study / trouble

export type PracticeSource = ExtraStudySource;

export const extraStudy = (s: DerivedState, src: PracticeSource, now: number, seed: string, limit: number): ItemId[] =>
  extraStudyItems(s, src, now, seed, limit);

/** Trouble items where "Reset to Apprentice 1" changes something (stage > 1). */
export const resetCandidateSet = (s: DerivedState, now: number): Set<ItemId> =>
  new Set(resetCandidates(s, now).map((r) => r.itemId));
