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

// ---------------------------------------------------------------- M5 helpers

/** Read-only peeks through the D36 test hook. */
export const peek = {
  maxDueAt: (page: Page) => page.evaluate(() => {
    const s = (window as any).__ksrs.store.getState().derived;
    let m = 0;
    for (const st of s.items.values()) if (st.kind !== 'hanja' && st.availableAt !== null && st.stage < 9) m = Math.max(m, st.availableAt);
    return m;
  }),
  eventCount: (page: Page) => page.evaluate(async () => { const st = (window as any).__ksrs.store; await st.flush(); return st.getState().events.length; }),
  /** itemId → "stage@availableAt" for every learned item, sorted (device-independent projection). */
  projection: (page: Page) => page.evaluate(() => {
    const s = (window as any).__ksrs.store.getState().derived;
    return [...s.items.values()].filter((st: any) => st.lessonAt !== undefined)
      .map((st: any) => `${st.itemId}:${st.stage}@${st.availableAt}`).sort();
  }),
  deviceId: (page: Page) => page.evaluate(() => (window as any).__ksrs.store.getState().deviceId as string),
};

/** Moves the fake clock just past the latest due time and reloads "now" on the dashboard. */
export async function jumpToDue(page: Page): Promise<void> {
  await page.clock.setSystemTime((await peek.maxDueAt(page)) + 60_000);
  await goHome(page);
}

/** One full review session; `choose` may return a different response for a question. */
export async function reviewRound(page: Page, b: Bundle, choose?: (q: Q) => string | null): Promise<void> {
  await jumpToDue(page);
  await page.getByTestId('start-reviews').click();
  for (let g = 0; g < 200; g++) {
    if (await page.getByTestId('review-summary').isVisible()) break;
    const q = await currentQ(page);
    await submit(page, q, choose?.(q) ?? correctAnswer(b, q));
    await expect(page.getByTestId('feedback')).toBeVisible();
    await next(page);
  }
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('lessons-tile')).toBeVisible();
}

/** Downloads a backup from the Data page and returns the saved file path. */
export async function downloadBackup(page: Page, opts: { gzip?: boolean } = {}): Promise<string> {
  await page.evaluate(() => { location.hash = '#/data'; });
  await expect(page.getByTestId('backup-card')).toBeVisible();
  const gz = page.getByTestId('gzip');
  if (await gz.count()) await gz.setChecked(!!opts.gzip);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-backup').click()]);
  const path = await dl.path();
  if (!path) throw new Error('download failed');
  const named = `${path}-${dl.suggestedFilename()}`;
  await dl.saveAs(named);
  return named;
}

/** Restores a backup file on the Data page (Merge by default). Returns the "new events" preview count. */
export async function restoreBackup(page: Page, file: string, mode: 'merge' | 'replace' = 'merge'): Promise<number> {
  await page.evaluate(() => { location.hash = '#/data'; });
  await page.getByTestId('restore-file').setInputFiles(file);
  await expect(page.getByTestId('restore-preview')).toBeVisible();
  const fresh = Number(await page.getByTestId('preview-new').innerText());
  if (mode === 'replace') {
    await page.getByTestId('mode-replace').check({ force: true });
    await page.getByTestId('replace-confirm').fill('REPLACE');
  }
  await page.getByTestId('apply-restore').click();
  await expect(page.getByTestId('restore-msg')).toBeVisible();
  return fresh;
}

export async function dashboardCounts(page: Page): Promise<Record<string, string>> {
  await goHome(page);
  const out: Record<string, string> = {
    level: await page.getByTestId('level').innerText(),
    lessons: await page.getByTestId('lessons-count').innerText(),
    reviews: await page.getByTestId('reviews-count').innerText(),
    passed: (await page.getByTestId('level-progress').getAttribute('data-passed')) ?? '',
  };
  for (const li of await page.getByTestId('stage-counts').locator('[data-stage]').all()) {
    out[(await li.getAttribute('data-stage'))!] = await li.locator('.stage-count').innerText();
  }
  return out;
}

/** Chooser for reviewRound: the first attempt at each matching question is wrong, retries are right. */
export function wrongOnce(b: Bundle, match: (q: Q) => boolean): (q: Q) => string | null {
  const seen = new Set<string>();
  return (q) => {
    if (!match(q) || seen.has(q.qid)) return null;
    seen.add(q.qid);
    return wrongAnswer(b, q);
  };
}

// ---------------------------------------------------------------- master list

export const HEADER = 'word,meaning,hanja,pos,status,times_missed,times_seen,last_seen,freq_rank,sources,tags,notes';
export const FIXTURE_VOCAB = ['결재', '결제', '재량', '얼버무리다', '망설이다', '덤', '결심'];

export function baselineCsv(): string {
  return [
    HEADER,
    '걸치다,"to extend, stretch; to wear",,verb/adj,learning,78,320,2026-08-15,5309,anki,leech shaky,',
    ...FIXTURE_VOCAB.map((w, i) => `${w},${w} gloss,,noun,mastered,7,20,2026-08-0${i + 1},${1000 + i},anki,,`),
    '겨우,barely,,adverb,new,0,0,,800,anki,,',
    '가랑비에 옷 젖는 줄 모른다,small things add up,,속담,new,0,0,,,app,app-L1,',
  ].join('\r\n') + '\r\n';
}

export async function importBaseline(page: Page, csv = baselineCsv()): Promise<void> {
  await page.evaluate(() => { location.hash = '#/data'; });
  await expect(page.getByTestId('master-card')).toBeVisible();
  await page.getByTestId('baseline-file').setInputFiles({ name: 'korean_master_vocab.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByTestId('baseline-preview')).toBeVisible();
  await page.getByTestId('baseline-confirm').click();
  await expect(page.getByTestId('master-msg')).toContainText('as the Anki baseline');
}

