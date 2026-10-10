import { formatTime, parseTime, parseSubtitles, serializeSubtitles, validateCues } from './core.js';

const $ = (id) => document.getElementById(id);
const state = { cues: [], selected: -1, fileName: '', parseErrors: [], videoUrl: '', dirty: false };
const subtitleInput = $('subtitle-file');
const videoInput = $('video-file');
const video = $('video');
let toastTimer;

function toast(message) { const el = $('toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2400); }
function detectedFormat(name) { return /\.vtt$/i.test(name) ? 'vtt' : 'srt'; }
function pluralCues(n) { return `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'реплика' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'реплики' : 'реплик'}`; }
function setDirty(flag = true) { state.dirty = flag; $('save-state').textContent = flag ? 'Есть изменения' : 'Готово'; $('save-state').style.color = flag ? 'var(--warn)' : 'var(--accent)'; }
function openSubtitles() { subtitleInput.click(); }
function openVideo() { videoInput.click(); }
function selectedCue() { return state.cues[state.selected] ?? null; }
function formatClock(ms, fmt = 'vtt') { return formatTime(ms, fmt); }

function loadSubtitleText(text, name) {
  const format = detectedFormat(name);
  const parsed = parseSubtitles(text, format);
  state.cues = parsed.cues;
  state.selected = state.cues.length ? 0 : -1;
  state.fileName = name;
  state.parseErrors = parsed.errors;
  $('file-name').textContent = name;
  $('file-info').textContent = `${pluralCues(state.cues.length)} · ${format === 'vtt' ? 'WebVTT' : 'SubRip'} · локальный файл`;
  $('file-info').title = `Исходный формат: ${format.toUpperCase()}`;
  $('file-icon').textContent = format.toUpperCase();
  setDirty(false); render();
  toast(parsed.errors.length ? `Загружено ${state.cues.length} реплик; найдены ошибки чтения` : `Загружено ${state.cues.length} реплик`);
}

function render() { renderCues(); renderEditor(); renderPreview(); renderTimeline(); renderDiagnostics(); }

function renderCues() {
  const list = $('cue-list'); list.replaceChildren();
  $('cue-count').textContent = state.cues.length;
  $('empty-cues').hidden = state.cues.length > 0;
  state.cues.forEach((cue, index) => {
    const row = document.createElement('div'); row.className = `cue-row${index === state.selected ? ' selected' : ''}`; row.setAttribute('role', 'listitem'); row.tabIndex = 0; row.setAttribute('aria-label', `Реплика ${index + 1}, ${formatClock(cue.startMs)}: ${(cue.text || '').slice(0, 80)}`);
    const time = document.createElement('div'); time.className = 'cue-time'; time.textContent = formatClock(cue.startMs);
    const content = document.createElement('div'); content.className = 'cue-content';
    const n = document.createElement('strong'); n.textContent = `РЕПЛИКА ${String(index + 1).padStart(2, '0')}`;
    const p = document.createElement('p'); p.textContent = cue.text || 'Пустая реплика'; content.append(n, p); row.append(time, content);
    row.addEventListener('click', () => selectCue(index)); row.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectCue(index); } });
    list.append(row);
  });
  $('selected-label').textContent = state.selected >= 0 ? `Выбрана реплика ${state.selected + 1}` : 'Ничего не выбрано';
  $('delete-cue').disabled = state.selected < 0;
}

function renderEditor() {
  const cue = selectedCue(); $('editor-empty').hidden = !!cue; $('cue-form').hidden = !cue;
  if (!cue) return;
  $('cue-start').value = formatClock(cue.startMs); $('cue-end').value = formatClock(cue.endMs); $('cue-text').value = cue.text ?? ''; updateCharCount();
}

function renderPreview() {
  const enabled = $('preview-toggle').checked;
  if (!enabled || video.hidden || video.paused && video.currentTime === 0) { $('caption-overlay').textContent = ''; return; }
  const now = video.currentTime * 1000;
  const active = state.cues.filter((cue) => now >= cue.startMs && now < cue.endMs && cue.text).map((cue) => cue.text);
  $('caption-overlay').textContent = active.join('\n');
}

function renderTimeline() {
  const track = $('timeline-track'); track.replaceChildren();
  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration * 1000 : Math.max(10000, ...state.cues.map((cue) => cue.endMs || 0));
  $('duration-label').textContent = Number.isFinite(video.duration) ? formatClock(duration).slice(3, 8) : '—';
  state.cues.forEach((cue, index) => {
    const block = document.createElement('button'); block.type = 'button'; block.className = `timeline-cue${index === state.selected ? ' selected' : ''}`;
    const start = Math.max(0, Number(cue.startMs) || 0); const end = Math.max(start + 40, Number(cue.endMs) || start + 40);
    block.style.left = `${Math.min(99.5, start / duration * 100)}%`; block.style.width = `${Math.max(1.2, Math.min(100 - start / duration * 100, (end - start) / duration * 100))}%`;
    block.textContent = `${index + 1} · ${(cue.text || '').replace(/\s+/g, ' ').slice(0, 24)}`; block.title = `${formatClock(start)}–${formatClock(end)} · ${cue.text || 'Пустая реплика'}`; block.setAttribute('aria-label', `Реплика ${index + 1} на таймлайне`);
    block.addEventListener('click', () => selectCue(index));
    block.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const rect = track.getBoundingClientRect(); const origin = event.clientX; const original = start;
      block.setPointerCapture(event.pointerId);
      const move = (ev) => { const delta = (ev.clientX - origin) / rect.width * duration; cue.startMs = Math.max(0, Math.round(original + delta)); cue.endMs = cue.startMs + (end - start); block.style.left = `${Math.min(99.5, cue.startMs / duration * 100)}%`; setDirty(); };
      const up = () => { block.removeEventListener('pointermove', move); block.removeEventListener('pointerup', up); render(); };
      block.addEventListener('pointermove', move); block.addEventListener('pointerup', up, { once: true });
    });
    track.append(block);
  });
}

function renderDiagnostics() {
  const out = $('diagnostics'); out.replaceChildren();
  if (!state.fileName && !state.cues.length) { $('issue-badge').textContent = 'Нет данных'; $('issue-badge').className = 'status-badge neutral'; out.innerHTML = '<p class="muted">Добавьте субтитры, чтобы проверить таймкоды и пересечения.</p>'; }
  else {
    const issues = validateCues(state.cues); const hardErrors = state.cues.reduce((n, cue) => n + ((!Number.isFinite(cue.startMs) || !Number.isFinite(cue.endMs) || cue.endMs <= cue.startMs) ? 1 : 0), 0);
    $('issue-badge').textContent = issues.length ? `${issues.length} замеч.` : 'Всё чисто'; $('issue-badge').className = `status-badge ${issues.length ? 'warn' : 'good'}`;
    const summary = document.createElement('p'); summary.className = issues.length ? '' : 'muted'; summary.textContent = issues.length ? `Найдено ${issues.length} замечаний. Исправьте таймкоды перед экспортом.` : `${state.cues.length} реплик · тайминги согласованы · пересечений нет.`; out.append(summary);
    issues.slice(0, 8).forEach((issue) => { const row = document.createElement('div'); row.className = 'issue-row'; const dot = document.createElement('span'); dot.className = `issue-dot${issue.code.startsWith('time.') ? ' error' : ''}`; dot.textContent = issue.code.startsWith('time.') ? '!' : '•'; const text = document.createElement('span'); text.textContent = `${issue.code === 'time.overlap' ? 'Пересечение таймингов' : issue.code === 'time.order' ? 'Конец должен быть позже начала' : issue.code === 'time.negative' ? 'Отрицательный таймкод' : issue.code === 'id.duplicate' ? 'Повторяется ID реплики' : issue.message}${issue.cueId ? ` · ${issue.cueId}` : ''}`; row.append(dot, text); out.append(row); });
    if (issues.length > 8) { const extra = document.createElement('p'); extra.className = 'muted'; extra.textContent = `И ещё ${issues.length - 8} замечаний`; out.append(extra); }
  }
  const detail = $('parse-details'); detail.hidden = !state.parseErrors.length; $('parse-error-count').textContent = state.parseErrors.length ? `(${state.parseErrors.length})` : '';
  const errors = $('parse-errors'); errors.replaceChildren(); state.parseErrors.forEach((error) => { const pre = document.createElement('pre'); pre.textContent = `Строка ${error.line}: ${error.message} [${error.code}]`; errors.append(pre); });
}

function selectCue(index) { state.selected = index; render(); const cue = selectedCue(); if (cue && !video.hidden && Number.isFinite(cue.startMs)) video.currentTime = Math.max(0, cue.startMs / 1000); }
function updateCharCount() { const n = $('cue-text').value.length; $('char-count').textContent = `${n} символ${n % 10 === 1 && n % 100 !== 11 ? '' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'а' : 'ов'}`; }

function applyEditor(event) {
  event?.preventDefault(); const cue = selectedCue(); if (!cue) return;
  const start = parseTime($('cue-start').value); const end = parseTime($('cue-end').value);
  if (start === null || end === null) { toast('Введите таймкод в формате HH:MM:SS.mmm'); return; }
  cue.startMs = start; cue.endMs = end; cue.text = $('cue-text').value; setDirty(); render(); toast('Изменения применены');
}

function addCue() {
  const before = state.selected >= 0 ? state.cues[state.selected] : null;
  const startMs = before ? before.endMs : (Number.isFinite(video.currentTime) && !video.hidden ? Math.round(video.currentTime * 1000) : 0);
  const cue = { id: String(state.cues.length + 1), startMs, endMs: startMs + 2000, text: '', sourceLine: null };
  if (before) state.cues.splice(state.selected + 1, 0, cue); else state.cues.push(cue);
  state.selected = state.cues.indexOf(cue); setDirty(); render(); $('cue-text').focus();
}

function deleteCue() { if (state.selected < 0) return; state.cues.splice(state.selected, 1); state.selected = state.cues.length ? Math.min(state.selected, state.cues.length - 1) : -1; setDirty(); render(); }

function setCueEdge(edge) { const cue = selectedCue(); if (!cue || video.hidden) { toast('Добавьте видео, чтобы взять текущее время'); return; } const ms = Math.max(0, Math.round(video.currentTime * 1000)); cue[edge === 'start' ? 'startMs' : 'endMs'] = ms; if (cue.endMs <= cue.startMs) { if (edge === 'start') cue.endMs = ms + 1000; else cue.startMs = Math.max(0, ms - 1000); } setDirty(); render(); }

function exportFile() {
  applyEditor();
  const format = $('export-format').value; const output = serializeSubtitles(state.cues, format);
  const blob = new Blob([output], { type: format === 'vtt' ? 'text/vtt;charset=utf-8' : 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; const base = (state.fileName || 'subtitles').replace(/\.(srt|vtt)$/i, '') || 'subtitles'; a.download = `${base}.${format}`; a.click(); URL.revokeObjectURL(url); setDirty(false); toast(`Экспортирован файл ${base}.${format}`);
}

function attachVideo(file) { if (!file) return; if (state.videoUrl) URL.revokeObjectURL(state.videoUrl); state.videoUrl = URL.createObjectURL(file); video.src = state.videoUrl; video.hidden = false; $('stage-empty').hidden = true; video.load(); video.addEventListener('loadedmetadata', () => { $('duration-label').textContent = formatClock(video.duration * 1000).slice(3, 8); renderTimeline(); }, { once: true }); render(); toast('Видео открыто локально'); }

subtitleInput.addEventListener('change', async () => { const file = subtitleInput.files?.[0]; if (!file) return; try { loadSubtitleText(await file.text(), file.name); } catch { toast('Не удалось прочитать этот файл'); } subtitleInput.value = ''; });
videoInput.addEventListener('change', () => { attachVideo(videoInput.files?.[0]); videoInput.value = ''; });
$('open-subtitles').addEventListener('click', openSubtitles); $('open-video').addEventListener('click', openVideo); $('choose-video').addEventListener('click', openVideo); $('add-cue').addEventListener('click', addCue); $('empty-add').addEventListener('click', addCue); $('delete-cue').addEventListener('click', deleteCue); $('cue-form').addEventListener('submit', applyEditor); $('cue-text').addEventListener('input', updateCharCount); $('cue-text').addEventListener('change', () => applyEditor()); $('export-top').addEventListener('click', exportFile);
$('set-start').addEventListener('click', () => setCueEdge('start')); $('set-end').addEventListener('click', () => setCueEdge('end')); $('sort-cues').addEventListener('click', () => { state.cues.sort((a, b) => a.startMs - b.startMs); state.selected = -1; setDirty(); render(); });
$('step-back').addEventListener('click', () => { if (!video.hidden) video.currentTime = Math.max(0, video.currentTime - 5); }); $('step-forward').addEventListener('click', () => { if (!video.hidden) video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 5); }); $('play-pause').addEventListener('click', () => { if (video.hidden) { openVideo(); return; } if (video.paused) video.play(); else video.pause(); });
video.addEventListener('timeupdate', () => { $('video-clock').textContent = formatClock(video.currentTime * 1000); renderPreview(); }); video.addEventListener('play', () => { $('play-pause').textContent = 'Ⅱ'; $('play-pause').setAttribute('aria-label', 'Пауза'); }); video.addEventListener('pause', () => { $('play-pause').textContent = '▶'; $('play-pause').setAttribute('aria-label', 'Воспроизвести'); renderPreview(); }); video.addEventListener('loadedmetadata', renderTimeline); $('preview-toggle').addEventListener('change', renderPreview);
window.addEventListener('beforeunload', (event) => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } }); window.addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); openSubtitles(); } if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); exportFile(); } if (event.key === 'Delete' && state.selected >= 0 && document.activeElement?.tagName !== 'TEXTAREA') deleteCue(); });

// A deterministic bundled sample keeps the workspace useful without a fixture upload.
const sample = `1\n00:00:00,400 --> 00:00:02,100\nДобро пожаловать в Subtitle Timing Studio.\n\n2\n00:00:02,300 --> 00:00:04,800\nСверяйте текст с видео и настраивайте\nначало и конец каждой реплики.\n\n3\n00:00:05,000 --> 00:00:07,200\nФайлы обрабатываются только в браузере.`;
loadSubtitleText(sample, 'Пример проекта.srt');
