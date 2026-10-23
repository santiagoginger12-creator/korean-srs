// See react-shim.d.ts (D29).
import type { ReactNode } from 'react';
export interface Root { render(children: ReactNode): void; unmount(): void }
export function createRoot(container: Element | DocumentFragment, options?: { identifierPrefix?: string }): Root;
