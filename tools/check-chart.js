// Headless validation of every song and difficulty: `npm run check`.
//
// Catches the authoring mistakes that are painful to find by playing —
// overlapping holds, unreachable density, and the one that is specific to this
// game: asking a single finger to change key rows faster than it can move.

import { catalogue, songDef, chartFor, SONG_ORDER } from '../js/songs/index.js';
import { PROFILES, RELEASE_GAP_BEATS } from '../js/chart.js';
import {
  LANE_COUNT, FLICK, FLICK_WINDOW, FLICK_CLEARANCE, flickChannel,
} from '../js/theme.js';

const errors = [];
const warnings = [];




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
    if (n.flick && flickChannel(n.lane, n.flick) < 0) {
      fail(`lane ${n.lane} cannot flick that way at ${at(n.t)}`);
    }
    if (n.flick && n.isHold) fail(`hold cannot also be a flick at ${at(n.t)}`);
    if (n.t < 0) fail(`negative time at index ${i}`);
    if (n.t + n.dur > def.duration) fail(`note past the song end at ${at(n.t)}`);
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

  // --- flicks have somewhere to roll -----------------------------------------
  // A flick is only playable if the key it rolls onto is free for the length of
  // the roll. If another note wants that key in the meantime, one finger is
  // being asked for two things.
  const claims = new Map();
  for (const n of notes) {
    if (!claims.has(n.lane)) claims.set(n.lane, []);
    claims.get(n.lane).push([n.t, n.t + n.dur]);
  }
  for (const n of notes) {
    if (!n.flick) continue;
    const ch = flickChannel(n.lane, n.flick);
    // Only a sideways roll lands on a lane key; a down-flick has its row to
    // itself, so nothing can be in its way.
    if (n.flick === FLICK.DOWN) continue;
    const clash = (claims.get(ch) || []).find(
      ([a, b]) => n.t - FLICK_CLEARANCE < b - 1e-6 && n.t + FLICK_WINDOW > a + 1e-6
    );
    if (clash) {
      fail(`flick at ${at(n.t)} rolls onto lane ${ch}, which is busy at ${at(clash[0])}`);
    }
  }

  // --- simultaneity --------------------------------------------------------
  let i = 0;
  while (i < notes.length) {
    let j = i;
    while (j + 1 < notes.length && notes[j + 1].t - notes[i].t < 1e-4) j++;
    const chord = notes.slice(i, j + 1);
    if (chord.length > 2) fail(`${chord.length}-note chord at ${at(notes[i].t)}`);
    const lanes = new Set(chord.map((n) => n.lane));
    if (lanes.size < chord.length) fail(`chord at ${at(notes[i].t)} needs one finger twice`);
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
      `${num(st.holds ?? 0, 3)} holds  ${num(chart.flicks, 3)} flicks ` +
      `(${num(Math.round((chart.flicks / chart.notes.length) * 100), 2)}%)  ` +
      `peak ${num(st.peak ?? 0, 2)}/s  min gap ${num(((st.minGap ?? 0) * 1000) | 0, 4)}ms  ` +
      `lanes ${spread.join('/')}`
    );
  }
}

// Every difficulty a song advertises must actually exist, and must be worth
// advertising: a tier that produces nearly the same chart as the one below it
// is a wasted entry in the song list.
for (const { id, difficulties } of SONG_ORDER) {
  for (const d of difficulties) {
    if (!PROFILES[d]) errors.push(`${id}: unknown difficulty "${d}"`);
  }
  for (let i = 1; i < difficulties.length; i++) {
    const lo = chartFor(id, difficulties[i - 1]);
    const hi = chartFor(id, difficulties[i]);
    const growth = (hi.notes.length - lo.notes.length) / Math.max(1, lo.notes.length);
    if (growth < 0.08 && hi.level <= lo.level) {
      warnings.push(
        `${id}: ${difficulties[i]} adds only ${Math.round(growth * 100)}% over ` +
        `${difficulties[i - 1]} (${lo.notes.length} -> ${hi.notes.length} notes, lv${lo.level} -> lv${hi.level})`
      );
    }
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
