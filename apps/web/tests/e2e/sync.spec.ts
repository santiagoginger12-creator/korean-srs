// M6 GitHub sync e2e on the fixture seed. api.github.com is intercepted with Playwright routes
// and answered by the in-memory fake GitHub from packages/sync (same semantics as the unit
// tests: blob shas, 409/422 conflicts, 401 for a wrong token). Each browser context is a
// device; both talk to one shared fake repo. Tokens here are obviously fake test strings.
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryRemote } from '../../../../packages/sync/src/transports/memory.ts';
import { createFakeGithub } from '../../../../packages/sync/src/transports/fake-github.ts';
import { dashboardCounts, doLessonBatch, goHome, peek, reviewRound, setup, wrongOnce, type Bundle } from './helpers.ts';

test.use({ timezoneId: 'Asia/Seoul' });

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, '../../test-results');
const OWNER = 'santiagoginger12-creator';
const REPO = 'ksrs-data';
const TOKEN = 'github_pat_TESTONLY_fake_token_for_e2e_0000';

function fakeRepo() {
  const remote = new MemoryRemote();
  const gh = createFakeGithub(remote, { owner: OWNER, repo: REPO, token: TOKEN });
  return { remote, gh };
}

async function routeGithub(ctx: BrowserContext, gh: ReturnType<typeof createFakeGithub>): Promise<void> {
  await ctx.route('https://api.github.com/**', async (route) => {
    const req = route.request();
    const r = gh.handle({ method: req.method(), url: req.url(), headers: await req.allHeaders(), body: req.postData() });
    await route.fulfill({ status: r.status, headers: r.headers, body: r.body });
  });
}

interface Dev { page: Page; b: Bundle; close: () => Promise<void> }

async function device(browser: Browser, gh: ReturnType<typeof createFakeGithub>, o: { viewport?: { width: number; height: number } } = {}): Promise<Dev> {
  const ctx = await browser.newContext({ timezoneId: 'Asia/Seoul', ...(o.viewport ? { viewport: o.viewport, deviceScaleFactor: 2 } : {}) });
  await routeGithub(ctx, gh);
  const page = await ctx.newPage();
  const b = await setup(page);
  return { page, b, close: () => ctx.close() };
}

const syncState = (page: Page) => page.evaluate(() => {
  const s = (window as any).__ksrs.sync.getState();
  return { running: s.running as boolean, last: s.config.lastSyncAt as number | undefined, enabled: s.config.enabled as boolean, problem: s.problem?.code as string | undefined };
});

/** Waits for a sync that finishes after `since` (or a failure). */
async function waitSynced(page: Page, since: number | undefined): Promise<void> {
  await expect.poll(async () => { const s = await syncState(page); return !s.running && (s.last !== since || !!s.problem); }, { timeout: 15_000 }).toBe(true);
}

async function openSync(page: Page): Promise<void> {
  await page.evaluate(() => { location.hash = '#/settings/sync'; });
  await expect(page.getByTestId('sync-page')).toBeVisible();
}

async function saveToken(page: Page, token = TOKEN): Promise<void> {
  await openSync(page);
  await page.getByTestId('sync-token').fill(token);
  await page.getByTestId('sync-save-token').click();
  await expect(page.getByTestId('sync-token-status')).toContainText(`…${token.slice(-4)}`);
  await expect(page.getByTestId('sync-token')).toHaveValue('');
}

async function turnOn(page: Page): Promise<void> {
  const before = (await syncState(page)).last;
  await page.getByTestId('sync-enable').click();
  await waitSynced(page, before);
}

async function syncNow(page: Page): Promise<void> {
  await openSync(page);
  const before = (await syncState(page)).last;
  await page.getByTestId('sync-now').click();
  await waitSynced(page, before);
  expect((await syncState(page)).problem).toBeUndefined();
}

test('two devices review differently, sync through GitHub → identical stage counts and item states', async ({ browser }) => {
  test.setTimeout(150_000);
  const { remote, gh } = fakeRepo();
  const A = await device(browser, gh);
  const B = await device(browser, gh);
  const idA = await peek.deviceId(A.page);
  const idB = await peek.deviceId(B.page);
  expect(idA).not.toBe(idB);
  // Both learn and review before sync is set up ("offline"); B misses every meaning question once.
  for (const d of [A, B]) await doLessonBatch(d.page, d.b);
  await reviewRound(A.page, A.b);
  await reviewRound(B.page, B.b, wrongOnce(B.b, (q) => q.qtype === 'meaning'));
  expect(await peek.projection(A.page)).not.toEqual(await peek.projection(B.page));
  expect(remote.requests).toHaveLength(0);

  // A: the default repo, a token, Test connection (read + device file), then turn on.
  await saveToken(A.page);
  await expect(A.page.getByTestId('sync-repo')).toHaveValue(`${OWNER}/${REPO}`);
  await A.page.getByTestId('sync-test').click();
  await expect(A.page.getByTestId('sync-msg')).toContainText(`Connected to ${OWNER}/${REPO} (private). Read and write OK`);
  expect(remote.files.has(`ksrs/v1/devices/${idA}.json`)).toBe(true);
  await turnOn(A.page);
  await expect(A.page.getByTestId('sync-last')).not.toHaveText('never');
  await expect(A.page.getByTestId('sync-status')).toContainText('sent');

  await saveToken(B.page);
  await turnOn(B.page); // pulls A, pushes B
  await syncNow(A.page); // pulls B

  const t = Math.max(await A.page.evaluate(() => Date.now()), await B.page.evaluate(() => Date.now()));
  await A.page.clock.setSystemTime(t);
  await B.page.clock.setSystemTime(t);
  expect(await peek.eventCount(A.page)).toBe(await peek.eventCount(B.page));
  expect(await peek.projection(A.page)).toEqual(await peek.projection(B.page));
  expect(await dashboardCounts(A.page)).toEqual(await dashboardCounts(B.page));

  // Remote layout (§11.2): manifest, a device file each, and each device's own weekly segment.
  const paths = [...remote.files.keys()].sort();
  expect(paths).toContain('ksrs/v1/manifest.json');
  expect(paths).toContain(`ksrs/v1/devices/${idB}.json`);
  expect(paths.some((p) => p.startsWith(`ksrs/v1/log/${idA}/2026-W`) && p.endsWith('.jsonl'))).toBe(true);
  expect(paths.some((p) => p.startsWith(`ksrs/v1/log/${idB}/2026-W`))).toBe(true);

  // B learns more: the finished lesson session syncs by itself once B leaves the session
  // screen (never during it); A picks it up on app open.
  const writes = remote.count('put');
  await goHome(B.page);
  await doLessonBatch(B.page, B.b);
  await B.page.waitForTimeout(500);
  expect(remote.count('put')).toBe(writes);
  await goHome(B.page);
  await expect.poll(() => remote.count('put'), { timeout: 15_000 }).toBeGreaterThan(writes);
  await waitSynced(B.page, undefined);
  const lastA = (await syncState(A.page)).last;
  await A.page.reload();
  await expect(A.page.getByTestId('lessons-tile')).toBeVisible();
  await waitSynced(A.page, lastA);
  expect(await peek.eventCount(A.page)).toBe(await peek.eventCount(B.page));
  expect(await peek.projection(A.page)).toEqual(await peek.projection(B.page));
  // Syncing again changes nothing (idempotent): one listing, no writes.
  const puts = remote.count('put');
  await syncNow(A.page);
  expect(remote.count('put')).toBe(puts);
  await A.close();
  await B.close();
});

test('a bad token shows a non-modal banner with the fix; a new token clears it', async ({ browser }) => {
  const { gh } = fakeRepo();
  const d = await device(browser, gh);
  await saveToken(d.page, 'github_pat_TESTONLY_revoked_token_9999');
  await turnOn(d.page);
  await goHome(d.page);
  const banner = d.page.getByTestId('sync-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Token expired or revoked — paste a new one in Settings → Sync');
  // Non-modal: the app is usable underneath.
  await expect(d.page.getByTestId('lessons-tile')).toBeVisible();
  await d.page.getByTestId('start-lessons').click();
  await expect(d.page.getByTestId('lesson-page')).toBeVisible();
  await expect(d.page.getByTestId('sync-banner')).toHaveCount(0); // hidden during a session
  await goHome(d.page);
  await banner.getByRole('link', { name: 'Open Sync' }).click();
  await saveToken(d.page);
  await syncNow(d.page);
  await goHome(d.page);
  await expect(d.page.getByTestId('sync-banner')).toHaveCount(0);
  await d.close();
});

test('Disable stops syncing: no requests on open, session end or visibility', async ({ browser }) => {
  const { remote, gh } = fakeRepo();
  const d = await device(browser, gh);
  await saveToken(d.page);
  await turnOn(d.page);
  await d.page.getByTestId('sync-disable').click();
  await expect(d.page.getByTestId('sync-card')).toHaveAttribute('data-enabled', 'off');
  await expect(d.page.getByTestId('sync-now')).toBeDisabled();
  const n = remote.requests.length;
  await goHome(d.page);
  await doLessonBatch(d.page, d.b); // session end
  await goHome(d.page);
  await d.page.reload(); // app open
  await expect(d.page.getByTestId('lessons-tile')).toBeVisible();
  await d.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await d.page.waitForTimeout(1500);
  expect(remote.requests.length).toBe(n);
  // The token stays until removed; Remove token clears it from this device.
  await openSync(d.page);
  await d.page.getByTestId('sync-remove-token').click();
  await expect(d.page.getByTestId('sync-token-status')).toHaveText('No token saved on this device.');
  expect(await d.page.evaluate(() => (window as any).__ksrs.store.getSecret('github.token'))).toBeUndefined();
  await d.close();
});

test('owner screenshot: Settings → Sync (390×844)', async ({ browser }) => {
  const { gh } = fakeRepo();
  const d = await device(browser, gh, { viewport: { width: 390, height: 844 } });
  await saveToken(d.page);
  await d.page.getByTestId('sync-expiry').fill('2026-11-01'); // 9 days after the fixture clock
  await turnOn(d.page);
  await expect(d.page.getByTestId('sync-expiry-note')).toContainText('expires in 9 days');
  await d.page.evaluate(() => window.scrollTo(0, 0));
  mkdirSync(SHOTS, { recursive: true });
  await expect(d.page.getByTestId('sync-expiry-banner')).toHaveCount(0); // the page shows its own note
  await d.page.screenshot({ path: join(SHOTS, 'sync-settings-390x844.png') });
  await d.page.screenshot({ path: join(SHOTS, 'sync-settings-full-390x844.png'), fullPage: true });
  await goHome(d.page);
  await expect(d.page.getByTestId('sync-expiry-banner')).toContainText('expires in 9 days');
  await d.close();
});
