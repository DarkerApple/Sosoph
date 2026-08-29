// Song registry.
//
// A song file describes music; the chart for a given difficulty is derived from
// it on demand and cached. Custom charts made in the editor slot in here too,
// so gameplay never needs to know where a note map came from.

import afterimage from './afterimage.js';
import coldOpen from './cold-open.js';
import glassWaltz from './glass-waltz.js';
import helloSekai from './hello-sekai.js';
import ironSequence from './iron-sequence.js';
import marmaladeSky from './marmalade-sky.js';
import midnightTransit from './midnight-transit.js';
import neonAlleyway from './neon-alleyway.js';
import neonDrift from './neon-drift.js';
import paperLanterns from './paper-lanterns.js';
import pixelRain from './pixel-rain.js';
import solstice from './solstice.js';
import staticBloom from './static-bloom.js';
import sunroom from './sunroom.js';
import untitledSorrow from './untitled-sorrow.js';
import vividImpact from './vivid-impact.js';

import { buildChart, ratingFor, finalise } from '../chart.js';

const BUILDERS = {
  afterimage,
  'cold-open': coldOpen,
  'glass-waltz': glassWaltz,
  'hello-sekai': helloSekai,
  'iron-sequence': ironSequence,
  'marmalade-sky': marmaladeSky,
  'midnight-transit': midnightTransit,
  'neon-alleyway': neonAlleyway,
  'neon-drift': neonDrift,
  'paper-lanterns': paperLanterns,
  'pixel-rain': pixelRain,
  solstice,
  'static-bloom': staticBloom,
  sunroom,
  'untitled-sorrow': untitledSorrow,
  'vivid-impact': vividImpact,
};

/**
 * The library, in default (roughly easiest-first) order, and which difficulties
 * each song ships. A song only offers a tier when its chart at that tier is
 * meaningfully different from the one below — a sparse ballad has nothing to
 * add above HARD, and a 190 BPM hardcore track has no honest EASY.
 */
export const SONG_ORDER = [
  { id: 'paper-lanterns', difficulties: ['easy', 'normal', 'hard', 'expert'] },
  { id: 'cold-open', difficulties: ['easy', 'normal', 'hard'] },
  { id: 'marmalade-sky', difficulties: ['easy', 'normal'] },
  { id: 'glass-waltz', difficulties: ['easy', 'normal', 'hard'] },
  { id: 'sunroom', difficulties: ['easy', 'normal', 'hard'] },
  { id: 'neon-alleyway', difficulties: ['easy', 'normal', 'hard', 'expert', 'master'] },
  { id: 'hello-sekai', difficulties: ['easy', 'normal', 'hard', 'expert'] },
  { id: 'neon-drift', difficulties: ['easy', 'normal', 'hard', 'expert'] },
  { id: 'midnight-transit', difficulties: ['easy', 'normal', 'hard', 'expert'] },
  { id: 'afterimage', difficulties: ['easy', 'normal', 'hard', 'expert'] },
  { id: 'solstice', difficulties: ['easy', 'normal', 'hard', 'expert', 'master'] },
  { id: 'static-bloom', difficulties: ['easy', 'normal', 'hard', 'expert', 'master'] },
  { id: 'pixel-rain', difficulties: ['easy', 'normal', 'hard', 'expert', 'master'] },
  { id: 'untitled-sorrow', difficulties: ['easy', 'normal', 'hard', 'expert', 'master'] },
  { id: 'vivid-impact', difficulties: ['normal', 'hard', 'expert', 'master'] },
  { id: 'iron-sequence', difficulties: ['normal', 'hard', 'expert', 'master'] },
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
      genre: def.genre,
      bpm: def.bpm,
      duration: def.duration,
      difficulties: difficulties.map((d) => {
        const chart = chartFor(id, d);
        return { id: d, level: chart.level, notes: chart.notes.length, flicks: chart.flicks };
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
    notes.map((n) => ({ t: n.t, lane: n.lane, dur: n.dur || 0, flick: n.flick || 0 })),
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
    genre: def.genre,
    difficulty,
    label: label || difficulty,
    bpm: def.bpm,
    spb,
    beatsPerBar: def.beatsPerBar,
    events: def.events,
    sections: def.sections,
    duration: def.duration,
    notes: chart.notes,
    units: chart.units,
    flicks: chart.flicks,
    level: ratingFor(chart, def.duration),
  };
}

/** The normal path: play song `id` at difficulty `difficulty`. */
export function loadSong(id, difficulty) {
  return playable(id, difficulty, chartFor(id, difficulty).notes);
}

export const songIds = () => SONG_ORDER.map((s) => s.id);
