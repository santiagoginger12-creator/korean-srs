#!/usr/bin/env node
// Offline toolchain (DECISIONS.md D29). The npm registry is blocked in agent sessions, so
// instead of `npm install` in apps/web we symlink the preinstalled copies into
// apps/web/node_modules (gitignored). Idempotent: existing correct links are left alone,
// stale links are replaced. CI (which has npm access) runs `npm install --prefix apps/web`
// and never needs this script.
//
// Sources (override with env):
//   NPM_TOOLS   = /opt/npm-tools/node_modules              react, react-dom, scheduler, esbuild
//   NPM_GLOBAL  = /home/claude/.npm-global/lib/node_modules playwright (its `playwright/test`
//                 is the Playwright Test runner; a two-line @playwright/test shim re-exports it)
import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'apps/web/node_modules');
const TOOLS = process.env.NPM_TOOLS ?? '/opt/npm-tools/node_modules';
const GLOBAL = process.env.NPM_GLOBAL ?? '/home/claude/.npm-global/lib/node_modules';

const links = [
  ['react', join(TOOLS, 'react')],
  ['react-dom', join(TOOLS, 'react-dom')],
  ['scheduler', join(TOOLS, 'scheduler')],
  ['esbuild', join(TOOLS, 'esbuild')],
  ['@esbuild', join(TOOLS, '@esbuild')],
  ['playwright', join(GLOBAL, 'playwright')],
  ['playwright-core', join(TOOLS, 'playwright-core')],
];

mkdirSync(target, { recursive: true });
let made = 0, kept = 0, missing = 0;
for (const [name, src] of links) {
  const dest = join(target, name);
  if (!existsSync(src)) { console.warn(`  skip ${name}: ${src} not found`); missing++; continue; }
  mkdirSync(dirname(dest), { recursive: true });
  let st = null;
  try { st = lstatSync(dest); } catch { /* absent */ }
  if (st?.isSymbolicLink() && readlinkSync(dest) === src) { kept++; continue; }
  if (st) rmSync(dest, { recursive: true, force: true });
  symlinkSync(src, dest, 'dir');
  made++;
}

// @playwright/test is a thin re-export of playwright/test (that is all the real package is).
const pwt = join(target, '@playwright/test');
if (existsSync(join(target, 'playwright/test.js'))) {
  mkdirSync(pwt, { recursive: true });
  const files = {
    'package.json': JSON.stringify({
      name: '@playwright/test', version: 'offline-shim', main: 'index.js', types: 'index.d.ts',
      exports: { '.': { types: './index.d.ts', import: './index.mjs', require: './index.js', default: './index.js' }, './package.json': './package.json' },
    }, null, 2) + '\n',
    'index.js': "module.exports = require('playwright/test');\n",
    'index.mjs': "export * from 'playwright/test';\nexport { default } from 'playwright/test';\n",
    'index.d.ts': "export * from 'playwright/test';\nexport { default } from 'playwright/test';\n",
  };
  for (const [f, body] of Object.entries(files)) {
    const p = join(pwt, f);
    if (!existsSync(p) || readFileSync(p, 'utf8') !== body) writeFileSync(p, body);
  }
}
console.log(`link-offline-deps: ${made} linked, ${kept} already linked, ${missing} missing → ${target}`);
