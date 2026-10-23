// Validates seed/**/*.json and prints a report. Exit 1 on any error (§9).
// Usage: npx tsx packages/content/bin/validate-content.ts [--no-self-check]
import type { ItemKind } from '../src/schema/types.ts';
import { validateBundle } from '../src/validate.ts';
import { loadChecker, loadSeed, runSelfCheck } from './lib.ts';

const KINDS: ItemKind[] = ['hanja', 'vocab', 'grammar', 'expression'];
const pad = (s: string | number, n: number) => String(s).padStart(n);

const seed = loadSeed();
const report = validateBundle(seed.raws, { origins: seed.origins, idRedirects: seed.idRedirects });
let failed = seed.loadErrors.length > 0 || !report.ok;

console.log('Content validation');
console.log('==================');
console.log(`items: ${report.counts.total}   (${KINDS.map((k) => `${k} ${report.counts.byKind[k]}`).join(', ')})\n`);
console.log(`level  ${KINDS.map((k) => pad(k, 12)).join('')}`);
for (const lvl of Object.keys(report.counts.byLevel).map(Number).sort((a, b) => a - b)) {
  const row = report.counts.byLevel[lvl]!;
  console.log(`L${String(lvl).padStart(2, '0')}    ${KINDS.map((k) => pad(row[k], 12)).join('')}`);
}

console.log(`\nneeds_review: ${report.counts.needsReviewItems} item(s), ${report.counts.needsReviewExamples} example(s)`);
for (const n of report.needsReview) {
  const parts = [n.item ? 'item' : '', n.examples.length ? `examples[${n.examples.join(',')}]` : ''].filter(Boolean);
  console.log(`  - ${n.id} (L${n.level} ${n.kind}): ${parts.join(' + ')}`);
}

const otherWarnings = report.warnings.filter((w) => w.path !== 'needs_review');
if (otherWarnings.length) {
  console.log(`\nwarnings (${otherWarnings.length}):`);
  for (const w of otherWarnings) console.log(`  ! ${w.path}: ${w.msg}`);
}

if (seed.loadErrors.length || report.errors.length) {
  console.log(`\nERRORS (${seed.loadErrors.length + report.errors.length}):`);
  for (const e of seed.loadErrors) console.log(`  ✗ ${e}`);
  for (const e of report.errors) console.log(`  ✗ ${e.path}: ${e.msg}`);
}

// Self-check through answer-check (only meaningful when the bundle is structurally sound).
if (process.argv.includes('--no-self-check')) {
  console.log('\nself-check skipped: --no-self-check');
} else {
  const check = await loadChecker();
  if (!check) {
    console.log('\nself-check skipped: answer-check not ready');
  } else {
    const sc = runSelfCheck(report.items, check);
    console.log(`\nself-check: ${sc.cases} case(s), ${sc.failures.length} failure(s), ${sc.crashes.length} checker crash(es)`);
    for (const f of sc.failures) console.log(`  ✗ ${f}`);
    for (const c of sc.crashes) console.log(`  ! ${c}`);
    if (sc.failures.length) failed = true;
  }
}

console.log(failed ? '\nFAIL' : '\nOK');
process.exit(failed ? 1 : 0);
