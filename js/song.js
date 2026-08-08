// Stage 1 — "Neon Drift".
//
// The soundtrack and the note map are generated together from a single musical
// grid, so every note the player taps corresponds to something they can
// actually hear. Times are authored in beats and converted to seconds once.

import { clamp } from './util.js';

const BPM = 128;
const SPB = 60 / BPM; // seconds per beat
const BARS = 48;
const BEATS = BARS * 4; // 192 beats ~= 90 s

// Four-bar loop: Am - F - C - G.
const BASS_ROOT = [45, 41, 48, 43];
const PAD_CHORD = [
  [57, 60, 64, 69],
  [53, 57, 60, 65],
  [55, 60, 64, 67],
  [55, 59, 62, 67],
];
const ARP_POOL = [
  [69, 72, 76, 81],
  [65, 69, 72, 77],
  [67, 72, 76, 79],
  [67, 71, 74, 79],
];
const ARP_SHAPE = [0, 1, 2, 3, 2, 1, 2, 3];

// Twelve bars of lead melody, one slot per eighth note. `null` is a rest, and
// a run of rests after a pitch becomes a hold note in the chart.
const MELODY = [
  [81, null, 79, 76, null, 76, 79, null],
  [77, null, 76, 72, null, 72, 76, null],
  [79, null, 76, 79, null, 81, 79, null],
  [74, null, 71, 74, 76, null, null, null],
  [81, null, 79, 76, null, 76, 79, 81],
  [84, null, 81, 77, null, 76, null, null],
  [79, null, 81, 84, null, 83, 81, null],
  [79, null, 76, 74, null, 71, null, null],
  [76, null, 79, 81, null, 79, 76, null],
  [77, null, 76, 72, null, 74, 76, null],
  [79, null, 79, 81, 83, null, 84, null],
  [83, null, 81, 79, null, 76, null, null],
];

const SECTIONS = [
  { name: 'intro', bar: 0, bars: 4, intensity: 0.15 },
  { name: 'verse', bar: 4, bars: 8, intensity: 0.4 },
  { name: 'build', bar: 12, bars: 4, intensity: 0.7 },
  { name: 'chorus', bar: 16, bars: 12, intensity: 1.0 },
  { name: 'break', bar: 28, bars: 4, intensity: 0.3 },
  { name: 'final', bar: 32, bars: 12, intensity: 1.0 },
  { name: 'outro', bar: 44, bars: 4, intensity: 0.35 },
];

const sectionOfBar = (bar) =>
  SECTIONS.find((s) => bar >= s.bar && bar < s.bar + s.bars) || SECTIONS[0];

export function buildStage1() {
  const events = [];
  const notes = [];

  /** Emit an audio event at an absolute beat position. */
  const E = (beat, k, opts = {}) =>
    events.push({ t: beat * SPB, k, g: 1, ...opts });

  /** Emit a chart note. `hold` is measured in beats (0 for a tap). */
  const N = (beat, lane, hold = 0) =>
    notes.push({ t: beat * SPB, lane, dur: hold * SPB });

  // ======================================================== soundtrack ====

  for (let bar = 0; bar < BARS; bar++) {
    const b0 = bar * 4;
    const chord = bar % 4;
    const sec = sectionOfBar(bar).name;
    const root = BASS_ROOT[chord];

    // --- pads: the harmonic bed, present almost everywhere ---------------
    const padGain =
      sec === 'intro' ? 0.9 : sec === 'break' ? 1.0 : sec === 'outro' ? 0.85 : 0.5;
    E(b0, 'pad', { n: PAD_CHORD[chord], d: 3.7 * SPB, g: padGain });

    // --- drums -----------------------------------------------------------
    if (sec === 'verse' || sec === 'build' || sec === 'chorus' || sec === 'final') {
      const fourOnFloor = !(sec === 'verse' && bar < 6);
      const beats = fourOnFloor ? [0, 1, 2, 3] : [0, 2];
      for (const b of beats) E(b0 + b, 'kick', { g: 1 });
      // Syncopated pickup kick keeps the busier sections moving.
      if ((sec === 'chorus' || sec === 'final') && bar % 2 === 1) {
        E(b0 + 2.75, 'kick', { g: 0.75 });
      }
      if (sec === 'final') E(b0 + 3.5, 'kick', { g: 0.6 });
    } else if (sec === 'outro' && bar === 44) {
      E(b0, 'kick', { g: 1 });
      E(b0 + 2, 'kick', { g: 0.8 });
    } else if (sec === 'outro' && bar === 45) {
      E(b0, 'kick', { g: 0.7 });
    } else if (sec === 'break' && bar >= 30) {
      E(b0, 'kick', { g: 0.6 });
      E(b0 + 2, 'kick', { g: 0.6 });
    }

    if (sec === 'verse' && bar >= 8) {
      E(b0 + 1, 'snare', { g: 0.85 });
      E(b0 + 3, 'snare', { g: 0.85 });
    }
    if (sec === 'build' || sec === 'chorus' || sec === 'final') {
      E(b0 + 1, 'clap', { g: 1 });
      E(b0 + 3, 'clap', { g: 1 });
    }

    // --- hats: density is the main driver of perceived energy ------------
    let hatStep = 0;
    if (sec === 'intro') hatStep = bar >= 2 ? 0.5 : 0;
    else if (sec === 'verse') hatStep = 0.5;
    else if (sec === 'build') hatStep = bar >= 14 ? 0.25 : 0.5;
    else if (sec === 'chorus') hatStep = 0.5;
    else if (sec === 'final') hatStep = 0.25;
    else if (sec === 'break') hatStep = bar >= 30 ? 0.5 : 1;
    else if (sec === 'outro') hatStep = bar < 46 ? 0.5 : 0;

    if (hatStep > 0) {
      for (let b = 0; b < 4; b += hatStep) {
        const offbeat = b % 1 !== 0;
        const open = b === 3.5 && (sec === 'chorus' || sec === 'final');
        E(b0 + b, 'hat', { g: open ? 1 : offbeat ? 0.75 : 1, open });
      }
    }

    // --- bass ------------------------------------------------------------
    if ((sec === 'verse' && bar >= 6) || sec === 'build' || sec === 'chorus' || sec === 'final') {
      const octave = [0, 0, 0, 12, 0, 0, 12, 0];
      for (let j = 0; j < 8; j++) {
        E(b0 + j * 0.5, 'bass', { n: root + octave[j], d: 0.42 * SPB, g: 1 });
      }
    } else if (sec === 'outro' && bar < 46) {
      E(b0, 'bass', { n: root, d: 3.5 * SPB, g: 0.8 });
    }

    // --- arpeggio --------------------------------------------------------
    const arpOn =
      (sec === 'verse' && bar >= 8) || sec === 'build' || sec === 'chorus' ||
      sec === 'break' || sec === 'final';
    if (arpOn) {
      const pool = ARP_POOL[chord];
      const g = sec === 'break' ? 0.7 : 1;
      for (let j = 0; j < 8; j++) {
        E(b0 + j * 0.5, 'pluck', { n: pool[ARP_SHAPE[j]], d: 0.45 * SPB, g });
      }
    }

    // --- lead melody -----------------------------------------------------
    if (sec === 'chorus' || sec === 'final') {
      const row = MELODY[bar - (sec === 'chorus' ? 16 : 32)];
      for (let j = 0; j < 8; j++) {
        const p = row[j];
        if (p == null) continue;
        // Sustain through any following rests.
        let len = 1;
        while (j + len < 8 && row[j + len] == null) len++;
        E(b0 + j * 0.5, 'lead', {
          n: p,
          d: len * 0.5 * SPB * 0.92,
          g: sec === 'final' ? 1.1 : 1,
        });
      }
    }

    // --- transitions -----------------------------------------------------
    if (bar === 0 || bar === 16 || bar === 24 || bar === 32 || bar === 40 || bar === 44) {
      E(b0, 'crash', { g: bar === 0 ? 0.6 : 1 });
    }
    if (bar === 14) E(b0, 'riser', { d: 8 * SPB, g: 1 });
    if (bar === 31) E(b0, 'riser', { d: 4 * SPB, g: 0.9 });
  }

  // ========================================================== note map ====

  // Pitch -> lane. The melody's playable range is mapped across the four lanes
  // so the chart traces the tune's contour instead of feeling random.
  const LO = 69;
  const SPAN = 16;
  let lastLane = -1;
  let repeats = 0;
  let nudge = 1;

  function laneForPitch(m) {
    let lane = clamp(Math.floor(((m - LO) / SPAN) * 4), 0, 3);
    if (lane === lastLane) {
      repeats++;
      // Two in a row is a nice trill; three starts to feel like a stutter.
      if (repeats >= 2) {
        // Alternate which way we step aside, otherwise every displaced note
        // drifts toward the middle two lanes.
        nudge = -nudge;
        lane = clamp(lane + nudge, 0, 3);
        if (lane === lastLane) lane = clamp(lane - nudge * 2, 0, 3);
        repeats = 0;
      }
    } else {
      repeats = 0;
    }
    lastLane = lane;
    return lane;
  }

  // --- verse: quarter notes riding the kick -----------------------------
  [16, 18, 20, 22].forEach((b, i) => N(b, [0, 3, 1, 2][i]));

  const walk = [0, 1, 2, 3, 3, 2, 1, 0];
  for (let i = 0; i < 8; i++) N(24 + i, walk[i]);

  // Bars 8-9: quarters with an offbeat lift.
  const liftBeats = [0, 1, 1.5, 2, 3, 3.5];
  const liftLanes = [
    [0, 2, 3, 1, 3, 2],
    [3, 1, 0, 2, 0, 1],
  ];
  for (let bar = 0; bar < 2; bar++) {
    liftBeats.forEach((b, i) => N(32 + bar * 4 + b, liftLanes[bar][i]));
  }

  // Bars 10-11: first continuous eighths, closing on a hold.
  for (let i = 0; i < 8; i++) N(40 + i * 0.5, [0, 1, 2, 3, 0, 1, 2, 3][i]);
  [3, 2, 1, 0].forEach((lane, i) => N(44 + i * 0.5, lane));
  N(46, 1, 1.5);

  // --- build: eighths tightening into a sixteenth roll -------------------
  [0, 3, 0, 3, 1, 2, 1, 2].forEach((lane, i) => N(48 + i * 0.5, lane));
  [3, 0, 3, 0, 2, 1, 2, 1].forEach((lane, i) => N(52 + i * 0.5, lane));
  N(53, 3); // jumps land with the claps
  N(55, 0);

  [0, 1, 2, 3, 0, 1].forEach((lane, i) => N(56 + i * 0.5, lane));
  [3, 2, 1, 0].forEach((lane, i) => N(59 + i * 0.25, lane));

  [0, 1, 2, 3].forEach((lane, i) => N(60 + i * 0.5, lane));
  [0, 3, 1, 2, 0, 3, 1, 2].forEach((lane, i) => N(62 + i * 0.25, lane));

  /**
   * Turns twelve bars of melody into notes: pitches drive the lanes, trailing
   * rests become holds, and the claps on beats 2 and 4 become two-lane jumps.
   */
  function chartMelody(startBeat, { jumpEveryClap, pickups }) {
    for (let bar = 0; bar < 12; bar++) {
      const b0 = startBeat + bar * 4;
      const row = MELODY[bar];
      for (let j = 0; j < 8; j++) {
        const p = row[j];
        if (p == null) continue;
        let rest = 0;
        while (j + rest + 1 < 8 && row[j + rest + 1] == null) rest++;
        const lane = laneForPitch(p);
        // Only sustains of a full beat or more are worth a hold note.
        const hold = rest >= 2 ? rest * 0.5 : 0;
        N(b0 + j * 0.5, lane, hold);

        const isClap = j === 2 || j === 6;
        if (isClap && !hold && (jumpEveryClap || bar % 2 === 1)) {
          N(b0 + j * 0.5, 3 - lane);
        }
      }
      // Sixteenth pickup into the next bar, second half of the section only.
      if (pickups && bar >= 4 && bar % 2 === 1) {
        N(b0 + 3.75, bar % 4 === 1 ? 0 : 3);
      }
    }
  }

  chartMelody(64, { jumpEveryClap: false, pickups: false });

  // --- break: long holds, room to breathe -------------------------------
  N(112, 0, 3);
  N(115, 3);
  N(116, 3, 3);
  N(119, 0);
  [1, 2, 1, 2].forEach((lane, i) => N(120 + i * 0.5, lane));
  N(122, 0, 1.5);
  [0, 1, 2, 3, 0, 1, 2, 3].forEach((lane, i) => N(126 + i * 0.25, lane));

  // --- final chorus: same tune, more teeth ------------------------------
  lastLane = -1;
  repeats = 0;
  chartMelody(128, { jumpEveryClap: true, pickups: true });

  // --- outro: wind down onto a two-lane hold ----------------------------
  [0, 1, 2].forEach((lane, i) => N(176 + i, lane));
  N(179, 3, 1);
  N(180, 3);
  N(181, 0);
  N(182, 1, 2);
  N(184, 0, 3);
  N(184, 3, 3);

  // ---------------------------------------------------------- normalise ---

  notes.sort((a, b) => a.t - b.t || a.lane - b.lane);

  // Drop exact duplicates and cap chords at two lanes so nothing becomes
  // physically awkward on a four-key layout.
  const cleaned = [];
  let chordStart = 0;
  for (const n of notes) {
    const prev = cleaned[cleaned.length - 1];
    if (prev && Math.abs(prev.t - n.t) < 1e-4 && prev.lane === n.lane) continue;
    if (!prev || Math.abs(prev.t - n.t) >= 1e-4) chordStart = cleaned.length;
    if (cleaned.length - chordStart >= 2) continue;
    cleaned.push(n);
  }

  cleaned.forEach((n, i) => {
    n.id = i;
    n.isHold = n.dur > 0.001;
  });

  events.sort((a, b) => a.t - b.t);

  return {
    id: 'stage-1',
    name: 'Neon Drift',
    artist: 'Sosoph Synth Engine',
    difficulty: 'Stage 1 · Normal',
    level: 4,
    bpm: BPM,
    spb: SPB,
    events,
    notes: cleaned,
    duration: BEATS * SPB + 3.2,
    sections: SECTIONS.map((s) => ({
      ...s,
      start: s.bar * 4 * SPB,
      end: (s.bar + s.bars) * 4 * SPB,
    })),
    /** Scoring counts a hold's head and tail separately. */
    get units() {
      return this.notes.reduce((a, n) => a + (n.isHold ? 2 : 1), 0);
    },
  };
}

export function intensityAt(song, t) {
  for (const s of song.sections) {
    if (t >= s.start && t < s.end) return s.intensity;
  }
  return 0.2;
}
