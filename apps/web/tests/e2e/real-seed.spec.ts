// Runs against the LIVE seed (packages/content/seed). Deliberately asserts no specific
// items: only structure (hanja-first order, the daily cap) and that screens render.
// Also produces the owner's 390×844 screenshots in apps/web/test-results/.
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerAllCorrectly, correctAnswer, currentQ, goHome, HOUR, next, setup, submit, T0, wrongAnswer } from './helpers.ts';

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '../../test-results');

interface Avail { hanja: number; other: number; batch: number }
/** Unlocked items without a lesson, from the app's own derived state (read-only hook). */
const avail = (page: Page): Promise<Avail> => page.evaluate(() => {
  const s = (window as any).__ksrs.store.getState().derived;
  let hanja = 0, other = 0;
  for (const id of s.unlocked) {
    if (s.items.get(id)?.lessonAt !== undefined) continue;
    if (s.index.byId.get(id).kind === 'hanja') hanja++; else other++;
  }
  return { hanja, other, batch: s.settings.lessonBatch };
});

/** "Today: N done · cap M …" → M (lessons allowed today, including any done). */
async function shownCap(page: Page): Promise<number> {
  // "Today: 3 of 11 done · …" → lessons still allowed today (non-hanja).
  const m = /Today: (\d+) of (\d+) done/.exec(await page.getByTestId('lessons-tile').innerText());
  expect(m, 'home shows the daily cap').not.toBeNull();
  return Math.max(0, Number(m![2]) - Number(m![1]));
}

const kindOf = (id: string) => (id.startsWith('h:') ? 'hanja' : 'other');

test('smoke: fresh start → hanja-first batches within the cap → quiz renders', async ({ page }) => {
  await setup(page);
  const a0 = await avail(page);
  const cap0 = await shownCap(page);
  const count0 = Number(await page.getByTestId('lessons-count').innerText());
  expect(a0.hanja + a0.other, 'the real seed has lessons at level 1').toBeGreaterThan(0);
  expect(cap0).toBeLessThanOrEqual(20); // maxLessonsPerDay
  // Hanja are uncapped; everything else is limited by the daily cap.
  expect(count0).toBe(a0.hanja + Math.min(a0.other, cap0));
  if (a0.other > cap0) await expect(page.getByTestId('lessons-override')).toBeVisible();

  // Walk batches until one has a quiz; every batch must be hanja-first (§7.3).
  await page.getByTestId('start-lessons').click();
  let sawQuiz = false;
  let hanjaLeft = a0.hanja;
  for (let batchNo = 0; batchNo < 6 && !sawQuiz; batchNo++) {
    const ids: string[] = [];
    for (let g = 0; g < 60; g++) {
      const lp = page.getByTestId('lesson-page');
      await expect(lp).toBeVisible();
      ids.push((await lp.getAttribute('data-item-id'))!);
      if (await page.getByTestId('start-quiz').isVisible()) break;
      await page.getByRole('button', { name: 'Next', exact: true }).click();
    }
    const kinds = ids.map(kindOf);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBeLessThanOrEqual(a0.batch);
    const firstOther = kinds.indexOf('other');
    if (firstOther >= 0) expect(kinds.slice(firstOther)).not.toContain('hanja');
    if (hanjaLeft >= ids.length) expect(kinds.every((k) => k === 'hanja')).toBe(true);
    hanjaLeft -= kinds.filter((k) => k === 'hanja').length;

    await page.getByTestId('start-quiz').click();
    if (await page.getByTestId('question').isVisible().catch(() => false)) {
      sawQuiz = true;
      const q = await currentQ(page);
      expect(['meaning', 'production', 'cloze', 'nuance', 'register']).toContain(q.qtype);
      if (q.qtype !== 'nuance') await expect(page.locator('input.answer')).toBeVisible();
    } else {
      await expect(page.getByTestId('lessons-done')).toBeVisible();
      await page.getByRole('button', { name: /Next batch/ }).click();
    }
  }
  expect(sawQuiz, 'a batch with a quiz appears after the hanja').toBe(true);

  // Once the hanja are learned their vocab unlocks; the cap must still bind.
  await goHome(page);
  const a1 = await avail(page);
  const cap1 = await shownCap(page);
  const count1 = Number(await page.getByTestId('lessons-count').innerText());
  expect(a1.hanja).toBe(0);
  expect(count1).toBe(Math.min(a1.other, cap1));
  expect(count1).toBeLessThanOrEqual(20);
  if (a1.other > cap1) await expect(page.getByTestId('lessons-override')).toBeVisible();
});

test('owner screenshots on the real seed (390×844)', async ({ browser }) => {
  mkdirSync(SHOTS, { recursive: true });
  test.setTimeout(150_000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'Asia/Seoul' });
  const page = await context.newPage();
  const b = await setup(page);
  const shot = (name: string, fullPage = false) => page.screenshot({ path: join(SHOTS, `${name}-390x844.png`), fullPage });
  await shot('dashboard-fresh');
  await shot('dashboard-fresh-full', true);

  // One batch that reaches the first grammar item. The batch size is set through the store's
  // public setSetting (the same event the Settings select emits; the select stops at 20), and
  // "+5 anyway" lifts the cap, as the owner would.
  await page.evaluate(() => (window as any).__ksrs.store.setSetting('lessonBatch', 50));
  // One "+5 anyway" is enough to reach the first grammar item on a fresh start; add more only if needed.
  for (let i = 0; i < 10; i++) {
    const inQueue = await page.evaluate(() => {
      const st = (window as any).__ksrs.store.getState();
      return Number(document.querySelector('[data-testid=lessons-count]')!.textContent) >
        [...st.derived.unlocked].filter((id: string) => !id.startsWith('g:') && st.derived.items.get(id)?.lessonAt === undefined).length;
    });
    if (inQueue || !(await page.getByTestId('lessons-override').isVisible())) break;
    await page.getByTestId('lessons-override').click();
  }
  await page.getByTestId('start-lessons').click();
  const lp = page.getByTestId('lesson-page');
  await expect(lp).toHaveAttribute('data-item-id', /^h:/); // hanja first
  await shot('lesson-hanja');
  for (let g = 0; g < 60 && !(await lp.getAttribute('data-item-id'))!.startsWith('g:'); g++) {
    if (await page.getByTestId('start-quiz').isVisible()) break;
    await page.getByRole('button', { name: 'Next', exact: true }).click();
  }
  await expect(lp).toHaveAttribute('data-item-id', /^g:/);
  await shot('lesson-grammar');
  await shot('lesson-grammar-full', true);

  // Finish the batch through the quiz.
  while (!(await page.getByTestId('start-quiz').isVisible())) await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByTestId('start-quiz').click();
  await answerAllCorrectly(page, b, 'quiz-done');
  await page.getByRole('button', { name: 'Finish lessons' }).click();
  await expect(page.getByTestId('lessons-done')).toBeVisible();

  // Four-plus hours later: reviews due; a review screen, then answer a dozen and step out.
  await page.clock.setSystemTime(T0 + 5 * HOUR);
  await goHome(page);
  await expect(page.getByTestId('reviews-count')).not.toHaveText('0');
  await page.getByTestId('start-reviews').click();
  let q = await currentQ(page);
  for (let g = 0; q.qtype !== 'cloze' && q.qtype !== 'production' && g < 40; g++) {
    await submit(page, q, correctAnswer(b, q)); await next(page); q = await currentQ(page);
  }
  await shot('review');
  await submit(page, q, wrongAnswer(b, q));
  await expect(page.getByTestId('feedback')).toBeVisible();
  await shot('review-feedback');
  await next(page);
  for (let g = 0; g < 14 && !(await page.getByTestId('review-summary').isVisible()); g++) {
    q = await currentQ(page);
    await submit(page, q, correctAnswer(b, q)); await next(page);
  }
  await goHome(page);
  await expect(page.getByTestId('forecast-24h').locator('.chart-plus').first()).toBeVisible();
  await shot('dashboard-progress');
  await shot('dashboard-progress-full', true);
  await page.emulateMedia({ colorScheme: 'dark' });
  await shot('dashboard-dark');
  await shot('dashboard-dark-full', true);
  await page.emulateMedia({ colorScheme: 'light' });

  // A Sino-Korean word whose (learned) hanja has the most vocab, and that hanja's page.
  const pick = await page.evaluate(() => {
    const s = (window as any).__ksrs.store.getState().derived;
    // Score: number of vocab sharing the hanja, +100 if the hanja's lesson is done (so its page shows progress).
    let best: { vocab: string; hanja: string; n: number } | null = null;
    for (const it of s.index.byId.values()) {
      if (it.kind !== 'vocab') continue;
      for (const hb of it.hanjaBreakdown ?? []) {
        if (!hb.hanjaId) continue;
        const n = (s.index.vocabByHanja.get(hb.hanjaId) ?? []).length + (s.items.get(hb.hanjaId)?.lessonAt !== undefined ? 100 : 0);
        if (!best || n > best.n) best = { vocab: it.id, hanja: hb.hanjaId, n };
      }
    }
    return best;
  });
  expect(pick, 'a vocab item with hanja').not.toBeNull();
  await page.evaluate((id) => { location.hash = '#/item/' + encodeURIComponent(id); }, pick!.vocab);
  await expect(page.getByTestId('related')).toBeVisible();
  await shot('item-vocab');
  await shot('item-vocab-full', true);
  await page.evaluate((id) => { location.hash = '#/item/' + encodeURIComponent(id); }, pick!.hanja);
  await expect(page.getByTestId('related')).toBeVisible();
  await shot('item-hanja');
  await shot('item-hanja-full', true);
  await context.close();
});
