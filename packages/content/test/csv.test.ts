import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, toCsv } from '../src/index.ts';
import { escPair, splitEsc, splitList, unesc } from '../src/import/csv.ts';

describe('parseCsv (RFC 4180)', () => {
  test('plain rows, LF and CRLF, no phantom trailing row', () => {
    assert.deepEqual(parseCsv('a,b\nc,d'), [['a', 'b'], ['c', 'd']]);
    assert.deepEqual(parseCsv('a,b\r\nc,d\r\n'), [['a', 'b'], ['c', 'd']]);
    assert.deepEqual(parseCsv('a,b\rc,d\r'), [['a', 'b'], ['c', 'd']]);
    assert.deepEqual(parseCsv(''), []);
  });

  test('empty fields and empty trailing line', () => {
    assert.deepEqual(parseCsv('a,,c\n,,\n'), [['a', '', 'c'], ['', '', '']]);
    assert.deepEqual(parseCsv('a,\n'), [['a', '']]);
    // A blank line in the middle is a (blank) row; only a final line break is dropped.
    assert.deepEqual(parseCsv('a\n\nb\n'), [['a'], [''], ['b']]);
  });

  test('quotes: delimiters, escaped quotes, embedded newlines', () => {
    assert.deepEqual(parseCsv('"a,b","say ""hi""","line1\nline2"\nx,y,z'), [['a,b', 'say "hi"', 'line1\nline2'], ['x', 'y', 'z']]);
    assert.deepEqual(parseCsv('"crlf\r\ninside",2\r\n'), [['crlf\r\ninside', '2']]);
    assert.deepEqual(parseCsv('""'), [['']]);
    assert.deepEqual(parseCsv('"",""\n'), [['', '']]);
  });

  test('BOM is stripped', () => {
    assert.deepEqual(parseCsv('﻿id,word\nv:결정,결정'), [['id', 'word'], ['v:결정', '결정']]);
  });

  test('Korean text and the | / :: separators pass through untouched', () => {
    const rows = parseCsv('word,examples\n망설이다,"그는 잠깐 망설였다.::He hesitated.|왜 망설여요?::Why hesitate?"\n');
    assert.deepEqual(rows[1], ['망설이다', '그는 잠깐 망설였다.::He hesitated.|왜 망설여요?::Why hesitate?']);
  });

  test('tolerant: stray quote in an unquoted field, unterminated quote, custom delimiter', () => {
    assert.deepEqual(parseCsv('a"b,c'), [['a"b', 'c']]);
    assert.deepEqual(parseCsv('"open,ended\nstill'), [['open,ended\nstill']]);
    assert.deepEqual(parseCsv('a\tb\n"c\td"\te', { delimiter: '\t' }), [['a', 'b'], ['c\td', 'e']]);
  });

  test('toCsv → parseCsv round trip on awkward values', () => {
    const rows = [['id', 'text'], ['x', 'a,b'], ['y', 'q"uote'], ['z', 'multi\r\nline'], [' lead', 'trail '], ['', ''], ['한국어', '|::\\']];
    const csv = toCsv(rows);
    assert.ok(csv.endsWith('\r\n'));
    assert.deepEqual(parseCsv(csv), rows);
  });
});

describe('multi-value cells', () => {
  test('splitList trims, drops empties, honours \\| escapes', () => {
    assert.deepEqual(splitList(' a | b ||c '), ['a', 'b', 'c']);
    assert.deepEqual(splitList('either\\|or|x'), ['either|or', 'x']);
    assert.deepEqual(splitList('   '), []);
  });

  test('nested :: inside | with escapes', () => {
    const cell = 'ko1::en1|ko\\|2::en\\:\\:2';
    const parts = splitEsc(cell, '|').map((e) => splitEsc(e, '::').map(unesc));
    assert.deepEqual(parts, [['ko1', 'en1'], ['ko|2', 'en::2']]);
  });

  test('escPair only escapes colons that could be misread', () => {
    assert.equal(escPair('g:는-바람에'), 'g:는-바람에');
    assert.equal(escPair('Note: x'), 'Note: x');
    assert.equal(escPair('a::b'), 'a\\:\\:b');
    assert.equal(escPair('end:'), 'end\\:');
    for (const v of ['g:는-바람에', 'a::b', 'end:', ':start', 'x|y', 'back\\slash', 'a:::b']) {
      const cell = `${escPair(v)}::${escPair(v)}`;
      assert.deepEqual(splitEsc(cell, '::').map(unesc), [v, v], v);
    }
  });
});
