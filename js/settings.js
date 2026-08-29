// Player settings: one object, persisted on every change, shared by the game
// and the editor.

import { load, save } from './storage.js';
import { LANE_KEYS, NOTE_COLORS } from './theme.js';

const KEY = 'settings.v2';

export const DEFAULTS = {
  /** Note speed multiplier; the scroll time is 1.75s / speed. */
  speed: 2,
  /** Audio/visual calibration in milliseconds. Positive = audio is late. */
  offsetMs: 0,
  volume: 0.75,
  hitSound: 0.45,
  /** Particle and bloom density, 0 turns effects off entirely. */
  effects: 1,
  /** When off, coloured notes are played as ordinary lane notes. */
  colorNotes: true,
  autoplay: false,
  /** Custom key bindings, keyed `lane0`..`lane3` and `color-red`.. */
  keys: {},
  /** Custom note colours, keyed by colour id. */
  colorHex: {},
};

export const settings = load(KEY, DEFAULTS);

/** Persist the current values. Called after any mutation. */
export const commit = () => save(KEY, settings);

/** Scroll time in seconds — how long a note is visible before the judge line. */
export const travelTime = () => 1.75 / settings.speed;

/** Labels for the eight input channels, in `keyTable` order. */
export const CHANNEL_NAMES = [
  ...LANE_KEYS.map((_, i) => ({ id: `lane${i}`, label: `Lane ${i + 1}` })),
  ...NOTE_COLORS.map((c) => ({ id: `color-${c.id}`, label: c.label })),
];
