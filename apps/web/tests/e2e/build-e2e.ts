// Builds the e2e targets outside dist/ (so the real deploy build is never clobbered):
//   node_modules/.e2e/fixture   ← tests/e2e/fixture-seed + fixture-examples.json + fixture-drill-deck.json (frozen fixture; behaviour tests)
//   node_modules/.e2e/real      ← packages/content/seed (live seed; smoke test + screenshots)
//   node_modules/.e2e/artifact  ← fixture seed, KSRS_TARGET=artifact (hosted-page download path)
//   node_modules/.e2e/update-a, update-b ← fixture seed with two build ids, for the SW update
//     prompt test; the test copies one of them into node_modules/.e2e/update, which is served.
// Respects BASE like the normal build.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { build, WEB_DIR } from '../../build.ts';

export const E2E_OUT = join(WEB_DIR, 'node_modules/.e2e');
const FIXTURE = join(WEB_DIR, 'tests/e2e/fixture-seed');

process.env.KSRS_SEED_DIR = FIXTURE;
// Fixture builds ship the hand-made dictionary examples; the real build uses the real file (if any).
process.env.KSRS_EXAMPLES_FILE = join(WEB_DIR, 'tests/e2e/fixture-examples.json');
// …and a 30-word drill deck (five words per tier) instead of the 10,878-word one.
process.env.KSRS_DRILL_DECK = join(WEB_DIR, 'tests/e2e/fixture-drill-deck.json');
await build({ outDir: join(E2E_OUT, 'fixture') });
// The hosted claude.ai page target (D59) on the fixture seed: files go through `downloads`.
await build({ outDir: join(E2E_OUT, 'artifact'), target: 'artifact', quiet: true });
for (const v of ['a', 'b']) {
  process.env.KSRS_BUILD_ID = `e2e-${v}`;
  await build({ outDir: join(E2E_OUT, `update-${v}`), quiet: true });
}
delete process.env.KSRS_BUILD_ID;
delete process.env.KSRS_SEED_DIR;
delete process.env.KSRS_EXAMPLES_FILE;
delete process.env.KSRS_DRILL_DECK;
await build({ outDir: join(E2E_OUT, 'real') });
rmSync(join(E2E_OUT, 'update'), { recursive: true, force: true });
mkdirSync(join(E2E_OUT, 'update'), { recursive: true });
cpSync(join(E2E_OUT, 'update-a'), join(E2E_OUT, 'update'), { recursive: true });
console.log('e2e update targets: e2e-a, e2e-b');
