import type { Settings } from '@ksrs/srs-engine';

/** system → follow prefers-color-scheme (CSS); light/dark → manual override via data-theme. */
export function applyTheme(theme: Settings['theme']): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', theme);
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#16181d' : '#f7f6f2');
}
