// Looks (D89): the five aesthetic directions from the design canvas, plus Classic. A look is a
// `data-look` attribute on <html> (palettes and fonts live in styles.css) and an on-demand Google
// Fonts stylesheet. Offline or without the fonts, each look falls back to system fonts.
// The choice is mirrored to localStorage so the next load paints in the right look before the
// event log has been read.
import type { AppSettings } from '@ksrs/srs-engine';

export type Look = AppSettings['ui.look'];

export interface LookInfo {
  id: Look;
  label: string;
  ko: string;
  blurb: string;
  /** Background and accent for the picker swatch and the browser's theme-color. */
  bg: string;
  ink: string;
  accent: string;
  dark: boolean;
  fonts?: string;
}

const GF = 'https://fonts.googleapis.com/css2?display=swap&family=';

export const LOOKS: readonly LookInfo[] = [
  { id: 'classic', label: 'Classic', ko: '기본', blurb: 'The original calm look. Follows the light / dark setting.', bg: '#f7f6f2', ink: '#24262b', accent: '#4a7fa3', dark: false },
  { id: 'hanji', label: 'Hanji & Ink', ko: '한지', blurb: 'Warm paper, ink-black serif headings, a red seal accent.', bg: '#F3EEE3', ink: '#1E1B18', accent: '#B23A2E', dark: false,
    fonts: `${GF}Noto+Serif+KR:wght@400;600;700` },
  { id: 'coast', label: 'Island Coast', ko: '바다', blurb: 'Sea-glass teal on sand, soft rounded cards, mono numbers.', bg: '#F3F0E9', ink: '#14303F', accent: '#1F6E74', dark: false,
    fonts: `${GF}Gowun+Batang:wght@400;700&family=DM+Mono:wght@500` },
  { id: 'tatami', label: 'Tatami Light', ko: '다다미', blurb: 'Straw and cedar, a brick-red accent, pill buttons, quiet lines.', bg: '#F1ECE3', ink: '#241C15', accent: '#A8402C', dark: false,
    fonts: `${GF}Noto+Serif+KR:wght@400;600;700` },
  { id: 'mono', label: 'Mountain Mono', ko: '흑백', blurb: 'Black-and-white film: square edges, heavy rules, contact-sheet type.', bg: '#F1F0F2', ink: '#201C1C', accent: '#201C1C', dark: false,
    fonts: `${GF}IBM+Plex+Sans+KR:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500` },
  { id: 'dusk', label: 'Dusk', ko: '노을', blurb: 'A dark look: charcoal and warm cream with a sunset-orange accent.', bg: '#121411', ink: '#E9E1D0', accent: '#F0A45C', dark: true,
    fonts: `${GF}Gowun+Batang:wght@400;700&family=DM+Mono:wght@500` },
];

export const lookInfo = (id: string | undefined | null): LookInfo => LOOKS.find((l) => l.id === id) ?? LOOKS[0]!;

const STORE_KEY = 'ksrs.look';

export function storedLook(): Look {
  try { return lookInfo(localStorage.getItem(STORE_KEY)).id; } catch { return 'classic'; }
}

/** Applies a look to the document; returns true if it is a fixed-palette look (theme-color handled here). */
export function applyLook(id: Look): boolean {
  const info = lookInfo(id);
  const root = document.documentElement;
  if (info.id === 'classic') root.removeAttribute('data-look'); else root.setAttribute('data-look', info.id);
  try { localStorage.setItem(STORE_KEY, info.id); } catch { /* private mode: fine */ }
  let link = document.getElementById('look-fonts') as HTMLLinkElement | null;
  if (info.fonts) {
    if (!link) {
      link = document.createElement('link');
      link.id = 'look-fonts';
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    if (link.href !== info.fonts) link.href = info.fonts;
  } else link?.remove();
  if (info.id === 'classic') return false;
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.setAttribute('content', info.bg);
  return true;
}
