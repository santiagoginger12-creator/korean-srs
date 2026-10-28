import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuestions, replayAll } from '../src/index.ts';
import { bundle, device, grammar, lessonP, T0 } from './fixtures.ts';

test('sentence banks rotate: every cloze prompt is used once per cycle, no back-to-back repeats (D68)', () => {
  const cloze = Array.from({ length: 9 }, (_, i) => ({
    id: `c${i}`, sentence: `문장 ${i} {{}}.`, en: `e${i}`, cue: '가다 + -는 바람에', accepted: [`a${i}`], particleTolerance: 'none' as const,
  }));
  const g = grammar('는-바람에', 1, { questionTypes: ['cloze'], questions: { cloze } });
  const d = device('d');
  const s = replayAll(bundle([g]), [d(lessonP(g.id), T0)]);
  const st = s.items.get(g.id)!;
  const seen: string[] = [];
  for (let r = 0; r < 18; r++) {
    st.stats.reviews = r;
    const q = buildQuestions(g, s, ['cloze'], `review|${r * 1000}`)[0]!;
    assert.equal(q.qtype, 'cloze');
    seen.push(q.promptId!);
  }
  assert.equal(new Set(seen.slice(0, 9)).size, 9, 'first cycle covers all 9 prompts');
  assert.deepEqual(seen.slice(9), seen.slice(0, 9), 'second cycle repeats the same order');
  for (let i = 1; i < seen.length; i++) assert.notEqual(seen[i], seen[i - 1]);
  // The session seed does not change which sentence a given review shows.
  st.stats.reviews = 3;
  assert.equal(buildQuestions(g, s, ['cloze'], 'a')[0]!.promptId, buildQuestions(g, s, ['cloze'], 'b')[0]!.promptId);
});
