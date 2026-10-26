// Shared e2e helpers. Answers are derived from the served content bundle plus the
// data-* attributes on the question card, so the tests don't depend on which seed items
// exist (the Content/QA agents are still editing the seed).
import { expect, type Page } from '@playwright/test';

export const T0 = new Date('2026-10-23T03:00:00Z').getTime(); // 12:00 in Seoul
export const HOUR = 3_600_000;

type AnyItem = { id: string; kind: string; questions?: Record<string, any> };
export interface Bundle { items: AnyItem[] }

export async function setup(page: Page, opts: { clock?: boolean } = {}): Promise<Bundle> {
  // The Pretendard CDN is unreachable in agent sessions; the app must work without it.
  await page.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
  page.on('pageerror', (e) => { throw e; });
  if (opts.clock !== false) await page.clock.install({ time: T0 });
  await page.goto('./');
  await expect(page.getByTestId('lessons-tile')).toBeVisible();
  const res = await page.request.get('content.bundle.json');
  return (await res.json()) as Bundle;
}

export interface Q { qtype: string; itemId: string; promptId: string; qid: string }

export async function currentQ(page: Page): Promise<Q> {
  const card = page.getByTestId('question');
  await expect(card).toBeVisible();
  return {
    qtype: (await card.getAttribute('data-qtype'))!,
    itemId: (await card.getAttribute('data-item-id'))!,
    promptId: (await card.getAttribute('data-prompt-id')) ?? '',
    qid: (await card.getAttribute('data-qid'))!,
  };
}

export function correctAnswer(b: Bundle, q: Q): string {
  const it = b.items.find((i) => i.id === q.itemId)!;
  const spec = it.questions![q.qtype];
  switch (q.qtype) {
    case 'meaning': case 'production': return spec.accepted[0];
    case 'cloze': case 'register': return spec.find((p: any) => p.id === q.promptId).accepted[0];
    case 'nuance': return spec.find((p: any) => p.id === q.promptId).options.find((o: any) => o.correct).text;
  }
  throw new Error(`unknown qtype ${q.qtype}`);
}

export function wrongAnswer(b: Bundle, q: Q): string {
  if (q.qtype === 'meaning') return 'refrigerator';
  if (q.qtype === 'nuance') {
    const it = b.items.find((i) => i.id === q.itemId)!;
    return it.questions!.nuance.find((p: any) => p.id === q.promptId).options.find((o: any) => !o.correct).text;
  }
  return '냉장고를 샀어요';
}

/** Submits `text` for the current question (text input or nuance option). */
export async function submit(page: Page, q: Q, text: string): Promise<void> {
  if (q.qtype === 'nuance') {
    await page.locator('.option', { hasText: text }).first().click();
  } else {
    const input = page.locator('input.answer');
    await input.fill(text);
    await input.press('Enter');
  }
}

export async function next(page: Page): Promise<void> {
  await page.getByTestId('feedback').getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByTestId('feedback')).toHaveCount(0);
}

/** Answers every remaining question correctly until `doneTestId` appears. */
export async function answerAllCorrectly(page: Page, b: Bundle, doneTestId: string): Promise<number> {
  let n = 0;
  for (let guard = 0; guard < 200; guard++) {
    if (await page.getByTestId(doneTestId).isVisible()) return n;
    const q = await currentQ(page);
    await submit(page, q, correctAnswer(b, q));
    await expect(page.getByTestId('feedback')).toHaveAttribute('data-grade', 'correct');
    n++;
    await next(page);
  }
  throw new Error('session never finished');
}

/** Teach pages → quiz → finish. Returns the item ids of the batch. */
export async function doLessonBatch(page: Page, b: Bundle): Promise<string[]> {
  await page.getByTestId('start-lessons').click();
  const ids: string[] = [];
  for (let guard = 0; guard < 50; guard++) {
    const lp = page.getByTestId('lesson-page');
    await expect(lp).toBeVisible();
    ids.push((await lp.getAttribute('data-item-id'))!);
    const start = page.getByTestId('start-quiz');
    if (await start.isVisible()) { await start.click(); break; }
    await page.getByRole('button', { name: 'Next', exact: true }).click();
  }
  if (await page.getByTestId('question').isVisible().catch(() => false) || await page.getByTestId('quiz-done').isVisible().catch(() => false)) {
    await answerAllCorrectly(page, b, 'quiz-done');
    await page.getByRole('button', { name: 'Finish lessons' }).click();
  }
  await expect(page.getByTestId('lessons-done')).toBeVisible();
  return ids;
}

export async function readEvents(page: Page): Promise<any[]> {
  return page.evaluate(() => new Promise<any[]>((ok, fail) => {
    const r = indexedDB.open('ksrs');
    r.onerror = () => fail(r.error);
    r.onsuccess = () => {
      const g = r.result.transaction('events').objectStore('events').index('hlc').getAll();
      g.onsuccess = () => { ok(g.result); r.result.close(); };
      g.onerror = () => fail(g.error);
    };
  }));
}

/** Waits until the store has flushed all queued IndexedDB writes. */
export async function flush(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__ksrs.store.flush());
}

export async function goHome(page: Page): Promise<void> {
  // After page.clock jumps, a dashboard that is already mounted still holds the old "now"
  // until its 30 s tick; a focus event is the app's own refresh path (returning to the tab).
  await page.evaluate(() => { location.hash = '#/'; window.dispatchEvent(new Event('focus')); });
  await expect(page.getByTestId('lessons-tile')).toBeVisible();
}
