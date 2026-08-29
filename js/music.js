// Authoring helpers shared by every song.
//
// A song file describes music, not a chart: it emits audio events on a beat
// grid and, alongside them, tags the moments a player could plausibly be asked
// to hit. `chart.js` turns those tagged moments into a note map per difficulty,
// which is why every note in the game lines up with something audible.

/** Step characters: `x` hit, `X` accent, `o` soft, anything else a rest. */
const STEP_GAIN = { x: 1, X: 1.18, o: 0.6, s: 0.42 };

export class Composer {
  constructor({ bpm, bars, beatsPerBar = 4 }) {
    this.bpm = bpm;
    this.spb = 60 / bpm;
    this.bars = bars;
    this.beatsPerBar = beatsPerBar;
    this.beats = bars * beatsPerBar;
    this.events = [];
    this.hits = [];
  }

  /** Absolute beat for `bar` + `beat` within it. */
  at(bar, beat = 0) {
    return bar * this.beatsPerBar + beat;
  }

  /** Emit an audio event. `beat` is absolute; times are converted once, here. */
  E(beat, kind, opts = {}) {
    this.events.push({ t: beat * this.spb, k: kind, g: 1, ...opts });
    return this;
  }

  /**
   * Tag a playable moment.
   *
   *   layer   which instrument it came from, used to pick difficulty layers
   *   pitch   drives lane assignment, so the chart traces the melody's contour
   *   weight  0..1 importance; the highest-weight hits survive on EASY
   *   hold    sustain in beats, promoted to a hold note when long enough
   *   accent  eligible to become a coloured note
   */
  H(beat, { layer = 'lead', pitch = null, weight = 0.5, hold = 0, accent = false } = {}) {
    this.hits.push({ beat, layer, pitch, weight, hold, accent });
    return this;
  }

  /** Emit an audio event and tag it as playable in one call. */
  EH(beat, kind, opts, hit) {
    this.E(beat, kind, opts);
    this.H(beat, hit);
    return this;
  }

  /**
   * Walk a step-sequencer string. `"x-x-x-x-"` over a 4/4 bar fires on every
   * eighth. The callback receives the absolute beat and a gain from the
   * character, so accents stay visible in the source.
   */
  seq(bar, pattern, cb) {
    const steps = pattern.length;
    const per = this.beatsPerBar / steps;
    const b0 = this.at(bar);
    for (let i = 0; i < steps; i++) {
      const g = STEP_GAIN[pattern[i]];
      if (!g) continue;
      cb(b0 + i * per, g, i, pattern[i]);
    }
    return this;
  }

  /** Repeat `fn(bar, index)` over a bar range. */
  bars_(from, count, fn) {
    for (let i = 0; i < count; i++) fn(from + i, i);
    return this;
  }
}

// ------------------------------------------------------------- harmony ----

/** Semitone offsets from the root for the modes the songs use. */
export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
};

/** Scale degree (0-based, may exceed one octave or go negative) -> MIDI. */
export function degree(root, scale, d) {
  const n = scale.length;
  const oct = Math.floor(d / n);
  return root + oct * 12 + scale[((d % n) + n) % n];
}

/** Stacked-thirds triad or seventh built on a scale degree. */
export function chordOn(root, scale, d, size = 3) {
  const out = [];
  for (let i = 0; i < size; i++) out.push(degree(root, scale, d + i * 2));
  return out;
}

/** Drop a voicing into a comfortable register without changing its colour. */
export function voice(chord, low = 55, high = 74) {
  return chord.map((m) => {
    let v = m;
    while (v < low) v += 12;
    while (v > high) v -= 12;
    return v;
  }).sort((a, b) => a - b);
}

/**
 * Expand a melody grid into pitched events. Each row is one bar of `steps`
 * slots; `null` is a rest, and a pitch sustains through the rests that follow
 * it — which is exactly the information the chart builder needs to decide
 * where hold notes belong.
 */
export function readMelody(row, steps, beatsPerBar = 4) {
  const per = beatsPerBar / steps;
  const out = [];
  for (let i = 0; i < steps; i++) {
    const p = row[i];
    if (p == null) continue;
    let len = 1;
    while (i + len < steps && row[i + len] == null) len++;
    out.push({ step: i, beat: i * per, pitch: p, len: len * per });
  }
  return out;
}

/**
 * How structurally important a position in the bar is. The chart builder keeps
 * the highest-weight hits at low difficulties, so this is what makes EASY land
 * on downbeats and EXPERT fill in the sixteenths.
 */
export function gridWeight(beatInBar) {
  const eps = 1e-6;
  const b = ((beatInBar % 4) + 4) % 4;
  if (Math.abs(b) < eps) return 0.95;
  if (Math.abs(b - 2) < eps) return 0.82;
  if (Math.abs(b % 1) < eps) return 0.7;
  if (Math.abs(b % 0.5) < eps) return 0.45;
  return 0.24;
}
