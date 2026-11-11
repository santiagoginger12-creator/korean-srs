// Dictionary example sentences on the fixture seed + tests/e2e/fixture-examples.json:
// feedback strip (only after answering, rotates between reviews, credit), item page and lesson
// page sections, the "Dictionary examples in reviews" setting, and 390×844 owner screenshots.
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { correctAnswer, currentQ, goHome, HOUR, jumpToDue, next, setup, submit, T0, type Bundle } from './helpers.ts';

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: 'Asia/Seoul' });

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, '../../test-results');
const EXAMPLES = JSON.parse(readFileSync(join(HERE, 'fixture-examples.json'), 'utf8')) as { items: Record<string, unknown[]> };
const searchUrl = (w: string) => `https://krdict.korean.go.kr/dicSearch/search?mainSearchWord=${encodeURIComponent(w)}`;
const headwordOf = (b: Bundle, id: string) => { const it = b.items.find((i) => i.id === id) as any; return it.word ?? it.text; };
const shot = async (page: Page, name: string) => { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, `${name}-390x844.png`) }); };

/** Teach pages (lesson sections must start collapsed) → quiz (example only after answering) → finish. */
async function lessonBatch(page: Page, b: Bundle, dict = true): Promise<string[]> {
  await page.getByTestId('start-lessons').click();
  const ids: string[] = [];
  let sawSection = false;
  for (let g = 0; g < 30; g++) {
    const lp = page.getByTestId('lesson-page');
    const id = (await lp.getAttribute('data-item-id'))!;
    ids.push(id);
    if (!dict) await expect(page.getByTestId('more-examples')).toHaveCount(0);
    else if (EXAMPLES.items[id]) {
      const sec = page.getByTestId('more-examples');
      await expect(sec).toBeVisible();
      await expect(sec).not.toHaveAttribute('open', /.*/);
      await expect(sec.getByTestId('dict-example').first()).toBeHidden();
      sawSection = true;
    }
    if (await page.getByTestId('start-quiz').isVisible()) { await page.getByTestId('start-quiz').click(); break; }
    await page.getByRole('button', { name: 'Next', exact: true }).click();
  }
  expect(sawSection, 'a lesson page with dictionary examples').toBe(dict);
  for (let g = 0; g < 100 && !(await page.getByTestId('quiz-done').isVisible()); g++) {
    const q = await currentQ(page);
    await expect(page.getByTestId('fb-example')).toHaveCount(0);
    await submit(page, q, correctAnswer(b, q));
    await expect(page.getByTestId('feedback')).toBeVisible();
    if (/^[vx]:/.test(q.itemId)) {
      await expect(page.getByTestId('fb-example')).toBeVisible();
      if (!dict) await expect(page.getByTestId('fb-example')).toHaveAttribute('data-source', 'original');
    } else await expect(page.getByTestId('fb-example')).toHaveCount(0); // grammar: no example strip
    await next(page);
  }
  await page.getByRole('button', { name: 'Finish lessons' }).click();
  await expect(page.getByTestId('lessons-done')).toBeVisible();
  return ids;
}

interface Seen { key: string; source: string }
/**
 * One review session, all answers correct. Asserts the example never shows before submitting.
 * Returns itemId → the example shown (the same for every question of an item in one review).
 */
async function reviewSession(page: Page, b: Bundle, onFeedback?: (q: { itemId: string }, s: Seen) => Promise<void>): Promise<Map<string, Seen>> {
  await page.getByTestId('start-reviews').click();
  const seen = new Map<string, Seen>();
  for (let g = 0; g < 100; g++) {
    if (await page.getByTestId('review-summary').isVisible()) break;
    const q = await currentQ(page);
    await expect(page.getByTestId('fb-example')).toHaveCount(0);
    await submit(page, q, correctAnswer(b, q));
    await expect(page.getByTestId('feedback')).toBeVisible();
    if (/^[vx]:/.test(q.itemId)) {
      const ex = page.getByTestId('fb-example');
      await expect(ex).toBeVisible();
      const s = { key: (await ex.getAttribute('data-example-key'))!, source: (await ex.getAttribute('data-source'))! };
      const prev = seen.get(q.itemId);
      if (prev) expect(prev.key, 'one example per item per review').toBe(s.key);
      seen.set(q.itemId, s);
      await onFeedback?.(q, s);
    }
    await next(page);
  }
  await page.getByTestId('next-home').click();
  await expect(page.getByTestId('lessons-tile')).toBeVisible();
  return seen;
}

test('dictionary examples: after answering only, highlighted + credited, rotate per review; item page lists all; setting off hides them', async ({ page }) => {
  test.setTimeout(150_000);
  const b = await setup(page);
  await expect.poll(() => page.evaluate(async () => (await fetch('examples.json')).status)).toBe(200);
  const batch = await lessonBatch(page, b);

  // First reviews.
  await page.clock.setSystemTime(T0 + 5 * HOUR);
  await goHome(page);
  let shotTaken = false;
  const first = await reviewSession(page, b, async (q, s) => {
    const ex = page.getByTestId('fb-example');
    if (s.source === 'dict') {
      await expect(ex.getByTestId('ex-hit').first()).toBeVisible();
      const link = ex.getByTestId('ex-credit-link');
      await expect(link).toHaveText('한국어기초사전 (국립국어원) · CC BY-SA');
      await expect(link).toHaveAttribute('href', searchUrl(headwordOf(b, q.itemId)));
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', /noopener/);
      await expect(ex.getByRole('button', { name: 'Show English' })).toHaveCount(0); // no English for KRDict
      if (!shotTaken) {
        // Compact: the Next button stays on screen at 390×844.
        const nb = await page.getByTestId('feedback').getByRole('button', { name: 'Next', exact: true }).boundingBox();
        expect(nb && nb.y + nb.height).toBeLessThanOrEqual(844);
        await shot(page, 'review-dict-example');
        shotTaken = true;
      }
    } else {
      // Original example: headword highlighted, English on tap.
      await expect(ex.getByTestId('ex-credit')).toHaveCount(0);
      await ex.getByRole('button', { name: 'Show English' }).click();
      await expect(ex.getByTestId('fb-example-en')).toBeVisible();
    }
  });
  expect(shotTaken, 'a dictionary example in the first reviews').toBe(true);
  const vx = batch.filter((id) => /^[vx]:/.test(id));
  expect([...first.keys()].sort()).toEqual([...vx].sort());

  // Next review of the same items, after a clock jump: a different example each.
  await jumpToDue(page);
  const second = await reviewSession(page, b);
  expect(second.size).toBeGreaterThan(0);
  for (const [id, s] of second) expect(s.key, `${id} shows a different example`).not.toBe(first.get(id)!.key);

  // Item page: every dictionary example, expanded, with dialogue lines, highlights and credit.
  await page.evaluate(() => { location.hash = `#/item/${encodeURIComponent('v:망설이다')}`; });
  const sec = page.getByTestId('more-examples');
  await expect(sec).toHaveAttribute('open', /.*/);
  await expect(sec.getByTestId('dict-example')).toHaveCount(EXAMPLES.items['v:망설이다']!.length);
  await expect(sec.getByTestId('ex-dialogue').locator('.dialogue-line')).toHaveCount(2);
  await expect(sec.getByTestId('ex-hit')).toHaveCount(3);
  await expect(sec.getByTestId('ex-credit-link')).toHaveAttribute('href', searchUrl('망설이다'));
  await expect(sec.getByTestId('ex-license-link')).toHaveAttribute('href', 'https://creativecommons.org/licenses/by-sa/2.0/kr/');
  // The original examples are still there, unchanged.
  await expect(page.locator('.details .examples').first().locator('li')).toHaveCount(2);
  // Frame the original examples' tail and the whole dictionary section.
  await page.evaluate(() => { document.querySelector('[data-testid="more-examples"]')!.scrollIntoView({ block: 'start' }); window.scrollBy(0, -220); });
  await shot(page, 'item-more-examples');

  // Settings: credit, and the toggle. Off → reviews show only the items' own examples.
  await page.evaluate(() => { location.hash = '#/settings'; });
  await expect(page.getByTestId('examples-credit')).toContainText('한국어기초사전');
  await expect(page.getByTestId('examples-credit')).toContainText('CC BY-SA 2.0 KR');
  const toggle = page.getByTestId('set-dict-examples');
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();
  await jumpToDue(page);
  const third = await reviewSession(page, b);
  expect(third.size).toBeGreaterThan(0);
  for (const [id, s] of third) expect(s.source, `${id}: dictionary examples off`).toBe('original');
  // Still listed on the item page (the setting is about reviews).
  await page.evaluate(() => { location.hash = `#/item/${encodeURIComponent('v:망설이다')}`; });
  await expect(page.getByTestId('more-examples').getByTestId('dict-example')).toHaveCount(3);
});

test('without examples.json the app still works: original examples rotate, no dictionary sections', async ({ page }) => {
  await page.route('**/examples.json', (r) => r.fulfill({ status: 404, body: 'not found' }));
  const b = await setup(page);
  const batch = await lessonBatch(page, b, false);
  await page.evaluate((id) => { location.hash = `#/item/${encodeURIComponent(id)}`; }, batch.find((id) => id.startsWith('v:'))!);
  await expect(page.getByTestId('item-page')).toBeVisible();
  await expect(page.getByTestId('more-examples')).toHaveCount(0);
});
