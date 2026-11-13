// One drill session (D82). Order comes from the engine's pickNext: due learning cards, then reviews
// with the session's new cards spread among them, then learning cards within the learn-ahead limit.
// Every answer is a drill.review event, so leaving or reloading mid-session loses nothing.
// Keys: Space/Enter show the answer, 1–4 grade (FlipMode); Z or Ctrl/Cmd+Z undo; K then K/Enter
// marks the word known; Esc cancels. Held keys never repeat an action. Z, K, reveal and grades are
// rebindable shortcuts (D87); Ctrl/Cmd+Z, Enter/Y/Esc/N in the confirm stay fixed.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  afterAnswer, drillParams, formatInterval, newCardSched, parseCardId, pickNext, RATINGS, scheduleAll,
  type DrillPick, type DrillSession as Sess, type PickSource, type Rating,
} from '@ksrs/srs-engine';
import { NextSteps } from '../../components/NextSteps.tsx';
import { now, tz } from '../../state/clock.ts';
import { drillDay } from '../../state/drill.ts';
import { useApp, useNow } from '../../state/hooks.ts';
import { store } from '../../state/store.ts';
import { speak, ttsPrefs } from '../../tts/tts.ts';
import { CardBack, CardFront } from './CardFaces.tsx';
import type { Deck } from './deck.ts';
import { answerMode } from './modes/index.ts';
import { Kbd, matches, useKeyLabel } from '../../state/hotkeys.tsx';

interface Current { cardId: string; source: PickSource; shownAt: number }
interface Tally { answered: number; again: number; newSeen: number; known: number; ms: number; ratings: Record<Rating, number> }
interface UndoEntry { eventId: string; cardId: string; source: PickSource; sessBefore: Sess; tallyBefore: Tally }

const EMPTY_TALLY: Tally = { answered: 0, again: 0, newSeen: 0, known: 0, ms: 0, ratings: { 1: 0, 2: 0, 3: 0, 4: 0 } };
const MAX_DURATION_MS = 120_000;

export function DrillSession({ deck, newQueue, onRestart, onHome }: {
  deck: Deck;
  newQueue: string[];
  /** D on the finish screen: a fresh session in place. */
  onRestart: () => void;
  onHome: () => void;
}): JSX.Element {
  const app = useApp();
  const settings = app.derived!.settings;
  const [sess, setSess] = useState<Sess>(() => ({ newQueue, sinceNew: 0 }));
  const [current, setCurrent] = useState<Current | null>(null);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const [finished, setFinished] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [confirmKnown, setConfirmKnown] = useState(false);
  const [undo, setUndo] = useState<UndoEntry[]>([]);
  const [tally, setTally] = useState<Tally>(EMPTY_TALLY);
  const homographs = useMemo(() => {
    const seen = new Map<string, number>();
    for (const w of deck.words) seen.set(w.headword, (seen.get(w.headword) ?? 0) + 1);
    return seen;
  }, [deck]);

  useEffect(() => { store.setDrillActive(true); return () => { store.setDrillActive(false); }; }, []);

  /** Shows the next card for `s` (reads the store directly: answers update it synchronously). */
  const advance = (s: Sess) => {
    const t = now();
    const pick: DrillPick = pickNext(store.getState().drill, s, t, drillDay(t, store.getState().derived!.settings, tz));
    setRevealed(false);
    setConfirmKnown(false);
    if (pick.kind === 'card') { setCurrent({ cardId: pick.cardId, source: pick.source, shownAt: t }); setWaitUntil(null); setFinished(false); }
    else if (pick.kind === 'wait') { setCurrent(null); setWaitUntil(pick.until); }
    else { setCurrent(null); setWaitUntil(null); setFinished(true); }
  };
  useEffect(() => { advance(sess); }, []); // first card

  // Waiting for a learning card: tick, and show it when it's due.
  const tick = useNow(waitUntil !== null ? 1000 : 60_000);
  useEffect(() => { if (waitUntil !== null && tick >= waitUntil) advance(sess); }, [tick, waitUntil]);

  const word = current ? deck.byId.get(parseCardId(current.cardId).wordId) : undefined;
  const dir = current ? parseCardId(current.cardId).dir : 'f';

  const reveal = () => {
    if (!current || revealed || !word) return;
    setRevealed(true);
    // Inside the key/tap handler, so iOS allows speech.
    const prefs = ttsPrefs(settings);
    if (prefs.autoplay) speak(word.headword, prefs);
  };

  const finishOrNext = (s: Sess) => { setSess(s); advance(s); };

  const grade = (r: Rating) => {
    if (!current || !revealed) return;
    const t = now();
    const eventId = store.drillAnswer(current.cardId, r, Math.min(MAX_DURATION_MS, t - current.shownAt));
    const next = afterAnswer(sess, store.getState().drill, current.source);
    setUndo((u) => [...u, { eventId, cardId: current.cardId, source: current.source, sessBefore: sess, tallyBefore: tally }]);
    setTally((x) => ({
      ...x, answered: x.answered + 1, again: x.again + (r === 1 ? 1 : 0), newSeen: x.newSeen + (current.source === 'new' ? 1 : 0),
      ms: x.ms + Math.min(MAX_DURATION_MS, t - current.shownAt), ratings: { ...x.ratings, [r]: x.ratings[r] + 1 },
    }));
    finishOrNext(next);
  };

  const markKnown = () => {
    if (!current) return;
    const [eventId] = store.drillKnown([current.cardId], 'card');
    const next = afterAnswer(sess, store.getState().drill, current.source === 'new' ? 'learning' : current.source);
    setUndo((u) => [...u, { eventId: eventId!, cardId: current.cardId, source: current.source, sessBefore: sess, tallyBefore: tally }]);
    setTally((x) => ({ ...x, known: x.known + 1 }));
    finishOrNext(next);
  };

  const undoLast = () => {
    const last = undo[undo.length - 1];
    if (!last) return;
    store.drillUndo(last.eventId);
    setUndo((u) => u.slice(0, -1));
    setSess(last.sessBefore);
    setTally(last.tallyBefore);
    setCurrent({ cardId: last.cardId, source: last.source, shownAt: now() });
    setWaitUntil(null);
    setFinished(false);
    setRevealed(false);
    setConfirmKnown(false);
  };

  // Session-level keys (the answer mode handles reveal and grading).
  const keys = useRef({ undoLast, markKnown, confirmKnown, setConfirmKnown, current });
  keys.current = { undoLast, markKnown, confirmKnown, setConfirmKnown, current };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.repeat) return;
      const k = keys.current;
      const is = (c: string) => e.key.toLowerCase() === c || e.code === `Key${c.toUpperCase()}`;
      // Confirm keys (fixed apart from `drill.known`): Enter / Y confirm, Esc / N cancel.
      const confirmYes = k.confirmKnown && !e.metaKey && !e.ctrlKey && !e.altKey
        && (matches('drill.known', e) || e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter' || is('y'));
      const confirmNo = k.confirmKnown && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'Escape' || is('n'));
      // Undo: the `drill.undo` key (Z by default), plus Cmd/Ctrl+Z as a fixed extra binding.
      const undoKey = !e.altKey && !e.shiftKey
        && ((matches('drill.undo', e)) || ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'z' || e.code === 'KeyZ')));
      if (undoKey && !confirmYes && !confirmNo) { e.preventDefault(); k.undoLast(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (k.confirmKnown) {
        if (confirmYes) { e.preventDefault(); k.markKnown(); }
        else if (confirmNo) { e.preventDefault(); k.setConfirmKnown(false); }
        else e.preventDefault();
        return;
      }
      if (matches('drill.known', e) && k.current) { e.preventDefault(); k.setConfirmKnown(true); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const undoLabel = useKeyLabel('drill.undo');
  const st = app.drill;
  const t = now();
  const day = drillDay(t, settings, tz);
  const remaining = useMemo(() => {
    let learning = 0, review = 0;
    for (const c of st.cards.values()) {
      if (c.known || c.phase === 'new') continue;
      if ((c.phase === 'learning' || c.phase === 'relearning') && c.due < day.end) learning++;
      else if (c.phase === 'review' && c.due < day.end) review++;
    }
    const fresh = sess.newQueue.filter((id) => { const c = st.cards.get(id); return !c || (c.phase === 'new' && !c.known); }).length;
    return { learning, review, fresh };
  }, [st, sess, day.end]);

  if (finished) {
    const mins = Math.round(tally.ms / 60_000);
    return (
      <div className="page narrow summary drill-summary" data-testid="drill-summary">
        <h1>Drill complete</h1>
        <p className="big-stat"><span data-testid="drill-summary-answered">{tally.answered}</span> answered · <span>{tally.again}</span> again</p>
        <p className="muted">
          {tally.newSeen} new · {tally.known} marked known{mins > 0 ? ` · about ${mins} min` : ''}
          {tally.answered > 0 && ` · ${RATINGS.map((r) => `${tally.ratings[r]} ${['', 'Again', 'Hard', 'Good', 'Easy'][r]}`).join(', ')}`}
        </p>
        {undo.length > 0 && <p><button type="button" className="btn-text" onClick={undoLast} data-testid="drill-undo">Undo last answer <Kbd id="drill.undo" /></button></p>}
        <NextSteps beforeLeave={() => store.drillSessionEnded()} onDrill={() => { void store.drillSessionEnded().then(onRestart); }} />
      </div>
    );
  }

  const Mode = answerMode(settings['drill.answerMode']).Component;
  const intervals = {} as Record<Rating, string>;
  if (current && revealed) {
    const card = st.cards.get(current.cardId) ?? newCardSched();
    const all = scheduleAll(card, t, current.cardId, drillParams(st.retention));
    for (const r of RATINGS) intervals[r] = formatInterval(all[r].due - t);
  }

  return (
    <div className="page narrow drill-session" data-testid="drill-session">
      <header className="drill-head">
        <button type="button" className="btn-text" onClick={() => { setCurrent(null); setFinished(true); }} data-testid="drill-end">End</button>
        <p className="drill-remaining" aria-label="Cards left today" data-testid="drill-remaining">
          <span className="rem-new" title="New">{remaining.fresh}</span>
          <span className="rem-learn" title="Learning">{remaining.learning}</span>
          <span className="rem-review" title="Review">{remaining.review}</span>
        </p>
        <button type="button" className="btn-text" onClick={undoLast} disabled={!undo.length} data-testid="drill-undo" aria-keyshortcuts={undoLabel}>Undo <Kbd id="drill.undo" /></button>
      </header>

      {waitUntil !== null && !current && (
        <div className="card drill-wait" data-testid="drill-wait">
          <p>Next learning card in <strong>{formatInterval(Math.max(0, waitUntil - tick))}</strong>.</p>
          <p className="muted small">It comes back here when it's due. You can also end now; it will wait in the drill.</p>
          <button type="button" className="btn btn-quiet" onClick={() => setFinished(true)}>End session</button>
        </div>
      )}

      {current && word && (
        <>
          <Mode
            card={{ cardId: current.cardId, dir, word }}
            front={<CardFront word={word} dir={dir} homograph={(homographs.get(word.headword) ?? 0) > 1} />}
            back={<CardBack word={word} dir={dir} credit={deck.credit} />}
            revealed={revealed}
            reveal={reveal}
            grade={grade}
            intervals={intervals}
            paused={confirmKnown}
          />
          {confirmKnown ? (
            <div className="drill-confirm" role="alertdialog" aria-label="Mark as known" data-testid="drill-known-confirm">
              <span>Mark <strong lang="ko">{word.headword}</strong>{dir === 'r' ? ' (English → Korean)' : ''} as known? It won't be shown again.</span>
              <button type="button" className="btn btn-primary btn-small" onClick={markKnown} data-testid="drill-known-yes">Yes, I know it <Kbd id="drill.known" /></button>
              <button type="button" className="btn btn-quiet btn-small" onClick={() => setConfirmKnown(false)}>Cancel <kbd>Esc</kbd></button>
            </div>
          ) : (
            <p className="drill-foot">
              <button type="button" className="btn-text small" onClick={() => setConfirmKnown(true)} data-testid="drill-known">I already know this <Kbd id="drill.known" /></button>
            </p>
          )}
        </>
      )}
      {current && !word && <p className="muted">This card's word isn't in the deck any more. <button type="button" className="btn-text" onClick={onHome}>Back</button></p>}
    </div>
  );
}
