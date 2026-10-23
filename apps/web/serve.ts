// Tiny static server for dist/ (e2e tests and `dev`). Honors BASE: requests must live under
// it, mirroring GitHub Pages. Usage: tsx apps/web/serve.ts [--port 4173] [--dir dist]
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeBase, WEB_DIR } from './build.ts';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.map': 'application/json', '.woff2': 'font/woff2',
};

export function serve(opts: { dir?: string; base?: string; port?: number; host?: string } = {}): Promise<Server> {
  const dir = resolve(opts.dir ?? join(WEB_DIR, 'dist'));
  const base = normalizeBase(opts.base ?? process.env.BASE);
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (path === '/' && base !== '/') { res.writeHead(302, { location: base }); res.end(); return; }
    if (!path.startsWith(base)) { res.writeHead(404); res.end('not under BASE'); return; }
    let rel = path.slice(base.length) || 'index.html';
    let file = normalize(join(dir, rel));
    if (!file.startsWith(dir)) { res.writeHead(403); res.end(); return; }
    if (existsSync(file) && statSync(file).isDirectory()) { rel = join(rel, 'index.html'); file = join(dir, rel); }
    if (!existsSync(file)) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return; }
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
      'service-worker-allowed': base,
    });
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(opts.port ?? 4173, opts.host ?? '127.0.0.1', () => ok(server)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const get = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const port = Number(get('--port') ?? process.env.PORT ?? 4173);
  void serve({ dir: get('--dir'), port }).then(() => {
    console.log(`serving ${get('--dir') ?? 'apps/web/dist'} at http://127.0.0.1:${port}${normalizeBase(process.env.BASE)}`);
  });
}
