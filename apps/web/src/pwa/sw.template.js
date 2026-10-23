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
const VERSION = '__VERSION__';
const BASE = '__BASE__';
const PRECACHE = __PRECACHE__;
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
    event.respondWith((async () => {
      const cache = await caches.open(FONTS);
      const hit = await cache.match(req);
      const net = fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') void cache.put(req, res.clone());
        return res;
      }).catch(() => hit || Response.error());
      return hit || net;
    })());
  }
});
