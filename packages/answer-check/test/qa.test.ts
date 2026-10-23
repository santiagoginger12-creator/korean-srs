// QA regression tests (M1 review). Each block names the bug it pins.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { FeatureRule, ParticleTolerance, QuestionInstance } from '@ksrs/content';
import { check, compareEojeol, hasHonorificSi, isKnownEnglishWord, osaDistance, particleMatch, realWordSubstitution } from '../src/index.ts';

const meaning = (accepted: string[], rejected: string[] = []): QuestionInstance =>
  ({ qid: 'q', itemId: 'v:x', qtype: 'meaning', promptKo: 'x', accepted, rejected });
const production = (accepted: string[], rejected: string[] = []): QuestionInstance =>
  ({ qid: 'q', itemId: 'v:x', qtype: 'production', promptEn: 'x', accepted, rejected });
const cloze = (accepted: string[], tol: ParticleTolerance = 'loose'): QuestionInstance => ({
  qid: 'q', itemId: 'g:x', qtype: 'cloze', before: '', after: '', en: '', cue: '', accepted, nearMiss: [],
  particleTolerance: tol, spacingStrict: false,
});
const HAPSYO: FeatureRule = { kind: 'endsWith', any: ['ㅂ니다', '습니다'], label: '합쇼체' };
const register = (accepted: string[], core: string[]): QuestionInstance => ({
  qid: 'q', itemId: 'g:x', qtype: 'register', from: 'haeyo', to: 'hapsyo', source: '', accepted,
  features: [HAPSYO], coreWords: core, particleTolerance: 'loose', finalPunctOptional: true,
});

describe('BUG (high): English typo tolerance accepted a different real word', () => {
  const cases: [string, string][] = [
    ['ship', 'shop'], ['ship', 'shin'], ['to hate', 'hat'], ['to hate', 'have'], ['to hate', 'late'],
    ['to bear', 'bare'], ['to bear', 'beer'], ['dessert', 'desert'], ['to affect', 'effect'], ['quiet', 'quite'],
    ['angel', 'angle'], ['loose', 'lose'], ['to decide', 'decline'], ['payment', 'pavement'], ['to resign', 'design'],
    ['weather', 'whether'], ['stationery', 'stationary'], ['principle', 'principal'],
    ['to be quiet and still', 'be quite and still'],
  ];
  for (const [acc, resp] of cases) {
    test(`${resp} for ${acc} → incorrect`, () => assert.equal(check(meaning([acc]), resp).outcome, 'incorrect'));
  }
  test('the hint names the real word', () => {
    assert.equal(check(meaning(['dessert']), 'desert').hint, '"desert" is a different word.');
  });
});

describe('English leniency kept for genuine typos in longer words', () => {
  const cases: [string, string][] = [
    ['to hesitate', 'hesitat'], ['to hesitate', 'hesitaet'], ['to receive', 'recieve'], ['to be cumbersome', 'cumbresome'],
    ['embarrassed', 'embarassed'], ['necessary', 'neccessary'], ['tranquil', 'tranquill'], ['a hassle', 'hassel'],
    ['to resign', 'resing'], ['approval', 'aproval'], ['definitely', 'definately'],
    // inflection / derivation of the target is not a "different word"
    ['to hesitate', 'hesitates'], ['approval', 'approve'],
  ];
  for (const [acc, resp] of cases) {
    test(`${resp} for ${acc} → correct/typo`, () => {
      const r = check(meaning([acc]), resp);
      assert.equal(r.outcome, 'correct'); assert.equal(r.layer, 'typo');
    });
  }
  test('OSA distance counts a transposition as one edit', () => {
    assert.equal(osaDistance('hassel', 'hassle'), 1);
    assert.equal(osaDistance('recieve', 'receive'), 1);
    assert.equal(osaDistance('ship', 'ship'), 0);
  });
  test('short words are exact-only (n ≤ 4)', () => {
    assert.equal(check(meaning(['debt']), 'dept').outcome, 'incorrect');
    assert.equal(check(meaning(['debt']), 'Debt.').outcome, 'correct');
  });
  test('realWordSubstitution / isKnownEnglishWord', () => {
    assert.equal(realWordSubstitution('shop', 'ship'), 'shop');
    assert.equal(realWordSubstitution('hesitat', 'hesitate'), null);
    assert.equal(realWordSubstitution('ships', 'ship'), null);
    assert.ok(isKnownEnglishWord('shipping'));
    assert.ok(isKnownEnglishWord('hated'));
    assert.ok(!isKnownEnglishWord('hesitat'));
    assert.ok(isKnownEnglishWord('zorble', new Set(['zorble'])));
  });
});

describe('otherMeanings: another item\'s meaning is never a typo match', () => {
  test('exact other meaning → incorrect/otherHeadword', () => {
    const r = check(meaning(['payment', 'settlement']), 'approval', { otherMeanings: ['approval (sign-off)'] });
    assert.equal(r.outcome, 'incorrect'); assert.equal(r.layer, 'otherHeadword');
  });
  test('typo landing on a word from another item\'s meaning → incorrect', () => {
    // "meditate" is not in the built-in list; here it is another item's gloss.
    assert.equal(check(meaning(['to mediate']), 'meditate').outcome, 'correct');
    assert.equal(check(meaning(['to mediate']), 'meditate', { otherMeanings: ['to meditate'] }).outcome, 'incorrect');
  });
  test('accepted answer still wins over an identical other meaning', () => {
    assert.equal(check(meaning(['payment']), 'payment', { otherMeanings: ['payment'] }).outcome, 'correct');
  });
});

describe('English normalization probes that held up', () => {
  test('"to be X" also accepts "X"', () => {
    assert.equal(check(meaning(['to be cumbersome']), 'cumbersome').layer, 'exact');
    assert.equal(check(meaning(['to be quiet and still']), 'quiet and still').layer, 'exact');
    assert.equal(check(meaning(['to be']), 'be').outcome, 'correct');
  });
  test('"to " and parentheses', () => {
    assert.equal(check(meaning(['to hesitate']), 'To hesitate (about something)').layer, 'exact');
    assert.equal(check(meaning(['to hesitate']), 'to').outcome, 'incorrect');
  });
  test('substrings of the accepted meaning are not accepted', () => {
    assert.equal(check(meaning(['to hesitate']), 'he').outcome, 'incorrect');
    assert.equal(check(meaning(['to hesitate']), 'hesitation').outcome, 'incorrect');
  });
});

describe('BUG (high): loose particle tolerance accepted a truncated word as a dropped particle', () => {
  test('놀이 → 놀 is close (ambiguous), not correct', () => {
    const r = check(cloze(['놀이']), '놀');
    assert.equal(r.outcome, 'close'); assert.equal(r.layer, 'particle');
    assert.deepEqual(compareEojeol('놀', '놀이', 'loose'), { kind: 'ambiguousDrop', particle: '이' });
    assert.equal(particleMatch('놀 시간', '놀이 시간', 'loose')?.kind, 'ambiguous');
  });
  test('와/과 and (으)로 are never "dropped" (결과, 성과, 도로, 피로 are words)', () => {
    for (const [acc, resp] of [['결과', '결'], ['성과', '성'], ['도로', '도'], ['피로', '피'], ['고속도로', '고속도']]) {
      assert.notEqual(check(cloze([acc as string]), resp as string).outcome, 'correct', `${resp} for ${acc}`);
      assert.deepEqual(compareEojeol(resp as string, acc as string, 'loose'), { kind: 'different' });
    }
  });
  test('genuine drops still pass', () => {
    assert.equal(check(cloze(['그 일은']), '그 일').outcome, 'correct');          // 은 after 1 syllable
    assert.equal(check(cloze(['놀이를']), '놀이').outcome, 'correct');
    assert.equal(check(cloze(['아이가']), '아이').outcome, 'correct');           // 가 after 2 syllables
    assert.equal(check(cloze(['등산을 가요']), '등산 가요').outcome, 'correct');
  });
  test('allomorph tolerance never drops', () => {
    assert.equal(check(cloze(['놀이'], 'allomorph'), '놀').outcome, 'incorrect');
  });
});

describe('BUG (medium): register variant layer accepted Korean misspellings as correct', () => {
  const Q = register(['그 사람은 회의 시간에 늦는 바람에 발표를 놓쳤습니다.'], ['회의', '발표']);
  test('ㅔ/ㅐ in a long sentence → close with a ㅔ/ㅐ hint', () => {
    const r = check(Q, '그 사람은 회의 시간애 늦는 바람에 발표를 놓쳤습니다.');
    assert.equal(r.outcome, 'close'); assert.equal(r.hint, 'check ㅔ/ㅐ');
  });
  test('됬습니다 for 됐습니다 → close', () => {
    const q = register(['그 계획은 실현이 안 됐습니다.'], ['계획', '실현']);
    assert.equal(check(q, '그 계획은 실현이 안 됬습니다').outcome, 'close');
  });
  test('real variants are still accepted', () => {
    const q = register(['내일 회의에 참석할 것입니다.', '내일 회의에 참석하겠습니다.'], ['내일', '회의', '참석']);
    const r = check(q, '내일 회의에 참석할 겁니다.');
    assert.equal(r.outcome, 'correct'); assert.equal(r.layer, 'variant');
  });
});

describe('BUG (medium): dropped honorific -시- passed as a variant', () => {
  const Q = register(['선생님께서 내일 학교에 오십니다.'], ['선생님', '내일', '학교']);
  test('옵니다 for 오십니다 → close with hint', () => {
    const r = check(Q, '선생님께서 내일 학교에 옵니다.');
    assert.equal(r.outcome, 'close'); assert.match(r.hint ?? '', /-\(으\)시-/);
  });
  test('honorific kept → correct (exact or variant)', () => {
    assert.equal(check(Q, '선생님께서 내일 학교에 오십니다').outcome, 'correct');
    assert.equal(check(Q, '선생님께서 내일 학교에 오시겠습니다').outcome, 'correct');
  });
  test('해요체 answer to a 합쇼체 prompt is still incorrect/feature', () => {
    const r = check(Q, '선생님께서 내일 학교에 오세요.');
    assert.equal(r.outcome, 'incorrect'); assert.equal(r.layer, 'feature');
  });
  test('hasHonorificSi', () => {
    for (const w of ['오십니다', '오셨어요', '가세요', '오신', '하실']) assert.ok(hasHonorificSi(w), w);
    for (const w of ['옵니다', '갔습니다', '했어요']) assert.ok(!hasHonorificSi(w), w);
  });
});

describe('Korean input probes that held up', () => {
  test('IME leftovers are close (retry), never correct', () => {
    assert.equal(check(production(['망설이다']), '망설이ㄷ').outcome, 'close');
    assert.equal(check(production(['망설이다']), '망설이다ㄱ').outcome, 'close');
  });
  test('double spaces and NFD', () => {
    assert.equal(check(production(['결정을 내리다']), '결정을  내리다').layer, 'exact');
    const q = register(['내일 회의에 참석하겠습니다.'], ['내일', '회의', '참석']);
    assert.equal(check(q, '내일 회의에 참석하겠습니다'.normalize('NFD')).outcome, 'correct');
  });
  test('결제/결재 both ways, with Hanja glosses', () => {
    assert.equal(check(production(['결제'], ['결재']), '결재(決裁)').outcome, 'incorrect');
    assert.equal(check(production(['결재'], ['결제']), '결제').outcome, 'incorrect');
    assert.equal(check(production(['결재'], ['결제']), '결재(決裁)').outcome, 'correct');
  });
  test('Hanja gloss inside a sentence is stripped', () => {
    assert.equal(check(production(['결제를 하다']), '결제(決濟)를 하다').outcome, 'correct');
  });
});
