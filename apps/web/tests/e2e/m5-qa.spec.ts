// M5 QA regressions (independent review): data safety (schema upgrade, atomic Replace, secrets,
// quarantine round-trip, damaged files, large logs), partial custom items, practice.
import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { doLessonBatch, downloadBackup, goHome, peek, readEvents, setup } from './helpers.ts';

test.use({ timezoneId: 'Asia/Seoul', acceptDownloads: true });

const tmp = (name: string): string => join(mkdtempSync(join(tmpdir(), 'ksrs-qa-')), name);

async function pickRestoreFile(page: Page, file: string): Promise<void> {
  await page.evaluate(() => { location.hash = '#/data'; });
  await page.getByTestId('restore-file').setInputFiles(file);
}

test('IndexedDB v1 (m3-era) data survives the v2 upgrade intact', async ({ page, browser }) => {
  const b = await setup(page);
  await doLessonBatch(page, b);
  const events = await readEvents(page);
  expect(events.length).toBeGreaterThan(0);
  const deviceId = await peek.deviceId(page);

  // A brand-new profile: write an m3-era (version 1) database by hand on the app's origin
  // before the app ever opens it, then load M5.
  const ctx = await browser.newContext({ timezoneId: 'Asia/Seoul' });
  const p2 = await ctx.newPage();
  await p2.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
  await p2.clock.install({ time: await page.evaluate(() => Date.now()) });
  await p2.goto('content.bundle.json');
  await p2.evaluate(({ evs, dev }) => new Promise<void>((ok, fail) => {
    const r = indexedDB.open('ksrs', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('events', { keyPath: 'id' }).createIndex('hlc', 'hlc');
      d.createObjectStore('kv');
      d.createObjectStore('content', { keyPath: 'key' });
    };
    r.onerror = () => fail(r.error);
    r.onsuccess = () => {
      const t = r.result.transaction(['events', 'kv'], 'readwrite');
      for (const e of evs) t.objectStore('events').put(e);
      t.objectStore('kv').put(dev, 'deviceId');
      t.oncomplete = () => { r.result.close(); ok(); };
      t.onerror = () => fail(t.error);
    };
  }), { evs: events, dev: deviceId });
  await p2.goto('./');
  await expect(p2.getByTestId('lessons-tile')).toBeVisible();
  const version = await p2.evaluate(() => new Promise<number>((ok) => { const r = indexedDB.open('ksrs'); r.onsuccess = () => { ok(r.result.version); r.result.close(); }; }));
  expect(version).toBe(2);
  expect(await readEvents(p2)).toEqual(events);
  expect(await peek.deviceId(p2)).toBe(deviceId);
  expect(await peek.projection(p2)).toEqual(await peek.projection(page));
  await ctx.close();
});

test('Replace is atomic: a failure part-way through leaves the old log untouched', async ({ page }) => {
  const b = await setup(page);
  await doLessonBatch(page, b);
  const before = await readEvents(page);
  const err = await page.evaluate(async () => {
    const st = (window as any).__ksrs.store;
    const evs = st.getState().events.map((e: any) => ({ ...e, id: e.id + 'x' }));
    // An uncloneable value in the middle makes IndexedDB throw after clear() + some puts.
    evs[Math.floor(evs.length / 2)].poison = () => 1;
    try { await st.restore(evs, [], 'replace', 'test'); return null; } catch (e) { return String(e); }
  });
  expect(err).not.toBeNull();
  expect(await readEvents(page)).toEqual(before);
  expect(await peek.eventCount(page)).toBe(before.length);
  await page.reload();
  await goHome(page);
  expect(await readEvents(page)).toEqual(before);
});

test('damaged backup files are rejected with a message and change nothing', async ({ page }) => {
  const b = await setup(page);
  await doLessonBatch(page, b);
  const good = readFileSync(await downloadBackup(page));
  const n = await peek.eventCount(page);
  const cases: [string, Buffer | string, RegExp][] = [
    ['empty.ksrs.json', '', /not JSON/],
    ['corrupt.ksrs.json', good.subarray(0, Math.floor(good.length / 2)), /not JSON/],
    ['truncated.ksrs.json.gz', gzipSync(good).subarray(0, 60), /Couldn't open|not JSON|damaged/],
    ['wrong.json', JSON.stringify({ hello: 'world' }), /isn't a ksrs backup/],
    ['array.json', '[1,2,3]', /isn't a ksrs backup/],
    ['future.ksrs.json', JSON.stringify({ ...JSON.parse(good.toString()), formatVersion: 2 }), /newer version/],
    ['binary.ksrs.json', Buffer.from([0, 1, 2, 3, 255, 254]), /not JSON/],
  ];
  for (const [name, data, re] of cases) {
    const f = tmp(name);
    writeFileSync(f, data);
    await pickRestoreFile(page, f);
    await expect(page.getByTestId('restore-msg'), name).toContainText(re);
    await expect(page.getByTestId('restore-preview')).toHaveCount(0);
  }
  expect(await peek.eventCount(page)).toBe(n);
});

test('future-version and conflicting events: quarantined, kept, and carried by the next backup', async ({ page, browser }) => {
  const b = await setup(page);
  await doLessonBatch(page, b);
  const file = await downloadBackup(page);
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const ev0 = json.events[0];
  const future = { ...ev0, id: '0190f000-0000-7000-8000-00000000f00d', v: 2, type: 'review.rated', hlc: ev0.hlc.replace(/\.[^.]+$/, '.zz') };
  const conflict = { ...json.events[1], itemId: 'v:different' };
  json.events = [...json.events.slice(2), future, conflict, json.events[0]];
  // The file is internally consistent (valid checksum): only the app can spot these.
  const { createHash } = await import('node:crypto');
  const canon = (v: unknown): string => v === null || typeof v !== 'object' ? JSON.stringify(v)
    : Array.isArray(v) ? `[${v.map(canon).join(',')}]`
    : `{${Object.keys(v as object).sort().filter((k) => (v as any)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canon((v as any)[k])}`).join(',')}}`;
  json.eventCount = json.events.length;
  json.checksum = 'sha256:' + createHash('sha256').update(canon(json.events)).digest('hex');
  const crafted = tmp('crafted.ksrs.json');
  writeFileSync(crafted, JSON.stringify(json));

  await pickRestoreFile(page, crafted);
  const prev = page.getByTestId('restore-preview');
  await expect(prev).toContainText('1 from a newer app');
  await expect(prev.getByTestId('preview-conflicts')).toContainText('1');
  await page.getByTestId('apply-restore').click();
  await expect(page.getByTestId('restore-msg')).toContainText('1 kept in quarantine');
  await expect(page.getByTestId('quarantine')).toContainText('review.rated');
  // This device's copy of the conflicting id is kept.
  expect((await readEvents(page)).find((e) => e.id === conflict.id).itemId).not.toBe('v:different');

  // The quarantined event rides along in this device's next backup, so a fresh device that
  // restores it (even with Replace) still has it.
  const next = JSON.parse(readFileSync(await downloadBackup(page), 'utf8'));
  expect(next.events.some((e: any) => e.id === future.id && e.v === 2)).toBe(true);
  const nextFile = tmp('next.ksrs.json');
  writeFileSync(nextFile, JSON.stringify(next));
  const ctx = await browser.newContext({ timezoneId: 'Asia/Seoul' });
  const p2 = await ctx.newPage();
  await setup(p2);
  await pickRestoreFile(p2, nextFile);
  await p2.getByTestId('mode-replace').check({ force: true });
  await p2.getByTestId('replace-confirm').fill('REPLACE');
  await p2.getByTestId('apply-restore').click();
  await expect(p2.getByTestId('quarantine')).toContainText('review.rated');
  expect(await peek.projection(p2)).toEqual(await peek.projection(page));
  await ctx.close();
});

test('secrets (KRDict key) never appear in a backup or an export', async ({ page }) => {
  await setup(page);
  const SECRET = 'SECRET-KEY-d41d8cd98f00b204';
  await page.evaluate(() => { location.hash = '#/data'; });
  await page.getByTestId('krdict-key').fill(SECRET);
  await page.getByTestId('krdict-save-key').click();
  await expect(page.getByTestId('krdict-card')).toContainText('never backed up');
  await page.evaluate(() => (window as any).__ksrs.store.emit([{ type: 'customItem.upsert', item: { id: 'v:비밀', kind: 'vocab', level: 1, word: '비밀', meanings: ['secret'] } }]));
  for (const gzip of [false, true]) {
    const f = await downloadBackup(page, { gzip });
    const text = gzip ? (await import('node:zlib')).gunzipSync(readFileSync(f)).toString() : readFileSync(f, 'utf8');
    expect(text).toContain('비밀');
    expect(text).not.toContain(SECRET);
  }
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-custom-json').click()]);
  expect(readFileSync((await dl.path())!, 'utf8')).not.toContain(SECRET);
  // Still there after a reload (it lives in the secrets store).
  await page.reload();
  await page.evaluate(() => { location.hash = '#/data'; });
  await expect(page.getByTestId('krdict-key')).toHaveValue(SECRET);
});

test('50k-event backup: restore stays responsive and merges completely', async ({ page }) => {
  test.setTimeout(120_000);
  // Real timers: the stall probe below needs a real setInterval.
  await setup(page, { clock: false });
  // A large, valid backup written directly (canonical JSON + sha256, as the app does).
  const file = tmp('big.ksrs.json');
  const N = 50_000;
  const evs: any[] = [];
  const t0 = Date.UTC(2026, 0, 1);
  for (let i = 0; i < N; i++) {
    const at = t0 + i * 1000;
    evs.push({ id: `0190${String(i).padStart(8, '0')}-0000-7000-8000-000000000000`, v: 1, type: 'note.set', hlc: `${at.toString(36).padStart(9, '0')}.0000.big`, deviceId: 'big', at, itemId: 'v:big', field: 'mnemonic', text: `note ${i}` });
  }
  const { createHash } = await import('node:crypto');
  const canon = (v: unknown): string => v === null || typeof v !== 'object' ? JSON.stringify(v)
    : Array.isArray(v) ? `[${v.map(canon).join(',')}]`
    : `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canon((v as any)[k])}`).join(',')}}`;
  writeFileSync(file, JSON.stringify({ format: 'ksrs-backup', formatVersion: 1, createdAt: 'x', app: { version: 't', contentVersion: 'c' }, deviceId: 'big', eventCount: N, events: evs, checksum: 'sha256:' + createHash('sha256').update(canon(evs)).digest('hex') }));

  // Measure the longest main-thread stall while the file is read, verified and merged.
  await page.evaluate(() => {
    const w = window as any;
    w.__maxGap = 0;
    let last = performance.now();
    w.__tick = setInterval(() => { const n = performance.now(); w.__maxGap = Math.max(w.__maxGap, n - last); last = n; }, 50);
  });
  const t = Date.now();
  await pickRestoreFile(page, file);
  await expect(page.getByTestId('preview-new')).toHaveText(String(N), { timeout: 30_000 });
  await page.getByTestId('apply-restore').click();
  await expect(page.getByTestId('restore-msg')).toContainText(`${N} new events`, { timeout: 60_000 });
  const elapsed = Date.now() - t;
  const gap = await page.evaluate(() => (window as any).__maxGap as number);
  console.log(`50k restore: ${elapsed} ms total, longest main-thread stall ${Math.round(gap)} ms`);
  expect(gap).toBeLessThan(5_000);
  expect(await peek.eventCount(page)).toBe(N);
});

test('partial custom items (from a backup/sync) never crash any page', async ({ page }) => {
  const b = await setup(page);
  await doLessonBatch(page, b);
  const partial = [
    { id: 'v:부분', kind: 'vocab', level: 1, word: '부분' },
    { id: 'v:빈', kind: 'vocab', level: 1 },
    { id: 'g:빈', kind: 'grammar', level: 1 },
    { id: 'x:빈', kind: 'expression', level: 1 },
    { id: 'h:空', kind: 'hanja', level: 1 },
    { id: 'v:<b>x</b>', kind: 'vocab', level: 1, word: '<img src=x onerror="window.__xss=1">', meanings: ['<script>window.__xss=1</script>'], questionTypes: ['meaning'], questions: { meaning: { accepted: ['x'] } } },
  ];
  await page.evaluate((items) => (window as any).__ksrs.store.emit(items.map((item) => ({ type: 'customItem.upsert', item }))), partial);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const it of partial) {
    await page.evaluate((id) => { location.hash = '#/item/' + encodeURIComponent(id); }, it.id);
    await expect(page.getByTestId('item-page')).toBeVisible();
  }
  for (const h of ['#/', '#/browse', '#/trouble', '#/inbox', '#/practice', '#/data']) {
    await page.evaluate((x) => { location.hash = x; }, h);
    await page.waitForTimeout(100);
    await expect(page.locator('.error-boundary, [data-testid="crash"]')).toHaveCount(0);
  }
  await page.evaluate(() => { location.hash = '#/browse'; });
  await page.getByTestId('browse-search').fill('부분');
  await goHome(page);
  if (await page.getByTestId('lessons-override').isVisible()) await page.getByTestId('lessons-override').click();
  // Walk lesson batches and quizzes containing the partial items.
  for (let i = 0; i < 4; i++) {
    await goHome(page);
    if (Number(await page.getByTestId('lessons-count').innerText()) === 0) break;
    await page.getByTestId('start-lessons').click();
    for (let g = 0; g < 30; g++) {
      await expect(page.getByTestId('lesson-page')).toBeVisible();
      if (await page.getByTestId('start-quiz').isVisible()) break;
      await page.getByRole('button', { name: 'Next', exact: true }).click();
    }
  }
  expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
  expect(errors).toEqual([]);
});

test('practice: no "accept in future" option, and undo / "I was right" write nothing', async ({ page }) => {
  const b = await setup(page);
  await doLessonBatch(page, b);
  const before = await readEvents(page);
  await page.evaluate(() => { location.hash = '#/practice'; });
  await page.getByTestId('start-practice').click();
  for (let g = 0; g < 10; g++) {
    const card = page.getByTestId('question');
    if ((await card.getAttribute('data-qtype')) === 'meaning') break;
    const opt = page.locator('.option').first();
    if (await opt.isVisible()) await opt.click(); else { await page.locator('input.answer').fill('냉장고'); await page.locator('input.answer').press('Enter'); }
    await page.getByTestId('feedback').getByRole('button', { name: 'Next', exact: true }).click();
  }
  await page.locator('input.answer').fill('refrigerator');
  await page.locator('input.answer').press('Enter');
  const fb = page.getByTestId('feedback');
  await expect(fb).toHaveAttribute('data-grade', 'incorrect');
  await expect(fb.getByText('Accept this answer in future')).toHaveCount(0);
  await fb.getByRole('button', { name: 'I was right' }).click();
  await expect(fb).toHaveAttribute('data-grade', 'correct');
  await fb.getByRole('button', { name: 'Undo' }).click();
  expect(await readEvents(page)).toEqual(before);
  void b;
});
