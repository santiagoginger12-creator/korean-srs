import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leakForms, validateBundle, validateItem } from '../src/validate.ts';
import { buildBundle } from '../src/bundle.ts';
import { canonicalJson, sha256Hex } from '../../srs-engine/src/util.ts';
import { buildQuestions, loadSeed, runSelfCheck } from '../bin/lib.ts';
import type { Item } from '../src/schema/types.ts';

// ---------------------------------------------------------------- fixtures

const src = { kind: 'original', license: 'original-owned' };
const base = (id: string, kind: string, extra: Record<string, unknown> = {}) =>
  ({ id, kind, level: 1, track: 'core', rev: 1, unlockDeps: [], gating: kind !== 'hanja', source: { ...src }, needs_review: false, tags: [], ...extra });

const ex = (n: number) => Array.from({ length: n }, (_, i) => ({ ko: `예문 ${i}.`, en: `Example ${i}.` }));

function fixture(): Record<string, any>[] {
  return [
    { ...base('h:決', 'hanja'), char: '決', hun: '결단할', eum: '결', meanings: ['decide'], mnemonic: 'water bursts a dike' },
    {
      ...base('v:결제', 'vocab'), word: '결제', meanings: ['payment'], pos: '명사', register: 'neutral',
      hanjaBreakdown: [{ syllable: '결', hanja: '決', hanjaId: 'h:決' }, { syllable: '제', hanja: '濟' }],
      collocations: [], examples: ex(2),
      questionTypes: ['meaning', 'production'],
      questions: { meaning: { accepted: ['payment'] }, production: { promptEn: 'payment', accepted: ['결제'], rejected: ['결재'] } },
    },
    {
      ...base('g:a', 'grammar'), pattern: '-a', meaning: 'a', nuance: 'a',
      attachment: [{ stem: 'V', tense: 'present', form: 'V-a', example: 'x' }],
      contrasts: [{ id: 'g:b', note: 'b differs' }], examples: ex(1),
      questionTypes: ['cloze', 'nuance', 'register'],
      questions: {
        cloze: [{ id: 'c1', sentence: '비가 {{}} 늦었다.', en: 'x', cue: 'y', accepted: ['오는 바람에'], nearMiss: [{ answer: '오는 통에', hint: 'h' }], particleTolerance: 'none' }],
        nuance: [{ id: 'n1', situation: 's', options: [{ text: 'A', correct: true, why: 'w' }, { text: 'B', correct: false, why: 'w' }] }],
        register: [{
          id: 'r1', from: 'haeyo', to: 'hapsyo', source: '갔어요.', accepted: ['갔습니다'],
          features: [{ kind: 'endsWith', any: ['ㅂ니다'], label: 'hapsyo' }], coreWords: ['갔'],
          particleTolerance: 'allomorph', finalPunctOptional: true,
        }],
      },
    },
    {
      ...base('g:b', 'grammar'), unlockDeps: [{ id: 'g:a', require: 'guru' }], pattern: '-b', meaning: 'b', nuance: 'b',
      attachment: [{ stem: 'V', tense: 'any', form: 'V-b', example: 'x' }],
      contrasts: [{ id: 'g:a', note: 'a differs' }], examples: ex(1),
      questionTypes: ['meaning'], questions: { meaning: { accepted: ['because'] } },
    },
    {
      ...base('x:눈코-뜰-새-없다', 'expression'), subtype: '관용구', text: '눈코 뜰 새 없다', meaning: 'swamped', literal: 'no time to open eyes and nose', usage: 'u',
      examples: ex(1), questionTypes: ['meaning'], questions: { meaning: { accepted: ['be swamped'] } },
    },
  ];
}

const errs = (items: unknown[], opts = {}) => validateBundle(items, opts).errors.map((e) => `${e.path}: ${e.msg}`);
function expectError(mutate: (f: Record<string, any>[]) => unknown[] | void, re: RegExp): void {
  const f = fixture();
  const out = mutate(f) ?? f;
  const e = errs(out);
  assert.ok(e.some((m) => re.test(m)), `expected an error matching ${re}, got:\n  ${e.join('\n  ') || '(none)'}`);
}
const at = (f: Record<string, any>[], id: string) => f.find((i) => i.id === id)!;

// ---------------------------------------------------------------- baseline

test('fixture bundle is valid', () => {
  const r = validateBundle(fixture());
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
  assert.equal(r.counts.total, 5);
  assert.deepEqual(r.counts.byLevel[1], { vocab: 1, grammar: 2, expression: 1, hanja: 1 });
});

// ---------------------------------------------------------------- structural

test('validateItem: non-object and unknown kind', () => {
  assert.equal(validateItem(42).ok, false);
  const r = validateItem({ ...base('v:x', 'noun') });
  assert.equal(r.ok, false);
  assert.match(r.errors[0]!.path, /\$\.kind/);
});

test('validateItem: field-level errors carry paths', () => {
  const v = fixture()[1]!;
  delete v.word; v.level = 0; v.register = 'casual'; v.examples = [{ ko: '' , en: 'x' }];
  v.questions.production.accepted = 'not-an-array';
  const r = validateItem(v);
  const paths = r.errors.map((e) => e.path);
  for (const p of ['$.word', '$.level', '$.register', '$.examples[0].ko', '$.questions.production.accepted']) {
    assert.ok(paths.includes(p), `missing ${p} in ${paths.join(', ')}`);
  }
});

test('validateItem: bad feature rule, enum and nested types', () => {
  const g = fixture()[2]!;
  g.questions.register[0].features = [{ kind: 'startsWith', any: [], label: 'x' }];
  g.questions.cloze[0].particleTolerance = 'strict';
  g.attachment[0].stem = 'Adj';
  const paths = validateItem(g).errors.map((e) => e.path);
  assert.ok(paths.includes('$.questions.register[0].features[0].kind'));
  assert.ok(paths.includes('$.questions.register[0].features[0].any'));
  assert.ok(paths.includes('$.questions.cloze[0].particleTolerance'));
  assert.ok(paths.includes('$.attachment[0].stem'));
});

test('validateItem: hanja require a mnemonic', () => {
  const h = fixture()[0]!; delete h.mnemonic;
  assert.ok(validateItem(h).errors.some((e) => e.path === '$.mnemonic'));
});

test('structural errors surface in the bundle report with origins', () => {
  const f = fixture(); delete f[1]!.word;
  const r = validateBundle(f, { origins: f.map((_, i) => `seed/L01/x.json#${i}`) });
  assert.ok(r.errors.some((e) => e.path === 'seed/L01/x.json#1 (v:결제).word'));
});

// ---------------------------------------------------------------- semantic rules

test('duplicate id', () => expectError((f) => [...f, structuredClone(f[4]!)], /duplicate id/));
test('id prefix must match kind', () => expectError((f) => { at(f, 'g:b').id = 'v:b'; at(f, 'g:a').contrasts = []; }, /must start with "g:"/));
test('dangling unlockDep', () => expectError((f) => { at(f, 'g:b').unlockDeps = [{ id: 'g:nope', require: 'lesson' }]; }, /unresolved reference g:nope/));
test('dangling hanjaBreakdown.hanjaId', () => expectError((f) => { at(f, 'v:결제').hanjaBreakdown[1].hanjaId = 'h:濟'; }, /unresolved reference h:濟/));
test('hanjaBreakdown.hanjaId must point at a hanja', () => expectError((f) => { at(f, 'v:결제').hanjaBreakdown[0].hanjaId = 'g:a'; }, /is a grammar, not hanja/));
test('hanjaBreakdown char must match the hanja item', () => expectError((f) => { at(f, 'v:결제').hanjaBreakdown[0].hanja = '結'; }, /does not match h:決/));
test('hanjaBreakdown syllable must occur in the word', () => expectError((f) => { at(f, 'v:결제').hanjaBreakdown[1].syllable = '재'; }, /does not occur in "결제"/));
test('dangling contrast', () => expectError((f) => { at(f, 'g:a').contrasts = [{ id: 'g:zzz', note: 'n' }]; }, /unresolved reference g:zzz/));

test('dependency cycle (explicit)', () =>
  expectError((f) => { at(f, 'g:a').unlockDeps = [{ id: 'g:b', require: 'guru' }]; }, /dependency cycle: .*g:a.*g:b|dependency cycle: .*g:b.*g:a/));

test('self-dependency', () => expectError((f) => { at(f, 'g:a').unlockDeps = [{ id: 'g:a', require: 'guru' }]; }, /depends on itself/));

test('dependency cycle through an implicit hanja dep', () => {
  // Hanja deps are disallowed outright, but the cycle must still be detected through hanjaBreakdown.
  expectError((f) => { at(f, 'h:決').unlockDeps = [{ id: 'v:결제', require: 'lesson' }]; }, /dependency cycle: .*h:決.*v:결제|dependency cycle: .*v:결제.*h:決/);
});

test('dep level must be ≤ item level', () => expectError((f) => { at(f, 'g:a').level = 2; }, /dep g:a is level 2 > item level 1/));
test('implicit hanja dep level must be ≤ vocab level', () => expectError((f) => { at(f, 'h:決').level = 3; }, /hanja h:決 is level 3 > item level 1/));
test('hanja dep cannot require guru', () => expectError((f) => { at(f, 'g:b').unlockDeps.push({ id: 'h:決', require: 'guru' }); }, /never reviewed/));

test('hanja with gating true', () => expectError((f) => { at(f, 'h:決').gating = true; }, /gating: false/));
test('hanja with empty mnemonic', () => expectError((f) => { at(f, 'h:決').mnemonic = '  '; }, /mnemonic/));
test('hanja with questionTypes', () => expectError((f) => { at(f, 'h:決').questionTypes = ['meaning']; }, /lesson-only/));

test('reviewable with empty questionTypes', () => expectError((f) => { at(f, 'g:b').questionTypes = []; }, /1–3 question types/));
test('listed qtype without a spec', () => expectError((f) => { at(f, 'g:b').questionTypes = ['meaning', 'production']; }, /lists "production" but no spec/));
test('listed qtype with an empty prompt list', () => expectError((f) => { at(f, 'g:a').questions.nuance = []; }, /lists "nuance" but no spec/));
test('unlisted spec is a warning, not an error', () => {
  const f = fixture(); at(f, 'g:b').questions.production = { promptEn: 'x', accepted: ['y'] };
  const r = validateBundle(f);
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => /not listed in questionTypes/.test(w.msg)));
});
test('answer both accepted and rejected', () => expectError((f) => { at(f, 'v:결제').questions.production.rejected = ['결제']; }, /both accepted and rejected/));

test('cloze with two {{}}', () => expectError((f) => { at(f, 'g:a').questions.cloze[0].sentence = '{{}} 비가 {{}} 늦었다.'; }, /exactly one "\{\{\}\}" \(found 2\)/));
test('cloze with no {{}}', () => expectError((f) => { at(f, 'g:a').questions.cloze[0].sentence = '비가 와서 늦었다.'; }, /found 0/));
test('cloze nearMiss equal to an accepted answer', () => expectError((f) => { at(f, 'g:a').questions.cloze[0].nearMiss[0].answer = '오는 바람에'; }, /both accepted and rejected/));

test('nuance with two correct options', () => expectError((f) => { at(f, 'g:a').questions.nuance[0].options[1].correct = true; }, /exactly one correct option \(has 2\)/));
test('nuance with no correct option', () => expectError((f) => { at(f, 'g:a').questions.nuance[0].options[0].correct = false; }, /has 0/));
test('nuance with one option', () => expectError((f) => { at(f, 'g:a').questions.nuance[0].options.pop(); }, /2–3 options/));
test('nuance with four options', () => expectError((f) => {
  const o = at(f, 'g:a').questions.nuance[0].options; o.push({ text: 'C', correct: false, why: 'w' }, { text: 'D', correct: false, why: 'w' });
}, /2–3 options \(has 4\)/));
test('duplicate prompt ids within an item', () => expectError((f) => { at(f, 'g:a').questions.nuance[0].id = 'c1'; }, /duplicate prompt id "c1"/));

test('register without accepted', () => expectError((f) => { at(f, 'g:a').questions.register[0].accepted = []; }, /at least one accepted/));
test('register without features', () => expectError((f) => { at(f, 'g:a').questions.register[0].features = []; }, /at least one feature/));
test('register without coreWords', () => expectError((f) => { at(f, 'g:a').questions.register[0].coreWords = []; }, /at least one core word/));
test('register coreWord missing from an accepted answer', () => expectError((f) => { at(f, 'g:a').questions.register[0].coreWords = ['왔']; }, /core word "왔" missing/));
test('register accepted answer failing its own contains feature', () => expectError((f) => {
  at(f, 'g:a').questions.register[0].features.push({ kind: 'notContains', any: ['갔'], scope: 'all', label: 'no 갔' });
}, /fails its own feature "no 갔"/));
test('register from === to', () => expectError((f) => { at(f, 'g:a').questions.register[0].to = 'haeyo'; }, /must differ/));

test('vocab with 1 example', () => expectError((f) => { at(f, 'v:결제').examples = ex(1); }, /2–3 examples \(has 1\)/));
test('vocab with 4 examples', () => expectError((f) => { at(f, 'v:결제').examples = ex(4); }, /2–3 examples \(has 4\)/));
test('grammar with no examples', () => expectError((f) => { at(f, 'g:b').examples = []; }, /at least 1 example/));

test('missing attribution for a non-owned license', () =>
  expectError((f) => { at(f, 'v:결제').source = { kind: 'krdict', license: 'CC-BY-SA-2.0-KR', krdictTargetCode: 1 }; }, /attribution is required/));
test('attribution present for a non-owned license passes', () => {
  const f = fixture();
  at(f, 'v:결제').source = { kind: 'krdict', license: 'CC-BY-SA-2.0-KR', attribution: '한국어기초사전 (국립국어원)', krdictTargetCode: 1 };
  assert.deepEqual(errs(f), []);
});

// ---------------------------------------------------------------- answer leaks (D74)

/** Gives v:결제 a clean, English-cued cloze; returns the item. */
function withVocabCloze(f: Record<string, any>[]): Record<string, any> {
  const v = at(f, 'v:결제');
  v.questionTypes = ['meaning', 'production', 'cloze'];
  v.questions.cloze = [{ id: 'c1', sentence: '저녁값은 카드로 {{}}했어요.', en: 'I paid for dinner by card.', cue: 'payment (by card)', accepted: ['결제'], particleTolerance: 'none' }];
  return v;
}
/** Gives the expression a clean, English-cued cloze; returns the item. */
function withExprCloze(f: Record<string, any>[]): Record<string, any> {
  const x = at(f, 'x:눈코-뜰-새-없다');
  x.questionTypes = ['meaning', 'cloze'];
  x.questions.cloze = [{ id: 'c1', sentence: '마감 주간이라 {{}}.', en: "It's deadline week, so I'm swamped.", cue: 'swamped, no time to breathe', accepted: ['눈코 뜰 새 없어'], particleTolerance: 'none' }];
  return x;
}

test('answer leaks: English-only cues, prompts and translations pass', () => {
  const f = fixture();
  withVocabCloze(f);
  withExprCloze(f);
  at(f, 'v:결제').questions.production.contextHint = 'Sino-Korean noun; not the look-alike for approving a document';
  assert.deepEqual(errs(f), []);
});
test('answer leaks: vocab cloze cue with Hangul', () =>
  expectError((f) => { withVocabCloze(f).questions.cloze[0].cue = '결제 · payment'; }, /cloze\[0\]\.cue: cue must be English only/));
test('answer leaks: initials (초성) in a cue count as Hangul', () =>
  expectError((f) => { withVocabCloze(f).questions.cloze[0].cue = 'ㄱㅈ · payment'; }, /cue must be English only/));
test('answer leaks: expression cloze cue with Hangul', () =>
  expectError((f) => { withExprCloze(f).questions.cloze[0].cue = '눈코 뜰 새 없다 + -어'; }, /x:눈코-뜰-새-없다\.questions\.cloze\[0\]\.cue/));
test('answer leaks: production promptEn with Hangul', () =>
  expectError((f) => { at(f, 'v:결제').questions.production.promptEn = 'payment (카드 ___)'; }, /production\.promptEn: production prompt must be English only/));
test('answer leaks: production contextHint with Hangul', () =>
  expectError((f) => { at(f, 'v:결제').questions.production.contextHint = 'not 결재 (approval)'; }, /production\.contextHint: production hint must be English only/));
test('answer leaks: headword in the cloze sentence outside {{}}', () =>
  expectError((f) => { withVocabCloze(f).questions.cloze[0].sentence = '결제 수단은 카드로 {{}}했어요.'; }, /sentence shows the answer "결제" outside/));
test('answer leaks: the -다 stem of an expression outside {{}}', () =>
  expectError((f) => { withExprCloze(f).questions.cloze[0].sentence = '어제도 눈코 뜰 새 없이 바빴는데 오늘도 {{}}.'; }, /shows the answer "눈코 뜰 새 없" outside/));
test('answer leaks: cloze en with Hangul', () =>
  expectError((f) => { withVocabCloze(f).questions.cloze[0].en = 'I paid (결제) by card.'; }, /cloze\[0\]\.en: translation must be English only/));
test('answer leaks: leakForms keeps a -다 stem only when it is 2+ characters', () => {
  assert.deepEqual(leakForms('지내다'), ['지내다', '지내']);
  assert.deepEqual(leakForms('쓰다'), ['쓰다']);
  assert.deepEqual(leakForms('경우'), ['경우']);
});
test('answer leaks: grammar clozes are exempt (D66 ladder)', () => {
  const f = fixture();
  at(f, 'g:a').questions.cloze[0].cue = '오다 + -는 바람에';
  at(f, 'g:a').questions.cloze[0].en = '비 = rain';
  assert.deepEqual(errs(f), []);
});
test('answer leaks: draft (non-seed) items get warnings, not errors', () => {
  const f = fixture();
  const v = withVocabCloze(f);
  v.source = { kind: 'user', license: 'user-owned', attribution: 'me' };
  v.questions.cloze[0].cue = '결제 · payment';
  v.questions.production.contextHint = '정의: 돈을 내는 일';
  const r = validateBundle(f);
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.filter((w) => /English only/.test(w.msg)).length, 2);
});

test('idRedirects: live source and dangling target', () => {
  const e = errs(fixture(), { idRedirects: { 'g:a': 'g:b', 'g:old': 'g:gone' } });
  assert.ok(e.some((m) => /still a live id/.test(m)));
  assert.ok(e.some((m) => /g:gone does not resolve/.test(m)));
});

test('needs_review produces warnings and a list, not errors', () => {
  const f = fixture();
  at(f, 'g:b').needs_review = true;
  at(f, 'v:결제').examples[1].needs_review = true;
  const r = validateBundle(f);
  assert.equal(r.ok, true);
  assert.equal(r.counts.needsReviewItems, 1);
  assert.equal(r.counts.needsReviewExamples, 1);
  assert.deepEqual(r.needsReview.map((n) => [n.id, n.item, n.examples]), [['v:결제', false, [1]], ['g:b', true, []]]);
  assert.equal(r.warnings.filter((w) => w.path === 'needs_review').length, 2);
});

// ---------------------------------------------------------------- bundle + questions

test('buildBundle: deterministic contentVersion, order-preserving, sensitive to content', () => {
  const items = validateBundle(fixture()).items;
  const deps = { canonicalJson, sha256Hex };
  const a = buildBundle(items, { 'g:old': 'g:a' }, deps);
  const b = buildBundle(structuredClone(items), { 'g:old': 'g:a' }, deps);
  assert.equal(a.formatVersion, 1);
  assert.match(a.contentVersion, /^[0-9a-f]{64}$/);
  assert.equal(a.contentVersion, b.contentVersion);
  assert.deepEqual(a.items.map((i) => i.id), items.map((i) => i.id));
  const changed = structuredClone(items) as Item[];
  (changed[0] as { rev: number }).rev = 2;
  assert.notEqual(buildBundle(changed, {}, deps).contentVersion, a.contentVersion);
});

test('buildQuestions maps specs to QuestionInstances', () => {
  const qs = buildQuestions(validateBundle(fixture()).items).map((b) => b.q);
  const cloze = qs.find((q) => q.qtype === 'cloze')!;
  assert.ok(cloze.qtype === 'cloze');
  assert.equal(cloze.before, '비가 ');
  assert.equal(cloze.after, ' 늦었다.');
  assert.equal(cloze.qid, 'g:a#cloze#c1');
  const nu = qs.find((q) => q.qtype === 'nuance')!;
  assert.ok(nu.qtype === 'nuance' && nu.correctKey === 'a' && nu.options.length === 2);
  const prod = qs.find((q) => q.qtype === 'production')!;
  assert.ok(prod.qtype === 'production' && prod.rejected.includes('결재'));
});

test('runSelfCheck reports accepted-not-correct and rejected-graded-correct', () => {
  const items = validateBundle(fixture()).items;
  const allCorrect = runSelfCheck(items, () => ({ outcome: 'correct' }));
  assert.ok(allCorrect.failures.some((f) => /rejected\/nearMiss "결재" graded correct/.test(f)));
  const allWrong = runSelfCheck(items, () => ({ outcome: 'incorrect' }));
  assert.ok(allWrong.failures.some((f) => /accepted "결제" graded incorrect/.test(f)));
  const crashy = runSelfCheck(items, () => { throw new Error('boom'); });
  assert.equal(crashy.failures.length, 0);
  assert.equal(crashy.crashes.length, crashy.cases);
});

// ---------------------------------------------------------------- real seed

test('real seed validates with zero errors', () => {
  const seed = loadSeed();
  assert.deepEqual(seed.loadErrors, []);
  const r = validateBundle(seed.raws, { origins: seed.origins, idRedirects: seed.idRedirects });
  assert.deepEqual(r.errors, []);
  // M2 seed scope (§9.4): levels 1–3, plus L04 (native-verb track: 64 sense-level vocab items).
  // Hanja items were removed from the curriculum (vocab-first direction); L05–L10 add the
  // frequency-vocab track (40 words each, ranks ~5,100–6,730 from the owner's Anki gap).
  // L01–L03 vocab is the practical starter set (40 each, owner's common Anki leeches); the
  // original niche Sino-Korean set moved to L11–L13 with ids unchanged.
  assert.equal(r.counts.total, 631);
  assert.deepEqual(r.counts.byKind, { vocab: 544, grammar: 67, expression: 20, hanja: 0 });
  assert.deepEqual(r.counts.byLevel[4], { vocab: 64, grammar: 0, expression: 0, hanja: 0 });
  assert.deepEqual([1, 2, 3].map((l) => r.counts.byLevel[l]?.vocab), [40, 40, 40]);
  assert.deepEqual([5, 6, 7, 8, 9, 10].map((l) => r.counts.byLevel[l]?.vocab), [40, 40, 40, 40, 40, 40]);
  assert.deepEqual([11, 12, 13].map((l) => r.counts.byLevel[l]), Array(3).fill({ vocab: 40, grammar: 0, expression: 0, hanja: 0 }));
  // HTSK-aligned grammar stages (Units 5–6): grammar only, independent of vocab levels.
  assert.deepEqual([5, 6, 7].map((l) => r.counts.byLevel[l]?.grammar), [11, 13, 13]);
});

test('real seed passes the answer-check self-check (when available)', async (t) => {
  let check: unknown;
  try { check = ((await import('../../answer-check/src/index.ts')) as unknown as Record<string, unknown>).check; } catch { /* not ready */ }
  if (typeof check !== 'function') { t.skip('answer-check not ready'); return; }
  const seed = loadSeed();
  const r = validateBundle(seed.raws);
  const sc = runSelfCheck(r.items, check as Parameters<typeof runSelfCheck>[1]);
  assert.deepEqual(sc.failures, []);
  assert.deepEqual(sc.crashes, []);
  assert.ok(sc.cases > 0);
});
