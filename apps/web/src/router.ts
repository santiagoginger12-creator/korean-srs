// Hash routing (D14): #/, #/lessons, #/reviews, #/item/<id>, #/browse, #/settings, #/data,
// #/trouble, #/inbox, #/practice[/trouble|/recent].
import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'home' } | { name: 'lessons' } | { name: 'reviews' } | { name: 'settings' } | { name: 'browse' }
  | { name: 'data' } | { name: 'trouble' } | { name: 'inbox' } | { name: 'practice'; preset?: 'trouble' | 'recent' }
  | { name: 'item'; id: string } | { name: 'notFound'; path: string };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/^\/?/, '/');
  const seg = path.split('/').filter(Boolean);
  if (seg.length === 0) return { name: 'home' };
  if (seg[0] === 'lessons' && seg.length === 1) return { name: 'lessons' };
  if (seg[0] === 'reviews' && seg.length === 1) return { name: 'reviews' };
  if (seg[0] === 'settings' && seg.length === 1) return { name: 'settings' };
  if (seg[0] === 'browse' && seg.length === 1) return { name: 'browse' };
  if (seg[0] === 'data' && seg.length === 1) return { name: 'data' };
  if (seg[0] === 'trouble' && seg.length === 1) return { name: 'trouble' };
  if (seg[0] === 'inbox' && seg.length === 1) return { name: 'inbox' };
  if (seg[0] === 'practice' && seg.length === 1) return { name: 'practice' };
  if (seg[0] === 'practice' && seg.length === 2 && (seg[1] === 'trouble' || seg[1] === 'recent')) return { name: 'practice', preset: seg[1] };
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
