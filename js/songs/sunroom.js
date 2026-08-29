// "Sunroom" — 112 BPM house in G major.
//
// Four on the floor, offbeat organ stabs and a bass that only plays the
// offbeats. Deliberately mid-difficulty across the board: the groove never
// changes, so the chart is about staying in the pocket.

import { Composer, assemble, chordOn, voice, SCALES } from '../music.js';

const BPM = 112;
const BARS = 44;
const ROOT = 67;

const DEGREES = [1, 4, 0, 3]; // Am7 – D – G – C, over a G tonic
const BASS = [45, 50, 43, 48];
const chordAt = (bar) => voice(chordOn(ROOT, SCALES.major, DEGREES[bar % 4], 4), 60, 81);

const TUNE = [
  [79, null, 78, 76, null, 74, null, null],
  [76, null, 74, 71, null, null, null, null],
  [74, 76, 78, 79, null, 81, null, null],
  [79, null, 78, 76, null, null, null, null],
  [83, null, 81, 79, null, 78, 76, null],
  [78, null, 76, 74, null, 76, null, null],
  [79, 81, 83, 86, null, 83, 81, null],
  [79, null, null, null, null, null, null, null],
];

const SECTIONS = [
  { name: 'in', bar: 0, bars: 4, intensity: 0.25 },
  { name: 'groove', bar: 4, bars: 8, intensity: 0.55 },
  { name: 'lift', bar: 12, bars: 8, intensity: 0.8 },
  { name: 'main', bar: 20, bars: 12, intensity: 1 },
  { name: 'filter', bar: 32, bars: 4, intensity: 0.4 },
  { name: 'last', bar: 36, bars: 6, intensity: 1 },
  { name: 'out', bar: 42, bars: 2, intensity: 0.25 },
];

const secOf = (bar) => SECTIONS.find((s) => bar >= s.bar && bar < s.bar + s.bars) || SECTIONS[0];

export default function build() {
  const c = new Composer({ bpm: BPM, bars: BARS });

  for (let bar = 0; bar < BARS; bar++) {
    const sec = secOf(bar).name;
    const ch = chordAt(bar);
    const root = BASS[bar % 4];
    const full = sec === 'main' || sec === 'last';
    const beat = full || sec === 'groove' || sec === 'lift';

    c.padBar(bar, ch, { gain: full ? 0.4 : 0.7 });

    if (beat) {
      c.drumBar(bar, {
        kick: 'x---x---x---x---',
        clap: '----x-------x---',
        hat: full ? '--x---x---x---xo' : '--x---x---x---x-',
      }, { hatGain: 0.85 });
      if (full) c.drumBar(bar, { ride: 'x-x-x-x-x-x-x-x-' }, {});
      // Offbeat bass: the note lands where the kick is not.
      c.bassBar(bar, '--x---x---x---x-', () => root, { dur: 0.3, gain: 0.95 });
      c.E(c.at(bar), 'sub', { n: root - 12, d: 1.4 * c.spb, g: 0.5 });
    } else if (sec === 'filter') {
      c.drumBar(bar, { kick: 'x-------x-------', hat: '--x---x---x---x-' }, { hatGain: 0.5 });
    }

    // Offbeat organ stabs, the signature of the whole track.
    if (beat || sec === 'in') {
      c.seq(bar, '--x---x---x---x-', (b, g) =>
        c.E(b, 'stab', { n: ch, d: 0.24 * c.spb, g: g * (full ? 0.75 : 0.6) })
      );
    }

    const idx = sec === 'lift' ? bar - 12 : sec === 'main' ? bar - 20 : sec === 'last' ? bar - 36 + 6 : -1;
    if (idx >= 0) {
      c.line(bar, TUNE[idx % TUNE.length], {
        kind: 'piano',
        gain: sec === 'lift' ? 0.75 : 1,
        double: full ? { kind: 'lead', octave: 0, gain: 0.4 } : null,
        holdMin: 1,
        accentOn: [1, 3],
      });
    }

    if ([0, 20, 36].includes(bar)) c.E(c.at(bar), 'crash', { g: bar === 0 ? 0.4 : 0.85 });
    if (bar === 18) c.E(c.at(bar), 'riser', { d: 8 * c.spb, g: 0.8 });
  }

  // The intro rides the stabs alone, so the chart takes them.
  for (let bar = 2; bar < 4; bar++) {
    const ch = chordAt(bar);
    [0.5, 1.5, 2.5, 3.5].forEach((b, i) =>
      c.H(c.at(bar) + b, { layer: 'lead', pitch: ch[i % ch.length], weight: 0.9, accent: i === 1 })
    );
  }

  return assemble(c, {
    id: 'sunroom',
    title: 'Sunroom',
    artist: 'Sosoph Synth',
    genre: 'House',
  }, SECTIONS);
}
