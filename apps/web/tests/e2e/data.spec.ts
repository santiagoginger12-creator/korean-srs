// M5 data e2e on the fixture seed: backup/restore, manual two-device sync, tamper detection,
// CSV import. Each browser context is a separate "device" (its own IndexedDB and deviceId).
import { expect, test, type Browser, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  dashboardCounts, doLessonBatch, downloadBackup, goHome, peek, readEvents, restoreBackup, reviewRound, setup, T0, wrongOnce,
  type Bundle,
} from './helpers.ts';

test.use({ timezoneId: 'Asia/Seoul', acceptDownloads: true });

async function device(browser: Browser): Promise<{ page: Page; b: Bundle; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ timezoneId: 'Asia/Seoul', acceptDownloads: true });
  const page = await ctx.newPage();
  const b = await setup(page);
  return { page, b, close: () => ctx.close() };
}

test('backup (gzip) → fresh device → restore with Merge gives identical dashboard counts', async ({ page, browser }) => {
  const b = await setup(page);
  await doLessonBatch(page, b);
  await reviewRound(page, b, wrongOnce(b, (q) => q.qtype === 'meaning'));
  const before = await dashboardCounts(page);
  const file = await downloadBackup(page, { gzip: true });
  expect(file).toMatch(/\.ksrs\.json\.gz$/);
  await expect(page.getByTestId('last-backup')).not.toContainText('never');
  const now = await page.evaluate(() => Date.now());

  // "Wipe": a brand-new device with an empty log, at the same moment.
  const other = await device(browser);
  await other.page.clock.setSystemTime(now);
  const fresh = await restoreBackup(other.page, file);
  expect(fresh).toBe((await readEvents(page)).length);
  await expect(other.page.getByTestId('restore-msg')).toContainText(`${fresh} new events added`);
  expect(await dashboardCounts(other.page)).toEqual(before);
  expect(await peek.projection(other.page)).toEqual(await peek.projection(page));

  // Restoring the same file again adds nothing (union is idempotent).
  expect(await restoreBackup(other.page, file)).toBe(0);
  await other.close();
});

test('a tampered backup is rejected with a friendly message and changes nothing', async ({ page }) => {
  const b = await setup(page);
  await doLessonBatch(page, b);
  const file = await downloadBackup(page);
  const json = JSON.parse(readFileSync(file, 'utf8'));
  json.events[0].itemId = 'v:덤';
  const bad = file.replace(/\.json$/, '.tampered.json');
  writeFileSync(bad, JSON.stringify(json));
  const n = await peek.eventCount(page);
  await page.getByTestId('restore-file').setInputFiles(bad);
  await expect(page.getByTestId('restore-msg')).toContainText('modified or damaged');
  await expect(page.getByTestId('restore-preview')).toHaveCount(0);
  expect(await peek.eventCount(page)).toBe(n);
});

test('two devices review differently offline, then sync both ways by file → identical state', async ({ browser }) => {
  test.setTimeout(120_000);
  const A = await device(browser);
  const B = await device(browser);
  expect(await peek.deviceId(A.page)).not.toBe(await peek.deviceId(B.page));
  for (const d of [A, B]) {
    await doLessonBatch(d.page, d.b);
    await d.page.context().setOffline(true);
  }
  // Device A answers everything right; B gets every meaning question wrong first.
  await reviewRound(A.page, A.b);
  await reviewRound(B.page, B.b, wrongOnce(B.b, (q) => q.qtype === 'meaning'));
  expect(await peek.projection(A.page)).not.toEqual(await peek.projection(B.page));
  for (const d of [A, B]) await d.page.context().setOffline(false);

  // Bring both clocks to the same instant so "due now" etc. agree.
  const t = Math.max(await A.page.evaluate(() => Date.now()), await B.page.evaluate(() => Date.now()));
  await A.page.clock.setSystemTime(t);
  await B.page.clock.setSystemTime(t);

  const fromA = await downloadBackup(A.page);
  await restoreBackup(B.page, fromA);
  const fromB = await downloadBackup(B.page);
  await restoreBackup(A.page, fromB);

  expect(await peek.eventCount(A.page)).toBe(await peek.eventCount(B.page));
  expect(await peek.projection(A.page)).toEqual(await peek.projection(B.page));
  expect(await dashboardCounts(A.page)).toEqual(await dashboardCounts(B.page));
  // Device name is editable and survives a reload.
  await A.page.evaluate(() => { location.hash = '#/data'; });
  await A.page.getByTestId('device-name').fill('Laptop');
  await A.page.getByTestId('device-name').blur();
  await A.page.reload();
  await A.page.evaluate(() => { location.hash = '#/data'; });
  await expect(A.page.getByTestId('device-name')).toHaveValue('Laptop');
  await A.close();
  await B.close();
});

test('Replace restore needs typed confirmation and swaps the whole log', async ({ page, browser }) => {
  const b = await setup(page);
  await doLessonBatch(page, b);
  const file = await downloadBackup(page);
  const other = await device(browser);
  await other.page.getByTestId('start-lessons').click(); // some local history that Replace will drop
  await other.page.evaluate(() => { location.hash = '#/data'; });
  await other.page.getByTestId('restore-file').setInputFiles(file);
  await other.page.getByTestId('mode-replace').check({ force: true });
  await expect(other.page.getByTestId('apply-restore')).toBeDisabled();
  await other.page.getByTestId('replace-confirm').fill('replace');
  await expect(other.page.getByTestId('apply-restore')).toBeDisabled();
  await other.page.getByTestId('replace-confirm').fill('REPLACE');
  await other.page.getByTestId('apply-restore').click();
  await expect(other.page.getByTestId('restore-msg')).toContainText('Replaced');
  expect(await peek.projection(other.page)).toEqual(await peek.projection(page));
  await other.close();
});

const CSV = [
  'level,word,meanings,pos,register,examples,question_types,production_prompt',
  '1,뜬금없다,out of the blue|random,형용사,spoken,"그 얘기는 좀 뜬금없다.::That came out of nowhere.|갑자기 뜬금없이 웃었다.::He laughed for no reason at all.",meaning|production,out of the blue; random',
].join('\n');

test('CSV import: preview → confirm → the item is in lessons and has an item page with attribution', async ({ page }) => {
  const b = await setup(page);
  // ASCII path: Chromium reads uploaded files lazily from disk, and the test's own output dir
  // contains "→" from the title, which the file read chokes on.
  const file = join(mkdtempSync(join(tmpdir(), 'ksrs-e2e-')), 'words.csv');
  writeFileSync(file, CSV);
  await page.evaluate(() => { location.hash = '#/data'; });
  await page.getByTestId('import-kind').selectOption('vocab');
  await page.getByTestId('import-file').setInputFiles(file);
  const prev = page.getByTestId('import-preview');
  await expect(prev).toContainText('1 new');
  await expect(prev.locator('tr[data-status="new"]')).toHaveCount(1);
  const id = (await prev.locator('tr[data-status="new"] td code').innerText()).trim();
  expect(id).toMatch(/^v:/);
  await page.getByTestId('import-confirm').click();
  await expect(page.getByTestId('import-msg')).toContainText('Imported 1 item');
  const evs = await readEvents(page);
  expect(evs.filter((e) => e.type === 'customItem.upsert')).toHaveLength(1);

  // Re-importing the same file: unchanged, nothing to write.
  await page.getByTestId('import-file').setInputFiles(file);
  await expect(prev).toContainText('1 unchanged');
  await expect(page.getByTestId('import-confirm')).toBeDisabled();

  // Item page renders (with attribution), and the item is a lesson candidate at level 1.
  await page.evaluate((i) => { location.hash = '#/item/' + encodeURIComponent(i); }, id);
  await expect(page.getByTestId('item-page')).toContainText('뜬금없다');
  await expect(page.getByTestId('attribution')).toContainText('words.csv');
  await expect(page.getByTestId('item-page')).toContainText('lesson available');
  const ids: string[] = [];
  await goHome(page);
  if (await page.getByTestId('lessons-override').isVisible()) await page.getByTestId('lessons-override').click();
  // Walk lesson batches until the imported word shows up on a teach page.
  for (let batch = 0; batch < 4 && !ids.includes(id); batch++) {
    await page.getByTestId('start-lessons').click();
    for (let g = 0; g < 30; g++) {
      const cur = (await page.getByTestId('lesson-page').getAttribute('data-item-id'))!;
      ids.push(cur);
      if (cur === id || await page.getByTestId('start-quiz').isVisible()) break;
      await page.getByRole('button', { name: 'Next', exact: true }).click();
    }
    if (ids.includes(id)) break;
    await goHome(page);
    await doLessonBatch(page, b);
    await goHome(page);
  }
  expect(ids).toContain(id);
  await expect(page.getByTestId('lesson-page')).toContainText('뜬금없다');
  void T0;
});
