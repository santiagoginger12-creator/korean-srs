// M5 study e2e on the fixture seed: practice (zero events), trouble reset, variants inbox, TTS.
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  correctAnswer, currentQ, doLessonBatch, goHome, jumpToDue, learnAllLessons, next, peek, readEvents, reviewRound, setup, submit, wrongAnswer, type Bundle,
} from './helpers.ts';

test.use({ timezoneId: 'Asia/Seoul' });

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '../../test-results');
async function ownerShot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  const vp = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(SHOTS, `${name}-390x844.png`), fullPage: true });
  if (vp) await page.setViewportSize(vp);
}

const learnAll = learnAllLessons;

test('practice runs the quiz with a "not scheduled" label and writes zero events', async ({ page }) => {
  const b = await setup(page);
  await doLessonBatch(page, b);
  const before = await peek.eventCount(page);
  await page.evaluate(() => { location.hash = '#/practice'; });
  await page.getByTestId('start-practice').click(); // default: recent lessons
  await expect(page.getByTestId('practice-label')).toHaveText('Practice — not scheduled');
  let n = 0;
  for (; n < 60 && !(await page.getByTestId('practice-done').isVisible()); n++) {
    const q = await currentQ(page);
    // Get the first answer wrong to exercise requeue, the rest right.
    await submit(page, q, n === 0 ? wrongAnswer(b, q) : correctAnswer(b, q));
    await expect(page.getByTestId('feedback')).toBeVisible();
    await next(page);
  }
  expect(n).toBeGreaterThan(2);
  await expect(page.getByTestId('practice-done')).toContainText('1 incorrect');
  expect(await peek.eventCount(page)).toBe(before);
  expect(await readEvents(page)).toHaveLength(before);
});

test('trouble: a leech appears, can be drilled, and Reset to Apprentice 1 emits item.reset', async ({ page }) => {
  test.setTimeout(120_000);
  const b = await setup(page);
  await doLessonBatch(page, b);
  const targetId: string = await page.evaluate(() => {
    const st = (window as any).__ksrs.store.getState().derived;
    return [...st.items.values()].find((x: any) => x.itemId.startsWith('v:') && x.lessonAt !== undefined)!.itemId;
  });
  // Three review groups with a wrong answer, then a clean one: 3 wrong in 90 days, streak 1,
  // 4 reviews → leech (score 3), and at Apprentice 2 so a reset changes something.
  for (let r = 0; r < 4; r++) {
    const wrongOnce = new Set<string>();
    await reviewRound(page, b, (q) => {
      if (r === 3 || q.itemId !== targetId || wrongOnce.has(q.itemId)) return null;
      wrongOnce.add(q.itemId);
      return wrongAnswer(b, q);
    });
  }
  await goHome(page);
  await expect(page.getByTestId('trouble-link')).toContainText('1');
  await page.getByTestId('trouble-link').click();
  const row = page.locator(`[data-testid="trouble-row"][data-item-id="${targetId}"]`);
  await expect(row).toContainText('score');
  await expect(row).toContainText('Last wrong');
  await ownerShot(page, 'trouble');
  // QA: the row actions must look like buttons (outline + padding + pill), not plain text.
  for (const id of ['note', 'reset']) {
    const look = await row.getByTestId(id).evaluate((el) => {
      const cs = getComputedStyle(el);
      const card = getComputedStyle(el.closest('.card')!);
      return { bw: parseFloat(cs.borderTopWidth), bc: cs.borderTopColor, cardBg: card.backgroundColor, pad: parseFloat(cs.paddingLeft), radius: parseFloat(cs.borderTopLeftRadius), h: el.getBoundingClientRect().height };
    });
    expect(look.bw, id).toBeGreaterThanOrEqual(1);
    expect(look.bc, id).not.toBe(look.cardBg);
    expect(look.pad, id).toBeGreaterThanOrEqual(10);
    expect(look.radius, id).toBeGreaterThanOrEqual(8);
    expect(look.h, id).toBeGreaterThanOrEqual(32);
  }

  // Drill: practice preset with the trouble item, no events.
  const before = await peek.eventCount(page);
  await page.getByTestId('drill-all').click();
  await page.getByTestId('start-practice').click();
  await expect(page.getByTestId('question')).toHaveAttribute('data-item-id', targetId);
  expect(await peek.eventCount(page)).toBe(before);

  await page.evaluate(() => { location.hash = '#/trouble'; });
  await row.getByTestId('reset').click();
  await row.getByTestId('confirm-reset').click();
  await expect.poll(async () => (await readEvents(page)).filter((e) => e.type === 'item.reset' && e.itemId === targetId).length).toBe(1);
  const stage = await page.evaluate((id) => (window as any).__ksrs.store.getState().derived.items.get(id).stage, targetId);
  expect(stage).toBe(1);
  // D41: the reset keeps leech history, so the item stays listed; at Apprentice 1 there is
  // nothing left to reset, so the reset control goes away.
  await expect(row).toBeVisible();
  await expect(row.getByTestId('reset')).toHaveCount(0);
  await expect(row.getByTestId('note')).toHaveClass(/\bbtn\b/);
  await row.getByTestId('note').click();
  await row.getByTestId('trouble-note').fill('얼어서 물이 멈춘다');
  await row.getByRole('button', { name: 'Save' }).click();
  await expect.poll(async () => (await readEvents(page)).filter((e) => e.type === 'note.set' && e.itemId === targetId && e.field === 'mnemonic').length).toBe(1);
});

const VARIANT_1 = '제가 확인을 잘 안 한 탓에 일정이 늦어졌습니다.';
const VARIANT_2 = '제가 확인을 제대로 하지 못한 탓에 일정이 늦어졌습니다.';

test('variants inbox: a lenient register answer lands in the inbox; promote and dismiss', async ({ page }) => {
  test.setTimeout(120_000);
  const b = await setup(page);
  await learnAll(page, b);
  const register = (resp: string) => (q: { qtype: string; itemId: string }) => (q.qtype === 'register' && q.itemId === 'g:는-탓에' ? resp : null);
  await reviewRound(page, b, register(VARIANT_1));
  await goHome(page);
  await expect(page.getByTestId('inbox-badge')).toContainText('1');
  await page.getByTestId('inbox-badge').click();
  const row = page.getByTestId('inbox-row');
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('inbox-response')).toHaveText(VARIANT_1);
  // The item is named by its pattern (not the raw id) and links to its page.
  await expect(row.getByTestId('inbox-item')).toHaveText('-(으)ㄴ/는 탓에');
  await expect(row.getByTestId('inbox-item')).toHaveAttribute('href', '#/item/' + encodeURIComponent('g:는-탓에'));
  await ownerShot(page, 'inbox');
  await row.getByTestId('promote').click();
  await expect(page.getByTestId('inbox-empty')).toBeVisible();
  await expect.poll(async () => (await readEvents(page)).filter((e) => e.type === 'userAnswer.add' && e.answer === VARIANT_1).length).toBe(1);

  // Second variant on the next review → dismiss.
  await reviewRound(page, b, register(VARIANT_2));
  await page.evaluate(() => { location.hash = '#/inbox'; });
  await expect(page.getByTestId('inbox-row')).toHaveCount(1);
  await page.getByTestId('dismiss').click();
  await expect(page.getByTestId('inbox-empty')).toBeVisible();
  await goHome(page);
  await expect(page.getByTestId('inbox-badge')).toHaveCount(0);
});

/** Stub Web Speech: records spoken text; `voices` controls whether a Korean voice exists. */
async function stubSpeech(page: Page, voices: { lang: string; name: string }[]): Promise<void> {
  await page.addInitScript((vs) => {
    const spoken: string[] = [];
    (window as any).__spoken = spoken;
    class Utterance { text: string; lang = ''; rate = 1; voice: unknown = null; constructor(t: string) { this.text = t; } }
    (window as any).SpeechSynthesisUtterance = Utterance;
    const list = vs.map((v) => ({ ...v, voiceURI: `stub:${v.name}`, localService: true, default: false }));
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { getVoices: () => list, speak: (u: Utterance) => spoken.push(u.text), cancel: () => {}, addEventListener: () => {}, removeEventListener: () => {} },
    });
  }, voices);
}

test('TTS: speaker buttons call speechSynthesis.speak; autoplay only after submitting', async ({ page }) => {
  await stubSpeech(page, [{ lang: 'ko-KR', name: 'Yuna' }, { lang: 'en-US', name: 'Sam' }]);
  const b = await setup(page);
  await page.getByTestId('start-lessons').click();
  await page.getByTestId('lesson-page').getByTestId('speaker').first().click();
  expect(await page.evaluate(() => (window as any).__spoken.length)).toBe(1);

  // Settings: only Korean voices are offered; turn on autoplay.
  await page.evaluate(() => { location.hash = '#/settings'; });
  await expect(page.getByTestId('tts-voice').locator('option')).toHaveCount(2); // default + Yuna
  await page.getByTestId('tts-autoplay').check();
  await goHome(page);
  await doLessonBatch(page, b);
  await jumpToDue(page);
  await page.getByTestId('start-reviews').click();
  const count = () => page.evaluate(() => (window as any).__spoken.length as number);
  for (let i = 0; i < 3; i++) {
    const q = await currentQ(page);
    const n0 = await count();
    await page.waitForTimeout(150);
    expect(await count(), 'nothing is spoken before the answer is submitted').toBe(n0);
    await submit(page, q, correctAnswer(b, q));
    await expect(page.getByTestId('feedback')).toBeVisible();
    expect(await count()).toBe(n0 + 1);
    // The feedback panel's speaker reads the same answer on demand.
    await page.getByTestId('feedback').getByTestId('speaker').click();
    expect(await count()).toBe(n0 + 2);
    await next(page);
  }
});

test('TTS: with no Korean voice the speaker is disabled and Settings explains why', async ({ page }) => {
  await stubSpeech(page, [{ lang: 'en-US', name: 'Sam' }]);
  await setup(page);
  await page.getByTestId('start-lessons').click();
  const sp = page.getByTestId('lesson-page').getByTestId('speaker').first();
  await expect(sp).toBeDisabled();
  await expect(sp).toHaveAttribute('aria-label', 'No Korean voice installed');
  await page.evaluate(() => { location.hash = '#/settings'; });
  await expect(page.getByTestId('no-ko-voice')).toBeVisible();
});
