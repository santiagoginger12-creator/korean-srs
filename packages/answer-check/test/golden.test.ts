// Runs tests/golden/answer-check.ko.tsv (owner-reviewed grading cases).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { FeatureRule, ParticleTolerance, QuestionInstance, SpeechLevel } from '@ksrs/content';
import { check, type Outcome } from '../src/index.ts';

const FILE = new URL('../../../tests/golden/answer-check.ko.tsv', import.meta.url);

const TARGET_FEATURES: Partial<Record<SpeechLevel, FeatureRule[]>> = {
  hapsyo: [{ kind: 'endsWith', any: ['ㅂ니다', '습니다', 'ㅂ니까', '습니까', 'ㅂ시다', '십시오'], label: 'Ending must be 합쇼체' }],
  haeyo: [{ kind: 'endsWith', any: ['요'], label: 'Ending must be 해요체' }],
  haera: [{ kind: 'endsWith', any: ['다'], label: 'Ending must be 해라체 (-다)' }],
  written: [{ kind: 'endsWith', any: ['다'], label: 'Ending must be written style (-다)' }],
};

interface Row { line: number; qtype: string; prompt: string; accepted: string[]; response: string; expected: Outcome; note: string }

function parseOptions(prompt: string): { opts: Map<string, string>; text: string } {
  const m = /^\[([^\]]*)\]\s*/.exec(prompt);
  const opts = new Map<string, string>();
  if (!m) return { opts, text: prompt };
  for (const kv of (m[1] as string).split(/\s+/).filter(Boolean)) {
    const [k, v = 'true'] = kv.split('=');
    opts.set(k as string, v);
  }
  return { opts, text: prompt.slice(m[0].length) };
}

function toQuestion(row: Row): QuestionInstance {
  const { opts, text } = parseOptions(row.prompt);
  const list = (k: string): string[] => (opts.get(k) ?? '').split(',').filter(Boolean);
  const base = { qid: `golden:${row.line}`, itemId: 'golden' };
  switch (row.qtype) {
    case 'meaning': return { ...base, qtype: 'meaning', promptKo: text, accepted: row.accepted, rejected: list('rejected') };
    case 'production': return { ...base, qtype: 'production', promptEn: text, accepted: row.accepted, rejected: list('rejected') };
    case 'cloze': {
      const [before = '', after = ''] = text.split('{{}}');
      return { ...base, qtype: 'cloze', before: before.trim(), after: after.trim(), en: '', cue: '', accepted: row.accepted,
        nearMiss: [], particleTolerance: (opts.get('particles') ?? 'allomorph') as ParticleTolerance,
        spacingStrict: opts.has('spacingStrict') };
    }
    case 'register': {
      const to = (opts.get('to') ?? 'hapsyo') as SpeechLevel;
      return { ...base, qtype: 'register', from: 'haeyo', to, source: text, accepted: row.accepted,
        features: TARGET_FEATURES[to] ?? [], coreWords: list('core'),
        particleTolerance: (opts.get('particles') ?? 'loose') as ParticleTolerance, finalPunctOptional: true };
    }
    default: throw new Error(`line ${row.line}: unknown qtype ${row.qtype}`);
  }
}

function load(): Row[] {
  const lines = readFileSync(FILE, 'utf8').split(/\r?\n/);
  const rows: Row[] = [];
  lines.forEach((raw, i) => {
    if (raw.trim() === '' || raw.startsWith('#') || raw.startsWith('qtype\t')) return;
    const cols = raw.split('\t');
    assert.ok(cols.length >= 5, `line ${i + 1}: expected ≥5 tab-separated columns, got ${cols.length}`);
    const [qtype, prompt, accepted, response, expected, note = ''] = cols as [string, string, string, string, string, string?];
    assert.ok(['correct', 'close', 'incorrect'].includes(expected), `line ${i + 1}: bad outcome ${expected}`);
    rows.push({ line: i + 1, qtype, prompt, accepted: accepted.split('|').map((s) => s.trim()), response,
      expected: expected as Outcome, note: note ?? '' });
  });
  return rows;
}

const rows = load();

test('golden file has cases', () => assert.ok(rows.length >= 30, `${rows.length} rows`));

for (const row of rows) {
  test(`golden L${row.line} ${row.qtype}: ${row.response} → ${row.expected} (${row.note})`, () => {
    const r = check(toQuestion(row), row.response);
    assert.equal(r.outcome, row.expected, `layer=${r.layer} hint=${r.hint ?? ''}`);
  });
}
