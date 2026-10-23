// Text normalization for Korean and English answers (ARCHITECTURE.md §8.1).
import { fromJamo, isCompatJamo, isSyllable } from './jamo.ts';

const ZERO_WIDTH = /[​-‍⁠﻿­]/g;
const FINAL_PUNCT = /[.!?~…。！？～]+$/u;

// Leftover conjoining jamo (U+1100 block) that NFC could not compose → compatibility jamo.
const CHO_COMPAT = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JUNG_COMPAT = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const JONG_COMPAT = 'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ';
function conjoiningToCompat(ch: string): string {
  const c = ch.codePointAt(0) as number;
  if (c >= 0x1100 && c <= 0x1112) return CHO_COMPAT[c - 0x1100] as string;
  if (c >= 0x1161 && c <= 0x1175) return JUNG_COMPAT[c - 0x1161] as string;
  if (c >= 0x11a8 && c <= 0x11c2) return JONG_COMPAT[c - 0x11a8] as string;
  // Halfwidth Hangul (U+FFA1–U+FFDC) maps 1:1 onto U+3131… with gaps; NFKC handles it.
  if (c >= 0xffa0 && c <= 0xffdc) return ch.normalize('NFKC').replace(/[ᄀ-ᇿ]/g, conjoiningToCompat);
  return ch;
}

/** Shared cleanup: NFC, width, quotes, ellipsis, zero-width, whitespace. */
export function basicClean(s: string): string {
  let t = s.normalize('NFC');
  t = t.replace(ZERO_WIDTH, '');
  // Full-width ASCII → ASCII, ideographic space → space.
  t = t.replace(/[！-～]/g, (ch) => String.fromCharCode((ch.charCodeAt(0) as number) - 0xfee0));
  t = t.replace(/[　  -   ]/g, ' ');
  t = t.replace(/[‘’‚‛′]/g, "'").replace(/[“”„‟″]/g, '"');
  t = t.replace(/…/g, '...');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

const HANJA_RUN = /[㐀-䶿一-鿿豈-﫿]/u;

export interface NormalizeKoOptions { stripFinalPunct?: boolean }

/**
 * Korean normalization (§8.1). Additionally:
 * - leftover conjoining jamo become compatibility jamo, and any run of Hangul that
 *   contains compatibility jamo is re-assembled as a dubeolsik IME would
 *   (so "가ㅂ니다" from an interrupted composition becomes "갑니다");
 * - a parenthesized Hanja gloss such as "결제(決濟)" is dropped.
 */
export function normalizeKo(s: string, o: NormalizeKoOptions = {}): string {
  let t = basicClean(s);
  t = t.replace(/[ᄀ-ᇿﾠ-ￜ]/g, conjoiningToCompat).normalize('NFC');
  t = t.replace(/\s*[(（]([^()（）]*)[)）]/g, (m, inner: string) =>
    inner.length > 0 && [...inner].every((ch) => HANJA_RUN.test(ch) || ch === ' ') ? '' : m);
  t = t.replace(/[ㄱ-ㅣ가-힣]+/g, (run) =>
    [...run].some(isCompatJamo) ? fromJamo(run) : run);
  if (o.stripFinalPunct) t = t.replace(FINAL_PUNCT, '');
  return t.replace(/\s+/g, ' ').trim();
}

/** Spacing- and inner-punctuation-insensitive comparison key (layer 4). */
export function looseKoKey(s: string): string {
  return s.replace(/[\s.,!?~;:"'·…。、，！？～]/gu, '');
}

const US_UK: Record<string, string> = {
  colour: 'color', favour: 'favor', favourite: 'favorite', behaviour: 'behavior', honour: 'honor',
  neighbour: 'neighbor', labour: 'labor', humour: 'humor', rumour: 'rumor', harbour: 'harbor',
  organise: 'organize', realise: 'realize', recognise: 'recognize', apologise: 'apologize',
  criticise: 'criticize', emphasise: 'emphasize', analyse: 'analyze', paralyse: 'paralyze',
  centre: 'center', theatre: 'theater', metre: 'meter', litre: 'liter', fibre: 'fiber',
  travelled: 'traveled', travelling: 'traveling', cancelled: 'canceled', cancelling: 'canceling',
  grey: 'gray', judgement: 'judgment', defence: 'defense', offence: 'offense', licence: 'license',
  catalogue: 'catalog', dialogue: 'dialog', programme: 'program', practise: 'practice', cheque: 'check',
};

/**
 * English normalization (§8.1): lowercase, strip parentheticals, strip articles
 * and a leading "to ", strip punctuation, collapse spaces, US/UK spelling map.
 */
export function normalizeEn(s: string): string {
  let t = basicClean(s).toLowerCase();
  for (let prev = ''; prev !== t;) { prev = t; t = t.replace(/\([^()]*\)|\[[^[\]]*\]/g, ' '); }
  t = t.replace(/[-‐‑–—_/]/g, ' ');
  t = t.replace(/[^\p{L}\p{N}\s]/gu, '');
  t = t.replace(/\s+/g, ' ').trim();
  const words = t.split(' ').filter((w) => w !== '' && w !== 'a' && w !== 'an' && w !== 'the');
  if (words.length > 1 && words[0] === 'to') words.shift();
  return words.map((w) => US_UK[w] ?? w).join(' ');
}

/** Split an English accepted entry into its slash/semicolon alternatives. */
export function enAlternatives(entry: string): string[] {
  // Keep slashes that sit inside parentheses (they are stripped anyway).
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of entry) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === '/' || ch === ';')) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter((x) => x !== '');
}

export const hasHangul = (s: string): boolean => [...s].some((ch) => isSyllable(ch) || isCompatJamo(ch));
export const hasLatin = (s: string): boolean => /[A-Za-z]/.test(s);
export const hasHanja = (s: string): boolean => HANJA_RUN.test(s);
