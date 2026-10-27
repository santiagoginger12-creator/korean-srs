// Update prompt (§13): the served build is swapped from e2e-a to e2e-b under the same URL; the
// new SW installs and waits, the app shows "Update ready", and Reload activates it.
import { expect, test } from '@playwright/test';
import { cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setup } from './helpers.ts';

const E2E = join(fileURLToPath(new URL('.', import.meta.url)), '../../node_modules/.e2e');
const serve = (v: 'a' | 'b') => {
  rmSync(join(E2E, 'update'), { recursive: true, force: true });
  cpSync(join(E2E, `update-${v}`), join(E2E, 'update'), { recursive: true });
};

test.afterAll(() => serve('a'));

test('a new deploy shows the update toast; Reload switches to the new version', async ({ page }) => {
  serve('a');
  await setup(page, { clock: false });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.evaluate(() => { location.hash = '#/data'; });
  await expect(page.getByTestId('app-version')).toHaveText('e2e-a');
  await expect(page.getByTestId('update-toast')).toHaveCount(0);

  serve('b');
  // The app checks for updates when it becomes visible again; trigger the same check directly.
  await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r?.update(); });
  await expect(page.getByTestId('update-toast')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('app-version')).toHaveText('e2e-a'); // never auto-reloads
  await Promise.all([page.waitForEvent('load'), page.getByTestId('update-toast').getByRole('button', { name: 'Reload' }).click()]);
  await page.evaluate(() => { location.hash = '#/data'; });
  await expect(page.getByTestId('app-version')).toHaveText('e2e-b');
});
