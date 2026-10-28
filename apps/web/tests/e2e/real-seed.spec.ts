// Runs against the LIVE seed (packages/content/seed). Deliberately asserts no specific items or
// counts (content agents edit the seed): only structure (no hanja lessons, separate vocab and
// grammar queues, both daily caps) and that screens render. Also produces the owner's 390×844
// screenshots in apps/web/test-results/.
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerAllCorrectly, correctAnswer, currentQ, goHome, HOUR, next, setup, submit, T0 } from './helpers.ts';

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '../../test-results');

interface Avail { vocab: number; grammar: number; hanja: number; batch: number; grammarAllowance: number }
/** Unlocked items without a lesson, per path, from the app's own derived state (read-only hook). */
const avail = (page: Page): Promise<Avail> => page.evaluate(() => {
  const s = (window as any).__ksrs.store.getState().derived;
  let vocab = 0, grammar = 0, hanja = 0;
  for (const id of s.unlocked) {
    if (s.items.get(id)?.lessonAt !== undefined) continue;
    const k = s.index.byId.get(id).kind;
    if (k === 'hanja') hanja++; else if (k === 'grammar') grammar++; else vocab++;
  }
  return { vocab, grammar, hanja, batch: s.settings.lessonBatch, grammarAllowance: s.settings['grammar.dailyLessons'] };
});

/** "Today: 3 of 11 done · …" → lessons still allowed today on the tile `testId`. */
async function shownCap(page: Page, testId = 'cap-note'): Promise<number> {
  const m = /Today: (\d+) of (\d+) done/.exec(await page.getByTestId(testId).innerText());
  expect(m, `${testId} shows the daily cap`).not.toBeNull();
  return Math.max(0, Number(m![2]) - Number(m![1]));
}

/** Teach pages of the current lesson batch; returns their item ids (stops at the quiz button). */
async function walkBatch(page: Page): Promise<string[]> {
  const ids: string[] = [];
  for (let g = 0; g < 60; g++) {
    const lp = page.getByTestId('lesson-page');
    await expect(lp).toBeVisible();
    ids.push((await lp.getAttribute('data-item-id'))!);
    if (await page.getByTestId('start-quiz').isVisible()) break;
    await page.getByRole('button', { name: 'Next', exact: true }).click();
  }
  return ids;
}

test('smoke: no hanja lessons; separate vocab and grammar queues within their caps; quizzes render', async ({ page }) => {
  await setup(page);
  const a0 = await avail(page);
  expect(a0.hanja, 'hanja are never lessons (D63)').toBe(0);
  expect(a0.vocab, 'the real seed has vocab lessons at level 1').toBeGreaterThan(0);
  const cap0 = await shownCap(page);
  expect(cap0).toBeLessThanOrEqual(20); // maxLessonsPerDay
  expect(Number(await page.getByTestId('lessons-count').innerText())).toBe(Math.min(a0.vocab, cap0));
  if (a0.vocab > cap0) await expect(page.getByTestId('lessons-override')).toBeVisible();
  const gCount = Number(await page.getByTestId('grammar-lessons-count').innerText());
  expect(gCount).toBeLessThanOrEqual(a0.grammarAllowance);
  expect(gCount).toBeLessThanOrEqual(a0.grammar);

  await page.getByTestId('start-lessons').click();
  const ids = await walkBatch(page);
  expect(ids.length).toBeGreaterThan(0);
  expect(ids.length).toBeLessThanOrEqual(a0.batch);
  expect(ids.filter((id) => id.startsWith('h:') || id.startsWith('g:'))).toEqual([]);
  await page.getByTestId('start-quiz').click();
  const q = await currentQ(page);
  expect(['meaning', 'production', 'cloze', 'nuance', 'register']).toContain(q.qtype);
  if (q.qtype !== 'nuance') await expect(page.locator('input.answer')).toBeVisible();

  if (gCount > 0) {
    await goHome(page);
    await page.getByTestId('start-grammar-lessons').click();
    const gIds = await walkBatch(page);
    expect(gIds.length).toBeGreaterThan(0);
    expect(gIds.every((id) => id.startsWith('g:'))).toBe(true);
    expect(gIds.length).toBeLessThanOrEqual(gCount);
  }
});

test('owner screenshots on the real seed (390×844)', async ({ browser }) => {
  mkdirSync(SHOTS, { recursive: true });
  test.setTimeout(150_000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'Asia/Seoul' });
  const page = await context.newPage();
  const b = await setup(page);
  const shot = (name: string, fullPage = false) => page.screenshot({ path: join(SHOTS, `${name}-390x844.png`), fullPage });
  await expect(page.getByTestId('grammar-card')).toBeVisible();
  await shot('dashboard-fresh');
  await shot('dashboard-fresh-full', true);

  // A vocab lesson batch; the screenshot shows a page with the subtle hanja line when there is one.
  await page.getByTestId('start-lessons').click();
  const lp = page.getByTestId('lesson-page');
  for (let g = 0; g < 30 && !(await page.getByTestId('hanja-line').isVisible()); g++) {
    if (await page.getByTestId('start-quiz').isVisible()) break;
    await page.getByRole('button', { name: 'Next', exact: true }).click();
  }
  await expect(lp).toHaveAttribute('data-path', 'vocab');
  await shot('lesson-vocab');
  while (!(await page.getByTestId('start-quiz').isVisible())) await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByTestId('start-quiz').click();
  await answerAllCorrectly(page, b, 'quiz-done');
  await page.getByRole('button', { name: 'Finish lessons' }).click();
  await expect(page.getByTestId('lessons-done')).toBeVisible();

  // A grammar lesson batch from the Grammar card.
  await goHome(page);
  await page.getByTestId('start-grammar-lessons').click();
  await expect(lp).toHaveAttribute('data-item-id', /^g:/);
  await shot('lesson-grammar');
  await shot('lesson-grammar-full', true);
  while (!(await page.getByTestId('start-quiz').isVisible())) await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByTestId('start-quiz').click();
  await answerAllCorrectly(page, b, 'quiz-done');
  await page.getByRole('button', { name: 'Finish lessons' }).click();
  await expect(page.getByTestId('lessons-done')).toBeVisible();

  // Four-plus hours later: reviews due. A grammar cloze at hint levels 0, 1, 2, then the hint-2 miss.
  await page.clock.setSystemTime(T0 + 5 * HOUR);
  await goHome(page);
  await expect(page.getByTestId('reviews-count')).not.toHaveText('0');
  await shot('dashboard-reviews-due');
  await page.getByTestId('start-reviews').click();
  let q = await currentQ(page);
  for (let g = 0; !(q.qtype === 'cloze' && q.itemId.startsWith('g:')) && g < 60; g++) {
    if (await page.getByTestId('review-summary').isVisible()) break;
    await submit(page, q, correctAnswer(b, q)); await next(page);
    if (await page.getByTestId('review-summary').isVisible()) break;
    q = await currentQ(page);
  }
  expect(q.qtype === 'cloze' && q.itemId.startsWith('g:'), 'a grammar cloze in the first reviews').toBe(true);
  await shot('review-cloze-hint0');
  await page.getByTestId('hint-btn').click();
  await shot('review-cloze-hint1');
  if (await page.getByTestId('hint-btn').isVisible()) await page.getByTestId('hint-btn').click();
  await shot('review-cloze-hint2');
  await submit(page, q, correctAnswer(b, q));
  await expect(page.getByTestId('feedback')).toBeVisible();
  await shot('review-hint-miss');
  await next(page);
  for (let g = 0; g < 40 && !(await page.getByTestId('review-summary').isVisible()); g++) {
    q = await currentQ(page);
    await submit(page, q, correctAnswer(b, q)); await next(page);
  }
  await goHome(page);
  await shot('dashboard-progress');
  await shot('dashboard-progress-full', true);
  await page.emulateMedia({ colorScheme: 'dark' });
  await shot('dashboard-dark');
  await shot('dashboard-dark-full', true);
  await page.emulateMedia({ colorScheme: 'light' });

  // Two hours after the hint-2 miss: a ghost review is offered.
  await page.clock.setSystemTime(T0 + 7 * HOUR + 10 * 60_000);
  await goHome(page);
  await expect(page.getByTestId('ghosts-link')).toBeVisible();
  await shot('dashboard-ghosts');

  await page.getByTestId('grammar-progress-link').click();
  await expect(page.getByTestId('grammar-page')).toBeVisible();
  await shot('grammar-progress');
  await shot('grammar-progress-full', true);

  // A vocab item page with its hanja as one muted line.
  const vocabId = await page.evaluate(() => {
    const s = (window as any).__ksrs.store.getState().derived;
    for (const it of s.index.byId.values()) if (it.kind === 'vocab' && (it.hanjaBreakdown ?? []).length && s.items.get(it.id)?.lessonAt !== undefined) return it.id as string;
    for (const it of s.index.byId.values()) if (it.kind === 'vocab' && (it.hanjaBreakdown ?? []).length) return it.id as string;
    return null;
  });
  expect(vocabId, 'a vocab item with hanja').not.toBeNull();
  await page.evaluate((id) => { location.hash = '#/item/' + encodeURIComponent(id); }, vocabId!);
  await expect(page.getByTestId('hanja-line')).toBeVisible();
  await shot('item-vocab');
  await shot('item-vocab-full', true);
  await context.close();
});

test('owner screenshots: M5 pages on the real seed (390×844)', async ({ browser }) => {
  mkdirSync(SHOTS, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'Asia/Seoul' });
  const page = await context.newPage();
  // Two Korean voices so the TTS settings render as on a phone with voices installed.
  await page.addInitScript(() => {
    const list = [{ lang: 'ko-KR', name: 'Yuna', voiceURI: 'yuna', localService: true, default: true }, { lang: 'ko-KR', name: 'Sora', voiceURI: 'sora', localService: true, default: false }];
    (window as any).SpeechSynthesisUtterance = class { text: string; constructor(t: string) { this.text = t; } };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { getVoices: () => list, speak() {}, cancel() {}, addEventListener() {}, removeEventListener() {} } });
  });
  const b = await setup(page);
  const shot = (name: string, fullPage = true) => page.screenshot({ path: join(SHOTS, `${name}-390x844.png`), fullPage });
  // Learn one quiz batch so there is history to back up and practise.
  for (let i = 0; i < 3; i++) {
    await goHome(page);
    await page.getByTestId('start-lessons').click();
    while (!(await page.getByTestId('start-quiz').isVisible())) await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByTestId('start-quiz').click();
    if (await page.getByTestId('question').isVisible().catch(() => false)) {
      await answerAllCorrectly(page, b, 'quiz-done');
      await page.getByRole('button', { name: 'Finish lessons' }).click();
      break;
    }
  }
  await goHome(page);
  await expect(page.getByTestId('backup-reminder')).toBeVisible();
  await shot('dashboard-backup-reminder', false);
  await page.evaluate(() => { location.hash = '#/data'; });
  await expect(page.getByTestId('data-page')).toBeVisible();
  await shot('data');
  await page.evaluate(() => { location.hash = '#/settings'; });
  await expect(page.getByTestId('tts-voice')).toBeVisible();
  await shot('settings-tts');
  await page.evaluate(() => { location.hash = '#/practice'; });
  await shot('practice-picker', false);
  await page.getByTestId('start-practice').click();
  await expect(page.getByTestId('practice-label')).toBeVisible();
  await shot('practice-question', false);
  await context.close();
});
