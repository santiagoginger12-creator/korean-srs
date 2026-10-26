// Hash routing (D14): #/, #/lessons, #/reviews, #/item/<id>, #/browse, #/settings.
import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'home' } | { name: 'lessons' } | { name: 'reviews' } | { name: 'settings' } | { name: 'browse' }
  | { name: 'item'; id: string } | { name: 'notFound'; path: string };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/^\/?/, '/');
  const seg = path.split('/').filter(Boolean);
  if (seg.length === 0) return { name: 'home' };
  if (seg[0] === 'lessons' && seg.length === 1) return { name: 'lessons' };
  if (seg[0] === 'reviews' && seg.length === 1) return { name: 'reviews' };
  if (seg[0] === 'settings' && seg.length === 1) return { name: 'settings' };
  if (seg[0] === 'browse' && seg.length === 1) return { name: 'browse' };
  if (seg[0] === 'item' && seg.length >= 2) {
    try { return { name: 'item', id: decodeURIComponent(seg.slice(1).join('/')) }; } catch { /* fallthrough */ }
  }
  return { name: 'notFound', path };
}

const subscribe = (cb: () => void) => { window.addEventListener('hashchange', cb); return () => window.removeEventListener('hashchange', cb); };
const getHash = () => location.hash;

export function useRoute(): Route {
  return parseRoute(useSyncExternalStore(subscribe, getHash));
}

export function navigate(hash: string): void {
  if (location.hash !== hash) location.hash = hash;
}
