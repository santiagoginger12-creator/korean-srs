// QA regression: Promote stores the checker's normal form, so the promoted answer grades exact,
// and the inbox hides every response that now grades exact (not just the engine's coarser key).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check } from '@ksrs/answer-check';
import { buildQuestions, replayAll, settingPayload, type AppEvent } from '@ksrs/srs-engine';
import { inboxEntries, promotedAnswer } from '../src/data/contract.ts';
import { fakeFactory, seedBundle } from './helpers.ts';

const ITEM = 'g:는-탓에';
const PLAIN = '제가 확인을 잘 안 한 탓에 일정이 늦어졌습니다.';
// Same answer as typed on another keyboard: zero-width space, double space, full-width stop.
const ODD = '제가 확인을​ 잘  안 한 탓에 일정이 늦어졌습니다．';

function variant(f: ReturnType<typeof fakeFactory>, response: string): AppEvent {
  return f.mk({
    type: 'review.answer', itemId: ITEM, qtype: 'register', promptId: 'r1', response, grade: 'correct',
    check: { layer: 'variant', closeAttempts: 0 }, requiredQTypes: ['nuance', 'register'], durationMs: 1000,
  });
}

test('promoted variant grades exact next time; checker-equivalent variants leave the inbox together', () => {
  const content = seedBundle();
  const f = fakeFactory();
  const log: AppEvent[] = [f.mk({ type: 'lesson.completed', itemId: ITEM })];
  f.advance(5 * 3_600_000);
  log.push(variant(f, ODD));
  f.advance(1000);
  log.push(variant(f, PLAIN));
  let s = replayAll(content, log);
  const entries = inboxEntries(s, log);
  assert.equal(entries.length, 1, 'checker-equivalent responses are one entry');

  // Promote the shown entry the way Inbox.tsx does.
  log.push(f.mk({ type: 'userAnswer.add', itemId: ITEM, qtype: 'register', answer: promotedAnswer(entries[0]!.response) }));
  s = replayAll(content, log);
  assert.deepEqual(inboxEntries(s, log), []);
  const q = buildQuestions(s.index.byId.get(ITEM)!, s, ['register'], 'seed').find((x) => x.qtype === 'register')!;
  for (const typed of [PLAIN, ODD]) {
    const r = check(q, typed);
    assert.equal(r.outcome, 'correct', typed);
    assert.equal(r.layer, 'exact', typed);
  }
  assert.equal(promotedAnswer(ODD), '제가 확인을 잘 안 한 탓에 일정이 늦어졌습니다.');
});

test('dismissed entries stay dismissed after merging another device\'s dismissals', () => {
  const content = seedBundle();
  const a = fakeFactory();
  const log: AppEvent[] = [a.mk({ type: 'lesson.completed', itemId: ITEM })];
  a.advance(5 * 3_600_000);
  const v1 = variant(a, PLAIN);
  a.advance(1000);
  const v2 = variant(a, '제가 확인을 꼼꼼히 안 한 탓에 일정이 늦어졌습니다.');
  log.push(v1, v2);
  const s0 = replayAll(content, log);
  assert.equal(inboxEntries(s0, log).length, 2);
  // Device A dismisses v1; device B (later) dismisses v2 from its own list.
  a.advance(1000);
  const dA = a.mk(settingPayload('inbox.dismissed', [v1.id]));
  a.advance(1000);
  const dB = { ...a.mk(settingPayload('inbox.dismissed', [v2.id])), deviceId: 'other' } as AppEvent;
  const merged = [...log, dA, dB];
  assert.deepEqual(inboxEntries(replayAll(content, merged), merged), []);
});
