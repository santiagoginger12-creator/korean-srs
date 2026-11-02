import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendLines, base64ToUtf8, isoWeek, lineTag, newLines, parseRepo, parseSegmentPath, segmentIds, segmentName, splitSegment,
  utf8ToBase64,
} from '../src/index.ts';
import type { AppEvent } from '@ksrs/srs-engine';

describe('segments', () => {
  test('ISO weeks at year boundaries (UTC)', () => {
    assert.deepEqual(isoWeek(Date.UTC(2026, 0, 1)), { year: 2026, week: 1 }); // Thursday
    assert.deepEqual(isoWeek(Date.UTC(2024, 11, 30)), { year: 2025, week: 1 }); // Monday of 2025-W01
    assert.deepEqual(isoWeek(Date.UTC(2027, 0, 1)), { year: 2026, week: 53 }); // Friday in 2026-W53
    assert.deepEqual(isoWeek(Date.UTC(2026, 10, 2, 23, 59)), { year: 2026, week: 45 });
    assert.equal(segmentName(Date.UTC(2026, 9, 26)), '2026-W44.jsonl');
    assert.equal(segmentName(Date.UTC(2026, 0, 5)), '2026-W02.jsonl');
  });

  test('segment paths: only <root>/log/<safe device id>/<YYYY>-W<ww>.jsonl', () => {
    assert.deepEqual(parseSegmentPath('ksrs/v1/log/ab12/2026-W44.jsonl'), { deviceId: 'ab12' });
    assert.equal(parseSegmentPath('ksrs/v1/log/ab12/notes.txt'), null);
    assert.equal(parseSegmentPath('ksrs/v1/log/a b/2026-W44.jsonl'), null);
    assert.equal(parseSegmentPath('ksrs/v1/log/x/y/2026-W44.jsonl'), null);
    assert.equal(parseSegmentPath('ksrs/v2/log/ab12/2026-W44.jsonl'), null);
    assert.deepEqual(parseSegmentPath('ksrs/v2/log/ab12/2026-W44.jsonl', 'ksrs/v2'), { deviceId: 'ab12' });
  });

  test('complete lines, a truncated tail, CRLF and a final line without newline', () => {
    assert.deepEqual(splitSegment('{"id":"a"}\n{"id":"b"}\n{"id":'), { lines: ['{"id":"a"}', '{"id":"b"}'], truncated: '{"id":' });
    assert.deepEqual(splitSegment('{"id":"a"}\r\n{"id":"b"}'), { lines: ['{"id":"a"}', '{"id":"b"}'], truncated: null });
    assert.deepEqual(splitSegment(''), { lines: [], truncated: null });
  });

  test('newLines reads past the cached count and restarts when the file was rewritten', () => {
    const t = '{"id":"a"}\n{"id":"b"}\n{"id":"c"}\n';
    const first = newLines(t, 0, undefined);
    assert.equal(first.fresh.length, 3);
    assert.equal(first.tail, lineTag('{"id":"c"}'));
    const more = newLines(`${t}{"id":"d"}\n`, 3, first.tail);
    assert.deepEqual(more.fresh, ['{"id":"d"}']);
    assert.equal(more.restarted, false);
    const rewritten = newLines('{"id":"x"}\n{"id":"y"}\n{"id":"z"}\n{"id":"d"}\n', 3, first.tail);
    assert.equal(rewritten.restarted, true);
    assert.equal(rewritten.fresh.length, 4);
    assert.equal(newLines('{"id":"a"}\n', 3, first.tail).restarted, true, 'shorter than before');
  });

  test('appendLines drops a cut-off tail and keeps one event per line', () => {
    const e = { id: 'n', v: 1 } as unknown as AppEvent;
    assert.equal(appendLines('{"id":"a"}\n{"id":', [e]), '{"id":"a"}\n{"id":"n","v":1}\n');
    assert.equal(appendLines('{"id":"a"}', [e]), '{"id":"a"}\n{"id":"n","v":1}\n');
    assert.equal(appendLines('', [e]), '{"id":"n","v":1}\n');
    assert.deepEqual([...segmentIds('{"id":"a"}\nnot json\n{"id":"b"}\n{"id":"c')], ['a', 'b']);
  });

  test('base64 round-trips Korean and emoji; GitHub line wrapping is ignored', () => {
    const s = '결정을 내리다 — ㅔ/ㅐ ✓ 🙂\n'.repeat(20);
    const b = utf8ToBase64(s);
    assert.equal(base64ToUtf8(b), s);
    assert.equal(base64ToUtf8(b.replace(/.{1,60}/g, (m) => `${m}\n`)), s);
    for (let n = 0; n < 5; n++) assert.equal(base64ToUtf8(utf8ToBase64('x'.repeat(n))), 'x'.repeat(n));
  });

  test('parseRepo accepts owner/name and GitHub URLs', () => {
    assert.deepEqual(parseRepo('santiagoginger12-creator/ksrs-data'), { owner: 'santiagoginger12-creator', repo: 'ksrs-data' });
    assert.deepEqual(parseRepo(' https://github.com/santiagoginger12-creator/ksrs-data.git '), { owner: 'santiagoginger12-creator', repo: 'ksrs-data' });
    assert.equal(parseRepo('ksrs-data'), null);
    assert.equal(parseRepo('a/b/c'), null);
  });
});
