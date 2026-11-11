// Builds the Anki-style drill deck (docs/DRILL.md, D78) from the separate word-bank repo.
//
//   npx tsx scripts/drill/build-deck.ts [--wordbank <korean-public dir>] [--out <deck.json>]
//
// Inputs (read only; korean-public is never modified):
//   <wordbank>/wordbank/wordbank.csv              10,878 words, already in deck order (tier, then frequency = id order)
//   <wordbank>/wordbank/content/tier*/*.jsonl     original glosses + example sentences (tier 1 today)
//   <wordbank>/private/sense_hints.json           short English equivalents per id from 한국어기초사전 (CC BY-SA 2.0 KR)
//
// Output: packages/content/drill/deck.json. Deterministic: the same inputs give byte-identical output.
// A word with original content uses it (gloss_source "original", first example). Every other word
// gets a short dictionary gloss (gloss_source "krdict") and no example. KRDict definitions and
// example sentences are never copied. Rebuild whenever more tiers get original content.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const GLOSS_CAP = 60;
export const KRDICT_CREDIT = 'English glosses for some words: 국립국어원 한국어기초사전 (CC BY-SA 2.0 KR)';

export interface DeckWord {
  id: string;
  headword: string;
  homonym: number;
  pos: string;
  /** Hanja or source-language spelling (教育, bus); '' for native words. */
  origin: string;
  tier: number;
  tier_label: string;
  freq_rank: number;
  gloss: string;
  gloss_source: 'original' | 'krdict';
  example?: { ko: string; en: string };
}

export interface DeckFile {
  format: 1;
  /** sha256 of the canonical words JSON (first 16 hex). */
  version: string;
  credit: string;
  count: number;
  tiers: { tier: number; label: string; count: number; first: string; last: string }[];
  words: DeckWord[];
}

/** Minimal RFC 4180 CSV parser (quoted fields, doubled quotes, CRLF or LF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let f = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f); f = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}

/**
 * Dictionary gloss: the unique short equivalents (split on ";", compared case-insensitively),
 * joined with "; " while the result stays within `cap` characters. A first equivalent that is
 * longer than the cap alone is cut at a word boundary with "…".
 */
export function joinHints(values: readonly string[], cap = GLOSS_CAP): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const split = v.split(';');
    for (let i = 0; i < split.length; i++) {
      const t = split[i]!.trim().replace(/\s+/g, ' ');
      if (!t || seen.has(t.toLowerCase())) continue;
      // The hints file stores values cut at 60 characters, so a long last part may be cut mid-word.
      if (sentenceLike(t, v.length >= 59 && i === split.length - 1)) continue;
      seen.add(t.toLowerCase());
      parts.push(t);
    }
  }
  let out = '';
  for (const p of parts) {
    const next = out ? `${out}; ${p}` : p;
    if (next.length > cap) {
      if (!out) {
        const cut = p.slice(0, cap - 1);
        const sp = cut.lastIndexOf(' ');
        out = `${(sp > cap / 2 ? cut.slice(0, sp) : cut).replace(/[\s,;]+$/, '')}…`;
      }
      break;
    }
    out = next;
  }
  return out;
}

const SMALL_WORDS = new Set(['of', 'and', 'the', 'for', 'to', 'in', 'on', 'a', 'an']);

/**
 * True for hint parts that are proverbs or idiom translations rather than equivalents of the
 * word itself ("A rolling stone gathers no moss", "One's tears spin"), and for phrases the
 * hints file truncated. Dropping them can leave a word without a gloss; the card then says so.
 */
export function sentenceLike(part: string, maybeTruncated: boolean): boolean {
  const words = part.split(' ');
  if (words.length >= 7) return true;
  if (maybeTruncated) return true;
  const titleCase = words.every((w) => SMALL_WORDS.has(w) || /^[A-Z0-9(]/.test(w));
  return /^[A-Z]/.test(part) && words.length >= 3 && !titleCase;
}

interface Original { gloss: string; example?: { ko: string; en: string } }

function readOriginals(contentDir: string): Map<string, Original> {
  const out = new Map<string, Original>();
  if (!existsSync(contentDir)) return out;
  for (const tierDir of readdirSync(contentDir).sort()) {
    const dir = join(contentDir, tierDir);
    let files: string[];
    try { files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort(); } catch { continue; }
    for (const f of files) {
      for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
        if (!line.trim()) continue;
        const o = JSON.parse(line) as { id: string; gloss?: string; examples?: { ko: string; en: string }[] };
        if (!o.id || !o.gloss) continue;
        const ex = o.examples?.find((e) => e.ko && e.en);
        out.set(o.id, { gloss: o.gloss.trim(), ...(ex ? { example: { ko: ex.ko.trim(), en: ex.en.trim() } } : {}) });
      }
    }
  }
  return out;
}

export function buildDeck(wordbankDir: string): DeckFile {
  const csv = parseCsv(readFileSync(join(wordbankDir, 'wordbank/wordbank.csv'), 'utf8'));
  const head = csv[0]!;
  const col = (name: string) => { const i = head.indexOf(name); if (i < 0) throw new Error(`wordbank.csv: no ${name} column`); return i; };
  const C = {
    id: col('id'), headword: col('headword'), homonym: col('homonym'), pos: col('pos'), origin: col('origin'),
    tier: col('tier'), tier_label: col('tier_label'), freq_rank: col('freq_rank'),
  };
  const originals = readOriginals(join(wordbankDir, 'wordbank/content'));
  const hints = JSON.parse(readFileSync(join(wordbankDir, 'private/sense_hints.json'), 'utf8')) as Record<string, string[]>;

  const words: DeckWord[] = csv.slice(1).map((r) => {
    const id = r[C.id]!;
    const orig = originals.get(id);
    const w: DeckWord = {
      id, headword: r[C.headword]!, homonym: Number(r[C.homonym]) || 0, pos: r[C.pos]!, origin: r[C.origin] ?? '',
      tier: Number(r[C.tier]), tier_label: r[C.tier_label]!, freq_rank: Number(r[C.freq_rank]) || 0,
      gloss: orig ? orig.gloss : joinHints(hints[id] ?? []),
      gloss_source: orig ? 'original' : 'krdict',
    };
    if (orig?.example) w.example = orig.example;
    return w;
  });
  words.sort((a, b) => a.tier - b.tier || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return finishDeck(words);
}

/** Tier ranges + version for a list of words already in deck order (also used for fixture decks). */
export function finishDeck(words: DeckWord[]): DeckFile {
  for (let i = 1; i < words.length; i++) {
    const a = words[i - 1]!, b = words[i]!;
    if (!(a.id < b.id) || a.tier > b.tier) throw new Error(`deck order: ${a.id} (tier ${a.tier}) before ${b.id} (tier ${b.tier}); ids must rise with tier`);
  }
  const tiers: DeckFile['tiers'] = [];
  for (const w of words) {
    const t = tiers[tiers.length - 1];
    if (t && t.tier === w.tier) { t.count++; t.last = w.id; } else tiers.push({ tier: w.tier, label: w.tier_label, count: 1, first: w.id, last: w.id });
  }
  const version = createHash('sha256').update(JSON.stringify(words)).digest('hex').slice(0, 16);
  return { format: 1, version, credit: KRDICT_CREDIT, count: words.length, tiers, words };
}

/** One word per line keeps diffs readable when a tier gets original content. */
export function serializeDeck(d: DeckFile): string {
  const { words, ...rest } = d;
  const headJson = JSON.stringify(rest);
  return `${headJson.slice(0, -1)},"words":[\n${words.map((w) => JSON.stringify(w)).join(',\n')}\n]}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? resolve(args[i + 1]!) : d; };
  const wb = arg('--wordbank', resolve(ROOT, '../korean-public'));
  const out = arg('--out', join(ROOT, 'packages/content/drill/deck.json'));
  const deck = buildDeck(wb);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, serializeDeck(deck));
  const orig = deck.words.filter((w) => w.gloss_source === 'original').length;
  const empty = deck.words.filter((w) => !w.gloss).length;
  console.log(`deck ${deck.version}: ${deck.count} words → ${out}`);
  console.log(`  glosses: ${orig} original, ${deck.count - orig} krdict${empty ? ` (${empty} empty)` : ''}; ${deck.words.filter((w) => w.example).length} with an example`);
  for (const t of deck.tiers) console.log(`  tier ${t.tier} ${t.label}: ${t.count} (${t.first}–${t.last})`);
}
