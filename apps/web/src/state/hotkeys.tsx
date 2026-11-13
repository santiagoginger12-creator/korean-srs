// Keyboard shortcuts at runtime (D87). Every rebindable key handler asks `matches(actionId, e)`;
// every visible key hint renders `<Keys id=…>` / `keyLabel(id)`. Bindings come from the synced
// `keys.bindings` setting (overrides only) on top of the registry defaults in @ksrs/srs-engine.
import { useEffect, useRef } from 'react';
import { codeMatches, formatCode, HOTKEY_BY_ID, resolveBindings, type HotkeyBindings } from '@ksrs/srs-engine';
import { store } from './store.ts';
import { useApp } from './hooks.ts';

let cacheIn: HotkeyBindings | undefined | null = null;
let cacheOut: Record<string, readonly string[]> = resolveBindings(undefined);

/** Current keys for every action (memoised on the settings object). */
export function currentBindings(): Record<string, readonly string[]> {
  const o = store.getState().derived?.settings['keys.bindings'];
  if (o !== cacheIn) { cacheIn = o; cacheOut = resolveBindings(o); }
  return cacheOut;
}

export function keysFor(actionId: string): readonly string[] {
  return currentBindings()[actionId] ?? HOTKEY_BY_ID.get(actionId)?.defaults ?? [];
}

/** Is this keydown one of `actionId`'s keys? Modifier combos (Cmd/Ctrl/Alt) never match. */
export function matches(actionId: string, e: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey'>): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  return keysFor(actionId).some((c) => codeMatches(c, e));
}

/** True when the key went to a text field (or select), where shortcuts stay out of the way. */
export function inField(e: KeyboardEvent): boolean {
  const tag = (e.target as HTMLElement | null)?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** Primary key label for an action ("→", "Space", "D"). Re-renders with the setting via `useKeyLabel`. */
export function keyLabel(actionId: string): string {
  const c = keysFor(actionId)[0];
  return c ? formatCode(c) : '';
}

/** Subscribes to the store so the hint updates when the owner rebinds. */
export function useKeyLabel(actionId: string): string {
  useApp();
  return keyLabel(actionId);
}

/** The `<kbd>` hint for an action's primary key. */
export function Kbd({ id }: { id: string }): JSX.Element {
  return <kbd>{useKeyLabel(id)}</kbd>;
}

export interface HotkeyOpts {
  /** Default false: held-key repeats are ignored. */
  allowRepeat?: boolean;
  /** Default false: keys typed into INPUT/TEXTAREA/SELECT are ignored. */
  inFields?: boolean;
  /** Default false: fire at most once per mount (finish screens leave once even if held). */
  once?: boolean;
  /** Listen in the capture phase. */
  capture?: boolean;
}

/**
 * Run `handler` when one of `actionId`'s keys is pressed (preventDefault included). `enabled`
 * may change between renders; the handler always sees the latest closure.
 */
export function useHotkey(actionId: string, handler: (e: KeyboardEvent) => void, enabled = true, opts: HotkeyOpts = {}): void {
  const ref = useRef(handler);
  ref.current = handler;
  const { allowRepeat = false, inFields = false, once = false, capture = false } = opts;
  useEffect(() => {
    if (!enabled) return;
    let used = false;
    const onKey = (e: KeyboardEvent) => {
      if (used || (!allowRepeat && e.repeat) || (!inFields && inField(e))) return;
      if (!matches(actionId, e)) return;
      e.preventDefault();
      if (once) used = true;
      ref.current(e);
    };
    window.addEventListener('keydown', onKey, capture);
    return () => window.removeEventListener('keydown', onKey, capture);
  }, [actionId, enabled, allowRepeat, inFields, once, capture]);
}
