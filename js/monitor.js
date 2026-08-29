// Performance and timing monitor.
//
// A rhythm game can be wrong in ways a screenshot cannot show: a frame budget
// that blows once a second, an audio clock that has drifted, a player who is
// consistently 20 ms early. This watches all three and says so plainly.
//
// It is a DOM overlay rather than canvas drawing, so reading it costs the frame
// loop nothing but a handful of numbers, and it is only updated a few times a
// second — a monitor that itself causes stutter is worse than none.

import { clamp } from './util.js';

const REFRESH_MS = 200;
const WINDOW = 240; // frames kept for the frame-time percentiles
/** A frame slower than this on a 60 Hz display has dropped at least one. */
const LONG_FRAME_MS = 20;

export class Monitor {
  constructor(el) {
    this.el = el;
    this.enabled = false;
    this.frames = new Float32Array(WINDOW);
    this.frameAt = 0;
    this.frameCount = 0;
    this.longFrames = 0;
    this.lastPaint = 0;
    this.rows = new Map();
  }

  setEnabled(on) {
    this.enabled = on;
    this.el.hidden = !on;
    if (!on) return;
    this.longFrames = 0;
    this.frameCount = 0;
  }

  toggle() {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  /** Called every frame, whether or not the overlay is showing. */
  frame(dtMs) {
    this.frames[this.frameAt] = dtMs;
    this.frameAt = (this.frameAt + 1) % WINDOW;
    this.frameCount++;
    if (dtMs > LONG_FRAME_MS) this.longFrames++;
  }

  _percentiles() {
    const n = Math.min(this.frameCount, WINDOW);
    if (!n) return { avg: 0, p95: 0 };
    const sorted = Array.from(this.frames.slice(0, n)).sort((a, b) => a - b);
    const avg = sorted.reduce((a, b) => a + b, 0) / n;
    return { avg, p95: sorted[Math.floor(n * 0.95)] };
  }

  /**
   * Refresh the readout. `game` may be idle, in which case only the frame
   * statistics are meaningful and the rest are left blank.
   */
  update(now, { game, audio, renderer }) {
    if (!this.enabled || now - this.lastPaint < REFRESH_MS) return;
    this.lastPaint = now;

    const { avg, p95 } = this._percentiles();
    this._row('fps', 'fps', `${(1000 / Math.max(avg, 0.001)).toFixed(0)}`);
    this._row('frame', 'frame', `${avg.toFixed(1)} / ${p95.toFixed(1)} ms`);
    this._row('long', 'long frames', String(this.longFrames));

    const playing = game && game.started && !game.paused;
    if (audio && audio.ctx) {
      const latency = (audio.ctx.outputLatency || audio.ctx.baseLatency || 0) * 1000;
      this._row('latency', 'output latency', `${latency.toFixed(1)} ms`);
      if (playing) {
        // The transport runs a smoothed clock alongside the audio clock; a
        // drift that stops shrinking means the two have come apart.
        const drift = (audio.rawTime() - audio.smoothTime) * 1000;
        this._row('drift', 'clock drift', `${drift >= 0 ? '+' : ''}${drift.toFixed(1)} ms`);
      }
    }

    if (playing) {
      const hits = game.deltas;
      if (hits.length >= 8) {
        const mean = hits.reduce((a, b) => a + b, 0) / hits.length;
        const sd = Math.sqrt(
          hits.reduce((a, b) => a + (b - mean) ** 2, 0) / hits.length
        );
        const ms = mean * 1000;
        this._row('hit', 'hit offset', `${ms >= 0 ? '+' : ''}${ms.toFixed(1)} ± ${(sd * 1000).toFixed(1)} ms`);
        // A consistent bias is the player's calibration, not their timing, so
        // say what to set rather than leaving them to work it out.
        const suggest = Math.round(clamp(game.settings.offsetMs - ms, -150, 150));
        this._row(
          'suggest',
          'suggested offset',
          Math.abs(ms) < 8 ? 'calibrated' : `${suggest > 0 ? '+' : ''}${suggest} ms`
        );
      }
      this._row('notes', 'notes left', String(game.song.notes.length - game.checkFrom));
      this._row('parts', 'particles', String(game.particles.live));
      this._row('armed', 'flicks in air', String(game.armed.length));
    }

    if (renderer) this._row('dpr', 'canvas', `${renderer.w}×${renderer.h} @${renderer.dpr}x`);
  }

  _row(id, label, value) {
    let row = this.rows.get(id);
    if (!row) {
      row = document.createElement('div');
      const k = document.createElement('span');
      k.textContent = label;
      const v = document.createElement('b');
      row.append(k, v);
      this.el.append(row);
      this.rows.set(id, row);
    }
    const b = row.lastChild;
    if (b.textContent !== value) b.textContent = value;
  }
}
