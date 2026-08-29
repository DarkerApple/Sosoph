// "Midnight Transit" — 174 BPM drum and bass in F minor.
//
// A half-time feel over a broken break: the drums run at 174 but the melody
// moves at 87, which is what makes a DnB chart readable at that tempo. The
// chart follows the pads and the lead, not the break.

import { Composer, assemble, chordOn, voice, SCALES } from '../music.js';

const BPM = 174;
const BARS = 64;
const ROOT = 65;

const DEGREES = [0, 5, 3, 4];
const BASS = [29, 25, 34, 27];
const chordAt = (bar) => voice(chordOn(ROOT, SCALES.minor, DEGREES[bar % 4], 4), 53, 77);

// One line per two bars — half-time, so the grid is sixteen slots of an eighth.
const LINE = [
  [77, null, null, 75, null, 72, null, null, 70, null, 72, null, null, null, null, null],
  [72, null, null, 70, null, 68, null, null, 65, null, 68, null, 70, null, null, null],
  [75, null, 77, null, null, 80, null, null, 77, null, 75, null, null, 72, null, null],
  [73, null, null, 72, null, 68, null, null, 70, null, null, null, null, null, null, null],
];

const BREAK = 'x-s-x--sx-s-xs--';

const SECTIONS = [
  { name: 'intro', bar: 0, bars: 8, intensity: 0.2 },
  { name: 'roll', bar: 8, bars: 16, intensity: 0.6 },
  { name: 'drop', bar: 24, bars: 16, intensity: 1 },
  { name: 'still', bar: 40, bars: 8, intensity: 0.28 },
  { name: 'last', bar: 48, bars: 12, intensity: 1 },
  { name: 'out', bar: 60, bars: 4, intensity: 0.25 },
];

const secOf = (bar) => SECTIONS.find((s) => bar >= s.bar && bar < s.bar + s.bars) || SECTIONS[0];

export default function build() {
  const c = new Composer({ bpm: BPM, bars: BARS });

  for (let bar = 0; bar < BARS; bar++) {
    const sec = secOf(bar).name;
    const ch = chordAt(bar);
    const root = BASS[bar % 4];
    const loud = sec === 'drop' || sec === 'last';
    const moving = loud || sec === 'roll';

    c.padBar(bar, ch, { kind: 'choir', gain: loud ? 0.5 : 0.85 });

    if (moving) {
      // Kick on 1 and the "and" of 3, snare on 3 — the amen skeleton.
      c.drumBar(bar, {
        kick: loud ? 'x-------x-x-----' : 'x---------------',
        snare: '--------x-------',
        hat: loud ? BREAK : 'x---x---x---x---',
      }, { hatGain: 0.7 });
      if (loud) c.E(c.at(bar) + 3.5, 'snare', { g: 0.45 });
      // The sub is the other half of the genre: one long note per bar.
      c.E(c.at(bar), 'sub', { n: root, d: 2.2 * c.spb, g: 0.85 });
      c.bassBar(bar, loud ? 'x---x-x---x-x---' : 'x-------x-------', () => root + 12, { dur: 0.3, gain: 0.6 });
    } else if (sec === 'still' && bar >= 44) {
      c.drumBar(bar, { kick: 'x-------', hat: 'x-x-x-x-' }, { hatGain: 0.5 });
    }

    // --- line ---------------------------------------------------------------
    const idx = sec === 'roll' ? bar - 8 : sec === 'drop' ? bar - 24 : sec === 'last' ? bar - 48 : -1;
    if (idx >= 0 && idx % 2 === 0) {
      const row = LINE[(idx / 2) % LINE.length];
      // Two bars of melody at a time, so the half-time feel survives.
      c.line(bar, row.slice(0, 8), { steps: 8, gain: loud ? 1 : 0.65, holdMin: 1, accentOn: [2] });
      c.line(bar + 1, row.slice(8), { steps: 8, gain: loud ? 1 : 0.65, holdMin: 1, accentOn: [0] });
    }

    if (loud) c.arpBar(bar, ch, [0, null, 2, null, 1, null, 3, null], {
      kind: 'pluck', gain: 0.5, dur: 0.25, weight: 0.6,
    });

    if ([0, 24, 40, 48].includes(bar)) c.E(c.at(bar), 'crash', { g: bar === 0 ? 0.45 : 0.9 });
    if (bar === 22) c.E(c.at(bar), 'riser', { d: 8 * c.spb });
    if (bar === 47) c.E(c.at(bar) + 2, 'sub', { n: 53, d: 2 * c.spb });
  }

  // The `still` section strips back to pads; keep a slow line under it.
  for (let bar = 40; bar < 48; bar++) {
    const ch = chordAt(bar);
    c.E(c.at(bar), 'piano', { n: ch[3], d: 2.4 * c.spb, g: 0.6 });
    c.H(c.at(bar), { layer: 'lead', pitch: ch[3], weight: 0.93, hold: 2 });
    c.H(c.at(bar) + 2.5, { layer: 'lead', pitch: ch[1], weight: 0.78, accent: bar % 2 === 0 });
  }

  // The intro is pad-only; give it a slow skeleton so it is playable.
  for (let bar = 4; bar < 8; bar++) {
    const ch = chordAt(bar);
    c.E(c.at(bar), 'bell', { n: ch[2] + 12, d: 2 * c.spb, g: 0.6 });
    c.H(c.at(bar), { layer: 'lead', pitch: ch[2] + 12, weight: 0.92, hold: 2, accent: bar % 2 === 1 });
    c.H(c.at(bar) + 2, { layer: 'lead', pitch: ch[1] + 12, weight: 0.8 });
  }

  return assemble(c, {
    id: 'midnight-transit',
    title: 'Midnight Transit',
    artist: 'Sosoph Synth',
    genre: 'Drum & Bass',
  }, SECTIONS);
}
