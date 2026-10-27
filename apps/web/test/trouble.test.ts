import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY, replayAll, type AppEvent } from '@ksrs/srs-engine';
import { troubleRows } from '../src/state/trouble.ts';
import { fakeFactory, seedBundle } from './helpers.ts';

test('trouble rows: leeches with score, stage and the latest live wrong answer', () => {
  const content = seedBundle();
  const f = fakeFactory();
  const id = 'v:덤';
  const evs: AppEvent[] = [f.mk({ type: 'lesson.completed', itemId: id })];
  const wrong = (resp: string) => f.mk({
    type: 'review.answer', itemId: id, qtype: 'production', response: resp, grade: 'incorrect',
    check: { layer: 'none', closeAttempts: 0 }, requiredQTypes: ['meaning', 'production'], durationMs: 5000,
  });
  const right = (q: 'meaning' | 'production') => f.mk({
    type: 'review.answer', itemId: id, qtype: q, response: 'x', grade: 'correct',
    check: { layer: 'exact', closeAttempts: 0 }, requiredQTypes: ['meaning', 'production'], durationMs: 5000,
  });
  // Four review groups, each with wrong answers, spaced to stay due.
  for (let g = 0; g < 4; g++) {
    f.advance(3 * DAY);
    evs.push(wrong(`w${g}a`), wrong(`w${g}b`), right('meaning'), right('production'));
  }
  const voided = wrong('voided');
  evs.push(voided, f.mk({ type: 'event.void', targetId: voided.id, reason: 'undo' }));
  const s = replayAll(content, evs);
  const rows = troubleRows(s, evs, f.now);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.itemId, id);
  assert.equal(rows[0]!.label, '덤');
  assert.ok(rows[0]!.score >= 3);
  assert.equal(rows[0]!.lastWrong?.response, 'w3b'); // the voided answer is ignored
  assert.deepEqual(troubleRows(replayAll(content, []), [], f.now), []);
});
