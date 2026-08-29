// Application shell: page routing, song select, settings and the frame loop.
//
// The menus are ordinary pages — a header with tabs, and one section visible at
// a time. The canvas is only shown while a song is running, so nothing is being
// drawn behind the menus.

import { AudioEngine } from './audio.js';
import { Renderer } from './renderer.js';
import { InputManager } from './input.js';
import { Game } from './game.js';
import { Monitor } from './monitor.js';
import { catalogue, loadSong, playable } from './songs/index.js';
import { getChart } from './charts.js';
import { settings, commit, CHANNEL_NAMES } from './settings.js';
import {
  NOTE_KINDS, NOTE_LOOK, NOTE_STYLES, LANE_COUNT, FLICK, difficultyMeta,
  keyTable, keyLabel, GRADE_HEX, UI,
} from './theme.js';
import {
  DEFAULT_VIEW, SORTS, STATUSES, buildList, genresOf, difficultyOptions,
} from './library.js';
import { load, save } from './storage.js';
import { fmtScore, fmtTime, clamp } from './util.js';

const $ = (id) => document.getElementById(id);

// ----------------------------------------------------------------- setup ---

const canvas = $('stage');
const renderer = new Renderer(canvas, settings);
const audio = new AudioEngine();
const input = new InputManager(settings);
input.attach(canvas);
input.layout = renderer.layout;

const monitor = new Monitor($('monitor'));

let song = null;
const game = new Game({
  song: { notes: [], units: 0, sections: [], duration: 1, spb: 0.5 },
  audio, renderer, input, settings,
  onFinish: showResults,
});

window.addEventListener('resize', () => {
  renderer.resize();
  input.layout = renderer.layout;
});

let best = load('best.v1', {});
const bestKey = (songId, diff) => `${songId}/${diff}`;

// ---------------------------------------------------------------- routing --

/** Which menu page is showing. Empty while a song is running. */
let page = 'page-songs';

function showPage(id) {
  page = id;
  document.body.classList.remove('playing');
  $('overlay-pause').classList.remove('is-on');
  for (const el of document.querySelectorAll('.page')) {
    el.classList.toggle('is-on', el.id === id);
  }
  for (const el of document.querySelectorAll('.tab[data-page]')) {
    el.classList.toggle('is-on', el.dataset.page === id);
  }
  window.scrollTo(0, 0);
}

function enterPlay() {
  page = '';
  document.body.classList.add('playing');
  $('overlay-pause').classList.remove('is-on');
}

function setPaused(paused) {
  $('overlay-pause').classList.toggle('is-on', paused);
}

for (const tab of document.querySelectorAll('.tab[data-page]')) {
  tab.addEventListener('click', () => {
    blip('move');
    showPage(tab.dataset.page);
  });
}

async function blip(kind) {
  try {
    await audio.createContext();
    audio.ui(kind);
  } catch { /* autoplay policy — silence is fine */ }
}

function applySettings() {
  audio.setVolume(settings.volume);
  audio.hitSoundVolume = settings.hitSound;
  // A positive offset means "the audio is late", so shift the transport back.
  audio.userOffset = settings.offsetMs / 1000;
  input.rebind();
  renderer.refreshColors();
  monitor.setEnabled(settings.monitor);
}

// ------------------------------------------------------------ song select --

const SONGS = catalogue();
const view = load('view.v1', DEFAULT_VIEW);
/** The list as the filters currently leave it, flattened for keyboard nav. */
let visible = SONGS;
/** Selection is by id, so it survives the list being refiltered or resorted. */
let currentId = SONGS[0].id;
let diffIndex = 1;

/** Difficulty tabs for a song, with the editor's custom chart appended. */
function difficultiesOf(entry) {
  const list = entry.difficulties.map((d) => ({ ...d, custom: false }));
  const custom = getChart(entry.id);
  if (custom) {
    list.push({
      id: 'custom',
      level: custom.notes.length ? '★' : 0,
      notes: custom.notes.length,
      flicks: custom.notes.filter((n) => n.flick).length,
      custom: true,
    });
  }
  return list;
}

const currentEntry = () => SONGS.find((s) => s.id === currentId) || SONGS[0];
const currentDiff = () => {
  const list = difficultiesOf(currentEntry());
  return list[clamp(diffIndex, 0, list.length - 1)];
};

/** A solid coloured level chip, used in both the list and the difficulty row. */
function badge(diff) {
  const b = document.createElement('span');
  b.className = 'badge';
  b.style.setProperty('--c', difficultyMeta(diff.id).hex);
  b.textContent = diff.level;
  return b;
}

function renderSongList() {
  const list = $('song-list');
  const { shown, total, groups } = buildList(SONGS, view, best);
  visible = groups.flatMap((g) => g.songs);
  list.replaceChildren();

  for (const group of groups) {
    if (group.title) {
      const head = document.createElement('li');
      head.className = 'group-head';
      head.setAttribute('role', 'presentation');
      head.textContent = group.title;
      list.append(head);
    }
    for (const s of group.songs) {
      const on = s.id === currentId;
      const li = document.createElement('li');
      li.className = 'song' + (on ? ' is-current' : '');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(on));

      const main = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'song-title';
      title.textContent = s.title;
      const sub = document.createElement('div');
      sub.className = 'song-sub';
      sub.textContent = `${s.genre} · ${s.bpm} BPM · ${fmtTime(s.duration)}`;
      main.append(title, sub);

      const badges = document.createElement('div');
      badges.className = 'badges';
      for (const d of difficultiesOf(s)) badges.append(badge(d));

      li.append(main, badges);
      li.addEventListener('click', () => selectSong(s.id));
      list.append(li);
    }
  }

  $('f-empty').hidden = shown > 0;
  $('f-count').textContent = shown === total
    ? `${total} songs`
    : `${shown} of ${total} songs`;
  $('f-reset').hidden = !isFiltered();
}

function renderDetail() {
  const s = currentEntry();
  const diffs = difficultiesOf(s);
  diffIndex = clamp(diffIndex, 0, diffs.length - 1);
  const d = diffs[diffIndex];

  $('d-unit').textContent = s.genre;
  $('d-title').textContent = s.title;
  $('d-artist').textContent = s.artist;

  const tabs = $('d-diffs');
  tabs.replaceChildren();
  diffs.forEach((entry, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'diff' + (i === diffIndex ? ' is-on' : '');
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(i === diffIndex));
    b.append(badge(entry), document.createTextNode(difficultyMeta(entry.id).label));
    b.addEventListener('click', () => { diffIndex = i; renderDetail(); blip('move'); });
    tabs.append(b);
  });

  $('d-bpm').textContent = s.bpm;
  $('d-length').textContent = fmtTime(s.duration);
  $('d-notes').textContent = d.notes;
  $('d-flicks').textContent = d.flicks;

  const rec = best[bestKey(s.id, d.id)];
  $('d-best').textContent = rec
    ? `${rec.grade} · ${fmtScore(rec.score)} · ${rec.accuracy.toFixed(2)}%`
    : 'Not played yet';
}

function selectSong(id) {
  if (id === currentId || !id) return;
  currentId = id;
  renderSongList();
  renderDetail();
  blip('move');
  const i = visible.findIndex((s) => s.id === id);
  const el = document.querySelectorAll('.song')[i];
  if (el) el.scrollIntoView({ block: 'nearest' });
}

/** Step through the visible list, which is what the arrow keys act on. */
function stepSong(delta) {
  if (!visible.length) return;
  const i = visible.findIndex((s) => s.id === currentId);
  const next = clamp((i < 0 ? 0 : i) + delta, 0, visible.length - 1);
  selectSong(visible[next].id);
}

// --------------------------------------------------------------- filters ---

const isFiltered = () =>
  view.q !== '' || view.genre !== 'all' || view.difficulty !== 'any' || view.status !== 'all';

function option(value, label) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  return o;
}

function initFilters() {
  const genre = $('f-genre');
  genre.append(option('all', 'All genres'));
  for (const g of genresOf(SONGS)) genre.append(option(g, g));

  const diff = $('f-diff');
  diff.append(option('any', 'Any'));
  for (const d of difficultyOptions(SONGS)) diff.append(option(d.id, d.label));

  const status = $('f-status');
  for (const s of STATUSES) status.append(option(s.id, s.label));

  const sort = $('f-sort');
  for (const s of SORTS) sort.append(option(s.id, s.label));

  const bind = (id, key, parse = (v) => v) => {
    const el = $(id);
    el.value = view[key];
    el.addEventListener(el.type === 'search' ? 'input' : 'change', () => {
      view[key] = parse(el.value);
      commitView();
    });
  };
  bind('f-search', 'q');
  bind('f-genre', 'genre');
  bind('f-diff', 'difficulty');
  bind('f-status', 'status');
  bind('f-sort', 'sort');

  const group = $('f-group');
  group.checked = view.group;
  group.addEventListener('change', () => {
    view.group = group.checked;
    commitView();
  });

  $('f-dir').addEventListener('click', () => {
    view.dir = -view.dir;
    commitView();
  });

  $('f-reset').addEventListener('click', () => {
    Object.assign(view, { q: '', genre: 'all', difficulty: 'any', status: 'all' });
    syncFilterControls();
    commitView();
    blip('move');
  });

  syncFilterControls();
}

function syncFilterControls() {
  $('f-search').value = view.q;
  $('f-genre').value = view.genre;
  $('f-diff').value = view.difficulty;
  $('f-status').value = view.status;
  $('f-sort').value = view.sort;
  $('f-group').checked = view.group;
  $('f-dir').textContent = view.dir > 0 ? '↑' : '↓';
  $('f-dir').title = view.dir > 0 ? 'Ascending' : 'Descending';
}

function commitView() {
  save('view.v1', view);
  syncFilterControls();
  // Filtering the current song out of the list would leave the detail panel
  // showing something you can no longer see, so follow the list.
  renderSongList();
  if (visible.length && !visible.some((s) => s.id === currentId)) {
    currentId = visible[0].id;
    renderSongList();
  }
  // A difficulty filter is also a statement of intent: show that tier.
  if (view.difficulty !== 'any') {
    const i = difficultiesOf(currentEntry()).findIndex((d) => d.id === view.difficulty);
    if (i >= 0) diffIndex = i;
  }
  renderDetail();
}

// --------------------------------------------------------------- settings --

const CONTROLS = [
  ['set-speed', 'out-speed', 'speed', (v) => `${v.toFixed(1)}×`, parseFloat],
  ['set-offset', 'out-offset', 'offsetMs', (v) => `${v > 0 ? '+' : ''}${v} ms`, parseInt],
  ['set-volume', 'out-volume', 'volume', (v) => `${Math.round(v * 100)}%`, parseFloat],
  ['set-hit', 'out-hit', 'hitSound', (v) => `${Math.round(v * 100)}%`, parseFloat],
  ['set-effects', 'out-effects', 'effects', (v) => `${Math.round(v * 100)}%`, parseFloat],
];

const TOGGLES = [
  ['set-flicks', 'flickNotes'],
  ['set-auto', 'autoplay'],
  ['set-monitor', 'monitor'],
];

/** The key binding currently waiting for a keypress, if any. */
let listening = null;

function renderKeyGrid() {
  const grid = $('keygrid');
  const codes = keyTable(settings);
  grid.replaceChildren();
  CHANNEL_NAMES.forEach((chan, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bind' + (listening === i ? ' is-listening' : '');
    const small = document.createElement('small');
    small.textContent = chan.label;
    const strong = document.createElement('b');
    strong.textContent = listening === i ? 'Press…' : keyLabel(codes[i]);
    b.append(small, strong);
    b.addEventListener('click', () => {
      listening = listening === i ? null : i;
      renderKeyGrid();
    });
    grid.append(b);
  });
}

/**
 * The controls legend. Generated rather than written into the markup so it
 * always shows the live key bindings, colours and note shape.
 */
function renderLegend() {
  const list = $('legend');
  const codes = keyTable(settings).map(keyLabel);
  list.replaceChildren();

  const row = (kind, keys, name) => {
    const li = document.createElement('li');
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.append(noteSwatch(kind, 40, 20));
    const kb = document.createElement('span');
    kb.className = 'keys';
    for (const k of keys) {
      const el = document.createElement('kbd');
      el.textContent = k;
      kb.append(el);
    }
    const label = document.createElement('span');
    label.className = 'legend-name';
    label.textContent = name;
    li.append(sw, kb, label);
    list.append(li);
  };

  row('tap', codes.slice(0, LANE_COUNT), 'Tap — press the lane key');
  row('hold', codes.slice(0, LANE_COUNT), 'Hold — keep it down');
  row('flick', codes.slice(0, LANE_COUNT), 'Flick — press, then roll the way the arrow points');
  row('down', codes.slice(LANE_COUNT), 'A down-flick rolls onto this row');
}

/**
 * Draw one note as it will appear in play, on a scrap of the black field.
 * Shared by the controls legend and the settings preview, so what you see in
 * either is literally the sprite the game draws.
 */
function noteSwatch(kind, w, h) {
  const canvas = document.createElement('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#050506';
  ctx.fillRect(0, 0, w, h);

  const note =
    kind === 'hold' ? { lane: 0, play: FLICK.NONE, isHold: true }
    : kind === 'flick' ? { lane: 0, play: FLICK.RIGHT, isHold: false }
    : kind === 'down' ? { lane: 0, play: FLICK.DOWN, isHold: false }
    : { lane: 0, play: FLICK.NONE, isHold: false };

  const sprite = renderer.spriteFor(note);
  if (sprite) {
    const scale = Math.min(1, (w - 4) / sprite.w);
    ctx.drawImage(
      sprite.canvas,
      (w - sprite.w * scale) / 2,
      (h - sprite.h * scale) / 2,
      sprite.w * scale,
      sprite.h * scale
    );
  }
  return canvas;
}

/** Live preview of the three note kinds in the settings panel. */
function renderNotePreview() {
  const wrap = $('note-preview');
  wrap.replaceChildren();
  for (const kind of NOTE_KINDS) {
    const fig = document.createElement('figure');
    fig.append(noteSwatch(kind.id, 92, 34));
    const cap = document.createElement('figcaption');
    cap.textContent = kind.label;
    fig.append(cap);
    wrap.append(fig);
  }
}

function renderNoteColors() {
  const grid = $('notecolors');
  grid.replaceChildren();
  for (const kind of NOTE_KINDS) {
    const wrap = document.createElement('label');
    wrap.className = 'bind';
    const small = document.createElement('small');
    small.textContent = kind.label;
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.value = settings.noteHex[kind.id] || NOTE_LOOK[kind.id];
    inp.addEventListener('input', () => {
      settings.noteHex[kind.id] = inp.value;
      commit();
      refreshNoteLook();
    });
    wrap.append(small, inp);
    grid.append(wrap);
  }
}

/** Rebuild everything that draws a note after an appearance change. */
function refreshNoteLook() {
  renderer.refreshColors();
  renderNotePreview();
  renderLegend();
}

function initSettings() {
  for (const [inputId, outId, key, fmt, parse] of CONTROLS) {
    const el = $(inputId);
    const out = $(outId);
    el.value = settings[key];
    out.textContent = fmt(settings[key]);
    el.addEventListener('input', () => {
      settings[key] = parse(el.value);
      out.textContent = fmt(settings[key]);
      applySettings();
      commit();
    });
  }

  for (const [id, key] of TOGGLES) {
    const el = $(id);
    el.checked = settings[key];
    el.addEventListener('change', () => {
      settings[key] = el.checked;
      commit();
      if (key === 'monitor') monitor.setEnabled(el.checked);
      blip('move');
    });
  }

  $('btn-reset-keys').addEventListener('click', () => {
    settings.keys = {};
    commit();
    applySettings();
    renderKeyGrid();
    renderLegend();
  });

  const style = $('set-style');
  for (const st of NOTE_STYLES) {
    const o = document.createElement('option');
    o.value = st.id;
    o.textContent = st.label;
    style.append(o);
  }
  style.value = settings.noteStyle;
  style.addEventListener('change', () => {
    settings.noteStyle = style.value;
    commit();
    refreshNoteLook();
  });

  const scale = $('set-scale');
  const scaleOut = $('out-scale');
  scale.value = settings.noteScale;
  scaleOut.textContent = `${settings.noteScale.toFixed(2)}×`;
  scale.addEventListener('input', () => {
    settings.noteScale = parseFloat(scale.value);
    scaleOut.textContent = `${settings.noteScale.toFixed(2)}×`;
    commit();
    refreshNoteLook();
  });

  $('btn-reset-notes').addEventListener('click', () => {
    settings.noteHex = {};
    settings.noteStyle = 'bar';
    settings.noteScale = 1;
    commit();
    style.value = settings.noteStyle;
    scale.value = settings.noteScale;
    scaleOut.textContent = '1.00×';
    renderNoteColors();
    refreshNoteLook();
  });

  renderKeyGrid();
  renderNoteColors();
  renderNotePreview();
}

/** Capture the next keypress for the binding being edited. */
window.addEventListener('keydown', (ev) => {
  if (listening === null || page !== 'page-settings') return;
  ev.preventDefault();
  ev.stopPropagation();
  if (ev.code !== 'Escape') {
    const codes = keyTable(settings);
    const taken = codes.findIndex((c, i) => c === ev.code && i !== listening);
    settings.keys[CHANNEL_NAMES[listening].id] = ev.code;
    // If another channel already owned that key, the two swap rather than one
    // silently ending up unbound.
    if (taken >= 0) settings.keys[CHANNEL_NAMES[taken].id] = codes[listening];
    commit();
    applySettings();
  }
  listening = null;
  renderKeyGrid();
  renderLegend();
}, true);

// ------------------------------------------------------------------ flow ---

async function startGame() {
  // A focused button would otherwise swallow the gameplay keys.
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();

  const entry = currentEntry();
  const diff = currentDiff();
  song = diff.custom
    ? playable(entry.id, 'custom', getChart(entry.id).notes, 'Custom')
    : loadSong(entry.id, diff.id);

  game.song = song;
  enterPlay();
  await game.start();
}

async function leaveGame() {
  await game.quit();
  renderer.judgeFx.show = false;
  game.particles.clear();
}

function backToSongs() {
  renderSongList();
  renderDetail();
  showPage('page-songs');
}

$('btn-play').addEventListener('click', async () => {
  await blip('confirm');
  await startGame();
});

$('btn-resume').addEventListener('click', async () => {
  await blip('confirm');
  setPaused(false);
  await game.togglePause();
});

$('btn-restart').addEventListener('click', async () => {
  await blip('confirm');
  await leaveGame();
  await startGame();
});

$('btn-quit').addEventListener('click', async () => {
  await blip('move');
  await leaveGame();
  backToSongs();
});

$('btn-retry').addEventListener('click', async () => {
  await blip('confirm');
  await leaveGame();
  await startGame();
});

$('btn-back').addEventListener('click', async () => {
  await blip('move');
  await leaveGame();
  backToSongs();
});

async function requestPause() {
  if (!game.started || game.finished) return;
  const paused = await game.togglePause();
  setPaused(paused);
}

input.onPause = requestPause;

// F3 toggles the monitor anywhere, including mid-song.
window.addEventListener('keydown', (ev) => {
  if (ev.code !== 'F3') return;
  ev.preventDefault();
  settings.monitor = monitor.toggle();
  commit();
  const box = $('set-monitor');
  if (box) box.checked = settings.monitor;
});

// Song-list keyboard navigation, and Escape to leave settings.
window.addEventListener('keydown', (ev) => {
  if (page === 'page-settings') {
    if (ev.code === 'Escape') { listening = null; renderKeyGrid(); showPage('page-songs'); }
    return;
  }
  if (page !== 'page-songs') return;
  const tag = ev.target && ev.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

  switch (ev.code) {
    case 'ArrowDown': ev.preventDefault(); stepSong(1); break;
    case 'ArrowUp': ev.preventDefault(); stepSong(-1); break;
    case 'ArrowRight': ev.preventDefault(); stepDiff(1); break;
    case 'ArrowLeft': ev.preventDefault(); stepDiff(-1); break;
    case 'Enter':
    case 'Space': ev.preventDefault(); blip('confirm').then(startGame); break;
    default: break;
  }
});

function stepDiff(dir) {
  const list = difficultiesOf(currentEntry());
  const next = clamp(diffIndex + dir, 0, list.length - 1);
  if (next === diffIndex) return;
  diffIndex = next;
  renderDetail();
  blip('move');
}

// Losing focus mid-song would otherwise mean guaranteed misses.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.started && !game.paused && !game.finished) requestPause();
});

// --------------------------------------------------------------- results ---

function showResults(res) {
  audio.stop();

  $('res-song').textContent = `${song.title} — ${difficultyMeta(song.difficulty).label}`;
  $('res-grade').textContent = res.grade;
  $('res-score').textContent = fmtScore(res.score);
  $('res-acc').textContent = `${res.accuracy.toFixed(2)}% accuracy`;
  $('res-perfect').textContent = res.counts.PERFECT;
  $('res-great').textContent = res.counts.GREAT;
  $('res-good').textContent = res.counts.GOOD;
  $('res-miss').textContent = res.counts.MISS;
  $('res-combo').textContent = `${res.maxCombo}x`;

  document.querySelector('.result-head').style.setProperty('--grade', GRADE_HEX[res.grade] || UI.ink);

  const banner = $('res-banner');
  banner.textContent = res.autoplay
    ? 'Autoplay — not recorded'
    : res.allPerfect ? 'All Perfect'
    : res.fullCombo ? 'Full Combo'
    : '';

  const key = bestKey(res.songId, res.difficulty);
  if (!res.autoplay && (!best[key] || res.score > best[key].score)) {
    best[key] = {
      score: res.score, accuracy: res.accuracy, grade: res.grade,
      fc: res.fullCombo, ap: res.allPerfect,
    };
    save('best.v1', best);
    if (!banner.textContent) banner.textContent = 'New best score';
  }

  showPage('page-result');
}

// ------------------------------------------------------------------ loop ---

let last = performance.now();

function frame(now) {
  const dtMs = now - last;
  const dt = clamp(dtMs / 1000, 0, 0.1);
  last = now;
  monitor.frame(dtMs);
  // Nothing is drawn between songs: the menus are plain pages and the canvas
  // is hidden, so the loop idles rather than painting a background nobody sees.
  if (game.started) {
    game.update(dt);
    renderer.draw(game, dt);
  }
  monitor.update(now, { game, audio, renderer });
  requestAnimationFrame(frame);
}

initFilters();
renderSongList();
renderDetail();
renderLegend();
initSettings();
applySettings();
requestAnimationFrame(frame);

// Debug handle: lets the console poke at a live run.
window.sosoph = { game, audio, renderer, input, settings, SONGS };
