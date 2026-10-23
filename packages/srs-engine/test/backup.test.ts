import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBackup, mergeBackup, parseBackup, replayAll, serializeBackup, type AppEvent } from '../src/index.ts';
import { HOUR } from '../src/util.ts';
import { answerP, canon, device, FIXTURE, lessonP, passAll, T0 } from './fixtures.ts';

const META = { createdAt: '2026-10-16T12:00:00Z', appVersion: '0.1.0', contentVersion: 'sha256:test', deviceId: 'd' };

function sampleLog(): AppEvent[] {
  const a = device('a');
  const b = device('b');
  const wrong = a(answerP('v:망설이다', 'meaning', 'incorrect', ['meaning', 'production']), T0 + 4 * HOUR);
  return [
    a(lessonP('v:망설이다'), T0), b(lessonP('h:決'), T0 + 1), wrong,
    a({ type: 'event.void', targetId: wrong.id, reason: 'undo' }, T0 + 4 * HOUR + 1),
    ...passAll(a, 'v:망설이다', ['meaning', 'production'], T0 + 4 * HOUR + 2),
    b({ type: 'note.set', itemId: 'v:망설이다', field: 'mnemonic', text: '망설 — 한국어 ✓ 🙂' }, T0 + 5 * HOUR),
  ];
}

describe('backup (§12)', () => {
  test('round trip: sorted, checksummed, byte-identical, same projection', () => {
    const log = sampleLog();
    const bk = makeBackup([...log].reverse(), META);
    assert.equal(bk.format, 'ksrs-backup');
    assert.equal(bk.formatVersion, 1);
    assert.equal(bk.eventCount, log.length);
    assert.match(bk.checksum, /^sha256:[0-9a-f]{64}$/);
    const text = serializeBackup(bk);
    const parsed = parseBackup(text);
    assert.ok(parsed.ok);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.meta, META);
    assert.equal(parsed.quarantine.length, 0);
    assert.equal(canon(replayAll(FIXTURE, parsed.events)), canon(replayAll(FIXTURE, log)));
    assert.equal(serializeBackup(makeBackup(parsed.events, META)), text);
    // Also accepts plain JSON.stringify output.
    assert.ok(parseBackup(JSON.stringify(bk)).ok);
  });

  test('tampering is detected by the checksum', () => {
    const bk = makeBackup(sampleLog(), META);
    const t1 = JSON.parse(JSON.stringify(bk));
    t1.events[2].grade = 'correct';
    assert.deepEqual(parseBackup(t1), { ok: false, error: 'checksum mismatch' });
    const t2 = JSON.parse(JSON.stringify(bk));
    t2.events.pop();
    assert.equal((parseBackup(t2) as { error: string }).error, 'checksum mismatch');
    const t3 = JSON.parse(JSON.stringify(bk));
    t3.checksum = 'sha256:' + '0'.repeat(64);
    assert.equal(parseBackup(t3).ok, false);
  });

  test('rejects non-backups and unknown format versions', () => {
    assert.equal(parseBackup('{oops').ok, false);
    assert.equal(parseBackup({ format: 'other' }).ok, false);
    assert.equal(parseBackup({ ...makeBackup([], META), formatVersion: 2 }).ok, false);
  });

  test('future-version events are quarantined, not dropped or fatal', () => {
    const log = sampleLog();
    const future = { ...log[0]!, id: 'f-1', v: 2 } as unknown as AppEvent;
    const bk = makeBackup([...log, future], META);
    const r = parseBackup(serializeBackup(bk));
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.events.length, log.length);
      assert.equal(r.quarantine.length, 1);
      assert.equal(r.quarantine[0]!.reason, 'future version');
    }
  });

  test('merge is union by id', () => {
    const log = sampleLog();
    const a = log.slice(0, 4);
    const b = log.slice(2);
    const m = mergeBackup(a, b);
    assert.equal(m.length, log.length);
    assert.deepEqual(mergeBackup(b, a), m);
    assert.deepEqual(mergeBackup(m, m), m);
  });
});
