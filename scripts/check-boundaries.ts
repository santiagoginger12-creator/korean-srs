// Enforces ARCHITECTURE.md §4 boundary rules without external tooling.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PURE = ['packages/srs-engine/src', 'packages/answer-check/src', 'packages/content/src/schema'];
const ALLOWED: Record<string, string[]> = {
  content: [],
  'answer-check': ['@ksrs/content'],
  'srs-engine': ['@ksrs/content'],
};
const BANNED_IN_PURE: [RegExp, string][] = [
  [/\bDate\.now\(/, 'Date.now() — inject a clock'],
  [/\bnew Date\(\s*\)/, 'new Date() — inject a clock'],
  [/\bMath\.random\(/, 'Math.random() — inject an RNG'],
  [/\b(window|document|indexedDB|localStorage)\./, 'DOM/browser global'],
  [/from ['"](react|dexie)['"]/, 'UI/storage import'],
];
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []; });

let errors = 0;
for (const pkg of Object.keys(ALLOWED)) {
  for (const file of walk(`packages/${pkg}/src`)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1]!;
      if (spec.startsWith('@ksrs/')) {
        if (!ALLOWED[pkg]!.includes(spec)) { console.error(`${file}: may not import ${spec}`); errors++; }
      } else if (spec.includes('/packages/') || /\.\.\/\.\.\/(?!src)/.test(spec) && spec.includes('..')) {
        if (/\.\.\/\.\.\/\.\./.test(spec)) { console.error(`${file}: cross-package relative import ${spec}`); errors++; }
      }
    }
    if (PURE.some((p) => file.startsWith(p))) {
      const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const [re, why] of BANNED_IN_PURE) if (re.test(code)) { console.error(`${file}: ${why}`); errors++; }
    }
  }
}
if (errors) { console.error(`\n${errors} boundary violation(s)`); process.exit(1); }
console.log('boundaries ok');
