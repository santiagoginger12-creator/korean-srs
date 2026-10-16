// Content data model — the single source of truth for item shapes (ARCHITECTURE.md §5).
// FROZEN at M1: changing a shape requires a DECISIONS.md entry.

export type ItemId = string;            // "v:망설이다", "v:배:ship", "g:는-바람에", "x:눈코-뜰-새-없다", "h:決"
export type ItemKind = 'vocab' | 'grammar' | 'expression' | 'hanja';
export type ReviewableKind = Exclude<ItemKind, 'hanja'>;
export type QuestionType = 'meaning' | 'production' | 'cloze' | 'nuance' | 'register';
export type Register = 'formal' | 'written' | 'neutral' | 'spoken' | 'slang';
export type SpeechLevel = 'hapsyo' | 'haeyo' | 'hae' | 'haera' | 'written' | 'spoken';
export type ParticleTolerance = 'none' | 'allomorph' | 'loose';

export interface SourceInfo {
  kind: 'original' | 'krdict' | 'user' | 'import';
  license: 'original-owned' | 'CC-BY-SA-2.0-KR' | string;
  attribution?: string;     // required when license !== original-owned
  url?: string; retrievedAt?: string; krdictTargetCode?: number;
}
export interface UnlockDep { id: ItemId; require: 'lesson' | 'guru' }
export interface Example { ko: string; en: string; register?: Register; needs_review?: boolean }

export interface ItemBase {
  id: ItemId; kind: ItemKind; level: number; track: string; rev: number;
  unlockDeps: UnlockDep[];  gating: boolean;           // hanja: always false
  source: SourceInfo; needs_review: boolean; tags: string[];
  mnemonic?: string;        // optional for all kinds; required for hanja
}

export interface ReviewableBase extends ItemBase {
  kind: ReviewableKind;
  questionTypes: QuestionType[];        // 1–3; review completes when all are answered correctly
  questions: QuestionSpecs;             // acceptedAnswers per question type
}

export interface QuestionSpecs {
  meaning?:    { accepted: string[]; rejected?: string[] };          // EN; headword is the prompt
  production?: { promptEn: string; contextHint?: string; accepted: string[]; rejected?: string[] };
  cloze?:      ClozePrompt[];
  nuance?:     NuancePrompt[];
  register?:   RegisterPrompt[];
}
export interface ClozePrompt {
  id: string; sentence: string;          // exactly one "{{}}"
  en: string; cue: string;               // e.g. "쏟아지다 + -는 바람에"
  accepted: string[];                     // alternative conjugations allowed
  nearMiss?: { answer: string; hint: string }[];   // e.g. sibling pattern -는 통에
  particleTolerance: ParticleTolerance; spacingStrict?: boolean;
}
export interface NuancePrompt {
  id: string; situation: string;          // KO context, optionally with EN gloss
  options: { text: string; correct: boolean; why: string }[];  // 2–3, exactly one correct
}
export interface RegisterPrompt {
  id: string; from: SpeechLevel; to: SpeechLevel; source: string;
  accepted: string[];
  features: FeatureRule[];                // target-feature checks (§8.4)
  coreWords: string[];                    // content stems that must survive
  particleTolerance: ParticleTolerance; finalPunctOptional: boolean;
}
export type FeatureRule =
  | { kind: 'endsWith'; any: string[]; label: string }      // compared in jamo space
  | { kind: 'contains' | 'notContains'; any: string[]; scope?: 'lastEojeol' | 'all'; label: string };

export interface VocabItem extends ReviewableBase {
  kind: 'vocab'; word: string; meanings: string[]; pos: string; register: Register;
  hanjaBreakdown?: { syllable: string; hanja: string; hanjaId?: ItemId }[];
  collocations: { ko: string; en: string }[]; examples: Example[];   // 2–3
}
export interface GrammarItem extends ReviewableBase {
  kind: 'grammar'; pattern: string; meaning: string;
  attachment: { stem: 'V' | 'A' | 'N' | 'N이다' | 'V/A'; final?: 'vowel' | 'consonant' | 'ㄹ' | 'any';
                tense: 'present' | 'past' | 'future' | 'any'; form: string; example: string }[];
  nuance: string; contrasts: { id: ItemId; note: string }[]; examples: Example[];
}
export interface ExpressionItem extends ReviewableBase {
  kind: 'expression'; subtype: '관용구' | '속담' | '사자성어'; text: string; hanjaText?: string;
  meaning: string; literal: string; usage: string; examples: Example[];
}
export interface HanjaItem extends ItemBase {          // lesson-only, never scheduled
  kind: 'hanja'; char: string; hun: string; eum: string; meanings: string[]; mnemonic: string;
}
export type Item = VocabItem | GrammarItem | ExpressionItem | HanjaItem;

export interface ContentBundle {
  formatVersion: 1; contentVersion: string;   // sha256 of canonical JSON
  items: Item[]; idRedirects: Record<ItemId, ItemId>;
}

// Built by the engine at queue time and passed to the answer checker.
export type QuestionInstance = { qid: string; itemId: ItemId; promptId?: string } & (
  | { qtype: 'meaning'; promptKo: string; accepted: string[]; rejected: string[] }
  | { qtype: 'production'; promptEn: string; contextHint?: string; accepted: string[]; rejected: string[] }
  | { qtype: 'cloze'; before: string; after: string; en: string; cue: string;
      accepted: string[]; nearMiss: {answer: string; hint: string}[]; particleTolerance: ParticleTolerance; spacingStrict: boolean }
  | { qtype: 'nuance'; situation: string; options: { key: string; text: string; why: string }[]; correctKey: string }
  | { qtype: 'register'; from: SpeechLevel; to: SpeechLevel; source: string; accepted: string[];
      features: FeatureRule[]; coreWords: string[]; particleTolerance: ParticleTolerance; finalPunctOptional: boolean }
);
