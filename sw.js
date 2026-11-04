/* ksrs service worker (hand-written, D29; stands in for Workbox generateSW).
 * build.ts substitutes the precache list and a version derived from every precached file's
 * hash, so any change to the shell or content gives a new cache and an update prompt.
 *
 * - install: precache the shell (does NOT skipWaiting: the page prompts, §13)
 * - activate: drop old ksrs-shell-* caches, claim clients
 * - navigations → cached index.html (hash routing, so one document serves every route)
 * - precached same-origin GETs → cache-first
 * - Pretendard (cdn.jsdelivr.net) → stale-while-revalidate runtime cache; offline without it
 *   the font stack falls back to system Korean fonts
 */
const VERSION = '391bebcff6bb936d';
const BASE = '/korean-srs/';
const PRECACHE = ["/korean-srs/assets/main-EIFZ57WH.css","/korean-srs/assets/main-L3NSEXXE.js","/korean-srs/content.bundle.json","/korean-srs/examples.json","/korean-srs/icons/apple-touch-icon.png","/korean-srs/icons/icon-192.png","/korean-srs/icons/icon-512.png","/korean-srs/icons/icon-maskable-512.png","/korean-srs/icons/icon.svg","/korean-srs/index.html","/korean-srs/manifest.webmanifest"];
const SHELL = `ksrs-shell-${VERSION}`;
const FONTS = 'ksrs-fonts-v1';
const INDEX = `${BASE}index.html`;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('ksrs-shell-') && key !== SHELL) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/** Stale-while-revalidate for the Pretendard CSS and its woff2 subsets (D37). A cached copy is
 * served immediately; the network refresh runs in the background (kept alive by waitUntil) and
 * only replaces the cache on a usable response. Offline with nothing cached → network error, and
 * the CSS font stack falls back to system Korean fonts. */
async function fontSwr(event, req) {
  const cache = await caches.open(FONTS);
  const hit = await cache.match(req, { ignoreVary: true });
  const refresh = fetch(req).then(async (res) => {
    if (res && (res.ok || res.type === 'opaque')) {
      try { await cache.put(req, res.clone()); } catch (e) { /* quota: keep serving the old copy */ }
    }
    return res;
  }).catch(() => null);
  if (hit) { event.waitUntil(refresh); return hit; }
  return (await refresh) || Response.error();
}

const PRECACHED = new Set(PRECACHE.map((u) => new URL(u, self.location.origin).href));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (req.mode === 'navigate' && url.origin === self.location.origin && url.pathname.startsWith(BASE)) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL);
      return (await cache.match(INDEX)) || fetch(req);
    })());
    return;
  }

  if (url.origin === self.location.origin) {
    const key = url.origin + url.pathname;
    if (!PRECACHED.has(key)) return;
    event.respondWith((async () => {
      const cache = await caches.open(SHELL);
      return (await cache.match(key)) || fetch(req);
    })());
    return;
  }

  if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('/pretendard')) {
    event.respondWith(fontSwr(event, req));
  }
});
