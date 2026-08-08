// Sanity check for the Stage 1 chart. Runs headless: `npm run check`.
//
// Catches the kinds of authoring mistakes that are painful to spot by playing —
// overlapping holds, unreachable density spikes, notes past the end of the song.

import { buildStage1 } from '../js/song.js';

const song = buildStage1();
const errors = [];
const warn = [];

const at = (t) => `${t.toFixed(3)}s (beat ${(t / song.spb).toFixed(2)})`;

// --- ordering and bounds ---------------------------------------------------
for (let i = 0; i < song.notes.length; i++) {
  const n = song.notes[i];
  if (i > 0 && n.t < song.notes[i - 1].t - 1e-6) {
    errors.push(`notes out of order at index ${i}`);
  }
  if (n.lane < 0 || n.lane > 3) errors.push(`bad lane ${n.lane} at ${at(n.t)}`);
  if (n.t < 0) errors.push(`negative time at index ${i}`);
  if (n.t + n.dur > song.duration) errors.push(`note past song end at ${at(n.t)}`);
  if (n.isHold && n.dur < song.spb * 0.4) {
    warn.push(`very short hold (${(n.dur * 1000).toFixed(0)}ms) at ${at(n.t)}`);
  }
}

// --- per-lane overlap ------------------------------------------------------
const laneEnd = [-1, -1, -1, -1];
const laneAt = [0, 0, 0, 0];
for (const n of song.notes) {
  if (n.t < laneEnd[n.lane] - 1e-6) {
    errors.push(
      `lane ${n.lane}: note at ${at(n.t)} starts inside the hold from ${at(laneAt[n.lane])}`
    );
  }
  laneEnd[n.lane] = n.t + n.dur;
  laneAt[n.lane] = n.t;
}

// --- simultaneity ----------------------------------------------------------
let i = 0;
while (i < song.notes.length) {
  let j = i;
  while (j + 1 < song.notes.length && song.notes[j + 1].t - song.notes[i].t < 1e-4) j++;
  const size = j - i + 1;
  if (size > 2) errors.push(`${size}-note chord at ${at(song.notes[i].t)}`);
  i = j + 1;
}

// --- density ---------------------------------------------------------------
let minGap = Infinity;
for (let k = 1; k < song.notes.length; k++) {
  const gap = song.notes[k].t - song.notes[k - 1].t;
  if (gap > 1e-4 && gap < minGap) minGap = gap;
}

const WINDOW = 1;
let peak = 0;
for (let k = 0; k < song.notes.length; k++) {
  let c = 0;
  while (k + c < song.notes.length && song.notes[k + c].t - song.notes[k].t < WINDOW) c++;
  if (c > peak) peak = c;
}
if (peak > 16) warn.push(`peak density ${peak} notes/sec looks harsh for stage 1`);

// --- audio timeline --------------------------------------------------------
for (let k = 1; k < song.events.length; k++) {
  if (song.events[k].t < song.events[k - 1].t - 1e-9) {
    errors.push(`audio events out of order at index ${k}`);
  }
}

// --- report ----------------------------------------------------------------
const holds = song.notes.filter((n) => n.isHold).length;
const perLane = [0, 0, 0, 0];
for (const n of song.notes) perLane[n.lane]++;

console.log(`${song.name} — ${song.difficulty}`);
console.log(`  bpm         ${song.bpm}`);
console.log(`  duration    ${song.duration.toFixed(2)}s`);
console.log(`  notes       ${song.notes.length} (${holds} holds)`);
console.log(`  units       ${song.units}`);
console.log(`  lane spread ${perLane.join(' / ')}`);
console.log(`  min gap     ${(minGap * 1000).toFixed(0)}ms`);
console.log(`  peak        ${peak} notes / sec`);
console.log(`  audio events ${song.events.length}`);

for (const w of warn) console.log(`  warn: ${w}`);

if (errors.length) {
  console.error(`\n${errors.length} error(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log('\nchart OK');
