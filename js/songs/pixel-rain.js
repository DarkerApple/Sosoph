// "Pixel Rain" — 150 BPM chiptune in C minor.
//
// Square-wave leads over a walking bass, with the arpeggio doing the harmonic
// work a pad would normally do. Fast but forgiving: the melody sits on eighths
// almost throughout, so the difficulty comes from density rather than rhythm.

import { Composer, assemble, chordOn, voice, SCALES } from '../music.js';

const BPM = 150;
const BARS = 56;
const ROOT = 60;

// Cm – Ab – Eb – Bb, the chiptune workhorse.
const DEGREES = [0, 5, 2, 6];
const BASS = [36, 32, 39, 34];
const chordAt = (bar) => voice(chordOn(ROOT, SCALES.minor, DEGREES[bar % 4], 4), 55, 79);

const TUNE = [
  [72, 75, 79, 75, 72, null, 70, 72],
  [70, 72, 75, 72, 70, null, 67, 70],
  [75, 79, 82, 79, 75, null, 74, 75],
  [74, null, 72, 70, null, null, null, null],
  [72, 75, 79, 84, 82, null, 79, 75],
  [77, 79, 82, 79, 77, null, 75, 74],
  [75, 77, 79, 82, 84, null, 86, 84],
  [82, null, 79, 75, null, null, null, null],
];

const RIFF = [
  [null, 0, 1, 2, null, 2, 1, 0],
  [null, 2, 1, 0, null, 0, 1, 2],
];

const SECTIONS = [
  { name: 'boot', bar: 0, bars: 4, intensity: 0.2 },
  { name: 'stage', bar: 4, bars: 12, intensity: 0.55 },
  { name: 'rise', bar: 16, bars: 4, intensity: 0.75 },
  { name: 'clear', bar: 20, bars: 16, intensity: 1 },
  { name: 'pause', bar: 36, bars: 4, intensity: 0.3 },
  { name: 'boss', bar: 40, bars: 12, intensity: 1 },
  { name: 'end', bar: 52, bars: 4, intensity: 0.3 },
];

const secOf = (bar) => SECTIONS.find((s) => bar >= s.bar && bar < s.bar + s.bars) || SECTIONS[0];

export default function build() {
  const c = new Composer({ bpm: BPM, bars: BARS });

  for (let bar = 0; bar < BARS; bar++) {
    const sec = secOf(bar).name;
    const ch = chordAt(bar);
    const root = BASS[bar % 4];
    const loud = sec === 'clear' || sec === 'boss';
    const moving = loud || sec === 'stage' || sec === 'rise';

    if (sec === 'boot' || sec === 'pause' || sec === 'end') {
      c.padBar(bar, ch, { kind: 'choir', gain: 0.75 });
      c.arpBar(bar, ch, [0, 2, 1, 3, 2, 0, 1, 2], { kind: 'bell', gain: 0.45, octave: 1, weight: 0.9 });
    }

    if (moving) {
      c.drumBar(bar, {
        kick: loud ? 'x--x--x-x--x--x-' : 'x-------x-------',
        snare: '----x-------x---',
        hat: loud ? 'xsxsxsxsxsxsxsxo' : 'x-s-x-s-x-s-x-s-',
      });
      // A walking eighth bass is most of the chiptune feel.
      c.bassBar(bar, 'x-x-x-x-x-x-x-x-', (i) => root + [0, 0, 12, 0, 7, 0, 12, 7][i % 8], { dur: 0.22 });
      c.arpBar(bar, ch, RIFF[bar % 2].map((v) => (v == null ? null : v)), {
        kind: 'pluck', gain: 0.7, dur: 0.2, weight: 0.75, accentEvery: 4,
      });
    }

    // --- tune ---------------------------------------------------------------
    const idx = sec === 'stage' ? bar - 4 : sec === 'clear' ? bar - 20 : sec === 'boss' ? bar - 40 : -1;
    if (idx >= 0) {
      c.line(bar, TUNE[idx % TUNE.length], {
        gain: sec === 'stage' ? 0.7 : 1,
        double: loud ? { kind: 'pluck', octave: 1, gain: 0.35 } : null,
        holdMin: 1.5,
        accentOn: [1, 3],
      });
    }

    if ([0, 20, 40].includes(bar)) c.E(c.at(bar), 'crash', { g: bar === 0 ? 0.5 : 0.9 });
    if (bar === 18) c.E(c.at(bar), 'riser', { d: 8 * c.spb, g: 0.9 });
    if (bar === 39) for (let j = 0; j < 8; j++) c.E(c.at(bar) + 2 + j * 0.25, 'tom', { n: 45 + j * 2, g: 0.85 });
  }

  // The `pause` bars are bells only, which lower difficulties do not take.
  for (let bar = 36; bar < 40; bar++) {
    const ch = chordAt(bar);
    c.H(c.at(bar), { layer: 'lead', pitch: ch[3], weight: 0.93, hold: 1.5 });
    c.H(c.at(bar) + 2, { layer: 'lead', pitch: ch[1], weight: 0.82, accent: bar % 2 === 0 });
  }

  // The intro plays the hook once on bells, and the chart follows it.
  for (let bar = 2; bar < 4; bar++) {
    c.line(bar, TUNE[bar - 2], { kind: 'bell', gain: 0.6, layer: 'lead', holdMin: 1.5, accentOn: [2] });
  }

  return assemble(c, {
    id: 'pixel-rain',
    title: 'Pixel Rain',
    artist: 'Sosoph Synth',
    genre: 'Chiptune',
  }, SECTIONS);
}
