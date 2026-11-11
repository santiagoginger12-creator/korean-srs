// Dashboard e2e on the fixture seed. Vocab path: L1 has 7 gating vocab/expression items, L2 결심.
// Grammar path (separate, D63 fixture): stage 1 = -는 바람에, -(으)ㄴ/는 탓에 (gating) + -는 통에
// (non-gating, unlocks at 바람에 Guru); stage 2 = -느라고, -더라도; stage 3 = -기 마련이다.
// No hanja lessons. Seoul time so axis labels are fixed.
import { expect, test, type Page } from '@playwright/test';
import { answerAllCorrectly, correctAnswer, currentQ, doLessonBatch, goHome, HOUR, learnAllLessons, next, setup, submit, T0, type Bundle } from './helpers.ts';

test.use({ timezoneId: 'Asia/Seoul' });

/** Read-only peeks at derived state through the D36 test hook. */
const peek = {
  /** Passed gating items of level 1 on each path, plus the open level / grammar stage. */
  paths: (page: Page) => page.evaluate(() => {
    const s = (window as any).__ksrs.store.getState().derived;
    const l1 = (s.index.byLevel.get(1) as any[]).filter((it) => it.kind !== 'hanja' && it.gating && s.items.get(it.id)?.passedAt !== undefined);
    return { v: l1.filter((it) => it.kind !== 'grammar').length, g: l1.filter((it) => it.kind === 'grammar').length,
      level: s.userLevel as number, stage: s.grammarStage as number };
  }),
  maxDueAt: (page: Page) => page.evaluate(() => {
    const s = (window as any).__ksrs.store.getState().derived;
    let m = 0;
    for (const st of s.items.values()) if (st.kind !== 'hanja' && st.availableAt !== null && st.stage < 9) m = Math.max(m, st.availableAt);
    return m;
  }),
};

async function reviewRound(page: Page, b: Bundle): Promise<void> {
  await page.clock.setSystemTime((await peek.maxDueAt(page)) + 60_000);
  await goHome(page);
  await page.getByTestId('start-reviews').click();
  await answerAllCorrectly(page, b, 'review-summary');
  await page.getByTestId('next-home').click();
  await expect(page.getByTestId('lessons-tile')).toBeVisible();
}

test('forecast: a lesson batch at 12:00 KST shows +N in the 16:00 bucket and today', async ({ page }) => {
  const b = await setup(page);
  await doLessonBatch(page, b); // 5 vocab-path items (no hanja lessons, D63)
  await goHome(page);
  const hourly = page.getByTestId('forecast-24h');
  const bars = hourly.locator('.chart-bar');
  await expect(bars).toHaveCount(24);
  await expect(bars.nth(4)).toHaveAttribute('data-count', '5');
  await expect(bars.nth(4).locator('title')).toHaveText(/16:00: 5 reviews, 5 total$/);
  await expect(hourly.locator('.chart-bar[data-count="0"]')).toHaveCount(23);
  await expect(hourly.locator('.chart-plus')).toHaveText(['+5']);
  await expect(hourly.locator('rect[aria-label*="16:00: 5 reviews"]')).toHaveCount(1);
  const daily = page.getByTestId('forecast-7d').locator('.chart-bar');
  await expect(daily).toHaveCount(7);
  await expect(daily.nth(0)).toHaveAttribute('data-count', '5');
  await expect(page.getByTestId('forecast-7d').locator('figcaption')).toContainText('5 total');
  await expect(page.getByTestId('reviews-tile')).toContainText('16:00');
});

test('separate paths: vocab level 2 at 7/7 (not 6/7), grammar stage 2 at 2/2 (not 1/2), each independent of the other', async ({ page }) => {
  test.setTimeout(180_000);
  const b = await setup(page);
  // Separate lesson buttons: vocab never offers grammar and vice versa.
  await expect(page.getByTestId('grammar-card')).toBeVisible();
  await expect(page.getByTestId('grammar-lessons-count')).toHaveText('2');
  await expect(page.getByTestId('grammar-cap-note')).toContainText('Today: 0 of 3 done');
  const vocabIds = await doLessonBatch(page, b);
  expect(vocabIds.every((id) => !id.startsWith('g:') && !id.startsWith('h:'))).toBe(true);
  await goHome(page);
  const grammarIds = await doLessonBatch(page, b, 'grammar');
  expect(grammarIds.sort()).toEqual(['g:는-바람에', 'g:는-탓에']);
  await goHome(page);
  await expect(page.getByTestId('grammar-lessons-count')).toHaveText('0');
  await expect(page.getByTestId('grammar-cap-note')).toContainText('Today: 2 of 3 done');
  await learnAllLessons(page, b);
  await goHome(page);
  await expect(page.getByTestId('level-progress')).toHaveAttribute('data-total', '7');
  await expect(page.getByTestId('grammar-card')).toHaveAttribute('data-total', '2');

  for (let r = 0; r < 3; r++) await reviewRound(page, b); // Apprentice 1 → 4
  expect(await peek.paths(page)).toEqual({ v: 0, g: 0, level: 1, stage: 1 });

  // The Guru round: items pass one at a time in random order. After every answer the gates must
  // match each path's own count only; at 6/7 and 1/2 the dashboard is checked too.
  await page.clock.setSystemTime((await peek.maxDueAt(page)) + 60_000);
  await goHome(page);
  await page.getByTestId('start-reviews').click();
  let sawV6 = false;
  let sawG1 = false;
  for (let g = 0; g < 100 && !(await page.getByTestId('review-summary').isVisible()); g++) {
    const q = await currentQ(page);
    await submit(page, q, correctAnswer(b, q));
    await expect(page.getByTestId('feedback')).toHaveAttribute('data-grade', 'correct');
    await next(page);
    const p = await peek.paths(page);
    expect(p.level, `vocab ${p.v}/7`).toBe(p.v >= 7 ? 2 : 1);
    expect(p.stage, `grammar ${p.g}/2`).toBe(p.g >= 2 ? 2 : 1);
    if ((p.v === 6 && !sawV6) || (p.g === 1 && !sawG1)) {
      await goHome(page);
      if (p.v === 6 && !sawV6) {
        sawV6 = true;
        await expect(page.getByTestId('level')).toHaveText('1');
        await expect(page.getByTestId('level-needed')).toHaveText('1 more to Guru to unlock level 2.');
      }
      if (p.g === 1 && !sawG1) {
        sawG1 = true;
        await expect(page.getByTestId('grammar-stage')).toHaveText('1');
        await expect(page.getByTestId('grammar-needed')).toHaveText('1 more to Guru to unlock grammar stage 2.');
      }
      await page.getByTestId('start-reviews').click(); // resumes the session
    }
  }
  expect(sawV6 && sawG1).toBe(true);
  await page.getByTestId('next-home').click();
  await goHome(page);
  await expect(page.getByTestId('level')).toHaveText('2');
  await expect(page.getByTestId('level-up-banner')).toContainText('Level 2');
  await expect(page.getByTestId('level-progress')).toHaveAttribute('data-total', '1'); // L2 vocab path: 결심
  await expect(page.getByTestId('grammar-stage')).toHaveText('2');
  // Stage 2 (-느라고, -더라도) and -는 통에 (its guru dep met) are grammar lessons; vocab gets 결심.
  await expect(page.getByTestId('grammar-lessons-count')).toHaveText('3');
  await expect(page.getByTestId('lessons-count')).toHaveText('1');
  await page.getByTestId('level-up-banner').getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByTestId('level-up-banner')).toHaveCount(0);
  // Derived from events, not stored: after a reload there is no banner but level 2 remains.
  await page.reload();
  await expect(page.getByTestId('level')).toHaveText('2');
  await expect(page.getByTestId('level-up-banner')).toHaveCount(0);
});

test('item pages: subtle hanja line (no hanja pages), unlock deps, contrasts both ways, HTSK link, browse', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { location.hash = '#/item/' + encodeURIComponent('v:결재'); });
  await expect(page.getByTestId('item-page')).toHaveAttribute('data-item-id', 'v:결재');
  // One muted line under the meaning; no links, no "Related by hanja", no unlock deps.
  await expect(page.getByTestId('hanja-line')).toHaveText('決裁');
  await expect(page.getByTestId('hanja-line').locator('a')).toHaveCount(0);
  await expect(page.getByTestId('related')).toHaveCount(0);
  await expect(page.getByTestId('unlock-status')).toHaveCount(0);
  // Old hanja links land on Browse, which lists no hanja.
  await page.evaluate(() => { location.hash = '#/item/' + encodeURIComponent('h:決'); });
  await expect(page.getByTestId('browse')).toBeVisible();
  await expect(page.locator('.browse-item[data-item-id^="h:"]')).toHaveCount(0);
  await expect(page.locator('.filter-row .pill', { hasText: 'Hanja' })).toHaveCount(0);

  await page.evaluate(() => { location.hash = '#/item/' + encodeURIComponent('g:는-통에'); });
  await expect(page.getByTestId('unlock-status')).toContainText('-는 바람에 reaches Guru');
  // 는-바람에 lists 는-통에 (out); 느라고 lists 는-바람에, so 바람에's page shows it as "in".
  await page.evaluate(() => { location.hash = '#/item/' + encodeURIComponent('g:는-바람에'); });
  await expect(page.locator('[data-direction="out"]').filter({ hasText: '-는 통에' })).toBeVisible();
  await expect(page.locator('[data-direction="in"]').filter({ hasText: '-느라고' })).toBeVisible();
  // HTSK cross-reference: external link in a new tab; the nuance's trailing "See also" sentence is gone.
  const link = page.getByTestId('htsk-link');
  await expect(link).toHaveText(/HowtoStudyKorean Lesson 126/);
  await expect(link).toHaveAttribute('href', 'https://www.howtostudykorean.com/unit-6/');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener');
  await expect(page.getByTestId('nuance')).not.toContainText('See also');
  await page.evaluate(() => { location.hash = '#/item/' + encodeURIComponent('g:더라도'); });
  await expect(page.getByTestId('htsk-link')).toHaveAttribute('href', 'https://www.howtostudykorean.com/unit-5/');

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
  await doLessonBatch(page, b); // 5 of the 7 vocab-path lessons
  await goHome(page);
  await doLessonBatch(page, b, 'grammar');
  // A 1-minute target makes the due items a backlog (> 90 s); next study day, so nothing done today.
  await page.evaluate(() => (window as any).__ksrs.store.setSetting('targetReviewMin', 1));
  await page.clock.setSystemTime(T0 + 30 * HOUR);
  await goHome(page);
  await expect(page.getByTestId('cap-note')).toContainText('Clear reviews first');
  const others = async () => Number(await page.getByTestId('lessons-count').innerText());
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
  await page.evaluate(() => { location.hash = '#/item/' + encodeURIComponent('v:qa-long'); });
  await expect(page.getByTestId('hanja-line')).toHaveText('決'); // a dangling hanjaId is harmless
  expect(await noHorizontalOverflow(page)).toBe(true);
  await goHome(page);
  await expect(page.getByTestId('level-progress')).toHaveAttribute('data-total', '8'); // custom gating item counts
  await expect(page.getByTestId('level-progress')).toContainText(long);
  expect(await noHorizontalOverflow(page)).toBe(true);
});
