// Review-session snapshot (persisted to kv so a reload mid-session resumes, §13).
//
// `ReviewSession` can't be stored as-is: `ctx` holds a function, and each AnswerRecord keeps
// the whole previous session in `prev` (its own history included), so naive JSON grows
// exponentially with the number of answers. The UI only ever undoes or overrides the most
// recent answer (§6.2), so we keep a short chain: the last record, whose `prev` keeps its own
// last record, and so on to `depth`. Depth 2 covers "undo the override, then undo the answer".
// Pure; unit-tested in test/snapshot.test.ts.

import type { ReviewSession, SessionCtx } from '@ksrs/srs-engine';

export const SNAPSHOT_VERSION = 1;
export type StoredSession = Omit<ReviewSession, 'ctx'> & { ctx: null };
export interface SessionSnapshot { v: typeof SNAPSHOT_VERSION; savedAt: number; session: StoredSession }

export function compactSession(s: ReviewSession, depth = 2): StoredSession {
  const last = s.history[s.history.length - 1];
  const history = depth > 0 && last ? [{ ...last, prev: compactSession(last.prev, depth - 1) as ReviewSession }] : [];
  return { ...s, ctx: null, history };
}

export function toSnapshot(s: ReviewSession, savedAt: number): SessionSnapshot {
  return { v: SNAPSHOT_VERSION, savedAt, session: compactSession(s) };
}

function reattach(s: StoredSession | ReviewSession, ctx: SessionCtx): ReviewSession {
  return {
    ...s, ctx,
    history: s.history.map((r) => ({ ...r, prev: reattach(r.prev, ctx) })),
  };
}

/**
 * Restores a stored snapshot, or null if it is unusable: wrong version, not active, or it
 * references questions/items the current content no longer has.
 */
export function reviveSession(raw: unknown, ctx: SessionCtx, hasItem: (id: string) => boolean): ReviewSession | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const snap = raw as Partial<SessionSnapshot>;
  if (snap.v !== SNAPSHOT_VERSION || !snap.session) return null;
  const s = snap.session;
  if (s.status !== 'active' || s.mode !== 'review' || !Array.isArray(s.queue) || s.queue.length === 0) return null;
  for (const qid of s.queue) {
    const q = s.questions?.[qid];
    if (!q || !hasItem(q.itemId) || !s.items?.[q.itemId]) return null;
  }
  return reattach(s, ctx);
}
