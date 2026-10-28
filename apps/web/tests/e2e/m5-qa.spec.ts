// M5 QA regressions (independent review): data safety (schema upgrade, atomic Replace, secrets,
// quarantine round-trip, damaged files, large logs), partial custom items, practice.
import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { correctAnswer, currentQ, doLessonBatch, downloadBackup, goHome, jumpToDue, next, peek, readEvents, restoreBackup, setup, submit, wrongAnswer, type Bundle } from './helpers.ts';

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
    ['empty.ksrs.json', '', /That file is empty/],
    ['corrupt.ksrs.json', good.subarray(0, Math.floor(good.length / 2)), /not JSON/],
    ['truncated.ksrs.json.gz', gzipSync(good).subarray(0, 60), /incomplete or damaged/],
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
    // Hanja have no item pages (D63): the link lands on Browse.
    await expect(page.getByTestId(it.kind === 'hanja' ? 'browse' : 'item-page')).toBeVisible();
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

// KRDict search responses as saved from the API (entities, Korean numeric references, CDATA).
const krdictXml = (code: number, word: string, en: string, defKo: string, link = `https://krdict.korean.go.kr/dicSearch/SearchView?ParaWordNo=${code}`) =>
  `<?xml version="1.0" encoding="UTF-8"?><channel><total>1</total><item><target_code>${code}</target_code><word>${word}</word><pos>부사</pos>`
  + `<link>${link}</link><sense><sense_order>1</sense_order><definition>${defKo}</definition>`
  + `<translation><trans_lang>영어</trans_lang><trans_word>${en}</trans_word><trans_dfn>In a roundabout way &amp; quietly.</trans_dfn></translation></sense></item></channel>`;

async function pasteKrdict(page: Page, xml: string): Promise<void> {
  const fb = page.getByTestId('krdict-fallback');
  if (!(await fb.getAttribute('open') !== null)) await fb.locator('summary').click();
  await page.getByTestId('krdict-xml').fill(xml);
  await page.getByTestId('krdict-parse').click();
}

test('KRDict: error/empty responses, entities, attribution on the draft and item, lesson without examples, no clobbering', async ({ page }) => {
  const b = await setup(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.evaluate(() => { location.hash = '#/data'; });

  await pasteKrdict(page, '<?xml version="1.0"?><error><error_code>020</error_code><message>등록되지 않은 인증키입니다.</message></error>');
  await expect(page.getByTestId('krdict-status')).toContainText('KRDict error 020: 등록되지 않은 인증키입니다.');
  await pasteKrdict(page, '<?xml version="1.0"?><channel><total>0</total><start>1</start><num>10</num></channel>');
  await expect(page.getByTestId('krdict-status')).toContainText('No entries found');

  // &#45324;&#xC9C0;&#49884; = 넌지시
  await pasteKrdict(page, krdictXml(54321, '&#45324;&#xC9C0;&#49884;', 'indirectly, casually', '드러나지 &lt;않게&gt; 가만히.', 'javascript:window.__xss=1'));
  await expect(page.getByTestId('krdict-senses')).toContainText('넌지시');
  await expect(page.getByTestId('krdict-senses')).toContainText('드러나지 <않게> 가만히.');
  await page.getByTestId('krdict-senses').locator('.sense').first().click();
  const draft = page.getByTestId('krdict-draft');
  await expect(draft).toContainText('한국어기초사전 (국립국어원)');
  await expect(draft).toContainText('CC-BY-SA-2.0-KR');
  await expect(page.getByTestId('krdict-draft-id')).toHaveText('v:넌지시');
  await page.getByTestId('krdict-add').click();
  await expect(page.getByTestId('krdict-status')).toContainText('Saved 넌지시');
  const saved = (await readEvents(page)).filter((e) => e.type === 'customItem.upsert');
  expect(saved).toHaveLength(1);
  expect(saved[0].item.source).toMatchObject({ kind: 'krdict', license: 'CC-BY-SA-2.0-KR', krdictTargetCode: 54321 });
  expect(saved[0].item.examples).toEqual([]);

  // Item page credits KRDict; a non-http link from the file is not rendered as a link.
  await page.evaluate(() => { location.hash = '#/item/' + encodeURIComponent('v:넌지시'); });
  await expect(page.getByTestId('attribution')).toContainText('한국어기초사전 (국립국어원) · CC-BY-SA-2.0-KR');
  await expect(page.getByTestId('attribution').locator('a')).toHaveCount(0);

  // A word that is already a built-in item: the draft gets its own id; the built-in is untouched.
  const before = b.items.find((i) => i.id === 'v:망설이다')!;
  await page.evaluate(() => { location.hash = '#/data'; });
  await pasteKrdict(page, krdictXml(12345, '망설이다', 'hesitate', '이리저리 생각만 하고 태도를 결정하지 못하다.'));
  await page.getByTestId('krdict-senses').locator('.sense').first().click();
  await expect(page.getByTestId('krdict-draft-id')).toHaveText('v:망설이다:2');
  await expect(page.getByTestId('krdict-clash')).toContainText('already in your deck');
  await page.getByTestId('krdict-add').click();
  await expect(page.getByTestId('krdict-status')).toContainText('Saved 망설이다');
  const idx = await page.evaluate(() => {
    const byId = (window as any).__ksrs.store.getState().derived.index.byId;
    return { seed: byId.get('v:망설이다'), krdict: byId.get('v:망설이다:2')?.source?.kind };
  });
  expect(idx.seed.source.kind).toBe('original');
  expect(idx.seed.examples).toEqual((before as any).examples);
  expect(idx.krdict).toBe('krdict');
  // Picking the same sense again updates that copy instead of making a third.
  await pasteKrdict(page, krdictXml(12345, '망설이다', 'hesitate', '이리저리 생각만 하고 태도를 결정하지 못하다.'));
  await page.getByTestId('krdict-senses').locator('.sense').first().click();
  await expect(page.getByTestId('krdict-draft-id')).toHaveText('v:망설이다:2');
  await expect(page.getByTestId('krdict-clash')).toContainText('updates the copy');

  // The example-less draft renders as a lesson (walk batches until it shows up).
  await goHome(page);
  if (await page.getByTestId('lessons-override').isVisible()) await page.getByTestId('lessons-override').click();
  const seen: string[] = [];
  for (let batch = 0; batch < 6 && !seen.includes('v:넌지시'); batch++) {
    await goHome(page);
    if (await page.getByTestId('lessons-override').isVisible()) await page.getByTestId('lessons-override').click();
    if (Number(await page.getByTestId('lessons-count').innerText()) === 0) break;
    await page.getByTestId('start-lessons').click();
    for (let g = 0; g < 30; g++) {
      const cur = (await page.getByTestId('lesson-page').getAttribute('data-item-id'))!;
      seen.push(cur);
      if (cur === 'v:넌지시' || await page.getByTestId('start-quiz').isVisible()) break;
      await page.getByRole('button', { name: 'Next', exact: true }).click();
    }
    if (seen.includes('v:넌지시')) break;
    await goHome(page);
    await doLessonBatch(page, b);
  }
  expect(seen).toContain('v:넌지시');
  await expect(page.getByTestId('lesson-page')).toContainText('넌지시');
  await expect(page.getByTestId('lesson-page').getByTestId('attribution')).toContainText('한국어기초사전');
  expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
  expect(errors).toEqual([]);
});

test('Replace with a backup that has nothing applicable (all newer-app events) is refused; history stays', async ({ page }) => {
  const b = await setup(page);
  await doLessonBatch(page, b);
  const before = await readEvents(page);
  const ev0 = before[0];
  const only = [{ ...ev0, id: '0190f000-0000-7000-8000-00000000beef', v: 2, type: 'review.rated' }];
  const { createHash } = await import('node:crypto');
  const canon = (v: unknown): string => v === null || typeof v !== 'object' ? JSON.stringify(v)
    : Array.isArray(v) ? `[${v.map(canon).join(',')}]`
    : `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canon((v as any)[k])}`).join(',')}}`;
  const f = tmp('newer.ksrs.json');
  writeFileSync(f, JSON.stringify({ format: 'ksrs-backup', formatVersion: 1, createdAt: 'x', app: { version: 'v9', contentVersion: 'c' }, deviceId: 'new', eventCount: 1, events: only, checksum: 'sha256:' + createHash('sha256').update(canon(only)).digest('hex') }));

  await pickRestoreFile(page, f);
  await expect(page.getByTestId('restore-preview')).toContainText('1 from a newer app');
  await page.getByTestId('mode-replace').check({ force: true });
  await expect(page.getByTestId('replace-empty')).toBeVisible();
  await expect(page.getByTestId('replace-confirm')).toHaveCount(0);
  await expect(page.getByTestId('apply-restore')).toBeDisabled();
  // The store refuses too (defence in depth), before writing anything.
  const err = await page.evaluate(() => (window as any).__ksrs.store.restore([], [], 'replace', 'test').then(() => null, (e: Error) => e.message));
  expect(err).toMatch(/would erase/);
  expect(await readEvents(page)).toEqual(before);
  // Merge is still available: the newer event is kept in quarantine, history untouched.
  await page.getByTestId('restore-preview').getByText('Merge', { exact: true }).click();
  await page.getByTestId('apply-restore').click();
  await expect(page.getByTestId('restore-msg')).toContainText('1 kept in quarantine');
  expect(await readEvents(page)).toEqual(before);
});

test('CSV import over a built-in item (Excel: BOM, CRLF, semicolons): preview says so; progress is kept', async ({ page }) => {
  const b = await setup(page);
  const ids = await doLessonBatch(page, b);
  const target = ids.find((i) => i.startsWith('v:'))!;
  const word = target.slice(2);
  const stageBefore = await page.evaluate((id) => (window as any).__ksrs.store.getState().derived.items.get(id).stage, target);
  const f = tmp('excel.csv');
  writeFileSync(f, '﻿level;word;meanings;pos;;\r\n1;' + word + ';“edited” meaning;동사;;\r\n;;;;;\r\n');
  await page.evaluate(() => { location.hash = '#/data'; });
  await page.getByTestId('import-kind').selectOption('vocab');
  await page.getByTestId('import-file').setInputFiles(f);
  const prev = page.getByTestId('import-preview');
  await expect(prev).toContainText('0 new · 1 changed · 0 unchanged');
  const row = prev.locator('tr[data-builtin="true"]');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(target);
  await expect(row).toContainText('replaces the built-in item (your progress on it is kept)');
  await page.getByTestId('import-confirm').click();
  await expect(page.getByTestId('import-msg')).toContainText('Imported 1 item');
  const after = await page.evaluate((id) => {
    const d = (window as any).__ksrs.store.getState().derived;
    return { stage: d.items.get(id).stage, meanings: d.index.byId.get(id).meanings };
  }, target);
  expect(after).toEqual({ stage: stageBefore, meanings: ['“edited” meaning'] });
});

test('TTS: a browser without speechSynthesis at all: no speakers, autoplay on is harmless', async ({ page }) => {
  await page.addInitScript(() => { delete (window as any).speechSynthesis; delete (Window.prototype as any).speechSynthesis; });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const b = await setup(page);
  expect(await page.evaluate(() => 'speechSynthesis' in window)).toBe(false);
  await page.evaluate(() => (window as any).__ksrs.store.setAppSetting('tts.autoplay', true));
  await page.getByTestId('start-lessons').click();
  await expect(page.getByTestId('lesson-page')).toBeVisible();
  await expect(page.getByTestId('speaker')).toHaveCount(0);
  await goHome(page);
  await doLessonBatch(page, b);
  await page.evaluate(() => { location.hash = '#/settings'; });
  await expect(page.getByTestId('tts-settings')).toBeVisible();
  expect(errors).toEqual([]);
});

test('one id twice in a file with different content: one copy applied, the other quarantined; a reload never swaps them', async ({ page, browser }) => {
  const b = await setup(page);
  await doLessonBatch(page, b);
  const before = await readEvents(page);
  const json = JSON.parse(readFileSync(await downloadBackup(page), 'utf8'));
  const twin = { ...json.events[1], itemId: 'v:twin' };
  json.events = [...json.events, twin];
  const { createHash } = await import('node:crypto');
  const canon = (v: unknown): string => v === null || typeof v !== 'object' ? JSON.stringify(v)
    : Array.isArray(v) ? `[${v.map(canon).join(',')}]`
    : `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canon((v as any)[k])}`).join(',')}}`;
  json.eventCount = json.events.length;
  json.checksum = 'sha256:' + createHash('sha256').update(canon(json.events)).digest('hex');
  const f = tmp('twin.ksrs.json');
  writeFileSync(f, JSON.stringify(json));

  // Merge on this device: its own copy wins; the other copy is kept in quarantine, not lost.
  await pickRestoreFile(page, f);
  await expect(page.getByTestId('restore-preview')).toContainText('second copy of an event');
  await page.getByTestId('apply-restore').click();
  await expect(page.getByTestId('restore-msg')).toContainText('1 kept in quarantine');
  await page.reload();
  await goHome(page);
  expect(await readEvents(page)).toEqual(before);

  // Replace on a fresh device: exactly one copy applied; after a reload (quarantine resolution
  // runs at startup) the applied copy is unchanged and the twin is still quarantined.
  const ctx = await browser.newContext({ timezoneId: 'Asia/Seoul' });
  const p2 = await ctx.newPage();
  await setup(p2);
  await pickRestoreFile(p2, f);
  await p2.getByTestId('mode-replace').check({ force: true });
  await p2.getByTestId('replace-confirm').fill('REPLACE');
  await p2.getByTestId('apply-restore').click();
  await expect(p2.getByTestId('restore-msg')).toContainText('Replaced');
  const applied = await readEvents(p2);
  expect(applied).toHaveLength(before.length);
  await p2.reload();
  await goHome(p2);
  expect(await readEvents(p2)).toEqual(applied);
  await p2.evaluate(() => { location.hash = '#/data'; });
  await expect(p2.getByTestId('quarantine')).toBeVisible();
  expect((await p2.evaluate(() => (window as any).__ksrs.store.listQuarantine())).length).toBe(1);
  await ctx.close();
});

/** One review round where the first meaning question is answered wrong, then fixed via `fix`. */
async function reviewWithFix(page: Page, b: Bundle, fix: 'override' | 'undo'): Promise<void> {
  await jumpToDue(page);
  await page.getByTestId('start-reviews').click();
  let fixed = false;
  for (let g = 0; g < 200; g++) {
    if (await page.getByTestId('review-summary').isVisible()) break;
    const q = await currentQ(page);
    if (!fixed && q.qtype === 'meaning') {
      fixed = true;
      await submit(page, q, wrongAnswer(b, q));
      const fb = page.getByTestId('feedback');
      await expect(fb).toHaveAttribute('data-grade', 'incorrect');
      if (fix === 'override') {
        await fb.getByRole('button', { name: 'I was right' }).click();
        await expect(fb).toHaveAttribute('data-grade', 'correct');
        await next(page);
      } else {
        await fb.getByRole('button', { name: 'Undo', exact: true }).click();
        await expect(page.getByTestId('feedback')).toHaveCount(0);
        await submit(page, q, correctAnswer(b, q));
        await next(page);
      }
      continue;
    }
    await submit(page, q, correctAnswer(b, q));
    await expect(page.getByTestId('feedback')).toBeVisible();
    await next(page);
  }
  expect(fixed).toBe(true);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('lessons-tile')).toBeVisible();
}

test('two devices: "I was right" on one, undo on the other, notes + inbox dismissals on both → converge; repeated merges change nothing', async ({ browser }) => {
  test.setTimeout(150_000);
  const mk = async () => {
    const ctx = await browser.newContext({ timezoneId: 'Asia/Seoul', acceptDownloads: true });
    const page = await ctx.newPage();
    return { page, b: await setup(page), ctx };
  };
  const A = await mk();
  const B = await mk();
  for (const d of [A, B]) await doLessonBatch(d.page, d.b);
  await reviewWithFix(A.page, A.b, 'override');
  await reviewWithFix(B.page, B.b, 'undo');
  const types = async (p: Page) => (await readEvents(p)).map((e) => e.type + (e.overrides ? '+override' : ''));
  expect(await types(A.page)).toContain('review.answer+override');
  expect(await types(B.page)).toContain('event.void');
  // Same note edited on both (LWW by HLC) and a different inbox dismissal on each (grow-only).
  const item = (await readEvents(A.page)).find((e) => e.type === 'lesson.completed').itemId;
  await A.page.evaluate((id) => (window as any).__ksrs.store.setNote(id, 'mnemonic', 'from A'), item);
  await B.page.evaluate((id) => (window as any).__ksrs.store.setNote(id, 'mnemonic', 'from B'), item);
  await A.page.evaluate(() => (window as any).__ksrs.store.setAppSetting('inbox.dismissed', ['dismissed-on-A']));
  await B.page.evaluate(() => (window as any).__ksrs.store.setAppSetting('inbox.dismissed', ['dismissed-on-B']));

  const t = Math.max(await A.page.evaluate(() => Date.now()), await B.page.evaluate(() => Date.now()));
  for (const d of [A, B]) await d.page.clock.setSystemTime(t);
  const state = (p: Page) => p.evaluate(async () => {
    const st = (window as any).__ksrs.store; await st.flush();
    const s = st.getState();
    return { ids: s.events.map((e: any) => e.id), notes: [...s.derived.notes.entries()].sort(), dismissed: [...s.derived.settings['inbox.dismissed']].sort() };
  });

  for (let round = 0; round < 3; round++) {
    const nB = await restoreBackup(B.page, await downloadBackup(A.page));
    const nA = await restoreBackup(A.page, await downloadBackup(B.page));
    if (round > 0) expect([nA, nB], `round ${round}`).toEqual([0, 0]);
    const [sa, sb] = [await state(A.page), await state(B.page)];
    expect(sa).toEqual(sb);
    expect(sa.dismissed).toEqual(['dismissed-on-A', 'dismissed-on-B']);
    expect(sa.notes.filter(([k]: [string]) => k.includes(item))).toHaveLength(1);
    expect(await peek.projection(A.page)).toEqual(await peek.projection(B.page));
  }
  // And after a reload (replay from IndexedDB, not the in-memory merge) nothing moves.
  const before = await state(A.page);
  await A.page.reload();
  await goHome(A.page);
  expect(await state(A.page)).toEqual(before);
  await A.ctx.close();
  await B.ctx.close();
});

test('re-importing the same CSV (even a renamed copy) shows everything unchanged and writes nothing', async ({ page }) => {
  await setup(page);
  const csv = 'level,word,meanings,pos\r\n1,뜬금없다,out of the blue,형용사\r\n';
  const importFile = async (name: string) => {
    const f = tmp(name);
    writeFileSync(f, csv);
    await page.evaluate(() => { location.hash = '#/data'; });
    await page.getByTestId('import-kind').selectOption('vocab');
    await page.getByTestId('import-file').setInputFiles(f);
  };
  await importFile('words.csv');
  await expect(page.getByTestId('import-preview')).toContainText('1 new · 0 changed · 0 unchanged');
  await page.getByTestId('import-confirm').click();
  await expect(page.getByTestId('import-msg')).toContainText('Imported 1 item');
  const before = await readEvents(page);
  for (const name of ['words.csv', 'words (1).csv']) {
    await importFile(name);
    await expect(page.getByTestId('import-preview'), name).toContainText('0 new · 0 changed · 1 unchanged');
    const confirm = page.getByTestId('import-confirm');
    if (await confirm.isEnabled()) await confirm.click();
  }
  expect(await readEvents(page)).toEqual(before);
});

test('partial custom items in reviews and related-item panels: no crash, no questions built from missing fields', async ({ page }) => {
  const b = await setup(page);
  await doLessonBatch(page, b);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const partial = [
    { id: 'v:부분', kind: 'vocab', level: 1, word: '부분', hanja: [{ syllable: '부', hanjaId: 'h:없음' }] },
    { id: 'v:빈', kind: 'vocab', level: 1, questionTypes: ['meaning', 'production'] },
    { id: 'g:빈', kind: 'grammar', level: 1, questionTypes: ['cloze'], questions: { cloze: [{ id: 'c1' }] } },
    { id: 'x:빈', kind: 'expression', level: 1, contrasts: [{ itemId: 'v:부분' }] },
  ];
  await page.evaluate((items) => (window as any).__ksrs.store.emit([
    ...items.map((item) => ({ type: 'customItem.upsert', item })),
    ...items.map((item) => ({ type: 'lesson.completed', itemId: item.id })),
  ]), partial);
  for (const it of partial) {
    await page.evaluate((id) => { location.hash = '#/item/' + encodeURIComponent(id); }, it.id);
    // Hanja have no item pages (D63): the link lands on Browse.
    await expect(page.getByTestId(it.kind === 'hanja' ? 'browse' : 'item-page')).toBeVisible();
  }
  await jumpToDue(page);
  await page.getByTestId('start-reviews').click();
  for (let g = 0; g < 60; g++) {
    if (await page.getByTestId('review-summary').isVisible()) break;
    const q = await currentQ(page);
    if (q.itemId.endsWith('빈') || q.itemId === 'v:부분') {
      // Whatever was built for a partial item must be answerable without throwing.
      await submit(page, q, '부분');
    } else {
      await submit(page, q, correctAnswer(b, q));
    }
    const fb = page.getByTestId('feedback');
    if (!(await fb.isVisible())) { await page.locator('input.answer').fill('x'); await page.locator('input.answer').press('Enter'); }
    await expect(fb).toBeVisible();
    await next(page);
  }
  expect(errors).toEqual([]);
});
