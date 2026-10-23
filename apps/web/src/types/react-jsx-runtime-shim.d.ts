// See react-shim.d.ts (D29).
import type { Key, ReactNode } from 'react';
export { Fragment } from 'react';
export function jsx(type: unknown, props: unknown, key?: Key): JSX.Element;
export function jsxs(type: unknown, props: unknown, key?: Key): JSX.Element;
export namespace JSX {
  type Element = globalThis.JSX.Element;
  type ElementClass = globalThis.JSX.ElementClass;
  type ElementAttributesProperty = globalThis.JSX.ElementAttributesProperty;
  type ElementChildrenAttribute = globalThis.JSX.ElementChildrenAttribute;
  type IntrinsicAttributes = globalThis.JSX.IntrinsicAttributes;
  type IntrinsicClassAttributes<T> = globalThis.JSX.IntrinsicClassAttributes<T>;
  type IntrinsicElements = globalThis.JSX.IntrinsicElements;
}
export type { ReactNode };
