import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContentIndex, replayAll } from '@ksrs/srs-engine';
import { browse } from '../src/state/browse.ts';
import { srsView, unlockView } from '../src/state/itemView.ts';
import { fakeFactory, seedBundle } from './helpers.ts';

test('unlock view: no hanja-lesson deps (D63); Sino-Korean vocab is available at once', () => {
  const content = seedBundle();
  const f = fakeFactory();
  const u0 = unlockView(replayAll(content, []), 'v:결재');
  assert.equal(u0.status, 'available');
  assert.deepEqual(u0.deps, []);
  // A log with old hanja lessons replays harmlessly.
  const s1 = replayAll(content, ['h:決', 'h:裁'].map((itemId) => f.mk({ type: 'lesson.completed', itemId })));
  assert.equal(unlockView(s1, 'v:결재').status, 'available');
});

test('unlock view: guru dep and level lock', () => {
  const s = replayAll(seedBundle(), []);
  assert.deepEqual(unlockView(s, 'g:는-통에').deps.map((d) => d.text), ['-는 바람에 reaches Guru']);
  const l2 = unlockView(s, 'g:느라고');
  assert.equal(l2.status, 'locked');
  assert.equal(l2.levelLocked, 2);
  assert.equal(l2.grammarPath, true);
  assert.equal(unlockView(s, 'v:결심').grammarPath, false);
});

test('srs view: null before the lesson; accuracy null before the first review', () => {
  const content = seedBundle();
  const f = fakeFactory();
  assert.equal(srsView(replayAll(content, []), 'v:덤', f.now), null);
  const s = replayAll(content, [f.mk({ type: 'lesson.completed', itemId: 'v:덤' })]);
  const v = srsView(s, 'v:덤', f.now)!;
  assert.equal(v.reviews, 0);
  assert.equal(v.accuracy, null);
  assert.equal(v.leech, null);
});

test('browse: level/kind filters and search over headwords, meanings, hanja forms; no hanja items', () => {
  const index = buildContentIndex(seedBundle());
  const all = browse(index, { level: 'all', kind: 'all', query: '' });
  assert.deepEqual([...all.keys()], [1, 2, 3]);
  const ids = (m: ReturnType<typeof browse>) => [...m.values()].flat().map((i) => i.id);
  assert.ok(![...all.values()].flat().some((i) => i.kind === 'hanja'));
  // Vocab is still found by its hanja form.
  assert.deepEqual(ids(browse(index, { level: 'all', kind: 'all', query: '決' })).sort(), ['v:결심', 'v:결재', 'v:결제'].sort());
  assert.deepEqual(ids(browse(index, { level: 'all', kind: 'all', query: 'Hesitate' })), ['v:망설이다']);
  assert.deepEqual(ids(browse(index, { level: 'all', kind: 'grammar', query: '바람에' })).sort(), ['g:는-바람에']);
  assert.equal(browse(index, { level: 'all', kind: 'all', query: 'zzzz' }).size, 0);
});
