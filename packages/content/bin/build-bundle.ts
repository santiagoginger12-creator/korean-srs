// Builds packages/content/dist/content.bundle.json from seed/ (§9.3). Refuses to build on validation errors.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson, sha256Hex } from '../../srs-engine/src/util.ts';
import { buildBundle } from '../src/bundle.ts';
import { validateBundle } from '../src/validate.ts';
import { PKG_DIR, loadSeed } from './lib.ts';

const seed = loadSeed();
const report = validateBundle(seed.raws, { origins: seed.origins, idRedirects: seed.idRedirects });
if (seed.loadErrors.length || !report.ok) {
  for (const e of seed.loadErrors) console.error(`✗ ${e}`);
  for (const e of report.errors) console.error(`✗ ${e.path}: ${e.msg}`);
  console.error('build-bundle: validation failed; run validate-content for the full report');
  process.exit(1);
}
const bundle = buildBundle(report.items, seed.idRedirects, { canonicalJson, sha256Hex });
const outDir = join(PKG_DIR, 'dist');
mkdirSync(outDir, { recursive: true });
const out = join(outDir, 'content.bundle.json');
writeFileSync(out, JSON.stringify(bundle, null, 2) + '\n');
console.log(`wrote ${out}\n  items: ${bundle.items.length}\n  contentVersion: ${bundle.contentVersion}`);
