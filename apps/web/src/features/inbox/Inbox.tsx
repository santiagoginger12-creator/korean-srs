// Variants inbox (§8.4, D11): leniently accepted register/cloze answers awaiting curation.
// Promote = userAnswer.add (accepted from now on); Dismiss = append to settings `inbox.dismissed`.
import type { ClozePrompt, RegisterPrompt } from '@ksrs/content';
import { headword } from '@ksrs/srs-engine';
import { itemHref, localDateTime, QTYPE_LABEL, SPEECH_LEVEL } from '../../state/format.ts';
import { useApp } from '../../state/hooks.ts';
import { dismissedList, inboxEntries, promotedAnswer, settingPayload, type InboxEntry } from '../../data/contract.ts';
import { store } from '../../state/store.ts';

export function Inbox(): JSX.Element {
  const app = useApp();
  const d = app.derived!;
  const entries = inboxEntries(d, app.events);
  // Dismissing hides every entry with the same (item, qtype, normalized response).
  const dismiss = (e: InboxEntry) => store.emit([settingPayload('inbox.dismissed', [...dismissedList(d), e.eventId])]);
  // Promoted answers are user answers from then on, so the inbox drops them by itself. Stored
  // in the checker's normal form, so the same answer grades exact next time.
  const promote = (e: InboxEntry) => store.emit([{ type: 'userAnswer.add', itemId: e.itemId, qtype: e.qtype, answer: promotedAnswer(e.response) }]);
  return (
    <div className="page narrow inbox" data-testid="inbox-page">
      <p><a className="btn-text" href="#/">← Home</a></p>
      <h1>Variants inbox</h1>
      <p className="muted">Answers accepted as close-enough variants. Promote the good ones so they count as exact from now on; dismiss the rest.</p>
      {entries.length === 0 ? <p className="empty" data-testid="inbox-empty">Nothing to review.</p> : (
        <ul className="inbox-list">
          {entries.map((e) => {
            const it = d.index.byId.get(e.itemId);
            const prompts = it && it.kind !== 'hanja' ? (it.questions?.[e.qtype as 'cloze' | 'register'] as (ClozePrompt | RegisterPrompt)[] | undefined) : undefined;
            const p = Array.isArray(prompts) ? prompts.find((x) => x.id === e.promptId) : undefined;
            return (
              <li key={e.eventId} className="card" data-testid="inbox-row" data-event-id={e.eventId}>
                <p className="small muted"><a className={`item-link k-${it?.kind ?? 'vocab'}`} href={itemHref(e.itemId)} lang="ko" data-testid="inbox-item">{(it && headword(it)) || e.itemId}</a> · {QTYPE_LABEL[e.qtype]} · {localDateTime(e.at)}</p>
                {p && 'sentence' in p && <p lang="ko">{p.sentence.replace('{{}}', '＿＿')} <span className="cue" lang="ko">{p.cue}</span></p>}
                {p && 'source' in p && <p lang="ko">{p.source} <span className="muted small">→ {SPEECH_LEVEL[p.to]?.ko ?? p.to}</span></p>}
                <dl className="kv">
                  <dt>You wrote</dt><dd lang="ko" data-testid="inbox-response">{e.response}</dd>
                  {e.matched && <><dt>Closest accepted</dt><dd lang="ko">{e.matched}</dd></>}
                </dl>
                <div className="row">
                  <button type="button" className="btn btn-primary btn-small" onClick={() => void promote(e)} data-testid="promote">Promote</button>
                  <button type="button" className="btn btn-quiet btn-small" onClick={() => void dismiss(e)} data-testid="dismiss">Dismiss</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
