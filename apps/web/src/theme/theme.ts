import type { Settings } from '@ksrs/srs-engine';

/** system → follow prefers-color-scheme (CSS); light/dark → manual override via data-theme. */
export function applyTheme(theme: Settings['theme']): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', theme);
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  // With a manual theme, both scheme-specific tags must carry the chosen colour.
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
    const media = m.getAttribute('media') ?? '';
    const forDark = theme === 'system' ? media.includes('dark') : dark;
    m.setAttribute('content', forDark ? '#16181d' : '#f7f6f2');
  }
}
