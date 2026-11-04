import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { FeatureRule, QuestionInstance } from '@ksrs/content';
import { check, checkFeatures, checkCoreWords, diffHint, evalFeature, stripClozeContext } from '../src/index.ts';

const meaning = (accepted: string[], rejected: string[] = []): QuestionInstance =>
  ({ qid: 'q', itemId: 'v:x', qtype: 'meaning', promptKo: 'x', accepted, rejected });
const production = (accepted: string[], rejected: string[] = []): QuestionInstance =>
  ({ qid: 'q', itemId: 'v:x', qtype: 'production', promptEn: 'x', accepted, rejected });
const cloze = (accepted: string[], extra: Partial<Extract<QuestionInstance, { qtype: 'cloze' }>> = {}): QuestionInstance => ({
  qid: 'q', itemId: 'g:x', qtype: 'cloze', before: '', after: '', en: '', cue: '', accepted, nearMiss: [],
  particleTolerance: 'allomorph', spacingStrict: false, ...extra,
});

// §8.5 fixtures
const RAIN = cloze(['쏟아지는 바람에'], {
  before: '비가 갑자기', after: '우산도 없이 뛰어야 했다.', cue: '쏟아지다 + -는 바람에',
  nearMiss: [{ answer: '쏟아지는 통에', hint: 'Valid sibling, but target is -는 바람에 (neutral cause); -는 통에 implies chaotic circumstances' }],
});
const HAPSYO: FeatureRule = { kind: 'endsWith', any: ['ㅂ니다', '습니다'], label: 'Ending must be 합쇼체 (-ㅂ니다/-습니다)' };
const MEETING: QuestionInstance = {
  qid: 'q', itemId: 'g:x', qtype: 'register', from: 'haeyo', to: 'hapsyo', source: '내일 회의에 참석할 거예요.',
  accepted: ['내일 회의에 참석할 것입니다.', '내일 회의에 참석하겠습니다.'],
  features: [HAPSYO], coreWords: ['내일', '회의', '참석'], particleTolerance: 'allomorph', finalPunctOptional: true,
};
const PLAN = (accepted: string[]): QuestionInstance => ({
  qid: 'q', itemId: 'g:x', qtype: 'register', from: 'written', to: 'spoken', source: '그러나 그 계획은 실현되지 않았다.',
  accepted,
  features: [
    { kind: 'notContains', any: ['그러나'], label: '그러나 is written register' },
    { kind: 'endsWith', any: ['요'], label: 'End in 해요체 (-요)' },
  ],
  coreWords: ['계획', '실현'], particleTolerance: 'loose', finalPunctOptional: true,
});
const PLAN_ACC = ['근데 그 계획은 실현이 안 됐어요', '그런데 그 계획은 실현 안 됐어요'];

describe('§8.5 worked examples', () => {
  test('meaning 망설이다: "Hesitate" → correct/exact', () => {
    const r = check(meaning(['to hesitate']), 'Hesitate');
    assert.equal(r.outcome, 'correct'); assert.equal(r.layer, 'exact');
  });
  test('meaning 망설이다: "hesitat" → correct/typo (n=8, d=1)', () => {
    const r = check(meaning(['to hesitate']), 'hesitat');
    assert.equal(r.outcome, 'correct'); assert.equal(r.layer, 'typo'); assert.equal(r.distance, 1);
    assert.ok(r.notes.some((n) => n.startsWith('typo')));
  });
  test('production payment: 결재 → incorrect/rejected with gloss', () => {
    const r = check(production(['결제'], ['결재']), '결재', { otherHeadwords: new Map([['결재', 'approval (sign-off)']]) });
    assert.equal(r.outcome, 'incorrect'); assert.equal(r.layer, 'rejected');
    assert.equal(r.hint, '결재 = approval (sign-off)');
  });
  test('production pillow: 배개 → close/jamo d=0.5, "check ㅔ/ㅐ"', () => {
    const r = check(production(['베개']), '배개');
    assert.equal(r.outcome, 'close'); assert.equal(r.layer, 'jamo'); assert.equal(r.distance, 0.5);
    assert.equal(r.hint, 'check ㅔ/ㅐ');
  });
  test('production hesitate: 망서리다 → close/jamo d=1', () => {
    const r = check(production(['망설이다']), '망서리다');
    assert.equal(r.outcome, 'close'); assert.equal(r.layer, 'jamo'); assert.equal(r.distance, 1);
    assert.equal(r.hint, 'missing ㅇ');
  });
  test('production hesitate: akdtjfdlek → close/script with 망설이다', () => {
    const r = check(production(['망설이다']), 'akdtjfdlek');
    assert.equal(r.outcome, 'close'); assert.equal(r.layer, 'script'); assert.equal(r.converted, '망설이다');
    assert.match(r.hint ?? '', /Korean keyboard/);
  });
  test('cloze: 쏟아지는바람에 → correct/spacing + 띄어쓰기 note', () => {
    const r = check(RAIN, '쏟아지는바람에');
    assert.equal(r.outcome, 'correct'); assert.equal(r.layer, 'spacing');
    assert.deepEqual(r.notes, ['띄어쓰기: 쏟아지는 바람에']);
  });
  test('cloze: 쏟아지는 통에 → close/nearMiss with hint', () => {
    const r = check(RAIN, '쏟아지는 통에');
    assert.equal(r.outcome, 'close'); assert.equal(r.layer, 'nearMiss'); assert.match(r.hint ?? '', /-는 통에/);
  });
  test('register: 참석할 겁니다. → correct/variant', () => {
    const r = check(MEETING, '내일 회의에 참석할 겁니다.');
    assert.equal(r.outcome, 'correct'); assert.equal(r.layer, 'variant');
    assert.equal(r.matched, '내일 회의에 참석할 것입니다.');
  });
  test('register: 참석할 거에요 → incorrect/feature with label', () => {
    const r = check(MEETING, '내일 회의에 참석할 거에요');
    assert.equal(r.outcome, 'incorrect'); assert.equal(r.layer, 'feature'); assert.equal(r.hint, HAPSYO.label);
  });
  test('register: 참성할 것입니다 → close/coreWord', () => {
    const r = check(MEETING, '내일 회의에 참성할 것입니다');
    assert.equal(r.outcome, 'close'); assert.equal(r.layer, 'coreWord'); assert.match(r.hint ?? '', /참석/);
  });
  test('written→spoken: 근데 그 계획 실현 안 됐어요 → correct (particle loose)', () => {
    const r = check(PLAN(PLAN_ACC), '근데 그 계획 실현 안 됐어요');
    assert.equal(r.outcome, 'correct'); assert.equal(r.layer, 'particle');
  });
  test('written→spoken: same, only the 그런데 answer listed → correct (particle + variant)', () => {
    const r = check(PLAN([PLAN_ACC[1] as string]), '근데 그 계획 실현 안 됐어요');
    assert.equal(r.outcome, 'correct'); assert.equal(r.layer, 'variant');
  });
  test('written→spoken: 그러나 … → incorrect/feature', () => {
    const r = check(PLAN(PLAN_ACC), '그러나 그 계획은 실현 안 됐어요');
    assert.equal(r.outcome, 'incorrect'); assert.equal(r.layer, 'feature'); assert.equal(r.hint, '그러나 is written register');
  });
});

describe('meaning', () => {
  test('slash alternatives and multiple entries', () => {
    const q = meaning(['payment / settlement', 'clearing (of an account)']);
    assert.equal(check(q, 'settlement').outcome, 'correct');
    assert.equal(check(q, 'Clearing').outcome, 'correct');
  });
  test('Hangul in a meaning answer → close "answer in English"', () => {
    const r = check(meaning(['to hesitate']), '망설이다');
    assert.equal(r.outcome, 'close'); assert.equal(r.layer, 'script'); assert.match(r.hint ?? '', /English/);
    assert.equal(r.converted, undefined); // real Korean: no "Use …" offer
  });
  test('English typed on the Korean layout → close with the Latin offered (ㅗㄷ냣ㅁㅅㄷ → hesitate)', () => {
    const r = check(meaning(['to hesitate']), 'ㅅㅐ ㅗㄷ냣ㅁㅅㄷ');
    assert.equal(r.outcome, 'close'); assert.equal(r.layer, 'script'); assert.equal(r.converted, 'to hesitate');
    assert.match(r.hint ?? '', /English keyboard/);
    assert.equal(check(meaning(['to hesitate']), r.converted!).outcome, 'correct');
    assert.equal(check(meaning(['greeting']), 'ㅗ디ㅣㅐ').converted, 'hello');
    assert.equal(check(meaning(['to hesitate']), '결재').converted, undefined); // Korean, not stray keys
  });
  test('rejected meaning is incorrect, and typo tolerance never lands on it', () => {
    const q = meaning(['to affect'], ['to effect']);
    assert.equal(check(q, 'effect').outcome, 'incorrect');
    assert.equal(check(q, 'effect').layer, 'rejected');
    assert.equal(check(q, 'efect').outcome, 'incorrect');
  });
  test('typo tolerance follows §8.2 by length; rejected blocks look-alikes', () => {
    assert.equal(check(meaning(['eye']), 'eyes').outcome, 'incorrect');      // n=3 → 0
    // n=4 → 0 since QA (D30): one edit of a short word is almost always another word.
    assert.equal(check(meaning(['ship']), 'shop').outcome, 'incorrect');
    assert.equal(check(meaning(['ship'], ['shop']), 'shop').outcome, 'incorrect');
  });
  test('beyond tolerance → incorrect with reveal', () => {
    const r = check(meaning(['to hesitate']), 'to wait');
    assert.equal(r.outcome, 'incorrect'); assert.equal(r.layer, 'none'); assert.equal(r.matched, 'to hesitate');
  });
  test('userAccepted counts', () => {
    assert.equal(check(meaning(['to hesitate']), 'to waver', { userAccepted: ['to waver'] }).outcome, 'correct');
  });
  test('US/UK spelling', () => {
    assert.equal(check(meaning(['behavior']), 'behaviour').layer, 'exact');
  });
});

describe('edge cases', () => {
  test('empty and whitespace-only input → close/empty (no penalty)', () => {
    for (const s of ['', '   ', '​', '\t\n']) {
      for (const q of [meaning(['x']), production(['가']), RAIN, MEETING]) {
        const r = check(q, s);
        assert.equal(r.outcome, 'close'); assert.equal(r.layer, 'empty');
      }
    }
    assert.equal(check(meaning(['to hesitate']), '?!').layer, 'empty');
    assert.equal(check(production(['가']), '...').layer, 'empty');
  });
  test('final punctuation is ignored in production/cloze', () => {
    assert.equal(check(production(['베개']), '베개.').layer, 'exact');
    assert.equal(check(production(['베개']), '베개?!').layer, 'exact');
    assert.equal(check(RAIN, '쏟아지는 바람에…').layer, 'exact');
  });
  test('register with finalPunctOptional=false still forgives punctuation via spacing layer', () => {
    const q = { ...MEETING, finalPunctOptional: false } as QuestionInstance;
    assert.equal(check(q, '내일 회의에 참석할 것입니다.').layer, 'exact');
    assert.equal(check(q, '내일 회의에 참석할 것입니다').outcome, 'correct');
  });
  test('결제/결재 collision is always incorrect, even with a gloss-less rejected entry', () => {
    const q = production(['결제'], ['결재']);
    for (const s of ['결재', '결재.', ' 결 재 ', '결재(決裁)', 'rufwo']) {
      const r = check(q, s);
      if (s === 'rufwo') { assert.equal(r.layer, 'script'); assert.equal(r.converted, '결재'); continue; }
      assert.equal(r.outcome, 'incorrect', s); assert.equal(r.layer, 'rejected', s);
    }
    assert.equal(check(q, '결제(決濟)').outcome, 'correct');
    // the reverse item
    assert.equal(check(production(['결재'], ['결제']), '결제').outcome, 'incorrect');
  });
  test('other-item headword exact match → incorrect, but never if accepted', () => {
    const oh = new Map([['피곤', 'tiredness'], ['피로', 'fatigue']]);
    const r = check(production(['피로']), '피곤', { otherHeadwords: oh });
    assert.equal(r.outcome, 'incorrect'); assert.equal(r.layer, 'otherHeadword'); assert.equal(r.hint, '피곤 = tiredness');
    assert.equal(check(production(['피로']), '피로', { otherHeadwords: oh }).outcome, 'correct');
  });
  test('userAccepted overrides rejected', () => {
    assert.equal(check(production(['결제'], ['결재']), '결재', { userAccepted: ['결재'] }).outcome, 'correct');
  });
  test('mixed script: Latin in Korean field with Hangul present', () => {
    const r = check(production(['망설이다']), '망설dlek');
    assert.equal(r.layer, 'script'); assert.equal(r.converted, '망설이다');
  });
  test('English typed into a Korean field → close "answer in Korean"', () => {
    const r = check(production(['망설이다']), 'hesitate');
    assert.equal(r.outcome, 'close'); assert.equal(r.layer, 'script'); assert.equal(r.converted, undefined);
  });
  test('Latin in the accepted answer disables layer 0', () => {
    assert.equal(check(production(['SNS를 하다']), 'SNS를 하다').outcome, 'correct');
    assert.equal(check(production(['SNS를 하다']), 'sns를 하다').outcome, 'correct'); // Latin case-folded
  });
  test('interrupted composition and NFD are normalized before matching', () => {
    assert.equal(check(production(['갑니다']), '가ㅂ니다').layer, 'exact');
    assert.equal(check(production(['망설이다']), '망설이다'.normalize('NFD')).layer, 'exact');
  });
  test('spacingStrict turns a spacing difference into close', () => {
    const r = check(cloze(['쏟아지는 바람에'], { spacingStrict: true }), '쏟아지는바람에');
    assert.equal(r.outcome, 'close'); assert.equal(r.layer, 'spacing');
  });
  test('whole sentence typed into a cloze blank', () => {
    assert.equal(check(RAIN, '비가 갑자기 쏟아지는 바람에 우산도 없이 뛰어야 했다.').outcome, 'correct');
    assert.equal(stripClozeContext('쏟아지는 바람에', '비가 갑자기', '우산도'), '쏟아지는 바람에');
  });
  test('particle layer in cloze/production', () => {
    let r = check(cloze(['그 문제를']), '그 문제을');
    assert.equal(r.outcome, 'close'); assert.equal(r.layer, 'particle'); assert.match(r.hint ?? '', /문제을 → 문제를/);
    r = check(cloze(['그 일은'], { particleTolerance: 'loose' }), '그 일이');
    assert.equal(r.outcome, 'correct'); assert.equal(r.layer, 'particle');
    r = check(cloze(['그 일은'], { particleTolerance: 'allomorph' }), '그 일이');
    assert.notEqual(r.outcome, 'correct');
    assert.equal(check(production(['결정을 내리다']), '결정를 내리다').outcome, 'close');
  });
  test('a different word is never correct', () => {
    assert.equal(check(production(['애매하다', '모호하다']), '막연하다').outcome, 'incorrect');
    assert.equal(check(production(['피로']), '피곤').outcome, 'incorrect');
    assert.equal(check(production(['나이']), '나가').outcome, 'incorrect');
  });
  test('incorrect reveals the best match', () => {
    const r = check(production(['애매하다', '모호하다']), '모르다');
    assert.equal(r.outcome, 'incorrect'); assert.equal(r.matched, '모호하다');
  });
  test('nuance: key or option text', () => {
    const q: QuestionInstance = { qid: 'q', itemId: 'g:x', qtype: 'nuance', situation: '…', correctKey: 'b', options: [
      { key: 'a', text: '비가 오는 통에', why: '' }, { key: 'b', text: '비가 오는 바람에', why: '' }] };
    assert.equal(check(q, 'b').outcome, 'correct');
    assert.equal(check(q, 'B').outcome, 'correct');
    assert.equal(check(q, 'a').outcome, 'incorrect');
    assert.equal(check(q, '비가 오는 바람에.').outcome, 'correct');
    assert.equal(check(q, '비가오는 통에').outcome, 'incorrect');
    assert.equal(check(q, 'z').outcome, 'close');
  });
});

describe('layer 6 internals', () => {
  test('endsWith/contains compare in jamo space', () => {
    assert.equal(evalFeature(HAPSYO, '갑니다'), 'ok');
    assert.equal(evalFeature(HAPSYO, '겁니다'), 'ok');
    assert.equal(evalFeature(HAPSYO, '먹습니다'), 'ok');
    assert.equal(evalFeature(HAPSYO, '먹습니디'), 'near');
    assert.equal(evalFeature(HAPSYO, '먹어요'), 'missing');
    const yo: FeatureRule = { kind: 'endsWith', any: ['요'], label: '' };
    assert.equal(evalFeature(yo, '먹어'), 'missing');            // short features get no near miss
    const c: FeatureRule = { kind: 'contains', any: ['는 바람에'], scope: 'all', label: '' };
    assert.equal(evalFeature(c, '비가 오는 바람에 늦었다'), 'ok');
    assert.equal(evalFeature(c, '비가 오는 바럼에 늦었다'), 'near');
    assert.equal(evalFeature({ ...c, scope: 'lastEojeol' }, '오는 바람에 늦었다'), 'missing');
    assert.equal(evalFeature({ kind: 'notContains', any: ['그러나'], label: '' }, '근데'), 'ok');
  });
  test('missing feature beats near feature; near feature → close', () => {
    assert.equal(checkFeatures([HAPSYO, { kind: 'notContains', any: ['거'], label: 'x' }], '거 갑니디').status, 'missing');
    const r = check(MEETING, '내일 회의에 참석할 것입니디');
    assert.equal(r.outcome, 'close'); assert.equal(r.layer, 'feature');
  });
  test('core words', () => {
    assert.equal(checkCoreWords(['참석'], '참석할').status, 'ok');
    assert.equal(checkCoreWords(['가'], '갔다').status, 'ok');                 // jamo-space stem
    assert.equal(checkCoreWords(['참석'], '참성할').status, 'fuzzy');
    assert.equal(checkCoreWords(['참석'], '출석할').status, 'missing');
    const r = check(MEETING, '내일 모임에 참석할 겁니다');
    assert.equal(r.outcome, 'incorrect'); assert.equal(r.layer, 'coreWord');
  });
  test('variant needs similarity ≥ 0.7', () => {
    const r = check(MEETING, '내일 열리는 중요한 회의에는 제가 반드시 참석하도록 하겠습니다');
    assert.notEqual(r.layer, 'variant');
    assert.equal(check(MEETING, '내일 회의에 참석합니다').layer, 'variant');
  });
  test('wrong allomorph blocks a variant', () => {
    const q = { ...MEETING, accepted: ['내일 회의를 진행할 것입니다'], coreWords: ['회의', '진행'] } as QuestionInstance;
    const r = check(q, '내일 회의을 진행하겠습니다');
    assert.equal(r.outcome, 'close'); assert.equal(r.layer, 'particle');
  });
});

test('diffHint', () => {
  assert.equal(diffHint([]), 'Check the spacing.');
  assert.equal(diffHint([{ op: 'del', ch: 'ㅅ' }]), 'extra ㅅ');
  assert.equal(diffHint([{ op: 'del', ch: 'a' }, { op: 'del', ch: 'b' }, { op: 'del', ch: 'c' }]), 'extra a; extra b; …');
});

test('performance: < 2 ms per check', () => {
  const qs: [QuestionInstance, string][] = [
    [MEETING, '내일 회의에 참성할 것입니다'], [PLAN(PLAN_ACC), '그런데 그 계획 실현이 안 됐어요'],
    [RAIN, '쏟아지는 통에'], [production(['망설이다']), '망서리다'], [meaning(['to hesitate']), 'hesitat'],
  ];
  for (const [q, s] of qs) check(q, s);
  const N = 200;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) for (const [q, s] of qs) check(q, s);
  const per = (performance.now() - t0) / (N * qs.length);
  assert.ok(per < 2, `${per.toFixed(3)} ms per check`);
});
