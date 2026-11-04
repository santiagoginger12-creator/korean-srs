// Vocab/expression cloze hint ladder (D74): English cue → 초성 + syllables → dictionary form.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExpressionItem, Item, VocabItem } from '@ksrs/content';
import { blankedWords, choseong, dictForm, initialsHint, isLexicalCloze, maxClozeHintLevel } from '../src/state/hints.ts';

const HANGUL_SYLLABLE = /[가-힣]/u;
const vocab = (word: string) => ({ kind: 'vocab', word }) as VocabItem;
const expr = (text: string) => ({ kind: 'expression', text }) as ExpressionItem;

test('choseong: initial consonants, tense ones kept, other characters untouched', () => {
  assert.equal(choseong('사정'), 'ㅅㅈ');
  assert.equal(choseong('어쨌든'), 'ㅇㅉㄷ');
  assert.equal(choseong('쐬다'), 'ㅆㄷ');
  assert.equal(choseong('A4용지'), 'A4ㅇㅈ');
});

test('initialsHint: one word → "ㅅㅈ (2)"; a multi-word headword → per word, spaced', () => {
  assert.equal(initialsHint('사정'), 'ㅅㅈ (2)');
  assert.equal(initialsHint('돌아다니다'), 'ㄷㅇㄷㄴㄷ (5)');
  assert.equal(initialsHint('총대를 메다', '결국 막내가 ', ' 팀장에게 업무 분담 문제를 건의했다.'), 'ㅊㄷㄹ ㅁㄷ (3+2)');
});

test('initialsHint: a proverb cloze hints only the blanked words', () => {
  assert.equal(initialsHint('사공이 많으면 배가 산으로 간다', '사공이 많으면 배가 ', ' 간다더니, 다들 한마디씩 거들다 보니 디자인이 엉망이 됐다.'), 'ㅅㅇㄹ (3)');
  assert.equal(initialsHint('가랑비에 옷 젖는 줄 모른다', '', ' 옷 젖는 줄 모른다더니, 커피값만 모아 보니 한 달에 이십만 원이 넘더라.'), 'ㄱㄹㅂㅇ (4)');
  assert.deepEqual(blankedWords('굴러온 돌이 박힌 돌 뺀다', '굴러온 돌이 ', ' 뺀다더니, 새로 들어온 업체가 오래된 거래처를 밀어냈다.'), ['박힌', '돌']);
  assert.deepEqual(blankedWords('핑계 없는 무덤 없다', '핑계 없는 ', ' 없다더니, 이번에도 차가 막혀서 늦었다고 하더라.'), ['무덤']);
  // Nothing visible: the whole headword.
  assert.deepEqual(blankedWords('도마 위에 오르다', '공공 기관의 관행이 다시 ', '.'), ['도마', '위에', '오르다']);
});

test('ladder selection: vocab/expressions always reach level 2; grammar follows its cue', () => {
  assert.equal(isLexicalCloze('v:사정', vocab('사정')), true);
  assert.equal(isLexicalCloze('x:총대를-메다', expr('총대를 메다')), true);
  assert.equal(isLexicalCloze('g:는-바람에', { kind: 'grammar' } as Item), false);
  assert.equal(isLexicalCloze('v:missing', undefined), true);
  assert.equal(isLexicalCloze('g:missing', undefined), false);
  assert.equal(maxClozeHintLevel('v:사정', vocab('사정'), 'circumstances'), 2);
  assert.equal(maxClozeHintLevel('g:a', { kind: 'grammar' } as Item, '졸다 + -는 바람에'), 2);
  assert.equal(maxClozeHintLevel('g:a', { kind: 'grammar' } as Item, '졸다'), 1);
  assert.equal(dictForm(vocab('사정')), '사정');
  assert.equal(dictForm(expr('총대를 메다')), '총대를 메다');
  assert.equal(dictForm({ kind: 'grammar' } as Item), '');
});

// The real seed: nothing shown before level 2 contains the answer.
const SEED = fileURLToPath(new URL('../../../packages/content/seed', import.meta.url));
function realSeed(): Item[] {
  const walk = (d: string): string[] => readdirSync(d).sort().flatMap((f) => {
    const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.json') && !p.endsWith('idRedirects.json') ? [p] : [];
  });
  return walk(SEED).flatMap((f) => JSON.parse(readFileSync(f, 'utf8')) as Item[]);
}

test('real seed: vocab/expression clozes leak nothing at levels 0 and 1', () => {
  let n = 0;
  for (const it of realSeed()) {
    if (it.kind !== 'vocab' && it.kind !== 'expression') continue;
    const hw = dictForm(it);
    for (const z of it.questions.cloze ?? []) {
      n++;
      const [before = '', after = ''] = z.sentence.split('{{}}');
      const where: string = `${it.id} ${z.id}`;
      // Level 0: the cue and translation are English only; the sentence never shows the headword.
      assert.ok(!/\p{Script=Hangul}/u.test(z.cue), `${where}: cue has Hangul: ${z.cue}`);
      assert.ok(!/\p{Script=Hangul}/u.test(z.en), `${where}: en has Hangul: ${z.en}`);
      assert.ok(!before.includes(hw) && !after.includes(hw), `${where}: headword in sentence`);
      for (const a of z.accepted) assert.ok(!z.cue.includes(a) && !z.en.includes(a), `${where}: answer ${a} shown`);
      // Level 1: initials only (no full syllable), non-empty.
      const hint = initialsHint(hw, before, after);
      assert.ok(hint.length > 0, `${where}: empty initials`);
      assert.ok(!HANGUL_SYLLABLE.test(hint), `${where}: initials hint has a syllable: ${hint}`);
    }
  }
  assert.ok(n > 400, `expected the full seed (got ${n} clozes)`);
});

test('real seed: production prompts and hints for vocab/expressions are English only', () => {
  for (const it of realSeed()) {
    if (it.kind !== 'vocab' && it.kind !== 'expression') continue;
    const p = it.questions.production;
    if (!p) continue;
    const shown = `${p.promptEn} ${p.contextHint ?? ''}`;
    assert.ok(!/\p{Script=Hangul}/u.test(shown), `${it.id}: ${shown}`);
  }
});
