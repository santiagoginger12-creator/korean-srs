// M3 dashboard e2e on the fixture seed (L1: 10 gating items, one of which, -는 통에, can't pass
// before -는 바람에 reaches Guru; L2: 心, 결심, -느라고). Seoul time so axis labels are fixed.
import { expect, test, type Page } from '@playwright/test';
import { answerAllCorrectly, correctAnswer, currentQ, doLessonBatch, goHome, HOUR, next, setup, submit, T0, type Bundle } from './helpers.ts';

test.use({ timezoneId: 'Asia/Seoul' });

/** Read-only peeks at derived state through the D36 test hook. */
const peek = {
  passedL1: (page: Page) => page.evaluate(() => {
    const s = (window as any).__ksrs.store.getState().derived;
    return (s.index.byLevel.get(1) as any[]).filter((it) => it.kind !== 'hanja' && it.gating && s.items.get(it.id)?.passedAt !== undefined).length;
  }),
  maxDueAt: (page: Page) => page.evaluate(() => {
    const s = (window as any).__ksrs.store.getState().derived;
    let m = 0;
    for (const st of s.items.values()) if (st.kind !== 'hanja' && st.availableAt !== null && st.stage < 9) m = Math.max(m, st.availableAt);
    return m;
  }),
};

async function learnEverythingAvailable(page: Page, b: Bundle): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await goHome(page);
    if (await page.getByTestId('lessons-override').isVisible()) await page.getByTestId('lessons-override').click();
    if (Number(await page.getByTestId('lessons-count').innerText()) === 0) return;
    await doLessonBatch(page, b);
  }
}

async function reviewRound(page: Page, b: Bundle): Promise<void> {
  await page.clock.setSystemTime((await peek.maxDueAt(page)) + 60_000);
  await goHome(page);
  await page.getByTestId('start-reviews').click();
  await answerAllCorrectly(page, b, 'review-summary');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('lessons-tile')).toBeVisible();
}

test('forecast: a lesson batch at 12:00 KST shows +N in the 16:00 bucket and today', async ({ page }) => {
  const b = await setup(page);
  await doLessonBatch(page, b); // 2 hanja + 3 reviewable items
  await goHome(page);
  const hourly = page.getByTestId('forecast-24h');
  const bars = hourly.locator('.chart-bar');
  await expect(bars).toHaveCount(24);
  await expect(bars.nth(4)).toHaveAttribute('data-count', '3');
  await expect(bars.nth(4).locator('title')).toHaveText(/16:00: 3 reviews, 3 total$/);
  await expect(hourly.locator('.chart-bar[data-count="0"]')).toHaveCount(23);
  await expect(hourly.locator('.chart-plus')).toHaveText(['+3']);
  await expect(hourly.locator('rect[aria-label*="16:00: 3 reviews"]')).toHaveCount(1);
  const daily = page.getByTestId('forecast-7d').locator('.chart-bar');
  await expect(daily).toHaveCount(7);
  await expect(daily.nth(0)).toHaveAttribute('data-count', '3');
  await expect(page.getByTestId('forecast-7d').locator('figcaption')).toContainText('3 total');
  await expect(page.getByTestId('reviews-tile')).toContainText('16:00');
});

test('level-up happens exactly when L1 crosses 90% (8/10 → no, 9/10 → yes)', async ({ page }) => {
  test.setTimeout(180_000);
  const b = await setup(page);
  await learnEverythingAvailable(page, b);
  await goHome(page);
  await expect(page.getByTestId('level-progress')).toHaveAttribute('data-total', '10');

  for (let r = 0; r < 3; r++) await reviewRound(page, b); // Apprentice 1 → 4
  expect(await peek.passedL1(page)).toBe(0);

  // The Guru round: stop as soon as exactly 8 gating items have passed.
  await page.clock.setSystemTime((await peek.maxDueAt(page)) + 60_000);
  await goHome(page);
  await page.getByTestId('start-reviews').click();
  const answerUntil = async (passed: number) => {
    for (let g = 0; g < 100 && (await peek.passedL1(page)) < passed; g++) {
      const q = await currentQ(page);
      await submit(page, q, correctAnswer(b, q));
      await expect(page.getByTestId('feedback')).toHaveAttribute('data-grade', 'correct');
      await next(page);
    }
    expect(await peek.passedL1(page)).toBe(passed);
  };
  await answerUntil(8);
  await goHome(page);
  await expect(page.getByTestId('level')).toHaveText('1');
  await expect(page.getByTestId('level-progress')).toHaveAttribute('data-passed', '8');
  await expect(page.getByTestId('level-needed')).toHaveText('1 more to Guru to unlock level 2.');
  await expect(page.getByTestId('level-up-banner')).toHaveCount(0);
  const lessonsBefore = Number(await page.getByTestId('lessons-count').innerText());

  await page.getByTestId('start-reviews').click(); // resumes the session
  await answerUntil(9);
  await goHome(page);
  await expect(page.getByTestId('level')).toHaveText('2');
  await expect(page.getByTestId('level-up-banner')).toContainText('Level 2');
  await expect(page.getByTestId('level-progress')).toHaveAttribute('data-total', '2'); // L2: 결심, -느라고
  const lessonsAfter = Number(await page.getByTestId('lessons-count').innerText());
  expect(lessonsAfter).toBeGreaterThan(lessonsBefore); // 心 and -느라고 (and 통에) appear
  await page.getByTestId('level-up-banner').getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByTestId('level-up-banner')).toHaveCount(0);
  // Derived from events, not stored: after a reload there is no banner but level 2 remains.
  await page.reload();
  await expect(page.getByTestId('level')).toHaveText('2');
  await expect(page.getByTestId('level-up-banner')).toHaveCount(0);
});

test('item pages: related vocab by hanja, unlock deps, contrasts in both directions, browse', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { location.hash = '#/item/' + encodeURIComponent('v:결재'); });
  const rel = page.getByTestId('related');
  await expect(rel).toContainText('決');
  await expect(rel.getByRole('link', { name: /결제/ })).toBeVisible();
  await expect(rel.getByRole('link', { name: /결심/ })).toContainText('locked');
  await expect(page.getByTestId('unlock-status')).toContainText('決 lesson');

  await page.evaluate(() => { location.hash = '#/item/' + encodeURIComponent('g:는-통에'); });
  await expect(page.getByTestId('unlock-status')).toContainText('-는 바람에 reaches Guru');
  // 는-바람에 lists 는-통에 (out); 느라고 lists 는-바람에, so 바람에's page shows it as "in".
  await page.evaluate(() => { location.hash = '#/item/' + encodeURIComponent('g:는-바람에'); });
  await expect(page.locator('[data-direction="out"]').filter({ hasText: '-는 통에' })).toBeVisible();
  await expect(page.locator('[data-direction="in"]').filter({ hasText: '-느라고' })).toBeVisible();

  await page.evaluate(() => { location.hash = '#/item/' + encodeURIComponent('h:決'); });
  await expect(page.getByTestId('related')).toContainText('(3)'); // 결재, 결제, 결심

  await page.evaluate(() => { location.hash = '#/browse'; });
  await page.getByTestId('browse-search').fill('hesitate');
  await expect(page.locator('.browse-item')).toHaveCount(1);
  await page.locator('.browse-item').click();
  await expect(page.getByTestId('item-page')).toHaveAttribute('data-item-id', 'v:망설이다');
});

// ---------------------------------------------------------------- QA (M3 review)

const noHorizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test('QA: backlog over 1.5×T shows "clear reviews first"; +5 anyway grants exactly 5 and is spent', async ({ page }) => {
  const b = await setup(page);
  await doLessonBatch(page, b);
  await goHome(page);
  await doLessonBatch(page, b);
  // A 1-minute target makes the due items a backlog (> 90 s); next study day, so nothing done today.
  await page.evaluate(() => (window as any).__ksrs.store.setSetting('targetReviewMin', 1));
  await page.clock.setSystemTime(T0 + 30 * HOUR);
  await goHome(page);
  await expect(page.getByTestId('cap-note')).toContainText('Clear reviews first');
  const hanja = async () => page.evaluate(() => {
    const s = (window as any).__ksrs.store.getState().derived;
    return [...s.unlocked].filter((id: string) => id.startsWith('h:') && s.items.get(id)?.lessonAt === undefined).length;
  });
  const others = async () => Number(await page.getByTestId('lessons-count').innerText()) - (await hanja());
  expect(await others()).toBe(0);
  await page.getByTestId('lessons-override').click();
  await expect(page.getByTestId('cap-note')).toContainText('Today: 0 of 5 done · extra allowance');
  const offered = await others();
  expect(offered).toBeGreaterThan(0);
  expect(offered).toBeLessThanOrEqual(5);
  // Before the fix the extra was added to a cap clamped at 0, so it could be reused all day.
  for (let i = 0; i < 3 && (await others()) > 0; i++) { await doLessonBatch(page, b); await goHome(page); }
  await expect(page.getByTestId('cap-note')).toContainText(`Today: ${offered} of 5 done`);
  if (offered === 5) expect(await others()).toBe(0);
});

test('QA: custom items (no hanja, very long headword) render without crashes or overflow at 390 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  const long = '가나다라마바사아자차카타파하가나다라마바사아자차카타파하가나다라';
  await page.evaluate((long) => {
    const base = { track: 'custom', rev: 1, source: { kind: 'user', license: 'user' }, needs_review: false, tags: [], unlockDeps: [],
      pos: 'noun', register: 'neutral', collocations: [], examples: [], questionTypes: ['meaning', 'production'] };
    const q = (w: string) => ({ meaning: { accepted: ['x'] }, production: { promptEn: 'x', accepted: [w] } });
    return (window as any).__ksrs.store.emit([
      { type: 'customItem.upsert', item: { ...base, id: 'v:qa-plain', kind: 'vocab', level: 1, gating: false, word: '맨말', meanings: ['plain word'], questions: q('맨말') } },
      { type: 'customItem.upsert', item: { ...base, id: 'v:qa-long', kind: 'vocab', level: 1, gating: true, word: long, meanings: ['a very long word'], questions: q(long),
        hanjaBreakdown: [{ syllable: '결', hanja: '決', hanjaId: 'h:決' }] } },
    ]);
  }, long);
  await page.evaluate(() => { location.hash = '#/item/' + encodeURIComponent('v:qa-plain'); });
  await expect(page.getByTestId('item-page')).toHaveAttribute('data-item-id', 'v:qa-plain');
  await expect(page.getByTestId('related')).toHaveCount(0);
  await page.evaluate(() => { location.hash = '#/item/' + encodeURIComponent('v:결재'); });
  await expect(page.getByTestId('related')).toContainText(long);
  expect(await noHorizontalOverflow(page)).toBe(true);
  await page.evaluate(() => { location.hash = '#/item/' + encodeURIComponent('h:決'); });
  await expect(page.getByTestId('related')).toContainText(long);
  expect(await noHorizontalOverflow(page)).toBe(true);
  await goHome(page);
  await expect(page.getByTestId('level-progress')).toHaveAttribute('data-total', '11'); // custom gating item counts
  await expect(page.getByTestId('level-progress')).toContainText(long);
  expect(await noHorizontalOverflow(page)).toBe(true);
});
