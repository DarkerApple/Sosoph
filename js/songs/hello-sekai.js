// "Hello, Sekai" — 140 BPM bright major-key pop in C.
//
// The friendliest chart in the set: a piano hook doubled by bells over a
// I–V–vi–IV loop, with claps on 2 and 4 that become the coloured accents.

import { Composer, readMelody, gridWeight, voice, chordOn, SCALES , assemble } from '../music.js';

const BPM = 140;
const BARS = 48;
const ROOT = 60; // C

const DEGREES = [0, 4, 5, 3]; // C – G – Am – F
const BASS = [36, 43, 33, 41];

const chordAt = (bar) => voice(chordOn(ROOT, SCALES.major, DEGREES[bar % 4], 4), 55, 76);

// Sixteen bars of hook, one slot per eighth.
const HOOK = [
  [72, null, 72, 74, null, 76, null, null],
  [74, null, 72, 71, null, 67, null, null],
  [69, null, 71, 72, null, 74, 72, null],
  [71, null, 69, 67, null, null, null, null],
  [72, null, 74, 76, null, 76, 74, null],
  [76, null, 77, 79, null, null, null, null],
  [77, null, 76, 74, null, 72, 74, null],
  [76, null, 74, 72, null, null, null, null],
  [79, null, 77, 76, null, 76, 77, null],
  [79, null, 81, 79, null, 76, null, null],
  [77, null, 76, 74, null, 76, 77, null],
  [79, null, 76, 72, null, null, null, null],
  [72, 74, 76, 77, null, 79, null, 81],
  [79, null, 76, 79, null, 81, 83, null],
  [84, null, 81, 79, null, 77, 76, null],
  [74, null, 76, 72, null, null, null, null],
];

const SECTIONS = [
  { name: 'intro', bar: 0, bars: 4, intensity: 0.2 },
  { name: 'verse', bar: 4, bars: 8, intensity: 0.45 },
  { name: 'pre', bar: 12, bars: 4, intensity: 0.7 },
  { name: 'chorus', bar: 16, bars: 16, intensity: 1 },
  { name: 'bridge', bar: 32, bars: 4, intensity: 0.4 },
  { name: 'last', bar: 36, bars: 8, intensity: 1 },
  { name: 'outro', bar: 44, bars: 4, intensity: 0.3 },
];

const secOf = (bar) => SECTIONS.find((s) => bar >= s.bar && bar < s.bar + s.bars) || SECTIONS[0];

export default function build() {
  const c = new Composer({ bpm: BPM, bars: BARS });

  for (let bar = 0; bar < BARS; bar++) {
    const b0 = c.at(bar);
    const sec = secOf(bar).name;
    const ch = chordAt(bar);
    const root = BASS[bar % 4];
    const full = sec === 'chorus' || sec === 'last';
    const moving = full || sec === 'pre' || sec === 'verse';

    // --- keys ---------------------------------------------------------------
    // Comped on the offbeats in the verse, hammered in the chorus: the same
    // harmony, two different energies.
    if (sec === 'intro' || sec === 'bridge' || sec === 'outro') {
      c.E(b0, 'piano', { n: ch[0], d: 2 * c.spb, g: 0.9 });
      c.E(b0, 'choir', { n: ch, d: 3.6 * c.spb, g: 0.7 });
    } else {
      c.E(b0, 'pad', { n: ch, d: 3.7 * c.spb, g: full ? 0.55 : 0.75 });
      c.seq(bar, full ? 'x-x-x-x-x-x-x-x-' : '--x---x---x---x-', (b, g) => {
        c.E(b, 'stab', { n: ch, d: 0.22 * c.spb, g: g * (full ? 0.55 : 0.7) });
      });
    }

    // --- drums --------------------------------------------------------------
    if (moving) {
      c.seq(bar, full ? 'x--x--x-x--x--x-' : 'x-------x-------', (b, g) => {
        c.E(b, 'kick', { g });
        c.H(b, { layer: 'kick', weight: gridWeight(b - b0) * 0.9, accent: b === b0 });
      });
      for (const b of [1, 3]) {
        c.E(b0 + b, 'clap', { g: 1 });
        c.H(b0 + b, { layer: 'snare', weight: 0.86, accent: true });
      }
      c.seq(bar, full ? 'x-x-x-x-x-x-x-xo' : 'x-x-x-x-x-x-x-x-', (b, g, i, ch2) =>
        c.E(b, 'hat', { g: g * 0.9, open: ch2 === 'o' })
      );
    } else if (sec === 'bridge') {
      c.E(b0, 'kick', { g: 0.7 });
      c.seq(bar, 'x---x---x---x---', (b) => c.E(b, 'ride', { g: 0.8 }));
    }

    // --- bass ---------------------------------------------------------------
    if (moving) {
      c.seq(bar, full ? 'x-x-x-x-x-x-x-x-' : 'x---x---x---x---', (b, g, i) => {
        const n = root + (i >= 8 && full ? 12 : 0);
        c.E(b, 'bass', { n, d: 0.4 * c.spb, g });
        c.H(b, { layer: 'bass', pitch: n + 24, weight: gridWeight(b - b0) * 0.7 });
      });
    }

    // --- bell arpeggio ------------------------------------------------------
    if (full || sec === 'pre') {
      const shape = [0, 1, 2, 3, 2, 1];
      for (let j = 0; j < 6; j++) {
        const b = b0 + j * (4 / 6);
        const n = ch[shape[j] % ch.length] + 12;
        c.E(b, 'bell', { n, d: 0.5 * c.spb, g: 0.5 });
        c.H(b, { layer: 'arp', pitch: n, weight: gridWeight(b - b0) * 0.7 });
      }
    }

    // --- hook ---------------------------------------------------------------
    const hookBar =
      sec === 'chorus' ? bar - 16 : sec === 'last' ? bar - 36 + 8 : sec === 'verse' ? bar - 4 : -1;
    if (hookBar >= 0 && hookBar < HOOK.length) {
      const quiet = sec === 'verse';
      for (const m of readMelody(HOOK[hookBar], 8)) {
        const b = b0 + m.beat;
        c.E(b, 'piano', { n: m.pitch, d: m.len * c.spb, g: quiet ? 0.85 : 1 });
        if (!quiet) c.E(b, 'lead', { n: m.pitch + 12, d: m.len * c.spb * 0.9, g: 0.5 });
        c.H(b, {
          layer: 'lead',
          pitch: m.pitch,
          weight: Math.min(0.95, gridWeight(m.beat) + (quiet ? 0.02 : 0.14)),
          hold: m.len >= 1 ? m.len : 0,
          accent: m.beat === 1 || m.beat === 3 || m.len >= 1.5,
        });
      }
    }

    // --- transitions --------------------------------------------------------
    if ([0, 16, 32, 36, 44].includes(bar)) c.E(b0, 'crash', { g: bar === 0 ? 0.5 : 0.95 });
    if (bar === 14) c.E(b0, 'riser', { d: 8 * c.spb, g: 0.9 });
    if (bar === 15) for (let j = 0; j < 4; j++) c.E(b0 + 3 + j * 0.25, 'tom', { n: 48 + j * 3, g: 0.9 });
    if (bar === 35) c.E(b0 + 3, 'sub', { n: 48, d: 1.4 * c.spb, g: 0.9 });
  }

  // Give the intro and bridge a light chart of their own.
  for (let i = 0; i < 4; i++) {
    c.H(c.at(2) + i, { layer: 'lead', pitch: [72, 76, 79, 76][i], weight: 0.9, hold: i === 3 ? 1.5 : 0 });
    c.H(c.at(33) + i, { layer: 'lead', pitch: [79, 76, 72, 74][i], weight: 0.88, hold: i === 3 ? 2 : 0, accent: i === 1 });
  }

  return assemble(c, {
    id: 'hello-sekai',
    title: 'Hello, Sekai',
    artist: 'Sosoph Synth',
    genre: 'Pop',
    tail: 3,
  }, SECTIONS);
}
