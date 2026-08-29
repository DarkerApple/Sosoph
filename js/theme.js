// Colours, key bindings and the tuning constants that the rest of the game
// treats as fixed. Anything the player can change lives in `settings.js`;
// this file holds the defaults those settings start from.

import { hexToRgb } from './util.js';

/**
 * Note kinds.
 *
 * A note is a TAP, a HOLD, or a FLICK. Taps and holds are struck with the
 * note's own lane key, D F J K. A flick is struck with the lane key and then
 * *rolled* onto the neighbouring key in the direction of its arrow — left or
 * right along the same row, or down onto the key underneath, C V N M.
 *
 * That roll is a gesture rather than a second key to memorise: your finger is
 * already on the lane key, and finishing the note is one short movement in the
 * direction the arrow points. It is also the same motion a touch player makes,
 * so the note means the same thing on both.
 */
export const FLICK = { NONE: 0, LEFT: 1, RIGHT: 2, DOWN: 3 };

export const FLICK_DIRS = [
  { id: FLICK.LEFT, glyph: '←', label: 'Left' },
  { id: FLICK.RIGHT, glyph: '→', label: 'Right' },
  { id: FLICK.DOWN, glyph: '↓', label: 'Down' },
];

export const flickMeta = (flick) => FLICK_DIRS.find((d) => d.id === flick) || null;

/** How long the roll has to land after the lane key goes down. */
export const FLICK_WINDOW = 0.16;

/**
 * How long before a flick the key it rolls onto must already be free. Without
 * this a flick can be placed the instant a hold in the destination lane ends,
 * and the other hand is still letting go as the roll arrives.
 */
export const FLICK_CLEARANCE = 0.1;

/** Lane keys, left to right, and the row below that a down-flick rolls onto. */
export const LANE_KEYS = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'];
export const DOWN_KEYS = ['KeyC', 'KeyV', 'KeyN', 'KeyM'];
export const LANE_COUNT = 4;

/**
 * The input channel that finishes a flick. Channels 0..3 are the lane keys and
 * 4..7 the row below, so a left or right flick lands on a neighbouring lane key
 * and a down flick lands on the key under its own lane. Returns -1 when the
 * lane cannot roll that way — lane 0 has nothing to its left.
 */
export function flickChannel(lane, flick) {
  if (flick === FLICK.LEFT) return lane > 0 ? lane - 1 : -1;
  if (flick === FLICK.RIGHT) return lane < LANE_COUNT - 1 ? lane + 1 : -1;
  if (flick === FLICK.DOWN) return LANE_COUNT + lane;
  return -1;
}

/** Which flick directions a lane can actually roll toward. */
export const flicksFor = (lane) =>
  FLICK_DIRS.filter((d) => flickChannel(lane, d.id) >= 0).map((d) => d.id);

/** Every note kind, for legends and settings previews. */
export const NOTE_KINDS = [
  { id: 'tap', label: 'Tap', hint: 'press the lane key' },
  { id: 'hold', label: 'Hold', hint: 'press and keep holding' },
  { id: 'flick', label: 'Flick', hint: 'press, then roll the way the arrow points' },
];

/** Default note colours. A look, not a rule — the kind is what you play. */
export const NOTE_LOOK = { tap: '#ffffff', hold: '#6fe0ff', flick: '#ff5f9e' };

/** Note shapes. Cosmetic: the marking on a note is what says how to play it. */
export const NOTE_STYLES = [
  { id: 'bar', label: 'Bar' },
  { id: 'capsule', label: 'Capsule' },
  { id: 'circle', label: 'Circle' },
];

/**
 * The whole design rests on one rule: colour carries meaning, and nothing else
 * is coloured. The chrome is ink on paper; the only hues anywhere are the three
 * note colours and the five difficulty colours. These match the custom
 * properties in `css/style.css`, for the few places that draw chrome on canvas.
 */
export const UI = {
  ink: '#16171a',
  inkDim: '#5f646c',
  paper: '#f4f4f2',
};

/**
 * Difficulty colours come in two weights. `hex` is dark enough to carry white
 * text as a solid badge on the light pages; `glow` is the same hue lifted for
 * the black playfield, where the dark version would disappear.
 */
export const DIFFICULTIES = [
  { id: 'easy', label: 'EASY', hex: '#2e7d32', glow: '#6cc46f' },
  { id: 'normal', label: 'NORMAL', hex: '#1565c0', glow: '#6aa9e8' },
  { id: 'hard', label: 'HARD', hex: '#a86200', glow: '#e0a13c' },
  { id: 'expert', label: 'EXPERT', hex: '#c62828', glow: '#f0736f' },
  { id: 'master', label: 'MASTER', hex: '#6a1b9a', glow: '#b47ee0' },
  { id: 'custom', label: 'CUSTOM', hex: '#37474f', glow: '#93a4ad' },
];

export const difficultyMeta = (id) =>
  DIFFICULTIES.find((d) => d.id === id) || DIFFICULTIES[1];

/** Judgement text sits on the dark playfield, so these stay bright. */
export const JUDGE_HEX = {
  PERFECT: '#ffd75e',
  GREAT: '#5fe0c4',
  GOOD: '#7fbcff',
  MISS: '#ff8095',
};

/** Grades are shown on the light results page, so these stay dark. */
export const GRADE_HEX = {
  SSS: '#16171a', SS: '#16171a', S: '#16171a', A: '#2e7d32',
  B: '#1565c0', C: '#a86200', D: '#c62828',
};

/**
 * Resolve the live note colours from settings. Every consumer asks for this
 * rather than reading the defaults, so a recolour takes effect everywhere.
 */
export function noteRgbTable(settings) {
  const custom = (settings && settings.noteHex) || {};
  return {
    tap: hexToRgb(custom.tap || NOTE_LOOK.tap),
    hold: hexToRgb(custom.hold || NOTE_LOOK.hold),
    flick: hexToRgb(custom.flick || NOTE_LOOK.flick),
  };
}

/** Live keycode for every input channel: the four lanes, then the row below. */
export function keyTable(settings) {
  const custom = (settings && settings.keys) || {};
  return [
    ...LANE_KEYS.map((k, i) => custom[`lane${i}`] || k),
    ...DOWN_KEYS.map((k, i) => custom[`down${i}`] || k),
  ];
}

/** "KeyD" -> "D", "Semicolon" -> ";" — what to print on a key cap. */
export function keyLabel(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `N${code.slice(6)}`;
  return ({
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
    BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-',
    Equal: '=', Backquote: '`', Space: 'SPC',
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
  })[code] || code;
}
