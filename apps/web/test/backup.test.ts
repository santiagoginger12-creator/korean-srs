import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY, DUPLICATE_ID_REASON, makeBackup, parseBackup, serializeBackup } from '@ksrs/srs-engine';
import {
  backupDue, backupFilename, decodeBackupFile, encodeBackup, friendlyBackupError, quarantineKey, restorePreview,
} from '../src/data/backup.ts';
import { fakeFactory } from './helpers.ts';

function log(deviceSeed = 0) {
  const f = fakeFactory(Date.UTC(2026, 9, 23, 3) + deviceSeed);
  const a = f.mk({ type: 'lesson.completed', itemId: 'v:덤' });
  f.advance(DAY);
  const b = f.mk({ type: 'lesson.completed', itemId: 'v:망설이다' });
  return [a, b];
}

test('restore preview counts new vs present, date range and devices', () => {
  const [a, b] = log();
  const p = restorePreview([a!], [a!, b!], 1);
  assert.equal(p.incoming, 2);
  assert.equal(p.fresh, 1);
  assert.equal(p.alreadyPresent, 1);
  assert.deepEqual(p.range, { from: a!.at, to: b!.at });
  assert.deepEqual(p.devices, [{ deviceId: 'test', count: 2 }]);
  assert.equal(p.quarantined, 1);
  assert.deepEqual(p.freshByType, { 'lesson.completed': 1 });
  assert.equal(restorePreview([], [], 0).range, null);
});

test('gzip round-trip and plain JSON both decode; the result still verifies', async () => {
  const backup = serializeBackup(makeBackup(log(), { createdAt: 'x', appVersion: 't', contentVersion: 'c', deviceId: 'd' }));
  for (const gz of [true, false]) {
    const blob = await encodeBackup(backup, gz);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    assert.equal(bytes[0] === 0x1f && bytes[1] === 0x8b, gz);
    const text = await decodeBackupFile(blob);
    assert.equal(text, backup);
    assert.equal(parseBackup(text).ok, true);
  }
});

test('a tampered backup fails the checksum and gets a friendly message', () => {
  const b = makeBackup(log(), { createdAt: 'x', appVersion: 't', contentVersion: 'c', deviceId: 'd' });
  const evil = JSON.parse(serializeBackup(b));
  evil.events[0].itemId = 'v:결재';
  const r = parseBackup(JSON.stringify(evil));
  assert.equal(r.ok, false);
  assert.match(friendlyBackupError(r.ok ? '' : r.error), /modified or damaged/);
  assert.match(friendlyBackupError('not JSON'), /not JSON/);
});

test('reminder after 7 days (or never backed up), but not with an empty log', () => {
  const t = Date.UTC(2026, 9, 30);
  assert.equal(backupDue(undefined, t, 0), false);
  assert.equal(backupDue(undefined, t, 5), true);
  assert.equal(backupDue(t - 6 * DAY, t, 5), false);
  assert.equal(backupDue(t - 8 * DAY, t, 5), true);
});

test('file names are safe and say whether they are gzipped', () => {
  const n = backupFilename(Date.UTC(2026, 9, 23, 3, 5), 'My iPhone / 15', true);
  assert.match(n, /^ksrs-My-iPhone-15-\d{8}-\d{4}\.ksrs\.json\.gz$/);
  assert.match(backupFilename(0, '', false), /^ksrs-device-\d{8}-\d{4}\.ksrs\.json$/);
});

test('quarantine keys: event id when present, else a stable content hash', () => {
  assert.equal(quarantineKey({ id: 'abc', v: 2 }), 'id:abc');
  assert.equal(quarantineKey({ v: 9, x: 1 }), quarantineKey({ x: 1, v: 9 }));
  assert.notEqual(quarantineKey({ v: 9 }), quarantineKey({ v: 8 }));
});

test('restore preview flags same-id events whose content differs (local copy is kept on merge)', () => {
  const [a, b] = log();
  const edited = { ...b!, itemId: 'v:결재' } as typeof b;
  const p = restorePreview([a!, b!], [{ ...a! }, edited!], 0);
  assert.equal(p.alreadyPresent, 2);
  assert.equal(p.fresh, 0);
  assert.equal(p.conflicts, 1);
  assert.equal(restorePreview([a!, b!], [a!, b!], 0).conflicts, 0);
});

test('QA: an empty file and a truncated .gz get plain-language errors', async () => {
  assert.match(friendlyBackupError(parseBackup('').ok ? '' : 'empty file'), /empty/);
  const backup = serializeBackup(makeBackup(log(), { createdAt: 'x', appVersion: 't', contentVersion: 'c', deviceId: 'd' }));
  const gz = new Uint8Array(await (await encodeBackup(backup, true)).arrayBuffer());
  await assert.rejects(decodeBackupFile(gz.slice(0, Math.floor(gz.length / 2)).buffer), /incomplete or damaged/);
});

test('QA: a conflicting duplicate never shares a quarantine key with the id it duplicates', () => {
  const [a] = log();
  const other = { ...a!, itemId: 'v:다른' };
  assert.equal(quarantineKey(a), `id:${a!.id}`);
  const k1 = quarantineKey(a, DUPLICATE_ID_REASON);
  const k2 = quarantineKey(other, DUPLICATE_ID_REASON);
  assert.match(k1, /^dup:/);
  assert.notEqual(k1, k2);
  assert.equal(k1, quarantineKey({ ...a! }, DUPLICATE_ID_REASON));
});
