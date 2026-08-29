// Chart generation.
//
// Songs emit *musical* hits (see `music.js`); this file selects a subset of
// them per difficulty and assigns lanes, holds and colours. Doing it this way
// means every note corresponds to something the player can hear, and that the
// four difficulties of a song are recognisably the same chart with more or
// less detail rather than four unrelated ones.

import { clamp, mulberry32 } from './util.js';
import { LANE_COUNT, colorOfLane, homeLaneOf, PLAIN } from './theme.js';

/**
 * Per-difficulty tuning.
 *
 *   colorRate     share of phrases moved to the colour keys, not share of notes
 *   rowSwitchSec  how long a finger needs to change rows; this also decides
 *                 where one colour run ends and the next begins
 *   layers        minimum weight a hit needs to survive, per source layer;
 *                 a layer that is absent is dropped entirely
 *   grid          smallest spacing between consecutive notes, in beats
 *   floorSec      absolute spacing floor. This, not `grid`, is what makes a
 *                 tier mean the same thing across tempos: without it a NORMAL
 *                 at 190 BPM is twice the chart a NORMAL at 96 BPM is
 *   maxChord      how many lanes may fire at once
 *   holds         whether sustains become hold notes
 */
export const PROFILES = {
  easy: {
    layers: { lead: 0.72, snare: 0.7, kick: 0.85, stab: 0.7 },
    grid: 1, floorSec: 0.34, maxChord: 1, holds: true,
    // Quarter notes leave plenty of room, so even EASY can move whole phrases
    // to the bottom row without ever asking for a fast row change.
    colorRate: 0.3, rowSwitchSec: 0.3, holdMinBeats: 1.5,
  },
  normal: {
    layers: { lead: 0.45, snare: 0.5, kick: 0.7, stab: 0.5, arp: 0.85 },
    grid: 0.5, floorSec: 0.24, maxChord: 2, holds: true,
    colorRate: 0.4, rowSwitchSec: 0.24, holdMinBeats: 1,
  },
  hard: {
    layers: { lead: 0.2, snare: 0.35, kick: 0.5, stab: 0.3, arp: 0.6, bass: 0.6 },
    grid: 0.25, floorSec: 0.155, maxChord: 2, holds: true,
    colorRate: 0.45, rowSwitchSec: 0.17, holdMinBeats: 1,
  },
  expert: {
    layers: { lead: 0, snare: 0.2, kick: 0.35, stab: 0.15, arp: 0.35, bass: 0.5 },
    grid: 0.25, floorSec: 0.105, maxChord: 2, holds: true,
    colorRate: 0.48, rowSwitchSec: 0.14, holdMinBeats: 0.75,
  },
  master: {
    layers: { lead: 0, snare: 0, kick: 0.2, stab: 0, arp: 0.2, bass: 0.35 },
    grid: 0.25, floorSec: 0.068, maxChord: 2, holds: true,
    colorRate: 0.52, rowSwitchSec: 0.12, holdMinBeats: 0.75,
  },
};

const EPS = 1e-4;

/**
 * Which physical finger a note needs, and which row it sits on. The lane keys
 * and the colour keys are two rows under the same four fingers, so lane 0 (D)
 * and red (C) are both the left middle finger.
 */
export const fingerOf = (note) => (note.color === PLAIN ? note.lane : homeLaneOf(note.color));
export const rowOf = (note) => (note.color === PLAIN ? 0 : 1);

/** Group hits that land on the same beat. */
function groupByBeat(hits) {
  const sorted = [...hits].sort((a, b) => a.beat - b.beat || b.weight - a.weight);
  const groups = [];
  for (const h of sorted) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(last.beat - h.beat) < EPS) last.hits.push(h);
    else groups.push({ beat: h.beat, hits: [h] });
  }
  return groups;
}

/**
 * Map pitch onto lanes so the chart traces the melody's contour, with an
 * anti-repeat nudge: two of the same lane in a row is a trill, three is a
 * stutter. Unpitched hits (drums) walk a fixed figure instead of landing
 * randomly.
 */
class LanePicker {
  /** `laneOfPitch` maps every pitch this difficulty will play to a lane. */
  constructor(laneOfPitch) {
    this.laneOfPitch = laneOfPitch;
    this.last = -1;
    this.repeats = 0;
    this.nudge = 1;
    this.walk = 0;
    this.detour = 0;
  }

  pick(hit, taken) {
    let lane;
    if (hit.pitch != null) {
      lane = this.laneOfPitch.get(hit.pitch) ?? Math.floor(LANE_COUNT / 2);
      if (lane === this.last) {
        if (++this.repeats >= 2) {
          this.nudge = -this.nudge;
          lane = clamp(lane + this.nudge, 0, LANE_COUNT - 1);
          if (lane === this.last) lane = clamp(lane - this.nudge * 2, 0, LANE_COUNT - 1);
          this.repeats = 0;
        }
      } else {
        this.repeats = 0;
      }
    } else {
      // Outside-in figure: reads as deliberate rather than as noise.
      lane = [0, 3, 1, 2][this.walk++ % 4];
    }

    // A lane already claimed by this chord steps outward to the nearest free
    // one, alternating which side it tries first — always looking left would
    // quietly pile the second note of every chord into the low lanes.
    if (taken.has(lane)) {
      const first = this.detour++ % 2 === 0 ? -1 : 1;
      let found = -1;
      for (let d = 1; d < LANE_COUNT && found < 0; d++) {
        for (const dir of [first, -first]) {
          const c = lane + dir * d;
          if (c >= 0 && c < LANE_COUNT && !taken.has(c)) { found = c; break; }
        }
      }
      if (found < 0) return -1;
      lane = found;
    }

    this.last = lane;
    return lane;
  }
}

/**
 * One generation pass: walk the tagged moments in order, keep the ones this
 * difficulty has room for, and give each a lane and possibly a colour.
 */
function generate(def, profile, spb, groups, survives, picker, rnd) {
  const notes = [];
  const accepted = [];
  let lastBeat = -Infinity;
  let lastTime = -Infinity;

  for (const group of groups) {
    const t = group.beat * spb;

    // --- difficulty filter --------------------------------------------------
    const eligible = group.hits.filter(survives);
    if (!eligible.length) continue;

    // --- spacing ------------------------------------------------------------
    const beatGap = group.beat - lastBeat;
    const timeGap = t - lastTime;
    if (beatGap < profile.grid - EPS || timeGap < profile.floorSec - EPS) continue;

    // --- lanes --------------------------------------------------------------
    const taken = new Set();
    const chord = [];
    for (const h of eligible.slice(0, profile.maxChord)) {
      const lane = picker.pick(h, taken);
      if (lane < 0) continue;
      taken.add(lane);
      chord.push({ hit: h, lane });
    }
    if (!chord.length) continue;

    for (const { hit, lane } of chord) {
      const holdBeats = profile.holds && hit.hold >= profile.holdMinBeats ? hit.hold : 0;
      // Colour is painted afterwards, over whole phrases — see `paintColors`.
      notes.push({ t, lane, dur: holdBeats * spb, color: PLAIN, accent: hit.accent });
      accepted.push(hit);
    }

    if (notes.length && Math.abs(notes[notes.length - 1].t - t) < EPS) {
      lastBeat = group.beat;
      lastTime = t;
    }
  }

  return { notes, accepted };
}

/**
 * Paint colours onto a finished note map.
 *
 * Colour is a hand position, not a decoration. A finger cannot flick between
 * the two key rows note to note, so colouring individual notes forces them to
 * stay rare — which is what made the mechanic feel like a garnish. Instead the
 * lane's notes are cut into *runs* at exactly the gaps long enough to change
 * rows in, and a whole run is moved to the colour key or left on the lane key.
 * The player's hand drops to the bottom row for a phrase and comes back up,
 * which is both far more playable at speed and far more of a mechanic.
 */
function paintColors(notes, profile, rnd) {
  if (profile.colorRate <= 0) return 0;

  const byLane = Array.from({ length: LANE_COUNT }, () => []);
  for (const n of notes) byLane[n.lane].push(n);

  let colored = 0;
  for (const lane of byLane) {
    // A gap the finger could use to change rows both ends one run and starts
    // the next, so every run is enterable and leavable by construction.
    const runs = [];
    for (const n of lane) {
      const run = runs[runs.length - 1];
      const prev = run && run[run.length - 1];
      if (!run || n.t - (prev.t + prev.dur) >= profile.rowSwitchSec - EPS) runs.push([n]);
      else run.push(n);
    }

    let prevColored = false;
    for (const run of runs) {
      // Runs the music already stresses are likelier to move; a run right after
      // a coloured one is likelier to stay, so the hand actually alternates
      // rather than sitting on the bottom row for a whole section.
      const bias = (run[0].accent ? 1.3 : 0.8) * (prevColored ? 0.45 : 1.15);
      const take = rnd() < profile.colorRate * bias;
      if (take) {
        for (const n of run) {
          n.color = colorOfLane(n.lane);
          colored++;
        }
      }
      prevColored = take;
    }
  }
  return colored;
}

/**
 * Build a note map from a song definition.
 *
 * `difficulty` selects a profile; `overrides` lets a song nudge one (a ballad
 * wants longer holds, a stream chart wants a tighter grid) without inventing a
 * whole new difficulty.
 *
 * Generation runs twice. The first pass balances the lanes over every *candidate*
 * pitch, but the spacing rules thin a busy low layer far harder than a sparse
 * melody, so the lanes come out uneven. The second pass rebuilds the lane map
 * from the notes the first pass actually kept, which is the distribution that
 * matters.
 */
export function buildChart(def, difficulty, overrides = {}) {
  const profile = {
    ...PROFILES[difficulty],
    ...overrides,
    layers: { ...PROFILES[difficulty].layers, ...(overrides.layers || {}) },
  };
  const spb = 60 / def.bpm;
  const seed = hashSeed(`${def.id}:${difficulty}`);
  const survives = (h) => {
    const min = profile.layers[h.layer];
    return min !== undefined && h.weight >= min;
  };
  const groups = groupByBeat(def.hits);

  const run = (map) =>
    generate(def, profile, spb, groups, survives, new LanePicker(map), mulberry32(seed));

  const first = run(laneMap(def.hits.filter(survives)));
  const second = run(laneMap(first.accepted));
  paintColors(second.notes, profile, mulberry32(seed ^ 0x9e3779b9));

  return finalise(second.notes, def, difficulty, spb);
}

/**
 * A finger needs a moment to let a hold go and press again, so every hold is
 * trimmed to leave at least this many beats before the next note in its lane.
 * Without it a hold can end on the exact tick of the following note, which is
 * physically unplayable however good the player is.
 */
export const RELEASE_GAP_BEATS = 0.25;

/** Sort, de-duplicate, trim overlapping holds and attach derived fields. */
export function finalise(raw, def, difficulty, spb) {
  const notes = [...raw].sort((a, b) => a.t - b.t || a.lane - b.lane);
  const gap = spb * RELEASE_GAP_BEATS;

  const cleaned = [];
  const openHold = new Array(LANE_COUNT).fill(null);
  for (const n of notes) {
    const prev = cleaned[cleaned.length - 1];
    if (prev && Math.abs(prev.t - n.t) < EPS && prev.lane === n.lane) continue;

    const owner = openHold[n.lane];
    if (owner && n.t < owner.t + owner.dur + gap - EPS) {
      owner.dur = Math.max(0, n.t - gap - owner.t);
    }
    cleaned.push(n);
    if (n.dur > 0) openHold[n.lane] = n;
    else if (owner && owner.t + owner.dur <= n.t) openHold[n.lane] = null;
  }

  let units = 0;
  cleaned.forEach((n, i) => {
    n.id = i;
    n.isHold = n.dur > spb * 0.35;
    if (!n.isHold) n.dur = 0;
    units += n.isHold ? 2 : 1;
  });

  return {
    difficulty,
    notes: cleaned,
    units,
    colored: cleaned.filter((n) => n.color !== PLAIN).length,
  };
}

/**
 * Assign every pitch a lane so that each lane carries about a quarter of the
 * notes, keeping pitch order intact so the chart still traces the melody.
 *
 * Splitting the pitch *range* into four leaves lanes idle whenever a melody
 * clusters. Splitting at the quartiles of the pitch list is closer, but a song
 * that hammers one note — a riff's root, say — can put every copy of it on the
 * same side of a boundary and collapse two lanes into one. Weighting by how
 * often each pitch actually occurs fixes both.
 */
function laneMap(hits) {
  const counts = new Map();
  for (const h of hits) {
    if (h.pitch == null) continue;
    counts.set(h.pitch, (counts.get(h.pitch) || 0) + 1);
  }
  const pitches = [...counts.keys()].sort((a, b) => a - b);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const map = new Map();
  let seen = 0;
  for (const p of pitches) {
    // Score each pitch at the middle of its own share, so a single pitch that
    // spans a boundary lands on the side it mostly belongs to.
    const mid = seen + counts.get(p) / 2;
    map.set(p, clamp(Math.floor((mid / total) * LANE_COUNT), 0, LANE_COUNT - 1));
    seen += counts.get(p);
  }
  return map;
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Rough difficulty number, so song cards do not need hand-maintained levels.
 *
 * Density is most of it, but the third term matters as much in practice: what
 * makes a colour-heavy chart hard is not how many notes are coloured — that is
 * roughly constant across the library — but how often a hand has to change
 * rows, so that is what is counted.
 */
export function ratingFor(chart, duration) {
  if (!chart.notes.length) return 1;
  const nps = chart.notes.length / Math.max(1, duration);
  let peak = 0;
  for (let i = 0; i < chart.notes.length; i++) {
    let c = 0;
    while (i + c < chart.notes.length && chart.notes[i + c].t - chart.notes[i].t < 1) c++;
    if (c > peak) peak = c;
  }
  let switches = 0;
  const row = new Array(LANE_COUNT).fill(0);
  for (const n of chart.notes) {
    const f = fingerOf(n);
    if (row[f] !== rowOf(n)) {
      switches++;
      row[f] = rowOf(n);
    }
  }
  const sps = switches / Math.max(1, duration);
  return clamp(Math.round(nps * 2.6 + peak * 0.55 + sps * 2), 1, 45);
}
