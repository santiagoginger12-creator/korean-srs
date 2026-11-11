// The generated drill deck (packages/content/drill/deck.json, scripts/drill/build-deck.ts, D78).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { finishDeck, joinHints, KRDICT_CREDIT, parseCsv, sentenceLike, type DeckFile } from '../../../scripts/drill/build-deck.ts';

const deck = JSON.parse(readFileSync(fileURLToPath(new URL('../drill/deck.json', import.meta.url)), 'utf8')) as DeckFile;

describe('drill deck.json', () => {
  test('all 10,878 words in word-bank order (tier, then id)', () => {
    assert.equal(deck.format, 1);
    assert.equal(deck.count, 10878);
    assert.equal(deck.words.length, 10878);
    assert.equal(deck.words[0]!.id, 'kw00001');
    for (let i = 1; i < deck.words.length; i++) {
      const a = deck.words[i - 1]!, b = deck.words[i]!;
      assert.ok(a.id < b.id && a.tier <= b.tier, `${a.id} → ${b.id}`);
    }
    assert.deepEqual(deck.tiers.map((t) => t.tier), [1, 2, 3, 4, 5, 6]);
    assert.equal(deck.tiers.reduce((n, t) => n + t.count, 0), 10878);
  });

  test('tier 1 is original with an example; everything else is a short krdict gloss without one', () => {
    for (const w of deck.words) {
      assert.ok(w.headword && w.pos && w.tier_label, w.id);
      if (w.tier === 1) {
        assert.equal(w.gloss_source, 'original', w.id);
        assert.ok(w.gloss.length > 0 && w.example?.ko && w.example.en, w.id);
      }
      if (w.gloss_source === 'krdict') {
        assert.equal(w.example, undefined, w.id);
        assert.ok(w.gloss.length <= 60, `${w.id}: ${w.gloss}`);
      } else assert.equal(w.gloss_source, 'original');
    }
    assert.equal(deck.credit, KRDICT_CREDIT);
  });

  test('deck file version matches its words (rebuild after editing)', () => {
    assert.equal(finishDeck(deck.words).version, deck.version);
  });
});

describe('build-deck helpers', () => {
  test('joinHints: unique parts, "; ", capped near 60', () => {
    assert.equal(joinHints(['put; insert', 'add; mix', 'put']), 'put; insert; add; mix');
    assert.equal(joinHints(['a'.repeat(30), 'b'.repeat(25), 'c'.repeat(10)]), `${'a'.repeat(30)}; ${'b'.repeat(25)}`);
    assert.ok(joinHints(['word '.repeat(5) + 'x'.repeat(40)]).length <= 60);
    assert.equal(joinHints([]), '');
  });

  test('proverb- and idiom-like hints are dropped', () => {
    assert.equal(sentenceLike('A rolling stone gathers no moss', false), true);
    assert.equal(sentenceLike("One's tears spin", false), true);
    assert.equal(sentenceLike('National Assembly', false), false);
    assert.equal(sentenceLike('be on someone\'s side', false), false);
    assert.equal(joinHints(['You will lose two rabbits all together if you try to catch b']), '');
  });

  test('parseCsv handles quotes and CRLF', () => {
    assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
  });
});
