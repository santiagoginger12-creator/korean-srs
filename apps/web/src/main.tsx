import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { registerSW } from './pwa/register.ts';
import { store } from './state/store.ts';
import { sync } from './state/sync.ts';
import { isArtifact } from './host.ts';
import { scheduleExamplesLoad } from './data/examples.ts';
import './styles.css';

declare const __BASE__: string;
declare const __DEV__: boolean;

void store.init();
// GitHub sync (M6): starts once the store is ready; first sync after the first paint.
sync.start();
if (!__DEV__ && !isArtifact) registerSW(`${__BASE__}sw.js`, __BASE__);
// Test/debug hook: read-only access to the store (no clock or write shortcuts).
(window as unknown as { __ksrs?: unknown }).__ksrs = { store, sync };

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
// Dictionary examples (optional examples.json): fetched once the first paint is done.
scheduleExamplesLoad();
