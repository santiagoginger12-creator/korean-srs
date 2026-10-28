// Derived (projected) state types (§7.2).

import type { Item, ItemId, ItemKind, QuestionType } from '@ksrs/content';
import type { ContentIndex } from './content-index.ts';
import type { HLC, NoteField } from './events.ts';
import type { AppSettings } from './settings.ts';
import type { SrsCore } from './scheduler/index.ts';

export interface ItemStats {
  /** Completed review groups (scheduled reviews that changed the stage). */
  reviews: number;
  /** Completed review groups with zero incorrect submissions. */
  correct: number;
  /** Incorrect submissions, including ignoredEarly ones (they count toward leech stats, D5). */
  incorrect: number;
  /** Consecutive clean review groups; reset by any incorrect submission. */
  streak: number;
  lastAt?: number;
  /** Self-graded ("I was right") answers that took effect. */
  selfGraded: number;
  /** Answers dropped by the dueness gate (§6.1 step 3). Addition to §7.2. */
  ignoredEarly: number;
}

export interface PendingGroup {
  answered: QuestionType[];
  incorrect: number;
  since: number;
  /** Sum of check.closeAttempts across the group. Addition to §7.2 (fed to Scheduler.next). */
  closeAttempts: number;
}

export interface ItemState extends SrsCore {
  itemId: ItemId;
  kind: ItemKind;
  level: number;
  lessonAt?: number;
  passedAt?: number;
  burnedAt?: number;
  pending: PendingGroup | null;
  stats: ItemStats;
  /** Score relative to the item's last activity; `troubleItems(s, n, now)` recomputes against `now`. */
  leechScore: number;
  /** Incorrect-submission timestamps within 90 d of the item's last activity. Addition to §7.2. */
  recentIncorrectAts: number[];
}

export interface DerivedState {
  items: Map<ItemId, ItemState>;
  userLevel: number;
  unlocked: Set<ItemId>;
  /** key: noteKey(itemId, field) */
  notes: Map<string, string>;
  /** M1 `Settings` plus the M5 extras (inbox.dismissed, tts.*). */
  settings: AppSettings;
  /** key: userAnswerKey(itemId, qtype) */
  userAnswers: Map<string, string[]>;
  customItems: Map<ItemId, Item>;
  lastHlc: HLC;
  /** Additions to §7.2: the content index (bundle + custom items) used by this projection… */
  index: ContentIndex;
  /**
   * `settings.set` values under the `ext.` namespace (D22 forward-compatible keys), LWW per key,
   * stored as written (no coercion; readers validate). A `null` value deletes the key.
   */
  ext: Map<string, unknown>;
  /** …and engine flags. fsrsFallback: an 'fsrs' scheduler setting exists but WK was used (D19). */
  flags: { fsrsFallback: boolean };
}

export const noteKey = (itemId: ItemId, field: NoteField): string => `${itemId}#${field}`;
export const userAnswerKey = (itemId: ItemId, qtype: QuestionType): string => `${itemId}#${qtype}`;
