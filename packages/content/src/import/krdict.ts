// KRDict (한국어기초사전) import (§9.5). Pure: a small tolerant XML reader instead of DOMParser.
//
// Supported inputs:
//  1. Open API search responses (`/api/search?...&translated=y&trans_lang=1`):
//     <channel><item><target_code/><word/><sup_no/><pos/><link/><sense><sense_order/><definition/>
//       <translation><trans_lang/><trans_word/><trans_dfn/></translation></sense></item></channel>
//  2. Open API view responses: the same, nested in <word_info> … <sense_info>.
//  3. The downloadable dictionary (LMF XML): <LexicalEntry att="id" val="…"><feat att="partOfSpeech" val="…"/>
//       <Lemma><feat att="writtenForm" val="…"/></Lemma><Sense><feat att="definition" val="…"/>
//       <Equivalent><feat att="language" val="영어"/><feat att="lemma" val="…"/><feat att="definition" val="…"/></Equivalent></Sense></LexicalEntry>
//  4. JSON with either shape (objects → elements, arrays → repeated elements, {att, val} → attributes).

import type { VocabItem } from '../schema/types.ts';
import { idSlug } from './pipeline.ts';

export interface KrdictSense {
  targetCode: number; word: string; pos: string; definitionKo: string;
  transWord?: string; transDfn?: string; url?: string;
  /** Additions: homonym number, sense order, 원어 (e.g. 決定), 어휘 등급 (초급/중급/고급). */
  supNo?: number; senseOrder?: number; origin?: string; wordGrade?: string;
}

export const KRDICT_SOURCE = {
  kind: 'krdict', license: 'CC-BY-SA-2.0-KR', attribution: '한국어기초사전 (국립국어원)',
} as const;

export const krdictUrl = (targetCode: number): string =>
  `https://krdict.korean.go.kr/dicSearch/SearchView?ParaWordNo=${targetCode}`;

// ---------------------------------------------------------------------------
// Tolerant XML reader

export interface XNode { name: string; attrs: Record<string, string>; children: XNode[]; text: string }

const NAMED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

const localName = (n: string) => n.slice(n.lastIndexOf(':') + 1).toLowerCase();

/** Parses XML into a node tree under a synthetic `#root`. Never throws; malformed input degrades. */
export function parseXml(xml: string): XNode {
  const root: XNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XNode[] = [root];
  const top = () => stack[stack.length - 1]!;
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) { top().text += decodeEntities(xml.slice(i)); break; }
    if (lt > i) top().text += decodeEntities(xml.slice(i, lt));
    if (xml.startsWith('<!--', lt)) { const e = xml.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
    if (xml.startsWith('<![CDATA[', lt)) {
      const e = xml.indexOf(']]>', lt + 9);
      top().text += xml.slice(lt + 9, e < 0 ? n : e);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (xml.startsWith('<?', lt)) { const e = xml.indexOf('?>', lt + 2); i = e < 0 ? n : e + 2; continue; }
    if (xml.startsWith('<!', lt)) { const e = xml.indexOf('>', lt + 2); i = e < 0 ? n : e + 1; continue; }
    // Find the tag end, skipping quoted attribute values.
    let j = lt + 1;
    let q: string | null = null;
    for (; j < n; j++) {
      const ch = xml[j]!;
      if (q) { if (ch === q) q = null; } else if (ch === '"' || ch === "'") q = ch; else if (ch === '>') break;
    }
    const body = xml.slice(lt + 1, j);
    i = j + 1;
    if (body.startsWith('/')) {
      const name = localName(body.slice(1).trim());
      const at = stack.map((s) => s.name).lastIndexOf(name);
      if (at > 0) stack.length = at; // pops unclosed children too; a stray end tag is ignored
      continue;
    }
    const m = /^([^\s/>]+)/.exec(body);
    if (!m) { top().text += decodeEntities('<' + body + (j < n ? '>' : '')); continue; }
    const node: XNode = { name: localName(m[1]!), attrs: {}, children: [], text: '' };
    for (const a of body.slice(m[1]!.length).matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      node.attrs[localName(a[1]!)] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '');
    }
    top().children.push(node);
    if (!body.trimEnd().endsWith('/')) stack.push(node);
  }
  return root;
}

/** JSON → the same node tree (keys → elements, arrays → repeated elements, primitives → attrs + text children). */
export function jsonToNode(v: unknown, name = '#root'): XNode {
  const node: XNode = { name: name.toLowerCase(), attrs: {}, children: [], text: '' };
  if (v === null || v === undefined) return node;
  if (typeof v !== 'object') { node.text = String(v); return node; }
  if (Array.isArray(v)) { for (const x of v) node.children.push(jsonToNode(x, name === '#root' ? 'item' : name)); return node; }
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (x !== null && typeof x !== 'object') node.attrs[k.toLowerCase()] = String(x);
    if (Array.isArray(x)) for (const el of x) node.children.push(jsonToNode(el, k));
    else node.children.push(jsonToNode(x, k));
  }
  return node;
}

const kids = (n: XNode, ...names: string[]) => n.children.filter((c) => names.includes(c.name));
const kid = (n: XNode, ...names: string[]) => n.children.find((c) => names.includes(c.name));
const deepText = (n: XNode): string => n.text + n.children.map(deepText).join('');
const txt = (n: XNode | undefined, ...names: string[]) => {
  const k = n && kid(n, ...names);
  return k ? deepText(k).trim() : '';
};
function descendants(n: XNode, name: string, out: XNode[] = []): XNode[] {
  for (const c of n.children) {
    if (c.name === name) out.push(c);
    else descendants(c, name, out);
  }
  return out;
}
/** `<feat att="k" val="v"/>` children (and JSON-ish {att,val}) → { k(lowercased): v }. */
function feats(n: XNode | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of n ? kids(n, 'feat') : []) {
    const k = f.attrs.att;
    if (k !== undefined) out[k.toLowerCase()] = (f.attrs.val ?? deepText(f)).trim();
  }
  return out;
}

const ENGLISH = new Set(['영어', '1', 'english', 'en', 'eng']);
const toInt = (s: string | undefined): number | undefined => {
  if (s === undefined || s.trim() === '') return undefined;
  const v = Number(s.trim());
  return Number.isInteger(v) ? v : undefined;
};
const cleanWord = (w: string) => w.replace(/\^/g, ' ').replace(/\s+/g, ' ').trim();

function fromApi(root: XNode): KrdictSense[] {
  const out: KrdictSense[] = [];
  for (const item of descendants(root, 'item')) {
    const wi = kid(item, 'word_info') ?? item;
    const word = cleanWord(txt(wi, 'word'));
    const targetCode = toInt(txt(item, 'target_code') || txt(wi, 'target_code'));
    if (!word || targetCode === undefined) continue;
    const pos = txt(wi, 'pos');
    const supNo = toInt(txt(wi, 'sup_no'));
    const wordGrade = txt(wi, 'word_grade');
    const origin = txt(wi, 'origin') || txt(kid(wi, 'original_language_info'), 'original_language');
    const url = txt(item, 'link') || txt(wi, 'link') || krdictUrl(targetCode);
    for (const s of kids(wi, 'sense', 'sense_info')) {
      const tr = kids(s, 'translation', 'translation_info');
      const en = tr.find((t) => ENGLISH.has(txt(t, 'trans_lang').toLowerCase())) ?? tr.find((t) => !txt(t, 'trans_lang'));
      out.push(clean({
        targetCode, word, pos, definitionKo: txt(s, 'definition'),
        transWord: txt(en, 'trans_word'), transDfn: txt(en, 'trans_dfn'), url,
        supNo, senseOrder: toInt(txt(s, 'sense_order')), origin, wordGrade,
      }));
    }
  }
  return out;
}

function fromLmf(root: XNode): KrdictSense[] {
  const out: KrdictSense[] = [];
  for (const le of descendants(root, 'lexicalentry')) {
    const f = feats(le);
    const targetCode = toInt(le.attrs.att === 'id' ? le.attrs.val : le.attrs.id ?? le.attrs.val ?? f.id ?? f.target_code);
    const word = cleanWord(feats(kid(le, 'lemma')).writtenform ?? '');
    if (!word || targetCode === undefined) continue;
    let si = 0;
    for (const s of kids(le, 'sense')) {
      si++;
      const sf = feats(s);
      const eq = kids(s, 'equivalent').map(feats).find((e) => ENGLISH.has((e.language ?? '').toLowerCase()));
      out.push(clean({
        targetCode, word, pos: f.partofspeech ?? '', definitionKo: sf.definition ?? '',
        transWord: eq?.lemma, transDfn: eq?.definition, url: krdictUrl(targetCode),
        supNo: toInt(f.homonym_number), senseOrder: toInt(s.attrs.val) ?? si, origin: f.origin, wordGrade: f.vocabularylevel,
      }));
    }
  }
  return out;
}

function clean(s: KrdictSense): KrdictSense {
  const o = s as unknown as Record<string, unknown>;
  for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === '') delete o[k];
  s.pos ??= '';
  s.definitionKo ??= '';
  return s;
}

/** Parses an API response or downloadable entry file (XML or JSON); reports an API error if present. */
export function parseKrdict(text: string): { senses: KrdictSense[]; error?: string } {
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  let root: XNode;
  const trimmed = t.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { root = jsonToNode(JSON.parse(trimmed)); }
    catch { return { senses: [], error: 'not valid JSON' }; }
  } else root = parseXml(t);
  const errNode = descendants(root, 'error')[0];
  const senses = [...fromApi(root), ...fromLmf(root)];
  if (errNode && !senses.length) {
    const code = txt(errNode, 'error_code');
    const msg = txt(errNode, 'message') || deepText(errNode).trim();
    return { senses, error: code ? `KRDict error ${code}: ${msg}` : msg || 'KRDict error' };
  }
  return { senses };
}

export function parseKrdictXml(xml: string): KrdictSense[] {
  return parseKrdict(xml).senses;
}

// ---------------------------------------------------------------------------
// Sense → draft vocab item

const HANJA_RE = /^[㐀-䶿一-鿿豈-﫿]$/u;

/** 원어 "決定" / "決定하다" aligned with 결정 / 결정하다 → hanjaBreakdown (no hanjaId; linking is the caller's job). */
function breakdownFrom(word: string, origin: string | undefined): { syllable: string; hanja: string }[] | undefined {
  if (!origin) return undefined;
  const w = [...word];
  const o = [...origin.replace(/[\s^-]/g, '')];
  const wNoSpace = w.filter((ch) => ch !== ' ');
  if (o.length !== wNoSpace.length) return undefined;
  const out: { syllable: string; hanja: string }[] = [];
  for (let i = 0; i < o.length; i++) {
    if (HANJA_RE.test(o[i]!)) out.push({ syllable: wNoSpace[i]!, hanja: o[i]! });
    else if (o[i] !== wNoSpace[i]) return undefined;
  }
  return out.length ? out : undefined;
}

/**
 * A draft vocab item from one KRDict sense: `needs_review: true`, KRDict attribution, no examples
 * (a validation warning for krdict items; the owner adds them). The Korean definition becomes the
 * production context hint. Draft items do not gate level-ups (`gating: false`).
 */
export function krdictToVocab(s: KrdictSense, opts: { level: number; retrievedAt: string; idHint?: string }): VocabItem {
  const meanings = [...new Set((s.transWord ?? '').split(/[;,]/).map((x) => x.trim()).filter(Boolean))];
  if (!meanings.length && s.transDfn?.trim()) meanings.push(s.transDfn.trim());
  const word = cleanWord(s.word);
  const hb = breakdownFrom(word, s.origin);
  const hint = s.definitionKo.trim();
  return {
    id: opts.idHint?.trim() || `v:${idSlug('vocab', word)}`,
    kind: 'vocab', level: opts.level, track: 'core', rev: 1,
    unlockDeps: [], gating: false,
    source: {
      ...KRDICT_SOURCE, url: s.url ?? krdictUrl(s.targetCode), retrievedAt: opts.retrievedAt, krdictTargetCode: s.targetCode,
    },
    needs_review: true, tags: ['krdict'],
    word, meanings, pos: s.pos.trim() || '미분류', register: 'neutral',
    ...(hb ? { hanjaBreakdown: hb } : {}),
    collocations: [], examples: [],
    questionTypes: ['meaning', 'production'],
    questions: {
      meaning: { accepted: meanings.slice() },
      production: {
        promptEn: meanings.join('; ') || s.transDfn?.trim() || hint || word,
        ...(hint ? { contextHint: hint } : {}),
        accepted: [word],
      },
    },
  };
}
