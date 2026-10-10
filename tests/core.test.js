import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, parseTime, parseSubtitles, serializeSubtitles, validateCues } from '../core.js';

test('parses SRT BOM, CRLF, multi-line cue and preserves identifier', () => {
  const src = '\uFEFF17\r\n00:00:01,250 --> 00:00:03,000\r\nFirst line\r\nSecond line\r\n';
  const parsed = parseSubtitles(src, 'srt');
  assert.equal(parsed.errors.length, 0); assert.equal(parsed.cues.length, 1);
  assert.equal(parsed.cues[0].id, '17'); assert.equal(parsed.cues[0].text, 'First line\nSecond line');
  assert.equal(parsed.cues[0].startMs, 1250); assert.equal(parsed.cues[0].endMs, 3000);
});

test('round-trips arbitrary SRT cue identifiers', () => {
  const cues = [{ id: 'intro-A', startMs: 0, endMs: 1250, text: 'Hi' }, { id: '42', startMs: 2000, endMs: 2400, text: 'Bye' }];
  const result = parseSubtitles(serializeSubtitles(cues, 'srt'), 'srt');
  assert.deepEqual(result.cues.map((cue) => cue.id), ['intro-A', '42']);
});

test('parses WebVTT header, optional cue id, settings and ignores note/style/region blocks', () => {
  const src = 'WEBVTT - demo\n\nNOTE metadata\nignored\n\nSTYLE\n::cue { color: lime }\n\nREGION\nid:captions\n\ncue-A\n00:01.000 --> 00:02.250 align:start line:80%\n<v Alex>Hello</v>\n\n00:02.500 --> 00:03.000\nAnother\n';
  const parsed = parseSubtitles(src, 'vtt');
  assert.equal(parsed.errors.length, 0); assert.equal(parsed.cues.length, 2);
  assert.equal(parsed.cues[0].id, 'cue-A'); assert.equal(parsed.cues[0].settings, 'align:start line:80%');
  assert.equal(parsed.cues[0].text, '<v Alex>Hello</v>'); assert.equal(parsed.cues[1].id, null);
  assert.match(serializeSubtitles(parsed.cues, 'vtt'), /^WEBVTT\n\ncue-A\n/);
});

test('recovers from a malformed SRT block and reports its source line', () => {
  const parsed = parseSubtitles('bad block\nno arrow\n\n2\n00:00:01,000 --> 00:00:02,000\nokay', 'srt');
  assert.equal(parsed.cues.length, 1); assert.equal(parsed.errors.length, 1); assert.equal(parsed.errors[0].line, 1);
});

test('converts timestamps accurately and accepts durations over 999 hours', () => {
  assert.equal(parseTime('01:02:03,004'), 3723004); assert.equal(parseTime('02:03.4'), 123400);
  assert.equal(parseTime('1234:00:00.001'), 4442400001); assert.equal(parseTime('00:61:00.000'), null);
  assert.equal(formatTime(3723004, 'vtt'), '01:02:03.004');
});

test('finds overlaps missed by neighbor-only scans and does not mutate input', () => {
  const cues = [{ id: 'long', startMs: 0, endMs: 10000 }, { id: 'middle', startMs: 1000, endMs: 2000 }, { id: 'later', startMs: 3000, endMs: 4000 }];
  const original = structuredClone(cues); const issues = validateCues(cues);
  assert.deepEqual(cues, original); assert.equal(issues.filter((issue) => issue.code === 'time.overlap').length, 2);
});

test('checks overlaps irrespective of source ordering and treats touching cues as clean', () => {
  const issues = validateCues([{ id: 'b', startMs: 2000, endMs: 3000 }, { id: 'a', startMs: 0, endMs: 2100 }, { id: 'c', startMs: 3000, endMs: 4000 }]);
  assert.deepEqual(issues.filter((issue) => issue.code === 'time.overlap').map((issue) => issue.cueId), ['b']);
});

test('optional WebVTT cue identifiers do not create empty-id warnings', () => {
  const parsed = parseSubtitles('WEBVTT\n\n00:00.000 --> 00:01.000\nHi', 'vtt');
  assert.deepEqual(validateCues(parsed.cues), []);
});

test('reports duplicate ids, invalid ranges, and explicit empty ids', () => {
  const issues = validateCues([{ id: 'x', startMs: 0, endMs: 1 }, { id: 'x', startMs: 4, endMs: 3 }, { id: ' ', startMs: 2, endMs: 3 }]);
  assert.ok(issues.some((issue) => issue.code === 'id.duplicate'));
  assert.ok(issues.some((issue) => issue.code === 'id.empty'));
  assert.ok(issues.some((issue) => issue.code === 'time.order'));
});
