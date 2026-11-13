// Settings → Keyboard shortcuts (D87). Every rebindable action from the registry, grouped by where
// it applies, with its current key(s), Change / add / remove an alternate / Reset, and Reset all.
// A binding change is checked against every screen the action shares with others; a clash offers
// Swap (when the swap is itself valid) or Cancel, so the stored set is never broken.
import { useEffect, useRef, useState } from 'react';
import {
  bindKey, canonicalCode, compactBindings, findConflicts, formatCode, HOTKEY_ACTIONS, HOTKEY_BY_ID, HOTKEY_GROUPS,
  isBindableCode, MAX_KEYS_PER_ACTION, removeAlternate, resolveBindings,
} from '@ksrs/srs-engine';
import { useApp } from '../../state/hooks.ts';
import { store } from '../../state/store.ts';

type Resolved = Record<string, readonly string[]>;
interface Capture { id: string; slot: 0 | 1 }
interface Pending { id: string; slot: 0 | 1; code: string; otherId: string; swap: Resolved | null }

const MODIFIER_CODES = /^(Shift|Control|Alt|Meta|OS|CapsLock|Fn)/;

export function KeyboardShortcuts(): JSX.Element {
  const overrides = useApp().derived!.settings['keys.bindings'];
  const resolved = resolveBindings(overrides);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [msg, setMsg] = useState<{ id: string; text: string } | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const swallowUp = useRef<string | null>(null);
  const focusAfter = useRef<string | null>(null);
  const root = useRef<HTMLDivElement | null>(null);

  const save = (next: Resolved) => {
    const compact = compactBindings(next);
    void store.setAppSetting('keys.bindings', compact);
  };

  // Restore focus to a control by test id once React has rendered the new state.
  useEffect(() => {
    const id = focusAfter.current;
    if (!id) return;
    focusAfter.current = null;
    root.current?.querySelector<HTMLElement>(`[data-testid="${id}"]`)?.focus();
  });

  // The key that ended a capture: swallow its keyup so Space doesn't click the focused button.
  useEffect(() => {
    const onUp = (e: KeyboardEvent) => {
      if (swallowUp.current && e.code === swallowUp.current) { e.preventDefault(); e.stopImmediatePropagation(); swallowUp.current = null; }
    };
    window.addEventListener('keyup', onUp, true);
    return () => window.removeEventListener('keyup', onUp, true);
  }, []);

  const resolvedRef = useRef(resolved);
  resolvedRef.current = resolved;
  useEffect(() => {
    if (!capture) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab' || e.code === 'Tab') { setCapture(null); return; } // keep Tab for focus
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat || e.isComposing) return;
      const done = (focus: string) => { swallowUp.current = e.code || null; setCapture(null); focusAfter.current = focus; };
      if (e.key === 'Escape' || e.code === 'Escape') { done(`key-change-${capture.id}`); return; }
      if (MODIFIER_CODES.test(e.code) || ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return; // wait for the real key
      if (e.metaKey || e.ctrlKey || e.altKey) { setMsg({ id: capture.id, text: 'Shortcuts can’t use Cmd, Ctrl or Alt. Press a single key.' }); return; }
      const code = canonicalCode(e.code || '');
      if (!isBindableCode(code)) {
        setMsg({ id: capture.id, text: code ? `${e.code} can’t be a shortcut. Use a letter, digit, arrow, Space, Enter, Backspace or punctuation key.` : 'Couldn’t read that key. Try another.' });
        return;
      }
      const r = bindKey(resolvedRef.current, capture.id, capture.slot, code);
      done(`key-change-${capture.id}`);
      if (r.ok) { setMsg(null); save(r.bindings); return; }
      if (r.reason === 'conflict') {
        setMsg(null);
        setPending({ id: capture.id, slot: capture.slot, code, otherId: r.otherId, swap: r.swap });
        focusAfter.current = r.swap ? 'key-swap' : 'key-cancel';
        return;
      }
      setMsg({
        id: capture.id,
        text: r.reason === 'same-action' ? `${formatCode(code)} is already this action’s other key.`
          : r.reason === 'reserved' ? `${formatCode(code)} is a fixed key on that screen (e.g. answer options or the confirm prompt).`
          : 'That key can’t be used.',
      });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capture]);

  const start = (id: string, slot: 0 | 1) => { setPending(null); setMsg(null); setConfirmAll(false); setCapture({ id, slot }); focusAfter.current = `key-capture-cancel-${id}`; };
  const resetRow = (id: string) => {
    const next = { ...resolved, [id]: HOTKEY_BY_ID.get(id)!.defaults };
    const clash = findConflicts(next).find((c) => c.otherId && c.otherId !== id);
    if (clash) {
      setMsg({ id, text: `Can’t reset: ${formatCode(clash.code)} is now used by “${HOTKEY_BY_ID.get(clash.otherId!)!.label}”. Change that one first.` });
      return;
    }
    setMsg(null);
    save(next);
  };
  const broken = findConflicts(resolved);

  return (
    <div className="card form keys-settings" data-testid="keys-settings" ref={root}>
      <h3>Keyboard shortcuts</h3>
      <p className="muted small">Change the keys used on lesson, review, finish and drill screens. Keys follow the physical key, so they work with the Korean keyboard on. Typing answers, Esc and Cmd/Ctrl+Z don’t change.</p>
      <p className="muted small keys-touch-note">Shortcuts apply when a keyboard is attached.</p>
      {broken.length > 0 && (
        <p className="keys-warn" role="alert">Two actions share a key after a sync ({broken.map((c) => formatCode(c.code)).join(', ')}). Change one of them.</p>
      )}
      {HOTKEY_GROUPS.map((g) => (
        <section key={g} className="keys-group" aria-labelledby={`keys-g-${g}`}>
          <h4 id={`keys-g-${g}`}>{g}</h4>
          <ul className="keys-list">
            {HOTKEY_ACTIONS.filter((a) => a.group === g).map((a) => {
              const codes = resolved[a.id] ?? a.defaults;
              const custom = !!overrides?.[a.id];
              const capturing = capture?.id === a.id;
              const labelId = `key-label-${a.id}`;
              return (
                <li key={a.id} className="key-row" data-testid={`key-row-${a.id}`} data-keys={codes.join(' ')}>
                  <div className="key-label">
                    <span id={labelId}>{a.label}</span>
                    {a.note && <span className="muted small key-note">{a.note}</span>}
                  </div>
                  <div className="key-controls">
                    {capturing ? (
                      <>
                        <span className="key-capture" role="status" aria-live="polite" data-testid={`key-capture-${a.id}`}>
                          {capture!.slot === 1 && codes.length === 1 ? 'Press another key…' : 'Press a key…'} <span className="muted">Esc to cancel</span>
                        </span>
                        <button type="button" className="btn btn-small btn-quiet" data-testid={`key-capture-cancel-${a.id}`}
                          onClick={() => { setCapture(null); focusAfter.current = `key-change-${a.id}`; }}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <span className="key-chips" data-testid={`key-chips-${a.id}`}>
                          {codes.map((c, i) => (
                            <span key={c} className="key-chip">
                              <kbd>{formatCode(c)}</kbd>
                              {i === 1 && (
                                <button type="button" className="key-chip-x" data-testid={`key-remove-alt-${a.id}`}
                                  aria-label={`Remove ${formatCode(c)} from ${a.label}`}
                                  onClick={() => { setMsg(null); setPending(null); save(removeAlternate(resolved, a.id)); focusAfter.current = `key-change-${a.id}`; }}>×</button>
                              )}
                            </span>
                          ))}
                        </span>
                        <button type="button" className="btn btn-small btn-quiet" data-testid={`key-change-${a.id}`}
                          aria-describedby={labelId} onClick={() => start(a.id, 0)}>Change</button>
                        {codes.length < MAX_KEYS_PER_ACTION && (
                          <button type="button" className="btn-text small" data-testid={`key-add-${a.id}`}
                            aria-describedby={labelId} onClick={() => start(a.id, 1)}>+ Alternate</button>
                        )}
                        {custom && (
                          <button type="button" className="btn-text small" data-testid={`key-reset-${a.id}`}
                            aria-describedby={labelId} onClick={() => resetRow(a.id)}>Reset</button>
                        )}
                      </>
                    )}
                  </div>
                  {msg?.id === a.id && <p className="key-msg" role="alert" data-testid="key-msg">{msg.text}</p>}
                  {pending?.id === a.id && (
                    <div className="key-conflict" role="alertdialog" aria-label="Shortcut conflict" data-testid="key-conflict">
                      <p>
                        <kbd>{formatCode(pending.code)}</kbd> is already used by “{HOTKEY_BY_ID.get(pending.otherId)!.label}”
                        {HOTKEY_BY_ID.get(pending.otherId)!.group !== a.group ? ` (${HOTKEY_BY_ID.get(pending.otherId)!.group})` : ''}.
                        {pending.swap
                          ? ' Swap keys?'
                          : ' Swapping would leave it without a usable key; choose another key.'}
                      </p>
                      <div className="row">
                        {pending.swap && (
                          <button type="button" className="btn btn-small btn-primary" data-testid="key-swap"
                            onClick={() => { save(pending.swap!); setPending(null); focusAfter.current = `key-change-${a.id}`; }}>Swap</button>
                        )}
                        <button type="button" className="btn btn-small btn-quiet" data-testid="key-cancel"
                          onClick={() => { setPending(null); focusAfter.current = `key-change-${a.id}`; }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {confirmAll ? (
        <div className="key-conflict" role="alertdialog" aria-label="Reset all shortcuts" data-testid="keys-reset-all-confirm">
          <p>Reset every keyboard shortcut to its default?</p>
          <div className="row">
            <button type="button" className="btn btn-small btn-primary" data-testid="keys-reset-all-yes"
              onClick={() => { void store.setAppSetting('keys.bindings', {}); setConfirmAll(false); setMsg(null); setPending(null); focusAfter.current = 'keys-reset-all'; }}>Reset all</button>
            <button type="button" className="btn btn-small btn-quiet" data-testid="keys-reset-all-cancel"
              onClick={() => { setConfirmAll(false); focusAfter.current = 'keys-reset-all'; }}>Cancel</button>
          </div>
        </div>
      ) : (
        <p>
          <button type="button" className="btn btn-quiet" data-testid="keys-reset-all"
            onClick={() => { setCapture(null); setPending(null); setConfirmAll(true); focusAfter.current = 'keys-reset-all-cancel'; }}>Reset all shortcuts</button>
        </p>
      )}
    </div>
  );
}
