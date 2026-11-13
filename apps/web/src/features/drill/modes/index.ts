// Answer-mode registry (D82). Add a mode by writing a component that takes AnswerModeProps and
// listing it here; Settings → Drill offers every registered mode.
import { CLOZE_MODE } from './ClozeMode.tsx';
import { FLIP_MODE } from './FlipMode.tsx';
import type { AnswerMode } from './types.ts';

export const ANSWER_MODES: readonly AnswerMode[] = [FLIP_MODE, CLOZE_MODE];

/** The mode for a setting value; unknown values (e.g. from a newer app) fall back to Flip. */
export function answerMode(id: string | undefined): AnswerMode {
  return ANSWER_MODES.find((m) => m.id === id) ?? FLIP_MODE;
}

export type { AnswerMode, AnswerModeProps, DrillCardView } from './types.ts';
