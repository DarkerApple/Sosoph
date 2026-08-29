// Colours, key bindings and the tuning constants that the rest of the game
// treats as fixed. Anything the player can change lives in `settings.js`;
// this file holds the defaults those settings start from.

import { hexToRgb } from './util.js';

/**
 * Note kinds.
 *
 * A note is either PLAIN — struck with its lane key, D F J K — or coloured,
 * which is struck with the matching colour key on the row below: C V N M for
 * red, yellow, green, blue. The colour index is stored on the note as
 * `color`, where 0 means plain and 1..4 select the entries below.
 */
export const PLAIN = 0;

export const NOTE_COLORS = [
  { id: 'red', label: 'Red', key: 'KeyC', hex: '#ff5563' },
  { id: 'yellow', label: 'Yellow', key: 'KeyV', hex: '#ffc63d' },
  { id: 'green', label: 'Green', key: 'KeyN', hex: '#46d97e' },
  { id: 'blue', label: 'Blue', key: 'KeyM', hex: '#5aa4ff' },
];

export const COLOR_COUNT = NOTE_COLORS.length;

/** Lane keys, left to right. */
export const LANE_KEYS = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'];
export const LANE_COUNT = 4;

/**
 * Every colour has a "home" lane — red sits over D, so C is directly below the
 * finger already on that lane. Charts lean on this alignment so a coloured note
 * reads as "same finger, one row down"; crossovers are possible but rare.
 */
export const homeLaneOf = (color) => color - 1;
export const colorOfLane = (lane) => lane + 1;

/**
 * The whole design rests on one rule: colour carries meaning, and nothing else
 * is coloured. The chrome is ink on paper; the only hues anywhere are the four
 * note colours and the five difficulty colours. These match the custom
 * properties in `css/style.css`, for the few places that draw chrome on canvas.
 */
export const UI = {
  ink: '#16171a',
  inkDim: '#5f646c',
  paper: '#f4f4f2',
};

/**
 * Plain notes are white. That makes the whole control scheme readable from the
 * note alone: white means the lane key under it, any colour means that colour's
 * key on the row below.
 */
export const PLAIN_NOTE_HEX = '#ffffff';

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
 * Resolve the live colour table from settings. Coloured notes may be recoloured
 * by the player, so every consumer asks for this rather than reading the
 * defaults directly. Index 0 is the plain note colour, 1..4 the colours.
 */
export function noteRgbTable(settings) {
  const custom = (settings && settings.colorHex) || {};
  return [
    hexToRgb(PLAIN_NOTE_HEX),
    ...NOTE_COLORS.map((c) => hexToRgb(custom[c.id] || c.hex)),
  ];
}

/** Resolve the live keycode for every input channel: 4 lanes then 4 colours. */
export function keyTable(settings) {
  const custom = (settings && settings.keys) || {};
  return [
    ...LANE_KEYS.map((k, i) => custom[`lane${i}`] || k),
    ...NOTE_COLORS.map((c) => custom[`color-${c.id}`] || c.key),
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
