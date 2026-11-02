// KRDict example-sentence bank (packages/content/examples/krdict-examples.json, built by scripts/krdict).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSeed, PKG_DIR } from '../bin/lib.ts';

type Example =
  | { kind: 'sentence'; ko: string; match: string }
  | { kind: 'dialogue'; lines: string[]; match: string; matchLine: number };
interface ExamplesFile {
  format: number;
  source: { name: string; publisher: string; license: string; licenseUrl: string; url: string; snapshot: string };
  items: Record<string, Example[]>;
}

const raw = readFileSync(join(PKG_DIR, 'examples', 'krdict-examples.json'), 'utf8');
const file = JSON.parse(raw) as ExamplesFile;
const seedIds = new Set(
  loadSeed().raws.map((r) => (r as { id?: unknown }).id).filter((id): id is string => typeof id === 'string'),
);

test('examples file parses and has the source/licence block', () => {
  assert.equal(file.format, 1);
  assert.equal(file.source.name, '한국어기초사전');
  assert.equal(file.source.publisher, '국립국어원');
  assert.equal(file.source.license, 'CC BY-SA 2.0 KR');
  assert.equal(file.source.licenseUrl, 'https://creativecommons.org/licenses/by-sa/2.0/kr/');
  assert.equal(file.source.url, 'https://krdict.korean.go.kr/');
  assert.match(file.source.snapshot, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(Object.keys(file.items).length > 0);
});

test('every key is a real seed item id (vocab or expression)', () => {
  for (const id of Object.keys(file.items)) {
    assert.ok(seedIds.has(id), `unknown item id ${id}`);
    assert.match(id, /^[vx]:/, `${id}: only vocab and expressions get examples`);
  }
});

test('every match is a substring of its sentence or dialogue line', () => {
  for (const [id, exs] of Object.entries(file.items)) {
    for (const ex of exs) {
      assert.ok(ex.match.length > 0, `${id}: empty match`);
      if (ex.kind === 'sentence') {
        assert.ok(ex.ko.includes(ex.match), `${id}: "${ex.match}" not in "${ex.ko}"`);
      } else {
        assert.equal(ex.kind, 'dialogue', `${id}: unknown kind`);
        assert.ok(ex.lines.length >= 2, `${id}: dialogue needs 2+ lines`);
        const line = ex.lines[ex.matchLine];
        assert.ok(line !== undefined, `${id}: matchLine ${ex.matchLine} out of range`);
        assert.ok(line.includes(ex.match), `${id}: "${ex.match}" not in line ${ex.matchLine} "${line}"`);
      }
    }
  }
});

test('no item has more than 12 examples, and none is empty or duplicated', () => {
  for (const [id, exs] of Object.entries(file.items)) {
    assert.ok(exs.length >= 1 && exs.length <= 12, `${id}: ${exs.length} examples`);
    const texts = exs.map((e) => (e.kind === 'sentence' ? e.ko : e.lines.join('\n')));
    assert.equal(new Set(texts).size, texts.length, `${id}: duplicate example`);
  }
});

test('text is whitespace-normalized', () => {
  for (const [id, exs] of Object.entries(file.items)) {
    for (const t of exs.flatMap((e) => (e.kind === 'sentence' ? [e.ko] : e.lines))) {
      assert.equal(t, t.trim().replace(/\s+/g, ' '), `${id}: unnormalized whitespace in "${t}"`);
      assert.doesNotMatch(t, /&(#\d+|#x[0-9a-f]+|[a-z]+);/i, `${id}: undecoded entity in "${t}"`);
    }
  }
});
