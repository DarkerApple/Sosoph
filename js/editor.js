// Chart editor.
//
// Notes are placed against the same beat grid the songs are written on, and the
// music can be played from any point so a phrase can be checked without
// replaying the whole song. Charts are saved per song and appear in the game's
// song list as a CUSTOM difficulty.

import { AudioEngine } from './audio.js';
import { songDef, chartFor, SONG_ORDER } from './songs/index.js';
import { getChart, putChart, deleteChart } from './charts.js';
import { settings } from './settings.js';
import {
  LANE_COUNT, NOTE_COLORS, PLAIN, noteRgbTable, keyTable, keyLabel, difficultyMeta,
} from './theme.js';
import { clamp, roundRect, rgba, fmtTime, shade } from './util.js';

const $ = (id) => document.getElementById(id);
const FONT = `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;

const canvas = $('ed-canvas');
const ctx = canvas.getContext('2d');
const audio = new AudioEngine();

// ----------------------------------------------------------------- state ---

const state = {
  songId: SONG_ORDER[0].id,
  def: null,
  notes: [],
  color: PLAIN,
  snap: 4,
  zoom: 260, // pixels per second
  view: 0, // song time at the playhead line
  playing: false,
  selected: null,
  drag: null,
  hover: null,
  guide: true,
  dirty: false,
};

const undoStack = [];
const redoStack = [];

let noteRgb = noteRgbTable(settings);
let keyCaps = keyTable(settings).map(keyLabel);

const cloneNotes = (notes) => notes.map((n) => ({ ...n }));

function pushUndo() {
  undoStack.push(cloneNotes(state.notes));
  if (undoStack.length > 120) undoStack.shift();
  redoStack.length = 0;
  state.dirty = true;
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(cloneNotes(state.notes));
  state.notes = undoStack.pop();
  state.selected = null;
  state.dirty = true;
  refreshStats();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(cloneNotes(state.notes));
  state.notes = redoStack.pop();
  state.selected = null;
  state.dirty = true;
  refreshStats();
}

// ----------------------------------------------------------------- layout --

const layout = { w: 0, h: 0, left: 0, laneW: 0, playY: 0, fieldW: 0 };

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  layout.w = rect.width;
  layout.h = rect.height;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const fieldW = clamp(Math.min(rect.width - 180, 520), 200, 520);
  layout.fieldW = fieldW;
  layout.laneW = fieldW / LANE_COUNT;
  layout.left = (rect.width - fieldW) / 2;
  layout.playY = rect.height - 74;
}

const yFor = (t) => layout.playY - (t - state.view) * state.zoom;
const timeAt = (y) => state.view + (layout.playY - y) / state.zoom;
const laneAt = (x) => Math.floor((x - layout.left) / layout.laneW);

/** Snap a time to the song's beat grid at the current division. */
function snapTime(t) {
  if (!state.snap) return Math.max(0, t);
  const step = state.def.spb / state.snap;
  return Math.max(0, Math.round(t / step) * step);
}

// ------------------------------------------------------------------ song ---

function loadSong(id, seed = 'keep') {
  state.songId = id;
  state.def = songDef(id);
  state.view = 0;
  state.selected = null;
  undoStack.length = 0;
  redoStack.length = 0;

  if (seed === 'empty') state.notes = [];
  else if (seed === 'custom') state.notes = cloneNotes(getChart(id)?.notes || []);
  else if (seed === 'keep') {
    const saved = getChart(id);
    state.notes = saved ? cloneNotes(saved.notes) : cloneNotes(chartFor(id, 'normal').notes);
  } else {
    state.notes = chartFor(id, seed).notes.map((n) => ({ t: n.t, lane: n.lane, dur: n.dur, color: n.color }));
  }
  state.notes = state.notes.map((n) => ({ t: n.t, lane: n.lane, dur: n.dur || 0, color: n.color || 0 }));
  sortNotes();
  state.dirty = false;
  buildSeedOptions();
  refreshStats();
  setStatus(`${state.def.title} — ${state.notes.length} notes`);
}

const sortNotes = () => state.notes.sort((a, b) => a.t - b.t || a.lane - b.lane);

// ------------------------------------------------------------------ edit ---

/** The note under a point, if any. Holds count along their whole body. */
function noteAt(x, y) {
  const lane = laneAt(x);
  if (lane < 0 || lane >= LANE_COUNT) return null;
  const t = timeAt(y);
  let best = null;
  let bestD = Infinity;
  const grace = 12 / state.zoom;
  for (const n of state.notes) {
    if (n.lane !== lane) continue;
    const inBody = t >= n.t - grace && t <= n.t + n.dur + grace;
    if (!inBody) continue;
    const d = Math.abs(t - n.t);
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

function addNote(lane, t, color) {
  const note = { t: snapTime(t), lane, dur: 0, color };
  // Replacing rather than stacking keeps a lane from collecting invisible
  // duplicates when you click the same slot twice.
  const dup = state.notes.find((n) => n.lane === lane && Math.abs(n.t - note.t) < 1e-3);
  if (dup) {
    dup.color = color;
    return dup;
  }
  state.notes.push(note);
  sortNotes();
  return note;
}

function removeNote(note) {
  const i = state.notes.indexOf(note);
  if (i >= 0) state.notes.splice(i, 1);
  if (state.selected === note) state.selected = null;
}

// --------------------------------------------------------------- pointer ---

canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

canvas.addEventListener('pointerdown', (ev) => {
  canvas.setPointerCapture(ev.pointerId);
  const rect = canvas.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  const y = ev.clientY - rect.top;
  const lane = laneAt(x);

  if (ev.button === 2) {
    const hit = noteAt(x, y);
    if (hit) { pushUndo(); removeNote(hit); refreshStats(); }
    return;
  }
  if (ev.button !== 0) return;
  if (lane < 0 || lane >= LANE_COUNT) return;

  const hit = noteAt(x, y);
  pushUndo();
  if (hit) {
    // Grabbing an existing note re-drags its tail rather than stacking a new
    // note on top of it.
    state.selected = hit;
    state.drag = { note: hit, mode: 'tail', startY: y };
  } else {
    const note = addNote(lane, timeAt(y), state.color);
    state.selected = note;
    state.drag = { note, mode: 'tail', startY: y };
  }
  refreshStats();
});

canvas.addEventListener('pointermove', (ev) => {
  const rect = canvas.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  const y = ev.clientY - rect.top;
  state.hover = { x, y, lane: laneAt(x), t: snapTime(timeAt(y)) };

  if (!state.drag) return;
  // A plain click on an existing note must not wipe its hold length, so the
  // tail only follows the pointer once it has genuinely moved.
  if (Math.abs(y - state.drag.startY) < 5) return;
  const note = state.drag.note;
  // Dragging up from the head stretches a hold; dragging back down clears it.
  const end = snapTime(timeAt(y));
  note.dur = Math.max(0, end - note.t);
  if (note.dur < state.def.spb * 0.24) note.dur = 0;
  refreshStats();
});

const endDrag = () => { state.drag = null; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('pointerleave', () => { state.hover = null; });

canvas.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  if (ev.ctrlKey || ev.metaKey) {
    state.zoom = clamp(state.zoom * (ev.deltaY > 0 ? 0.9 : 1.11), 90, 620);
    $('ed-zoom').value = Math.round(state.zoom);
  } else {
    scrollTo(state.view + (ev.deltaY / state.zoom) * 0.9);
  }
}, { passive: false });

function scrollTo(t) {
  state.view = clamp(t, 0, state.def.duration);
  $('ed-seek').value = Math.round((state.view / state.def.duration) * 1000);
  $('ed-time').textContent = fmtTime(state.view);
}

// ------------------------------------------------------------- transport ---

async function togglePlay() {
  if (state.playing) {
    state.playing = false;
    await audio.stop();
    $('ed-play').textContent = 'Play';
    $('ed-play').classList.remove('is-on');
    return;
  }
  state.playing = true;
  $('ed-play').textContent = 'Stop';
  $('ed-play').classList.add('is-on');
  audio.setVolume(settings.volume);
  await audio.start(state.def, 0.35, state.view);
}

// ------------------------------------------------------------------- draw --

function draw() {
  const { w, h, left, laneW, playY, fieldW } = layout;

  if (state.playing) {
    const t = audio.update(performance.now());
    if (t >= state.def.duration) togglePlay();
    else scrollTo(Math.max(0, t));
  }

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0e1426';
  ctx.fillRect(0, 0, w, h);

  const t0 = timeAt(h);
  const t1 = timeAt(-20);

  // --- grid ---------------------------------------------------------------
  const spb = state.def.spb;
  const div = state.snap || 4;
  const step = spb / div;
  const first = Math.max(0, Math.floor(t0 / step));
  ctx.save();
  for (let i = first; i * step <= t1; i++) {
    const t = i * step;
    const y = yFor(t);
    if (y < -20 || y > h) continue;
    const beat = t / spb;
    const onBar = Math.abs(beat % 4) < 1e-6;
    const onBeat = Math.abs(beat % 1) < 1e-6;
    ctx.fillStyle = onBar
      ? 'rgba(150,190,255,0.42)'
      : onBeat ? 'rgba(150,190,255,0.2)' : 'rgba(150,190,255,0.08)';
    ctx.fillRect(left, y, fieldW, onBar ? 1.6 : 1);
    if (onBar) {
      ctx.fillStyle = 'rgba(160,195,255,0.5)';
      ctx.font = `700 10px ${FONT}`;
      ctx.textAlign = 'right';
      ctx.fillText(String(Math.round(beat / 4) + 1), left - 10, y - 3);
    }
  }
  ctx.restore();

  // --- lanes --------------------------------------------------------------
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  ctx.fillRect(left, 0, fieldW, h);
  for (let i = 0; i <= LANE_COUNT; i++) {
    ctx.fillStyle = i === 0 || i === LANE_COUNT ? 'rgba(160,200,255,0.4)' : 'rgba(160,200,255,0.18)';
    ctx.fillRect(left + i * laneW - 0.5, 0, 1, h);
  }

  // --- music guide --------------------------------------------------------
  // A tick for every moment the song actually plays something, so notes can be
  // placed against the music rather than against the grid alone.
  if (state.guide) {
    const right = left - 34;
    ctx.save();
    for (const hit of state.def.hits) {
      const t = hit.beat * spb;
      if (t < t0 || t > t1) continue;
      const y = yFor(t);
      const len = 5 + hit.weight * 18;
      ctx.fillStyle = `rgba(120,220,255,${0.14 + hit.weight * 0.5})`;
      ctx.fillRect(right - len, y - 0.5, len, 1.6);
    }
    ctx.restore();
  }

  // Section names on the right, so it is obvious which part of the song the
  // playhead is sitting in.
  ctx.save();
  ctx.textAlign = 'left';
  ctx.font = `700 9px ${FONT}`;
  for (const sec of state.def.sections) {
    if (sec.start < t0 || sec.start > t1) continue;
    const y = yFor(sec.start);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(left + fieldW + 10, y - 0.5, 46, 1);
    ctx.fillStyle = 'rgba(190,215,255,0.6)';
    ctx.fillText(sec.name.toUpperCase(), left + fieldW + 10, y - 5);
  }
  ctx.restore();

  // --- hold bodies --------------------------------------------------------
  for (const n of state.notes) {
    if (!n.dur) continue;
    const yTop = yFor(n.t + n.dur);
    const yBot = yFor(n.t);
    if (yBot < -20 || yTop > h) continue;
    const cx = left + n.lane * laneW + laneW / 2;
    const col = noteRgb[n.color];
    ctx.fillStyle = rgba(col, 0.34);
    roundRect(ctx, cx - laneW * 0.18, yTop, laneW * 0.36, yBot - yTop, laneW * 0.18);
    ctx.fill();
  }

  // --- notes --------------------------------------------------------------
  for (const n of state.notes) {
    const y = yFor(n.t);
    if (y < -24 || y > h + 24) continue;
    drawNote(n, y);
  }

  // --- hover ghost --------------------------------------------------------
  if (state.hover && state.hover.lane >= 0 && state.hover.lane < LANE_COUNT && !state.drag) {
    const cx = left + state.hover.lane * laneW + laneW / 2;
    const y = yFor(state.hover.t);
    ctx.save();
    ctx.globalAlpha = 0.34;
    drawNoteShape(cx, y, noteRgb[state.color], state.color !== PLAIN);
    ctx.restore();
  }

  // --- playhead -----------------------------------------------------------
  ctx.fillStyle = 'rgba(255,120,170,0.9)';
  ctx.fillRect(left - 10, playY - 1, fieldW + 20, 2);
  ctx.fillStyle = 'rgba(255,120,170,0.9)';
  ctx.font = `700 10px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.fillText(fmtTime(state.view), left - 10, playY + 14);

  // --- key caps -----------------------------------------------------------
  ctx.textAlign = 'center';
  for (let i = 0; i < LANE_COUNT; i++) {
    const cx = left + i * laneW + laneW / 2;
    ctx.font = `700 12px ${FONT}`;
    ctx.fillStyle = 'rgba(226,238,255,0.7)';
    ctx.fillText(keyCaps[i], cx, playY + 26);
    ctx.font = `700 11px ${FONT}`;
    ctx.fillStyle = rgba(noteRgb[i + 1], 0.85);
    ctx.fillText(keyCaps[LANE_COUNT + i], cx, playY + 44);
  }

  requestAnimationFrame(draw);
}

function drawNote(n, y) {
  const cx = layout.left + n.lane * layout.laneW + layout.laneW / 2;
  drawNoteShape(cx, y, noteRgb[n.color], n.color !== PLAIN);
  if (n === state.selected) {
    const w = layout.laneW * 0.8;
    ctx.strokeStyle = '#ff78aa';
    ctx.lineWidth = 2;
    roundRect(ctx, cx - w / 2 - 3, y - 11, w + 6, 22, 8);
    ctx.stroke();
  }
}

function drawNoteShape(cx, y, col, colored) {
  const w = layout.laneW * 0.8;
  const h = 15;
  const grad = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
  grad.addColorStop(0, rgba(shade(col, 1.35), 1));
  grad.addColorStop(1, rgba(shade(col, 0.6), 1));
  ctx.fillStyle = grad;
  roundRect(ctx, cx - w / 2, y - h / 2, w, h, h / 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = colored ? 2 : 1.3;
  roundRect(ctx, cx - w / 2, y - h / 2, w, h, h / 2);
  ctx.stroke();
  if (colored) {
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 4, y - 2);
    ctx.lineTo(cx, y + 2.5);
    ctx.lineTo(cx + 4, y - 2);
    ctx.stroke();
  }
}

// --------------------------------------------------------------- controls ---

function buildSongOptions() {
  const sel = $('ed-song');
  sel.replaceChildren();
  for (const { id } of SONG_ORDER) {
    const def = songDef(id);
    const o = document.createElement('option');
    o.value = id;
    o.textContent = `${def.title} · ${def.bpm} BPM`;
    sel.append(o);
  }
  sel.value = state.songId;
}

function buildSeedOptions() {
  const sel = $('ed-seed');
  const entry = SONG_ORDER.find((s) => s.id === state.songId);
  sel.replaceChildren();
  const add = (value, label) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    sel.append(o);
  };
  add('keep', getChart(state.songId) ? 'Saved chart' : 'Generated NORMAL');
  if (getChart(state.songId)) add('custom', 'Saved chart');
  for (const d of entry.difficulties) add(d, `Generated ${difficultyMeta(d).label}`);
  add('empty', 'Empty');
  sel.value = 'keep';
}

function buildPalette() {
  const grid = $('ed-palette');
  grid.replaceChildren();
  const entries = [{ id: 'plain', label: 'PLAIN', hex: null }, ...NOTE_COLORS];
  entries.forEach((c, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch' + (state.color === i ? ' is-on' : '');
    b.style.setProperty('--c', `rgb(${noteRgb[i].join(',')})`);
    b.textContent = i === 0 ? '·' : keyCaps[LANE_COUNT + i - 1];
    b.title = `${c.label} — press ${i + 1}`;
    b.addEventListener('click', () => { state.color = i; buildPalette(); });
    grid.append(b);
  });
}

function refreshStats() {
  $('ed-count').textContent = state.notes.length;
  $('ed-holds').textContent = state.notes.filter((n) => n.dur > 0).length;
  $('ed-colored').textContent = state.notes.filter((n) => n.color).length;
}

let statusTimer = 0;
function setStatus(msg, kind = '') {
  const el = $('ed-status');
  el.textContent = msg;
  el.className = `ed-status ${kind}`;
  clearTimeout(statusTimer);
  if (kind) {
    statusTimer = setTimeout(() => {
      el.className = 'ed-status';
      el.textContent = state.dirty ? 'Unsaved changes.' : 'Saved.';
    }, 2600);
  }
}

$('ed-song').addEventListener('change', (ev) => loadSong(ev.target.value, 'keep'));
$('ed-seed').addEventListener('change', (ev) => {
  pushUndo();
  loadSong(state.songId, ev.target.value);
});
$('ed-snap').addEventListener('change', (ev) => { state.snap = Number(ev.target.value); });
$('ed-zoom').addEventListener('input', (ev) => { state.zoom = Number(ev.target.value); });
$('ed-seek').addEventListener('input', (ev) => {
  if (state.playing) togglePlay();
  scrollTo((Number(ev.target.value) / 1000) * state.def.duration);
});
$('ed-guide').addEventListener('change', (ev) => { state.guide = ev.target.checked; });
$('ed-play').addEventListener('click', togglePlay);
$('ed-home').addEventListener('click', () => { if (state.playing) togglePlay(); scrollTo(0); });
$('ed-undo').addEventListener('click', undo);
$('ed-redo').addEventListener('click', redo);

$('ed-save').addEventListener('click', () => {
  sortNotes();
  const ok = putChart(state.songId, state.notes);
  state.dirty = !ok;
  buildSeedOptions();
  setStatus(
    ok ? `Saved ${state.notes.length} notes — pick CUSTOM in the song list.` : 'Could not save (storage blocked).',
    ok ? 'ok' : 'warn'
  );
});

$('ed-clear').addEventListener('click', () => {
  pushUndo();
  state.notes = [];
  deleteChart(state.songId);
  buildSeedOptions();
  refreshStats();
  setStatus('Chart cleared and the saved copy removed.', 'warn');
});

// --- import / export --------------------------------------------------------

const dialog = $('ed-io');

$('ed-export').addEventListener('click', () => {
  $('ed-io-title').textContent = 'Export — copy this JSON';
  $('ed-io-text').value = JSON.stringify(
    { song: state.songId, notes: state.notes.map((n) => ({ t: +n.t.toFixed(4), lane: n.lane, dur: +n.dur.toFixed(4), color: n.color })) },
    null,
    1
  );
  $('ed-io-apply').hidden = true;
  dialog.showModal();
});

$('ed-import').addEventListener('click', () => {
  $('ed-io-title').textContent = 'Import — paste chart JSON';
  $('ed-io-text').value = '';
  $('ed-io-apply').hidden = false;
  dialog.showModal();
});

$('ed-io-close').addEventListener('click', () => dialog.close());

$('ed-io-apply').addEventListener('click', () => {
  try {
    const data = JSON.parse($('ed-io-text').value);
    const notes = (data.notes || data).map((n) => ({
      t: Number(n.t) || 0,
      lane: clamp(Math.round(Number(n.lane) || 0), 0, LANE_COUNT - 1),
      dur: Math.max(0, Number(n.dur) || 0),
      color: clamp(Math.round(Number(n.color) || 0), 0, NOTE_COLORS.length),
    }));
    if (!notes.length) throw new Error('no notes');
    pushUndo();
    if (data.song && data.song !== state.songId && SONG_ORDER.some((s) => s.id === data.song)) {
      loadSong(data.song, 'empty');
      $('ed-song').value = data.song;
    }
    state.notes = notes;
    sortNotes();
    refreshStats();
    dialog.close();
    setStatus(`Imported ${notes.length} notes.`, 'ok');
  } catch (err) {
    setStatus(`Import failed: ${err.message}`, 'warn');
  }
});

// ---------------------------------------------------------------- keyboard --

window.addEventListener('keydown', (ev) => {
  const tag = ev.target && ev.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

  if ((ev.ctrlKey || ev.metaKey) && ev.code === 'KeyZ') {
    ev.preventDefault();
    ev.shiftKey ? redo() : undo();
    return;
  }
  if ((ev.ctrlKey || ev.metaKey) && ev.code === 'KeyS') {
    ev.preventDefault();
    $('ed-save').click();
    return;
  }
  if (ev.code.startsWith('Digit')) {
    const n = Number(ev.code.slice(5));
    if (n >= 1 && n <= NOTE_COLORS.length + 1) {
      state.color = n - 1;
      buildPalette();
      // Retint the selected note too, which is how most editors behave.
      if (state.selected) { pushUndo(); state.selected.color = state.color; refreshStats(); }
    }
    return;
  }
  switch (ev.code) {
    case 'Space':
      ev.preventDefault();
      togglePlay();
      break;
    case 'Delete':
    case 'Backspace':
      if (state.selected) { pushUndo(); removeNote(state.selected); refreshStats(); }
      break;
    case 'Home':
      if (state.playing) togglePlay();
      scrollTo(0);
      break;
    case 'ArrowUp':
      ev.preventDefault();
      scrollTo(state.view + state.def.spb / (state.snap || 4));
      break;
    case 'ArrowDown':
      ev.preventDefault();
      scrollTo(state.view - state.def.spb / (state.snap || 4));
      break;
    default:
      break;
  }
});

window.addEventListener('beforeunload', (ev) => {
  if (!state.dirty) return;
  ev.preventDefault();
  ev.returnValue = '';
});

// ------------------------------------------------------------------- boot ---

window.addEventListener('resize', resize);

state.def = songDef(state.songId);
buildSongOptions();
loadSong(state.songId, 'keep');
buildPalette();
resize();
$('ed-zoom').value = state.zoom;
requestAnimationFrame(draw);

window.sosophEditor = { state, audio };
