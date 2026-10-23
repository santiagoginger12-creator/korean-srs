// Pure review-session reducer (§7.2). The UI wraps it in useReducer and persists `emit`.
// Event ids/HLCs/at come from the injected `ctx.mkEvent`. Extra-study mode emits nothing (§7.5).

import type { ItemId, QuestionInstance, QuestionType } from '@ksrs/content';
import type { AppEvent, EventOf, EventPayload } from './events.ts';
import { seededShuffle } from './util.ts';

/** The subset of answer-check's CheckResult the engine needs (the engine may not import answer-check, §4). */
export interface CheckOutcome { outcome: 'correct' | 'close' | 'incorrect'; layer: string; matched?: string }

export interface SessionCtx {
  /** Wraps a payload into a full event (id = UUIDv7, hlc = hlc.now(), deviceId, v: 1, at). */
  mkEvent: (payload: EventPayload, at: number) => AppEvent;
}

export type SessionMode = 'review' | 'extra';

export interface SessionItem {
  itemId: ItemId;
  required: QuestionType[];
  correct: QuestionType[];
  incorrect: number;
  started: boolean;
  complete: boolean;
}

export interface AnswerRecord {
  qid: string;
  itemId: ItemId;
  grade: 'correct' | 'incorrect';
  /** The emitted event (null in extra-study mode). */
  event: AppEvent | null;
  response: string;
  durationMs: number;
  closeAttempts: number;
  result: CheckOutcome;
  /** Session state before this record; undo restores it. */
  prev: ReviewSession;
  overridden?: boolean;
}

export interface ReviewSession {
  status: 'idle' | 'active' | 'done';
  mode: SessionMode;
  ctx: SessionCtx | null;
  requeueGap: number;
  questions: Record<string, QuestionInstance>;
  queue: string[];
  items: Record<ItemId, SessionItem>;
  /** Close attempts on the current question (not events, D7). */
  closeAttempts: number;
  history: AnswerRecord[];
  wrappingUp: boolean;
  tally: { correct: number; incorrect: number; completed: ItemId[] };
}

export interface StartItem {
  itemId: ItemId;
  instances: QuestionInstance[];
  /** Qtypes already answered correctly in an open pending group (ItemState.pending.answered). */
  alreadyCorrect?: QuestionType[];
}

export type SessionAction =
  | { type: 'start'; mode?: SessionMode; ctx?: SessionCtx; items: StartItem[]; seed: string; requeueGap?: number }
  | { type: 'answer'; qid?: string; response: string; result: CheckOutcome; durationMs: number; at: number }
  | { type: 'undo'; at: number }
  | { type: 'override'; at: number; acceptAnswer?: boolean }
  | { type: 'skip' }
  | { type: 'wrapUp' };

export function emptySession(): ReviewSession {
  return {
    status: 'idle', mode: 'review', ctx: null, requeueGap: 3, questions: {}, queue: [], items: {},
    closeAttempts: 0, history: [], wrappingUp: false, tally: { correct: 0, incorrect: 0, completed: [] },
  };
}

export function currentQuestion(sess: ReviewSession): QuestionInstance | null {
  const qid = sess.queue[0];
  return qid === undefined ? null : sess.questions[qid] ?? null;
}

const NOOP = (sess: ReviewSession) => ({ sess, emit: [] as AppEvent[] });

function emitOne(sess: ReviewSession, payload: EventPayload, at: number): AppEvent | null {
  if (sess.mode === 'extra') return null;
  if (!sess.ctx) throw new Error('sessionReducer: review mode requires ctx.mkEvent');
  return sess.ctx.mkEvent(payload, at);
}

function start(a: Extract<SessionAction, { type: 'start' }>): ReviewSession {
  const mode = a.mode ?? 'review';
  if (mode === 'review' && !a.ctx) throw new Error('sessionReducer: review mode requires ctx.mkEvent');
  const questions: Record<string, QuestionInstance> = {};
  const items: Record<ItemId, SessionItem> = {};
  const qids: string[] = [];
  for (const si of a.items) {
    const already = si.alreadyCorrect ?? [];
    const required = [...new Set([...si.instances.map((q) => q.qtype), ...already])];
    items[si.itemId] = { itemId: si.itemId, required, correct: already.slice(), incorrect: 0, started: already.length > 0, complete: false };
    for (const q of si.instances) {
      if (already.includes(q.qtype)) continue;
      questions[q.qid] = q;
      qids.push(q.qid);
    }
  }
  return {
    ...emptySession(), status: qids.length ? 'active' : 'done', mode, ctx: a.ctx ?? null,
    requeueGap: Math.max(1, a.requeueGap ?? 3), questions, items, queue: seededShuffle(qids, a.seed),
  };
}

/** Applies a graded answer to the head of the queue. Returns the new session (history not yet pushed). */
function applyGraded(sess: ReviewSession, q: QuestionInstance, grade: 'correct' | 'incorrect'): ReviewSession {
  const it = sess.items[q.itemId]!;
  const rest = sess.queue.slice(1);
  let item: SessionItem;
  let queue: string[];
  const tally = { ...sess.tally };
  if (grade === 'correct') {
    const correct = it.correct.includes(q.qtype) ? it.correct : [...it.correct, q.qtype];
    const complete = it.required.every((t) => correct.includes(t));
    item = { ...it, correct, started: true, complete };
    queue = rest;
    tally.correct++;
    if (complete) tally.completed = [...tally.completed, it.itemId];
  } else {
    item = { ...it, incorrect: it.incorrect + 1, started: true };
    const pos = Math.min(sess.requeueGap, rest.length);
    queue = [...rest.slice(0, pos), q.qid, ...rest.slice(pos)]; // requeue later in the session
    tally.incorrect++;
  }
  return {
    ...sess, items: { ...sess.items, [it.itemId]: item }, queue, closeAttempts: 0, tally,
    status: queue.length ? 'active' : 'done',
  };
}

function answerPayload(sess: ReviewSession, q: QuestionInstance, response: string, grade: 'correct' | 'incorrect',
                       result: CheckOutcome, closeAttempts: number, durationMs: number,
                       extra?: { overrides: string }): EventPayload {
  const check: EventOf<'review.answer'>['check'] = { layer: result.layer, closeAttempts };
  if (result.matched !== undefined) check.matched = result.matched;
  const p: EventPayload = {
    type: 'review.answer', itemId: q.itemId, qtype: q.qtype, response, grade, check,
    requiredQTypes: sess.items[q.itemId]!.required.slice(), durationMs,
  };
  if (q.promptId !== undefined) p.promptId = q.promptId;
  if (extra) { p.selfGraded = true; p.overrides = extra.overrides; }
  return p;
}

export function sessionReducer(sess: ReviewSession, action: SessionAction): { sess: ReviewSession; emit: AppEvent[] } {
  switch (action.type) {
    case 'start':
      return { sess: start(action), emit: [] };

    case 'answer': {
      const q = currentQuestion(sess);
      if (!q || sess.status !== 'active' || (action.qid !== undefined && action.qid !== q.qid)) return NOOP(sess);
      if (action.result.outcome === 'close') {
        return { sess: { ...sess, closeAttempts: sess.closeAttempts + 1 }, emit: [] };
      }
      const grade = action.result.outcome;
      const ev = emitOne(sess, answerPayload(sess, q, action.response, grade, action.result, sess.closeAttempts, action.durationMs), action.at);
      const next = applyGraded(sess, q, grade);
      const rec: AnswerRecord = {
        qid: q.qid, itemId: q.itemId, grade, event: ev, response: action.response, durationMs: action.durationMs,
        closeAttempts: sess.closeAttempts, result: action.result, prev: sess,
      };
      return { sess: { ...next, history: [...sess.history, rec] }, emit: ev ? [ev] : [] };
    }

    case 'undo': {
      const last = sess.history[sess.history.length - 1];
      if (!last) return NOOP(sess);
      const emit: AppEvent[] = [];
      if (last.event) {
        const v = emitOne(sess, { type: 'event.void', targetId: last.event.id, reason: 'undo' }, action.at);
        if (v) emit.push(v);
      }
      return { sess: last.prev, emit };
    }

    case 'override': {
      // "I was right": only for the most recent answer, if it was graded incorrect.
      const last = sess.history[sess.history.length - 1];
      if (!last || last.grade !== 'incorrect' || last.overridden) return NOOP(sess);
      const base = last.prev;
      const q = base.questions[last.qid]!;
      const result: CheckOutcome = { outcome: 'correct', layer: 'self' };
      const emit: AppEvent[] = [];
      const ev = last.event
        ? emitOne(sess, answerPayload(base, q, last.response, 'correct', result, last.closeAttempts, last.durationMs,
            { overrides: last.event.id }), action.at)
        : null;
      if (ev) emit.push(ev);
      if (action.acceptAnswer && last.response.trim() !== '') {
        const ua = emitOne(sess, { type: 'userAnswer.add', itemId: q.itemId, qtype: q.qtype, answer: last.response }, action.at);
        if (ua) emit.push(ua);
      }
      const next = applyGraded({ ...base, closeAttempts: last.closeAttempts }, q, 'correct');
      const rec: AnswerRecord = {
        qid: q.qid, itemId: q.itemId, grade: 'correct', event: ev, response: last.response, durationMs: last.durationMs,
        closeAttempts: last.closeAttempts, result, prev: sess, overridden: true,
      };
      // Undoing the override returns to the post-wrong-answer state (void of the override only).
      return { sess: { ...next, history: [...base.history, rec] }, emit };
    }

    case 'skip': {
      if (sess.queue.length < 2) return NOOP(sess);
      const [head, ...rest] = sess.queue;
      return { sess: { ...sess, queue: [...rest, head!], closeAttempts: 0 }, emit: [] };
    }

    case 'wrapUp': {
      // Finish only items already started; drop untouched ones.
      const queue = sess.queue.filter((qid) => sess.items[sess.questions[qid]!.itemId]!.started);
      return { sess: { ...sess, queue, wrappingUp: true, status: queue.length ? 'active' : 'done' }, emit: [] };
    }
  }
}
