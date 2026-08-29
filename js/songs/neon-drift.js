// "Neon Drift" — 128 BPM synthwave in A minor.
//
// Four-bar loop of Am – F – C – G. The lead melody is the spine of both the
// music and the chart: pitch drives lane choice, sustains become holds, and the
// claps on beats 2 and 4 are the accents that become coloured notes.

import { Composer, readMelody, gridWeight , assemble } from '../music.js';

const BPM = 128;
const BARS = 48;

const BASS_ROOT = [45, 41, 48, 43];
const PAD = [
  [57, 60, 64, 69],
  [53, 57, 60, 65],
  [55, 60, 64, 67],
  [55, 59, 62, 67],
];
const ARP = [
  [69, 72, 76, 81],
  [65, 69, 72, 77],
  [67, 72, 76, 79],
  [67, 71, 74, 79],
];
const ARP_SHAPE = [0, 1, 2, 3, 2, 1, 2, 3];

// Twelve bars of melody, one slot per eighth. `null` is a rest; a run of rests
// sustains the pitch before it.
const MELODY = [
  [81, null, 79, 76, null, 76, 79, null],
  [77, null, 76, 72, null, 72, 76, null],
  [79, null, 76, 79, null, 81, 79, null],
  [74, null, 71, 74, 76, null, null, null],
  [81, null, 79, 76, null, 76, 79, 81],
  [84, null, 81, 77, null, 76, null, null],
  [79, null, 81, 84, null, 83, 81, null],
  [79, null, 76, 74, null, 71, null, null],
  [76, null, 79, 81, null, 79, 76, null],
  [77, null, 76, 72, null, 74, 76, null],
  [79, null, 79, 81, 83, null, 84, null],
  [83, null, 81, 79, null, 76, null, null],
];

const SECTIONS = [
  { name: 'intro', bar: 0, bars: 4, intensity: 0.15 },
  { name: 'verse', bar: 4, bars: 8, intensity: 0.4 },
  { name: 'build', bar: 12, bars: 4, intensity: 0.72 },
  { name: 'chorus', bar: 16, bars: 12, intensity: 1 },
  { name: 'break', bar: 28, bars: 4, intensity: 0.3 },
  { name: 'final', bar: 32, bars: 12, intensity: 1 },
  { name: 'outro', bar: 44, bars: 4, intensity: 0.35 },
];

const sectionOfBar = (bar) =>
  SECTIONS.find((s) => bar >= s.bar && bar < s.bar + s.bars) || SECTIONS[0];

export default function build() {
  const c = new Composer({ bpm: BPM, bars: BARS });

  for (let bar = 0; bar < BARS; bar++) {
    const b0 = c.at(bar);
    const chord = bar % 4;
    const sec = sectionOfBar(bar).name;
    const root = BASS_ROOT[chord];
    const driving = sec === 'build' || sec === 'chorus' || sec === 'final';

    // --- pad: the harmonic bed, loudest where nothing else is happening ----
    const padGain = sec === 'intro' ? 0.9 : sec === 'break' ? 1 : sec === 'outro' ? 0.85 : 0.5;
    c.E(b0, 'pad', { n: PAD[chord], d: 3.7 * c.spb, g: padGain });

    // --- drums -------------------------------------------------------------
    if (sec === 'verse' || driving) {
      const fourOnFloor = !(sec === 'verse' && bar < 6);
      for (const b of fourOnFloor ? [0, 1, 2, 3] : [0, 2]) {
        c.E(b0 + b, 'kick');
        c.H(b0 + b, { layer: 'kick', weight: gridWeight(b), accent: b === 0 });
      }
      if ((sec === 'chorus' || sec === 'final') && bar % 2 === 1) c.E(b0 + 2.75, 'kick', { g: 0.75 });
      if (sec === 'final') c.E(b0 + 3.5, 'kick', { g: 0.6 });
    } else if (sec === 'break' && bar >= 30) {
      c.E(b0, 'kick', { g: 0.6 }).E(b0 + 2, 'kick', { g: 0.6 });
    } else if (sec === 'outro' && bar < 46) {
      c.E(b0, 'kick', { g: 0.9 });
    }

    if (sec === 'verse' && bar >= 8) {
      for (const b of [1, 3]) {
        c.E(b0 + b, 'snare', { g: 0.85 });
        c.H(b0 + b, { layer: 'snare', weight: 0.8, accent: true });
      }
    }
    if (driving) {
      for (const b of [1, 3]) {
        c.E(b0 + b, 'clap');
        c.H(b0 + b, { layer: 'snare', weight: 0.85, accent: true });
      }
    }

    // --- hats: density is the main lever on perceived energy ---------------
    const hatStep =
      sec === 'intro' ? (bar >= 2 ? 0.5 : 0)
      : sec === 'verse' ? 0.5
      : sec === 'build' ? (bar >= 14 ? 0.25 : 0.5)
      : sec === 'chorus' ? 0.5
      : sec === 'final' ? 0.25
      : sec === 'break' ? (bar >= 30 ? 0.5 : 1)
      : bar < 46 ? 0.5 : 0;
    if (hatStep > 0) {
      for (let b = 0; b < 4; b += hatStep) {
        const open = b === 3.5 && (sec === 'chorus' || sec === 'final');
        c.E(b0 + b, 'hat', { g: open ? 1 : b % 1 ? 0.75 : 1, open });
      }
    }

    // --- bass ---------------------------------------------------------------
    if ((sec === 'verse' && bar >= 6) || driving) {
      const octave = [0, 0, 0, 12, 0, 0, 12, 0];
      for (let j = 0; j < 8; j++) {
        const b = b0 + j * 0.5;
        c.E(b, 'bass', { n: root + octave[j], d: 0.42 * c.spb });
        c.H(b, { layer: 'bass', pitch: root + octave[j] + 24, weight: gridWeight(j * 0.5) * 0.72 });
      }
    } else if (sec === 'outro' && bar < 46) {
      c.E(b0, 'bass', { n: root, d: 3.5 * c.spb, g: 0.8 });
    }

    // --- arpeggio -----------------------------------------------------------
    const arpOn = (sec === 'verse' && bar >= 8) || driving || sec === 'break';
    if (arpOn) {
      const pool = ARP[chord];
      const g = sec === 'break' ? 0.7 : 1;
      for (let j = 0; j < 8; j++) {
        const b = b0 + j * 0.5;
        const n = pool[ARP_SHAPE[j]];
        c.E(b, 'pluck', { n, d: 0.45 * c.spb, g });
        c.H(b, { layer: 'arp', pitch: n, weight: gridWeight(j * 0.5) * 0.8 });
      }
    }

    // --- lead melody --------------------------------------------------------
    if (sec === 'chorus' || sec === 'final') {
      const row = MELODY[bar - (sec === 'chorus' ? 16 : 32)];
      for (const m of readMelody(row, 8)) {
        c.E(b0 + m.beat, 'lead', { n: m.pitch, d: m.len * c.spb * 0.92, g: sec === 'final' ? 1.1 : 1 });
        c.H(b0 + m.beat, {
          layer: 'lead',
          pitch: m.pitch,
          weight: Math.min(0.95, gridWeight(m.beat) + 0.12),
          hold: m.len >= 1 ? m.len : 0,
          accent: m.beat === 1 || m.beat === 3,
        });
      }
    }

    // --- transitions --------------------------------------------------------
    if ([0, 16, 24, 32, 40, 44].includes(bar)) c.E(b0, 'crash', { g: bar === 0 ? 0.6 : 1 });
    if (bar === 14) c.E(b0, 'riser', { d: 8 * c.spb });
    if (bar === 31) c.E(b0, 'riser', { d: 4 * c.spb, g: 0.9 });
  }

  // The intro and break carry the chart on their own so the player is never
  // staring at an empty field.
  for (const bar of [2, 3]) {
    c.H(c.at(bar), { layer: 'lead', pitch: 76, weight: 0.9, hold: 2, accent: false });
  }
  for (let i = 0; i < 4; i++) {
    c.H(c.at(28) + i, { layer: 'lead', pitch: [69, 72, 76, 72][i], weight: 0.9, hold: i === 3 ? 2 : 0 });
  }

  return assemble(c, {
    id: 'neon-drift',
    title: 'Neon Drift',
    artist: 'Sosoph Synth',
    genre: 'Synthwave',
    tail: 3.2,
  }, SECTIONS);
}
