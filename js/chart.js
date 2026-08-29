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
 *   layers        minimum weight a hit needs to survive, per source layer;
 *                 a layer that is absent is dropped entirely
 *   grid          smallest spacing between consecutive notes, in beats
 *   floorSec      absolute spacing floor, so fast songs stay physical
 *   maxChord      how many lanes may fire at once
 *   holds         whether sustains become hold notes
 *   colorRate     fraction of accent-eligible notes that become coloured
 *   rowSwitchSec  a finger needs this long to move between the two key rows
 */
export const PROFILES = {
  easy: {
    layers: { lead: 0.72, snare: 0.7, kick: 0.85, stab: 0.7 },
    grid: 1, floorSec: 0.3, maxChord: 1, holds: true,
    // Quarter notes leave plenty of room, so EASY can still teach the colour
    // keys without ever asking for a fast row change.
    colorRate: 0.22, rowSwitchSec: 0.3, holdMinBeats: 1.5,
  },
  normal: {
    layers: { lead: 0.45, snare: 0.5, kick: 0.7, stab: 0.5, arp: 0.85 },
    grid: 0.5, floorSec: 0.16, maxChord: 2, holds: true,
    colorRate: 0.3, rowSwitchSec: 0.24, holdMinBeats: 1,
  },
  hard: {
    layers: { lead: 0.2, snare: 0.35, kick: 0.5, stab: 0.3, arp: 0.6, bass: 0.75 },
    grid: 0.25, floorSec: 0.1, maxChord: 2, holds: true,
    colorRate: 0.42, rowSwitchSec: 0.16, holdMinBeats: 1,
  },
  expert: {
    layers: { lead: 0, snare: 0.2, kick: 0.35, stab: 0.15, arp: 0.35, bass: 0.5 },
    grid: 0.25, floorSec: 0.075, maxChord: 2, holds: true,
    colorRate: 0.5, rowSwitchSec: 0.13, holdMinBeats: 0.75,
  },
  master: {
    layers: { lead: 0, snare: 0, kick: 0.2, stab: 0, arp: 0.2, bass: 0.35 },
    grid: 0.25, floorSec: 0.06, maxChord: 2, holds: true,
    colorRate: 0.62, rowSwitchSec: 0.11, holdMinBeats: 0.75,
  },
};

const EPS = 1e-4;

/**
 * Which physical finger a note needs: lane keys and colour keys sit in two rows
 * under the same four fingers, so lane 0 (D) and red (C) are both the left
 * middle finger and can never be asked for at once.
 */
const fingerOf = (note) => (note.color === PLAIN ? note.lane : homeLaneOf(note.color));
const rowOf = (note) => (note.color === PLAIN ? 0 : 1);

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
  /** `bounds` are the three pitches that split the song into four lanes. */
  constructor(bounds) {
    this.bounds = bounds;
    this.last = -1;
    this.repeats = 0;
    this.nudge = 1;
    this.walk = 0;
  }

  pick(hit, taken) {
    let lane;
    if (hit.pitch != null) {
      lane = this.bounds.findIndex((b) => hit.pitch < b);
      if (lane < 0) lane = LANE_COUNT - 1;
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

    // A lane already claimed by this chord steps outward to the nearest free one.
    if (taken.has(lane)) {
      let found = -1;
      for (let d = 1; d < LANE_COUNT && found < 0; d++) {
        for (const c of [lane - d, lane + d]) {
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
 * Build a note map from a song definition.
 *
 * `difficulty` selects a profile; `overrides` lets a song nudge one (a ballad
 * wants longer holds, a stream chart wants a tighter grid) without inventing a
 * whole new difficulty.
 */
export function buildChart(def, difficulty, overrides = {}) {
  const profile = { ...PROFILES[difficulty], ...overrides, layers: { ...PROFILES[difficulty].layers, ...(overrides.layers || {}) } };
  const spb = 60 / def.bpm;
  const rnd = mulberry32(hashSeed(`${def.id}:${difficulty}`));

  // Lane boundaries come from the quartiles of the pitches this difficulty will
  // actually use, not from the raw range. A linear split over min..max leaves
  // whole lanes idle whenever a song's melody clusters, which is most of them.
  const survives = (h) => {
    const min = profile.layers[h.layer];
    return min !== undefined && h.weight >= min;
  };
  const pitched = def.hits.filter((h) => h.pitch != null && survives(h))
    .map((h) => h.pitch).sort((a, b) => a - b);
  const quartile = (q) => (pitched.length ? pitched[Math.floor(pitched.length * q)] : 60 + q * 12);
  const picker = new LanePicker([quartile(0.25), quartile(0.5), quartile(0.75)]);

  const notes = [];
  let lastBeat = -Infinity;
  let lastTime = -Infinity;
  // Per-finger bookkeeping, so no finger is asked to change rows too quickly.
  const fingerTime = new Array(LANE_COUNT).fill(-Infinity);
  const fingerRow = new Array(LANE_COUNT).fill(0);
  let colorRun = 0;
  let colored = 0;

  for (const group of groupByBeat(def.hits)) {
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
      const note = { t, lane, dur: holdBeats * spb, color: PLAIN };

      // --- colour ----------------------------------------------------------
      // Colours are an accent, not a texture: they go on hits the music already
      // stresses, only when the finger has had time to drop to the lower row,
      // and never more than two in a row.
      const wantColor =
        profile.colorRate > 0 &&
        hit.accent &&
        colorRun < 2 &&
        rnd() < profile.colorRate;

      if (wantColor) {
        const f = lane;
        const settled = t - fingerTime[f] >= profile.rowSwitchSec - EPS || fingerRow[f] === 1;
        // A coloured hold would pin a finger on the lower row for its whole
        // length; keep sustains on the lane keys where they read cleanly.
        if (settled && holdBeats === 0) {
          note.color = colorOfLane(lane);
          colorRun++;
          colored++;
        } else {
          colorRun = 0;
        }
      } else {
        colorRun = 0;
      }

      const f = fingerOf(note);
      // Reject a note whose finger is still committed to the other row.
      if (fingerRow[f] !== rowOf(note) && t - fingerTime[f] < profile.rowSwitchSec - EPS) {
        if (note.color !== PLAIN) { colored--; colorRun = 0; }
        continue;
      }
      fingerTime[f] = t + note.dur;
      fingerRow[f] = rowOf(note);
      notes.push(note);
    }

    if (notes.length && Math.abs(notes[notes.length - 1].t - t) < EPS) {
      lastBeat = group.beat;
      lastTime = t;
    }
  }

  return finalise(notes, def, difficulty, spb, colored);
}

/**
 * A finger needs a moment to let a hold go and press again, so every hold is
 * trimmed to leave at least this many beats before the next note in its lane.
 * Without it a hold can end on the exact tick of the following note, which is
 * physically unplayable however good the player is.
 */
export const RELEASE_GAP_BEATS = 0.25;

/** Sort, de-duplicate, trim overlapping holds and attach derived fields. */
export function finalise(raw, def, difficulty, spb, colored = 0) {
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

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Rough difficulty number, so song cards do not need hand-maintained levels. */
export function ratingFor(chart, duration) {
  if (!chart.notes.length) return 1;
  const nps = chart.notes.length / Math.max(1, duration);
  let peak = 0;
  for (let i = 0; i < chart.notes.length; i++) {
    let c = 0;
    while (i + c < chart.notes.length && chart.notes[i + c].t - chart.notes[i].t < 1) c++;
    if (c > peak) peak = c;
  }
  const colorShare = chart.colored / chart.notes.length;
  return clamp(Math.round(nps * 2.6 + peak * 0.55 + colorShare * 6), 1, 34);
}
