// One-off icon generator (run manually; outputs are committed so builds don't need sharp).
//   node apps/web/scripts/make-icons.mjs   (needs sharp; offline: /opt/npm-tools/node_modules/sharp)
// Design: a single calm Hangul syllable 익 (as in 익히다, "to master by practice") in deep
// slate on warm paper, with a thin muted-teal underline.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let sharp;
try { sharp = require('sharp'); } catch { sharp = require('/opt/npm-tools/node_modules/sharp'); }
const out = join(dirname(fileURLToPath(import.meta.url)), '../public/icons');
mkdirSync(out, { recursive: true });

const svg = ({ maskable }) => {
  const r = maskable ? 0 : 112;
  const scale = maskable ? 0.78 : 1; // keep the glyph inside the maskable safe zone
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${r}" fill="#f7f6f2"/>
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <text x="256" y="318" text-anchor="middle" font-family="Noto Sans CJK KR, Noto Sans KR, Apple SD Gothic Neo, sans-serif"
          font-weight="600" font-size="270" fill="#3d4a5c">익</text>
    <rect x="186" y="378" width="140" height="10" rx="5" fill="#4f9478"/>
  </g>
</svg>`;
};

writeFileSync(join(out, 'icon.svg'), svg({ maskable: false }));
const jobs = [
  ['icon-192.png', 192, false], ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true], ['apple-touch-icon.png', 180, true],
];
for (const [name, size, maskable] of jobs) {
  await sharp(Buffer.from(svg({ maskable }))).resize(size, size).png().toFile(join(out, name));
  console.log('wrote', name);
}
