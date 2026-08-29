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
  { id: 'red', label: 'Red', key: 'KeyC', hex: '#ff4d6d' },
  { id: 'yellow', label: 'Yellow', key: 'KeyV', hex: '#ffc233' },
  { id: 'green', label: 'Green', key: 'KeyN', hex: '#3ddc84' },
  { id: 'blue', label: 'Blue', key: 'KeyM', hex: '#4d9cff' },
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

// PJSK-flavoured palette: teal-forward, high-key menus, dark playfield.
export const UI = {
  teal: '#00c8b4',
  tealDeep: '#009e8e',
  pink: '#ff6aa2',
  ink: '#26314a',
};

/** Plain notes share one colour in every lane, the way PJSK taps do. */
export const PLAIN_NOTE_HEX = '#37d6ff';

export const DIFFICULTIES = [
  { id: 'easy', label: 'EASY', hex: '#67d443' },
  { id: 'normal', label: 'NORMAL', hex: '#38b6f0' },
  { id: 'hard', label: 'HARD', hex: '#ffa629' },
  { id: 'expert', label: 'EXPERT', hex: '#f4525f' },
  { id: 'master', label: 'MASTER', hex: '#b45cf0' },
];

export const difficultyMeta = (id) =>
  DIFFICULTIES.find((d) => d.id === id) || DIFFICULTIES[1];

export const JUDGE_HEX = {
  PERFECT: '#ffd75e',
  GREAT: '#5fe0c4',
  GOOD: '#6fb7ff',
  MISS: '#ff7d95',
};

export const GRADE_HEX = {
  SSS: '#ffd75e', SS: '#ffe9a8', S: '#5fe0c4', A: '#67d443',
  B: '#38b6f0', C: '#b45cf0', D: '#ff7d95',
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
