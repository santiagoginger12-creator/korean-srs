import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coerceAppSetting, defaultAppSettings, pickExample, replayAll, settingPayload, type DictExample } from '../src/index.ts';
import { bundle, device, T0 } from './fixtures.ts';

const originals = [{ ko: '원래 예문 1', en: 'o1' }, { ko: '원래 예문 2', en: 'o2' }];
const dict: DictExample[] = [
  { kind: 'sentence', ko: '사전 예문 1', match: '예문' },
  { kind: 'sentence', ko: '사전 예문 2', match: '예문' },
  { kind: 'dialogue', lines: ['가: 뭐 해?', '나: 예문 읽어.'], match: '예문', matchLine: 1 },
  { kind: 'sentence', ko: '사전 예문 4', match: '예문' },
];
const key = (p: ReturnType<typeof pickExample>) => (p ? `${p.source}:${p.index}` : 'none');

test('pickExample: every example once per cycle, then the same order again; no back-to-back repeats', () => {
  const n = originals.length + dict.length;
  const seen = Array.from({ length: n * 3 }, (_, r) => key(pickExample('v:망설이다', originals, dict, r)));
  const cycle = seen.slice(0, n);
  assert.equal(new Set(cycle).size, n, 'first cycle covers the whole pool');
  assert.ok(cycle.includes('original:0') && cycle.includes('original:1') && cycle.includes('dict:2'));
  assert.deepEqual(seen.slice(n, 2 * n), cycle);
  assert.deepEqual(seen.slice(2 * n), cycle);
  for (let i = 1; i < seen.length; i++) assert.notEqual(seen[i], seen[i - 1], `reviews ${i - 1} and ${i}`);
});

test('pickExample: deterministic per item and review count, and the order differs between items', () => {
  for (let r = 0; r < 12; r++) {
    assert.deepEqual(pickExample('v:덤', originals, dict, r), pickExample('v:덤', originals, dict, r));
  }
  const orderOf = (id: string) => Array.from({ length: 6 }, (_, r) => key(pickExample(id, originals, dict, r))).join(',');
  const orders = new Set(['v:덤', 'v:결재', 'v:결제', 'v:재량', 'x:발등에-불이-떨어지다'].map(orderOf));
  assert.ok(orders.size > 1, 'items do not all share one order');
  // Returns the actual entries.
  const p = pickExample('v:덤', originals, dict, 0)!;
  assert.equal(p.example, p.source === 'original' ? originals[p.index] : dict[p.index]);
});

test('pickExample: originals only (no dictionary file, or the setting off) still rotate', () => {
  const seen = Array.from({ length: 6 }, (_, r) => pickExample('v:결심', originals, [], r)!);
  assert.ok(seen.every((p) => p.source === 'original'));
  assert.equal(new Set(seen.slice(0, 2).map((p) => p.index)).size, 2);
  for (let i = 1; i < seen.length; i++) assert.notEqual(seen[i]!.index, seen[i - 1]!.index);
  // A single example is always that example; nothing at all → undefined.
  assert.equal(pickExample('v:x', [originals[0]], [], 7)!.example, originals[0]);
  assert.equal(pickExample('v:x', [], [], 3), undefined);
  // Odd review counts don't throw or go out of range.
  for (const r of [-1, -7, 1e9, Number.NaN]) assert.ok(pickExample('v:x', originals, dict, r));
});

test('examples.dictionary setting: default on, coerced, folded on replay (D53)', () => {
  assert.equal(defaultAppSettings()['examples.dictionary'], true);
  assert.equal(coerceAppSetting('examples.dictionary', false), false);
  assert.equal(coerceAppSetting('examples.dictionary', 'no'), undefined);
  const d = device('d');
  assert.equal(replayAll(bundle([]), [d(settingPayload('examples.dictionary', false), T0)]).settings['examples.dictionary'], false);
  assert.equal(replayAll(bundle([]), [d({ type: 'settings.set', key: 'examples.dictionary' as never, value: 0 }, T0)]).settings['examples.dictionary'], true);
});
