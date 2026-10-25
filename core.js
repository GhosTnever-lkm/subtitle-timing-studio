// Subtitle Timing Studio — pure parsing/serialization/validation core.
// No dependencies, no DOM, no Node APIs, no network.

const SRT = 'srt';
const VTT = 'vtt';

/* ------------------------------------------------------------------ *
 * Time helpers
 * ------------------------------------------------------------------ */

const TIME_RE = /^(\d+):([0-5]?\d):([0-5]?\d)(?:[.,](\d{1,3}))?$/;
const VTT_TIME_RE = /^(?:(\d+):)?([0-5]?\d):([0-5]?\d)\.(\d{1,3})$/;

function pad(n, width) {
  let s = String(n);
  while (s.length < width) s = '0' + s;
  return s;
}

function msToParts(ms) {
  if (!Number.isFinite(ms)) ms = 0;
  ms = Math.max(0, Math.round(ms));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const msec = ms % 1000;
  return { h, m, s, msec };
}

export function formatTime(ms, format) {
  const { h, m, s, msec } = msToParts(ms);
  const fmt = String(format || '').toLowerCase();
  if (fmt === VTT || fmt === 'webvtt') {
    const base = `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}.${pad(msec, 3)}`;
    return base;
  }
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(msec, 3)}`;
}

/**
 * parseTime(value) -> number | null
 * Accepts SRT ("00:00:01,500" or "00:00:01.500") and WebVTT
 * ("00:00:01.500", "00:01.500", "01.500").
 * Returns integer milliseconds or null on failure.
 */
export function parseTime(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return null;

  let m = TIME_RE.exec(v);
  if (m) {
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const sec = parseInt(m[3], 10);
    const frac = m[4] ? m[4] : '';
    const msec = fracToMs(frac);
    return ((h * 60 + min) * 60 + sec) * 1000 + msec;
  }

  m = VTT_TIME_RE.exec(v);
  if (m) {
    const h = m[1] ? parseInt(m[1], 10) : 0;
    const min = parseInt(m[2], 10);
    const sec = parseInt(m[3], 10);
    const msec = fracToMs(m[4]);
    return ((h * 60 + min) * 60 + sec) * 1000 + msec;
  }

  return null;
}

export function applyCueDraft(cue, startValue, endValue, text) {
  if (!cue) return 'cue.missing';
  const start = parseTime(startValue);
  const end = parseTime(endValue);
  if (start === null || end === null) return 'time.invalid';
  if (end <= start) return 'time.order';
  cue.startMs = start;
  cue.endMs = end;
  cue.text = typeof text === 'string' ? text : '';
  return null;
}

export function sortCuesPreservingSelection(cues, selectedIndex) {
  const list = Array.isArray(cues) ? cues : [];
  const selectedCue = Number.isInteger(selectedIndex) ? list[selectedIndex] : null;
  const sorted = [...list].sort((a, b) => a.startMs - b.startMs);
  return { cues: sorted, selectedIndex: selectedCue ? sorted.indexOf(selectedCue) : -1 };
}

function fracToMs(frac) {
  if (!frac) return 0;
  if (frac.length === 1) return parseInt(frac, 10) * 100;
  if (frac.length === 2) return parseInt(frac, 10) * 10;
  return parseInt(frac.slice(0, 3), 10);
}

/* ------------------------------------------------------------------ *
 * Line splitting
 * ------------------------------------------------------------------ */

function splitLines(text) {
  if (typeof text !== 'string') text = '';
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text.split(/\r\n|\r|\n/);
}

function isBlank(line) {
  return line === undefined || line === null || line.trim() === '';
}

/* ------------------------------------------------------------------ *
 * Parsing
 * ------------------------------------------------------------------ */

function makeParseResult(format) {
  return { cues: [], errors: [], format };
}

const SRT_ARROW_RE = /-->/;
const VTT_ARROW_RE = /-->/;

export function parseSubtitles(text, format) {
  const fmt = normalizeFormat(format);
  const result = makeParseResult(fmt);
  const lines = splitLines(text);
  if (fmt === VTT) {
    parseVtt(lines, result);
  } else {
    parseSrt(lines, result);
  }
  return result;
}

function normalizeFormat(format) {
  const f = String(format || '').toLowerCase();
  if (f === 'vtt' || f === 'webvtt') return VTT;
  return SRT;
}

/* -------------------------------- SRT ------------------------------ */

function parseSrt(lines, result) {
  let i = 0;
  const n = lines.length;

  // skip leading blank lines
  while (i < n && isBlank(lines[i])) i++;

  while (i < n) {
    // Skip stray blanks between blocks
    while (i < n && isBlank(lines[i])) i++;
    if (i >= n) break;

    const blockStart = i + 1; // 1-based line number for diagnostics
    let id = '';
    let timeLine = '';
    let timeLineNo = 0;

    // Optional numeric index line (or any single-line id before time)
    if (!SRT_ARROW_RE.test(lines[i])) {
      const first = lines[i];
      // A valid SRT index is usually digits; but we tolerate anything
      // that is not a time line, as long as next line is a time line.
      if (i + 1 < n && SRT_ARROW_RE.test(lines[i + 1])) {
        id = first.trim();
        i++;
      }
    }

    if (i >= n || !SRT_ARROW_RE.test(lines[i])) {
      result.errors.push({
        line: blockStart,
        code: 'srt.badBlock',
        message: 'Missing time line'
      });
      // skip until blank line to recover
      while (i < n && !isBlank(lines[i])) i++;
      continue;
    }

    timeLine = lines[i];
    timeLineNo = i + 1;
    i++;

    const times = parseSrtTimeLine(timeLine);
    if (!times) {
      result.errors.push({
        line: timeLineNo,
        code: 'srt.badTime',
        message: 'Invalid time line: ' + timeLine.trim()
      });
      // Skip text until blank
      while (i < n && !isBlank(lines[i])) i++;
      continue;
    }

    if (times.endMs <= times.startMs) {
      result.errors.push({
        line: timeLineNo,
        code: 'srt.badRange',
        message: 'end <= start'
      });
      while (i < n && !isBlank(lines[i])) i++;
      continue;
    }

    // Collect text lines until blank
    const textLines = [];
    while (i < n && !isBlank(lines[i])) {
      textLines.push(lines[i]);
      i++;
    }

    const cue = {
      id: id || String(result.cues.length + 1),
      startMs: times.startMs,
      endMs: times.endMs,
      text: textLines.join('\n'),
      sourceLine: blockStart
    };
    result.cues.push(cue);
  }
}

function parseSrtTimeLine(line) {
  const idx = line.indexOf('-->');
  if (idx < 0) return null;
  const left = line.slice(0, idx).trim();
  const rest = line.slice(idx + 3);
  // Right side may contain trailing spaces only for SRT (no settings)
  const right = rest.trim();
  if (!left || !right) return null;

  const startMs = parseTime(left);
  const endMs = parseTime(right);
  if (startMs === null || endMs === null) return null;
  return { startMs, endMs };
}

/* -------------------------------- VTT ------------------------------ */

function parseVtt(lines, result) {
  let i = 0;
  const n = lines.length;

  // Skip leading blanks
  while (i < n && isBlank(lines[i])) i++;

  if (i >= n || !/^WEBVTT(\s|$)/.test(lines[i])) {
    result.errors.push({
      line: i + 1,
      code: 'vtt.noHeader',
      message: 'Missing WEBVTT header'
    });
    return;
  }
  // Header may have trailing metadata on same line; skip it.
  i++;

  while (i < n) {
    while (i < n && isBlank(lines[i])) i++;
    if (i >= n) break;

    const first = lines[i];
    const trimmed = first.trim();

    // NOTE blocks: consume until blank line
    if (/^NOTE(\s|$)/.test(trimmed)) {
      i++;
      while (i < n && !isBlank(lines[i])) i++;
      continue;
    }
    // STYLE / REGION blocks
    if (/^STYLE(\s|$)/.test(trimmed) || /^REGION(\s|$)/.test(trimmed)) {
      i++;
      while (i < n && !isBlank(lines[i])) i++;
      continue;
    }

    const blockStart = i + 1;
    let id = '';
    let timeLine = '';
    let timeLineNo = 0;

    // Optional cue identifier: a line before the time line that contains "-->"
    if (!VTT_ARROW_RE.test(first) && i + 1 < n && VTT_ARROW_RE.test(lines[i + 1])) {
      id = first;
      i++;
    }

    if (i >= n || !VTT_ARROW_RE.test(lines[i])) {
      result.errors.push({
        line: blockStart,
        code: 'vtt.badBlock',
        message: 'Missing time line'
      });
      // skip until blank
      while (i < n && !isBlank(lines[i])) i++;
      continue;
    }

    timeLine = lines[i];
    timeLineNo = i + 1;
    i++;

    const parsed = parseVttTimeLine(timeLine);
    if (!parsed) {
      result.errors.push({
        line: timeLineNo,
        code: 'vtt.badTime',
        message: 'Invalid time line: ' + timeLine.trim()
      });
      while (i < n && !isBlank(lines[i])) i++;
      continue;
    }
    if (parsed.endMs <= parsed.startMs) {
      result.errors.push({
        line: timeLineNo,
        code: 'vtt.badRange',
        message: 'end <= start'
      });
      while (i < n && !isBlank(lines[i])) i++;
      continue;
    }

    const textLines = [];
    while (i < n && !isBlank(lines[i])) {
      textLines.push(lines[i]);
      i++;
    }

    const cue = {
      id: id || null,
      startMs: parsed.startMs,
      endMs: parsed.endMs,
      text: textLines.join('\n'),
      sourceLine: blockStart
    };
    if (parsed.settings) cue.settings = parsed.settings;
    result.cues.push(cue);
  }
}

function parseVttTimeLine(line) {
  const idx = line.indexOf('-->');
  if (idx < 0) return null;
  const left = line.slice(0, idx).trim();
  const rest = line.slice(idx + 3).trim();
  if (!left || !rest) return null;

  // Right side: timestamp then optional settings.
  // Split at first whitespace.
  const wsMatch = /^(\S+)\s*(.*)$/.exec(rest);
  if (!wsMatch) return null;
  const rightTime = wsMatch[1];
  const settings = wsMatch[2] ? wsMatch[2].trim() : '';

  const startMs = parseTime(left);
  const endMs = parseTime(rightTime);
  if (startMs === null || endMs === null) return null;

  return { startMs, endMs, settings };
}

/* ------------------------------------------------------------------ *
 * Serialization
 * ------------------------------------------------------------------ */

export function serializeSubtitles(cues, format) {
  const fmt = normalizeFormat(format);
  if (fmt === VTT) return serializeVtt(cues);
  return serializeSrt(cues);
}

export function activeCuesAt(cues, timeMs) {
  if (!Array.isArray(cues) || !Number.isFinite(timeMs)) return [];
  return cues.filter((cue) => cue && Number.isFinite(cue.startMs) && Number.isFinite(cue.endMs)
    && timeMs >= cue.startMs && timeMs < cue.endMs && cue.text);
}

function serializeSrt(cues) {
  const out = [];
  const list = Array.isArray(cues) ? cues : [];
  for (let i = 0; i < list.length; i++) {
    const cue = list[i] || {};
    const start = Math.max(0, Math.round(Number(cue.startMs) || 0));
    const end = Math.max(0, Math.round(Number(cue.endMs) || 0));
    const sourceId = typeof cue.id === 'string' ? cue.id.trim() : '';
    out.push(sourceId || String(i + 1));
    out.push(formatTime(start, SRT) + ' --> ' + formatTime(end, SRT));
    out.push(typeof cue.text === 'string' ? cue.text : '');
    out.push('');
  }
  return out.join('\n');
}

function serializeVtt(cues) {
  const out = [];
  out.push('WEBVTT');
  out.push('');
  const list = Array.isArray(cues) ? cues : [];
  for (let i = 0; i < list.length; i++) {
    const cue = list[i] || {};
    if (typeof cue.id === 'string' && cue.id.trim() !== '') {
      out.push(cue.id);
    }
    const start = Math.max(0, Math.round(Number(cue.startMs) || 0));
    const end = Math.max(0, Math.round(Number(cue.endMs) || 0));
    let line = formatTime(start, VTT) + ' --> ' + formatTime(end, VTT);
    if (typeof cue.settings === 'string' && cue.settings.trim() !== '') {
      line += ' ' + cue.settings.trim();
    }
    out.push(line);
    out.push(typeof cue.text === 'string' ? cue.text : '');
    out.push('');
  }
  return out.join('\n');
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

export function validateCues(cues) {
  const warnings = [];
  const list = Array.isArray(cues) ? cues : [];
  const ids = new Map();
  const seen = [];

  for (let i = 0; i < list.length; i++) {
    const cue = list[i];
    if (!cue || typeof cue !== 'object') continue;
    const hasId = cue.id !== undefined && cue.id !== null;
    const cueId = hasId ? String(cue.id).trim() : '';

    const start = Number(cue.startMs);
    const end = Number(cue.endMs);

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      warnings.push({
        cueId: cueId,
        code: 'time.invalid',
        message: 'Non-finite time value'
      });
    } else {
      if (start < 0 || end < 0) {
        warnings.push({
          cueId: cueId,
          code: 'time.negative',
          message: 'Negative time value'
        });
      }
      if (end <= start) {
        warnings.push({
          cueId: cueId,
          code: 'time.order',
          message: 'end <= start'
        });
      }
    }

    if (hasId && cueId === '') {
      warnings.push({
        cueId: cueId,
        code: 'id.empty',
        message: 'Empty cue id'
      });
    } else if (cueId !== '') {
      if (ids.has(cueId)) {
        warnings.push({
          cueId: cueId,
          code: 'id.duplicate',
          message: 'Duplicate cue id'
        });
      } else {
        ids.set(cueId, i);
      }
    }

    seen.push({ index: i, cueId, start, end });
  }

  // Sort a copy so input ordering remains untouched; report each cue once
  // if it intersects any earlier active interval, including non-adjacent cues.
  const byStart = seen.filter((cue) => Number.isFinite(cue.start) && Number.isFinite(cue.end))
    .sort((a, b) => a.start - b.start || a.end - b.end || a.index - b.index);
  let active = [];
  for (const current of byStart) {
    active = active.filter((previous) => previous.end > current.start);
    if (active.length) {
      warnings.push({
        cueId: current.cueId,
        code: 'time.overlap',
        message: 'Overlaps another cue'
      });
    }
    active.push(current);
  }

  return warnings;
}

/* ------------------------------------------------------------------ *
 * default export (optional convenience)
 * ------------------------------------------------------------------ */

export default {
  parseSubtitles,
  serializeSubtitles,
  validateCues,
  formatTime,
  parseTime
};
