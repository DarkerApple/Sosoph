// Gameplay: judgement, scoring and hold logic.
//
// A note is either PLAIN — struck with its lane key — or coloured, which is
// struck with that colour's key on the row below. Both kinds fall in a lane, so
// reading the chart is unchanged; the colour tells the finger which row to use.

import { Particles } from './particles.js';
import { CHANNELS } from './input.js';
import { LANE_COUNT, FLICK, FLICK_WINDOW, flickChannel } from './theme.js';
import { travelTime } from './settings.js';

// Judgement windows in seconds, measured from the note's exact time.
export const WINDOWS = { PERFECT: 0.045, GREAT: 0.09, GOOD: 0.135 };
const MISS_AFTER = WINDOWS.GOOD;
/** Releasing a hold this close to its end still counts as completed. */
const HOLD_LENIENCY = 0.14;

const WEIGHT = { PERFECT: 1, GREAT: 0.68, GOOD: 0.32, MISS: 0 };
const ACC_SCORE = 900000;
const COMBO_SCORE = 100000;

const GRADES = [
  [99.5, 'SSS'], [98, 'SS'], [95, 'S'], [91, 'A'],
  [86, 'B'], [78, 'C'], [0, 'D'],
];

export class Game {
  constructor({ song, audio, renderer, input, settings, onFinish }) {
    this.song = song;
    this.audio = audio;
    this.renderer = renderer;
    this.input = input;
    this.settings = settings;
    this.onFinish = onFinish;

    this.particles = new Particles();
    this.laneHeld = new Array(LANE_COUNT).fill(false);
    this.channelHeld = new Array(CHANNELS).fill(false);

    this.reset();
  }

  reset() {
    // `play` is the flick actually in force: turning flicks off in settings
    // flattens the whole chart to plain taps and holds.
    const flicks = this.settings.flickNotes;
    for (const n of this.song.notes) {
      n.play = flicks ? n.flick || FLICK.NONE : FLICK.NONE;
      n.finish = flickChannel(n.lane, n.play);
      n.headJudged = false;
      n.tailJudged = false;
      n.holdActive = false;
      n.holdBroken = false;
      n.gone = false;
      n.holdEnd = n.t + n.dur;
      n.nextSpark = 0;
      n.heldBy = -1;
    }

    this.units = this.song.units;
    this.comboMax = (this.units * (this.units + 1)) / 2;

    this.time = -1;
    this.checkFrom = 0;
    this.renderFrom = 0;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.accSum = 0;
    this.comboSum = 0;
    this.judgedUnits = 0;
    this.counts = { PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0 };
    /** Recent hit offsets in seconds, for the monitor's calibration readout. */
    this.deltas = [];
    this.bassEnergy = 0;

    this.started = false;
    this.paused = false;
    this.finished = false;
    this.countdown = 0;
    this.autoplay = this.settings.autoplay;

    /** Flicks whose lane key is down and whose roll has not landed yet. */
    this.armed = [];

    this.particles.clear();
    this.laneHeld.fill(false);
    this.channelHeld.fill(false);
  }

  get travelTime() {
    return travelTime();
  }

  get accuracy() {
    return this.judgedUnits === 0 ? 100 : (this.accSum / this.judgedUnits) * 100;
  }

  // ------------------------------------------------------------ lifecycle --

  async start() {
    this.reset();
    this.input.enabled = true;
    this.input.drain();
    await this.audio.start(this.song, 1.4);
    this.started = true;
  }

  async togglePause() {
    if (!this.started || this.finished) return;
    if (this.paused) {
      this.paused = false;
      this.countdown = 3; // audio resumes when this reaches zero
    } else {
      this.paused = true;
      this.input.releaseAll();
      this.input.drain();
      await this.audio.pause();
    }
    return this.paused;
  }

  async quit() {
    this.input.enabled = false;
    this.started = false;
    await this.audio.stop();
  }

  // ------------------------------------------------------------ judgement --

  _label(absDelta) {
    if (absDelta <= WINDOWS.PERFECT) return 'PERFECT';
    if (absDelta <= WINDOWS.GREAT) return 'GREAT';
    if (absDelta <= WINDOWS.GOOD) return 'GOOD';
    return 'MISS';
  }

  _register(label, delta, showFx = true) {
    if (label === 'MISS') {
      this.combo = 0;
      this.counts.MISS++;
    } else {
      this.combo++;
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;
      this.comboSum += this.combo;
      this.counts[label]++;
    }
    this.accSum += WEIGHT[label];
    this.judgedUnits++;
    if (label !== 'MISS') {
      this.deltas.push(delta);
      if (this.deltas.length > 120) this.deltas.shift();
    }

    this.score =
      (ACC_SCORE * this.accSum) / this.units +
      (COMBO_SCORE * this.comboSum) / this.comboMax;

    if (showFx) this.renderer.showJudge(label, delta, this.time);
  }

  _laneX(lane) {
    const pf = this.renderer.pf;
    return pf.left + lane * pf.laneW + pf.laneW / 2;
  }

  /** Which of the three note colours a note wears. */
  _kindOf(note) {
    if (note.play) return 'flick';
    return note.isHold ? 'hold' : 'tap';
  }

  _hitEffects(note, label) {
    const x = this._laneX(note.lane);
    const y = this.renderer.pf.receptorY;
    const strength = label === 'PERFECT' ? 1 : label === 'GREAT' ? 0.72 : 0.45;
    const col = this.renderer.noteRgb[this._kindOf(note)];
    this.particles.burst(x, y, col, strength, this.settings.effects);
    this.particles.ring(x, y, col, this.renderer.pf.laneW * 0.95, strength);
    this.particles.bloom(x, y, col, this.renderer.pf.laneW * 0.8);
    this.renderer.hitLane(note.lane, strength, col);
    if (!this.autoplay) this.audio.hitSound(note.lane);
  }

  /** Best candidate in a lane for a press. */
  _findCandidate(lane, hitTime) {
    const notes = this.song.notes;
    let best = null;
    let bestDelta = Infinity;
    for (let i = this.checkFrom; i < notes.length; i++) {
      const n = notes[i];
      if (n.t > hitTime + WINDOWS.GOOD) break;
      if (n.headJudged || n.gone || n.lane !== lane) continue;
      const d = Math.abs(hitTime - n.t);
      if (d <= WINDOWS.GOOD && d < bestDelta) {
        bestDelta = d;
        best = n;
      }
    }
    return best;
  }

  /**
   * A press either finishes a flick already in the air or opens a new note.
   * Finishing takes priority: the key a flick rolls onto is kept clear of other
   * notes by the chart, so a press landing there during the roll can only mean
   * the roll.
   */
  _press(ev, hitTime) {
    if (this._finishFlick(ev.channel, hitTime)) return;
    if (ev.channel >= LANE_COUNT) return; // the lower row only ever finishes flicks

    const note = this._findCandidate(ev.channel, hitTime);
    if (!note) return;

    const delta = hitTime - note.t;
    note.headJudged = true;

    // A flick is judged on its opening press but not *awarded* until the roll
    // lands, so its timing is the tap's and its outcome is the gesture's.
    if (note.play) {
      note.gone = false;
      this.armed.push({ note, delta, at: this.time });
      return;
    }

    if (note.isHold) {
      note.holdActive = true;
      note.heldBy = ev.channel;
      note.nextSpark = this.time;
    } else {
      note.gone = true;
    }

    this._register(this._label(Math.abs(delta)), delta);
    this._hitEffects(note, this._label(Math.abs(delta)));
  }

  /** Complete an armed flick if `channel` is the key it rolls onto. */
  _finishFlick(channel, hitTime) {
    for (let i = 0; i < this.armed.length; i++) {
      const a = this.armed[i];
      if (a.note.finish !== channel) continue;
      if (hitTime - a.note.t > FLICK_WINDOW + WINDOWS.GOOD) continue;
      this.armed.splice(i, 1);
      a.note.gone = true;
      const label = this._label(Math.abs(a.delta));
      this._register(label, a.delta);
      this._hitEffects(a.note, label);
      return true;
    }
    return false;
  }

  /** Touch swipes finish flicks by direction rather than by key. */
  _swipe(lane, dir) {
    for (let i = 0; i < this.armed.length; i++) {
      const a = this.armed[i];
      if (a.note.lane !== lane || a.note.play !== dir) continue;
      return this._finishFlick(a.note.finish, this.time);
    }
    return false;
  }

  /** Drop flicks whose roll never landed. */
  _sweepFlicks() {
    for (let i = this.armed.length - 1; i >= 0; i--) {
      const a = this.armed[i];
      if (this.time - a.note.t <= FLICK_WINDOW) continue;
      this.armed.splice(i, 1);
      a.note.gone = true;
      a.note.flickBroken = true;
      this._register('MISS', 0);
      this.particles.missDust(this._laneX(a.note.lane), this.renderer.pf.receptorY);
    }
  }

  _release(channel) {
    const notes = this.song.notes;
    for (let i = this.checkFrom; i < notes.length; i++) {
      const n = notes[i];
      if (n.t > this.time) break;
      if (!n.holdActive || n.heldBy !== channel) continue;
      if (this.time >= n.holdEnd - HOLD_LENIENCY) {
        this._completeHold(n);
      } else {
        n.holdActive = false;
        n.holdBroken = true;
        n.tailJudged = true;
        n.gone = true;
        this._register('MISS', 0);
        this.particles.missDust(this._laneX(n.lane), this.renderer.pf.receptorY);
      }
      return;
    }
  }

  _completeHold(n) {
    n.holdActive = false;
    n.tailJudged = true;
    n.gone = true;
    this._register('PERFECT', 0);
    this._hitEffects(n, 'PERFECT');
  }

  // ----------------------------------------------------------------- loop --

  update(dt) {
    if (!this.started) return;
    if (this.finished) {
      this.particles.update(dt);
      return;
    }
    if (this.paused) return;

    // The transport stays suspended for the whole countdown, so the music
    // restarts exactly where it stopped rather than running behind the overlay.
    if (this.countdown > 0) {
      this.countdown -= dt;
      // Input is swallowed until the countdown clears, so a key held from
      // before the pause cannot fire a stray judgement.
      this.input.drain();
      this.particles.update(dt);
      if (this.countdown <= 0) {
        this.countdown = 0;
        this.audio.resume();
      }
      return;
    }

    this.time = this.audio.update(performance.now());
    this.bassEnergy = this.audio.bassEnergy();

    if (this.autoplay) this._autoplay();
    else this._consumeInput();

    this._updateHolds(dt);
    this._sweepFlicks();
    this._sweepMisses();
    this._advanceWindow();
    this._readHeld();

    this.particles.update(dt);

    if (this.time >= this.song.duration) this._finish();
  }

  _consumeInput() {
    for (const ev of this.input.drain()) {
      // `age` rewinds to the instant the key physically went down.
      const at = this.time - ev.age;
      if (ev.swipe !== undefined) this._swipe(ev.channel, ev.swipe);
      else if (ev.down) this._press(ev, at);
      else this._release(ev.channel);
    }
  }

  _readHeld() {
    for (let i = 0; i < CHANNELS; i++) {
      this.channelHeld[i] = this.autoplay ? this._autoChannel(i) : this.input.held[i];
    }
    // A lane lights up for either of the two keys that target it.
    for (let i = 0; i < LANE_COUNT; i++) {
      this.laneHeld[i] = this.channelHeld[i] || this.channelHeld[LANE_COUNT + i];
    }
  }

  _autoplay() {
    const notes = this.song.notes;
    for (let i = this.checkFrom; i < notes.length; i++) {
      const n = notes[i];
      if (n.t > this.time) break;
      if (n.headJudged || n.gone) continue;
      n.headJudged = true;
      if (n.isHold) {
        n.holdActive = true;
        n.heldBy = n.lane;
        n.nextSpark = this.time;
      } else {
        n.gone = true;
      }
      this._register('PERFECT', 0);
      this._hitEffects(n, 'PERFECT');
    }
  }

  _autoChannel(channel) {
    const notes = this.song.notes;
    for (let i = this.checkFrom; i < notes.length; i++) {
      const n = notes[i];
      if (n.t > this.time) break;
      if (n.holdActive && n.heldBy === channel) return true;
    }
    return false;
  }

  _updateHolds(dt) {
    const notes = this.song.notes;
    for (let i = this.checkFrom; i < notes.length; i++) {
      const n = notes[i];
      if (n.t > this.time + 0.1) break;
      if (!n.holdActive) continue;

      if (this.time >= n.holdEnd) {
        this._completeHold(n);
        continue;
      }
      const stillHeld = this.autoplay || this.input.held[n.heldBy];
      if (!stillHeld) continue; // the release event does the judging

      if (this.time >= n.nextSpark) {
        n.nextSpark = this.time + 0.03;
        this.particles.holdSpark(this._laneX(n.lane), this.renderer.pf.receptorY, this.renderer.noteRgb.hold);
      }
    }
  }

  _sweepMisses() {
    const notes = this.song.notes;
    const cutoff = this.time - MISS_AFTER;
    for (let i = this.checkFrom; i < notes.length; i++) {
      const n = notes[i];
      if (n.t > cutoff) break;
      if (n.headJudged || n.gone) continue;
      n.headJudged = true;
      n.gone = true;
      n.holdBroken = n.isHold;
      this._register('MISS', 0);
      // A hold that is never started loses its tail as well.
      if (n.isHold) {
        n.tailJudged = true;
        this._register('MISS', 0, false);
      }
      this.particles.missDust(this._laneX(n.lane), this.renderer.pf.receptorY);
    }
  }

  /** Advance the pointer past notes that are fully resolved. */
  _advanceWindow() {
    const notes = this.song.notes;
    while (this.checkFrom < notes.length) {
      const n = notes[this.checkFrom];
      const done = n.gone && (!n.isHold || n.tailJudged);
      if (!done) break;
      this.checkFrom++;
    }
    this.renderFrom = this.checkFrom;
  }

  _finish() {
    this.finished = true;
    this.input.enabled = false;
    const acc = this.judgedUnits === 0 ? 0 : (this.accSum / this.units) * 100;
    const grade = GRADES.find(([min]) => acc >= min)[1];
    const fullCombo = this.counts.MISS === 0;
    this.onFinish({
      songId: this.song.id,
      difficulty: this.song.difficulty,
      score: Math.round(this.score),
      accuracy: acc,
      maxCombo: this.maxCombo,
      counts: { ...this.counts },
      grade,
      fullCombo,
      allPerfect: fullCombo && this.counts.GREAT === 0 && this.counts.GOOD === 0,
      units: this.units,
      autoplay: this.autoplay,
    });
  }
}
