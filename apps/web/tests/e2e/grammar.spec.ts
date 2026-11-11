// Grammar path e2e on the fixture seed: separate Grammar card, cloze hint ladder (hint 2 counts
// as a miss, recorded in check.layer), ghost reviews (+2 h / +24 h after a miss, zero events),
// and the #/grammar progress page.
import { expect, test, type Page } from '@playwright/test';
import {
  correctAnswer, currentQ, doLessonBatch, flush, goHome, HOUR, jumpToDue, next, peek, readEvents, setup, submit, type Bundle,
} from './helpers.ts';

test.use({ timezoneId: 'Asia/Seoul' });

const G = 'g:는-바람에';

/** Answers the current review session; the first time G's cloze shows, walks the hint ladder to level 2. */
async function reviewWithHintLadder(page: Page, b: Bundle): Promise<void> {
  await jumpToDue(page);
  await page.getByTestId('start-reviews').click();
  let laddered = false;
  for (let g = 0; g < 60 && !(await page.getByTestId('review-summary').isVisible()); g++) {
    const q = await currentQ(page);
    if (!laddered && q.itemId === G && q.qtype === 'cloze') {
      laddered = true;
      const card = page.getByTestId('question');
      // Level 0: sentence, translation, dictionary form only.
      await expect(card).toHaveAttribute('data-hint-level', '0');
      await expect(page.getByTestId('cue-base')).toHaveText('졸다');
      await expect(card).not.toContainText('바람에');
      await expect(page.getByTestId('hint-meaning')).toHaveCount(0);
      await expect(card.locator('.gloss-en')).toBeVisible();
      // Level 1: the short meaning, never the pattern.
      await page.getByTestId('hint-btn').click();
      await expect(card).toHaveAttribute('data-hint-level', '1');
      await expect(page.getByTestId('hint-meaning')).toContainText('sudden');
      await expect(card).not.toContainText('바람에');
      await expect(page.getByTestId('hint-pattern')).toHaveCount(0);
      // Level 2: the full pattern; no further hint.
      await page.getByTestId('hint-btn').click();
      await expect(card).toHaveAttribute('data-hint-level', '2');
      await expect(page.getByTestId('hint-pattern')).toHaveText('-는 바람에');
      await expect(page.getByTestId('hint-btn')).toHaveCount(0);
      await submit(page, q, correctAnswer(b, q));
      const fb = page.getByTestId('feedback');
      await expect(fb).toHaveAttribute('data-grade', 'incorrect');
      await expect(fb).toHaveAttribute('data-hint-penalty', 'true');
      await expect(fb).toContainText('Correct, but with the full hint — counted as a miss');
      await expect(fb.getByRole('button', { name: 'I was right' })).toBeVisible();
      await next(page);
      continue;
    }
    await submit(page, q, correctAnswer(b, q));
    await expect(page.getByTestId('feedback')).toHaveAttribute('data-grade', 'correct');
    await next(page);
  }
  expect(laddered, 'the -는 바람에 cloze came up').toBe(true);
  await page.getByTestId('next-home').click();
}

test('hint ladder: levels 0/1/2, hint 2 counts as a miss (layer "+hint2"); ghosts at +2 h/+24 h write zero events', async ({ page }) => {
  test.setTimeout(120_000);
  const b = await setup(page);
  await doLessonBatch(page, b, 'grammar');
  await reviewWithHintLadder(page, b);
  await flush(page);
  const misses = (await readEvents(page)).filter((e) => e.type === 'review.answer' && e.itemId === G && e.qtype === 'cloze' && e.grade === 'incorrect');
  expect(misses).toHaveLength(1);
  expect(misses[0].check.layer).toMatch(/\+hint2$/);
  const missAt: number = misses[0].at;
  // The item still needed a clean cloze later in the session; the group has 1 incorrect.
  const st = await page.evaluate((id) => (window as any).__ksrs.store.getState().derived.items.get(id).stats.incorrect, G);
  expect(st).toBe(1);

  // No ghost before +2 h.
  await page.clock.setSystemTime(missAt + 2 * HOUR - 60_000);
  await goHome(page);
  await expect(page.getByTestId('ghosts-link')).toHaveCount(0);
  // +2 h: one ghost.
  await page.clock.setSystemTime(missAt + 2 * HOUR + 60_000);
  await goHome(page);
  await expect(page.getByTestId('ghosts-count')).toHaveText('1');
  const before = await peek.eventCount(page);
  const projBefore = await peek.projection(page);
  await page.getByTestId('ghosts-link').click();
  await expect(page.getByTestId('practice-label')).toContainText('Ghost review');
  for (let g = 0; g < 20 && !(await page.getByTestId('ghosts-done').isVisible()); g++) {
    const q = await currentQ(page);
    expect(q.itemId).toBe(G);
    await submit(page, q, correctAnswer(b, q));
    await next(page);
  }
  await expect(page.getByTestId('ghosts-done')).toBeVisible();
  expect(await peek.eventCount(page)).toBe(before);
  expect(await peek.projection(page)).toEqual(projBefore);
  expect((await readEvents(page)).length).toBe(before);
  await goHome(page);
  await expect(page.getByTestId('ghosts-link')).toHaveCount(0);
  // Done-state is per device (kv) and survives a reload.
  await page.reload();
  await expect(page.getByTestId('lessons-tile')).toBeVisible();
  await expect(page.getByTestId('ghosts-link')).toHaveCount(0);
  // +24 h: the second slot.
  await page.clock.setSystemTime(missAt + 24 * HOUR + 60_000);
  await goHome(page);
  await expect(page.getByTestId('ghosts-count')).toHaveText('1');
  expect(await peek.eventCount(page)).toBe(before);
});

test('grammar progress page: patterns by function tag with stage chips, and contrast sets', async ({ page }) => {
  await setup(page);
  await page.getByTestId('grammar-progress-link').click();
  await expect(page.getByTestId('grammar-page')).toBeVisible();
  const groups = page.getByTestId('pattern-group');
  await expect(groups.locator('h3')).toHaveText([/^Cause/, /^Concession/, /^Inevitability/]);
  const row = (id: string) => page.locator(`[data-testid="pattern-row"][data-item-id="${id}"]`);
  await expect(row('g:는-바람에').getByTestId('pattern-stage')).toHaveText('S1');
  await expect(row('g:더라도').getByTestId('pattern-stage')).toHaveText('S2');
  await expect(row('g:기-마련이다').getByTestId('pattern-stage')).toHaveText('S3');
  await expect(page.getByTestId('grammar-stage-row')).toHaveCount(3);
  await expect(page.getByTestId('grammar-stage-row').nth(0)).toHaveAttribute('data-open', 'true');
  await expect(page.getByTestId('grammar-stage-row').nth(1)).toHaveAttribute('data-open', 'false');
  await expect(page.getByTestId('contrast-set')).toHaveCount(1);
  await expect(page.getByTestId('contrast-set')).toContainText('Unwanted cause');
  await expect(page.getByTestId('contrast-set').locator('a')).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
