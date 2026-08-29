// "Untitled Sorrow" — 172 BPM in D minor.
//
// Fast but not heavy: a piano figure over sustained strings, a half-time feel
// in the verses that doubles into straight sixteenths for the chorus. The chart
// leans on the piano, so its hardest passages are the ones that sound hardest.

import { Composer, readMelody, gridWeight , assemble } from '../music.js';

const BPM = 172;
const BARS = 64;

// Dm – Bb – F – C, the sadder cousin of the pop loop.
const CHORDS = [
  [50, 57, 62, 65],
  [46, 53, 58, 65],
  [41, 57, 60, 65],
  [48, 55, 60, 64],
];
const BASS = [38, 34, 29, 36];

const FIGURE = [
  [74, 77, 81, 77, 74, 77, 81, 84],
  [70, 74, 77, 74, 70, 74, 77, 82],
  [69, 72, 77, 72, 69, 72, 77, 81],
  [72, 76, 79, 76, 72, 76, 79, 84],
];

const LINE = [
  [81, null, 79, 77, null, 74, null, null],
  [77, null, 74, 72, null, null, null, null],
  [74, null, 77, 79, null, 81, 82, null],
  [81, null, null, null, null, null, null, null],
  [84, null, 82, 81, null, 79, null, null],
  [81, null, 77, 74, null, 77, 79, null],
  [77, null, 79, 81, null, 84, 86, null],
  [84, null, null, null, null, null, null, null],
  [86, null, 84, 81, null, 79, null, null],
  [81, null, 79, 77, null, 74, 77, null],
  [79, null, 81, 84, null, 86, 89, null],
  [86, null, 84, 81, null, null, null, null],
  [77, 79, 81, 84, null, 86, null, 84],
  [81, null, 79, 77, null, 74, null, 72],
  [74, null, 77, 81, null, 79, 77, null],
  [74, null, null, null, null, null, null, null],
];

const SECTIONS = [
  { name: 'intro', bar: 0, bars: 8, intensity: 0.18 },
  { name: 'verse', bar: 8, bars: 16, intensity: 0.45 },
  { name: 'build', bar: 24, bars: 8, intensity: 0.75 },
  { name: 'chorus', bar: 32, bars: 16, intensity: 1 },
  { name: 'drop', bar: 48, bars: 4, intensity: 0.3 },
  { name: 'last', bar: 52, bars: 8, intensity: 1 },
  { name: 'outro', bar: 60, bars: 4, intensity: 0.25 },
];

const secOf = (bar) => SECTIONS.find((s) => bar >= s.bar && bar < s.bar + s.bars) || SECTIONS[0];

export default function build() {
  const c = new Composer({ bpm: BPM, bars: BARS });

  for (let bar = 0; bar < BARS; bar++) {
    const b0 = c.at(bar);
    const sec = secOf(bar).name;
    const ch = CHORDS[bar % 4];
    const root = BASS[bar % 4];
    const loud = sec === 'chorus' || sec === 'last';
    const half = sec === 'verse' || sec === 'build';

    // --- strings ------------------------------------------------------------
    c.E(b0, 'choir', { n: ch, d: 3.8 * c.spb, g: sec === 'intro' || sec === 'drop' ? 1 : 0.62 });
    if (loud) c.E(b0, 'pad', { n: ch.map((n) => n + 12), d: 3.7 * c.spb, g: 0.4 });

    // --- drums --------------------------------------------------------------
    if (half) {
      c.seq(bar, 'x-------x-x-----', (b, g) => {
        c.E(b, 'kick', { g });
        c.H(b, { layer: 'kick', weight: gridWeight(b - b0) * 0.9, accent: b === b0 });
      });
      c.E(b0 + 2, 'snare', { g: 0.9 });
      c.H(b0 + 2, { layer: 'snare', weight: 0.88, accent: true });
      c.seq(bar, 'x-x-x-x-x-x-x-x-', (b, g) => c.E(b, 'hat', { g: g * 0.75 }));
    } else if (loud) {
      c.seq(bar, 'x--x--x-x--xx-x-', (b, g) => {
        c.E(b, 'kick', { g });
        c.H(b, { layer: 'kick', weight: gridWeight(b - b0) * 0.86, accent: b === b0 });
      });
      for (const b of [1, 3]) {
        c.E(b0 + b, 'clap');
        c.H(b0 + b, { layer: 'snare', weight: 0.88, accent: true });
      }
      c.seq(bar, 'xxxxxxxxxxxxxxxo', (b, g, i, k) => c.E(b, 'hat', { g: g * (i % 2 ? 0.5 : 0.85), open: k === 'o' }));
    } else if (sec === 'drop') {
      c.E(b0, 'kick', { g: 0.7 });
      c.seq(bar, 'x---x---x---x---', (b) => c.E(b, 'ride', { g: 0.7 }));
    }

    // --- bass ---------------------------------------------------------------
    if (half || loud) {
      const pat = loud ? 'x-x-x-x-x-x-x-x-' : 'x-------x---x---';
      c.seq(bar, pat, (b, g, i) => {
        const n = root + (loud && i % 8 === 6 ? 12 : 0);
        c.E(b, 'bass', { n, d: 0.4 * c.spb, g });
        c.H(b, { layer: 'bass', pitch: n + 24, weight: gridWeight(b - b0) * 0.68 });
      });
    }

    // --- piano figure: the engine of the whole track ------------------------
    const figureOn = sec !== 'drop' && sec !== 'outro';
    if (figureOn) {
      const row = FIGURE[bar % 4];
      const quiet = sec === 'intro';
      for (let j = 0; j < 8; j++) {
        const b = b0 + j * 0.5;
        c.E(b, 'piano', { n: row[j], d: 0.45 * c.spb, g: quiet ? 0.7 : 0.85 });
        c.H(b, {
          layer: 'arp',
          pitch: row[j],
          weight: gridWeight(j * 0.5) * (quiet ? 0.95 : 0.85),
          accent: j === 0 || j === 4,
        });
      }
    }

    // --- vocal line ---------------------------------------------------------
    const idx = sec === 'chorus' ? bar - 32 : sec === 'last' ? bar - 52 + 8 : sec === 'verse' ? bar - 8 : -1;
    if (idx >= 0 && idx < LINE.length) {
      const quiet = sec === 'verse';
      for (const m of readMelody(LINE[idx], 8)) {
        const b = b0 + m.beat;
        c.E(b, 'lead', { n: m.pitch, d: m.len * c.spb * 0.9, g: quiet ? 0.6 : 1 });
        c.H(b, {
          layer: 'lead',
          pitch: m.pitch,
          weight: Math.min(0.96, gridWeight(m.beat) + 0.16),
          hold: m.len >= 1.5 ? m.len : 0,
          accent: m.beat === 1 || m.beat === 3,
        });
      }
    }

    // --- transitions --------------------------------------------------------
    if ([0, 8, 32, 48, 52].includes(bar)) c.E(b0, 'crash', { g: bar === 0 ? 0.5 : 0.9 });
    if (bar === 30) c.E(b0, 'riser', { d: 8 * c.spb });
    if (bar === 31) for (let j = 0; j < 8; j++) c.E(b0 + 2 + j * 0.25, 'tom', { n: 43 + j * 2, g: 0.85 });
    if (bar === 51) c.E(b0 + 3, 'sub', { n: 50, d: 1.2 * c.spb });
  }

  // EASY drops the piano figure entirely, which would leave its eight-bar
  // intro empty; these follow the top of the figure instead.
  for (let bar = 2; bar < 8; bar++) {
    const b0 = c.at(bar);
    const row = FIGURE[bar % 4];
    [0, 2].forEach((j, i) =>
      c.H(b0 + j * 0.5 + i * 2, { layer: 'lead', pitch: row[j * 2], weight: 0.9, accent: bar % 2 === 1 && i === 1 })
    );
  }

  return assemble(c, {
    id: 'untitled-sorrow',
    title: 'Untitled Sorrow',
    artist: 'Sosoph Synth',
    genre: 'Piano Rock',
    tail: 3,
  }, SECTIONS);
}
