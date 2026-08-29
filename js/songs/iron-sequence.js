// "Iron Sequence" — 190 BPM hardcore in A minor.
//
// The hardest thing in the library and built to be: a distorted four-on-the-
// floor, a stab riff on every offbeat and sixteenth runs through the drops.
// Lower difficulties thin the same riff rather than replacing it, so EXPERT and
// MASTER read as the full picture of what NORMAL is sketching.

import { Composer, assemble, chordOn, voice, SCALES } from '../music.js';

const BPM = 190;
const BARS = 72;
const ROOT = 57;

const DEGREES = [0, 0, 5, 6];
const BASS = [33, 33, 29, 31];
const chordAt = (bar) => voice(chordOn(ROOT, SCALES.minor, DEGREES[bar % 4], 3), 57, 79);

// Sixteenth riff, one bar per chord.
const RIFF = [
  [69, 69, 76, 69, 72, 69, 76, 72, 74, 72, 69, 67, 69, 67, 65, 67],
  [69, 69, 76, 69, 72, 69, 76, 72, 77, 76, 72, 69, 72, 69, 68, 69],
  [65, 65, 72, 65, 69, 65, 72, 69, 70, 69, 65, 62, 65, 62, 60, 62],
  [67, 67, 74, 67, 71, 67, 74, 71, 72, 71, 67, 64, 67, 64, 63, 64],
];

const HOOK = [
  [81, null, 79, 76, null, 79, 81, null],
  [84, null, 81, 79, null, null, null, null],
  [79, null, 81, 84, null, 86, 88, null],
  [86, null, 84, 81, null, 79, null, null],
];

const SECTIONS = [
  { name: 'call', bar: 0, bars: 8, intensity: 0.3 },
  { name: 'push', bar: 8, bars: 12, intensity: 0.7 },
  { name: 'drop', bar: 20, bars: 16, intensity: 1 },
  { name: 'break', bar: 36, bars: 8, intensity: 0.3 },
  { name: 'drop2', bar: 44, bars: 20, intensity: 1 },
  { name: 'end', bar: 64, bars: 8, intensity: 0.5 },
];

const secOf = (bar) => SECTIONS.find((s) => bar >= s.bar && bar < s.bar + s.bars) || SECTIONS[0];

export default function build() {
  const c = new Composer({ bpm: BPM, bars: BARS });

  for (let bar = 0; bar < BARS; bar++) {
    const sec = secOf(bar).name;
    const ch = chordAt(bar);
    const root = BASS[bar % 4];
    const hard = sec === 'drop' || sec === 'drop2';
    const moving = hard || sec === 'push' || sec === 'end';

    if (sec === 'break' || sec === 'call') {
      c.padBar(bar, ch, { kind: 'choir', gain: 0.9 });
    } else {
      c.padBar(bar, ch, { gain: 0.35 });
    }

    if (moving) {
      c.drumBar(bar, {
        kick: hard ? 'x---x---x---x-x-' : 'x-------x-------',
        clap: '----x-------x---',
        hat: hard ? 'xoxxxoxxxoxxxoxo' : 'x-x-x-x-x-x-x-x-',
      }, { hatGain: 0.65 });
      c.bassBar(bar, hard ? 'x-xxx-xxx-xxx-xx' : 'x---x---x---x---', () => root, { dur: 0.16, gain: 0.9 });
      // Offbeat stabs are the hook of the whole track.
      c.seq(bar, '--x---x---x---x-', (b, g) => c.E(b, 'stab', { n: ch, d: 0.14 * c.spb, g: g * 0.8 }));
    } else if (sec === 'break' && bar >= 40) {
      c.drumBar(bar, { kick: 'x-------x-------', hat: 'x---x---x---x---' }, { hatGain: 0.5 });
    }

    // --- riff ---------------------------------------------------------------
    if (moving) {
      const row = RIFF[bar % 4];
      const g = hard ? 0.85 : 0.55;
      for (let j = 0; j < 16; j++) {
        const b = c.at(bar) + j * 0.25;
        c.E(b, 'pluck', { n: row[j], d: 0.15 * c.spb, g });
        c.H(b, { layer: 'arp', pitch: row[j], weight: c.w(j * 0.25) * (hard ? 0.85 : 0.95), accent: j % 8 === 0 });
      }
    }

    // --- hook ---------------------------------------------------------------
    const idx = sec === 'drop' ? bar - 20 : sec === 'drop2' ? bar - 44 : -1;
    if (idx >= 0) {
      c.line(bar, HOOK[idx % HOOK.length], { gain: 1.1, holdMin: 1.5, accentOn: [1, 3] });
    }

    if ([0, 20, 36, 44].includes(bar)) c.E(c.at(bar), 'crash', { g: bar === 0 ? 0.5 : 1 });
    if (bar === 18 || bar === 42) c.E(c.at(bar), 'riser', { d: 8 * c.spb });
    if (bar === 19 || bar === 43) {
      for (let j = 0; j < 8; j++) c.E(c.at(bar) + 2 + j * 0.25, 'tom', { n: 40 + j * 2, g: 0.9 });
      c.E(c.at(bar) + 3.75, 'sub', { n: 57, d: 1.4 * c.spb });
    }
  }

  // The call and the break carry hand-written skeletons.
  for (let bar = 2; bar < 8; bar++) {
    const row = RIFF[bar % 4];
    [0, 1, 2, 3].forEach((b) =>
      c.H(c.at(bar) + b, { layer: 'lead', pitch: row[b * 4], weight: 0.9, accent: b === 2 })
    );
  }
  for (let bar = 36; bar < 40; bar++) {
    c.H(c.at(bar), { layer: 'lead', pitch: 69 + (bar - 36) * 2, weight: 0.92, hold: 2 });
    c.H(c.at(bar) + 3, { layer: 'lead', pitch: 76, weight: 0.85, accent: true });
  }

  return assemble(c, {
    id: 'iron-sequence',
    title: 'Iron Sequence',
    artist: 'Sosoph Synth',
    genre: 'Hardcore',
  }, SECTIONS);
}
