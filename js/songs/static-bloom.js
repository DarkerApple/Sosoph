// "Static Bloom" — 158 BPM rock in D minor.
//
// Guitar-shaped: power-chord stabs on the backbeat, a bass that doubles the
// riff and a lead that answers the vocal line. The chart puts its weight on the
// snare, so it plays like drumming along rather than like reading a melody.

import { Composer, assemble, chordOn, voice, SCALES } from '../music.js';

const BPM = 158;
const BARS = 56;
const ROOT = 62;

const DEGREES = [0, 6, 5, 3];
const BASS = [38, 36, 33, 43];
const chordAt = (bar) => voice(chordOn(ROOT, SCALES.minor, DEGREES[bar % 4], 3), 57, 76);

const RIFF = [
  [62, null, 62, 65, null, 62, null, 69],
  [60, null, 60, 65, null, 60, null, 67],
  [57, null, 57, 60, null, 57, null, 64],
  [65, null, 65, 69, null, 67, null, 65],
];

const VOX = [
  [77, null, 74, null, 72, null, 74, null],
  [69, null, 72, null, 74, null, null, null],
  [74, null, 77, null, 79, null, 77, null],
  [74, null, null, null, null, null, null, null],
  [81, null, 79, 77, null, 74, null, null],
  [77, null, 74, null, 72, null, 74, null],
  [79, 81, 82, null, 81, null, 79, null],
  [77, null, null, null, null, null, null, null],
];

const SECTIONS = [
  { name: 'count', bar: 0, bars: 4, intensity: 0.35 },
  { name: 'verse', bar: 4, bars: 12, intensity: 0.6 },
  { name: 'pre', bar: 16, bars: 4, intensity: 0.8 },
  { name: 'chorus', bar: 20, bars: 12, intensity: 1 },
  { name: 'bridge', bar: 32, bars: 8, intensity: 0.45 },
  { name: 'last', bar: 40, bars: 12, intensity: 1 },
  { name: 'out', bar: 52, bars: 4, intensity: 0.4 },
];

const secOf = (bar) => SECTIONS.find((s) => bar >= s.bar && bar < s.bar + s.bars) || SECTIONS[0];

export default function build() {
  const c = new Composer({ bpm: BPM, bars: BARS });

  for (let bar = 0; bar < BARS; bar++) {
    const sec = secOf(bar).name;
    const ch = chordAt(bar);
    const loud = sec === 'chorus' || sec === 'last';
    const playing = sec !== 'bridge' || bar >= 36;

    if (sec === 'bridge') c.padBar(bar, ch, { kind: 'choir', gain: 0.9 });
    else c.padBar(bar, ch, { gain: 0.35 });

    if (playing) {
      c.drumBar(bar, {
        kick: loud ? 'x--x--x-x--x----' : 'x-----x---x-----',
        snare: '----x-------x---',
        hat: loud ? 'x-x-x-x-x-x-x-xo' : 'x-x-x-x-x-x-x-x-',
      }, { hatGain: 0.8 });
    }

    // Power chords tracking the riff, plus the riff itself in the bass.
    if (playing) {
      const row = RIFF[bar % 4];
      for (let j = 0; j < 8; j++) {
        const n = row[j];
        if (n == null) continue;
        const b = c.at(bar) + j * 0.5;
        c.E(b, 'bass', { n: n - 12, d: 0.35 * c.spb, g: 1 });
        c.E(b, 'stab', { n: [n, n + 7], d: 0.3 * c.spb, g: loud ? 0.7 : 0.5 });
        c.H(b, { layer: 'arp', pitch: n + 12, weight: c.w(j * 0.5) * 0.85, accent: j === 3 || j === 7 });
      }
    }

    const idx = sec === 'verse' ? bar - 4 : sec === 'chorus' ? bar - 20 : sec === 'last' ? bar - 40 + 4 : -1;
    if (idx >= 0) {
      c.line(bar, VOX[idx % VOX.length], {
        gain: loud ? 1.05 : 0.7,
        double: loud ? { kind: 'piano', octave: 0, gain: 0.4 } : null,
        holdMin: 1.5,
        accentOn: [1, 3],
      });
    }

    if ([0, 20, 40].includes(bar)) c.E(c.at(bar), 'crash', { g: bar === 0 ? 0.6 : 1 });
    if (bar === 19 || bar === 39) {
      for (let j = 0; j < 4; j++) c.E(c.at(bar) + 3 + j * 0.25, 'tom', { n: 45 + j * 3, g: 0.9 });
    }
  }

  // The bridge drops the band out for four bars; hold the vocal over it.
  for (let bar = 32; bar < 36; bar++) {
    const ch = chordAt(bar);
    c.E(c.at(bar), 'piano', { n: ch[2] + 12, d: 2.6 * c.spb, g: 0.65 });
    c.H(c.at(bar), { layer: 'lead', pitch: ch[2] + 12, weight: 0.93, hold: 2 });
    c.H(c.at(bar) + 2.5, { layer: 'lead', pitch: ch[0] + 12, weight: 0.8, accent: bar % 2 === 0 });
  }

  // Four bars of stick count-in at the top, played as quarter notes.
  for (let bar = 0; bar < 4; bar++) {
    for (let b = 0; b < 4; b++) {
      c.E(c.at(bar) + b, 'hat', { g: b === 0 ? 1 : 0.6 });
      if (bar >= 2) c.H(c.at(bar) + b, { layer: 'lead', pitch: [62, 65, 69, 65][b], weight: 0.9, accent: b === 2 });
    }
  }

  return assemble(c, {
    id: 'static-bloom',
    title: 'Static Bloom',
    artist: 'Sosoph Synth',
    genre: 'Rock',
  }, SECTIONS);
}
