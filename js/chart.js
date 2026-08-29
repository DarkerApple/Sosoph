// Chart generation.
//
// Songs emit *musical* hits (see `music.js`); this file selects a subset of
// them per difficulty and assigns lanes, holds and colours. Doing it this way
// means every note corresponds to something the player can hear, and that the
// four difficulties of a song are recognisably the same chart with more or
// less detail rather than four unrelated ones.

import { clamp, mulberry32 } from './util.js';
import {
  LANE_COUNT, FLICK, FLICK_WINDOW, FLICK_CLEARANCE, flickChannel, flicksFor,
} from './theme.js';

/**
 * Per-difficulty tuning.
 *
 *   flickRate     share of eligible notes turned into flicks
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
    flickRate: 0.08, holdMinBeats: 1.5,
  },
  normal: {
    layers: { lead: 0.45, snare: 0.5, kick: 0.7, stab: 0.5, arp: 0.85 },
    grid: 0.5, floorSec: 0.24, maxChord: 2, holds: true,
    flickRate: 0.11, holdMinBeats: 1,
  },
  hard: {
    layers: { lead: 0.2, snare: 0.35, kick: 0.5, stab: 0.3, arp: 0.6, bass: 0.6 },
    grid: 0.25, floorSec: 0.155, maxChord: 2, holds: true,
    flickRate: 0.15, holdMinBeats: 1,
  },
  expert: {
    layers: { lead: 0, snare: 0.2, kick: 0.35, stab: 0.15, arp: 0.35, bass: 0.5 },
    grid: 0.25, floorSec: 0.105, maxChord: 2, holds: true,
    flickRate: 0.18, holdMinBeats: 0.75,
  },
  master: {
    layers: { lead: 0, snare: 0, kick: 0.2, stab: 0, arp: 0.2, bass: 0.35 },
    grid: 0.25, floorSec: 0.068, maxChord: 2, holds: true,
    flickRate: 0.22, holdMinBeats: 0.75,
  },
};

const EPS = 1e-4;

/** The channel a note's opening press uses — always its own lane key. */
export const channelOf = (note) => note.lane;

/** The channel that finishes a flick, or -1 for a tap or hold. */
export const finishChannelOf = (note) =>
  note.flick ? flickChannel(note.lane, note.flick) : -1;

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
      // Flicks are painted afterwards, against the finished map — see
      // `paintFlicks` — because whether a roll is playable depends on it.
      notes.push({ t, lane, dur: holdBeats * spb, flick: FLICK.NONE, accent: hit.accent });
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
 * Turn some of a finished note map into flicks.
 *
 * A flick is only playable if the key it rolls *onto* is free for the length of
 * the roll — otherwise the roll and the next note fight over the same finger,
 * and the player cannot do both. So flicks are placed last, against the
 * finished map, where that is knowable.
 *
 * They are also placed in figures rather than at random. A lone flick is a
 * full stop at the end of a phrase; a pair alternates direction; a sweep walks
 * one direction across the lanes. Those read at a glance and are the reason
 * flicks feel like something you play rather than something you survive.
 */
function paintFlicks(notes, profile, rnd) {
  if (profile.flickRate <= 0) return 0;

  // When each channel is next busy, so a roll never lands on an occupied key.
  const busy = new Map();
  const claim = (ch, from, to) => {
    if (!busy.has(ch)) busy.set(ch, []);
    busy.get(ch).push([from, to]);
  };
  const free = (ch, from, to) =>
    !(busy.get(ch) || []).some(([a, b]) => from < b - EPS && to > a + EPS);

  for (const n of notes) claim(n.lane, n.t, n.t + n.dur);

  /**
   * Can this note roll `dir` without colliding with anything? The destination
   * must be free for the roll itself *and* for a moment beforehand, so the
   * other hand has finished with that key before the roll lands on it.
   */
  const canFlick = (n, dir) => {
    const ch = flickChannel(n.lane, dir);
    if (ch < 0) return false;
    return free(ch, n.t - FLICK_CLEARANCE, n.t + FLICK_WINDOW);
  };

  const setFlick = (n, dir) => {
    n.flick = dir;
    claim(flickChannel(n.lane, dir), n.t - FLICK_CLEARANCE, n.t + FLICK_WINDOW);
  };

  // Flicks land on notes the music stresses, and never on a hold: a hold's
  // finger is already committed for its whole length.
  const eligible = notes.filter((n) => !n.isHold && n.dur === 0);
  let placed = 0;

  for (let i = 0; i < eligible.length; i++) {
    const n = eligible[i];
    if (n.flick) continue;
    const weight = n.accent ? 1.5 : 0.7;
    if (rnd() >= profile.flickRate * weight) continue;

    // Sideways rolls read better than downward ones, so prefer them when the
    // neighbouring key is free; down is the fallback that always exists.
    const dirs = flicksFor(n.lane).filter((d) => canFlick(n, d));
    if (!dirs.length) continue;
    const sideways = dirs.filter((d) => d !== FLICK.DOWN);
    const pool = sideways.length && rnd() < 0.7 ? sideways : dirs;
    const dir = pool[Math.floor(rnd() * pool.length)];
    setFlick(n, dir);
    placed++;

    // --- figures ------------------------------------------------------------
    // Having committed to one flick, try to make it part of a shape. Both
    // figures only extend onto notes that are close enough to read as one
    // gesture, so they never turn into a scattering of arrows.
    const near = (a, b) => b && b.t - a.t > EPS && b.t - a.t < 1.2;
    if (rnd() < 0.55) {
      // A pair that answers itself: roll out, then roll back.
      const back = dir === FLICK.LEFT ? FLICK.RIGHT : dir === FLICK.RIGHT ? FLICK.LEFT : FLICK.DOWN;
      const next = eligible[i + 1];
      if (near(n, next) && !next.flick && canFlick(next, back)) {
        setFlick(next, back);
        placed++;
        i += 1;
      }
    } else if (dir !== FLICK.DOWN) {
      // A sweep: the same direction, stepping across the lanes.
      let prev = n;
      for (let k = i + 1; k < eligible.length && k <= i + 3; k++) {
        const next = eligible[k];
        if (!near(prev, next) || next.flick || !canFlick(next, dir)) break;
        if (Math.abs(next.lane - prev.lane) !== 1) break;
        setFlick(next, dir);
        placed++;
        prev = next;
        i = k;
      }
    }
  }
  return placed;
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
  const chart = finalise(second.notes, def, difficulty, spb);
  chart.flicks = paintFlicks(chart.notes, profile, mulberry32(seed ^ 0x9e3779b9));
  return chart;
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
    flicks: cleaned.filter((n) => n.flick).length,
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
 * Density is most of it; flicks are the rest, since a flick costs a whole
 * gesture rather than a keypress.
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
  const fps = chart.notes.filter((n) => n.flick).length / Math.max(1, duration);
  return clamp(Math.round(nps * 2.6 + peak * 0.55 + fps * 6), 1, 45);
}
