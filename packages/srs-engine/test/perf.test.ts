import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { DEFAULT_INTERVALS, replayAll, wkNextStage, type AppEvent } from '../src/index.ts';
import { floorHour, mulberry32 } from '../src/util.ts';
import { answerP, bulkBundle, device, lessonP, T0 } from './fixtures.ts';

/** ~50k realistic events: 2,500 items learned over time, reviewed at their due times with ~15% misses, two devices. */
function generate(target: number): { content: ReturnType<typeof bulkBundle>; events: AppEvent[] } {
  const N = 2500;
  const content = bulkBundle(N);
  const r = mulberry32(42);
  const devs = [device('phone'), device('laptop')];
  const events: AppEvent[] = [];
  const req = ['meaning', 'production'] as const;
  for (let i = 0; i < N && events.length < target; i++) {
    const id = `v:w${String(i).padStart(4, '0')}`;
    const emit = devs[i % 2]!;
    let t = T0 + Math.floor(i / 10) * 86_400_000;
    events.push(emit(lessonP(id), t));
    let stage = 1;
    let avail = floorHour(t + DEFAULT_INTERVALS[0]!);
    for (let k = 0; k < 10 && stage < 9 && events.length < target; k++) {
      t = avail + Math.floor(r() * 3_600_000);
      let wrong = 0;
      for (const q of req) {
        if (r() < 0.15) { events.push(emit(answerP(id, q, 'incorrect', [...req]), t++)); wrong++; }
        events.push(emit(answerP(id, q, 'correct', [...req]), t++));
      }
      stage = wkNextStage(stage, wrong);
      if (stage < 9) avail = floorHour(t + DEFAULT_INTERVALS[stage - 1]!);
    }
  }
  return { content, events };
}

test('perf: replayAll over 50k events', () => {
  const { content, events } = generate(50_000);
  assert.ok(events.length >= 50_000, `generated ${events.length}`);
  const shuffled = events.slice().reverse();
  replayAll(content, shuffled.slice(0, 1000)); // warm up the JIT
  const runs: number[] = [];
  let s;
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    s = replayAll(content, shuffled);
    runs.push(performance.now() - t0);
  }
  const best = Math.min(...runs);
  console.log(`replayAll(${events.length} events, ${s!.items.size} items): best ${best.toFixed(1)} ms, runs ${runs.map((x) => x.toFixed(0)).join('/')} ms`);
  assert.ok(s!.items.size > 2000);
  assert.ok(best < 1500, `replayAll took ${best.toFixed(1)} ms`);
  if (best >= 500) console.log('WARNING: above the 500 ms target (slow machine?)');
});
