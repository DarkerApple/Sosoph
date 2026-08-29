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

  /** Bar-position weight in this song's metre. */
  w(beatInBar) {
    return gridWeight(beatInBar, this.beatsPerBar);
  }

  // ------------------------------------------------------ arrangement kit --
  //
  // These cover the parts every song writes the same way — a drum bar, a bass
  // figure, an arpeggio, a sung line — so a song file is mostly the material
  // that makes it that song: its harmony, its patterns and its shape.

  /**
   * One bar of drums from step strings, tagging the hits a chart may use.
   * Recognised parts: kick, snare, clap, hat, ride, tom. In `hat`, `o` is an
   * open hat rather than a soft one.
   */
  drumBar(bar, kit, { hatGain = 0.8, tom = 45, weight = 0.9 } = {}) {
    const b0 = this.at(bar);
    if (kit.kick) this.seq(bar, kit.kick, (b, g) => {
      this.E(b, 'kick', { g });
      this.H(b, { layer: 'kick', weight: this.w(b - b0) * weight, accent: b === b0 });
    });
    for (const part of ['snare', 'clap']) {
      if (!kit[part]) continue;
      this.seq(bar, kit[part], (b, g) => {
        this.E(b, part, { g });
        this.H(b, { layer: 'snare', weight: 0.86, accent: true });
      });
    }
    if (kit.tom) this.seq(bar, kit.tom, (b, g, i) => {
      this.E(b, 'tom', { n: tom + (i % 4) * 3, g });
      this.H(b, { layer: 'snare', weight: 0.7 });
    });
    if (kit.hat) this.seq(bar, kit.hat, (b, g, i, ch) =>
      this.E(b, 'hat', { g: g * hatGain, open: ch === 'o' })
    );
    if (kit.ride) this.seq(bar, kit.ride, (b, g) => this.E(b, 'ride', { g }));
    return this;
  }

  /** One bar of bass. `pick(i, beat)` chooses the MIDI note for each step. */
  bassBar(bar, pattern, pick, { dur = 0.4, gain = 1, weight = 0.68 } = {}) {
    const b0 = this.at(bar);
    return this.seq(bar, pattern, (b, g, i) => {
      const n = pick(i, b - b0);
      this.E(b, 'bass', { n, d: dur * this.spb, g: g * gain });
      // Bass pitches are an octave or two below the melody; lifting them keeps
      // the whole song inside one lane-mapping range.
      this.H(b, { layer: 'bass', pitch: n + 24, weight: this.w(b - b0) * weight });
    });
  }

  /**
   * A sung or played line from a step grid, tagged as the chart's spine.
   * Sustains longer than `holdMin` beats become hold notes.
   */
  line(bar, row, {
    steps = 8, kind = 'lead', layer = 'lead', gain = 1, sustain = 0.92,
    double = null, holdMin = 1, accentOn = [1, 3], weightBoost = 0.15, holdMax = 4,
  } = {}) {
    const b0 = this.at(bar);
    for (const m of readMelody(row, steps, this.beatsPerBar)) {
      const b = b0 + m.beat;
      this.E(b, kind, { n: m.pitch, d: m.len * this.spb * sustain, g: gain });
      if (double) {
        this.E(b, double.kind, {
          n: m.pitch + (double.octave || 0) * 12,
          d: m.len * this.spb * sustain,
          g: double.gain ?? 0.5,
        });
      }
      this.H(b, {
        layer,
        pitch: m.pitch,
        weight: Math.min(0.96, this.w(m.beat) + weightBoost),
        hold: m.len >= holdMin ? Math.min(m.len, holdMax) : 0,
        accent: accentOn.some((a) => Math.abs(m.beat - a) < 1e-6),
      });
    }
    return this;
  }

  /** An arpeggio over `notes`, following `shape` as indices into them. */
  arpBar(bar, notes, shape, {
    kind = 'pluck', gain = 1, dur = 0.45, layer = 'arp', weight = 0.8,
    octave = 0, accentEvery = 0,
  } = {}) {
    const b0 = this.at(bar);
    const per = this.beatsPerBar / shape.length;
    shape.forEach((idx, j) => {
      if (idx == null) return;
      const b = b0 + j * per;
      const n = notes[idx % notes.length] + octave * 12;
      this.E(b, kind, { n, d: dur * this.spb, g: gain });
      this.H(b, {
        layer,
        pitch: n,
        weight: this.w(j * per) * weight,
        accent: accentEvery > 0 && j % accentEvery === 0,
      });
    });
    return this;
  }

  /** Sustained harmony under a bar. Never tagged: pads are not playable. */
  padBar(bar, chord, { kind = 'pad', beats = null, gain = 0.6, octave = 0 } = {}) {
    const len = beats ?? this.beatsPerBar - 0.3;
    return this.E(this.at(bar), kind, {
      n: chord.map((n) => n + octave * 12),
      d: len * this.spb,
      g: gain,
    });
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
export function gridWeight(beatInBar, perBar = 4) {
  const eps = 1e-6;
  const b = ((beatInBar % perBar) + perBar) % perBar;
  if (Math.abs(b) < eps) return 0.95;
  // The half-bar is the second-strongest position in any even metre; in 3/4
  // there is no such beat and the other quarters share one weight.
  if (perBar % 2 === 0 && Math.abs(b - perBar / 2) < eps) return 0.82;
  if (Math.abs(b % 1) < eps) return 0.7;
  if (Math.abs(b % 0.5) < eps) return 0.45;
  return 0.24;
}

/**
 * Assemble a finished song definition from a composer and its metadata. Every
 * song ends the same way, so this keeps the per-file boilerplate to the parts
 * that actually differ.
 */
export function assemble(c, meta, sections) {
  const barLen = c.beatsPerBar * c.spb;
  return {
    ...meta,
    bpm: c.bpm,
    spb: c.spb,
    bars: c.bars,
    beats: c.beats,
    beatsPerBar: c.beatsPerBar,
    events: c.events.sort((a, b) => a.t - b.t),
    hits: c.hits,
    // A tail past the last bar so the final note is not judged against the very
    // end of the transport.
    duration: c.beats * c.spb + (meta.tail ?? 3),
    sections: sections.map((s) => ({
      ...s,
      start: s.bar * barLen,
      end: (s.bar + s.bars) * barLen,
    })),
  };
}
