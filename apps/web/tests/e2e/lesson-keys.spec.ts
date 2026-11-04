import { expect, test } from '@playwright/test';
import { setup } from './helpers.ts';

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
