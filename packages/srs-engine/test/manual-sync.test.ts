// M5 acceptance at the engine level: manual file sync (§11 option d) between two devices.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Item } from '@ksrs/content';
import { forAll, type Gen } from '@ksrs/test-support';
import {
  makeBackup, mergeBackup, mergeEventSets, parseBackup, replayAll, serializeBackup, settingPayload,
  type AppEvent, type EventPayload,
} from '../src/index.ts';
import { canonicalJson, DAY, HOUR, MINUTE } from '../src/util.ts';
import { answerP, canon as canonRaw, device, FIXTURE, lessonP, T0, vocab, type Emit } from './fixtures.ts';

const CUSTOM = vocab('커스텀', 1, { source: { kind: 'user', license: 'original-owned' } });
const ITEMS: Item[] = [...FIXTURE.items, CUSTOM];
const REVIEWABLE = ITEMS.filter((it): it is Exclude<Item, { kind: 'hanja' }> => it.kind !== 'hanja');
const STEPS = [0, MINUTE, 10 * MINUTE, HOUR, 4 * HOUR, 8 * HOUR, DAY, 3 * DAY];
/**
 * Canonical projection. Backup files are canonical JSON, so a custom item read back from a file has
 * sorted keys while the exporting device's copy keeps insertion order; compare canonically.
 */
const canon = (s: Parameters<typeof canonRaw>[0]) => canonicalJson(JSON.parse(canonRaw(s)));
const meta = (deviceId: string) => ({ createdAt: '2026-10-26T00:00:00Z', appVersion: '0.5.0', contentVersion: FIXTURE.contentVersion, deviceId });

/** `n` events from one device starting at `t`: lessons, answers (incl. variants), voids, overrides, resets, notes, settings, custom items. */
function genEvents(r: () => number, emit: Emit, n: number, t0: number, prior: readonly AppEvent[]): AppEvent[] {
  const pickOf = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const out: AppEvent[] = [];
  let t = t0;
  for (let i = 0; i < n; i++) {
    t += pickOf(STEPS);
    const all = [...prior, ...out];
    const roll = r();
    let p: EventPayload | undefined;
    if (roll < 0.2 || all.length === 0) p = lessonP(pickOf(ITEMS).id);
    else if (roll < 0.55) {
      const it = pickOf(REVIEWABLE);
      const variant = r() < 0.2;
      p = answerP(it.id, pickOf(it.questionTypes), r() < 0.7 || variant ? 'correct' : 'incorrect', it.questionTypes.slice(),
        { response: `r${Math.floor(r() * 3)}`, check: { layer: variant ? 'variant' : 'x', closeAttempts: Math.floor(r() * 2) } } as never);
    } else if (roll < 0.62) {
      // The app never voids a void (validation would quarantine it on import).
      const targets = all.filter((e) => e.type !== 'event.void');
      if (targets.length) p = { type: 'event.void', targetId: pickOf(targets).id, reason: 'undo' };
    }
    else if (roll < 0.67) {
      const wrongs = all.filter((e): e is AppEvent & { type: 'review.answer' } => e.type === 'review.answer' && e.grade === 'incorrect');
      if (wrongs.length) {
        const w = pickOf(wrongs);
        p = answerP(w.itemId, w.qtype, 'correct', w.requiredQTypes, { selfGraded: true, overrides: w.id } as never);
      }
    } else if (roll < 0.7) p = { type: 'item.reset', itemId: pickOf(REVIEWABLE).id, toStage: 1 };
    else if (roll < 0.75) p = { type: 'settings.set', key: 'srs.intervals', value: r() < 0.5 ? Array(8).fill(HOUR) : [4, 8, 24, 48, 168, 336, 720, 2880].map((h) => h * HOUR) };
    else if (roll < 0.8) p = settingPayload(pickOf(['tts.rate', 'tts.autoplay', 'inbox.dismissed'] as const) as 'tts.rate', pickOf([0.8, 1.2, true, ['x'], 9]) as number);
    else if (roll < 0.88) p = { type: 'note.set', itemId: pickOf(ITEMS).id, field: pickOf(['meaning', 'mnemonic'] as const), text: r() < 0.2 ? '' : `n${i}` };
    else if (roll < 0.93) p = { type: r() < 0.6 ? 'userAnswer.add' : 'userAnswer.remove', itemId: pickOf(REVIEWABLE).id, qtype: 'meaning', answer: pickOf(['x', 'y']) };
    else if (roll < 0.97) p = { type: 'customItem.upsert', item: { ...CUSTOM, meanings: [`m${i}`] } };
    else p = { type: 'customItem.delete', itemId: CUSTOM.id };
    if (p) out.push(emit(p, t));
  }
  return out;
}

interface Scenario { shared: AppEvent[]; a: AppEvent[]; b: AppEvent[] }

/** A shared history (synced earlier), then both devices go offline and diverge over the same period. */
const genScenario: Gen<Scenario> = (r, size) => {
  const salt = Math.floor(r() * 1e9);
  const devA = device('a', `a${salt}`);
  const devB = device('b', `b${salt}`);
  const shared = genEvents(r, devA, 2 + size, T0, []);
  const tFork = shared.length ? shared[shared.length - 1]!.at : T0;
  const a = genEvents(r, devA, 1 + size * 2, tFork, shared);
  const b = genEvents(r, devB, 1 + size * 2, tFork, shared);
  return { shared, a, b };
};

/** Export on one device, import (merge) on the other, via the real file format. */
function exchange(local: AppEvent[], remoteLog: AppEvent[], remoteId: string): AppEvent[] {
  const file = serializeBackup(makeBackup(remoteLog, meta(remoteId)));
  const parsed = parseBackup(file);
  assert.ok(parsed.ok);
  if (!parsed.ok) return local;
  assert.equal(parsed.quarantine.length, 0);
  return mergeEventSets(local, parsed.events);
}

describe('manual file sync (M5)', () => {
  test('mergeEventSets is the backup merge (union by id)', () => {
    const a = device('a');
    const x = [a(lessonP('v:덤'), T0), a(lessonP('v:베개'), T0 + 1)];
    const y = [x[1]!, a(lessonP('v:결정'), T0 + 2)];
    assert.deepEqual(mergeEventSets(x, y), mergeBackup(x, y));
    assert.equal(mergeEventSets(x, y).length, 3);
  });

  test('property: two devices exchange backups both ways → byte-identical logs and projections', () => {
    forAll(genScenario, ({ shared, a, b }) => {
      const logA = [...shared, ...a];
      const logB = [...shared, ...b];
      // Phone exports → laptop imports, and laptop exports → phone imports (either order).
      const mergedOnB = exchange(logB, logA, 'a');
      const mergedOnA = exchange(logA, logB, 'b');
      const pA = canon(replayAll(FIXTURE, mergedOnA));
      const pB = canon(replayAll(FIXTURE, mergedOnB));
      assert.equal(pA, pB);
      assert.equal(serializeBackup(makeBackup(mergedOnA, meta('x'))), serializeBackup(makeBackup(mergedOnB, meta('x'))));
      // Re-exchanging after convergence changes nothing (idempotent), in either direction.
      assert.equal(canon(replayAll(FIXTURE, exchange(mergedOnA, mergedOnB, 'b'))), pA);
      assert.equal(canon(replayAll(FIXTURE, exchange(mergedOnB, logA, 'a'))), pB);
      // Same as replaying everything at once.
      assert.equal(canon(replayAll(FIXTURE, [...b, ...a, ...shared])), pA);
    }, { runs: 120, seed: 'manual-sync', maxSize: 25 });
  });

  test('property: replace restore reproduces the exporting device exactly', () => {
    forAll(genScenario, ({ shared, a, b }) => {
      const logA = [...shared, ...a];
      const parsed = parseBackup(serializeBackup(makeBackup(logA, meta('a'))));
      assert.ok(parsed.ok);
      if (!parsed.ok) return;
      // Replace = wipe local (logB) and keep only the file's events.
      assert.equal(canon(replayAll(FIXTURE, parsed.events)), canon(replayAll(FIXTURE, logA)));
      // Merge keeps B's own offline work; replace drops it.
      const merged = mergeEventSets([...shared, ...b], parsed.events);
      assert.equal(merged.length, new Set([...logA, ...b].map((e) => e.id)).size);
      assert.ok(b.every((e) => merged.some((m) => m.id === e.id)));
      assert.ok(b.every((e) => !parsed.events.some((m) => m.id === e.id)));
    }, { runs: 60, seed: 'replace-restore', maxSize: 20 });
  });
});

describe('quarantined events ride along in backups (QA)', () => {
  test('makeBackup appends quarantined raws; parseBackup re-quarantines them; nothing is lost', () => {
    const a = device('a');
    const log = [a(lessonP('v:덤'), T0), a(lessonP('v:베개'), T0 + 1)];
    const future = { ...log[0]!, id: 'future-1', v: 2, type: 'review.rated' };
    const junk = { hello: 'world' };
    const dupOfLog = { ...log[1]! };
    const b1 = makeBackup(log, meta('a'), [future, junk, dupOfLog, future]);
    const b2 = makeBackup([...log].reverse(), meta('a'), [junk, future]);
    assert.equal(serializeBackup(b1), serializeBackup(b2), 'deterministic, deduped');
    assert.equal(b1.eventCount, 4);
    const r = parseBackup(serializeBackup(b1));
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.deepEqual(r.events.map((e) => e.id), log.map((e) => e.id));
    assert.deepEqual(r.quarantine.map((q) => q.raw), [junk, future]); // canonical order
    // Restoring that backup elsewhere and backing up again keeps them (round trip).
    const again = makeBackup(r.events, meta('b'), r.quarantine.map((q) => q.raw));
    assert.deepEqual(again.events, b1.events);
  });
});
