// Application shell: page routing, song select, settings and the frame loop.
//
// The menus are ordinary pages — a header with tabs, and one section visible at
// a time. The canvas is only shown while a song is running, so nothing is being
// drawn behind the menus.

import { AudioEngine } from './audio.js';
import { Renderer } from './renderer.js';
import { InputManager } from './input.js';
import { Game } from './game.js';
import { catalogue, loadSong, playable } from './songs/index.js';
import { getChart } from './charts.js';
import { settings, commit, CHANNEL_NAMES } from './settings.js';
import {
  NOTE_COLORS, PLAIN_NOTE_HEX, LANE_COUNT, difficultyMeta, keyTable, keyLabel,
  GRADE_HEX, UI,
} from './theme.js';
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
}

// ------------------------------------------------------------ song select --

const SONGS = catalogue();
let songIndex = 0;
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
      colored: custom.notes.filter((n) => n.color).length,
      custom: true,
    });
  }
  return list;
}

const currentEntry = () => SONGS[songIndex];
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
  list.replaceChildren();
  SONGS.forEach((s, i) => {
    const li = document.createElement('li');
    li.className = 'song' + (i === songIndex ? ' is-current' : '');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(i === songIndex));

    const main = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'song-title';
    title.textContent = s.title;
    const sub = document.createElement('div');
    sub.className = 'song-sub';
    sub.textContent = `${s.unit} · ${s.bpm} BPM · ${fmtTime(s.duration)}`;
    main.append(title, sub);

    const badges = document.createElement('div');
    badges.className = 'badges';
    for (const d of difficultiesOf(s)) badges.append(badge(d));

    li.append(main, badges);
    li.addEventListener('click', () => selectSong(i));
    list.append(li);
  });
}

function renderDetail() {
  const s = currentEntry();
  const diffs = difficultiesOf(s);
  diffIndex = clamp(diffIndex, 0, diffs.length - 1);
  const d = diffs[diffIndex];

  $('d-unit').textContent = s.unit;
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
  $('d-colored').textContent = d.colored;

  const rec = best[bestKey(s.id, d.id)];
  $('d-best').textContent = rec
    ? `${rec.grade} · ${fmtScore(rec.score)} · ${rec.accuracy.toFixed(2)}%`
    : 'Not played yet';
}

function selectSong(i) {
  if (i === songIndex) return;
  songIndex = clamp(i, 0, SONGS.length - 1);
  renderSongList();
  renderDetail();
  blip('move');
  const el = document.querySelectorAll('.song')[songIndex];
  if (el) el.scrollIntoView({ block: 'nearest' });
}

// --------------------------------------------------------------- settings --

const CONTROLS = [
  ['set-speed', 'out-speed', 'speed', (v) => `${v.toFixed(1)}×`, parseFloat],
  ['set-offset', 'out-offset', 'offsetMs', (v) => `${v > 0 ? '+' : ''}${v} ms`, parseInt],
  ['set-volume', 'out-volume', 'volume', (v) => `${Math.round(v * 100)}%`, parseFloat],
  ['set-hit', 'out-hit', 'hitSound', (v) => `${Math.round(v * 100)}%`, parseFloat],
  ['set-effects', 'out-effects', 'effects', (v) => `${Math.round(v * 100)}%`, parseFloat],
];

const TOGGLES = [['set-colors', 'colorNotes'], ['set-auto', 'autoplay']];

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
 * always shows the live key bindings and note colours.
 */
function renderLegend() {
  const list = $('legend');
  const codes = keyTable(settings).map(keyLabel);
  list.replaceChildren();

  const row = (hex, keys, name, rim) => {
    const li = document.createElement('li');
    const sw = document.createElement('span');
    sw.className = 'swatch';
    const bar = document.createElement('i');
    bar.style.setProperty('--c', hex);
    if (rim) bar.style.setProperty('--rim', '0 0 0 1.5px #fff');
    sw.append(bar);
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

  row(PLAIN_NOTE_HEX, codes.slice(0, LANE_COUNT), 'Lane notes', false);
  NOTE_COLORS.forEach((c, i) => {
    row(settings.colorHex[c.id] || c.hex, [codes[LANE_COUNT + i]], c.label, true);
  });
}

function renderColorGrid() {
  const grid = $('colorgrid');
  grid.replaceChildren();
  for (const c of NOTE_COLORS) {
    const wrap = document.createElement('label');
    wrap.className = 'bind';
    const small = document.createElement('small');
    small.textContent = c.label;
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.value = settings.colorHex[c.id] || c.hex;
    inp.addEventListener('input', () => {
      settings.colorHex[c.id] = inp.value;
      commit();
      renderer.refreshColors();
      renderLegend();
    });
    wrap.append(small, inp);
    grid.append(wrap);
  }
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

  $('btn-reset-colors').addEventListener('click', () => {
    settings.colorHex = {};
    commit();
    renderer.refreshColors();
    renderColorGrid();
    renderLegend();
  });

  renderKeyGrid();
  renderColorGrid();
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
    case 'ArrowDown': ev.preventDefault(); selectSong(songIndex + 1); break;
    case 'ArrowUp': ev.preventDefault(); selectSong(songIndex - 1); break;
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
    best[key] = { score: res.score, accuracy: res.accuracy, grade: res.grade };
    save('best.v1', best);
    if (!banner.textContent) banner.textContent = 'New best score';
  }

  showPage('page-result');
}

// ------------------------------------------------------------------ loop ---

let last = performance.now();

function frame(now) {
  const dt = clamp((now - last) / 1000, 0, 0.1);
  last = now;
  // Nothing is drawn between songs: the menus are plain pages and the canvas
  // is hidden, so the loop idles rather than painting a background nobody sees.
  if (game.started) {
    game.update(dt);
    renderer.draw(game, dt);
  }
  requestAnimationFrame(frame);
}

renderSongList();
renderDetail();
renderLegend();
initSettings();
applySettings();
requestAnimationFrame(frame);

// Debug handle: lets the console poke at a live run.
window.sosoph = { game, audio, renderer, input, settings, SONGS };
