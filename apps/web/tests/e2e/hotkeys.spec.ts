// Customizable keyboard shortcuts (D87): Settings → Keyboard shortcuts, capture, conflicts with
// Swap, Reset all, and the bindings driving the real handlers and key hints.
import { expect, test, type Browser, type Page } from '@playwright/test';
import { downloadBackup, flush, restoreBackup, setup } from './helpers.ts';

test.use({ timezoneId: 'Asia/Seoul', acceptDownloads: true });

const row = (page: Page, id: string) => page.getByTestId(`key-row-${id}`);
const card = (page: Page) => page.getByTestId('drill-card');

async function openSettings(page: Page): Promise<void> {
  await page.evaluate(() => { location.hash = '#/settings'; });
  await expect(page.getByTestId('keys-settings')).toBeVisible();
}
async function rebind(page: Page, id: string, key: string, slot: 'change' | 'add' = 'change'): Promise<void> {
  await page.getByTestId(`key-${slot}-${id}`).click();
  await expect(page.getByTestId(`key-capture-${id}`)).toBeVisible();
  await page.keyboard.press(key);
  await expect(page.getByTestId(`key-capture-${id}`)).toHaveCount(0);
}
async function startDrill(page: Page, newPerDay = 3): Promise<void> {
  await page.evaluate((v) => (window as any).__ksrs.store.setAppSetting('drill.newPerDay', v), newPerDay);
  await page.evaluate(() => { location.hash = '#/drill'; window.dispatchEvent(new Event('focus')); });
  await expect(page.getByTestId('drill-home')).toBeVisible();
  await page.getByTestId('drill-start').click();
  await expect(card(page)).toHaveAttribute('data-card-id', 'kw00001:f');
}
const stored = (page: Page) => page.evaluate(() => (window as any).__ksrs.store.getState().derived.settings['keys.bindings']);

test('rebind drill Good from 3 to J: J grades, 3 no longer does, hints follow', async ({ page }) => {
  await setup(page);
  await openSettings(page);
  await expect(row(page, 'drill.good')).toHaveAttribute('data-keys', 'Digit3');
  await rebind(page, 'drill.good', 'j');
  await expect(row(page, 'drill.good')).toHaveAttribute('data-keys', 'KeyJ');
  await expect(page.getByTestId('key-chips-drill.good')).toHaveText('J');
  await expect(page.getByTestId('key-change-drill.good')).toBeFocused();
  expect(await stored(page)).toEqual({ 'drill.good': ['KeyJ'] });

  await startDrill(page);
  await page.keyboard.press('Space');
  await expect(card(page)).toHaveAttribute('data-revealed', 'true');
  await expect(page.getByTestId('drill-rate-3').locator('kbd')).toHaveText('J');
  await page.keyboard.press('3');
  await expect(card(page)).toHaveAttribute('data-card-id', 'kw00001:f');
  await expect(card(page)).toHaveAttribute('data-revealed', 'true');
  // The Korean input source sends key 'ㅓ' with code KeyJ: still Good.
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ㅓ', code: 'KeyJ', bubbles: true })));
  await expect(card(page)).toHaveAttribute('data-card-id', 'kw00002:f');
  const last = await page.evaluate(async () => {
    await (window as any).__ksrs.store.flush();
    const ev = (window as any).__ksrs.store.getState().events.filter((e: any) => e.type === 'drill.review');
    return ev[ev.length - 1];
  });
  expect(last.rating).toBe(3);
  // The other grades are unchanged.
  await page.keyboard.press('Space');
  await page.keyboard.press('4');
  await expect(card(page)).toHaveAttribute('data-card-id', 'kw00003:f');
});

test('rebind finish-screen Home from → to H', async ({ page }) => {
  await setup(page);
  await openSettings(page);
  await rebind(page, 'finish.home', 'h');
  await expect(row(page, 'finish.home')).toHaveAttribute('data-keys', 'KeyH');
  // Lesson → is a different screen, so it keeps →.
  await expect(row(page, 'lesson.next')).toHaveAttribute('data-keys', 'ArrowRight');

  await startDrill(page);
  await page.getByTestId('drill-end').click();
  await expect(page.getByTestId('drill-summary')).toBeVisible();
  await expect(page.getByTestId('next-home').locator('kbd')).toHaveText('H');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('drill-summary')).toBeVisible();
  await page.keyboard.press('h');
  await expect(page.getByTestId('lessons-tile')).toBeVisible();
});

test('a conflict shows the swap prompt; Swap trades keys, Cancel changes nothing; Reset all restores defaults', async ({ page }) => {
  await setup(page);
  await openSettings(page);

  // Good → 1 clashes with Again.
  await rebind(page, 'drill.good', '1');
  const c = page.getByTestId('key-conflict');
  await expect(c).toBeVisible();
  await expect(c).toContainText('Again');
  await expect(page.getByTestId('key-swap')).toBeFocused();
  await page.getByTestId('key-cancel').click();
  await expect(c).toHaveCount(0);
  await expect(row(page, 'drill.good')).toHaveAttribute('data-keys', 'Digit3');
  await expect(row(page, 'drill.again')).toHaveAttribute('data-keys', 'Digit1');

  await rebind(page, 'drill.good', '1');
  await page.keyboard.press('Enter'); // keyboard only: Swap is focused
  await expect(c).toHaveCount(0);
  await expect(row(page, 'drill.good')).toHaveAttribute('data-keys', 'Digit1');
  await expect(row(page, 'drill.again')).toHaveAttribute('data-keys', 'Digit3');

  // Finish keys can't clash with each other: L for Home.
  await rebind(page, 'finish.home', 'l');
  await expect(c).toContainText('Lessons');
  await page.getByTestId('key-cancel').click();

  // Tab and Escape can't be bound; Esc cancels the capture.
  await page.getByTestId('key-change-drill.known').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('key-capture-drill.known')).toHaveCount(0);
  await expect(row(page, 'drill.known')).toHaveAttribute('data-keys', 'KeyK');

  // An alternate key, then remove it.
  await rebind(page, 'drill.known', 'm', 'add');
  await expect(row(page, 'drill.known')).toHaveAttribute('data-keys', 'KeyK KeyM');
  await page.getByTestId('key-remove-alt-drill.known').click();
  await expect(row(page, 'drill.known')).toHaveAttribute('data-keys', 'KeyK');
  // Row reset.
  await rebind(page, 'drill.known', 'm');
  await page.getByTestId('key-reset-drill.known').click();
  await expect(row(page, 'drill.known')).toHaveAttribute('data-keys', 'KeyK');

  await rebind(page, 'finish.home', 'h');
  await page.getByTestId('keys-reset-all').click();
  await expect(page.getByTestId('keys-reset-all-confirm')).toBeVisible();
  await page.getByTestId('keys-reset-all-yes').click();
  await expect(row(page, 'drill.good')).toHaveAttribute('data-keys', 'Digit3');
  await expect(row(page, 'drill.again')).toHaveAttribute('data-keys', 'Digit1');
  await expect(row(page, 'finish.home')).toHaveAttribute('data-keys', 'ArrowRight');
  expect(await stored(page)).toEqual({});
});

async function device(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ timezoneId: 'Asia/Seoul', acceptDownloads: true });
  const page = await ctx.newPage();
  await setup(page);
  return { page, close: () => ctx.close() };
}

test('bindings survive reload and export → import', async ({ page, browser }) => {
  await setup(page);
  await openSettings(page);
  await rebind(page, 'drill.good', 'j');
  await rebind(page, 'drill.known', 'm', 'add');
  await flush(page);
  await page.reload(); // still on #/settings
  await expect(page.getByTestId('keys-settings')).toBeVisible();
  await expect(row(page, 'drill.good')).toHaveAttribute('data-keys', 'KeyJ');
  await expect(row(page, 'drill.known')).toHaveAttribute('data-keys', 'KeyK KeyM');

  const file = await downloadBackup(page);
  const other = await device(browser);
  await restoreBackup(other.page, file);
  await openSettings(other.page);
  await expect(row(other.page, 'drill.good')).toHaveAttribute('data-keys', 'KeyJ');
  await expect(row(other.page, 'drill.known')).toHaveAttribute('data-keys', 'KeyK KeyM');
  await other.close();
});

test('phone width: the shortcuts section fits without horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await openSettings(page);
  await page.getByTestId('keys-settings').scrollIntoViewIfNeeded();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await rebind(page, 'drill.good', 'j');
  await expect(row(page, 'drill.good')).toHaveAttribute('data-keys', 'KeyJ');
});
