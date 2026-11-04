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
// - Live layout conversion (`autoConvert`, state/liveConvert.ts): in a Korean field, Latin
//   keystrokes with no IME composition become 두벌식 Hangul as you type; in an English field,
//   Hangul from the OS Korean keyboard becomes the Latin keys once composition ends. Real IME
//   composition is never intercepted. Both `keydown` and `beforeinput` are handled (iPadOS
//   Safari with a hardware keyboard), and a `beforeinput` that can't be cancelled is repaired
//   on `input`.

import { useEffect, useRef, type CompositionEvent, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { applyKey, classifyKey, isConvertibleKey, runIsLive, toLatinField, type FieldState, type Run } from '../state/liveConvert.ts';

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
  /** Live-convert the wrong keyboard layout (setting `input.autoConvert`, default on). */
  autoConvert?: boolean;
  /** Show the small 한 / EN chip naming the expected script (default on). */
  scriptChip?: boolean;
}

export const COMPOSITION_FALLBACK_MS = 50;
/** Some desktop IMEs (macOS Chrome) send a second, non-composing Enter right after the
 *  committing one; a submit that soon after the last one, with the same value, is the same
 *  keypress (otherwise it would skip straight past the feedback panel). */
export const DOUBLE_ENTER_MS = 120;

export function HangulInput(props: HangulInputProps): JSX.Element {
  const { lang, handle, readOnly, placeholder, label, className, autoFocus, children, inputClassName } = props;
  const autoConvert = props.autoConvert !== false;
  const el = useRef<HTMLInputElement | null>(null);
  /** The live run of Latin keystrokes rendered as Hangul at the caret (Korean fields). */
  const run = useRef<Run | null>(null);
  /** A letter keydown already applied (so a stray beforeinput for it is dropped). */
  const swallow = useRef<string | null>(null);
  /** State to restore when a beforeinput we applied couldn't be cancelled. */
  const repair = useRef<FieldState | null>(null);
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
    run.current = null; // Enter flushes the run (its text is already in the field)
    if (!composing.current) toLatin();
    lastFire.current = { t: performance.now(), value: input.value };
    latest.current.onSubmit(input.value);
  };

  const convertKo = () => autoConvert && lang === 'ko' && !latest.current.readOnly;
  const convertEn = () => autoConvert && lang === 'en' && !latest.current.readOnly;

  const readState = (input: HTMLInputElement): FieldState => {
    const n = input.value.length;
    return { value: input.value, selStart: input.selectionStart ?? n, selEnd: input.selectionEnd ?? n, run: run.current };
  };
  const write = (input: HTMLInputElement, st: FieldState) => {
    if (input.value !== st.value) input.value = st.value;
    input.setSelectionRange(st.selStart, st.selEnd);
    run.current = st.run;
  };
  /** English field: Hangul typed on the Korean layout → its Latin keys. Never mid-composition. */
  function toLatin() {
    const input = el.current;
    if (!input || !convertEn() || composing.current) return;
    const out = toLatinField(input.value, input.selectionStart ?? input.value.length);
    if (!out) return;
    input.value = out.value;
    input.setSelectionRange(out.caret, out.caret);
  }

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
      // A programmatic value change starts a new submission context, so the double-Enter
      // guard must not swallow the next (fast) Enter, e.g. right after Undo refills the input.
      setValue: (v) => { if (el.current && !composing.current) { el.current.value = v; run.current = null; lastFire.current = { t: -Infinity, value: '' }; } },
      clear: () => { if (el.current && !composing.current) { el.current.value = ''; run.current = null; lastFire.current = { t: -Infinity, value: '' }; } },
      isComposing: () => composing.current,
    };
    return () => { handle.current = null; };
  }, [handle]);

  useEffect(() => () => { if (fallback.current !== undefined) clearTimeout(fallback.current); }, []);

  useEffect(() => {
    if (autoFocus) el.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  // beforeinput is native-only (React's onBeforeInput is a keypress/textInput polyfill).
  useEffect(() => {
    const input = el.current;
    if (!input) return;
    const onBeforeInput = (ev: InputEvent) => {
      if (!convertKo() || composing.current || ev.isComposing) return;
      const t = ev.inputType;
      const data = ev.data ?? '';
      if (t === 'insertText' && isConvertibleKey(data)) {
        if (swallow.current === data) { ev.preventDefault(); return; } // keydown already applied it
        // No usable keydown for this letter (some hardware-keyboard paths): apply it here.
        const r = applyKey(readState(input), { kind: 'letter', key: data });
        if (ev.cancelable) { ev.preventDefault(); write(input, r.state); } else repair.current = r.state;
        return;
      }
      if (t === 'deleteContentBackward' && runIsLive(readState(input))) {
        const r = applyKey(readState(input), { kind: 'backspace' });
        if (ev.cancelable) { ev.preventDefault(); write(input, r.state); } else repair.current = r.state;
        return;
      }
      run.current = null; // paste, drop, other text, delete-forward …: commit
    };
    input.addEventListener('beforeinput', onBeforeInput);
    return () => input.removeEventListener('beforeinput', onBeforeInput);
  });

  const onInput = () => {
    const input = el.current;
    if (!input) return;
    if (repair.current) { write(input, repair.current); repair.current = null; return; }
    if (composing.current) return;
    if (run.current && !runIsLive(readState(input))) run.current = null;
    toLatin();
  };

  const commitRun = () => { run.current = null; };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const input = el.current;
    if (input && convertKo() && !composing.current) {
      const a = classifyKey({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode });
      if (a !== 'ignore') {
        const r = applyKey(readState(input), a);
        if (r.handled) {
          e.preventDefault();
          write(input, r.state);
          if (a.kind === 'letter') {
            swallow.current = a.key;
            setTimeout(() => { swallow.current = null; }, 0);
          }
          return;
        }
        run.current = null; // Enter, Space, digits, arrows …: the run's text stays as it is
      }
    }
    if (e.key !== 'Enter') return;
    if (e.nativeEvent.isComposing || e.keyCode === 229 || composing.current) {
      e.preventDefault(); // stop the implicit form submit; wait for the IME to commit
      deferSubmit();
    }
  };

  const onCompositionStart = () => { composing.current = true; run.current = null; };
  const onCompositionEnd = (_e: CompositionEvent<HTMLInputElement>) => {
    composing.current = false;
    // Let the committed text land in `value` before reading it (and converting it).
    if (pending.current || convertEn()) setTimeout(() => { toLatin(); if (pending.current) fire(); }, 0);
  };

  const onFormSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (composing.current) { deferSubmit(); return; }
    const lf = lastFire.current;
    if (!pending.current && performance.now() - lf.t < DOUBLE_ENTER_MS && el.current?.value === lf.value) return;
    fire();
  };

  const chip = props.scriptChip !== false;
  return (
    <form className={className} onSubmit={onFormSubmit} autoComplete="off" noValidate>
      <span className={`answer-wrap${chip ? ' has-chip' : ''}`}>
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
        onInput={onInput}
        onPointerDown={commitRun}
        onBlur={commitRun}
        onAnimationEnd={props.onAnimationEnd}
        data-autoconvert={autoConvert ? 'on' : 'off'}
      />
      {chip && (
        <span className="script-chip" data-testid="script-chip" aria-hidden="true" lang={lang}
              title={lang === 'ko' ? (autoConvert ? 'Korean: Latin keys turn into 한글' : 'Korean') : (autoConvert ? 'English: 한글 keys turn into Latin' : 'English')}>
          {lang === 'ko' ? '한' : 'EN'}
        </span>
      )}
      </span>
      {children}
    </form>
  );
}
