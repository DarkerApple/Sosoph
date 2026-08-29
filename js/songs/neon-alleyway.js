// "Neon Alleyway" — 108 BPM funk in E minor.
//
// Syncopation is the whole point: the bass plays around the beat, the clav
// answers it, and almost nothing lands squarely on three. That makes it the
// best song here for learning to feel an offbeat, and the reason its HARD is
// tougher than its note count suggests.

import { Composer, assemble, chordOn, voice, SCALES } from '../music.js';

const BPM = 108;
const BARS = 40;
const ROOT = 64;

const DEGREES = [0, 3, 6, 4];
const BASS = [40, 45, 47, 42];
const chordAt = (bar) => voice(chordOn(ROOT, SCALES.dorian, DEGREES[bar % 4], 4), 59, 78);

// Sixteenth bass figure — the hook everyone would hum.
const BASSFIG = [
  0, null, null, 0, null, 12, null, 0, null, null, 7, null, 5, null, 3, null,
];

const TUNE = [
  [76, null, 78, null, 79, null, 76, null],
  [74, null, null, 71, null, 74, null, null],
  [76, 78, 79, null, 83, null, 81, null],
  [79, null, 76, null, null, null, null, null],
  [83, null, 81, 79, null, 78, null, 76],
  [78, null, 76, null, 74, null, 71, null],
  [74, 76, 78, 79, null, 81, 83, null],
  [81, null, 79, null, null, null, null, null],
];

const SECTIONS = [
  { name: 'vamp', bar: 0, bars: 4, intensity: 0.3 },
  { name: 'verse', bar: 4, bars: 8, intensity: 0.55 },
  { name: 'head', bar: 12, bars: 12, intensity: 0.95 },
  { name: 'solo', bar: 24, bars: 6, intensity: 0.75 },
  { name: 'head2', bar: 30, bars: 8, intensity: 1 },
  { name: 'tag', bar: 38, bars: 2, intensity: 0.35 },
];

const secOf = (bar) => SECTIONS.find((s) => bar >= s.bar && bar < s.bar + s.bars) || SECTIONS[0];

export default function build() {
  const c = new Composer({ bpm: BPM, bars: BARS });

  for (let bar = 0; bar < BARS; bar++) {
    const sec = secOf(bar).name;
    const ch = chordAt(bar);
    const root = BASS[bar % 4];
    const head = sec === 'head' || sec === 'head2';

    c.padBar(bar, ch, { gain: head ? 0.35 : 0.55 });

    c.drumBar(bar, {
      kick: head ? 'x--x--x---x-x---' : 'x-----x---x-----',
      snare: '----x-------x---',
      hat: head ? 'xsxsxsxsxsxsxsxs' : 'x-s-x-s-x-s-x-s-',
    }, { hatGain: 0.7 });

    // The bass figure, played straight every bar — it never lets up.
    BASSFIG.forEach((off, i) => {
      if (off == null) return;
      const b = c.at(bar) + i * 0.25;
      const n = root + off;
      c.E(b, 'bass', { n, d: 0.22 * c.spb, g: 1 });
      c.H(b, { layer: 'bass', pitch: n + 24, weight: Math.max(0.4, c.w(i * 0.25)) * 0.8, accent: i === 5 });
    });

    // Clav answering on the gaps the bass leaves.
    c.seq(bar, head ? '--x--x--x--x-x--' : '--x-----x-----x-', (b, g) =>
      c.E(b, 'stab', { n: ch.slice(1), d: 0.16 * c.spb, g: g * 0.65 })
    );

    const idx = sec === 'verse' ? bar - 4 : sec === 'head' ? bar - 12 : sec === 'head2' ? bar - 30 + 4 : -1;
    if (idx >= 0) {
      c.line(bar, TUNE[idx % TUNE.length], {
        kind: 'lead',
        gain: sec === 'verse' ? 0.7 : 1,
        double: head ? { kind: 'piano', octave: 0, gain: 0.45 } : null,
        holdMin: 1,
        accentOn: [1, 3],
      });
    }

    if (sec === 'solo') {
      const run = [76, 78, 79, 83, 81, 79, 78, 76];
      for (let j = 0; j < 8; j++) {
        const b = c.at(bar) + j * 0.5;
        const n = run[(j + bar * 3) % run.length];
        c.E(b, 'pluck', { n, d: 0.3 * c.spb, g: 0.8 });
        c.H(b, { layer: 'arp', pitch: n, weight: c.w(j * 0.5) * 0.92, accent: j % 4 === 2 });
      }
    }

    if ([0, 12, 30].includes(bar)) c.E(c.at(bar), 'crash', { g: bar === 0 ? 0.4 : 0.8 });
  }

  return assemble(c, {
    id: 'neon-alleyway',
    title: 'Neon Alleyway',
    artist: 'Sosoph Synth',
    genre: 'Funk',
  }, SECTIONS);
}
