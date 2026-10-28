// Hosted claude.ai page target (D59, KSRS_TARGET=artifact) on the fixture seed. The page's
// `downloads` capability is stubbed: window.claude.use('downloads').save({ filename, data }).
// Checks that the master-list export goes through it (no <a download>), and that a declined
// save is reported and not recorded as an export.
import { expect, test } from '@playwright/test';
import { HEADER, importBaseline, setup } from './helpers.ts';

test.use({ timezoneId: 'Asia/Seoul' });

test('master list export on the hosted page uses the downloads capability', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __saves: { filename: string; text: string; type: string }[]; __decline: boolean; claude: unknown };
    w.__saves = [];
    w.__decline = false;
    w.claude = {
      use: async (name: string) => (name !== 'downloads' ? null : {
        save: async ({ filename, data }: { filename: string; data: Blob | string }) => {
          if (w.__decline) throw Object.assign(new Error('declined'), { code: 'declined' });
          const blob = typeof data === 'string' ? new Blob([data]) : data;
          w.__saves.push({ filename, text: await blob.text(), type: blob.type });
          return { status: 'saved' };
        },
      }),
    };
  });
  let anchorDownloads = 0;
  page.on('download', () => { anchorDownloads++; });
  await setup(page);
  await importBaseline(page);

  // Declined: reported, and "last export" stays "never".
  await page.evaluate(() => { (window as unknown as { __decline: boolean }).__decline = true; });
  await page.getByTestId('export-master').click();
  await expect(page.getByTestId('master-msg')).toContainText('declined');
  await expect(page.getByTestId('last-export')).toHaveText('never');

  await page.evaluate(() => { (window as unknown as { __decline: boolean }).__decline = false; });
  await page.getByTestId('export-master').click();
  await expect(page.getByTestId('master-msg')).toContainText('Saved');
  const saves = await page.evaluate(() => (window as unknown as { __saves: { filename: string; text: string; type: string }[] }).__saves);
  expect(saves).toHaveLength(1);
  expect(saves[0]!.filename).toBe('korean_master_vocab.csv');
  expect(saves[0]!.type).toContain('text/csv');
  const lines = saves[0]!.text.split('\r\n');
  expect(lines[0]).toBe(HEADER);
  expect(lines[1]).toBe('걸치다,"to extend, stretch; to wear",,verb/adj,learning,78,320,2026-08-15,5309,anki,leech shaky,');
  expect(lines.some((l) => l.startsWith('결제,') && l.includes(',anki app,'))).toBe(true);
  await expect(page.getByTestId('last-export')).not.toHaveText('never');
  expect(anchorDownloads).toBe(0);
});
