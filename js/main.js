// Application shell: song select, settings, screen routing and the frame loop.

import { AudioEngine } from './audio.js';
import { Renderer } from './renderer.js';
import { InputManager } from './input.js';
import { Game } from './game.js';
import { catalogue, loadSong, playable } from './songs/index.js';
import { getChart } from './charts.js';
import { settings, commit, CHANNEL_NAMES } from './settings.js';
import {
  NOTE_COLORS, difficultyMeta, keyTable, keyLabel, GRADE_HEX, UI,
} from './theme.js';
import { load, save } from './storage.js';
import { fmtScore, fmtTime, clamp } from './util.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- setup ---

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

// -------------------------------------------------------------- screens ---

let current = 'screen-select';

function show(id) {
  current = id;
  for (const el of document.querySelectorAll('.screen')) {
    el.classList.toggle('is-active', el.id === id);
  }
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

// ---------------------------------------------------------- song select ---

const SONGS = catalogue();
let songIndex = 0;
let diffIndex = 1;

/** Difficulty tabs for a song, with the editor's custom chart appended. */
function difficultiesOf(entry) {
  const list = entry.difficulties.map((d) => ({ ...d, custom: false }));
  const custom = getChart(entry.id);
  if (custom) {
    list.push({ id: 'custom', level: 0, notes: custom.notes.length, custom: true,
      colored: custom.notes.filter((n) => n.color).length });
  }
  return list;
}

function currentEntry() { return SONGS[songIndex]; }
function currentDiff() {
  const list = difficultiesOf(currentEntry());
  return list[clamp(diffIndex, 0, list.length - 1)];
}

function renderSongList() {
  const list = $('song-list');
  list.replaceChildren();
  SONGS.forEach((s, i) => {
    const li = document.createElement('li');
    li.className = 'song' + (i === songIndex ? ' is-current' : '');
    li.style.setProperty('--accent', s.accent);
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(i === songIndex));

    const main = document.createElement('div');
    main.className = 'song-main';
    const title = document.createElement('div');
    title.className = 'song-title';
    title.textContent = s.title;
    const sub = document.createElement('div');
    sub.className = 'song-sub';
    sub.textContent = `${s.unit} · ${s.bpm} BPM · ${fmtTime(s.duration)}`;
    main.append(title, sub);

    const levels = document.createElement('div');
    levels.className = 'song-levels';
    for (const d of difficultiesOf(s)) {
      const b = document.createElement('span');
      b.className = 'lv';
      b.style.setProperty('--c', d.custom ? UI.pink : difficultyMeta(d.id).hex);
      b.textContent = d.custom ? '★' : d.level;
      levels.append(b);
    }

    li.append(main, levels);
    li.addEventListener('click', () => selectSong(i));
    list.append(li);
  });
}

function renderDetail() {
  const s = currentEntry();
  const diffs = difficultiesOf(s);
  diffIndex = clamp(diffIndex, 0, diffs.length - 1);
  const d = diffs[diffIndex];

  document.querySelector('.detail').style.setProperty('--accent', s.accent);
  $('d-unit').textContent = s.unit;
  $('d-title').textContent = s.title;
  $('d-artist').textContent = s.artist;

  const tabs = $('d-diffs');
  tabs.replaceChildren();
  diffs.forEach((entry, i) => {
    const meta = difficultyMeta(entry.id);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'diff' + (i === diffIndex ? ' is-on' : '');
    b.style.setProperty('--c', entry.custom ? UI.pink : meta.hex);
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(i === diffIndex));
    const lv = document.createElement('b');
    lv.textContent = entry.custom ? '★' : entry.level;
    const name = document.createElement('span');
    name.textContent = entry.custom ? 'CUSTOM' : meta.label;
    b.append(lv, name);
    b.addEventListener('click', () => { diffIndex = i; renderDetail(); blip('move'); });
    tabs.append(b);
  });

  $('d-bpm').textContent = s.bpm;
  $('d-notes').textContent = d.notes;
  $('d-colored').textContent = d.colored;
  $('d-length').textContent = fmtTime(s.duration);

  const rec = best[bestKey(s.id, d.id)];
  const bestEl = $('d-best').querySelector('b');
  bestEl.textContent = rec
    ? `${rec.grade} · ${fmtScore(rec.score)} · ${rec.accuracy.toFixed(2)}%`
    : 'not played yet';

  renderer.setMood(s.accent);
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

// ------------------------------------------------------------ settings ----

const CONTROLS = [
  ['set-speed', 'out-speed', 'speed', (v) => `${v.toFixed(1)}×`, parseFloat],
  ['set-offset', 'out-offset', 'offsetMs', (v) => `${v > 0 ? '+' : ''}${v} ms`, parseInt],
  ['set-volume', 'out-volume', 'volume', (v) => `${Math.round(v * 100)}%`, parseFloat],
  ['set-hit', 'out-hit', 'hitSound', (v) => `${Math.round(v * 100)}%`, parseFloat],
  ['set-effects', 'out-effects', 'effects', (v) => `${Math.round(v * 100)}%`, parseFloat],
];

const TOGGLES = [['set-colors', 'colorNotes'], ['set-auto', 'autoplay']];

/** The keybind button currently waiting for a keypress, if any. */
let listening = null;

function renderKeyGrid() {
  const grid = $('keygrid');
  const codes = keyTable(settings);
  grid.replaceChildren();
  CHANNEL_NAMES.forEach((chan, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'keybind' + (listening === i ? ' is-listening' : '');
    const small = document.createElement('small');
    small.textContent = chan.label;
    const strong = document.createElement('b');
    strong.textContent = listening === i ? '…' : keyLabel(codes[i]);
    b.append(small, strong);
    b.addEventListener('click', () => {
      listening = listening === i ? null : i;
      renderKeyGrid();
    });
    grid.append(b);
  });
}

function renderColorGrid() {
  const grid = $('colorgrid');
  grid.replaceChildren();
  for (const c of NOTE_COLORS) {
    const wrap = document.createElement('label');
    wrap.className = 'colorpick';
    const small = document.createElement('small');
    small.textContent = c.label;
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.value = settings.colorHex[c.id] || c.hex;
    inp.addEventListener('input', () => {
      settings.colorHex[c.id] = inp.value;
      commit();
      renderer.refreshColors();
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
  });

  $('btn-reset-colors').addEventListener('click', () => {
    settings.colorHex = {};
    commit();
    renderer.refreshColors();
    renderColorGrid();
  });

  renderKeyGrid();
  renderColorGrid();
}

/** Capture the next keypress for the binding being edited. */
window.addEventListener('keydown', (ev) => {
  if (listening === null || current !== 'screen-settings') return;
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
}, true);

// ----------------------------------------------------------------- flow ---

async function startGame() {
  // A focused button would otherwise swallow the gameplay keys.
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();

  const entry = currentEntry();
  const diff = currentDiff();
  song = diff.custom
    ? playable(entry.id, 'custom', getChart(entry.id).notes, 'Custom')
    : loadSong(entry.id, diff.id);

  renderer.setMood(entry.accent);
  game.song = song;
  show('');
  await game.start();
}

async function leaveGame() {
  await game.quit();
  renderer.judgeFx.show = false;
  game.particles.clear();
}

$('btn-play').addEventListener('click', async () => {
  await blip('confirm');
  await startGame();
});

$('btn-settings').addEventListener('click', () => {
  blip('move');
  show('screen-settings');
});

$('btn-close-settings').addEventListener('click', () => {
  blip('confirm');
  listening = null;
  renderKeyGrid();
  show('screen-select');
});

$('btn-resume').addEventListener('click', async () => {
  await blip('confirm');
  show('');
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
  backToSelect();
});

$('btn-retry').addEventListener('click', async () => {
  await blip('confirm');
  await leaveGame();
  await startGame();
});

$('btn-back').addEventListener('click', async () => {
  await blip('move');
  await leaveGame();
  backToSelect();
});

function backToSelect() {
  renderSongList();
  renderDetail();
  show('screen-select');
}

async function requestPause() {
  if (!game.started || game.finished) return;
  const paused = await game.togglePause();
  show(paused ? 'screen-pause' : '');
}

input.onPause = requestPause;

// Song-select keyboard navigation, and Escape to back out of settings.
window.addEventListener('keydown', (ev) => {
  if (current === 'screen-settings') {
    if (ev.code === 'Escape') { listening = null; renderKeyGrid(); show('screen-select'); }
    return;
  }
  if (current !== 'screen-select') return;
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

// -------------------------------------------------------------- results ---

function showResults(res) {
  audio.stop();

  $('res-grade').textContent = res.grade;
  $('res-song').textContent = `${song.title} · ${song.label.toUpperCase()}`;
  $('res-score').textContent = fmtScore(res.score);
  $('res-acc').textContent = `${res.accuracy.toFixed(2)}%`;
  $('res-perfect').textContent = res.counts.PERFECT;
  $('res-great').textContent = res.counts.GREAT;
  $('res-good').textContent = res.counts.GOOD;
  $('res-miss').textContent = res.counts.MISS;
  $('res-combo').textContent = `${res.maxCombo}x`;

  document.querySelector('.result').style.setProperty('--grade', GRADE_HEX[res.grade] || UI.teal);

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
    if (!banner.textContent) banner.textContent = 'New Best';
  }

  show('screen-result');
}

// ----------------------------------------------------------------- loop ---

let last = performance.now();

function frame(now) {
  const dt = clamp((now - last) / 1000, 0, 0.1);
  last = now;

  if (game.started) {
    game.update(dt);
    renderer.draw(game, dt);
  } else {
    renderer.drawIdle(now / 1000, dt);
  }
  requestAnimationFrame(frame);
}

renderSongList();
renderDetail();
initSettings();
applySettings();
requestAnimationFrame(frame);

// Debug handle: lets the console poke at a live run.
window.sosoph = { game, audio, renderer, input, settings, SONGS };
