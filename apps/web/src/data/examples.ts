// Dictionary example sentences (한국어기초사전, 국립국어원, CC BY-SA 2.0 KR) from examples.json.
// Optional: the build copies the file into dist when it exists. It is fetched lazily after
// start-up, kept in memory and validated defensively; anything missing or malformed simply
// means "no dictionary examples". Original examples are always shown.
import type { DictExample } from '@ksrs/srs-engine';

export interface ExamplesSource { name: string; publisher: string; license: string; licenseUrl: string; url: string; snapshot?: string }
export interface ExamplesData { source: ExamplesSource; items: Map<string, DictExample[]> }

export const DEFAULT_SOURCE: ExamplesSource = Object.freeze({
  name: '한국어기초사전', publisher: '국립국어원', license: 'CC BY-SA 2.0 KR',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/2.0/kr/', url: 'https://krdict.korean.go.kr/',
});
/** Short credit line under a dictionary example. */
export const CREDIT_TEXT = '한국어기초사전 (국립국어원) · CC BY-SA';

const MAX_LEN = 1000;
const MAX_PER_ITEM = 50;
const isStr = (v: unknown, max = MAX_LEN): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const isHttp = (v: unknown): v is string => isStr(v, 2048) && /^https?:\/\//i.test(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseEntry(e: unknown): DictExample | null {
  if (!isObj(e)) return null;
  const match = isStr(e.match, 200) ? e.match : undefined;
  if (e.kind === 'sentence') {
    if (!isStr(e.ko)) return null;
    return match ? { kind: 'sentence', ko: e.ko, match } : { kind: 'sentence', ko: e.ko };
  }
  if (e.kind === 'dialogue') {
    if (!Array.isArray(e.lines) || e.lines.length === 0 || e.lines.length > 12 || !e.lines.every((l) => isStr(l))) return null;
    const lines = (e.lines as string[]).slice();
    const out: DictExample = { kind: 'dialogue', lines };
    if (match) out.match = match;
    const ml = e.matchLine;
    if (typeof ml === 'number' && Number.isInteger(ml) && ml >= 0 && ml < lines.length) out.matchLine = ml;
    return out;
  }
  return null;
}

/**
 * Validates an examples.json payload (format 1). Returns null when the top level is unusable;
 * otherwise drops individual bad entries (and items left empty) and keeps the rest. Source
 * fields fall back to the 한국어기초사전 defaults; URLs must be http(s).
 */
export function parseExamplesFile(raw: unknown): ExamplesData | null {
  if (!isObj(raw) || raw.format !== 1 || !isObj(raw.items)) return null;
  const s = isObj(raw.source) ? raw.source : {};
  const source: ExamplesSource = {
    name: isStr(s.name, 200) ? s.name : DEFAULT_SOURCE.name,
    publisher: isStr(s.publisher, 200) ? s.publisher : DEFAULT_SOURCE.publisher,
    license: isStr(s.license, 200) ? s.license : DEFAULT_SOURCE.license,
    licenseUrl: isHttp(s.licenseUrl) ? s.licenseUrl : DEFAULT_SOURCE.licenseUrl,
    url: isHttp(s.url) ? s.url : DEFAULT_SOURCE.url,
  };
  if (isStr(s.snapshot, 40)) source.snapshot = s.snapshot;
  const items = new Map<string, DictExample[]>();
  for (const [id, list] of Object.entries(raw.items)) {
    if (!id || !Array.isArray(list)) continue;
    const ok = list.slice(0, MAX_PER_ITEM).map(parseEntry).filter((x): x is DictExample => x !== null);
    if (ok.length) items.set(id, ok);
  }
  return { source, items };
}

/** KRDict search page for a word (the credit link under each dictionary example). */
export function krdictSearchUrl(word: string): string {
  return `https://krdict.korean.go.kr/dicSearch/search?mainSearchWord=${encodeURIComponent(word)}`;
}

/** Text a dictionary example reads aloud / is identified by. Dialogues drop the 가:/나: speaker tags. */
export function dictExampleText(e: DictExample): string {
  return e.kind === 'sentence' ? e.ko : e.lines.map(stripSpeaker).join(' ');
}
export const stripSpeaker = (line: string): string => line.replace(/^\s*[가-힣A-Za-z]{1,3}\s*[:：]\s*/, '');

// ------------------------------------------------------------------ highlighting

export interface Segment { text: string; hit: boolean }

/** Splits `text` around the first occurrence of `match`. No match (or no `match`) → one plain segment. */
export function highlight(text: string, match: string | undefined): Segment[] {
  const m = match?.trim();
  const i = m ? text.indexOf(m) : -1;
  if (!m || i < 0) return [{ text, hit: false }];
  const out: Segment[] = [];
  if (i > 0) out.push({ text: text.slice(0, i), hit: false });
  out.push({ text: m, hit: true });
  if (i + m.length < text.length) out.push({ text: text.slice(i + m.length), hit: false });
  return out;
}

/**
 * What to highlight in an original example: the headword if it occurs as is, else its stem,
 * shortened from the end (conjugation changes the last syllables: 얼버무리다 → 얼버무렸다 → "얼버무")
 * but never below half the headword (so 결재 can't degrade to a bare 결).
 */
export function headwordMatch(text: string, headword: string): string | undefined {
  const w = headword.trim();
  if (!w) return undefined;
  if (text.includes(w)) return w;
  const chars = [...w];
  const min = chars.length >= 3 ? Math.ceil(chars.length / 2) : chars.length;
  for (let n = chars.length - 1; n >= min; n--) {
    const cand = chars.slice(0, n).join('').trimEnd();
    if (cand && text.includes(cand)) return cand;
  }
  return undefined;
}

// ------------------------------------------------------------------ store

type L = () => void;
const listeners = new Set<L>();
let data: ExamplesData | null = null;
let started: Promise<void> | null = null;

export const examplesStore = {
  subscribe(l: L): () => void { listeners.add(l); return () => { listeners.delete(l); }; },
  get(): ExamplesData | null { return data; },
  /** Test seam. */
  set(next: ExamplesData | null): void { data = next; for (const l of listeners) l(); },
  /** Test seam: forget the data and allow another load. */
  reset(): void { started = null; examplesStore.set(null); },
};

/** Fetches examples.json once. Never throws: absent, offline or malformed → no dictionary examples. */
export function loadExamples(fetchJson: () => Promise<unknown> = defaultFetch): Promise<void> {
  if (!started) {
    started = (async () => {
      try {
        const parsed = parseExamplesFile(await fetchJson());
        if (parsed) examplesStore.set(parsed);
      } catch { /* optional file */ }
    })();
  }
  return started;
}

async function defaultFetch(): Promise<unknown> {
  const res = await fetch(new URL('examples.json', document.baseURI).href);
  if (!res.ok) return null;
  return res.json();
}

/** Starts the lazy load once the browser is idle after first paint. */
export function scheduleExamplesLoad(): void {
  const go = () => { void loadExamples(); };
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(go, { timeout: 2000 });
  else setTimeout(go, 300);
}
