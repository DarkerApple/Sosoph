// Song registry.
//
// A song file describes music; the chart for a given difficulty is derived from
// it on demand and cached. Custom charts made in the editor slot in here too,
// so gameplay never needs to know where a note map came from.

import helloSekai from './hello-sekai.js';
import neonDrift from './neon-drift.js';
import marmaladeSky from './marmalade-sky.js';
import untitledSorrow from './untitled-sorrow.js';
import vividImpact from './vivid-impact.js';

import { buildChart, ratingFor, finalise } from '../chart.js';

const BUILDERS = {
  'marmalade-sky': marmaladeSky,
  'hello-sekai': helloSekai,
  'neon-drift': neonDrift,
  'untitled-sorrow': untitledSorrow,
  'vivid-impact': vividImpact,
};

/** Display order, easiest first, and which difficulties each song ships. */
export const SONG_ORDER = [
  { id: 'marmalade-sky', difficulties: ['easy', 'normal', 'hard'] },
  { id: 'hello-sekai', difficulties: ['easy', 'normal', 'hard', 'expert'] },
  { id: 'neon-drift', difficulties: ['easy', 'normal', 'hard', 'expert'] },
  { id: 'untitled-sorrow', difficulties: ['easy', 'normal', 'hard', 'expert', 'master'] },
  { id: 'vivid-impact', difficulties: ['normal', 'hard', 'expert', 'master'] },
];

const defCache = new Map();
const chartCache = new Map();

/** The music: events, sections and the hits a chart can be cut from. */
export function songDef(id) {
  if (!defCache.has(id)) {
    const build = BUILDERS[id];
    if (!build) throw new Error(`unknown song: ${id}`);
    defCache.set(id, build());
  }
  return defCache.get(id);
}

export function chartFor(id, difficulty) {
  const key = `${id}/${difficulty}`;
  if (!chartCache.has(key)) {
    const def = songDef(id);
    const chart = buildChart(def, difficulty);
    chart.level = ratingFor(chart, def.duration);
    chartCache.set(key, chart);
  }
  return chartCache.get(key);
}

/** Everything the song-select screen needs, without building any charts twice. */
export function catalogue() {
  return SONG_ORDER.map(({ id, difficulties }) => {
    const def = songDef(id);
    return {
      id,
      title: def.title,
      artist: def.artist,
      unit: def.unit,
      accent: def.accent,
      bpm: def.bpm,
      duration: def.duration,
      difficulties: difficulties.map((d) => {
        const chart = chartFor(id, d);
        return { id: d, level: chart.level, notes: chart.notes.length, colored: chart.colored };
      }),
    };
  });
}

/**
 * Bind a note map to its music. `notes` may come from a generated chart or
 * straight out of the editor; either way the result is what `Game` consumes.
 * Notes are cloned so a second run never sees the previous run's judgement
 * flags.
 */
export function playable(id, difficulty, notes, label) {
  const def = songDef(id);
  const spb = def.spb;
  const chart = finalise(
    notes.map((n) => ({ t: n.t, lane: n.lane, dur: n.dur || 0, color: n.color || 0 })),
    def,
    difficulty,
    spb
  );

  return {
    id: def.id,
    key: `${def.id}/${difficulty}`,
    title: def.title,
    name: def.title,
    artist: def.artist,
    unit: def.unit,
    accent: def.accent,
    difficulty,
    label: label || difficulty,
    bpm: def.bpm,
    spb,
    events: def.events,
    sections: def.sections,
    duration: def.duration,
    notes: chart.notes,
    units: chart.units,
    colored: chart.colored,
    level: ratingFor(chart, def.duration),
  };
}

/** The normal path: play song `id` at difficulty `difficulty`. */
export function loadSong(id, difficulty) {
  return playable(id, difficulty, chartFor(id, difficulty).notes);
}

export const songIds = () => SONG_ORDER.map((s) => s.id);
