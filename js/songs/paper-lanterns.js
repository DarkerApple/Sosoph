// "Paper Lanterns" — 76 BPM ballad in D major.
//
// The gentlest thing here, and the one to learn hold notes on: long sustains,
// wide gaps and almost no syncopation. Its EASY is the lightest chart in the
// library by some distance.

import { Composer, assemble, chordOn, voice, SCALES } from '../music.js';

const BPM = 76;
const BARS = 32;
const ROOT = 62;

const DEGREES = [0, 4, 5, 3];
const BASS = [38, 45, 47, 43];
const chordAt = (bar) => voice(chordOn(ROOT, SCALES.major, DEGREES[bar % 4], 4), 55, 76);

const TUNE = [
  [74, null, null, null, 76, null, 78, null],
  [76, null, null, null, null, null, null, null],
  [81, null, 78, null, 76, null, null, null],
  [78, null, null, null, null, null, null, null],
  [83, null, 81, null, 78, null, 76, null],
  [78, null, null, null, 74, null, null, null],
  [76, null, 78, null, 81, null, 83, null],
  [81, null, null, null, null, null, null, null],
];

const SECTIONS = [
  { name: 'still', bar: 0, bars: 4, intensity: 0.15 },
  { name: 'verse', bar: 4, bars: 8, intensity: 0.35 },
  { name: 'rise', bar: 12, bars: 4, intensity: 0.55 },
  { name: 'chorus', bar: 16, bars: 8, intensity: 0.85 },
  { name: 'last', bar: 24, bars: 6, intensity: 1 },
  { name: 'fade', bar: 30, bars: 2, intensity: 0.2 },
];

const secOf = (bar) => SECTIONS.find((s) => bar >= s.bar && bar < s.bar + s.bars) || SECTIONS[0];

export default function build() {
  const c = new Composer({ bpm: BPM, bars: BARS });

  for (let bar = 0; bar < BARS; bar++) {
    const sec = secOf(bar).name;
    const ch = chordAt(bar);
    const root = BASS[bar % 4];
    const big = sec === 'chorus' || sec === 'last';

    c.padBar(bar, ch, { kind: 'choir', gain: big ? 0.7 : 1 });
    // Broken chord under everything: a piano playing the harmony one note at a
    // time is most of what makes a ballad feel like one.
    c.arpBar(bar, ch, [0, 1, 2, 3, 2, 1, 2, 1], {
      kind: 'piano', gain: big ? 0.7 : 0.5, dur: 0.9, weight: 0.78,
    });

    if (sec !== 'still' && sec !== 'fade') {
      c.E(c.at(bar), 'bass', { n: root, d: 3.4 * c.spb, g: 0.8 });
      if (big) {
        c.drumBar(bar, { kick: 'x-------x-------', snare: '----x-------x---', ride: 'x-x-x-x-x-x-x-x-' });
      } else if (sec === 'rise') {
        c.drumBar(bar, { kick: 'x---------------', ride: 'x---x---x---x---' });
      }
    }

    const idx = sec === 'verse' ? bar - 4 : sec === 'chorus' ? bar - 16 : sec === 'last' ? bar - 24 + 4 : -1;
    if (idx >= 0) {
      c.line(bar, TUNE[idx % TUNE.length], {
        kind: 'piano',
        gain: big ? 1 : 0.8,
        double: big ? { kind: 'bell', octave: 1, gain: 0.25 } : null,
        holdMin: 1,
        holdMax: 4,
        accentOn: [2],
      });
    }

    if (bar === 16 || bar === 24) c.E(c.at(bar), 'crash', { g: 0.35 });
  }

  // The opening bars are pad and piano only; take the top of the arpeggio.
  for (let bar = 1; bar < 4; bar++) {
    const ch = chordAt(bar);
    c.H(c.at(bar), { layer: 'lead', pitch: ch[3], weight: 0.94, hold: 2 });
    c.H(c.at(bar) + 2, { layer: 'lead', pitch: ch[1], weight: 0.86, accent: bar === 2 });
  }

  return assemble(c, {
    id: 'paper-lanterns',
    title: 'Paper Lanterns',
    artist: 'Sosoph Synth',
    genre: 'Ballad',
    tail: 4,
  }, SECTIONS);
}
