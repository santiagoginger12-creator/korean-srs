// Item-page view models (pure). Unit-tested in test/itemView.test.ts.
import type { ItemId } from '@ksrs/content';
import { headword, isLeech, isSeparatePath, leechScore, relatedItems, resolveId, type DerivedState } from '@ksrs/srs-engine';

export interface DepView { id: ItemId; label: string; require: 'lesson' | 'guru'; met: boolean; text: string }
export interface UnlockView {
  status: 'learned' | 'available' | 'locked';
  /** Set when the item's level (or, for grammar on the separate path, its grammar stage) isn't open yet. */
  levelLocked: number | null;
  /** True when `levelLocked` refers to the grammar path. */
  grammarPath: boolean;
  deps: DepView[];
}

export function unlockView(s: DerivedState, itemId: ItemId): UnlockView {
  const id = resolveId(s.index.redirects, itemId);
  const it = s.index.byId.get(id);
  const deps: DepView[] = relatedItems(s.index, id).unlockedBy.map((d) => {
    const dep = s.index.byId.get(d.id)!;
    const st = s.items.get(d.id);
    const label = headword(dep);
    const met = d.require === 'lesson' ? st?.lessonAt !== undefined : st?.passedAt !== undefined;
    const text = d.require === 'lesson' ? `${label} lesson` : `${label} reaches Guru`;
    return { id: d.id, label, require: d.require, met, text };
  });
  const learned = s.items.get(id)?.lessonAt !== undefined;
  const status = learned ? 'learned' : s.unlocked.has(id) ? 'available' : 'locked';
  const grammarPath = it?.kind === 'grammar' && isSeparatePath(s.settings);
  const openTo = grammarPath ? (s.grammarStage ?? 0) : s.userLevel;
  const levelLocked = status === 'locked' && it && it.level > openTo ? it.level : null;
  return { status, levelLocked, grammarPath, deps };
}

export interface SrsView {
  reviews: number;
  /** Share of completed review groups with no wrong answer (null before the first review). */
  accuracy: number | null;
  incorrect: number;
  streak: number;
  selfGraded: number;
  leech: { score: number; isLeech: boolean } | null;
}

export function srsView(s: DerivedState, itemId: ItemId, now: number): SrsView | null {
  const st = s.items.get(resolveId(s.index.redirects, itemId));
  if (!st || st.kind === 'hanja' || st.lessonAt === undefined) return null;
  const score = leechScore(st.recentIncorrectAts, st.stats.streak, now);
  return {
    reviews: st.stats.reviews,
    accuracy: st.stats.reviews ? st.stats.correct / st.stats.reviews : null,
    incorrect: st.stats.incorrect,
    streak: st.stats.streak,
    selfGraded: st.stats.selfGraded,
    leech: score > 0 ? { score, isLeech: isLeech(st, now) } : null,
  };
}
