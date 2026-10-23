// Composition-safe answer input (ARCHITECTURE.md §8.6).
//
// - Uncontrolled: React never writes `value`, so an in-progress Hangul syllable is never
//   clobbered mid-composition. The parent reads/writes through `handle` only between answers.
// - Submission goes through a <form onSubmit>. On Android Gboard, keydown reports
//   key 'Unidentified' / keyCode 229 and the form submit fires after the IME commits.
// - Enter during composition (iOS Safari fires compositionend *after* the Enter keydown;
//   desktop IMEs report isComposing): we cancel the keydown, mark the submit as pending and
//   fire it on the next compositionend, with a 50 ms fallback in case compositionend never
//   arrives. The value is read from the DOM only at that moment, so it holds the whole word.

import { useEffect, useRef, type CompositionEvent, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';

export interface HangulInputHandle {
  focus(): void;
  value(): string;
  /** Ignored while composing (never fight the IME). */
  setValue(v: string): void;
  clear(): void;
  isComposing(): boolean;
}

export interface HangulInputProps {
  lang: 'ko' | 'en';
  onSubmit: (value: string) => void;
  handle?: RefObject<HangulInputHandle | null>;
  readOnly?: boolean;
  placeholder?: string;
  label: string;
  className?: string;
  autoFocus?: boolean;
  /** Extra content inside the form (e.g. a submit button). */
  children?: ReactNode;
  inputClassName?: string;
  /** Fired after the shake animation ends (parent clears its shake flag). */
  onAnimationEnd?: () => void;
}

export const COMPOSITION_FALLBACK_MS = 50;
/** Some desktop IMEs (macOS Chrome) send a second, non-composing Enter right after the
 *  committing one; a submit that soon after the last one, with the same value, is the same
 *  keypress (otherwise it would skip straight past the feedback panel). */
export const DOUBLE_ENTER_MS = 120;

export function HangulInput(props: HangulInputProps): JSX.Element {
  const { lang, handle, readOnly, placeholder, label, className, autoFocus, children, inputClassName } = props;
  const el = useRef<HTMLInputElement | null>(null);
  const composing = useRef(false);
  const pending = useRef(false);
  const fallback = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastFire = useRef({ t: -Infinity, value: '' });
  const latest = useRef(props);
  latest.current = props;

  const fire = () => {
    pending.current = false;
    if (fallback.current !== undefined) { clearTimeout(fallback.current); fallback.current = undefined; }
    const input = el.current;
    if (!input) return;
    lastFire.current = { t: performance.now(), value: input.value };
    latest.current.onSubmit(input.value);
  };

  const deferSubmit = () => {
    pending.current = true;
    if (fallback.current !== undefined) clearTimeout(fallback.current);
    fallback.current = setTimeout(() => { if (pending.current) fire(); }, COMPOSITION_FALLBACK_MS);
  };

  useEffect(() => {
    if (!handle) return;
    handle.current = {
      focus: () => el.current?.focus({ preventScroll: true }),
      value: () => el.current?.value ?? '',
      setValue: (v) => { if (el.current && !composing.current) el.current.value = v; },
      clear: () => { if (el.current && !composing.current) el.current.value = ''; },
      isComposing: () => composing.current,
    };
    return () => { handle.current = null; };
  }, [handle]);

  useEffect(() => () => { if (fallback.current !== undefined) clearTimeout(fallback.current); }, []);

  useEffect(() => {
    if (autoFocus) el.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    if (e.nativeEvent.isComposing || e.keyCode === 229 || composing.current) {
      e.preventDefault(); // stop the implicit form submit; wait for the IME to commit
      deferSubmit();
    }
  };

  const onCompositionStart = () => { composing.current = true; };
  const onCompositionEnd = (_e: CompositionEvent<HTMLInputElement>) => {
    composing.current = false;
    // Let the committed text land in `value` before reading it.
    if (pending.current) setTimeout(() => { if (pending.current) fire(); }, 0);
  };

  const onFormSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (composing.current) { deferSubmit(); return; }
    const lf = lastFire.current;
    if (!pending.current && performance.now() - lf.t < DOUBLE_ENTER_MS && el.current?.value === lf.value) return;
    fire();
  };

  return (
    <form className={className} onSubmit={onFormSubmit} autoComplete="off" noValidate>
      <input
        ref={el}
        className={inputClassName}
        type="text"
        name={lang === 'ko' ? 'answer-ko' : 'answer-en'}
        lang={lang}
        aria-label={label}
        placeholder={placeholder}
        readOnly={readOnly}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="done"
        onKeyDown={onKeyDown}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        onAnimationEnd={props.onAnimationEnd}
      />
      {children}
    </form>
  );
}
