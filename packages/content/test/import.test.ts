import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { forAll, int, pick, arrayOf, type Gen } from '@ksrs/test-support';
import {
  csvTemplate, diffItems, exportCsv, importCsv, importItems, importJson, parseCsv, toCsv, validateBundle,
  type ImportContext, type ImportKind, type ImportResult, type Item, type ItemId, type VocabItem,
} from '../src/index.ts';
import { buildBundle } from '../src/bundle.ts';
import { stableJson } from '../src/import/pipeline.ts';
import { canonicalJson, sha256Hex } from '../../srs-engine/src/util.ts';
import { loadSeed, PKG_DIR } from '../bin/lib.ts';

const SEED = loadSeed().raws as Item[];
const SEED_MAP: ReadonlyMap<ItemId, Item> = new Map(SEED.map((it) => [it.id, it] as const));
const USER_SRC = { kind: 'user' as const, license: 'original-owned' };
const ctx = (existing: ReadonlyMap<ItemId, Item> = SEED_MAP, o: Partial<ImportContext> = {}): ImportContext =>
  ({ existing, defaultSource: USER_SRC, ...o });
const KINDS: ImportKind[] = ['vocab', 'grammar', 'expression', 'hanja'];
const errors = (r: ImportResult) => r.issues.filter((i) => i.severity === 'error');

/** Every 3rd seed item of a kind, plus the first and last (covers hanjaBreakdown ± ids, cloze ± nearMiss, JSON-only prompts). */
function sample(kind: ImportKind): Item[] {
  const all = SEED.filter((it) => it.kind === kind);
  return all.filter((_, i) => i % 3 === 0 || i === all.length - 1);
}

const ex2 = '"예문 하나.::Example one.|예문 둘.::Example two."';

describe('CSV round trip (exportCsv → importCsv)', () => {
  for (const kind of KINDS) {
    test(`${kind}: real seed items survive byte-for-byte`, () => {
      const items = sample(kind);
      assert.ok(items.length >= 5);
      const r = importCsv(kind, exportCsv(kind, items), ctx());
      assert.deepEqual(errors(r), []);
      assert.equal(r.items.length, items.length);
      items.forEach((it, i) => assert.equal(stableJson(r.items[i]), stableJson(it), it.id));
      assert.deepEqual(r.items, items);
      const d = diffItems(SEED_MAP, r.items);
      assert.equal(d.unchanged.length, items.length);
    });
  }

  test('all 200 seed items round-trip (and export skips other kinds)', () => {
    for (const kind of KINDS) {
      const r = importCsv(kind, exportCsv(kind, SEED), ctx());
      assert.deepEqual(r.items, SEED.filter((it) => it.kind === kind), kind);
    }
  });

  test('round trip into an empty store with awkward characters', () => {
    const it: VocabItem = {
      id: 'v:a|b', kind: 'vocab', level: 2, track: 'native', rev: 3, unlockDeps: [], gating: false,
      source: { kind: 'import', license: 'CC-BY-4.0', attribution: 'Somebody: "quoted", with | pipe', url: 'https://x.test/a?b=c' },
      needs_review: true, tags: ['a|b', 'c:d'], mnemonic: 'line1\nline2, "quoted"',
      word: '깜빡하다', meanings: ['to forget (momentarily)', 'blink: of a light'], pos: '동사', register: 'spoken',
      collocations: [{ ko: '깜빡 잊다', en: 'to clean forget::really' }],
      examples: [
        { ko: '깜빡했어요!', en: 'I forgot!', register: 'spoken', needs_review: true },
        { ko: '불이 깜빡거린다.', en: 'Note: the light flickers.' },
        { ko: '또 깜빡…', en: 'Again:', needs_review: false },
      ],
      questionTypes: ['meaning', 'production'],
      questions: {
        meaning: { accepted: ['forget', 'blink'], rejected: ['remember'] },
        production: { promptEn: 'to forget (momentarily)', contextHint: 'casual', accepted: ['깜빡하다', '깜박하다'] },
      },
    };
    const r = importCsv('vocab', exportCsv('vocab', [it]), ctx(new Map()));
    assert.deepEqual(errors(r), []);
    assert.deepEqual(r.items, [it]);
  });
});

describe('importCsv', () => {
  test('minimal vocab: defaults, generated ids, hanja auto-link, default source', () => {
    const csv = [
      'Word,Meanings,LEVEL,Hanja,Examples,Tags,POS',
      `결재,approval|sign-off,4,결:決|재:裁,${ex2},work|test,명사`,
      `얼버무리다,to equivocate,4,,${ex2},,동사`,
    ].join('\n');
    const r = importCsv('vocab', csv, ctx());
    assert.deepEqual(errors(r), []);
    const [a, b] = r.items as VocabItem[];
    assert.equal(a!.id, 'v:결재'); // same headword as the seed item → same id (an update)
    assert.deepEqual(a!.hanjaBreakdown, [{ syllable: '결', hanja: '決', hanjaId: 'h:決' }, { syllable: '재', hanja: '裁', hanjaId: 'h:裁' }]);
    assert.deepEqual(a!.questionTypes, ['meaning', 'production']);
    assert.deepEqual(a!.questions.meaning, { accepted: ['approval', 'sign-off'] });
    assert.deepEqual(a!.questions.production, { promptEn: 'approval; sign-off', accepted: ['결재'] });
    assert.deepEqual(a!.source, USER_SRC);
    assert.equal(a!.gating, true);
    assert.equal(a!.register, 'neutral');
    assert.equal(a!.track, 'core');
    assert.deepEqual(a!.tags, ['work', 'test']);
    assert.equal(b!.id, 'v:얼버무리다');
    const fresh = importCsv('vocab', 'word,meanings,level,pos,hanja\n심정,feelings,1,명사,심:心|정:情', ctx());
    assert.deepEqual((fresh.items[0] as VocabItem).hanjaBreakdown, [{ syllable: '심', hanja: '心' }, { syllable: '정', hanja: '情' }]); // no h:心 → unlinked
  });

  test('id collisions: a different item with the same slug → :2; homographs in one file → :2, :3', () => {
    const existing = new Map<ItemId, Item>([['v:배', { ...(SEED.find((i) => i.kind === 'vocab') as VocabItem), id: 'v:배', word: '배' }]]);
    const r1 = importCsv('vocab', `word,meanings,level,pos,examples\n배,ship,1,명사,${ex2}`, ctx(existing));
    assert.equal(r1.items[0]!.id, 'v:배'); // same headword: update
    const r2 = importCsv('vocab', `word,meanings,level,pos,examples\n배,pear,1,명사,${ex2}\n배,belly,1,명사,${ex2}`, ctx(new Map()));
    assert.deepEqual(r2.items.map((i) => i.id), ['v:배', 'v:배:2']);
    const other = new Map<ItemId, Item>([['v:눈', { ...(SEED.find((i) => i.kind === 'vocab') as VocabItem), id: 'v:눈', word: '눈 ' + 'x' }]]);
    const r3 = importCsv('vocab', `word,meanings,level,pos,examples\n눈,snow,1,명사,${ex2}`, ctx(other));
    assert.equal(r3.items[0]!.id, 'v:눈:2');
    const r4 = importCsv('vocab', `word,meanings,level,pos,examples\n눈,snow,1,명사,${ex2}`, ctx(new Map(), { idPrefixUser: 'my/' }));
    assert.equal(r4.items[0]!.id, 'v:my/눈');
    const r5 = importCsv('grammar', 'pattern,meaning,level,attachment,nuance,examples,question_types\n'
      + '-는 김에,while at it,1,V::any::present::V-는 김에::가는 김에,n,가는 김에 샀어.::Got it while I was at it.,meaning', ctx(new Map()));
    assert.equal(r5.items[0]!.id, 'g:는-김에');
  });

  test('errors carry row numbers (header = row 1; embedded newlines do not shift records)', () => {
    const csv = [
      'id,level,word,meanings,pos,register,examples',
      `v:ok,1,좋다,good,형용사,,${ex2}`,                     // row 2 ok
      'v:nolevel,,없다,none,형용사,,a::b|c::d',                // row 3: level required
      'v:badex,1,나쁘다,bad,형용사,,"no-pair-here|x::y"',      // row 4: example without ::
      '# a comment row',                                       // row 5 skipped
      '',                                                      // row 6 blank
      `v:multi,1,"여러\n줄",multi,명사,,${ex2}`,                 // row 7 (spans 2 lines)
      `v:badreg,1,이상하다,odd,형용사,fancy,${ex2}`,             // row 8: bad enum (from validateItem)
      `v:dup,1,중복,dup,명사,,${ex2}`,                           // row 9
      `v:dup,1,중복,dup,명사,,${ex2}`,                           // row 10 duplicate
    ].join('\n');
    const r = importCsv('vocab', csv, ctx(new Map()));
    const byRow = (row: number) => r.issues.filter((i) => i.row === row && i.severity === 'error');
    assert.deepEqual(r.items.map((i) => i.id), ['v:ok', 'v:multi', 'v:dup']);
    assert.equal((r.items[1] as VocabItem).word, '여러\n줄');
    assert.equal(byRow(3)[0]!.path, 'level');
    assert.equal(byRow(3)[0]!.id, 'v:nolevel');
    assert.match(byRow(4)[0]!.msg, /ko::en/);
    assert.equal(byRow(8)[0]!.path, 'register');
    assert.match(byRow(10)[0]!.msg, /duplicate id.*row 9/);
    assert.equal(errors(r).length, 4);
  });

  test('semantic errors against the merged set: unresolved refs, cycles, attribution, cascade', () => {
    const csv = [
      'id,level,word,meanings,pos,examples,unlock_deps,source_kind,source_license',
      `v:a,1,가,a,명사,${ex2},v:b,user,original-owned`,
      `v:b,1,나,b,명사,${ex2},v:a,user,original-owned`,                 // cycle a ↔ b
      `v:c,1,다,c,명사,${ex2},v:nope,user,original-owned`,              // unresolved
      `v:d,1,라,d,명사,${ex2},,import,CC-BY-4.0`,                       // attribution missing
      `v:e,1,마,e,명사,${ex2},v:d@lesson,user,original-owned`,          // depends on rejected d
      `v:f,1,바,f,명사,${ex2},v:얼버무리다,user,original-owned`,          // resolves into existing
    ].join('\n');
    const r = importCsv('vocab', csv, ctx());
    assert.deepEqual(errors(r).filter((i) => i.row === 7), []);
    assert.deepEqual(r.items.map((i) => i.id), ['v:f']);
    const msgs = errors(r).map((i) => `${i.row}:${i.msg}`);
    assert.ok(msgs.some((m) => /^[23]:dependency cycle/.test(m)), msgs.join('\n'));
    assert.ok(msgs.some((m) => m === '4:unresolved reference v:nope'));
    assert.ok(msgs.some((m) => m.startsWith('5:attribution is required')));
    assert.ok(msgs.some((m) => m === '6:unresolved reference v:d'));
    assert.deepEqual((r.items[0] as VocabItem).unlockDeps, [{ id: 'v:얼버무리다', require: 'guru' }]);
  });

  test('draft tolerance: user items with < 2 examples are a warning; seed (original) items stay strict', () => {
    const csv = 'word,meanings,level,pos,source_kind,source_license\n초안,draft,1,명사,user,original-owned\n원본,orig,1,명사,original,original-owned';
    const r = importCsv('vocab', csv, ctx(new Map()));
    assert.deepEqual(r.items.map((i) => i.id), ['v:초안']);
    assert.ok(r.issues.some((i) => i.row === 2 && i.severity === 'warning' && /2–3 examples/.test(i.msg)));
    assert.ok(r.issues.some((i) => i.row === 3 && i.severity === 'error' && /2–3 examples/.test(i.msg)));
    // and validateBundle directly
    const draft = { ...(r.items[0] as VocabItem) };
    assert.equal(validateBundle([draft]).ok, true);
    assert.equal(validateBundle([{ ...draft, source: { kind: 'original', license: 'original-owned' } }]).ok, false);
  });

  test('header problems: missing required columns, unknown + duplicate columns, extra cells', () => {
    const r = importCsv('vocab', 'word,level,pos\n결정,1,명사', ctx());
    assert.equal(r.items.length, 0);
    assert.match(errors(r)[0]!.path, /meanings/);
    const r2 = importCsv('hanja', 'char,hun,eum,meanings,level,mnemonic,colour,char\n定,정할,정,decide,1,m,red,X\n', ctx(new Map()));
    assert.equal(r2.items.length, 1);
    assert.equal((r2.items[0] as Item & { char: string }).char, '定');
    assert.ok(r2.issues.some((i) => i.path === 'colour' && i.severity === 'warning'));
    assert.ok(r2.issues.some((i) => i.path === 'char' && /duplicate column/.test(i.msg)));
    assert.equal(r2.items[0]!.gating, false);
    const r3 = importCsv('hanja', 'char,hun,eum,meanings,level,mnemonic\n定,정할,정,decide,1,m,EXTRA\n', ctx(new Map()));
    assert.ok(r3.issues.some((i) => i.row === 2 && /beyond the header/.test(i.msg)));
    assert.equal(importCsv('vocab', '', ctx()).issues[0]!.msg, 'no header row');
  });

  test('single cloze via columns; questions_json for JSON-only prompts; clashes are errors', () => {
    const head = 'pattern,meaning,level,attachment,nuance,examples,question_types,cloze_sentence,cloze_answer,cloze_en,cloze_cue,cloze_near_miss,questions_json';
    const nuance = JSON.stringify({ nuance: [{ id: 'n1', situation: 's', options: [{ text: 'A', correct: true, why: 'w' }, { text: 'B', correct: false, why: 'w' }] }] });
    const row = (qj: string) => `-는 김에,while at it,1,V::any::present::V-는 김에::가는 김에,n,가는 김에 샀어.::Got it.,cloze|nuance,`
      + `가는 {{}} 샀어.,김에,While going I bought it.,-는 김에,김애::spelling,${toCsv([[qj]]).trim()}`;
    const r = importCsv('grammar', `${head}\n${row(nuance)}`, ctx(new Map()));
    assert.deepEqual(errors(r), []);
    const g = r.items[0]!;
    assert.ok(g.kind === 'grammar');
    if (g.kind !== 'grammar') return;
    assert.deepEqual(g.questions.cloze, [{
      id: 'c1', sentence: '가는 {{}} 샀어.', en: 'While going I bought it.', cue: '-는 김에', accepted: ['김에'],
      nearMiss: [{ answer: '김애', hint: 'spelling' }], particleTolerance: 'none',
    }]);
    assert.equal(g.questions.nuance?.length, 1);
    assert.equal(g.questions.meaning, undefined); // not in question_types and no meaning_* columns
    const clash = importCsv('grammar', `${head}\n${row(JSON.stringify({ cloze: [] }))}`, ctx(new Map()));
    assert.match(errors(clash)[0]!.msg, /both in columns and in questions_json/);
    const badJson = importCsv('grammar', `${head}\n${row('{oops')}`, ctx(new Map()));
    assert.equal(errors(badJson)[0]!.path, 'questions_json');
  });

  test('templates: header + one commented example that imports cleanly when uncommented', () => {
    for (const kind of KINDS) {
      const t = csvTemplate(kind);
      const rows = parseCsv(t);
      assert.equal(rows.length, 2, kind);
      assert.ok(rows[1]![0]!.startsWith('#'));
      assert.deepEqual(importCsv(kind, t, ctx()).items, [], kind);
      const r = importCsv(kind, t.replace('\r\n#', '\r\n'), ctx(new Map()));
      assert.deepEqual(errors(r), [], kind);
      assert.equal(r.items.length, 1, kind);
    }
  });

  test('never throws on garbage', () => {
    const chars = [',', '"', '\n', '\r', '|', ':', '\\', '#', 'a', '가', ' ', '{', '}', '﻿'];
    const gen: Gen<string> = (r, size) => arrayOf(pick(chars), 0, size * 4)(r, size).join('');
    const kinds = pick(KINDS);
    forAll((r, s) => [kinds(r, s), gen(r, s), int(0, 2)(r, s)] as const, ([kind, body, h]) => {
      const header = h === 0 ? '' : h === 1 ? 'word,meanings,level\n' : 'id,level,char,hun,eum,meanings,mnemonic,questions_json,examples\n';
      const r = importCsv(kind, header + body, ctx());
      assert.ok(Array.isArray(r.items) && Array.isArray(r.issues));
      const j = importJson(body, ctx());
      assert.ok(Array.isArray(j.issues));
    }, { runs: 300, seed: 'csv-garbage' });
  });
});

describe('importJson', () => {
  test('the real bundle shape (dist/content.bundle.json and a freshly built seed bundle)', () => {
    const dist = readFileSync(`${PKG_DIR}/dist/content.bundle.json`, 'utf8');
    const r = importJson(dist, ctx(new Map()));
    assert.deepEqual(errors(r), []);
    assert.ok(r.items.length > 0);
    const full = buildBundle(SEED, {}, { canonicalJson, sha256Hex });
    const r2 = importJson(JSON.stringify(full), ctx(new Map()));
    assert.deepEqual(errors(r2), []);
    assert.deepEqual(r2.items, SEED);
    assert.equal(diffItems(SEED_MAP, r2.items).unchanged.length, SEED.length);
  });

  test('Item[] and {items}; defaults filled; JSON row numbers are 1-based positions', () => {
    const v = {
      kind: 'vocab', level: 1, word: '덤', meanings: ['bonus'], pos: '명사', register: 'neutral',
      examples: [{ ko: '덤으로 하나 더 줬어요.', en: 'They threw in one more for free.' }],
      questionTypes: ['meaning'], questions: { meaning: { accepted: ['bonus', 'freebie'] } },
    };
    const r = importJson(JSON.stringify([v, { kind: 'vocab', level: 'x' }, 42]), ctx(new Map()));
    assert.equal(r.items.length, 1);
    const it = r.items[0] as VocabItem;
    assert.equal(it.id, 'v:덤');
    assert.deepEqual(it.source, USER_SRC);
    assert.deepEqual([it.track, it.rev, it.gating, it.needs_review, it.tags, it.collocations], ['core', 1, true, false, [], []]);
    assert.ok(r.issues.some((i) => i.row === 2 && i.severity === 'error'));
    assert.ok(r.issues.some((i) => i.row === 3 && i.msg === 'item must be an object'));
    assert.ok(r.issues.some((i) => i.severity === 'warning' && /2–3 examples/.test(i.msg)));
    const r2 = importJson(JSON.stringify({ items: [v] }), ctx(new Map()));
    assert.equal(r2.items.length, 1);
  });

  test('bad JSON / wrong shape / bundle idRedirects', () => {
    assert.match(importJson('{nope', ctx()).issues[0]!.msg, /not valid JSON/);
    assert.match(importJson('"str"', ctx()).issues[0]!.msg, /expected a content bundle/);
    const r = importJson(JSON.stringify({ formatVersion: 1, contentVersion: 'x', items: [], idRedirects: { 'v:a': 'v:b' } }), ctx());
    assert.ok(r.issues.some((i) => i.path === 'idRedirects' && i.severity === 'warning'));
  });

  test('kind change on an existing id is an error; replacing a seed item warns', () => {
    const seedVocab = SEED.find((i) => i.kind === 'vocab') as VocabItem;
    const asHanja = { id: seedVocab.id, kind: 'hanja', level: 1, char: '定', hun: 'h', eum: 'e', meanings: ['m'], mnemonic: 'm' };
    assert.match(errors(importJson(JSON.stringify([asHanja]), ctx()))[0]!.msg, /already belongs to a vocab/);
    const edited = { ...seedVocab, meanings: [...seedVocab.meanings, 'extra'], source: USER_SRC };
    const r = importJson(JSON.stringify([edited]), ctx());
    assert.ok(r.issues.some((i) => /replaces a built-in item/.test(i.msg)));
  });

  test('importItems validates prebuilt drafts', () => {
    const r = importItems([{ kind: 'hanja', level: 1, char: '心', hun: '마음', eum: '심', meanings: ['heart'], mnemonic: 'm' }], ctx(new Map()));
    assert.equal(r.items[0]!.id, 'h:心');
    assert.equal(r.items[0]!.gating, false);
  });
});

describe('diffItems', () => {
  const base = SEED.find((i) => i.kind === 'vocab') as VocabItem;
  test('added / changed (top-level fields) / unchanged; key order is irrelevant; duplicates counted once', () => {
    const existing = new Map<ItemId, Item>([[base.id, base]]);
    const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(base).reverse()))) as VocabItem;
    const changed: VocabItem = { ...base, meanings: ['x'], examples: base.examples.slice(0, 2), questions: { ...base.questions } };
    changed.questions.meaning = { accepted: ['x'] };
    const added = { ...base, id: 'v:new' };
    const d1 = diffItems(existing, [reordered, added, added]);
    assert.deepEqual(d1, { added: ['v:new'], changed: [], unchanged: [base.id] });
    const d2 = diffItems(existing, [changed]);
    assert.deepEqual(d2.changed, [{ id: base.id, fields: ['meanings', 'questions'].concat(base.examples.length > 2 ? ['examples'] : []).sort() }]);
    const { mnemonic: _m, ...noMnemonic } = base;
    assert.deepEqual(diffItems(existing, [noMnemonic as VocabItem]).changed[0]!.fields, base.mnemonic === undefined ? [] : ['mnemonic']);
    assert.deepEqual(diffItems(new Map(), []), { added: [], changed: [], unchanged: [] });
  });
});

describe('importCsv: spreadsheet quirks (QA)', () => {
  const rows = (d: string) => [
    ['level', 'word', 'meanings', 'pos', 'examples'].join(d),
    ['1', '뜬금없다', 'out of the blue|random', '형용사', '"그 얘기는 좀 뜬금없다.::That came out of nowhere.|갑자기 뜬금없이 웃었다.::He laughed for no reason."'].join(d),
  ];
  const expect1 = (r: ImportResult, label: string) => {
    assert.deepEqual(errors(r), [], label);
    assert.equal(r.items.length, 1, label);
    const it = r.items[0] as VocabItem;
    assert.equal(it.word, '뜬금없다', label);
    assert.deepEqual(it.meanings, ['out of the blue', 'random'], label);
    assert.equal(it.examples.length, 2, label);
  };

  test('BOM + CRLF, semicolon (Excel with a decimal-comma locale) and tab delimiters', () => {
    expect1(importCsv('vocab', '﻿' + rows(',').join('\r\n') + '\r\n', ctx(new Map())), 'bom crlf');
    expect1(importCsv('vocab', '﻿' + rows(';').join('\r\n') + '\r\n', ctx(new Map())), 'semicolon');
    expect1(importCsv('vocab', rows('\t').join('\n'), ctx(new Map())), 'tab');
    // A comma anywhere in the header (outside quotes) means comma-separated, even with ; in cells.
    expect1(importCsv('vocab', '# comment; with; semicolons\n' + rows(',').join('\n'), ctx(new Map())), 'comment first');
  });

  test('trailing empty columns and rows (Excel saves them) are ignored silently', () => {
    const text = rows(',').map((r) => r + ',,,').join('\r\n') + '\r\n,,,,,,,,\r\n';
    const r = importCsv('vocab', text, ctx(new Map()));
    expect1(r, 'trailing');
    assert.deepEqual(r.issues.filter((i) => /column|beyond/.test(i.msg)), []);
  });

  test('smart quotes inside cells are kept as text (Excel only quotes with ")', () => {
    const r = importCsv('vocab', 'level,word,meanings,pos\n1,뜬금없다,“out of the blue”,형용사\n', ctx(new Map()));
    assert.deepEqual(errors(r), []);
    assert.deepEqual((r.items[0] as VocabItem).meanings, ['“out of the blue”']);
  });

  test('re-importing the same file is all unchanged; an id that is a seed item is flagged', () => {
    const text = rows(',').join('\n');
    const first = importCsv('vocab', text, ctx(new Map()));
    const existing = new Map<ItemId, Item>(first.items.map((it) => [it.id, it]));
    const again = importCsv('vocab', text, ctx(existing));
    assert.deepEqual(diffItems(existing, again.items), { added: [], changed: [], unchanged: [first.items[0]!.id] });

    // The same rows from a renamed copy (browsers save "words (1).csv") are still unchanged.
    const fileSrc = (name: string) => ({ kind: 'import' as const, license: 'user-provided', attribution: `Imported from ${name}` });
    const viaFile = importCsv('vocab', text, ctx(new Map(), { defaultSource: fileSrc('words.csv') }));
    const had = new Map<ItemId, Item>(viaFile.items.map((it) => [it.id, it]));
    const renamed = importCsv('vocab', text, ctx(had, { defaultSource: fileSrc('words (1).csv') }));
    assert.deepEqual(diffItems(had, renamed.items), { added: [], changed: [], unchanged: [viaFile.items[0]!.id] });
    // A brand-new item still gets this file's attribution.
    assert.equal(importCsv('vocab', text, ctx(new Map(), { defaultSource: fileSrc('b.csv') })).items[0]!.source.attribution, 'Imported from b.csv');

    const seedVocab = SEED.find((it): it is VocabItem => it.kind === 'vocab')!;
    const clash = importCsv('vocab', `id,level,word,meanings,pos\n${seedVocab.id},1,${seedVocab.word},changed meaning,${seedVocab.pos}\n`, ctx());
    assert.deepEqual(errors(clash), []);
    assert.ok(clash.issues.some((i) => i.id === seedVocab.id && /replaces a built-in item/.test(i.msg)));
    assert.deepEqual(diffItems(SEED_MAP, clash.items).changed.map((c) => c.id), [seedVocab.id]);
  });
});
