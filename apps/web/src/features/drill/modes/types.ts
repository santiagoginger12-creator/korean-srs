// Pluggable answer step for the drill (D82). A mode decides how the learner commits to an answer
// before self-grading: `flip` reveals the back and grades with 1–4. Another style (e.g. type the
// answer, then self-grade) is one new component registered in modes/index.ts; the session,
// scheduler and events stay the same.
import type { Rating } from '@ksrs/srs-engine';
import type { DeckWord } from '../deck.ts';

export interface DrillCardView {
  cardId: string;
  dir: 'f' | 'r';
  word: DeckWord;
}

export interface AnswerModeProps {
  card: DrillCardView;
  /** The card front (headword or gloss) and back (answer details), rendered by the session. */
  front: JSX.Element;
  back: JSX.Element;
  revealed: boolean;
  reveal: () => void;
  grade: (r: Rating) => void;
  /** Next interval per rating, e.g. { 1: '<1m', 2: '6m', 3: '10m', 4: '16d' }. */
  intervals: Record<Rating, string>;
  /** True while a session-level prompt (e.g. "mark as known?") owns the keyboard. */
  paused: boolean;
}

export interface AnswerMode {
  id: string;
  label: string;
  description: string;
  Component: (p: AnswerModeProps) => JSX.Element;
}
