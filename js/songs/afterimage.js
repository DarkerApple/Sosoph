// "Afterimage" — 146 BPM future bass in Eb major.
//
// Chords do the work: every drop is a wide detuned stack that moves on the
// offbeat, and the lead only picks out its top note. That gives the chart an
// unusual shape — sparse where the music is loudest, busy in the fills.

import { Composer, assemble, chordOn, voice, SCALES } from '../music.js';

const BPM = 146;
const BARS = 56;
const ROOT = 63;

const DEGREES = [3, 4, 0, 5];
const BASS = [32, 34, 39, 36];
const chordAt = (bar) => voice(chordOn(ROOT, SCALES.major, DEGREES[bar % 4], 4), 58, 80);

// Where the chord stack lands — offbeat and dotted, never square.
const STACK = '--x---x-x---x---';

const TOPLINE = [
  [82, null, null, 80, null, 77, null, null],
  [80, null, null, 75, null, null, null, null],
  [75, null, 77, null, 80, null, 82, null],
  [80, null, null, null, null, null, null, null],
  [87, null, 85, 82, null, 80, null, null],
  [82, null, 80, null, 77, null, 75, null],
  [77, 79, 80, 82, null, 85, null, 87],
  [85, null, null, null, null, null, null, null],
];

const SECTIONS = [
  { name: 'open', bar: 0, bars: 8, intensity: 0.25 },
  { name: 'verse', bar: 8, bars: 8, intensity: 0.5 },
  { name: 'build', bar: 16, bars: 4, intensity: 0.75 },
  { name: 'drop', bar: 20, bars: 12, intensity: 1 },
  { name: 'calm', bar: 32, bars: 6, intensity: 0.3 },
  { name: 'drop2', bar: 38, bars: 14, intensity: 1 },
  { name: 'fade', bar: 52, bars: 4, intensity: 0.3 },
];

const secOf = (bar) => SECTIONS.find((s) => bar >= s.bar && bar < s.bar + s.bars) || SECTIONS[0];

export default function build() {
  const c = new Composer({ bpm: BPM, bars: BARS });

  for (let bar = 0; bar < BARS; bar++) {
    const sec = secOf(bar).name;
    const ch = chordAt(bar);
    const root = BASS[bar % 4];
    const drop = sec === 'drop' || sec === 'drop2';

    if (sec === 'open' || sec === 'calm' || sec === 'fade') {
      c.padBar(bar, ch, { kind: 'choir', gain: 0.9 });
    }

    if (drop || sec === 'verse' || sec === 'build') {
      c.drumBar(bar, {
        kick: drop ? 'x-----x---x-----' : 'x-------x-------',
        clap: '----x-------x---',
        hat: drop ? 'x-xxx-xxx-xxx-xo' : 'x-x-x-x-x-x-x-x-',
      }, { hatGain: 0.7 });
      c.E(c.at(bar), 'sub', { n: root, d: 2 * c.spb, g: drop ? 0.9 : 0.5 });
    }

    // The chord stack. Each hit is a playable moment, and the topline picks up
    // the same rhythm an octave higher.
    if (drop || sec === 'build') {
      c.seq(bar, STACK, (b, g, i) => {
        c.E(b, 'stab', { n: ch, d: 0.5 * c.spb, g: g * (drop ? 0.85 : 0.6) });
        c.E(b, 'pad', { n: ch.map((n) => n + 12), d: 0.5 * c.spb, g: 0.3 });
        c.H(b, {
          layer: 'stab',
          pitch: ch[ch.length - 1],
          weight: Math.max(0.55, c.w(b - c.at(bar))),
          accent: i === 2 || i === 8,
        });
      });
    }

    const idx = sec === 'verse' ? bar - 8 : sec === 'drop' ? bar - 20 : sec === 'drop2' ? bar - 38 + 4 : -1;
    if (idx >= 0) {
      c.line(bar, TOPLINE[idx % TOPLINE.length], {
        kind: 'bell',
        gain: drop ? 0.8 : 0.65,
        double: drop ? { kind: 'lead', octave: -1, gain: 0.45 } : null,
        holdMin: 1.5,
        accentOn: [1, 3],
      });
    }

    if ([0, 20, 38].includes(bar)) c.E(c.at(bar), 'crash', { g: bar === 0 ? 0.4 : 0.9 });
    if (bar === 18 || bar === 36) c.E(c.at(bar), 'riser', { d: 8 * c.spb, g: 0.9 });
    if (bar === 19 || bar === 37) c.E(c.at(bar) + 3.5, 'sub', { n: 51, d: 1.2 * c.spb });
  }

  // The opening and the calm are chords only; give them the top voice.
  for (const [from, to] of [[2, 8], [32, 37]]) {
    for (let bar = from; bar < to; bar++) {
      const ch = chordAt(bar);
      c.E(c.at(bar), 'piano', { n: ch[3], d: 2 * c.spb, g: 0.6 });
      c.H(c.at(bar), { layer: 'lead', pitch: ch[3], weight: 0.93, hold: 2 });
      c.H(c.at(bar) + 2.5, { layer: 'lead', pitch: ch[1], weight: 0.78, accent: bar % 2 === 0 });
    }
  }

  return assemble(c, {
    id: 'afterimage',
    title: 'Afterimage',
    artist: 'Sosoph Synth',
    genre: 'Future Bass',
  }, SECTIONS);
}
