import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContentIndex, relatedItems } from '../src/index.ts';
import { bundle, grammar, hanja, vocab } from './fixtures.ts';

const hb = (pairs: [string, string][]) => pairs.map(([syllable, h]) => ({ syllable, hanja: h, hanjaId: `h:${h}` }));

const B = bundle([
  hanja('決', 1), hanja('定', 1), hanja('心', 1),
  vocab('결심', 1, { hanjaBreakdown: hb([['결', '決'], ['심', '心']]) }),
  vocab('결정', 1, { hanjaBreakdown: hb([['결', '決'], ['정', '定']]) }),
  vocab('안정', 1, { hanjaBreakdown: [{ syllable: '안', hanja: '安' }, { syllable: '정', hanja: '定', hanjaId: 'h:定' }] }),
  vocab('결결', 1, { hanjaBreakdown: hb([['결', '決'], ['결', '決']]) }), // repeated hanja → one group
  vocab('덤', 1),
  grammar('는-바람에', 1, { contrasts: [{ id: 'g:는-탓에', note: 'out-note' }, { id: 'g:old-통에', note: 'via redirect' }] }),
  grammar('는-탓에', 1, { contrasts: [] }), // lists nothing; still gets the incoming contrast
  grammar('는-통에', 1, { unlockDeps: [{ id: 'g:는-바람에', require: 'guru' }],
    contrasts: [{ id: 'g:는-바람에', note: 'in-note' }, { id: 'g:missing', note: 'dangling' }] }),
], { 'g:old-통에': 'g:는-통에' });
const I = buildContentIndex(B);

describe('relatedItems', () => {
  test('vocab: other vocab per shared hanja, in content order, self excluded, unknown hanja skipped', () => {
    const r = relatedItems(I, 'v:결정');
    assert.deepEqual(r.byHanja, [
      { hanjaId: 'h:決', items: ['v:결심', 'v:결결'] },
      { hanjaId: 'h:定', items: ['v:안정'] },
    ]);
    assert.deepEqual(relatedItems(I, 'v:안정').byHanja, [{ hanjaId: 'h:定', items: ['v:결정'] }]);
    assert.deepEqual(relatedItems(I, 'v:결결').byHanja, [{ hanjaId: 'h:決', items: ['v:결심', 'v:결정'] }]);
    assert.deepEqual(relatedItems(I, 'v:덤').byHanja, []);
  });

  test('vocab: implicit hanja-lesson deps are unlockedBy; hanja list what they unlock', () => {
    assert.deepEqual(relatedItems(I, 'v:결정').unlockedBy, [{ id: 'h:決', require: 'lesson' }, { id: 'h:定', require: 'lesson' }]);
    assert.deepEqual(relatedItems(I, 'h:定').unlocks, ['v:결정', 'v:안정']);
  });

  test('hanja: one group listing all of its vocab', () => {
    assert.deepEqual(relatedItems(I, 'h:決').byHanja, [{ hanjaId: 'h:決', items: ['v:결심', 'v:결정', 'v:결결'] }]);
  });

  test('grammar: contrasts in both directions, redirects resolved, dangling and self dropped', () => {
    assert.deepEqual(relatedItems(I, 'g:는-바람에').contrasts, [
      { id: 'g:는-탓에', note: 'out-note', direction: 'out' },
      { id: 'g:는-통에', note: 'via redirect', direction: 'out' },
      { id: 'g:는-통에', note: 'in-note', direction: 'in' },
    ]);
    assert.deepEqual(relatedItems(I, 'g:는-탓에').contrasts, [{ id: 'g:는-바람에', note: 'out-note', direction: 'in' }]);
    assert.deepEqual(relatedItems(I, 'g:는-통에').contrasts, [
      { id: 'g:는-바람에', note: 'in-note', direction: 'out' },
      { id: 'g:는-바람에', note: 'via redirect', direction: 'in' },
    ]);
  });

  test('grammar: explicit guru dep, and the reverse unlock edge', () => {
    assert.deepEqual(relatedItems(I, 'g:는-통에').unlockedBy, [{ id: 'g:는-바람에', require: 'guru' }]);
    assert.deepEqual(relatedItems(I, 'g:는-바람에').unlocks, ['g:는-통에']);
  });

  test('ids resolve through redirects; unknown ids give an empty result', () => {
    assert.deepEqual(relatedItems(I, 'g:old-통에'), relatedItems(I, 'g:는-통에'));
    assert.deepEqual(relatedItems(I, 'v:nope'), { byHanja: [], contrasts: [], unlockedBy: [], unlocks: [] });
  });

  test('memoized per index but never shares mutable arrays between calls', () => {
    const a = relatedItems(I, 'h:決');
    a.byHanja[0]!.items.push('x');
    a.unlocks.push('x');
    assert.deepEqual(relatedItems(I, 'h:決').byHanja[0]!.items, ['v:결심', 'v:결정', 'v:결결']);
    assert.ok(!relatedItems(I, 'h:決').unlocks.includes('x'));
  });

  test('a custom grammar item without contrasts does not break related lookups for other items (QA)', () => {
    const bare = { ...grammar('qa-bare', 1), contrasts: undefined } as unknown as Parameters<typeof buildContentIndex>[1] extends Iterable<infer T> | undefined ? T : never;
    const idx = buildContentIndex(B, [bare]);
    assert.deepEqual(relatedItems(idx, 'g:qa-bare').contrasts, []);
    assert.equal(relatedItems(idx, 'g:는-탓에').contrasts.length, 1);
  });
});
