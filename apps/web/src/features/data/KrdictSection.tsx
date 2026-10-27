// KRDict (한국어기초사전) import (§9.5). The API key lives in the IndexedDB `secrets` store and is
// never exported. The Open API usually isn't CORS-enabled, so a direct browser fetch is tried
// first and the fallbacks are: paste the XML response, or upload a downloaded KRDict file.
// KRDict-derived items are custom items (events) only; they never enter the public repo.
import { useEffect, useState, type ChangeEvent } from 'react';
import type { Item, VocabItem } from '@ksrs/content';
import { importItems, krdictToVocab, parseKrdict, senseView, type KrdictSense } from '../../data/contract.ts';
import { itemHref } from '../../state/format.ts';
import { useApp } from '../../state/hooks.ts';
import { now } from '../../state/clock.ts';
import { store } from '../../state/store.ts';

export const KRDICT_KEY = 'krdict.apiKey';
export const krdictSearchUrl = (key: string, q: string): string =>
  `https://krdict.korean.go.kr/api/search?key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}&translated=y&trans_lang=1&part=word&sort=dict`;

interface Draft { item: VocabItem; meanings: string; examples: string; level: number }

export function KrdictSection(): JSX.Element {
  const app = useApp();
  const [key, setKey] = useState('');
  const [keySaved, setKeySaved] = useState(false);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<{ kind: 'info' | 'error' | 'ok'; text: string } | null>(null);
  const [corsBlocked, setCorsBlocked] = useState(false);
  const [xml, setXml] = useState('');
  const [senses, setSenses] = useState<KrdictSense[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => { void store.getSecret(KRDICT_KEY).then((k) => { if (k) { setKey(k); setKeySaved(true); } }); }, []);

  const loadXml = (text: string, origin: string) => {
    // parseKrdict reads API search/view XML, the downloadable LMF XML and JSON, and surfaces
    // API error messages (e.g. an invalid key) instead of returning nothing.
    const r = parseKrdict(text);
    setSenses(r.senses);
    setDraft(null);
    if (r.error) setStatus({ kind: 'error', text: `KRDict: ${r.error}` });
    else setStatus(r.senses.length ? { kind: 'ok', text: `${r.senses.length} sense${r.senses.length === 1 ? '' : 's'} from ${origin}.` } : { kind: 'info', text: `No entries found in ${origin}.` });
  };

  const search = async () => {
    if (!q.trim()) return;
    setStatus({ kind: 'info', text: 'Searching…' }); setCorsBlocked(false);
    try {
      const res = await fetch(krdictSearchUrl(key, q.trim()), { mode: 'cors' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      loadXml(await res.text(), 'KRDict');
    } catch {
      // A TypeError here is almost always CORS (the API doesn't send Access-Control-Allow-Origin).
      setCorsBlocked(true);
      setStatus({ kind: 'info', text: 'The browser blocked the direct request (KRDict doesn\'t allow cross-site requests). Use one of the options below instead.' });
    }
  };

  const pick = (s: KrdictSense) => {
    const opts = { level: app.derived?.userLevel ?? 1, retrievedAt: new Date(now()).toISOString() };
    let item = krdictToVocab(s, opts);
    // QA: a dictionary draft must never overwrite a different item (a built-in one with its
    // curated examples and prompts, or another sense saved earlier). Reuse an id only when it
    // holds this same KRDict sense; otherwise take the next free `:2`, `:3`… (as CSV does).
    const byId = app.derived?.index.byId;
    if (byId) {
      const sameSense = (it: Item | undefined) => it?.kind === 'vocab' && it.source?.kind === 'krdict'
        && it.source.krdictTargetCode === s.targetCode && (it.questions?.production?.contextHint ?? '') === s.definitionKo.trim();
      let id = item.id;
      for (let n = 2; byId.has(id) && !sameSense(byId.get(id)); n++) id = `${item.id}:${n}`;
      if (id !== item.id) item = krdictToVocab(s, { ...opts, idHint: id });
    }
    setDraft({ item, level: item.level, meanings: (item.meanings ?? []).join('\n'), examples: (item.examples ?? []).map((e) => `${e.ko} | ${e.en}`).join('\n') });
  };

  const save = async () => {
    if (!draft) return;
    const meanings = draft.meanings.split('\n').map((m) => m.trim()).filter(Boolean);
    const examples = draft.examples.split('\n').map((l) => l.split('|').map((x) => x.trim())).filter(([ko]) => !!ko).map(([ko, en]) => ({ ko: ko!, en: en ?? '' }));
    const prevMeaning = draft.item.questions?.meaning;
    const item: VocabItem = {
      ...draft.item, level: Math.max(1, Math.round(draft.level)), meanings, examples,
      questions: { ...draft.item.questions, ...(prevMeaning ? { meaning: { ...prevMeaning, accepted: meanings.length ? meanings : prevMeaning.accepted } } : {}) },
    };
    // Validate the edited draft exactly like a JSON import before saving it.
    const d = app.derived!;
    const r = importItems([item], { existing: new Map(d.index.byId), defaultSource: item.source });
    const errs = r.issues.filter((i) => i.severity === 'error');
    if (errs.length || !r.items[0]) {
      setStatus({ kind: 'error', text: `Can't save yet: ${errs.map((i) => `${i.path} ${i.msg}`).join('; ') || 'invalid item'}` });
      return;
    }
    await store.emit([{ type: 'customItem.upsert', item: r.items[0] }]);
    setStatus({ kind: 'ok', text: `Saved ${item.word} as a custom item (needs review).` });
    setDraft(null);
  };

  const fileInput = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) loadXml(await f.text(), f.name);
  };

  return (
    <section className="card form" data-testid="krdict-card">
      <h3>KRDict (한국어기초사전)</h3>
      <p className="muted small">Content from the National Institute of Korean Language, CC BY-SA 2.0 KR. Imported words stay on your devices and are marked "needs review".</p>
      <label className="field"><span>API key {keySaved && <span className="muted">· saved on this device only, never backed up</span>}</span>
        <div className="row">
          <input type="password" value={key} onChange={(e: { target: HTMLInputElement }) => { setKey(e.target.value); setKeySaved(false); }} autoComplete="off" data-testid="krdict-key" />
          <button type="button" className="btn btn-quiet btn-small" onClick={() => void store.setSecret(KRDICT_KEY, key.trim()).then(() => setKeySaved(!!key.trim()))} data-testid="krdict-save-key">Save key</button>
        </div>
      </label>
      <div className="row">
        <input type="search" lang="ko" placeholder="단어 검색" onInput={(e: { currentTarget: HTMLInputElement }) => setQ(e.currentTarget.value)} data-testid="krdict-q" />
        <button type="button" className="btn btn-primary btn-small" onClick={() => void search()} disabled={!key.trim() || !q.trim()} data-testid="krdict-search">Search</button>
      </div>
      {status && <p className={status.kind === 'error' ? 'error-text' : status.kind === 'ok' ? 'ok-text' : 'muted'} role="status" data-testid="krdict-status">{status.text}</p>}
      {/* Always available: pasting/uploading is the usual path (CORS), including for a second word. */}
      {(
        <details className="fallback" open={corsBlocked} data-testid="krdict-fallback">
          <summary>Paste or upload a KRDict response</summary>
          {key.trim() && q.trim() && <p className="small">1. <a href={krdictSearchUrl(key.trim(), q.trim())} target="_blank" rel="noopener noreferrer">Open the API result in a new tab</a>, select all, copy.</p>}
          <textarea rows={4} placeholder="<channel>…</channel>" value={xml} onChange={(e: { target: HTMLTextAreaElement }) => setXml(e.target.value)} data-testid="krdict-xml" />
          <div className="row">
            <button type="button" className="btn btn-quiet btn-small" onClick={() => loadXml(xml, 'pasted XML')} disabled={!xml.trim()} data-testid="krdict-parse">Read pasted XML</button>
            <label className="btn-text file-btn">or upload a KRDict XML file<input type="file" accept=".xml,text/xml,application/xml" onChange={(e: ChangeEvent<HTMLInputElement>) => void fileInput(e)} /></label>
          </div>
        </details>
      )}
      {senses.length > 0 && !draft && (
        <ul className="senses" data-testid="krdict-senses">
          {senses.map((s, i) => {
            const v = senseView(s);
            return (
              <li key={i}>
                <button type="button" className="sense" onClick={() => pick(s)}>
                  <span className="sense-word" lang="ko">{v.word}{v.sup ? <sup>{v.sup}</sup> : null}</span> <span className="muted small">{v.pos}</span>
                  <span className="sense-def" lang="ko">{v.definitionKo}</span>
                  {v.en && <span className="sense-en">{v.en}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {draft && (
        <div className="preview" data-testid="krdict-draft">
          <p><strong lang="ko">{draft.item.word}</strong> <code data-testid="krdict-draft-id">{draft.item.id}</code>{' '}
            {app.derived?.index.byId.has(draft.item.id)
              ? <span className="warn-text small" data-testid="krdict-clash">· updates the copy of this sense you saved before</span>
              : (() => {
                  const base = draft.item.id.replace(/:\d+$/, '');
                  return base !== draft.item.id && app.derived?.index.byId.has(base)
                    ? <span className="muted small" data-testid="krdict-clash">· <a href={itemHref(base)}>{draft.item.word}</a> is already in your deck; this sense is added as a separate item</span>
                    : null;
                })()}
          </p>
          <label className="field"><span>Level</span>
            <input type="number" min={1} max={99} value={draft.level} onChange={(e: { target: HTMLInputElement }) => setDraft({ ...draft, level: Number(e.target.value) || 1 })} data-testid="krdict-level" />
          </label>
          <label className="field"><span>Meanings (one per line; also accepted answers)</span>
            <textarea rows={3} value={draft.meanings} onChange={(e: { target: HTMLTextAreaElement }) => setDraft({ ...draft, meanings: e.target.value })} data-testid="krdict-meanings" />
          </label>
          <label className="field"><span>Examples (한국어 | English, one per line)</span>
            <textarea rows={3} lang="ko" value={draft.examples} onChange={(e: { target: HTMLTextAreaElement }) => setDraft({ ...draft, examples: e.target.value })} />
          </label>
          <p className="attribution small">{draft.item.source?.attribution} · {draft.item.source?.license}</p>
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={() => void save()} data-testid="krdict-add">Add as custom item</button>
            <button type="button" className="btn-text" onClick={() => setDraft(null)}>Back</button>
          </div>
        </div>
      )}
    </section>
  );
}
