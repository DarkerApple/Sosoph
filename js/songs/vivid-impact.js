// "Vivid Impact" — 168 BPM in E minor, the loudest thing here.
//
// Driving four-on-the-floor with a sawtooth riff doubled an octave down. The
// riff runs in sixteenths, which is where EXPERT gets its streams; lower
// difficulties thin the same riff out rather than replacing it.

import { Composer, readMelody, gridWeight , assemble } from '../music.js';

const BPM = 168;
const BARS = 64;

// Em – C – G – D.
const CHORDS = [
  [52, 59, 64, 67],
  [48, 55, 60, 64],
  [55, 59, 62, 67],
  [50, 57, 62, 66],
];
const BASS = [40, 36, 43, 38];

// One bar of riff per chord, sixteenth grid.
const RIFF = [
  [64, 64, 67, 64, 71, 64, 67, 71, 72, 71, 67, 64, 67, 64, 62, 64],
  [60, 60, 64, 60, 67, 60, 64, 67, 69, 67, 64, 60, 64, 60, 59, 60],
  [67, 67, 71, 67, 74, 67, 71, 74, 76, 74, 71, 67, 71, 67, 66, 67],
  [62, 62, 66, 62, 69, 62, 66, 69, 71, 69, 66, 62, 66, 62, 61, 62],
];

const HOOK = [
  [76, null, 74, 71, null, 74, 76, null],
  [79, null, 76, 74, null, null, null, null],
  [71, null, 74, 76, null, 79, 81, null],
  [79, null, 76, 74, null, 71, null, null],
  [76, null, 79, 83, null, 81, 79, null],
  [81, null, 79, 76, null, 74, null, null],
  [74, 76, 79, 81, null, 83, null, 84],
  [83, null, 81, 79, null, null, null, null],
];

const SECTIONS = [
  { name: 'intro', bar: 0, bars: 8, intensity: 0.25 },
  { name: 'verse', bar: 8, bars: 8, intensity: 0.5 },
  { name: 'build', bar: 16, bars: 8, intensity: 0.8 },
  { name: 'drop', bar: 24, bars: 16, intensity: 1 },
  { name: 'break', bar: 40, bars: 6, intensity: 0.3 },
  { name: 'final', bar: 46, bars: 14, intensity: 1 },
  { name: 'outro', bar: 60, bars: 4, intensity: 0.3 },
];

const secOf = (bar) => SECTIONS.find((s) => bar >= s.bar && bar < s.bar + s.bars) || SECTIONS[0];

export default function build() {
  const c = new Composer({ bpm: BPM, bars: BARS });

  for (let bar = 0; bar < BARS; bar++) {
    const b0 = c.at(bar);
    const sec = secOf(bar).name;
    const ch = CHORDS[bar % 4];
    const root = BASS[bar % 4];
    const hard = sec === 'drop' || sec === 'final';
    const moving = hard || sec === 'build' || sec === 'verse';

    // --- harmony ------------------------------------------------------------
    if (sec === 'break' || sec === 'intro' || sec === 'outro') {
      c.E(b0, 'choir', { n: ch, d: 3.8 * c.spb, g: 0.9 });
      c.E(b0, 'piano', { n: ch[1], d: 2 * c.spb, g: 0.6 });
    } else {
      c.E(b0, 'pad', { n: ch, d: 3.7 * c.spb, g: 0.45 });
      c.seq(bar, hard ? '--x---x---x---x-' : '--x-------x-----', (b, g) =>
        c.E(b, 'stab', { n: ch.map((n) => n + 12), d: 0.2 * c.spb, g: g * 0.7 })
      );
    }

    // --- drums --------------------------------------------------------------
    if (moving) {
      c.seq(bar, hard ? 'x---x---x---x-x-' : 'x-------x-------', (b, g) => {
        c.E(b, 'kick', { g });
        c.H(b, { layer: 'kick', weight: gridWeight(b - b0) * 0.9, accent: b === b0 });
      });
      for (const b of [1, 3]) {
        c.E(b0 + b, 'clap');
        c.E(b0 + b, 'snare', { g: 0.55 });
        c.H(b0 + b, { layer: 'snare', weight: 0.9, accent: true });
      }
      c.seq(bar, hard ? 'xoxxxoxxxoxxxoxo' : 'x-x-x-x-x-x-x-x-', (b, g, i, k) =>
        c.E(b, 'hat', { g: g * 0.8, open: k === 'o' && i % 8 === 7 })
      );
    } else if (sec === 'break' && bar >= 43) {
      c.E(b0, 'kick', { g: 0.75 });
      c.E(b0 + 2, 'snare', { g: 0.7 });
    }

    // --- bass ---------------------------------------------------------------
    if (moving) {
      c.seq(bar, hard ? 'x-xxx-xxx-xxx-xx' : 'x---x---x---x---', (b, g) => {
        c.E(b, 'bass', { n: root, d: 0.28 * c.spb, g });
        c.H(b, { layer: 'bass', pitch: root + 24, weight: gridWeight(b - b0) * 0.62 });
      });
    }

    // --- riff ---------------------------------------------------------------
    const riffOn = sec === 'build' || hard || (sec === 'verse' && bar >= 12);
    if (riffOn) {
      const row = RIFF[bar % 4];
      const g = sec === 'verse' ? 0.5 : sec === 'build' ? 0.75 : 1;
      for (let j = 0; j < 16; j++) {
        const b = b0 + j * 0.25;
        c.E(b, 'pluck', { n: row[j], d: 0.22 * c.spb, g: g * 0.8 });
        if (hard) c.E(b, 'bass', { n: row[j] - 24, d: 0.2 * c.spb, g: 0.45 });
        c.H(b, {
          layer: 'arp',
          pitch: row[j],
          weight: gridWeight(j * 0.25) * (sec === 'build' ? 0.95 : 0.8),
          accent: j % 8 === 0,
        });
      }
    }

    // --- hook ---------------------------------------------------------------
    const idx = sec === 'drop' ? bar - 24 : sec === 'final' ? bar - 46 : -1;
    if (idx >= 0 && idx < HOOK.length) {
      for (const m of readMelody(HOOK[idx % HOOK.length], 8)) {
        const b = b0 + m.beat;
        c.E(b, 'lead', { n: m.pitch, d: m.len * c.spb * 0.9, g: 1.05 });
        c.H(b, {
          layer: 'lead',
          pitch: m.pitch,
          weight: Math.min(0.96, gridWeight(m.beat) + 0.18),
          hold: m.len >= 1.5 ? m.len : 0,
          accent: m.beat === 1 || m.beat === 3,
        });
      }
    }

    // --- transitions --------------------------------------------------------
    if ([0, 24, 40, 46].includes(bar)) c.E(b0, 'crash', { g: bar === 0 ? 0.55 : 1 });
    if (bar === 22) c.E(b0, 'riser', { d: 8 * c.spb });
    if (bar === 23) {
      for (let j = 0; j < 8; j++) c.E(b0 + 2 + j * 0.25, 'tom', { n: 40 + j * 2, g: 0.9 });
      c.E(b0 + 3.75, 'sub', { n: 52, d: 1.5 * c.spb });
    }
    if (bar === 45) {
      c.E(b0, 'riser', { d: 4 * c.spb, g: 0.95 });
      for (let j = 0; j < 4; j++) c.E(b0 + 3 + j * 0.25, 'clap', { g: 0.7 + j * 0.1 });
    }
  }

  // Intro and break get a hand-written skeleton so they are never empty.
  for (let bar = 4; bar < 8; bar++) {
    const b0 = c.at(bar);
    [0, 1.5, 2.5, 3].forEach((b, i) =>
      c.H(b0 + b, { layer: 'lead', pitch: [64, 67, 71, 67][i], weight: 0.9, accent: i === 2 })
    );
  }
  for (let bar = 40; bar < 43; bar++) {
    const b0 = c.at(bar);
    c.H(b0, { layer: 'lead', pitch: 64 + (bar - 40) * 3, weight: 0.92, hold: 2 });
    c.H(b0 + 3, { layer: 'lead', pitch: 71, weight: 0.86, accent: true });
  }

  return assemble(c, {
    id: 'vivid-impact',
    title: 'Vivid Impact',
    artist: 'Sosoph Synth',
    genre: 'Big Room',
    tail: 3,
  }, SECTIONS);
}
