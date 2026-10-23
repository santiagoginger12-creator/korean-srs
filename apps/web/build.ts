// Production build (D29: esbuild instead of Vite). Run: `npm run build:web` (root) or
// `tsx apps/web/build.ts`. Env: BASE (default "/"; GitHub Pages uses "/<repo>/").
// Flags: --dev (no minify, sourcemaps, no service worker registration), --out <dir>.
//
// Emits dist/: index.html, assets/main-[hash].{js,css}, content.bundle.json (from
// packages/content/seed, validated), manifest.webmanifest, icons/, sw.js (precache list +
// content-derived version).

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { buildBundle, validateBundle, type ContentBundle } from '../../packages/content/src/index.ts';
import { canonicalJson, sha256Hex } from '../../packages/srs-engine/src/index.ts';

export const WEB_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(WEB_DIR, '../..');
const SEED_DIR = join(ROOT, 'packages/content/seed');
export const PRETENDARD_CSS = 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css';

export interface BuildOptions { base?: string; dev?: boolean; outDir?: string; quiet?: boolean }

export function normalizeBase(b: string | undefined): string {
  let base = (b ?? '/').trim() || '/';
  if (!base.startsWith('/')) base = `/${base}`;
  if (!base.endsWith('/')) base = `${base}/`;
  return base;
}

/** Loads seed/**\/*.json in sorted path order (mirrors packages/content/bin/lib.ts). */
export function loadSeed(dir = SEED_DIR): { raws: unknown[]; origins: string[]; idRedirects: Record<string, string> } {
  const out = { raws: [] as unknown[], origins: [] as string[], idRedirects: {} as Record<string, string> };
  const walk = (d: string): string[] => readdirSync(d).sort().flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.json') ? [p] : [];
  });
  for (const file of walk(dir)) {
    const data: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const rel = relative(dir, file);
    if (file.endsWith('idRedirects.json')) { Object.assign(out.idRedirects, data); continue; }
    if (!Array.isArray(data)) throw new Error(`${rel}: must be a JSON array of items`);
    data.forEach((raw, i) => { out.raws.push(raw); out.origins.push(`${rel}#${i}`); });
  }
  return out;
}

export function buildContent(): ContentBundle {
  const seed = loadSeed();
  const report = validateBundle(seed.raws, { origins: seed.origins, idRedirects: seed.idRedirects });
  if (!report.ok) {
    for (const e of report.errors) console.error(`✗ ${e.path}: ${e.msg}`);
    throw new Error('content validation failed (run `npm run validate-content`)');
  }
  return buildBundle(report.items, seed.idRedirects, { canonicalJson, sha256Hex });
}

const ksrsAlias: esbuild.Plugin = {
  name: 'ksrs-alias',
  setup(b) {
    b.onResolve({ filter: /^@ksrs\/[a-z-]+$/ }, (a) => ({ path: join(ROOT, 'packages', a.path.slice('@ksrs/'.length), 'src/index.ts') }));
  },
};

const hash = (buf: Buffer | string) => createHash('sha256').update(buf).digest('hex');

function walkFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walkFiles(p) : [p];
  });
}

export async function build(opts: BuildOptions = {}): Promise<{ outDir: string; base: string; files: string[] }> {
  const base = normalizeBase(opts.base ?? process.env.BASE);
  const dev = !!opts.dev;
  const outDir = resolve(opts.outDir ?? join(WEB_DIR, 'dist'));
  const t0 = Date.now();
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const res = await esbuild.build({
    entryPoints: { main: join(WEB_DIR, 'src/main.tsx') },
    bundle: true,
    outdir: join(outDir, 'assets'),
    entryNames: '[name]-[hash]',
    assetNames: '[name]-[hash]',
    format: 'esm',
    target: ['es2022', 'safari16'],
    minify: !dev,
    sourcemap: dev ? 'linked' : false,
    metafile: true,
    jsx: 'automatic',
    legalComments: 'none',
    plugins: [ksrsAlias],
    nodePaths: [join(WEB_DIR, 'node_modules')],
    define: {
      'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production'),
      __BASE__: JSON.stringify(base),
      __DEV__: JSON.stringify(dev),
    },
    logLevel: opts.quiet ? 'silent' : 'warning',
  });
  const outputs = Object.keys(res.metafile.outputs).map((p) => resolve(p));
  const js = outputs.find((p) => p.endsWith('.js'));
  const css = outputs.find((p) => p.endsWith('.css'));
  if (!js) throw new Error('esbuild produced no JS');
  const url = (abs: string) => base + relative(outDir, abs).split('\\').join('/');

  // Content bundle.
  const content = buildContent();
  writeFileSync(join(outDir, 'content.bundle.json'), JSON.stringify(content));

  // Static assets.
  cpSync(join(WEB_DIR, 'public'), outDir, { recursive: true });

  const manifest = {
    name: 'ksrs · 한국어 SRS', short_name: '익히다', description: 'Spaced repetition for advanced Korean',
    lang: 'ko', dir: 'ltr', start_url: './', scope: './', display: 'standalone',
    background_color: '#f7f6f2', theme_color: '#f7f6f2',
    icons: [
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  writeFileSync(join(outDir, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));

  const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>ksrs · 한국어</title>
<meta name="description" content="Spaced repetition for advanced Korean">
<meta name="theme-color" content="#f7f6f2">
<meta name="color-scheme" content="light dark">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="익히다">
<link rel="manifest" href="${base}manifest.webmanifest">
<link rel="icon" href="${base}icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${base}icons/apple-touch-icon.png">
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="stylesheet" href="${PRETENDARD_CSS}" crossorigin>
${css ? `<link rel="stylesheet" href="${url(css)}">` : ''}
<script type="module" src="${url(js)}"></script>
</head>
<body>
<div id="root"></div>
<noscript>This app needs JavaScript.</noscript>
</body>
</html>
`;
  writeFileSync(join(outDir, 'index.html'), html);

  // Service worker: precache every emitted file except maps; version = hash of their contents.
  const files = walkFiles(outDir).filter((f) => !f.endsWith('.map')).sort();
  const version = hash(files.map((f) => `${relative(outDir, f)}:${hash(readFileSync(f))}`).join('\n')).slice(0, 16);
  const precache = files.map(url);
  const sw = readFileSync(join(WEB_DIR, 'src/pwa/sw.template.js'), 'utf8')
    .replace('__VERSION__', version)
    .replace('__BASE__', base)
    .replace('__PRECACHE__', JSON.stringify(precache));
  writeFileSync(join(outDir, 'sw.js'), sw);

  if (!opts.quiet) {
    const kb = (f: string) => (statSync(f).size / 1024).toFixed(1);
    console.log(`built ${relative(ROOT, outDir)} (base ${base}${dev ? ', dev' : ''}) in ${Date.now() - t0} ms`);
    console.log(`  ${relative(outDir, js)} ${kb(js)} KB${css ? `, ${relative(outDir, css)} ${kb(css)} KB` : ''}`);
    console.log(`  content ${content.items.length} items (${content.contentVersion.slice(0, 12)}), sw ${version}, ${precache.length} precached`);
  }
  return { outDir, base, files: precache };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const oi = args.indexOf('--out');
  build({ dev: args.includes('--dev'), outDir: oi >= 0 ? args[oi + 1] : undefined }).catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
