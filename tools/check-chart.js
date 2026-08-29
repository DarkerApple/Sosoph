// Headless validation of every song and difficulty: `npm run check`.
//
// Catches the authoring mistakes that are painful to find by playing —
// overlapping holds, unreachable density, and the one that is specific to this
// game: asking a single finger to change key rows faster than it can move.

import { catalogue, songDef, chartFor, SONG_ORDER } from '../js/songs/index.js';
import { PROFILES, RELEASE_GAP_BEATS } from '../js/chart.js';
import { LANE_COUNT, homeLaneOf, PLAIN, NOTE_COLORS } from '../js/theme.js';

const errors = [];
const warnings = [];

/** The physical finger a note needs; lane keys and colour keys share four. */
const fingerOf = (n) => (n.color === PLAIN ? n.lane : homeLaneOf(n.color));
const rowOf = (n) => (n.color === PLAIN ? 0 : 1);

/** The lowest row-change gap any difficulty allows, as an absolute floor. */
const MIN_ROW_SWITCH = Math.min(...Object.values(PROFILES).map((p) => p.rowSwitchSec));

function checkChart(def, diff, chart) {
  const where = `${def.title}/${diff}`;
  const at = (t) => `${t.toFixed(3)}s (beat ${(t / def.spb).toFixed(2)})`;
  const notes = chart.notes;
  const fail = (m) => errors.push(`${where}: ${m}`);
  const warn = (m) => warnings.push(`${where}: ${m}`);

  if (!notes.length) return fail('empty chart');

  // --- ordering and bounds -------------------------------------------------
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    if (i > 0 && n.t < notes[i - 1].t - 1e-6) fail(`notes out of order at index ${i}`);
    if (n.lane < 0 || n.lane >= LANE_COUNT) fail(`bad lane ${n.lane} at ${at(n.t)}`);
    if (n.color < 0 || n.color > NOTE_COLORS.length) fail(`bad colour ${n.color} at ${at(n.t)}`);
    if (n.t < 0) fail(`negative time at index ${i}`);
    if (n.t + n.dur > def.duration) fail(`note past the song end at ${at(n.t)}`);
    if (n.isHold && n.color !== PLAIN) warn(`coloured hold at ${at(n.t)}`);
  }

  // --- per-lane overlap and release room -----------------------------------
  // A hold that ends on the same tick as the next note in its lane cannot be
  // played: there is no moment in which to let go and press again.
  const release = def.spb * RELEASE_GAP_BEATS;
  const laneEnd = new Array(LANE_COUNT).fill(-Infinity);
  const laneAt = new Array(LANE_COUNT).fill(0);
  const laneWasHold = new Array(LANE_COUNT).fill(false);
  for (const n of notes) {
    if (n.t < laneEnd[n.lane] - 1e-6) {
      fail(`lane ${n.lane}: note at ${at(n.t)} starts inside the hold from ${at(laneAt[n.lane])}`);
    } else if (laneWasHold[n.lane] && n.t < laneEnd[n.lane] + release - 1e-6) {
      fail(
        `lane ${n.lane}: only ${((n.t - laneEnd[n.lane]) * 1000) | 0}ms to release the hold ` +
        `from ${at(laneAt[n.lane])} before the note at ${at(n.t)}`
      );
    }
    laneEnd[n.lane] = n.t + n.dur;
    laneAt[n.lane] = n.t;
    laneWasHold[n.lane] = n.isHold;
  }

  // --- one finger, one job -------------------------------------------------
  // Two notes on the same finger in the same instant are unplayable, and a row
  // change needs time for the finger to travel.
  const fingerFree = new Array(LANE_COUNT).fill(-Infinity);
  const fingerRow = new Array(LANE_COUNT).fill(0);
  for (const n of notes) {
    const f = fingerOf(n);
    const row = rowOf(n);
    if (fingerRow[f] !== row && n.t - fingerFree[f] < MIN_ROW_SWITCH - 1e-6) {
      fail(
        `finger ${f} has ${(n.t - fingerFree[f]) * 1000 | 0}ms to change rows at ${at(n.t)} ` +
        `(needs ${MIN_ROW_SWITCH * 1000}ms)`
      );
    }
    fingerFree[f] = n.t + n.dur;
    fingerRow[f] = row;
  }

  // --- simultaneity --------------------------------------------------------
  let i = 0;
  while (i < notes.length) {
    let j = i;
    while (j + 1 < notes.length && notes[j + 1].t - notes[i].t < 1e-4) j++;
    const chord = notes.slice(i, j + 1);
    if (chord.length > 2) fail(`${chord.length}-note chord at ${at(notes[i].t)}`);
    const fingers = new Set(chord.map(fingerOf));
    if (fingers.size < chord.length) fail(`chord at ${at(notes[i].t)} needs one finger twice`);
    i = j + 1;
  }

  // --- density -------------------------------------------------------------
  let minGap = Infinity;
  for (let k = 1; k < notes.length; k++) {
    const gap = notes[k].t - notes[k - 1].t;
    if (gap > 1e-4 && gap < minGap) minGap = gap;
  }
  let peak = 0;
  for (let k = 0; k < notes.length; k++) {
    let c = 0;
    while (k + c < notes.length && notes[k + c].t - notes[k].t < 1) c++;
    if (c > peak) peak = c;
  }
  const cap = { easy: 5, normal: 10, hard: 14, expert: 20, master: 24 }[diff] ?? 24;
  if (peak > cap) warn(`peak ${peak} notes/sec exceeds the ${cap} expected for ${diff}`);

  // --- gaps ----------------------------------------------------------------
  // A long silent stretch mid-song reads as a bug, not as a rest.
  let worst = notes[0].t;
  let worstAt = 0;
  for (let k = 1; k < notes.length; k++) {
    const gap = notes[k].t - (notes[k - 1].t + notes[k - 1].dur);
    if (gap > worst) { worst = gap; worstAt = notes[k - 1].t; }
  }
  if (worst > 6) warn(`${worst.toFixed(1)}s with no notes after ${at(worstAt)}`);

  return { peak, minGap, holds: notes.filter((n) => n.isHold).length };
}

// ---------------------------------------------------------------- report ---

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

for (const entry of catalogue()) {
  const def = songDef(entry.id);
  console.log(`\n${def.title} — ${def.artist} · ${def.bpm} BPM · ${def.duration.toFixed(1)}s · ${def.events.length} audio events`);
  for (const { id: diff } of entry.difficulties) {
    const chart = chartFor(entry.id, diff);
    const st = checkChart(def, diff, chart) || {};
    const spread = new Array(LANE_COUNT).fill(0);
    for (const n of chart.notes) spread[n.lane]++;
    console.log(
      `  ${pad(diff, 7)} lv${num(chart.level, 2)}  ${num(chart.notes.length, 4)} notes  ` +
      `${num(st.holds ?? 0, 3)} holds  ${num(chart.colored, 3)} colour  ` +
      `peak ${num(st.peak ?? 0, 2)}/s  min gap ${num(((st.minGap ?? 0) * 1000) | 0, 4)}ms  ` +
      `lanes ${spread.join('/')}`
    );
  }
}

// Every difficulty a song advertises must actually exist.
for (const { id, difficulties } of SONG_ORDER) {
  for (const d of difficulties) {
    if (!PROFILES[d]) errors.push(`${id}: unknown difficulty "${d}"`);
  }
}

console.log('');
for (const w of warnings) console.log(`warn: ${w}`);

if (errors.length) {
  console.error(`\n${errors.length} error(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`\nall charts OK${warnings.length ? ` (${warnings.length} warning(s))` : ''}`);
