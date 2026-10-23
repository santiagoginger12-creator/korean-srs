// Builds the two e2e targets outside dist/ (so the real deploy build is never clobbered):
//   node_modules/.e2e/fixture  ← tests/e2e/fixture-seed (the original 10 M1 items; stable)
//   node_modules/.e2e/real     ← packages/content/seed (the live seed; smoke test + screenshots)
// Respects BASE like the normal build.
import { join } from 'node:path';
import { build, WEB_DIR } from '../../build.ts';

export const E2E_OUT = join(WEB_DIR, 'node_modules/.e2e');

process.env.KSRS_SEED_DIR = join(WEB_DIR, 'tests/e2e/fixture-seed');
await build({ outDir: join(E2E_OUT, 'fixture') });
delete process.env.KSRS_SEED_DIR;
await build({ outDir: join(E2E_OUT, 'real') });
