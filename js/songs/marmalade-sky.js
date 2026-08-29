// "Marmalade Sky" — 96 BPM lo-fi in F, the gentlest song in the set.
//
// Sparse by design: a swung ride, brushed drums and an electric-piano voicing
// that leaves space between phrases. Long sustains make this the best song to
// learn hold notes on.

import { Composer, readMelody, gridWeight , assemble } from '../music.js';

const BPM = 96;
const BARS = 32;

// Fmaj7 – Em7 – Dm7 – G7, voiced once and reused.
const CHORDS = [
  [53, 60, 64, 69],
  [52, 59, 62, 67],
  [50, 57, 60, 65],
  [55, 59, 65, 69],
];
const BASS = [41, 40, 38, 43];

const TUNE = [
  [72, null, null, 69, null, 71, null, null],
  [67, null, null, null, 71, null, 69, null],
  [65, null, 67, 69, null, null, null, null],
  [67, null, null, null, null, null, null, null],
  [74, null, null, 72, null, 69, null, null],
  [71, null, null, null, 69, null, 67, null],
  [65, null, 67, 65, null, 62, null, null],
  [65, null, null, null, null, null, null, null],
];

const SECTIONS = [
  { name: 'intro', bar: 0, bars: 4, intensity: 0.15 },
  { name: 'a', bar: 4, bars: 8, intensity: 0.4 },
  { name: 'b', bar: 12, bars: 8, intensity: 0.62 },
  { name: 'solo', bar: 20, bars: 4, intensity: 0.5 },
  { name: 'a2', bar: 24, bars: 6, intensity: 0.68 },
  { name: 'outro', bar: 30, bars: 2, intensity: 0.2 },
];

const secOf = (bar) => SECTIONS.find((s) => bar >= s.bar && bar < s.bar + s.bars) || SECTIONS[0];

export default function build() {
  const c = new Composer({ bpm: BPM, bars: BARS });

  for (let bar = 0; bar < BARS; bar++) {
    const b0 = c.at(bar);
    const sec = secOf(bar).name;
    const ch = CHORDS[bar % 4];
    const root = BASS[bar % 4];
    const playing = sec !== 'intro' && sec !== 'outro';

    c.E(b0, 'pad', { n: ch, d: 3.8 * c.spb, g: playing ? 0.55 : 0.85 });
    c.E(b0, 'piano', { n: ch[0], d: 1.6 * c.spb, g: 0.7 });
    if (bar % 2 === 0) c.E(b0 + 2.5, 'piano', { n: ch[2], d: 1.2 * c.spb, g: 0.5 });

    if (playing) {
      // Swung eighths: the offbeat lands late, which is most of the feel.
      for (let b = 0; b < 4; b++) {
        c.E(b0 + b, 'ride', { g: b % 2 === 0 ? 0.9 : 0.6 });
        c.E(b0 + b + 0.62, 'ride', { g: 0.45 });
      }
      c.seq(bar, 'x-------o-x-----', (b, g) => {
        c.E(b, 'kick', { g: g * 0.85 });
        c.H(b, { layer: 'kick', weight: gridWeight(b - b0) * 0.92, accent: b === b0 });
      });
      for (const b of [1, 3]) {
        c.E(b0 + b, 'snare', { g: 0.55 });
        c.H(b0 + b, { layer: 'snare', weight: 0.84, accent: true });
      }
      c.seq(bar, 'x-----x---x-----', (b, g, i) => {
        const n = root + (i === 6 ? 7 : 0);
        c.E(b, 'bass', { n, d: 0.7 * c.spb, g: g * 0.9 });
        c.H(b, { layer: 'bass', pitch: n + 24, weight: gridWeight(b - b0) * 0.66 });
      });
    }

    // --- tune ---------------------------------------------------------------
    const idx = sec === 'a' ? bar - 4 : sec === 'b' ? bar - 12 : sec === 'a2' ? bar - 24 : -1;
    if (idx >= 0 && idx < TUNE.length) {
      for (const m of readMelody(TUNE[idx], 8)) {
        const b = b0 + m.beat;
        c.E(b, 'piano', { n: m.pitch, d: m.len * c.spb, g: 0.95 });
        c.E(b, 'bell', { n: m.pitch + 12, d: m.len * c.spb * 0.6, g: 0.3 });
        c.H(b, {
          layer: 'lead',
          pitch: m.pitch,
          weight: Math.min(0.95, gridWeight(m.beat) + 0.2),
          hold: m.len >= 1 ? Math.min(m.len, 3.5) : 0,
          accent: m.len >= 1.5 || m.beat === 2,
        });
      }
    }

    // --- solo: the one busy moment ------------------------------------------
    if (sec === 'solo') {
      const run = [72, 74, 76, 77, 79, 77, 76, 74];
      for (let j = 0; j < 8; j++) {
        const b = b0 + j * 0.5;
        const n = run[(j + bar * 3) % run.length];
        c.E(b, 'pluck', { n, d: 0.4 * c.spb, g: 0.75 });
        c.H(b, { layer: 'arp', pitch: n, weight: gridWeight(j * 0.5) * 0.9, accent: j % 4 === 0 });
      }
    }

    if (bar === 0 || bar === 12 || bar === 24) c.E(b0, 'crash', { g: 0.45 });
  }

  // The intro is deliberately bare musically, so give it a hand-written
  // skeleton rather than opening the song with ten seconds of empty field.
  [
    [2, 0, 69, 0], [2, 2, 72, 1.5], [3, 0, 74, 0], [3, 1.5, 72, 0], [3, 3, 69, 0],
  ].forEach(([bar, beat, pitch, hold], i) =>
    c.H(c.at(bar) + beat, { layer: 'lead', pitch, weight: 0.92, hold, accent: i === 1 })
  );

  return assemble(c, {
    id: 'marmalade-sky',
    title: 'Marmalade Sky',
    artist: 'Sosoph Synth',
    genre: 'Lo-fi',
    tail: 3,
  }, SECTIONS);
}
