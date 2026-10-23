// Minimal local type shim for React 19 (DECISIONS.md D29): @types/react can't be installed
// offline. Only the surface this app uses is declared; JSX intrinsic props are loose (`any`),
// but every hook and event type used by app code is typed. Delete this file (and the tsconfig
// `paths` entries for react*) once @types/react is installable.

export type Key = string | number | bigint;
export type ReactNode =
  | JSX.Element | string | number | bigint | boolean | null | undefined | Iterable<ReactNode>;
export interface ReactElement { type: unknown; props: unknown; key: string | null }

export interface RefObject<T> { current: T }
export type Ref<T> = RefObject<T | null> | ((instance: T | null) => void) | null;

export type SetStateAction<S> = S | ((prev: S) => S);
export type Dispatch<A> = (value: A) => void;
export type EffectCallback = () => void | (() => void);
export type DependencyList = readonly unknown[];

export function useState<S>(initial: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
export function useState<S = undefined>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>];
export function useReducer<S, A>(reducer: (s: S, a: A) => S, initial: S): [S, Dispatch<A>];
export function useReducer<S, A, I>(reducer: (s: S, a: A) => S, arg: I, init: (arg: I) => S): [S, Dispatch<A>];
export function useEffect(effect: EffectCallback, deps?: DependencyList): void;
export function useLayoutEffect(effect: EffectCallback, deps?: DependencyList): void;
export function useRef<T>(initial: T): RefObject<T>;
export function useRef<T>(initial: T | null): RefObject<T | null>;
export function useRef<T = undefined>(): RefObject<T | undefined>;
export function useMemo<T>(factory: () => T, deps: DependencyList): T;
export function useCallback<T extends (...args: never[]) => unknown>(cb: T, deps: DependencyList): T;
export function useId(): string;
export function useSyncExternalStore<T>(subscribe: (onChange: () => void) => () => void, getSnapshot: () => T, getServerSnapshot?: () => T): T;
export function useImperativeHandle<T>(ref: Ref<T> | undefined, init: () => T, deps?: DependencyList): void;
export function useTransition(): [boolean, (cb: () => void) => void];

export interface Context<T> { Provider: (props: { value: T; children?: ReactNode }) => JSX.Element; _default?: T }
export function createContext<T>(defaultValue: T): Context<T>;
export function useContext<T>(ctx: Context<T>): T;

export type FC<P = {}> = (props: P) => ReactNode;
export interface PropsWithChildren { children?: ReactNode }
export function memo<P>(c: (props: P) => ReactNode): (props: P) => ReactNode;
export function forwardRef<T, P = {}>(render: (props: P, ref: Ref<T>) => ReactNode): (props: P & { ref?: Ref<T> }) => ReactNode;

export const Fragment: (props: { children?: ReactNode; key?: Key }) => JSX.Element;
export const StrictMode: (props: { children?: ReactNode }) => JSX.Element;

export interface CSSProperties { [prop: string]: string | number | undefined }

// ---- synthetic events (the subset the app reads)
export interface SyntheticEvent<T = Element, E = Event> {
  nativeEvent: E; currentTarget: T; target: EventTarget | null; type: string;
  defaultPrevented: boolean; preventDefault(): void; stopPropagation(): void;
}
export interface FormEvent<T = Element> extends SyntheticEvent<T> {}
export interface ChangeEvent<T = Element> extends SyntheticEvent<T> { target: EventTarget & T }
export interface FocusEvent<T = Element> extends SyntheticEvent<T, globalThis.FocusEvent> {}
export interface CompositionEvent<T = Element> extends SyntheticEvent<T, globalThis.CompositionEvent> { data: string }
export interface KeyboardEvent<T = Element> extends SyntheticEvent<T, globalThis.KeyboardEvent> {
  key: string; code: string; keyCode: number; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; repeat: boolean;
}
export interface MouseEvent<T = Element> extends SyntheticEvent<T, globalThis.MouseEvent> { button: number }
export interface AnimationEvent<T = Element> extends SyntheticEvent<T, globalThis.AnimationEvent> { animationName: string }

declare const React: {
  useState: typeof useState; useEffect: typeof useEffect; useRef: typeof useRef; useMemo: typeof useMemo;
  useCallback: typeof useCallback; Fragment: typeof Fragment; StrictMode: typeof StrictMode;
};
export default React;

declare global {
  namespace JSX {
    type Element = ReactElement;
    interface ElementClass { render(): ReactNode }
    interface ElementAttributesProperty { props: {} }
    interface ElementChildrenAttribute { children: {} }
    interface IntrinsicAttributes { key?: Key | null | undefined }
    interface IntrinsicClassAttributes<T> { ref?: Ref<T> }
    // Loosely typed on purpose (no @types/react); handlers should annotate their event type.
    interface IntrinsicElements { [elemName: string]: any }
  }
}
