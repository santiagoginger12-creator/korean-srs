// Service-worker registration with an update prompt (§13: never auto-reload mid-session).
// The SW (pwa/sw.js, built by build.ts) waits in `installed` until we post SKIP_WAITING.

type L = () => void;
let ready = false;
let waiting: ServiceWorker | null = null;
const ls = new Set<L>();
export const updateReady = {
  get: (): boolean => ready,
  subscribe: (l: L) => { ls.add(l); return () => { ls.delete(l); }; },
};
const flag = (w: ServiceWorker) => { waiting = w; ready = true; for (const l of ls) l(); };

export function registerSW(swUrl: string, scope: string): void {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(swUrl, { scope }).then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) flag(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) flag(nw);
        });
      });
      // Check for a new deploy when the app comes back to the foreground.
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void reg.update().catch(() => {}); });
    }).catch((e: unknown) => console.warn('SW registration failed', e));
  });
}

export function applyUpdate(): void {
  if (!waiting) { location.reload(); return; }
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  waiting.postMessage({ type: 'SKIP_WAITING' });
}
