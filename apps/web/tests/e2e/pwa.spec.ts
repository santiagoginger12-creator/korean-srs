// Installability checks standing in for Lighthouse (not available offline): manifest fields,
// icons fetchable with the right type, SW controlling the page, offline cold start.
import { expect, test } from '@playwright/test';
import { setup } from './helpers.ts';

test('manifest is complete and every icon is fetchable', async ({ page, request }) => {
  await setup(page, { clock: false });
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const manifestUrl = new URL(href!, page.url()).href;
  const res = await request.get(manifestUrl);
  expect(res.ok()).toBe(true);
  expect(res.headers()['content-type']).toContain('manifest+json');
  const m = await res.json();
  for (const k of ['id', 'name', 'short_name', 'start_url', 'scope', 'display', 'background_color', 'theme_color', 'lang']) expect(m[k], k).toBeTruthy();
  expect(m.display).toBe('standalone');
  expect(m.start_url).toBe('./');
  expect(m.scope).toBe('./');
  const sizes = m.icons.map((i: { sizes: string }) => i.sizes);
  expect(sizes).toContain('192x192');
  expect(sizes).toContain('512x512');
  expect(m.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
  for (const icon of m.icons) {
    const r = await request.get(new URL(icon.src, manifestUrl).href);
    expect(r.ok(), icon.src).toBe(true);
    expect(r.headers()['content-type'], icon.src).toBe(icon.type);
  }
  expect(m.shortcuts.map((s: { url: string }) => s.url)).toEqual(['./#/reviews', './#/lessons']);
  // Light and dark browser chrome colours.
  await expect(page.locator('meta[name="theme-color"]')).toHaveCount(2);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
});

test('service worker controls the page; offline cold start works, including the content bundle', async ({ page, context }) => {
  await setup(page, { clock: false });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  }
  const precached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const shell = keys.find((k) => k.startsWith('ksrs-shell-'));
    const c = await caches.open(shell!);
    return (await c.keys()).map((r) => new URL(r.url).pathname);
  });
  expect(precached.some((p) => p.endsWith('/content.bundle.json'))).toBe(true);
  expect(precached.some((p) => p.endsWith('/index.html'))).toBe(true);

  // Cold start: a brand-new tab while offline.
  await context.setOffline(true);
  const fresh = await context.newPage();
  await fresh.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
  await fresh.goto(page.url());
  await expect(fresh.getByTestId('lessons-tile')).toBeVisible();
  await fresh.evaluate(() => { location.hash = '#/data'; });
  await expect(fresh.getByTestId('persisted')).toBeVisible();
  await context.setOffline(false);
});
