// Gameplay: judgement, scoring and the frame loop.

import { Particles } from './particles.js';
import { LANE_COUNT } from './input.js';

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

    this.reset();
  }

  reset() {
    for (const n of this.song.notes) {
      n.headJudged = false;
      n.tailJudged = false;
      n.holdActive = false;
      n.holdBroken = false;
      n.gone = false;
      n.holdEnd = n.t + n.dur;
      n.nextSpark = 0;
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
    this.bassEnergy = 0;

    this.started = false;
    this.paused = false;
    this.finished = false;
    this.countdown = 0;
    this.autoplay = this.settings.autoplay;

    this.particles.clear();
    this.laneHeld.fill(false);
  }

  get travelTime() {
    return 1.6 / this.settings.speed;
  }

  get accuracy() {
    return this.judgedUnits === 0 ? 100 : (this.accSum / this.judgedUnits) * 100;
  }

  // ------------------------------------------------------------ lifecycle --

  async start() {
    this.reset();
    this.input.enabled = true;
    this.input.drain();
    await this.audio.start(this.song, 1.2);
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

  _register(label, delta, lane, showFx = true) {
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

    this.score =
      (ACC_SCORE * this.accSum) / this.units +
      (COMBO_SCORE * this.comboSum) / this.comboMax;

    if (showFx) this.renderer.showJudge(label, delta, this.time);
  }

  _receptorY() {
    return this.renderer.pf.receptorY;
  }

  _laneX(lane) {
    const pf = this.renderer.pf;
    return pf.left + lane * pf.laneW + pf.laneW / 2;
  }

  _hitEffects(lane, label) {
    const x = this._laneX(lane);
    const y = this._receptorY();
    const strength = label === 'PERFECT' ? 1 : label === 'GREAT' ? 0.72 : 0.45;
    this.particles.burst(x, y, lane, strength, this.settings.effects);
    this.particles.ring(x, y, lane, this.renderer.pf.laneW * 0.95, strength);
    this.particles.bloom(x, y, lane, this.renderer.pf.laneW * 0.8);
    this.renderer.hitLane(lane, strength);
    if (!this.autoplay) this.audio.hitSound(lane);
  }

  /** Find the best candidate note in `lane` for a press at `hitTime`. */
  _findCandidate(lane, hitTime) {
    const notes = this.song.notes;
    let best = null;
    let bestDelta = Infinity;
    for (let i = this.checkFrom; i < notes.length; i++) {
      const n = notes[i];
      if (n.t > hitTime + WINDOWS.GOOD) break;
      if (n.lane !== lane || n.headJudged || n.gone) continue;
      const d = Math.abs(hitTime - n.t);
      if (d <= WINDOWS.GOOD && d < bestDelta) {
        bestDelta = d;
        best = n;
      }
    }
    return best;
  }

  _press(lane, hitTime) {
    const note = this._findCandidate(lane, hitTime);
    if (!note) return;

    const delta = hitTime - note.t;
    const label = this._label(Math.abs(delta));
    note.headJudged = true;

    if (note.isHold) {
      note.holdActive = true;
      note.nextSpark = this.time;
    } else {
      note.gone = true;
    }

    this._register(label, delta, lane);
    this._hitEffects(lane, label);
  }

  _release(lane) {
    const notes = this.song.notes;
    for (let i = this.checkFrom; i < notes.length; i++) {
      const n = notes[i];
      if (n.t > this.time) break;
      if (!n.holdActive || n.lane !== lane) continue;
      if (this.time >= n.holdEnd - HOLD_LENIENCY) {
        this._completeHold(n);
      } else {
        n.holdActive = false;
        n.holdBroken = true;
        n.tailJudged = true;
        n.gone = true;
        this._register('MISS', 0, lane);
        this.particles.missDust(this._laneX(lane), this._receptorY());
      }
      return;
    }
  }

  _completeHold(n) {
    n.holdActive = false;
    n.tailJudged = true;
    n.gone = true;
    this._register('PERFECT', 0, n.lane);
    this._hitEffects(n.lane, 'PERFECT');
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
      // Input is swallowed until the countdown clears so a key held from
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
    this._sweepMisses();
    this._advanceWindow();

    for (let i = 0; i < LANE_COUNT; i++) {
      this.laneHeld[i] = this.autoplay ? this._autoLane(i) : this.input.held[i];
    }

    this.particles.update(dt);

    if (this.time >= this.song.duration) this._finish();
  }

  _consumeInput() {
    for (const ev of this.input.drain()) {
      // `age` rewinds to the instant the key physically went down.
      const at = this.time - ev.age;
      if (ev.down) this._press(ev.lane, at);
      else this._release(ev.lane);
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
        n.nextSpark = this.time;
      } else {
        n.gone = true;
      }
      this._register('PERFECT', 0, n.lane);
      this._hitEffects(n.lane, 'PERFECT');
    }
  }

  _autoLane(lane) {
    const notes = this.song.notes;
    for (let i = this.checkFrom; i < notes.length; i++) {
      const n = notes[i];
      if (n.t > this.time) break;
      if (n.holdActive && n.lane === lane) return true;
    }
    return false;
  }

  _updateHolds(dt) {
    const notes = this.song.notes;
    for (let i = this.checkFrom; i < notes.length; i++) {
      const n = notes[i];
      if (n.t > this.time + 0.1) break;
      if (!n.holdActive) continue;

      const stillHeld = this.autoplay || this.input.held[n.lane];
      if (this.time >= n.holdEnd) {
        this._completeHold(n);
        continue;
      }
      if (!stillHeld) continue; // release is handled by the input event

      if (this.time >= n.nextSpark) {
        n.nextSpark = this.time + 0.03;
        this.particles.holdSpark(this._laneX(n.lane), this._receptorY(), n.lane);
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
      this._register('MISS', 0, n.lane);
      // A hold that is never started loses its tail as well.
      if (n.isHold) {
        n.tailJudged = true;
        this._register('MISS', 0, n.lane, false);
      }
      this.particles.missDust(this._laneX(n.lane), this._receptorY());
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

export const gradeColor = (grade) =>
  ({
    SSS: '#ffe27a', SS: '#ffd166', S: '#7ce7ff',
    A: '#8eeba0', B: '#a8b6ff', C: '#c9a7ff', D: '#ff8fa3',
  }[grade] || '#ffffff');
