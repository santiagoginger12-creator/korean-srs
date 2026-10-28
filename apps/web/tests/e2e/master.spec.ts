// Master list (docs/MASTER_LIST.md) on the fixture seed: Anki baseline import → a lesson and a
// wrong review → session rows (pasted twice) → export korean_master_vocab.csv; plus the private
// Anki-shaky JSON import shape (empty examples) through lessons, reviews, item pages, browse,
// trouble and practice. Small synthetic data only (the owner's files stay private).
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { doLessonBatch, goHome, HEADER, importBaseline, reviewRound, setup, wrongOnce, type Bundle } from './helpers.ts';

test.use({ timezoneId: 'Asia/Seoul', acceptDownloads: true });

const SESSION_BLOCK = [
  'VOCAB ROWS', '```csv',
  '걸치다,"to extend; to wear",,verb/adj,learning,80,325,2026-10-23,5309,anki convo,leech shaky,missed 걸쳐 앉다',
  '서먹하다,"awkward, distant (between people)",,adj,new,1,1,2026-10-23,,convo,,',
  '```',
].join('\n');

async function pasteSession(page: Page): Promise<void> {
  await page.getByTestId('session-text').fill(SESSION_BLOCK);
  await page.getByTestId('session-preview-btn').click();
  await expect(page.getByTestId('session-preview')).toBeVisible();
}

const parse = (csv: string): Map<string, string[]> => {
  const out = new Map<string, string[]>();
  for (const line of csv.split('\r\n').slice(1)) {
    if (!line) continue;
    const cells = [...line.matchAll(/("(?:[^"]|"")*"|[^,]*)(,|$)/g)].map((m) => m[1]!.replace(/^"|"$/g, '').replace(/""/g, '"')).slice(0, 12);
    out.set(cells[0]!, cells);
  }
  return out;
};

test('baseline → lesson + wrong review → session rows (twice) → export CSV', async ({ page }) => {
  test.setTimeout(120_000);
  const b = await setup(page);
  await importBaseline(page);
  await expect(page.getByTestId('baseline-status')).toContainText('9 rows');

  await goHome(page);
  const ids = await doLessonBatch(page, b);
  const W = ids.find((id) => id.startsWith('v:'))!;
  const wWord = W.slice(2);
  await reviewRound(page, b, wrongOnce(b, (q) => q.itemId === W && q.qtype === 'meaning'));

  // Session rows: preview shows the delta (80 − 78), then record; the same block again is a no-op.
  await page.evaluate(() => { location.hash = '#/data'; });
  await pasteSession(page);
  await expect(page.locator('[data-testid=session-row][data-word="걸치다"]')).toHaveAttribute('data-missed', '2');
  await expect(page.locator('[data-testid=session-row][data-word="서먹하다"]')).toHaveAttribute('data-new', 'true');
  await page.getByTestId('session-record').click();
  await expect(page.getByTestId('master-msg')).toContainText('Recorded 2 rows; 1 new item added to lessons');
  await pasteSession(page);
  await expect(page.getByTestId('session-duplicate')).toBeVisible();
  await expect(page.getByTestId('session-record')).toBeDisabled();
  await expect(page.getByTestId('session-count')).toHaveText('1 recorded');

  // Export (plain browser path: <a download>).
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-master').click()]);
  expect(dl.suggestedFilename()).toBe('korean_master_vocab.csv');
  const csv = readFileSync((await dl.path())!, 'utf8');
  expect(csv.startsWith(HEADER + '\r\n')).toBe(true);
  expect(csv.charCodeAt(0)).not.toBe(0xfeff);
  const rows = parse(csv);
  expect(rows.has('가랑비에 옷 젖는 줄 모른다')).toBe(false); // not from Anki, not in this app's content
  expect(rows.get('걸치다')!.slice(4)).toEqual(['learning', '80', '325', '2026-10-23', '5309', 'anki convo', 'leech shaky', 'missed 걸쳐 앉다']);
  // The word with one wrong app answer: 7 Anki misses + 1 = 8 → learning + leech; seen 20 + lesson + 1 review.
  const w = rows.get(wWord)!;
  expect(w[4]).toBe('learning');
  expect(w[5]).toBe('8');
  expect(w[6]).toBe('22');
  expect(w[7]).toBe('2026-10-23');
  expect(w[9]).toBe('anki app');
  expect(w[10]).toBe('leech app-L1');
  // Another studied fixture word, mastered in Anki: lesson done without new misses → still mastered.
  const other = ids.find((id) => id.startsWith('v:') && id !== W)!.slice(2);
  expect(rows.get(other)!.slice(4, 6)).toEqual(['mastered', '7']);
  // The new conversation word, now also an app item.
  expect(rows.get('서먹하다')!.slice(1, 11)).toEqual(['awkward, distant (between people)', '', 'adj', 'new', '1', '1', '2026-10-23', '', 'app convo', '']);
  expect(rows.get('겨우')![4]).toBe('new');
  // Order: learning first by misses (걸치다 80, then W 8), then new, mastered.
  const order = [...rows.values()].map((r) => r[4]);
  expect(order.indexOf('new')).toBeGreaterThan(order.lastIndexOf('learning'));
  expect([...rows.keys()].slice(0, 2)).toEqual(['걸치다', wWord]);
  await expect(page.getByTestId('last-export')).not.toHaveText('never');

  // Dashboard line.
  await goHome(page);
  const learning = order.filter((s) => s === 'learning').length;
  await expect(page.getByTestId('master-line')).toContainText(`${learning} learning · last export 2026-10-23`);
  await page.getByTestId('master-line').getByRole('link').click();
  await expect(page.getByTestId('master-card')).toBeVisible();
});

test('Anki-shaky JSON items (no examples) work in lessons, reviews, item page, browse, trouble and practice', async ({ page }) => {
  test.setTimeout(150_000);
  const b = await setup(page);
  const mk = (word: string, en: string[]) => ({
    id: `v:${word}`, kind: 'vocab', level: 1, track: 'anki', rev: 1, unlockDeps: [], gating: false,
    source: { kind: 'import', license: 'personal-use', attribution: 'Personal Anki deck (private import)' }, needs_review: false,
    tags: ['anki', 'anki-shaky', 'anki-leech'], questionTypes: ['meaning', 'production'],
    questions: { meaning: { accepted: en }, production: { promptEn: en[0], contextHint: 'missed 12× in Anki', accepted: [word] } },
    word, meanings: en, pos: 'adverb', register: 'neutral', collocations: [], examples: [],
  });
  const items = [mk('미처', ['not yet', 'before (one could)']), mk('기어이', ['at last', 'persistently'])];
  b.items.push(...(items as Bundle['items']));

  await page.evaluate(() => { location.hash = '#/data'; });
  await page.getByTestId('import-file').setInputFiles({ name: 'anki-shaky-import.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(items)) });
  await expect(page.getByTestId('import-preview')).toBeVisible();
  await expect(page.getByTestId('import-preview')).toContainText('2 warnings');
  await page.getByTestId('import-confirm').click();
  await expect(page.getByTestId('import-msg')).toContainText('Imported 2 items');

  // Item page and browse.
  await page.evaluate(() => { location.hash = '#/item/' + encodeURIComponent('v:미처'); });
  await expect(page.getByTestId('item-page')).toBeVisible();
  await page.evaluate(() => { location.hash = '#/browse'; });
  await page.getByTestId('browse-search').fill('기어이');
  await expect(page.getByTestId('browse').getByText('기어이').first()).toBeVisible();

  // Practice source exists before any lesson (practice emits no events).
  await page.evaluate(() => { location.hash = '#/practice'; });
  await page.getByTestId('src-tag').check({ force: true });
  await page.getByTestId('start-practice').click();
  await expect(page.getByTestId('question')).toBeVisible();
  expect(['v:미처', 'v:기어이']).toContain(await page.getByTestId('question').getAttribute('data-item-id'));

  // Lessons until both imported items are learned, then a review with one wrong answer on 미처.
  const learned = new Set<string>();
  for (let i = 0; i < 4 && !(learned.has('v:미처') && learned.has('v:기어이')); i++) {
    await goHome(page);
    for (const id of await doLessonBatch(page, b)) learned.add(id);
  }
  expect(learned.has('v:미처') && learned.has('v:기어이')).toBe(true);
  await reviewRound(page, b, wrongOnce(b, (q) => q.itemId === 'v:미처' && q.qtype === 'meaning'));

  // One app miss is enough for a known Anki leech to reach the trouble list.
  await goHome(page);
  await expect(page.getByTestId('trouble-link')).toBeVisible();
  await page.getByTestId('trouble-link').click();
  await expect(page.locator('[data-testid=trouble-row][data-item-id="v:미처"]')).toBeVisible();
  await expect(page.locator('[data-testid=trouble-row][data-item-id="v:기어이"]')).toHaveCount(0);
});
