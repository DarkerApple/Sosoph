// "Solstice" — 138 BPM trance in A minor.
//
// Built around one long build and one release. The sixteenth arpeggio runs
// under everything and slowly gains notes; the chart lets it through gradually,
// so the same passage is a trickle on NORMAL and a stream on EXPERT.

import { Composer, assemble, chordOn, voice, SCALES } from '../music.js';

const BPM = 138;
const BARS = 64;
const ROOT = 57;

const DEGREES = [0, 5, 3, 4];
const BASS = [33, 29, 36, 31];
const chordAt = (bar) => voice(chordOn(ROOT, SCALES.minor, DEGREES[bar % 4], 4), 57, 81);

const ARP = [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 2, 3, 1, 2];

const TUNE = [
  [81, null, 79, null, 76, null, 79, null],
  [77, null, 76, null, 72, null, null, null],
  [79, null, 81, null, 84, null, 83, null],
  [81, null, null, null, null, null, null, null],
  [84, null, 83, 81, null, 79, null, 76],
  [79, null, 81, null, 83, null, null, null],
  [88, null, 86, 84, null, 83, 81, null],
  [79, null, null, null, null, null, null, null],
];

const SECTIONS = [
  { name: 'intro', bar: 0, bars: 8, intensity: 0.2 },
  { name: 'build', bar: 8, bars: 16, intensity: 0.6 },
  { name: 'peak', bar: 24, bars: 8, intensity: 0.9 },
  { name: 'break', bar: 32, bars: 8, intensity: 0.25 },
  { name: 'rebuild', bar: 40, bars: 8, intensity: 0.7 },
  { name: 'release', bar: 48, bars: 12, intensity: 1 },
  { name: 'out', bar: 60, bars: 4, intensity: 0.3 },
];

const secOf = (bar) => SECTIONS.find((s) => bar >= s.bar && bar < s.bar + s.bars) || SECTIONS[0];

export default function build() {
  const c = new Composer({ bpm: BPM, bars: BARS });

  for (let bar = 0; bar < BARS; bar++) {
    const sec = secOf(bar).name;
    const ch = chordAt(bar);
    const root = BASS[bar % 4];
    const big = sec === 'peak' || sec === 'release';
    const beat = big || sec === 'build' || sec === 'rebuild';

    c.padBar(bar, ch, { gain: big ? 0.5 : 0.85 });
    if (sec === 'break') c.padBar(bar, ch, { kind: 'choir', gain: 0.8, octave: 1 });

    if (beat) {
      c.drumBar(bar, {
        kick: 'x---x---x---x---',
        clap: big ? '----x-------x---' : '------------x---',
        hat: big ? '--x---x---x---xo' : '--x---x---x---x-',
      }, { hatGain: 0.75 });
      c.bassBar(bar, '--x---x---x---x-', () => root + 12, { dur: 0.22, gain: 0.85 });
      c.E(c.at(bar), 'sub', { n: root, d: 1.8 * c.spb, g: 0.6 });
    }

    // The arpeggio: always present, but only fully audible at the peaks.
    if (sec !== 'intro' || bar >= 4) {
      const gain = big ? 0.75 : sec === 'break' ? 0.4 : 0.55;
      c.arpBar(bar, ch, ARP, {
        kind: 'pluck', gain, dur: 0.2, weight: big ? 0.85 : 0.95, octave: 1, accentEvery: 8,
      });
    }

    const idx = sec === 'peak' ? bar - 24 : sec === 'release' ? bar - 48 + 4 : -1;
    if (idx >= 0) {
      c.line(bar, TUNE[idx % TUNE.length], {
        gain: 1.05, double: { kind: 'stab', octave: 0, gain: 0.3 }, holdMin: 1.5, accentOn: [1, 3],
      });
    }

    if ([0, 24, 32, 48].includes(bar)) c.E(c.at(bar), 'crash', { g: bar === 0 ? 0.4 : 0.95 });
    if (bar === 22 || bar === 46) c.E(c.at(bar), 'riser', { d: 8 * c.spb });
    if (bar === 47) c.E(c.at(bar) + 3.5, 'sub', { n: 57, d: 1.4 * c.spb });
  }

  // The intro is arpeggio only, which EASY does not take; state the harmony.
  for (let bar = 3; bar < 8; bar++) {
    const ch = chordAt(bar);
    c.E(c.at(bar), 'bell', { n: ch[3], d: 2.4 * c.spb, g: 0.5 });
    c.H(c.at(bar), { layer: 'lead', pitch: ch[3], weight: 0.93, hold: 2 });
    c.H(c.at(bar) + 2, { layer: 'lead', pitch: ch[1], weight: 0.8, accent: bar % 2 === 1 });
  }

  // The break drops to pad and choir; give it the melody in long tones.
  for (let bar = 33; bar < 39; bar++) {
    const ch = chordAt(bar);
    c.E(c.at(bar), 'bell', { n: ch[3] + 12, d: 3 * c.spb, g: 0.55 });
    c.H(c.at(bar), { layer: 'lead', pitch: ch[3] + 12, weight: 0.93, hold: 2.5 });
    c.H(c.at(bar) + 3, { layer: 'lead', pitch: ch[1] + 12, weight: 0.8, accent: true });
  }

  return assemble(c, {
    id: 'solstice',
    title: 'Solstice',
    artist: 'Sosoph Synth',
    genre: 'Trance',
  }, SECTIONS);
}
