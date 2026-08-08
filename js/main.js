// Application shell: settings, screen routing and the single frame loop.

import { buildStage1 } from './song.js';
import { AudioEngine } from './audio.js';
import { Renderer } from './renderer.js';
import { InputManager } from './input.js';
import { Game, gradeColor } from './game.js';
import { fmtScore, fmtTime, clamp } from './util.js';

const $ = (id) => document.getElementById(id);
const SETTINGS_KEY = 'sosoph.settings.v1';
const BEST_KEY = 'sosoph.best.stage-1';

// ------------------------------------------------------------- settings ---

const DEFAULTS = {
  speed: 1.8,
  offsetMs: 0,
  volume: 0.75,
  hitSound: 0.45,
  effects: 1,
  autoplay: false,
};

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode — settings just won't persist */
  }
}

const settings = loadJson(SETTINGS_KEY, DEFAULTS);
let best = loadJson(BEST_KEY, { score: 0, accuracy: 0, grade: null });

// ---------------------------------------------------------------- setup ---

const song = buildStage1();
const canvas = $('stage');
const renderer = new Renderer(canvas);
const audio = new AudioEngine();
const input = new InputManager();
input.attach(canvas);
input.layout = renderer.layout;

const game = new Game({
  song,
  audio,
  renderer,
  input,
  settings,
  onFinish: showResults,
});

window.addEventListener('resize', () => {
  renderer.resize();
  input.layout = renderer.layout;
});

// --------------------------------------------------------------- screens --

let current = 'screen-title';

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
  } catch {
    /* autoplay policy — silent is fine */
  }
}

// ------------------------------------------------------------ title data --

function applySettings() {
  audio.setVolume(settings.volume);
  audio.hitSoundVolume = settings.hitSound;
  // A positive offset means "the audio is late", so shift the transport back.
  audio.userOffset = settings.offsetMs / 1000;
}

function renderBest() {
  $('best-value').textContent = best.grade
    ? `${best.grade} · ${fmtScore(best.score)} · ${best.accuracy.toFixed(2)}%`
    : 'not played yet';
}

function initTitle() {
  $('stage-name').textContent = song.name;
  $('stage-sub').textContent = `${song.difficulty} · ${song.artist}`;
  $('stage-level').textContent = song.level;
  $('meta-bpm').textContent = song.bpm;
  $('meta-notes').textContent = song.notes.length;
  $('meta-len').textContent = fmtTime(song.duration);
  renderBest();
}

// ------------------------------------------------------------- settings ---

const CONTROLS = [
  ['set-speed', 'out-speed', 'speed', (v) => `${v.toFixed(1)}×`, parseFloat],
  ['set-offset', 'out-offset', 'offsetMs', (v) => `${v > 0 ? '+' : ''}${v} ms`, parseInt],
  ['set-volume', 'out-volume', 'volume', (v) => `${Math.round(v * 100)}%`, parseFloat],
  ['set-hit', 'out-hit', 'hitSound', (v) => `${Math.round(v * 100)}%`, parseFloat],
  ['set-effects', 'out-effects', 'effects', (v) => `${Math.round(v * 100)}%`, parseFloat],
];

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
      saveJson(SETTINGS_KEY, settings);
    });
  }

  const auto = $('set-auto');
  auto.checked = settings.autoplay;
  auto.addEventListener('change', () => {
    settings.autoplay = auto.checked;
    saveJson(SETTINGS_KEY, settings);
    blip('move');
  });
}

// ---------------------------------------------------------------- flow ----

async function startGame() {
  // A button that keeps focus would otherwise swallow the gameplay keys.
  if (document.activeElement && document.activeElement.blur) {
    document.activeElement.blur();
  }
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

$('btn-open-settings').addEventListener('click', () => {
  blip('move');
  show('screen-settings');
});

$('btn-close-settings').addEventListener('click', () => {
  blip('confirm');
  show('screen-title');
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
  show('screen-title');
});

$('btn-retry').addEventListener('click', async () => {
  await blip('confirm');
  await leaveGame();
  await startGame();
});

$('btn-back').addEventListener('click', async () => {
  await blip('move');
  await leaveGame();
  show('screen-title');
});

async function requestPause() {
  if (!game.started || game.finished) return;
  const paused = await game.togglePause();
  show(paused ? 'screen-pause' : '');
}

input.onPause = requestPause;

// Escape also backs out of the settings screen.
window.addEventListener('keydown', (ev) => {
  if (ev.code !== 'Escape') return;
  if (current === 'screen-settings') show('screen-title');
});

// Losing focus mid-song would otherwise mean guaranteed misses.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.started && !game.paused && !game.finished) {
    requestPause();
  }
});

// -------------------------------------------------------------- results ---

function showResults(res) {
  audio.stop();

  $('res-grade').textContent = res.grade;
  $('res-score').textContent = fmtScore(res.score);
  $('res-acc').textContent = `${res.accuracy.toFixed(2)}%`;
  $('res-perfect').textContent = res.counts.PERFECT;
  $('res-great').textContent = res.counts.GREAT;
  $('res-good').textContent = res.counts.GOOD;
  $('res-miss').textContent = res.counts.MISS;
  $('res-combo').textContent = `${res.maxCombo}x`;

  const panel = document.querySelector('.result');
  panel.style.setProperty('--grade', gradeColor(res.grade));

  const banner = $('res-banner');
  banner.textContent = res.autoplay
    ? 'Autoplay — not recorded'
    : res.allPerfect
      ? 'All Perfect'
      : res.fullCombo
        ? 'Full Combo'
        : '';

  if (!res.autoplay && res.score > best.score) {
    best = { score: res.score, accuracy: res.accuracy, grade: res.grade };
    saveJson(BEST_KEY, best);
    renderBest();
    if (banner.textContent === '') banner.textContent = 'New Best';
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

initTitle();
initSettings();
applySettings();
requestAnimationFrame(frame);

// Debug handle: lets the harness (and the console) inspect a live run.
window.sosoph = { game, song, audio, renderer, input, settings };
