import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { forAll, arrayOf, pick, type Gen } from '@ksrs/test-support';
import {
  importItems, krdictToVocab, parseKrdict, parseKrdictXml, validateItem, type ItemId, type Item, type KrdictSense,
} from '../src/index.ts';
import { parseXml } from '../src/import/krdict.ts';

// Hand-written, modeled on the documented Open API search response (translated=y, trans_lang=1).
const SEARCH_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!-- krdict open api -->
<channel>
  <title>한국어 기초사전 개발 지원(Open API) - 사전 검색</title>
  <link>https://krdict.korean.go.kr</link>
  <description>한국어 기초사전 개발 지원(Open API) - 사전 검색 결과</description>
  <lastBuildDate>20261026120000</lastBuildDate>
  <total>2</total><start>1</start><num>10</num>
  <item>
    <target_code>12345</target_code>
    <word>망설이다</word>
    <sup_no>0</sup_no>
    <pronunciation>망설이다</pronunciation>
    <word_grade>중급</word_grade>
    <pos>동사</pos>
    <link>https://krdict.korean.go.kr/dicSearch/SearchView?ParaWordNo=12345</link>
    <sense>
      <sense_order>1</sense_order>
      <definition>이리저리 생각만 하고 태도를 결정하지 못하다.</definition>
      <translation>
        <trans_lang>영어</trans_lang>
        <trans_word><![CDATA[hesitate; waver, be undecided]]></trans_word>
        <trans_dfn><![CDATA[To be unable to <decide> one's attitude & only think things over.]]></trans_dfn>
      </translation>
    </sense>
  </item>
  <item>
    <target_code>67890</target_code>
    <word>결정</word>
    <sup_no>2</sup_no>
    <origin>決定</origin>
    <pos>명사</pos>
    <link>https://krdict.korean.go.kr/dicSearch/SearchView?ParaWordNo=67890&amp;nation=eng</link>
    <sense>
      <sense_order>1</sense_order>
      <definition>행동이나 태도를 분명하게 정함. 또는 그렇게 정해진 내용.</definition>
      <translation>
        <trans_lang>영어</trans_lang>
        <trans_word>decision</trans_word>
        <trans_dfn>The act of making up one&apos;s mind &#8220;clearly&#8221; &#x2014; or the content.</trans_dfn>
      </translation>
    </sense>
    <sense>
      <sense_order>2</sense_order>
      <definition>법원이 행하는 판결 및 명령 이외의 재판.</definition>
      <translation><trans_lang>영어</trans_lang><trans_word>ruling</trans_word><trans_dfn>A court ruling.</trans_dfn></translation>
    </sense>
  </item>
</channel>`;

// The /api/view shape: word_info + sense_info.
const VIEW_XML = `<channel><total>1</total><item><target_code>32750</target_code>
<word_info><word>나무</word><pos>명사</pos><word_grade>초급</word_grade>
<sense_info><sense_order>1</sense_order><definition>단단한 줄기에 가지와 잎이 달린 식물.</definition>
<translation><trans_lang>영어</trans_lang><trans_word>tree</trans_word><trans_dfn>A plant with a hard stem.</trans_dfn></translation>
</sense_info></word_info></item></channel>`;

// The downloadable dictionary (LMF) shape.
const LMF_XML = `<?xml version="1.0" encoding="UTF-8"?>
<LexicalResource><GlobalInformation att="label" val="한국어기초사전"/><Lexicon>
<LexicalEntry att="id" val="54321">
  <feat att="homonym_number" val="0"/>
  <feat att="partOfSpeech" val="부사"/>
  <feat att="vocabularyLevel" val="고급"/>
  <Lemma><feat att="writtenForm" val="넌지시"/></Lemma>
  <Sense val="1">
    <feat att="definition" val="드러나지 않게 가만히."/>
    <Equivalent><feat att="language" val="일본어"/><feat att="lemma" val="それとなく"/></Equivalent>
    <Equivalent><feat att="language" val="영어"/><feat att="lemma" val="indirectly, casually"/><feat att="definition" val="In a roundabout way &amp; quietly."/></Equivalent>
  </Sense>
</LexicalEntry>
</Lexicon></LexicalResource>`;

describe('parseKrdictXml', () => {
  test('search response: senses, CDATA kept verbatim, entities decoded', () => {
    const s = parseKrdictXml(SEARCH_XML);
    assert.equal(s.length, 3);
    assert.deepEqual(s[0], {
      targetCode: 12345, word: '망설이다', pos: '동사', definitionKo: '이리저리 생각만 하고 태도를 결정하지 못하다.',
      transWord: 'hesitate; waver, be undecided', transDfn: "To be unable to <decide> one's attitude & only think things over.",
      url: 'https://krdict.korean.go.kr/dicSearch/SearchView?ParaWordNo=12345', supNo: 0, senseOrder: 1, wordGrade: '중급',
    });
    assert.equal(s[1]!.transDfn, 'The act of making up one\'s mind “clearly” — or the content.');
    assert.equal(s[1]!.url, 'https://krdict.korean.go.kr/dicSearch/SearchView?ParaWordNo=67890&nation=eng');
    assert.equal(s[1]!.origin, '決定');
    assert.deepEqual([s[2]!.word, s[2]!.senseOrder, s[2]!.transWord], ['결정', 2, 'ruling']);
  });

  test('view response (word_info / sense_info)', () => {
    const [s] = parseKrdictXml(VIEW_XML);
    assert.equal(s!.targetCode, 32750);
    assert.equal(s!.word, '나무');
    assert.equal(s!.transWord, 'tree');
    assert.equal(s!.url, 'https://krdict.korean.go.kr/dicSearch/SearchView?ParaWordNo=32750');
  });

  test('downloadable LMF entry: picks the English equivalent', () => {
    const [s] = parseKrdictXml(LMF_XML);
    assert.deepEqual(s, {
      targetCode: 54321, word: '넌지시', pos: '부사', definitionKo: '드러나지 않게 가만히.', transWord: 'indirectly, casually',
      transDfn: 'In a roundabout way & quietly.', url: 'https://krdict.korean.go.kr/dicSearch/SearchView?ParaWordNo=54321',
      supNo: 0, senseOrder: 1, wordGrade: '고급',
    });
  });

  test('JSON variants of both shapes', () => {
    const api = { channel: { total: 1, item: [{ target_code: 32750, word: '나무', pos: '명사',
      sense: [{ sense_order: 1, definition: '식물.', translation: { trans_lang: '영어', trans_word: 'tree', trans_dfn: 'A plant.' } }] }] } };
    assert.equal(parseKrdict(JSON.stringify(api)).senses[0]!.transWord, 'tree');
    const lmf = { LexicalResource: { Lexicon: { LexicalEntry: [{ att: 'id', val: '54321',
      feat: [{ att: 'partOfSpeech', val: '부사' }], Lemma: { feat: { att: 'writtenForm', val: '넌지시' } },
      Sense: [{ feat: { att: 'definition', val: '가만히.' }, Equivalent: [{ feat: [{ att: 'language', val: '영어' }, { att: 'lemma', val: 'indirectly' }] }] }] }] } } };
    const [s] = parseKrdict(JSON.stringify(lmf)).senses;
    assert.deepEqual([s!.targetCode, s!.word, s!.pos, s!.transWord], [54321, '넌지시', '부사', 'indirectly']);
  });

  test('API error responses and junk', () => {
    const r = parseKrdict('<?xml version="1.0"?><error><error_code>020</error_code><message>등록되지 않은 인증키입니다.</message></error>');
    assert.deepEqual(r, { senses: [], error: 'KRDict error 020: 등록되지 않은 인증키입니다.' });
    assert.deepEqual(parseKrdictXml(''), []);
    assert.deepEqual(parseKrdictXml('<channel><item><word>x</word></item></channel>'), []); // no target_code
    assert.equal(parseKrdict('{bad json').error, 'not valid JSON');
  });

  test('XML reader is tolerant and never throws', () => {
    const t = parseXml('<a x=\'1\' y="a>b"><b>t &lt;1&gt; &unknown; &#xZZ;</b><c/><d>unclosed</a>');
    const a = t.children[0]!;
    assert.deepEqual(a.attrs, { x: '1', y: 'a>b' });
    assert.equal(a.children[0]!.text, 't <1> &unknown; &#xZZ;');
    assert.equal(a.children[2]!.text, 'unclosed');
    const chars = ['<', '>', '/', '"', "'", '&', ';', '!', '[', ']', '-', '?', 'a', '가', ' ', '=', 'CDATA', 'item', 'word'];
    const gen: Gen<string> = (r, size) => arrayOf(pick(chars), 0, size * 5)(r, size).join('');
    forAll(gen, (s) => { assert.ok(Array.isArray(parseKrdict(s).senses)); }, { runs: 300, seed: 'xml-garbage' });
  });
});

describe('krdictToVocab', () => {
  const senses = parseKrdictXml(SEARCH_XML);
  const opts = { level: 4, retrievedAt: '2026-10-26T00:00:00Z' };

  test('draft item: attribution, needs_review, meanings split on ; and ,', () => {
    const v = krdictToVocab(senses[0]!, opts);
    assert.equal(v.id, 'v:망설이다');
    assert.deepEqual(v.source, {
      kind: 'krdict', license: 'CC-BY-SA-2.0-KR', attribution: '한국어기초사전 (국립국어원)',
      url: 'https://krdict.korean.go.kr/dicSearch/SearchView?ParaWordNo=12345', retrievedAt: '2026-10-26T00:00:00Z', krdictTargetCode: 12345,
    });
    assert.equal(v.needs_review, true);
    assert.equal(v.gating, false);
    assert.deepEqual(v.meanings, ['hesitate', 'waver', 'be undecided']);
    assert.deepEqual(v.questionTypes, ['meaning', 'production']);
    assert.deepEqual(v.questions.meaning, { accepted: ['hesitate', 'waver', 'be undecided'] });
    assert.equal(v.questions.production?.contextHint, '이리저리 생각만 하고 태도를 결정하지 못하다.');
    assert.deepEqual(v.questions.production?.accepted, ['망설이다']);
    assert.deepEqual(v.examples, []);
    assert.equal(v.hanjaBreakdown, undefined);
    assert.ok(validateItem(v).ok);
  });

  test('원어 → hanjaBreakdown; idHint', () => {
    const v = krdictToVocab(senses[1]!, { ...opts, idHint: 'v:결정:decision' });
    assert.equal(v.id, 'v:결정:decision');
    assert.deepEqual(v.hanjaBreakdown, [{ syllable: '결', hanja: '決' }, { syllable: '정', hanja: '定' }]);
    const w = krdictToVocab({ targetCode: 1, word: '결정하다', pos: '동사', definitionKo: 'd', transWord: 'decide', origin: '決定하다' }, opts);
    assert.deepEqual(w.hanjaBreakdown, [{ syllable: '결', hanja: '決' }, { syllable: '정', hanja: '定' }]);
  });

  test('validates as a draft: missing examples are a warning, not an error', () => {
    const existing = new Map<ItemId, Item>();
    const r = importItems([krdictToVocab(senses[0]!, opts)], { existing, defaultSource: { kind: 'user', license: 'original-owned' } });
    assert.equal(r.items.length, 1);
    assert.deepEqual(r.issues.filter((i) => i.severity === 'error'), []);
    assert.ok(r.issues.some((i) => i.severity === 'warning' && /examples/.test(i.msg)));
    assert.equal(r.items[0]!.source.kind, 'krdict');
  });

  test('without trans_word falls back to trans_dfn', () => {
    const s: KrdictSense = { targetCode: 9, word: '자못', pos: '부사', definitionKo: '생각보다 매우.', transDfn: 'Quite, rather.' };
    const v = krdictToVocab(s, opts);
    assert.deepEqual(v.meanings, ['Quite, rather.']);
  });
});
