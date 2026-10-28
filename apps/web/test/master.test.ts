import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MASTER_HEADER, parseMasterCsv, serializeMasterCsv, type MasterRow } from '@ksrs/content';
import { readMasterExt, replayAll, type AppEvent } from '@ksrs/srs-engine';
import {
  baselinePayload, decodeBaseline, encodeBaseline, lastExportPayload, masterRows, planSessionRows, removeSessionPayload, sessionPayloads,
} from '../src/data/master.ts';
import { fakeFactory, seedBundle } from './helpers.ts';

const row = (word: string, o: Partial<MasterRow> = {}): MasterRow => ({
  word, meaning: `${word}-en`, hanja: '', pos: 'noun', status: 'mastered', times_missed: 0, times_seen: 10, last_seen: '2026-08-01',
  freq_rank: null, sources: ['anki'], tags: [], notes: '', ...o,
});
const KST = 540;

test('baseline blob: deflate-raw + base64 round-trip, non-anki rows dropped, checksum verified', async () => {
  const rows = Array.from({ length: 500 }, (_, i) => row(`낱말${i}`, { meaning: `gloss ${i}, a; b`, times_missed: i % 9 }));
  rows.push(row('앱단어', { sources: ['app'] }));
  const blob = await encodeBaseline(rows, 'korean_master_vocab.csv', 1);
  assert.equal(blob.enc, 'deflate-raw+base64');
  assert.equal(blob.rows, 500);
  assert.ok(blob.data.length < serializeMasterCsv(rows).length / 2, `compressed ${blob.data.length}`);
  const back = await decodeBaseline(blob);
  assert.deepEqual(back, rows.slice(0, 500));
  assert.equal(await decodeBaseline(blob), back, 'memoized');

  const plain = await encodeBaseline(rows, 'f.csv', 2, { compress: false });
  assert.equal(plain.enc, 'csv');
  assert.deepEqual(await decodeBaseline(plain), back);
  await assert.rejects(decodeBaseline({ ...plain, importedAt: 3, data: plain.data.replace('낱말1,', '낱말X,') }), /damaged/);
});

test('session rows → events: items for new words, idempotent record, remove; export payload', async () => {
  const content = seedBundle();
  const f = fakeFactory();
  const base = [row('걸치다', { status: 'learning', times_missed: 78, times_seen: 320 })];
  const blob = await encodeBaseline(base, 'b.csv', f.now);
  const evs: AppEvent[] = [f.mk(baselinePayload(blob))];
  let d = replayAll(content, evs);
  let current = masterRows(d, await decodeBaseline(readMasterExt(d).baseline!), KST);
  assert.equal(current.find((r) => r.word === '걸치다')!.times_missed, 78);

  const block = '```\n걸치다,"to hang over; to span",,verb,learning,80,323,2026-10-28,,anki convo,leech,\n서먹하다,awkward,,adj,new,1,1,2026-10-28,,convo,,\n```';
  const pasted = parseMasterCsv(block).rows;
  const plan = planSessionRows(d, current, pasted, { source: 'convo', recordedAt: f.now, createItems: true });
  assert.equal(plan.duplicateOf, undefined);
  assert.deepEqual(plan.record.rows.map((r) => [r.word, r.missed, r.seen, r.isNew]), [['걸치다', 2, 3, false], ['서먹하다', 1, 1, true]]);
  assert.deepEqual(plan.items.map((i) => i.id), ['v:서먹하다']);
  assert.deepEqual(plan.record.itemIds, ['v:서먹하다']);
  const payloads = sessionPayloads(plan);
  assert.deepEqual(payloads.map((p) => p.type), ['customItem.upsert', 'settings.set']);
  f.advance(1000);
  evs.push(...payloads.map((p) => f.mk(p)));
  d = replayAll(content, evs);
  assert.ok(d.index.byId.has('v:서먹하다'), 'new word is a lesson item');
  current = masterRows(d, await decodeBaseline(readMasterExt(d).baseline!), KST);
  const m = new Map(current.map((r) => [r.word, r]));
  assert.deepEqual([m.get('걸치다')!.times_missed, m.get('걸치다')!.sources], [80, ['anki', 'convo']]);
  assert.deepEqual([m.get('서먹하다')!.times_missed, m.get('서먹하다')!.status, m.get('서먹하다')!.sources], [1, 'new', ['app', 'convo']]);

  // Same block again: recognised, and nothing would be added anyway.
  const again = planSessionRows(d, current, parseMasterCsv(block.replace(/```/g, '')).rows, { source: 'tutor', recordedAt: f.now, createItems: true });
  assert.ok(again.duplicateOf);
  assert.deepEqual(again.items, []);
  assert.deepEqual(again.record.rows.map((r) => r.missed), [0, 0]);

  // Remove the record: its deltas stop counting (the created item stays).
  evs.push(f.mk(removeSessionPayload(plan.record.hash)));
  d = replayAll(content, evs);
  assert.equal(readMasterExt(d).sessions.length, 0);
  const after = masterRows(d, await decodeBaseline(readMasterExt(d).baseline!), KST);
  assert.equal(after.find((r) => r.word === '걸치다')!.times_missed, 78);

  evs.push(f.mk(lastExportPayload(f.now, after)));
  assert.deepEqual(readMasterExt(replayAll(content, evs)).lastExport, { at: f.now, rows: after.length, learning: after.filter((r) => r.status === 'learning').length });
});

// ---------------------------------------------------------------- QA regressions

import { createEventFactory, createHlc, makeBackup, mergeEventSets, parseBackup, serializeBackup, type DerivedState, type EventPayload } from '@ksrs/srs-engine';
import { removeSessionPayloads } from '../src/data/master.ts';

function dev(id: string, start = Date.UTC(2026, 9, 23, 3, 0)) {
  let t = start;
  let r = id.length;
  const clock = () => t;
  const mk = createEventFactory({ deviceId: id, hlc: createHlc(id, clock), clock, rng: () => ((r = (r * 9301 + 49297) % 233280) / 233280) });
  return { get now() { return t; }, advance(ms: number) { t += ms; }, mk: (p: EventPayload): AppEvent => mk(p) };
}
const BASE = [
  row('걸치다', { status: 'learning', times_missed: 78, times_seen: 320 }),
  row('끼다', { status: 'learning', times_missed: 10, times_seen: 50 }),
  row('다정하다', { status: 'mastered', times_missed: 1, times_seen: 30 }),
];
const BLOCK_A = '걸치다,to hang,,verb,learning,80,323,2026-10-28,,anki convo,,\n서먹하다,awkward,,adj,new,1,1,2026-10-28,,convo,,';
const BLOCK_B = '끼다,to fit,,verb,learning,11,51,2026-10-29,,anki tutor,,\n다정하다,kind,,adj,learning,2,31,2026-10-29,,anki tutor,,';

async function csvOf(d: DerivedState): Promise<string> {
  const b = readMasterExt(d).baseline;
  return serializeMasterCsv(masterRows(d, b ? await decodeBaseline(b) : [], KST));
}
async function record(content: ReturnType<typeof seedBundle>, evs: AppEvent[], f: ReturnType<typeof dev>, block: string, source: 'convo' | 'tutor' = 'convo') {
  const d = replayAll(content, evs);
  const b = readMasterExt(d).baseline;
  const current = masterRows(d, b ? await decodeBaseline(b) : [], KST);
  const plan = planSessionRows(d, current, parseMasterCsv(block).rows, { source, recordedAt: f.now, createItems: true });
  f.advance(1000);
  return sessionPayloads(plan).map((p) => f.mk(p));
}

test('removing a recorded block reverses it exactly (unstudied items it added go too; studied ones stay)', async () => {
  const content = seedBundle();
  const f = dev('a');
  const evs: AppEvent[] = [f.mk(baselinePayload(await encodeBaseline(BASE, 'b.csv', f.now)))];
  const before = await csvOf(replayAll(content, evs));
  evs.push(...await record(content, evs, f, BLOCK_A));
  let d = replayAll(content, evs);
  assert.ok(d.index.byId.has('v:서먹하다'));
  assert.notEqual(await csvOf(d), before);
  const rm = removeSessionPayloads(d, readMasterExt(d).sessions[0]!);
  assert.deepEqual([rm.deleted, rm.kept], [['v:서먹하다'], []]);
  evs.push(...rm.payloads.map((p) => f.mk(p)));
  d = replayAll(content, evs);
  assert.equal(d.index.byId.has('v:서먹하다'), false);
  assert.equal(await csvOf(d), before, 'byte-identical to before recording');

  // Recorded again and the new word studied: removal keeps the item (and its app history).
  f.advance(1000);
  evs.push(...await record(content, evs, f, BLOCK_A));
  evs.push(f.mk({ type: 'lesson.completed', itemId: 'v:서먹하다' }));
  d = replayAll(content, evs);
  const rm2 = removeSessionPayloads(d, readMasterExt(d).sessions[0]!);
  assert.deepEqual([rm2.deleted, rm2.kept], [[], ['v:서먹하다']]);
});

test('export is byte-identical for the same inputs: event order, ext Map order and clock do not matter', async () => {
  const content = seedBundle();
  const f = dev('a');
  const evs: AppEvent[] = [f.mk(baselinePayload(await encodeBaseline(BASE, 'b.csv', f.now)))];
  evs.push(...await record(content, evs, f, BLOCK_A));
  evs.push(...await record(content, evs, f, BLOCK_B, 'tutor'));
  const d = replayAll(content, evs);
  const one = await csvOf(d);
  assert.equal(await csvOf(replayAll(content, evs.slice().reverse())), one);
  const shuffled = { ...d, ext: new Map([...d.ext].reverse()) };
  assert.equal(await csvOf(shuffled), one);
  const realNow = Date.now;
  try { Date.now = () => 0; assert.equal(await csvOf(d), one); } finally { Date.now = realNow; }
});

test('baseline and sessions survive backup → restore (replace and merge); two devices converge', async () => {
  const content = seedBundle();
  const a = dev('a');
  const b = dev('b', Date.UTC(2026, 9, 23, 3, 0) + 500);
  const shared: AppEvent[] = [a.mk(baselinePayload(await encodeBaseline(BASE, 'b.csv', a.now)))];
  // Device A records block A; device B (restored from A's backup before that) records block B offline.
  const meta = { createdAt: 'x', appVersion: 'v', contentVersion: 'c', deviceId: 'a' };
  const restored = parseBackup(serializeBackup(makeBackup(shared, meta)));
  assert.ok(restored.ok);
  const onA = [...shared, ...await record(content, shared, a, BLOCK_A)];
  const onB0 = restored.ok ? restored.events : [];
  const onB = [...onB0, ...await record(content, onB0, b, BLOCK_B, 'tutor')];
  // Replace restore on a fresh device reproduces A exactly.
  const viaFile = parseBackup(serializeBackup(makeBackup(onA, meta)));
  assert.ok(viaFile.ok);
  assert.equal(await csvOf(replayAll(content, viaFile.ok ? viaFile.events : [])), await csvOf(replayAll(content, onA)));
  // Merge both ways: same list, both blocks counted once.
  const ab = mergeEventSets(onA, onB);
  const ba = mergeEventSets(onB, onA);
  const csv = await csvOf(replayAll(content, ab));
  assert.equal(await csvOf(replayAll(content, ba)), csv);
  const m = new Map(parseMasterCsv(csv).rows.map((r) => [r.word, r]));
  assert.deepEqual(['걸치다', '끼다', '다정하다', '서먹하다'].map((w) => m.get(w)!.times_missed), [80, 11, 2, 1]);
  assert.equal(readMasterExt(replayAll(content, ab)).sessions.length, 2);
});

test('the same block recorded offline on two devices counts once after a merge', async () => {
  const content = seedBundle();
  const a = dev('a');
  const b = dev('b', Date.UTC(2026, 9, 23, 3, 0) + 7000);
  const shared: AppEvent[] = [a.mk(baselinePayload(await encodeBaseline(BASE, 'b.csv', a.now)))];
  const onA = [...shared, ...await record(content, shared, a, BLOCK_A)];
  // B pastes the same report with a header and fences (same parsed rows → same key).
  const onB = [...shared, ...await record(content, shared, b, '```csv\n' + MASTER_HEADER + '\n' + BLOCK_A + '\n```\n', 'tutor')];
  const merged = replayAll(content, mergeEventSets(onA, onB));
  const ext = readMasterExt(merged);
  assert.equal(ext.sessions.length, 1, 'one record (LWW on the same key)');
  assert.deepEqual([...merged.customItems.keys()].filter((k) => k === 'v:서먹하다'), ['v:서먹하다']);
  const m = new Map(parseMasterCsv(await csvOf(merged)).rows.map((r) => [r.word, r]));
  assert.deepEqual([m.get('걸치다')!.times_missed, m.get('서먹하다')!.times_missed], [80, 1]);
  assert.equal(await csvOf(merged), await csvOf(replayAll(content, mergeEventSets(onB, onA))));
});
