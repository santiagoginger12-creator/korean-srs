import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GrammarItem, Item } from '@ksrs/content';
import { replayAll } from '@ksrs/srs-engine';
import { HINT_MISS_TEXT, maxHintLevel, shortMeaning, splitCue, withHint } from '../src/state/hints.ts';
import { displayNuance, htskRefs, htskUrl, stripHtskSentence } from '../src/state/htsk.ts';
import { grammarPageView } from '../src/state/grammarView.ts';
import { planAll, queueFor } from '../src/state/lessons.ts';
import { grammarCardView } from '../src/state/dashboard.ts';
import { parseRoute } from '../src/router.ts';
import { fakeFactory, seedBundle } from './helpers.ts';

test('cue split: "<dict> + <pattern>", whole cue without " + "', () => {
  assert.deepEqual(splitCue('졸다 + -는 바람에'), { base: '졸다', pattern: '-는 바람에' });
  assert.deepEqual(splitCue('걸치다 · throw on (clothing)'), { base: '걸치다 · throw on (clothing)', pattern: null });
  assert.equal(maxHintLevel('졸다 + -는 바람에'), 2);
  assert.equal(maxHintLevel('걸치다 · drape'), 1);
});

test('short meaning: no Korean (pattern-free), first clause, truncated', () => {
  const g = { kind: 'grammar', meaning: 'because of a sudden, unexpected event, with an unwanted result ("…, and so I ended up …")' } as GrammarItem;
  const m = shortMeaning(g);
  assert.ok(!/\p{Script=Hangul}/u.test(m));
  assert.ok(m.length <= 81);
  assert.equal(shortMeaning({ kind: 'grammar', meaning: 'like -는 바람에 but blames a chaotic scene; colloquial' } as GrammarItem), 'like ~ but blames a chaotic scene');
  const long = shortMeaning({ kind: 'grammar', meaning: 'word '.repeat(40) } as GrammarItem);
  assert.ok(long.endsWith('…') && long.length <= 81);
});

test('withHint: layer suffix; correct at level 2 becomes a miss', () => {
  assert.deepEqual(withHint({ outcome: 'correct', layer: 'exact' }, 0), { outcome: 'correct', layer: 'exact', hintPenalty: false });
  assert.deepEqual(withHint({ outcome: 'correct', layer: 'exact' }, 1), { outcome: 'correct', layer: 'exact+hint1', hintPenalty: false });
  assert.deepEqual(withHint({ outcome: 'correct', layer: 'exact', matched: 'x' }, 2), { outcome: 'incorrect', layer: 'exact+hint2', matched: 'x', hintPenalty: true });
  assert.deepEqual(withHint({ outcome: 'incorrect', layer: 'none' }, 2), { outcome: 'incorrect', layer: 'none+hint2', hintPenalty: false });
  assert.match(HINT_MISS_TEXT, /counted as a miss/);
});

test('HTSK: unit links, label-only outside 101–150, nuance sentence stripped only with the tag', () => {
  assert.equal(htskUrl(101), 'https://www.howtostudykorean.com/unit-5/');
  assert.equal(htskUrl(125), 'https://www.howtostudykorean.com/unit-5/');
  assert.equal(htskUrl(126), 'https://www.howtostudykorean.com/unit-6/');
  assert.equal(htskUrl(150), 'https://www.howtostudykorean.com/unit-6/');
  assert.equal(htskUrl(100), null);
  const it = { kind: 'grammar', tags: ['htsk:131', 'htsk:131', 'fn:cause'], nuance: 'Formal. See also HowtoStudyKorean Lesson 131.' } as unknown as Item & { nuance: string };
  assert.deepEqual(htskRefs(it).map((r) => r.label), ['HowtoStudyKorean Lesson 131']);
  assert.equal(displayNuance(it), 'Formal.');
  assert.equal(displayNuance({ ...it, tags: [] } as never), 'Formal. See also HowtoStudyKorean Lesson 131.');
  assert.equal(stripHtskSentence('A. See also HowtoStudyKorean Lessons 101 and 102.'), 'A.');
});

test('grammar page: groups by fn:* (Other last), stage chips, contrast sets', () => {
  const content = seedBundle();
  // Drop fn:* from -느라고 so it lands in "Other".
  const items = content.items.map((it) => (it.id === 'g:느라고' ? { ...it, tags: it.tags.filter((t) => !t.startsWith('fn:')) } : it));
  const v = grammarPageView(replayAll({ ...content, items }, []));
  assert.deepEqual(v.groups.map((g) => g.label), ['Cause', 'Concession', 'Inevitability', 'Other']);
  assert.deepEqual(v.groups[0]!.rows.map((r) => [r.id, r.stage]), [['g:는-바람에', 1], ['g:는-탓에', 1], ['g:는-통에', 1]]);
  assert.deepEqual(v.groups[1]!.rows.map((r) => [r.id, r.stage]), [['g:더라도', 2]]);
  assert.deepEqual(v.groups[2]!.rows.map((r) => [r.id, r.stage, r.level]), [['g:기-마련이다', 3, 3]]);
  assert.deepEqual(v.groups[3]!.rows.map((r) => r.id), ['g:느라고']);
  assert.deepEqual(v.stages.map((g) => [g.stage, g.gatingTotal, g.open]), [[1, 2, true], [2, 2, false], [3, 1, false]]);
  assert.deepEqual(v.contrastSets.map((c) => [c.label, c.rows.length]), [['Unwanted cause', 3]]);
});

test('separate lesson plans; grammar card counts; routes', () => {
  const content = seedBundle();
  const f = fakeFactory();
  const s = replayAll(content, []);
  const p = planAll(s, [], f.now, 0, undefined);
  assert.ok(p.vocab.queue.every((id) => s.index.byId.get(id)!.kind !== 'grammar'));
  assert.ok(p.grammar.queue.length > 0 && p.grammar.queue.every((id) => s.index.byId.get(id)!.kind === 'grammar'));
  assert.ok(p.grammar.queue.length <= 3);
  assert.deepEqual(queueFor('grammar', s, [], f.now, 0, undefined).queue, p.grammar.queue);
  const g = grammarCardView(s, p.grammar, []);
  assert.equal(g.separate, true);
  assert.equal(g.stage, 1);
  assert.equal(g.lessons, p.grammar.queue.length);
  // Combined mode: no grammar plan; grammar comes back into the main queue.
  const off = replayAll(content, [f.mk({ type: 'settings.set', key: 'grammar.separatePath' as never, value: false })]);
  const po = planAll(off, [], f.now, 0, undefined);
  assert.equal(po.grammar.queue.length, 0);
  assert.equal(grammarCardView(off, po.grammar, []).separate, false);
  assert.deepEqual(parseRoute('#/lessons/grammar'), { name: 'lessons', path: 'grammar' });
  assert.deepEqual(parseRoute('#/grammar'), { name: 'grammar' });
  assert.deepEqual(parseRoute('#/ghosts'), { name: 'ghosts' });
});
