// Live keyboard-layout conversion (input.autoConvert): Latin keys → 두벌식 Hangul in Korean
// fields, Hangul → Latin keys in English fields. Chromium only (CDP); iPadOS Safari unverified.
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { correctAnswer, currentQ, jumpToDue, learnAllLessons, next, setup, submit, type Bundle, type Q } from './helpers.ts';

test.use({ timezoneId: 'Asia/Seoul' });
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '../../test-results');

/** Learn everything, start reviews, and answer correctly until `want` matches. */
async function reviewUntil(page: Page, b: Bundle, want: (q: Q) => boolean): Promise<Q> {
  await learnAllLessons(page, b);
  await jumpToDue(page);
  await page.getByTestId('start-reviews').click();
  for (let g = 0; g < 200; g++) {
    const q = await currentQ(page);
    if (want(q)) return q;
    await submit(page, q, correctAnswer(b, q));
    await next(page);
  }
  throw new Error('question never came up');
}

async function setAutoConvert(page: Page, on: boolean): Promise<void> {
  await page.evaluate(() => { location.hash = '#/settings'; });
  const box = page.getByTestId('set-auto-convert');
  await expect(box).toBeChecked(); // default on
  if (!on) await box.uncheck();
  await expect(box).toBeChecked({ checked: on });
}

test('production: typing akdtjfdlek on the English layout shows 망설이다, Backspace steps through jamo, grades correct', async ({ page }) => {
  test.setTimeout(120_000);
  const b = await setup(page);
  const q = await reviewUntil(page, b, (x) => x.qtype === 'production' && x.itemId === 'v:망설이다');
  const input = page.locator('input.answer');
  await expect(input).toHaveAttribute('lang', 'ko');
  await expect(input).toHaveAttribute('placeholder', '한글로 입력');
  await expect(page.getByTestId('script-chip')).toHaveText('한');
  await input.focus();

  // Syllables recompose as you type, like a Korean IME.
  const seen: string[] = [];
  for (const k of 'akdtjf') { await page.keyboard.type(k); seen.push(await input.inputValue()); }
  expect(seen).toEqual(['ㅁ', '마', '망', '망ㅅ', '망서', '망설']);

  // Owner screenshot: iPad landscape, mid-word, with the 한 chip.
  const vp = page.viewportSize();
  await page.setViewportSize({ width: 1024, height: 768 });
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, 'auto-convert-production-1024x768.png') });
  if (vp) await page.setViewportSize(vp);

  // Backspace removes one keystroke (one jamo) at a time.
  const back: string[] = [];
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Backspace'); back.push(await input.inputValue()); }
  expect(back).toEqual(['망서', '망ㅅ', '망']);

  await page.keyboard.type('tjfdlek');
  await expect(input).toHaveValue('망설이다');
  expect(await input.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(4);

  // Space commits: Backspace then deletes whole characters (the browser default).
  await page.keyboard.type(' ');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await expect(input).toHaveValue('망설이');
  await page.keyboard.type('ek'); // a new run
  await expect(input).toHaveValue('망설이다');

  await page.keyboard.press('Enter');
  await expect(page.getByTestId('feedback')).toHaveAttribute('data-grade', 'correct');
  await expect(page.getByTestId('fb-response')).toHaveCount(0);
  expect((await currentQ(page)).qid).toBe(q.qid);
});

test('production: Shift for tense consonants and ㅒ, digits pass through, mid-string insertion', async ({ page }) => {
  test.setTimeout(120_000);
  const b = await setup(page);
  await reviewUntil(page, b, (x) => x.qtype === 'production');
  const input = page.locator('input.answer');
  await input.focus();
  await page.keyboard.type('RkRek dOrl 3');
  await expect(input).toHaveValue('깎다 얘기 3');
  // Click into the middle (a caret move commits), then type: text either side is kept.
  await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(3, 3));
  await input.dispatchEvent('pointerdown');
  await page.keyboard.type('dlfr');
  await expect(input).toHaveValue('깎다 읽얘기 3');
  expect(await input.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(4);
});

test('meaning: Hangul from the Korean keyboard turns back into Latin keys', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP');
  test.setTimeout(120_000);
  const b = await setup(page);
  await reviewUntil(page, b, (x) => x.qtype === 'meaning');
  const input = page.locator('input.answer');
  await expect(input).toHaveAttribute('lang', 'en');
  await expect(input).toHaveAttribute('placeholder', 'Type in English');
  await expect(page.getByTestId('script-chip')).toHaveText('EN');
  await input.focus();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.insertText', { text: 'ㅗ디ㅣㅐ' });
  await expect(input).toHaveValue('hello');
  expect(await input.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(5);
  // Through a real IME composition: untouched while composing, converted once it ends.
  await cdp.send('Input.insertText', { text: ' ' });
  await cdp.send('Input.imeSetComposition', { text: 'ㅅ', selectionStart: 1, selectionEnd: 1 });
  await expect(input).toHaveValue('hello ㅅ');
  await cdp.send('Input.insertText', { text: 'ㅅ' });
  await cdp.send('Input.imeSetComposition', { text: 'ㅐ', selectionStart: 1, selectionEnd: 1 });
  await cdp.send('Input.insertText', { text: 'ㅐ' });
  await expect(input).toHaveValue('hello to');
});

test('setting off: no conversion; the wrong-script fallback still offers the fix', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP');
  test.setTimeout(150_000);
  const b = await setup(page);
  await setAutoConvert(page, false);
  await page.evaluate(() => { location.hash = '#/'; });
  const q = await reviewUntil(page, b, (x) => x.qtype === 'production' && x.itemId === 'v:망설이다');
  const input = page.locator('input.answer');
  await expect(input).toHaveAttribute('data-autoconvert', 'off');
  await input.focus();
  await page.keyboard.type('akdtjfdlek');
  await expect(input).toHaveValue('akdtjfdlek');
  await page.keyboard.press('Enter');
  const hint = page.getByTestId('hint');
  await expect(hint).toContainText('Korean keyboard');
  await hint.getByRole('button', { name: /Use/ }).click();
  await expect(input).toHaveValue('망설이다');
  await input.press('Enter');
  await expect(page.getByTestId('feedback')).toHaveAttribute('data-grade', 'correct');
  expect((await currentQ(page)).qid).toBe(q.qid);
  await next(page);

  // Meaning field: Hangul stays Hangul, and grading offers the Latin.
  let m = await currentQ(page);
  for (let g = 0; m.qtype !== 'meaning' && g < 100; g++) { await submit(page, m, correctAnswer(b, m)); await next(page); m = await currentQ(page); }
  expect(m.qtype).toBe('meaning');
  await input.focus();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.insertText', { text: 'ㅗ디ㅣㅐ' });
  await expect(input).toHaveValue('ㅗ디ㅣㅐ');
  await input.press('Enter');
  await expect(hint).toContainText('English keyboard');
  await expect(hint.getByRole('button', { name: /Use/ })).toContainText('hello');
});
