import { expect, test } from '@playwright/test';
import {
  answerAllCorrectly, correctAnswer, currentQ, doLessonBatch, flush, goHome, HOUR, next, readEvents, setup, submit, T0, wrongAnswer,
} from './helpers.ts';

// Runs against the fixture seed (tests/e2e/fixture-seed: the original 10 M1 items), so the
// behaviour checks don't break when the real seed changes. See real-seed.spec.ts for the
// smoke test and owner screenshots on the live seed.

test('1. fresh start → lesson batch → quiz → lesson.completed persisted', async ({ page }) => {
  const b = await setup(page);
  await expect(page.getByTestId('reviews-count')).toHaveText('0');
  const batch = await doLessonBatch(page, b);
  expect(batch.length).toBe(5);
  await flush(page);
  const evs = await readEvents(page);
  const done = evs.filter((e) => e.type === 'lesson.completed').map((e) => e.itemId).sort();
  expect(done).toEqual([...batch].sort());
  expect(evs.filter((e) => e.type === 'review.answer')).toHaveLength(0); // the quiz emits nothing
  // Survives a reload (IndexedDB is the source of truth).
  await page.reload();
  await goHome(page);
  await expect(page.getByTestId('reviews-tile')).toContainText('Next in');
});

test('2. time passes → reviews: close (shake), incorrect, undo, "I was right", completion', async ({ page }) => {
  const b = await setup(page);
  await doLessonBatch(page, b);
  await page.clock.setSystemTime(T0 + 5 * HOUR);
  await goHome(page);
  const due = Number(await page.getByTestId('reviews-count').innerText());
  expect(due).toBeGreaterThan(0);
  await page.getByTestId('start-reviews').click();

  // Find a typed-answer question for the close/undo/override checks.
  let q = await currentQ(page);
  for (let g = 0; q.qtype === 'nuance' && g < 30; g++) {
    await submit(page, q, correctAnswer(b, q)); await next(page); q = await currentQ(page);
  }
  expect(q.qtype).not.toBe('nuance');
  const input = page.locator('input.answer');

  // Close: empty submit → shake + hint, no event, same question.
  await input.fill('');
  await input.press('Enter');
  await expect(page.getByTestId('hint')).toBeVisible();
  await expect(input).toHaveClass(/shake/);
  await expect(page.getByTestId('feedback')).toHaveCount(0);

  // Incorrect → Undo → the response comes back for editing.
  const wrong = wrongAnswer(b, q);
  await submit(page, q, wrong);
  await expect(page.getByTestId('feedback')).toHaveAttribute('data-grade', 'incorrect');
  await expect(page.getByTestId('fb-response')).toHaveText(wrong);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByTestId('feedback')).toHaveCount(0);
  expect((await currentQ(page)).qid).toBe(q.qid);
  await expect(input).toHaveValue(wrong);

  // Incorrect again → "I was right" (+ accept in future).
  await input.press('Enter');
  await expect(page.getByTestId('feedback')).toHaveAttribute('data-grade', 'incorrect');
  await page.getByLabel('Accept this answer in future').check();
  await page.getByRole('button', { name: 'I was right' }).click();
  await expect(page.getByTestId('feedback')).toHaveAttribute('data-grade', 'correct');
  await expect(page.getByTestId('feedback')).toContainText('self-graded');
  await next(page);

  await answerAllCorrectly(page, b, 'review-summary');
  await flush(page);
  const evs = await readEvents(page);
  const answers = evs.filter((e) => e.type === 'review.answer');
  const voids = evs.filter((e) => e.type === 'event.void');
  const override = answers.find((e) => e.selfGraded);
  expect(voids).toHaveLength(1);
  expect(answers.find((e) => e.id === voids[0].targetId)?.response).toBe(wrong);
  expect(override?.overrides).toBeTruthy();
  expect(answers.find((e) => e.id === override!.overrides)?.grade).toBe('incorrect');
  expect(evs.filter((e) => e.type === 'userAnswer.add').map((e) => e.answer)).toEqual([wrong]);
  // The closeAttempt is embedded in the answer, not an event (D7).
  expect(answers.find((e) => e.id === voids[0].targetId)?.check.closeAttempts).toBe(1);

  await page.getByTestId('next-home').click();
  await expect(page.getByTestId('reviews-count')).toHaveText('0');
});

test('3. reload mid-review resumes the session', async ({ page }) => {
  const b = await setup(page);
  await doLessonBatch(page, b);
  await page.clock.setSystemTime(T0 + 5 * HOUR);
  await goHome(page);
  await page.getByTestId('start-reviews').click();
  for (let i = 0; i < 2; i++) {
    const q = await currentQ(page);
    await submit(page, q, i === 0 ? wrongAnswer(b, q) : correctAnswer(b, q));
    await next(page);
  }
  const before = await page.getByTestId('remaining').innerText();
  const qBefore = await currentQ(page);
  await flush(page);

  await page.reload();
  await expect(page.getByTestId('question')).toBeVisible();
  expect((await currentQ(page)).qid).toBe(qBefore.qid);
  await expect(page.getByTestId('remaining')).toHaveText(before);

  // Home shows the resumable session too.
  await goHome(page);
  await expect(page.getByTestId('start-reviews')).toHaveText('Resume reviews');
  await page.getByTestId('start-reviews').click();
  await answerAllCorrectly(page, b, 'review-summary');
  await flush(page);
  const evs = await readEvents(page);
  expect(evs.filter((e) => e.type === 'review.answer' && e.grade === 'incorrect')).toHaveLength(1);
});

test('4. IME: Enter during composition submits the whole word (CDP)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP IME is Chromium-only');
  const b = await setup(page);
  await page.getByTestId('start-lessons').click();
  while (!(await page.getByTestId('start-quiz').isVisible())) await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByTestId('start-quiz').click();
  let q = await currentQ(page);
  // A typed-Korean question for some item other than 망설이다 (so the typed word grades incorrect and is echoed).
  for (let g = 0; (q.qtype === 'meaning' || q.qtype === 'nuance' || q.itemId === 'v:망설이다') && g < 40; g++) {
    await submit(page, q, correctAnswer(b, q)); await next(page); q = await currentQ(page);
  }
  expect(['production', 'cloze', 'register']).toContain(q.qtype);
  const input = page.locator('input.answer');
  await expect(input).toHaveAttribute('lang', 'ko');
  await input.focus();

  const cdp = await page.context().newCDPSession(page);
  const compose = (text: string) => cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
  // 망 설 이 are composed and committed one syllable at a time, as a dubeolsik IME does.
  for (const steps of [['ㅁ', '마', '망'], ['ㅅ', '서', '설'], ['ㅇ', '이']]) {
    for (const s of steps) await compose(s);
    await cdp.send('Input.insertText', { text: steps[steps.length - 1]! });
  }
  // 다 is still composing when Enter is pressed.
  await compose('ㄷ');
  await compose('다');
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await cdp.send('Input.insertText', { text: '다' }); // the IME commits → compositionend
  await expect(page.getByTestId('feedback')).toBeVisible();
  await expect(page.getByTestId('fb-response')).toHaveText('망설이다');
  await expect(input).toHaveValue('망설이다');
  // Exactly one submission: the feedback is for this question and was not skipped past.
  expect((await currentQ(page)).qid).toBe(q.qid);

  // Fallback path: Enter during composition with no compositionend → submits after 50 ms.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByTestId('feedback')).toHaveCount(0);
  await input.fill('');
  await input.focus();
  await cdp.send('Input.insertText', { text: '망설이' });
  await compose('다');
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await expect(page.getByTestId('fb-response')).toHaveText('망설이다');
});

test('5. offline reload after the first load (service worker)', async ({ page, context }) => {
  await setup(page, { clock: false });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  }
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('lessons-tile')).toBeVisible();
  await expect(page.getByTestId('lessons-count')).not.toHaveText('0');
  await page.getByTestId('start-lessons').click();
  await expect(page.getByTestId('lesson-page')).toBeVisible();
  await context.setOffline(false);
});
