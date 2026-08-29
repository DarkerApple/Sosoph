// "Cold Open" — 88 BPM downtempo in C minor.
//
// Slow, wide and mostly space. A dubby bass, brushed drums and a Rhodes figure
// that answers itself. The interest is in the rests: the chart has to leave
// them alone, which is why nothing here fills the offbeats.

import { Composer, assemble, chordOn, voice, SCALES } from '../music.js';

const BPM = 88;
const BARS = 34;
const ROOT = 60;

const DEGREES = [0, 6, 5, 4];
const BASS = [36, 34, 32, 31];
const chordAt = (bar) => voice(chordOn(ROOT, SCALES.minor, DEGREES[bar % 4], 4), 55, 74);

const RHODES = [
  [null, null, 72, null, 75, null, null, null],
  [70, null, null, null, 67, null, null, null],
  [72, null, 75, null, 79, null, 75, null],
  [72, null, null, null, null, null, null, null],
  [79, null, 77, null, 75, null, null, null],
  [72, null, null, 70, null, null, null, null],
  [67, null, 70, null, 72, null, 75, null],
  [70, null, null, null, null, null, null, null],
];

const SECTIONS = [
  { name: 'air', bar: 0, bars: 4, intensity: 0.15 },
  { name: 'first', bar: 4, bars: 8, intensity: 0.4 },
  { name: 'lift', bar: 12, bars: 8, intensity: 0.7 },
  { name: 'wide', bar: 20, bars: 4, intensity: 0.35 },
  { name: 'last', bar: 24, bars: 8, intensity: 0.9 },
  { name: 'gone', bar: 32, bars: 2, intensity: 0.15 },
];

const secOf = (bar) => SECTIONS.find((s) => bar >= s.bar && bar < s.bar + s.bars) || SECTIONS[0];

export default function build() {
  const c = new Composer({ bpm: BPM, bars: BARS });

  for (let bar = 0; bar < BARS; bar++) {
    const sec = secOf(bar).name;
    const ch = chordAt(bar);
    const root = BASS[bar % 4];
    const on = sec !== 'air' && sec !== 'gone';

    c.padBar(bar, ch, { kind: 'choir', gain: on ? 0.6 : 0.95 });

    if (on) {
      c.drumBar(bar, {
        kick: sec === 'wide' ? 'x---------------' : 'x-----------x---',
        snare: '--------x-------',
        hat: sec === 'last' ? 'x-x-x-x-x-x-x-x-' : 'x-------x-------',
      }, { hatGain: 0.5 });
      // Long dub bass notes, two to a bar at most.
      c.E(c.at(bar), 'bass', { n: root, d: 1.6 * c.spb, g: 1 });
      c.H(c.at(bar), { layer: 'bass', pitch: root + 24, weight: 0.86, accent: true });
      if (sec === 'lift' || sec === 'last') {
        c.E(c.at(bar) + 2.5, 'bass', { n: root + 7, d: 0.9 * c.spb, g: 0.85 });
        c.H(c.at(bar) + 2.5, { layer: 'bass', pitch: root + 31, weight: 0.6 });
      }
      c.E(c.at(bar), 'sub', { n: root - 12, d: 2.6 * c.spb, g: 0.45 });
    }

    const idx = sec === 'first' ? bar - 4 : sec === 'lift' ? bar - 12 : sec === 'last' ? bar - 24 : -1;
    if (idx >= 0) {
      c.line(bar, RHODES[idx % RHODES.length], {
        kind: 'piano',
        gain: sec === 'first' ? 0.8 : 1,
        double: sec === 'last' ? { kind: 'bell', octave: 1, gain: 0.22 } : null,
        holdMin: 1,
        holdMax: 4,
        accentOn: [1, 2],
      });
    }

    if (bar === 12 || bar === 24) c.E(c.at(bar), 'crash', { g: 0.3 });
  }

  // The opening is pad only; take two long tones a bar so it is not empty.
  for (let bar = 1; bar < 4; bar++) {
    const ch = chordAt(bar);
    c.E(c.at(bar), 'bell', { n: ch[3], d: 2.6 * c.spb, g: 0.45 });
    c.H(c.at(bar), { layer: 'lead', pitch: ch[3], weight: 0.94, hold: 2 });
    c.H(c.at(bar) + 2.5, { layer: 'lead', pitch: ch[1], weight: 0.8, accent: bar === 2 });
  }

  return assemble(c, {
    id: 'cold-open',
    title: 'Cold Open',
    artist: 'Sosoph Synth',
    genre: 'Downtempo',
    tail: 4,
  }, SECTIONS);
}
