// Dev mode: unminified build with sourcemaps (no service worker), rebuilt on change, served
// at http://127.0.0.1:5173/. Watches apps/web/src, packages/*/src and the content seed.
// Usage: npm run dev:web (root) or tsx apps/web/dev.ts
import { watch } from 'node:fs';
import { join, resolve } from 'node:path';
import { build, WEB_DIR } from './build.ts';
import { serve } from './serve.ts';

const ROOT = resolve(WEB_DIR, '../..');
const outDir = join(WEB_DIR, 'dist', 'dev'); // under the gitignored dist/
const port = Number(process.env.PORT ?? 5173);

await build({ dev: true, outDir, base: '/' });
await serve({ dir: outDir, base: '/', port });
console.log(`dev server: http://127.0.0.1:${port}/  (rebuilds on save; reload the page)`);

let timer: ReturnType<typeof setTimeout> | undefined;
let building = false;
const rebuild = () => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    if (building) return rebuild();
    building = true;
    try { await build({ dev: true, outDir, base: '/', quiet: true }); console.log(`rebuilt ${new Date().toLocaleTimeString()}`); }
    catch (e) { console.error('build failed:', e instanceof Error ? e.message : e); }
    finally { building = false; }
  }, 120);
};
for (const d of ['apps/web/src', 'apps/web/public', 'packages/content/src', 'packages/content/seed', 'packages/srs-engine/src', 'packages/answer-check/src']) {
  watch(join(ROOT, d), { recursive: true }, rebuild);
}
