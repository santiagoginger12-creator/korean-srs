import { useEffect, useState, useSyncExternalStore } from 'react';
import { now } from './clock.ts';
import { store, type AppState } from './store.ts';

export function useApp(): AppState {
  return useSyncExternalStore(store.subscribe, store.getState);
}

/** Current time, re-read every `ms` and whenever the tab becomes visible again. */
export function useNow(ms = 30_000): number {
  const [t, setT] = useState(now);
  useEffect(() => {
    const tick = () => setT(now());
    const id = setInterval(tick, ms);
    const vis = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('focus', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', vis); window.removeEventListener('focus', tick); };
  }, [ms]);
  return t;
}
