import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBundle, validateBundle, type ContentBundle } from '@ksrs/content';
import { canonicalJson, createEventFactory, createHlc, sha256Hex, type EventPayload, type AppEvent } from '@ksrs/srs-engine';

// The fixture seed (original 10 M1 items) keeps these tests independent of seed edits.
const SEED = fileURLToPath(new URL('../tests/e2e/fixture-seed', import.meta.url));

export function seedBundle(): ContentBundle {
  const raws: unknown[] = [];
  const walk = (d: string): string[] => readdirSync(d).sort().flatMap((f) => {
    const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.json') && !p.endsWith('idRedirects.json') ? [p] : [];
  });
  for (const f of walk(SEED)) raws.push(...(JSON.parse(readFileSync(f, 'utf8')) as unknown[]));
  const r = validateBundle(raws);
  if (!r.ok) throw new Error('seed invalid');
  return buildBundle(r.items, {}, { canonicalJson, sha256Hex });
}

/** Deterministic event factory with a settable clock. */
export function fakeFactory(start = Date.UTC(2026, 9, 23, 3, 0)) {
  let t = start;
  let r = 0;
  const clock = () => t;
  const mk = createEventFactory({ deviceId: 'test', hlc: createHlc('test', clock), clock, rng: () => ((r = (r * 9301 + 49297) % 233280) / 233280) });
  return {
    get now() { return t; },
    advance(ms: number) { t += ms; },
    mk: (p: EventPayload, at?: number): AppEvent => mk(p, at),
  };
}
