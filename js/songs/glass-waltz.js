// "Glass Waltz" — 132 BPM in 3/4, E minor.
//
// The only song here that is not in four. Three beats to a bar changes what a
// chart can be: there is no half-bar to lean on, so phrases land on the
// downbeat and the ear counts in threes. Bar lines and the editor grid follow
// the song's metre, so nothing has to be special-cased for it.

import { Composer, assemble, chordOn, voice, SCALES } from '../music.js';

const BPM = 132;
const BARS = 72;
const ROOT = 64;

const DEGREES = [0, 5, 3, 4, 0, 5, 1, 4];
const BASS = [40, 36, 45, 38, 40, 36, 42, 38];
const chordAt = (bar) => voice(chordOn(ROOT, SCALES.minor, DEGREES[bar % 8], 3), 55, 76);

// Six slots to a bar: one per eighth in 3/4.
const TUNE = [
  [76, null, 79, null, 83, null],
  [81, null, 79, null, null, null],
  [78, null, 76, null, 74, null],
  [76, null, null, null, null, null],
  [83, null, 81, null, 79, null],
  [78, null, 76, null, 78, null],
  [79, null, 83, null, 86, null],
  [84, null, null, null, null, null],
];

const SECTIONS = [
  { name: 'open', bar: 0, bars: 8, intensity: 0.22 },
  { name: 'first', bar: 8, bars: 16, intensity: 0.5 },
  { name: 'turn', bar: 24, bars: 8, intensity: 0.7 },
  { name: 'full', bar: 32, bars: 16, intensity: 1 },
  { name: 'hush', bar: 48, bars: 8, intensity: 0.3 },
  { name: 'close', bar: 56, bars: 12, intensity: 0.95 },
  { name: 'rest', bar: 68, bars: 4, intensity: 0.2 },
];

const secOf = (bar) => SECTIONS.find((s) => bar >= s.bar && bar < s.bar + s.bars) || SECTIONS[0];

export default function build() {
  const c = new Composer({ bpm: BPM, bars: BARS, beatsPerBar: 3 });

  for (let bar = 0; bar < BARS; bar++) {
    const sec = secOf(bar).name;
    const ch = chordAt(bar);
    const root = BASS[bar % 8];
    const full = sec === 'full' || sec === 'close';
    const moving = full || sec === 'first' || sec === 'turn';

    c.padBar(bar, ch, { kind: 'choir', gain: full ? 0.5 : 0.85 });

    if (moving) {
      // The waltz pattern itself: bass on one, chord on two and three.
      c.E(c.at(bar), 'bass', { n: root, d: 0.8 * c.spb, g: 1 });
      c.H(c.at(bar), { layer: 'kick', weight: 0.9, accent: true });
      for (const b of [1, 2]) {
        c.E(c.at(bar) + b, 'piano', { n: ch[b - 1] ?? ch[0], d: 0.7 * c.spb, g: 0.55 });
        c.H(c.at(bar) + b, { layer: 'arp', pitch: ch[(b - 1) % ch.length], weight: 0.66 });
      }
      if (full) {
        c.drumBar(bar, { snare: '--x---', hat: 'x-x-x-' }, { hatGain: 0.55 });
        c.E(c.at(bar), 'sub', { n: root - 12, d: 1.6 * c.spb, g: 0.4 });
      }
    }

    const idx = sec === 'first' ? bar - 8 : sec === 'full' ? bar - 32 : sec === 'close' ? bar - 56 : -1;
    if (idx >= 0) {
      c.line(bar, TUNE[idx % TUNE.length], {
        steps: 6,
        kind: 'piano',
        gain: sec === 'first' ? 0.8 : 1,
        double: full ? { kind: 'bell', octave: 1, gain: 0.3 } : null,
        holdMin: 1,
        holdMax: 3,
        accentOn: [1, 2],
      });
    }

    if ([0, 32, 56].includes(bar)) c.E(c.at(bar), 'crash', { g: bar === 0 ? 0.35 : 0.7 });
    if (bar === 30) c.E(c.at(bar), 'riser', { d: 6 * c.spb, g: 0.7 });
  }

  // The hush is pad only; carry it on single sustained tones.
  for (let bar = 48; bar < 56; bar++) {
    const ch = chordAt(bar);
    c.E(c.at(bar), 'piano', { n: ch[2], d: 2.4 * c.spb, g: 0.6 });
    c.H(c.at(bar), { layer: 'lead', pitch: ch[2], weight: 0.93, hold: bar % 2 ? 2 : 0 });
    if (bar % 2 === 0) c.H(c.at(bar) + 2, { layer: 'lead', pitch: ch[0], weight: 0.8, accent: true });
  }

  // Opening statement on solo bells, so the first eight bars are playable.
  for (let bar = 2; bar < 8; bar++) {
    const ch = chordAt(bar);
    c.E(c.at(bar), 'bell', { n: ch[2] + 12, d: 2.4 * c.spb, g: 0.55 });
    c.H(c.at(bar), { layer: 'lead', pitch: ch[2] + 12, weight: 0.92, hold: 2, accent: bar % 2 === 0 });
    c.H(c.at(bar) + 2, { layer: 'lead', pitch: ch[0] + 12, weight: 0.72 });
  }

  return assemble(c, {
    id: 'glass-waltz',
    title: 'Glass Waltz',
    artist: 'Sosoph Synth',
    genre: 'Waltz',
  }, SECTIONS);
}
