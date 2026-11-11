import { expect, test } from '@playwright/test';
import { answerAllCorrectly, goHome, HOUR, setup } from './helpers.ts';

// Keyboard flow through lesson teach pages: → advances, ← goes back, and → on the last page
// starts the quiz (owner request: no need to reach for the "Take the quiz" button).
test('arrow keys page through lessons; → on the last page starts the quiz', async ({ page }) => {
  await setup(page);
  await page.getByTestId('start-lessons').click();
  const lp = page.getByTestId('lesson-page');
  await expect(lp).toBeVisible();
  const first = await lp.getAttribute('data-item-id');

  await page.keyboard.press('ArrowRight');
  await expect(lp).not.toHaveAttribute('data-item-id', first!);
  await page.keyboard.press('ArrowLeft');
  await expect(lp).toHaveAttribute('data-item-id', first!);

  // Walk to the last page with →, then one more → starts the quiz.
  for (let guard = 0; guard < 50 && !(await page.getByTestId('start-quiz').isVisible()); guard++) {
    await page.keyboard.press('ArrowRight');
  }
  await expect(page.getByTestId('start-quiz')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('question')).toBeVisible();
  await expect(page.getByTestId('lesson-page')).toHaveCount(0);
});

// End-of-session keys (D75): → finishes the lesson quiz, → again goes Home; R from the
// finished screen jumps straight into reviews; → on the review summary closes it and goes Home.
test('→ finishes lessons and goes Home; R jumps to reviews; → leaves the review summary', async ({ page }) => {
  const b = await setup(page);
  await page.getByTestId('start-lessons').click();
  for (let g = 0; g < 50 && !(await page.getByTestId('question').isVisible()); g++) await page.keyboard.press('ArrowRight');
  await answerAllCorrectly(page, b, 'quiz-done');
  await page.locator('body').click({ position: { x: 2, y: 2 } }); // blur any field, as after a click
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('lessons-done')).toBeVisible();
  await expect(page.getByTestId('next-steps')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('lessons-tile')).toBeVisible();

  // Make the new items due, finish another lesson batch if any, then go to reviews with R.
  await page.clock.setSystemTime((await page.evaluate(() => Date.now())) + 5 * HOUR);
  await goHome(page);
  await page.evaluate(() => { location.hash = '#/practice'; });
  await expect(page.getByTestId('practice-page')).toBeVisible();
  await page.getByTestId('start-practice').click();
  await answerAllCorrectly(page, b, 'practice-done');
  await expect(page.getByTestId('next-reviews')).toBeVisible();
  await page.keyboard.press('r');
  await expect(page.getByTestId('question')).toBeVisible();
  await answerAllCorrectly(page, b, 'review-summary');
  await page.locator('body').click({ position: { x: 2, y: 2 } });
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('lessons-tile')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__ksrs.store.getState().review)).toBeNull();
});
