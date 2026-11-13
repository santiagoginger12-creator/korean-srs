// Anki-style drill (D78–D84) on the 30-word fixture deck (five words per tier):
// tier 1 kw00001–kw00005, tier 2 kw00970–, tier 3 kw01939–, tier 4 kw03897–, tier 5 kw05854–, tier 6 kw08367–.
import { expect, test, type Browser, type Page } from '@playwright/test';
import { downloadBackup, flush, goHome, importBaseline, HEADER, readEvents, restoreBackup, setup, T0 } from './helpers.ts';

test.use({ timezoneId: 'Asia/Seoul', acceptDownloads: true });

const DAY = 86_400_000;
const card = (page: Page) => page.getByTestId('drill-card');

async function setNewPerDay(page: Page, n: number): Promise<void> {
  await page.evaluate((v) => (window as any).__ksrs.store.setAppSetting('drill.newPerDay', v), n);
}
async function openDrill(page: Page): Promise<void> {
  await page.evaluate(() => { location.hash = '#/drill'; window.dispatchEvent(new Event('focus')); });
  await expect(page.getByTestId('drill-home')).toBeVisible();
}
async function expectCard(page: Page, id: string, revealed = false): Promise<void> {
  await expect(card(page)).toHaveAttribute('data-card-id', id);
  await expect(card(page)).toHaveAttribute('data-revealed', String(revealed));
}
async function gradeCurrent(page: Page, key: '1' | '2' | '3' | '4'): Promise<void> {
  await page.keyboard.press('Space');
  await expect(card(page)).toHaveAttribute('data-revealed', 'true');
  await page.keyboard.press(key);
}
const drillTypes = async (page: Page) => (await readEvents(page)).filter((e) => String(e.type).startsWith('drill.')).map((e) => e.type);

test('flip and grade with keys, undo, learning steps return, finish screen with NextSteps', async ({ page }) => {
  await setup(page);
  await expect(page.getByTestId('drill-tile')).toBeVisible();
  await expect(page.getByTestId('drill-tile-new')).toHaveText('20');
  await expect(page.getByTestId('drill-tile-due')).toHaveText('0');
  await setNewPerDay(page, 3);
  await expect(page.getByTestId('drill-tile-new')).toHaveText('3');

  // D on the dashboard goes straight into a session.
  await page.keyboard.press('d');
  await expect(page.getByTestId('drill-session')).toBeVisible();
  await expectCard(page, 'kw00001:f');
  await expect(page.getByTestId('drill-prompt')).toHaveText('거');

  // 1–4 do nothing before the answer is shown; Space shows it; Space/Enter never grade.
  await page.keyboard.press('3');
  await expectCard(page, 'kw00001:f', false);
  await page.keyboard.press('Space');
  await expectCard(page, 'kw00001:f', true);
  await expect(page.getByTestId('drill-answer')).toContainText('thing');
  await expect(page.getByTestId('drill-ivl-1')).toHaveText('<1m');
  await expect(page.getByTestId('drill-ivl-2')).toHaveText('6m');
  await expect(page.getByTestId('drill-ivl-3')).toHaveText('10m');
  await expect(page.getByTestId('drill-ivl-4')).toHaveText(/^\d+d$/);
  await expect(page.getByTestId('drill-credit')).toHaveCount(0); // tier 1 glosses are original
  await expect(page.getByTestId('drill-example-en')).toHaveCount(0); // translation hidden (D76)
  await page.keyboard.press('t');
  await expect(page.getByTestId('drill-example-en')).toBeVisible();
  await page.keyboard.press('Space');
  await page.keyboard.press('Enter');
  await expectCard(page, 'kw00001:f', true);

  // Good → next new card. Z undoes it (the Korean input source sends ㅋ with code KeyZ).
  await page.keyboard.press('3');
  await expectCard(page, 'kw00002:f');
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ㅋ', code: 'KeyZ', bubbles: true })));
  await expectCard(page, 'kw00001:f', false);
  await flush(page);
  expect(await drillTypes(page)).toEqual(['drill.review', 'drill.undo']);

  // Again (1m step) on the first card, Good on the others, then it comes back first.
  await gradeCurrent(page, '1');
  await expectCard(page, 'kw00002:f');
  await gradeCurrent(page, '3');
  await expectCard(page, 'kw00003:f');
  // Held keys never repeat: reveal, then a held "3" (repeat) mustn't grade the next card twice.
  await page.keyboard.press('Space');
  await page.keyboard.down('3');
  await expectCard(page, 'kw00001:f'); // the learning card returns (within the learn-ahead limit)
  await page.keyboard.press('Space');
  await page.keyboard.down('3'); // auto-repeat: ignored
  await expectCard(page, 'kw00001:f', true);
  await page.keyboard.up('3');
  await page.keyboard.press('3'); // → 10m step
  // The two 10-minute cards graduate, then kw00001 graduates.
  for (const id of ['kw00002:f', 'kw00003:f', 'kw00001:f']) { await expectCard(page, id); await gradeCurrent(page, '3'); }

  await expect(page.getByTestId('drill-summary')).toBeVisible();
  await expect(page.getByTestId('drill-summary-answered')).toHaveText('7');
  await expect(page.getByTestId('next-steps')).toBeVisible();
  await expect(page.getByTestId('next-drill')).toHaveCount(0); // nothing left today
  await flush(page);
  const types = await drillTypes(page);
  expect(types.filter((t) => t === 'drill.review')).toHaveLength(8);
  // The WaniKani side is untouched.
  expect((await readEvents(page)).some((e) => e.type === 'review.answer' || e.type === 'lesson.completed')).toBe(false);

  // → goes Home; the tile shows nothing waiting and the reviews done.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('lessons-tile')).toBeVisible();
  await expect(page.getByTestId('drill-tile-new')).toHaveText('0');
  await expect(page.getByTestId('drill-tile-note')).toContainText('7 done');
});

test('the drill summary offers Drill (n) and D starts a fresh session in place', async ({ page }) => {
  await setup(page);
  await setNewPerDay(page, 2);
  await openDrill(page);
  await expect(page.getByTestId('drill-new')).toHaveText('2');
  await page.getByTestId('drill-start').click();
  await expectCard(page, 'kw00001:f');
  await gradeCurrent(page, '4'); // Easy graduates at once
  await page.getByTestId('drill-end').click();
  await expect(page.getByTestId('drill-summary')).toBeVisible();
  await expect(page.getByTestId('next-drill')).toHaveText(/Drill \(1\)/);
  await page.keyboard.press('d');
  await expectCard(page, 'kw00002:f');
  await gradeCurrent(page, '4');
  await expect(page.getByTestId('drill-summary')).toBeVisible();
  await expect(page.getByTestId('next-drill')).toHaveCount(0);
});

test('K marks a word known after a confirm key; Z brings it back; skip ahead is confirmed in-page and undoable', async ({ page }) => {
  await setup(page);
  await openDrill(page);
  await expect(page.getByTestId('drill-new')).toHaveText('20');

  // Skip ahead below tier 3 (10 words), confirmed in the page.
  await page.getByTestId('drill-skip-tier').selectOption('3');
  await expect(page.getByTestId('drill-skip')).toHaveText('Mark 10 words below tier 3 known');
  await page.getByTestId('drill-skip').click();
  await expect(page.getByTestId('drill-skip-confirm')).toBeVisible();
  await expect(page.getByTestId('drill-state-known')).toHaveText('0');
  await page.getByTestId('drill-skip-yes').click();
  await expect(page.getByTestId('drill-state-known')).toHaveText('10');
  await expect(page.getByTestId('drill-state-new')).toHaveText('20');
  await expect(page.getByTestId('drill-batch')).toHaveCount(1);
  // Reversible.
  await page.getByTestId('drill-batch-undo').click();
  await expect(page.getByTestId('drill-state-known')).toHaveText('0');
  await page.getByTestId('drill-skip').click();
  await page.getByTestId('drill-skip-yes').click();
  await expect(page.getByTestId('drill-state-known')).toHaveText('10');

  // New cards now start at tier 3.
  await page.keyboard.press('Space');
  await expectCard(page, 'kw01939:f');
  await page.keyboard.press('k');
  await expect(page.getByTestId('drill-known-confirm')).toBeVisible();
  await page.keyboard.press('3'); // other keys don't grade or confirm while asking
  await expect(page.getByTestId('drill-known-confirm')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('drill-known-confirm')).toHaveCount(0);
  await expectCard(page, 'kw01939:f');
  // Korean input source: ㅏ is the K key.
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ㅏ', code: 'KeyK', bubbles: true })));
  await expect(page.getByTestId('drill-known-confirm')).toBeVisible();
  await page.keyboard.press('k');
  await expectCard(page, 'kw01940:f');
  await page.keyboard.press('z');
  await expectCard(page, 'kw01939:f');
  await page.getByTestId('drill-known').click();
  await page.getByTestId('drill-known-yes').click();
  await expectCard(page, 'kw01940:f');
  await page.getByTestId('drill-end').click();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('lessons-tile')).toBeVisible();
  await openDrill(page);
  await expect(page.getByTestId('drill-state-known')).toHaveText('11');
  await flush(page);
  expect(await drillTypes(page)).toEqual(['drill.known', 'drill.undo', 'drill.known', 'drill.known', 'drill.undo', 'drill.known']);
});

test('reverse card unlocks once the forward card reaches 7 days, and enters the queue the next day', async ({ page }) => {
  await setup(page);
  await setNewPerDay(page, 1);
  await openDrill(page);
  await page.getByTestId('drill-start').click();
  await expectCard(page, 'kw00001:f');
  await page.keyboard.press('Space');
  await expect(page.getByTestId('drill-ivl-4')).toHaveText(/^(1[3-9]|2\d)d$/);
  await page.keyboard.press('4'); // Easy: about 16 days → reverse unlocked
  await expect(page.getByTestId('drill-summary')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('lessons-tile')).toBeVisible();
  await openDrill(page);
  await expect(page.getByTestId('drill-new')).toHaveText('0'); // same day: not yet

  await page.clock.setSystemTime(T0 + DAY);
  await openDrill(page);
  await expect(page.getByTestId('drill-new')).toHaveText('2'); // 1 forward + 1 reverse (not counted in the limit)
  await page.getByTestId('drill-start').click();
  await expectCard(page, 'kw00002:f');
  await gradeCurrent(page, '4');
  await expect(card(page)).toHaveAttribute('data-dir', 'r');
  await expectCard(page, 'kw00001:r');
  await expect(page.getByTestId('drill-prompt')).toContainText('thing');
  await page.keyboard.press('Space');
  await expect(page.getByTestId('drill-answer')).toHaveText('거');
  await page.keyboard.press('3');
  await expectCard(page, 'kw00001:r'); // learning step (learn-ahead): back again
});

test('skip words mastered in the Anki baseline (computed from this device\'s data)', async ({ page }) => {
  await setup(page);
  const csv = [HEADER, '거,thing,,noun,mastered,0,30,2026-08-01,1,anki,,', '공항,airport,空港,noun,mastered,1,20,2026-08-01,2,anki,,',
    '작년,last year,,noun,learning,9,40,2026-08-01,3,anki,leech,'].join('\r\n') + '\r\n';
  await importBaseline(page, csv);
  await openDrill(page);
  await expect(page.getByTestId('drill-skip-anki')).toHaveText("Skip 2 words you've mastered in Anki");
  await page.getByTestId('drill-skip-anki').click();
  await page.getByTestId('drill-skip-yes').click();
  await expect(page.getByTestId('drill-state-known')).toHaveText('2');
  await expect(page.getByTestId('drill-skip-anki')).toHaveText("Skip 0 words you've mastered in Anki");
});

async function device(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ timezoneId: 'Asia/Seoul', acceptDownloads: true });
  const page = await ctx.newPage();
  await setup(page);
  return { page, close: () => ctx.close() };
}

test('drill events survive export → import on a fresh device (same counts and card states)', async ({ page, browser }) => {
  await setup(page);
  await openDrill(page);
  await page.getByTestId('drill-skip-tier').selectOption('2');
  await page.getByTestId('drill-skip').click();
  await page.getByTestId('drill-skip-yes').click();
  await page.getByTestId('drill-start').click();
  await gradeCurrent(page, '4');
  await gradeCurrent(page, '1');
  await gradeCurrent(page, '3');
  await page.getByTestId('drill-end').click();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('lessons-tile')).toBeVisible();
  await openDrill(page);
  const counts = async (p: Page) => Promise.all(['drill-due', 'drill-new', 'drill-reviews-today', 'drill-state-new', 'drill-state-learning',
    'drill-state-young', 'drill-state-known'].map((id) => p.getByTestId(id).innerText()));
  const before = await counts(page);
  const cards = async (p: Page) => p.evaluate(() => {
    const st = (window as any).__ksrs.store.getState().drill;
    return [...st.cards.values()].map((c: any) => `${c.id}:${c.phase}:${c.due}:${c.known}`).sort();
  });
  const beforeCards = await cards(page);
  expect(beforeCards.length).toBe(8);
  const file = await downloadBackup(page);
  const t = await page.evaluate(() => Date.now());

  const other = await device(browser);
  await other.page.clock.setSystemTime(t);
  await restoreBackup(other.page, file);
  await openDrill(other.page);
  expect(await counts(other.page)).toEqual(before);
  expect(await cards(other.page)).toEqual(beforeCards);
  await goHome(other.page);
  await other.close();
});

// Fill in the blank (D86): type the blanked word, Enter checks, 1–4 grade; Again is suggested after a miss.
test('fill-in-the-blank mode: check, verdict, suggested rating, grade with keys', async ({ page }) => {
  await setup(page);
  await setNewPerDay(page, 2);
  await page.evaluate(() => (window as any).__ksrs.store.setAppSetting('drill.answerMode', 'cloze'));
  await openDrill(page);
  await page.getByTestId('drill-start').click();
  await expectCard(page, 'kw00001:f');
  await expect(card(page)).toHaveAttribute('data-mode', 'cloze');
  await expect(page.getByTestId('drill-cloze')).not.toContainText('거예요');
  await expect(page.getByTestId('drill-cloze-en')).toHaveText('Whose is this?');
  const box = page.getByLabel('The missing word');
  await box.fill('거예요');
  await box.press('Enter');
  await expect(page.getByTestId('drill-verdict')).toHaveAttribute('data-verdict', 'correct');
  await expect(page.getByTestId('drill-cloze-answer')).toHaveText('거예요');
  await expect(page.getByTestId('drill-rate-3')).toHaveClass(/is-suggested/);
  await page.keyboard.press('3');

  await expectCard(page, 'kw00002:f');
  await page.getByLabel('The missing word').fill('너');
  await page.getByLabel('The missing word').press('Enter');
  await expect(page.getByTestId('drill-verdict')).toHaveAttribute('data-verdict', 'wrong');
  await expect(page.getByTestId('drill-rate-1')).toHaveClass(/is-suggested/);
  await page.keyboard.press('1');
  expect((await drillTypes(page)).filter((t) => t === 'drill.review').length).toBe(2);
});

// Reset (D85): in-page confirm clears drill progress; it can be undone from the same page.
test('reset clears drill progress after a confirm, and Undo reset brings it back', async ({ page }) => {
  await setup(page);
  await setNewPerDay(page, 2);
  await openDrill(page);
  await expect(page.getByTestId('drill-reset-btn')).toBeDisabled();
  await page.getByTestId('drill-start').click();
  await expectCard(page, 'kw00001:f');
  await gradeCurrent(page, '4');
  await expectCard(page, 'kw00002:f');
  await gradeCurrent(page, '4');
  await page.getByTestId('next-home').click(); // both new cards done: the summary shows
  await expect(page.getByTestId('drill-tile')).toBeVisible();
  await openDrill(page);
  await expect(page.getByTestId('drill-reviews-today')).toHaveText('2');

  await page.getByTestId('drill-reset-btn').click();
  await expect(page.getByTestId('drill-reset-confirm')).toContainText('2');
  await page.getByTestId('drill-reset-yes').click();
  await expect(page.getByTestId('drill-reviews-today')).toHaveText('0');
  await expect(page.getByTestId('drill-new')).toHaveText('2');
  expect(await drillTypes(page)).toContain('drill.reset');

  await page.getByTestId('drill-reset-undo').click();
  await expect(page.getByTestId('drill-reviews-today')).toHaveText('2');
  await expect(page.getByTestId('drill-new')).toHaveText('0');
});
