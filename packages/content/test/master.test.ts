import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MASTER_COLUMNS, MASTER_HEADER, meaningAnswers, parseMasterCsv, serializeMasterCsv, sessionWordItem, stripFences, validateItem,
  type MasterRow,
} from '../src/index.ts';

const row = (word: string, o: Partial<MasterRow> = {}): MasterRow => ({
  word, meaning: `${word}-en`, hanja: '', pos: 'noun', status: 'new', times_missed: 0, times_seen: 0, last_seen: '',
  freq_rank: null, sources: ['anki'], tags: [], notes: '', ...o,
});

describe('master CSV format', () => {
  test('header is the binding column order', () => {
    assert.equal(MASTER_HEADER, 'word,meaning,hanja,pos,status,times_missed,times_seen,last_seen,freq_rank,sources,tags,notes');
    assert.equal(MASTER_COLUMNS.length, 12);
  });

  test('round-trip: quotes, commas, Korean, hanja, blanks, CRLF, no BOM', () => {
    const rows = [
      row('걸치다', { meaning: 'to extend, stretch; to wear, throw on', pos: 'verb/adj', status: 'learning', times_missed: 78, times_seen: 320,
        last_seen: '2026-08-15', freq_rank: 5309, tags: ['leech', 'shaky'] }),
      row('결재', { meaning: 'approval (of a document)', hanja: '決裁', status: 'mastered', notes: 'say "결재를 올리다", not 결제' }),
      row('가랑비에 옷 젖는 줄 모른다', { pos: '속담', sources: ['app'], tags: ['app-L1'], notes: 'line1\nline2' }),
    ];
    const text = serializeMasterCsv(rows);
    assert.ok(text.startsWith(MASTER_HEADER + '\r\n'));
    assert.notEqual(text.charCodeAt(0), 0xfeff);
    assert.ok(text.includes('"to extend, stretch; to wear, throw on"'));
    assert.ok(text.includes('"say ""결재를 올리다"", not 결제"'));
    const back = parseMasterCsv(text);
    assert.equal(back.hadHeader, true);
    assert.deepEqual(back.issues, []);
    assert.deepEqual(back.rows, rows);
    assert.equal(serializeMasterCsv(back.rows), text);
  });

  test('a header in another column order maps by name; unknown columns warn', () => {
    const r = parseMasterCsv('meaning,word,status,extra\nto hesitate,망설이다,learning,x\n');
    assert.deepEqual(r.rows.map((x) => [x.word, x.meaning, x.status]), [['망설이다', 'to hesitate', 'learning']]);
    const warns = r.issues.filter((i) => i.severity === 'warning').map((i) => i.msg);
    assert.equal(warns.length, 2);
    assert.match(warns[1]!, /header has no hanja, pos, times_missed, times_seen, last_seen, freq_rank, sources, tags, notes columns/);
  });

  test('edge cases give clear issues, never throw: short/long rows, unclosed quote, Markdown table, CRLF + trailing blanks', () => {
    const short = parseMasterCsv('걸치다,a,,verb,learning,3,4,2026-10-28,,convo');
    assert.equal(short.rows[0]!.times_missed, 3);
    assert.match(short.issues[0]!.msg, /only 10 of 12 columns; the missing tags, notes left blank/);
    // An unquoted comma in the meaning shifts the columns: an error, not a silently wrong row.
    const shifted = parseMasterCsv('걸치다,to hang, drape,,verb,learning,3,4,2026-10-28,,convo,,');
    assert.deepEqual(shifted.rows, []);
    assert.ok(shifted.issues.some((i) => i.severity === 'error' && /times_missed "learning"/.test(i.msg)));
    const unclosed = parseMasterCsv('걸치다,"a,,verb,learning,3,4,,,convo,,\n빌다,b,,verb,new,0,0,,,convo,,');
    assert.deepEqual(unclosed.rows, []);
    assert.match(unclosed.issues[0]!.msg, /unclosed " quote/);
    assert.ok(parseMasterCsv('| word | meaning |\n|---|---|\n| 걸치다 | a |').issues.every((i) => i.severity === 'error'));
    const crlf = parseMasterCsv('```csv\r\n걸치다,"to hang, drape",,verb,learning,3,4,2026-10-28,,convo,,\r\n\r\n```\r\n\r\n');
    assert.deepEqual([crlf.rows.length, crlf.rows[0]!.meaning, crlf.issues], [1, 'to hang, drape', []]);
    for (const t of ['', '\n\n', '```', '"', MASTER_HEADER, 'word\n걸치다']) assert.doesNotThrow(() => parseMasterCsv(t));
  });

  test('session block: code fence, no header, blank lines, Korean, NFD → NFC', () => {
    const nfd = '어긋나다'.normalize('NFD');
    const text = [
      'VOCAB ROWS', '', '```csv',
      `${nfd},"to go amiss; to be at cross purposes",,verb,learning,64,260,2026-10-28,5187,anki convo,leech shaky,missed the 기대에 어긋나다 sense`,
      '',
      '서먹하다,awkward (between people),,adj,new,1,1,2026-10-28,,convo,,',
      '```', 'Paste these into the app.',
    ].join('\n');
    const r = parseMasterCsv(text);
    assert.equal(r.fenced, true);
    assert.equal(r.hadHeader, false);
    assert.deepEqual(r.issues, []);
    assert.equal(r.rows.length, 2);
    assert.equal(r.rows[0]!.word, '어긋나다');
    assert.equal(r.rows[0]!.word, '어긋나다'.normalize('NFC'));
    assert.equal(r.rows[0]!.times_missed, 64);
    assert.deepEqual(r.rows[0]!.sources, ['anki', 'convo']);
    assert.equal(r.rows[0]!.notes, 'missed the 기대에 어긋나다 sense');
    assert.equal(r.rows[1]!.freq_rank, null);
  });

  test('session block with header and CRLF, without fences', () => {
    const r = parseMasterCsv(`${MASTER_HEADER}\r\n기어이,"at last; persistently",,adverb,learning,9,40,2026-10-28,,convo,,\r\n`);
    assert.equal(r.hadHeader, true);
    assert.equal(r.rows[0]!.meaning, 'at last; persistently');
  });

  test('stripFences: several fenced blocks, unclosed fence', () => {
    assert.equal(stripFences('a\n```\nb\n```\nc\n```\nd').body, 'b\nd');
    assert.equal(stripFences('plain').fenced, false);
  });

  test('bad rows are reported and left out; good rows kept; duplicates keep the last', () => {
    const r = parseMasterCsv([
      'just a sentence',
      '맞추다,to adjust,,verb,learning,x,1,,,anki,,',
      '갖추다,to prepare,,verb,weird,1,1,,,anki,,',
      '끼다,to fit,,verb,learning,3,10,10/28/2026,abc,anki,,',
      '끼다,to fit; to wear,,verb,learning,4,11,,,anki,,',
      ',no word,,verb,new,0,0,,,convo,,',
      '빌다,to beg,,verb,new,0,0,,,convo,,,extra,cells',
    ].join('\n'));
    assert.deepEqual(r.rows.map((x) => x.word), ['끼다', '빌다']);
    assert.equal(r.rows[0]!.times_missed, 4);
    assert.equal(r.rows[1]!.notes, 'extra, cells');
    const errs = r.issues.filter((i) => i.severity === 'error').map((i) => i.msg);
    assert.equal(errs.length, 4);
    assert.ok(errs.some((m) => m.includes('not a vocab row')));
    assert.ok(errs.some((m) => m.includes('times_missed')));
    assert.ok(errs.some((m) => m.includes('unknown status')));
    assert.ok(errs.some((m) => m.includes('missing word')));
    const warns = r.issues.filter((i) => i.severity === 'warning').map((i) => i.msg);
    assert.ok(warns.some((m) => m.includes('last_seen')));
    assert.ok(warns.some((m) => m.includes('freq_rank')));
    assert.ok(warns.some((m) => m.includes('more than once')));
    assert.ok(warns.some((m) => m.includes('extra columns')));
  });

  test('blank status → new (warning); blank counts → 0', () => {
    const r = parseMasterCsv('덤,bonus,,noun,,,,,,convo,,');
    assert.equal(r.rows[0]!.status, 'new');
    assert.equal(r.rows[0]!.times_missed, 0);
    assert.equal(r.issues.length, 1);
  });
});

describe('session word item', () => {
  test('meaning + production, valid, id avoids collisions', () => {
    const r = row('서먹하다', { meaning: 'awkward, uncomfortable; distant (between people)', pos: 'adj' });
    const existing = new Map();
    const it = sessionWordItem(r, { level: 3, source: 'convo', existing });
    assert.equal(it.id, 'v:서먹하다');
    assert.deepEqual(it.questionTypes, ['meaning', 'production']);
    assert.deepEqual(it.questions.meaning!.accepted, ['awkward', 'uncomfortable', 'distant (between people)']);
    assert.equal(it.questions.production!.promptEn, 'awkward, uncomfortable');
    assert.equal(it.level, 3);
    assert.deepEqual(it.tags, ['convo']);
    const v = validateItem(it);
    assert.equal(v.ok, true, JSON.stringify(v.errors));
    const taken = new Map([[it.id, { ...it, word: '다른말' }]]);
    assert.equal(sessionWordItem(r, { level: 1, source: 'tutor', existing: taken }).id, 'v:서먹하다:2');
  });

  test('meaningAnswers splits senses and glosses, dedupes', () => {
    assert.deepEqual(meaningAnswers('to put on; tie; put on; tie'), ['to put on', 'tie', 'put on']);
    assert.deepEqual(meaningAnswers(''), []);
  });
});
