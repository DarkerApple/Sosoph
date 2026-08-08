// Canvas renderer.
//
// Two rules keep this smooth:
//   1. Every position is a pure function of the audio clock, so motion is
//      correct at any refresh rate without interpolation hacks.
//   2. Everything that reacts (lane glow, score counter, combo pop) is
//      exponentially damped with `damp`, which is framerate independent.
// Glow-heavy note graphics are pre-rendered to sprites once per resize instead
// of paying for `shadowBlur` on every note, every frame.

import {
  clamp, lerp, damp, easeOutCubic, easeOutQuint, easeOutBack, easeOutExpo,
  mulberry32, roundRect, fmtScore, fmtTime,
} from './util.js';
import { intensityAt } from './song.js';

export const LANE_COLORS = [
  [56, 232, 255],
  [124, 160, 255],
  [186, 134, 255],
  [255, 118, 214],
];

export const JUDGE_COLORS = {
  PERFECT: [255, 226, 122],
  GREAT: [124, 231, 255],
  GOOD: [142, 235, 160],
  MISS: [255, 107, 129],
};

const NOTE_H = 26;
const HOLD_CAP = 20;
const SPRITE_PAD = 22;
const KEY_LABELS = ['D', 'F', 'J', 'K'];

const FONT = `system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif`;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.dpr = 1;
    this.w = 0;
    this.h = 0;

    // Damped visual state, owned entirely by the renderer.
    this.laneGlow = [0, 0, 0, 0];
    this.laneHit = [0, 0, 0, 0];
    this.displayScore = 0;
    this.displayAcc = 100;
    this.comboScale = 1;
    this.comboShown = 0;
    this.beatPulse = 0;
    this.energy = 0;
    this.flash = 0;
    this.lastSection = null;

    this.judgeFx = { label: '', color: JUDGE_COLORS.PERFECT, time: -10, delta: 0, show: false };

    const rnd = mulberry32(20260808);
    this.stars = Array.from({ length: 140 }, () => ({
      x: rnd(), y: rnd(),
      z: 0.25 + rnd() * 1,
      s: 0.5 + rnd() * 1.7,
      tw: rnd() * Math.PI * 2,
    }));

    this.noteSprites = [];
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.dpr = dpr;
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const pfW = clamp(Math.min(w * 0.88, h * 0.62), 280, 620);
    this.pf = {
      width: pfW,
      left: (w - pfW) / 2,
      laneW: pfW / 4,
      receptorY: h - clamp(h * 0.155, 92, 180),
      spawnY: -70,
    };
    this.pf.travel = this.pf.receptorY - this.pf.spawnY;
    this.noteW = this.pf.laneW * 0.84;
    // Compact HUD on narrow screens so the score can never clip.
    this.ui = w < 560 ? 0.78 : w < 760 ? 0.9 : 1;
    this.hudPad = clamp(w * 0.022, 14, 26);

    this._buildSprites();
  }

  /** Layout the input manager needs to map touches to lanes. */
  get layout() {
    return { left: this.pf.left, width: this.pf.width, laneW: this.pf.laneW };
  }

  _buildSprites() {
    this.noteSprites = LANE_COLORS.map((c) => this._noteSprite(c));
    this.padSprites = LANE_COLORS.map((c) => this._padSprite(c));
  }

  _noteSprite(col) {
    const w = this.noteW;
    const h = NOTE_H;
    const pad = SPRITE_PAD;
    const c = document.createElement('canvas');
    c.width = Math.ceil((w + pad * 2) * this.dpr);
    c.height = Math.ceil((h + pad * 2) * this.dpr);
    const g = c.getContext('2d');
    g.scale(this.dpr, this.dpr);

    const rgb = `${col[0]},${col[1]},${col[2]}`;

    // Outer halo, baked once so the game loop never touches shadowBlur.
    g.shadowColor = `rgba(${rgb},0.95)`;
    g.shadowBlur = 18;
    g.fillStyle = `rgba(${rgb},0.9)`;
    roundRect(g, pad, pad, w, h, h / 2);
    g.fill();
    g.fill();
    g.shadowBlur = 0;

    // Body: bright top edge falling into saturated colour.
    const grad = g.createLinearGradient(0, pad, 0, pad + h);
    grad.addColorStop(0, `rgba(255,255,255,0.98)`);
    grad.addColorStop(0.22, `rgba(${rgb},1)`);
    grad.addColorStop(0.72, `rgba(${Math.round(col[0] * 0.62)},${Math.round(col[1] * 0.62)},${Math.round(col[2] * 0.72)},1)`);
    grad.addColorStop(1, `rgba(${rgb},0.95)`);
    g.fillStyle = grad;
    roundRect(g, pad, pad, w, h, h / 2);
    g.fill();

    // Specular sliver along the top.
    g.fillStyle = 'rgba(255,255,255,0.55)';
    roundRect(g, pad + w * 0.12, pad + 3, w * 0.76, 3.5, 2);
    g.fill();

    return { canvas: c, w: w + pad * 2, h: h + pad * 2, pad };
  }

  _padSprite(col) {
    const w = this.pf.laneW * 0.86;
    const h = 20;
    const pad = 16;
    const rgb = `${col[0]},${col[1]},${col[2]}`;
    const c = document.createElement('canvas');
    c.width = Math.ceil((w + pad * 2) * this.dpr);
    c.height = Math.ceil((h + pad * 2) * this.dpr);
    const g = c.getContext('2d');
    g.scale(this.dpr, this.dpr);

    // Recessed well: dark inside, lit rim. Reads as a physical target the
    // note drops into rather than a floating outline.
    const fill = g.createLinearGradient(0, pad, 0, pad + h);
    fill.addColorStop(0, `rgba(${rgb},0.03)`);
    fill.addColorStop(1, `rgba(${rgb},0.2)`);
    g.fillStyle = fill;
    roundRect(g, pad, pad, w, h, h / 2);
    g.fill();

    g.strokeStyle = `rgba(${rgb},0.6)`;
    g.lineWidth = 1.6;
    roundRect(g, pad, pad, w, h, h / 2);
    g.stroke();

    g.strokeStyle = 'rgba(255,255,255,0.3)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(pad + h * 0.6, pad + 0.6);
    g.lineTo(pad + w - h * 0.6, pad + 0.6);
    g.stroke();

    return { canvas: c, w: w + pad * 2, h: h + pad * 2, pad };
  }

  /** Vertical position of a note at song time `t`. */
  yFor(noteTime, t, travelTime) {
    const p = (noteTime - t) / travelTime; // 1 = spawn, 0 = receptor
    return this.pf.receptorY - p * this.pf.travel;
  }

  // ------------------------------------------------------------- effects ---

  showJudge(label, delta, time) {
    this.judgeFx = {
      label,
      color: JUDGE_COLORS[label] || JUDGE_COLORS.GOOD,
      time,
      delta,
      show: true,
    };
  }

  hitLane(lane, strength = 1) {
    this.laneHit[lane] = Math.max(this.laneHit[lane], strength);
  }

  // -------------------------------------------------------------- frame ----

  draw(g, dt) {
    const ctx = this.ctx;
    const { w, h } = this;
    const t = g.time;

    // --- damped reactive state -------------------------------------------
    for (let i = 0; i < 4; i++) {
      const target = g.laneHeld[i] ? 1 : 0;
      this.laneGlow[i] = damp(this.laneGlow[i], target, 22, dt);
      this.laneHit[i] = damp(this.laneHit[i], 0, 7, dt);
    }
    this.displayScore = damp(this.displayScore, g.score, 9, dt);
    this.displayAcc = damp(this.displayAcc, g.accuracy, 8, dt);
    this.energy = damp(this.energy, g.bassEnergy, 12, dt);
    this.flash = damp(this.flash, 0, 4, dt);

    if (g.combo !== this.comboShown) {
      if (g.combo > this.comboShown) this.comboScale = 1.28;
      this.comboShown = g.combo;
    }
    this.comboScale = damp(this.comboScale, 1, 14, dt);

    const intensity = g.started ? intensityAt(g.song, t) : 0.25;
    const beatPos = t / g.song.spb;
    const beatFrac = beatPos - Math.floor(beatPos);
    this.beatPulse = g.started && t > 0 ? Math.pow(1 - beatFrac, 3) : 0;

    const section = g.started ? g.song.sections.find((s) => t >= s.start && t < s.end) : null;
    if (section && section !== this.lastSection) {
      if (this.lastSection && section.intensity > this.lastSection.intensity + 0.25) {
        this.flash = 0.5;
      }
      this.lastSection = section;
    }

    this._drawBackground(ctx, t, intensity, dt);
    this._drawPlayfield(ctx, g, t, intensity);
    this._drawBeatLines(ctx, g, t);
    // The combo sits behind the notes so an incoming note is never obscured
    // by a five-digit number.
    this._drawCombo(ctx, g);
    this._drawNotes(ctx, g, t);
    this._drawReceptors(ctx, g);
    g.particles.draw(ctx, LANE_COLORS);
    this._drawJudgement(ctx, g, t);
    this._drawHud(ctx, g, t);

    if (this.flash > 0.002) {
      ctx.fillStyle = `rgba(255,255,255,${this.flash * 0.16})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  /**
   * Attract-mode background shown behind the menus. Deliberately just the
   * ambient layer — drawing the playfield here would put hard edges right
   * behind the title panel.
   */
  drawIdle(t, dt) {
    this.energy = damp(this.energy, 0.3 + 0.2 * Math.sin(t * 0.9), 3, dt);
    this._drawBackground(this.ctx, t * 0.5, 0.5, dt);
  }

  _drawBackground(ctx, t, intensity, dt) {
    const { w, h } = this;

    const base = ctx.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, '#080a18');
    base.addColorStop(0.55, '#0b0d20');
    base.addColorStop(1, '#05060f');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);

    // Slow aurora blobs. Motion is driven by the song clock so the background
    // breathes with the music rather than with wall time.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const pulse = 0.55 + 0.45 * this.energy;
    for (let i = 0; i < 4; i++) {
      const col = LANE_COLORS[i];
      const ph = t * 0.11 + i * 1.7;
      const x = w * (0.5 + Math.cos(ph * 0.7 + i) * 0.38);
      const y = h * (0.36 + Math.sin(ph * 0.53 + i * 1.7) * 0.26);
      const r = Math.max(w, h) * (0.34 + 0.07 * Math.sin(ph));
      const a = (0.1 + 0.16 * intensity) * pulse;
      const grd = ctx.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${a})`);
      grd.addColorStop(0.55, `rgba(${col[0]},${col[1]},${col[2]},${a * 0.28})`);
      grd.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, w, h);
    }

    // A wide column of light behind the playfield. This is what stops the
    // lanes from looking like they are floating on an empty page.
    const { left, width, receptorY } = this.pf;
    const halo = ctx.createLinearGradient(left - width * 0.35, 0, left + width * 1.35, 0);
    halo.addColorStop(0, 'rgba(80,120,255,0)');
    halo.addColorStop(0.5, `rgba(110,150,255,${0.06 + 0.09 * intensity * pulse})`);
    halo.addColorStop(1, 'rgba(80,120,255,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(left - width * 0.35, 0, width * 1.7, receptorY + 60);

    // Drifting starfield with a gentle parallax.
    for (const s of this.stars) {
      s.y += dt * (0.006 + 0.02 * s.z) * (0.4 + intensity);
      if (s.y > 1.02) {
        s.y -= 1.06;
        s.x = Math.random();
      }
      const tw = 0.45 + 0.55 * Math.abs(Math.sin(s.tw + t * 1.4 * s.z));
      const a = tw * (0.18 + 0.34 * s.z);
      ctx.fillStyle = `rgba(200,225,255,${a})`;
      ctx.beginPath();
      ctx.arc(s.x * w, s.y * h, s.s * (0.7 + 0.3 * this.energy), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Vignette keeps attention on the playfield.
    const vg = ctx.createRadialGradient(w / 2, this.pf.receptorY * 0.75, h * 0.18, w / 2, h * 0.5, Math.max(w, h) * 0.78);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.62)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
  }

  _drawPlayfield(ctx, g, t, intensity) {
    const { left, width, laneW, receptorY } = this.pf;
    const { h } = this;

    // Breathing: a sub-1% scale pulse on the beat. Barely visible on its own,
    // but it is what makes the field feel alive rather than static.
    const breathe = 1 + this.beatPulse * 0.006 * intensity;
    ctx.save();
    ctx.translate(left + width / 2, receptorY);
    ctx.scale(breathe, 1);
    ctx.translate(-(left + width / 2), -receptorY);

    // Panel: darkened so the notes read as lit objects against it.
    const panel = ctx.createLinearGradient(0, 0, 0, receptorY);
    panel.addColorStop(0, 'rgba(6,9,26,0.0)');
    panel.addColorStop(0.18, 'rgba(6,9,26,0.55)');
    panel.addColorStop(1, 'rgba(9,12,34,0.8)');
    ctx.fillStyle = panel;
    ctx.fillRect(left, 0, width, receptorY + 4);

    // Lane separators.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 1; i < 4; i++) {
      const x = left + i * laneW;
      const grd = ctx.createLinearGradient(0, 0, 0, receptorY);
      grd.addColorStop(0, 'rgba(150,180,255,0)');
      grd.addColorStop(0.45, 'rgba(150,180,255,0.1)');
      grd.addColorStop(1, 'rgba(160,190,255,0.3)');
      ctx.fillStyle = grd;
      ctx.fillRect(x - 0.5, 0, 1, receptorY);
    }

    // Outer rails, brighter and tinted by the edge lane colours.
    for (const [x, col] of [[left, LANE_COLORS[0]], [left + width, LANE_COLORS[3]]]) {
      const grd = ctx.createLinearGradient(0, 0, 0, receptorY);
      grd.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},0)`);
      grd.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},${0.4 + 0.25 * intensity})`);
      ctx.fillStyle = grd;
      ctx.fillRect(x - 1, 0, 2, receptorY);
    }

    // Per-lane beams for held keys and recent hits.
    for (let i = 0; i < 4; i++) {
      const amount = Math.max(this.laneGlow[i] * 0.55, this.laneHit[i]);
      if (amount < 0.01) continue;
      const col = LANE_COLORS[i];
      const x = left + i * laneW;
      const top = receptorY - this.pf.travel * 0.55;
      const grd = ctx.createLinearGradient(0, top, 0, receptorY);
      grd.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},0)`);
      grd.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},${0.3 * amount})`);
      ctx.fillStyle = grd;
      ctx.fillRect(x, top, laneW, receptorY - top);
    }
    ctx.restore();
    ctx.restore();
  }

  _drawBeatLines(ctx, g, t) {
    if (!g.started) return;
    const { left, width, receptorY } = this.pf;
    const spb = g.song.spb;
    const travel = g.travelTime;
    const firstBar = Math.floor(t / (spb * 4)) ;
    ctx.save();
    for (let b = firstBar; b < firstBar + Math.ceil(travel / (spb * 4)) + 2; b++) {
      const time = b * spb * 4;
      const y = this.yFor(time, t, travel);
      if (y < -10 || y > receptorY + 2) continue;
      const fade = clamp(y / (receptorY * 0.4), 0, 1);
      ctx.fillStyle = `rgba(160,190,255,${0.12 * fade})`;
      ctx.fillRect(left, y, width, 1);
    }
    ctx.restore();
  }

  _drawNotes(ctx, g, t) {
    const { left, laneW, receptorY } = this.pf;
    const travel = g.travelTime;
    const notes = g.song.notes;

    // Notes are sorted by time, so `y` decreases as the index grows: once a
    // note is above the spawn line every later note is too, and we can stop.
    ctx.save();
    for (let i = g.renderFrom; i < notes.length; i++) {
      const n = notes[i];
      const yHead = this.yFor(n.t, t, travel);
      if (yHead < -260) break;
      if (!n.isHold || n.gone) continue;
      const yTail = this.yFor(n.t + n.dur, t, travel);
      if (yTail > receptorY + 40) continue;
      this._drawHoldBody(ctx, g, n, yHead, yTail, t);
    }
    ctx.restore();

    for (let i = g.renderFrom; i < notes.length; i++) {
      const n = notes[i];
      const y = this.yFor(n.t, t, travel);
      if (y < -160) break;
      if (n.gone || n.headJudged) continue;
      if (y > this.h + 100) continue;

      const sprite = this.noteSprites[n.lane];
      const cx = left + n.lane * laneW + laneW / 2;

      // Fade and scale in near the spawn line to fake depth.
      const p = clamp((n.t - t) / travel, 0, 1);
      const appear = clamp((1 - p) / 0.14, 0, 1);
      const scale = lerp(0.86, 1, easeOutCubic(appear));
      const alpha = easeOutCubic(appear);

      ctx.globalAlpha = alpha;
      const dw = sprite.w * scale;
      const dh = sprite.h * scale;
      ctx.drawImage(sprite.canvas, cx - dw / 2, y - dh / 2, dw, dh);
      ctx.globalAlpha = 1;
    }
  }

  _drawHoldBody(ctx, g, n, yHead, yTail, t) {
    const { left, laneW, receptorY } = this.pf;
    const col = LANE_COLORS[n.lane];
    const cx = left + n.lane * laneW + laneW / 2;
    const bw = this.noteW * 0.62;

    // Once the head is struck the body stays pinned at the receptor and
    // visibly drains away, which reads instantly as "keep holding".
    const top = n.holdActive ? Math.min(yTail, receptorY) : yTail;
    const bottom = n.holdActive ? receptorY : Math.min(yHead, receptorY + 200);
    if (bottom - top < 1) return;

    const dead = n.holdBroken;
    const rgb = dead ? '110,118,140' : `${col[0]},${col[1]},${col[2]}`;
    const base = dead ? 0.22 : n.holdActive ? 0.85 : 0.55;

    ctx.save();
    roundRect(ctx, cx - bw / 2, top, bw, bottom - top, bw / 2);
    const grd = ctx.createLinearGradient(0, top, 0, bottom);
    grd.addColorStop(0, `rgba(${rgb},${base * 0.5})`);
    grd.addColorStop(1, `rgba(${rgb},${base})`);
    ctx.fillStyle = grd;
    ctx.fill();

    // Energy scrolling down the body while it is being held.
    if (n.holdActive && !dead) {
      ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      const period = 46;
      const off = (t * 190) % period;
      for (let y = top - period + off; y < bottom; y += period) {
        const gg = ctx.createLinearGradient(0, y, 0, y + period);
        gg.addColorStop(0, `rgba(255,255,255,0)`);
        gg.addColorStop(0.5, `rgba(255,255,255,0.22)`);
        gg.addColorStop(1, `rgba(255,255,255,0)`);
        ctx.fillStyle = gg;
        ctx.fillRect(cx - bw / 2, y, bw, period);
      }
    }
    ctx.restore();

    // Tail cap.
    if (yTail < receptorY + 30 && !dead) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(${rgb},0.85)`;
      roundRect(ctx, cx - bw / 2, yTail - HOLD_CAP / 2, bw, HOLD_CAP / 2, 4);
      ctx.fill();
      ctx.restore();
    }
  }

  _drawReceptors(ctx, g) {
    const { left, width, laneW, receptorY } = this.pf;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // Judgement line.
    const lineGrad = ctx.createLinearGradient(left, 0, left + width, 0);
    lineGrad.addColorStop(0, `rgba(${LANE_COLORS[0].join(',')},0.75)`);
    lineGrad.addColorStop(1, `rgba(${LANE_COLORS[3].join(',')},0.75)`);
    ctx.fillStyle = lineGrad;
    ctx.fillRect(left, receptorY - 1.5, width, 3);

    // Soft bed of light under the line.
    const bed = ctx.createLinearGradient(0, receptorY - 34, 0, receptorY + 26);
    bed.addColorStop(0, 'rgba(140,180,255,0)');
    bed.addColorStop(0.5, `rgba(160,190,255,${0.14 + 0.12 * this.energy})`);
    bed.addColorStop(1, 'rgba(140,180,255,0)');
    ctx.fillStyle = bed;
    ctx.fillRect(left, receptorY - 34, width, 60);

    for (let i = 0; i < 4; i++) {
      const col = LANE_COLORS[i];
      const cx = left + i * laneW + laneW / 2;
      const glow = Math.max(this.laneGlow[i], this.laneHit[i]);

      if (glow > 0.01) {
        const r = laneW * (0.6 + 0.35 * glow);
        const grd = ctx.createRadialGradient(cx, receptorY, 0, cx, receptorY, r);
        grd.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${0.5 * glow})`);
        grd.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.ellipse(cx, receptorY, r, r * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      const s = this.padSprites[i];
      const scale = 1 + glow * 0.12;
      ctx.globalAlpha = 0.75 + glow * 0.25;
      ctx.drawImage(
        s.canvas,
        cx - (s.w * scale) / 2,
        receptorY - (s.h * scale) / 2,
        s.w * scale,
        s.h * scale
      );
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // Key hints.
    ctx.save();
    ctx.font = `600 12px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < 4; i++) {
      const cx = left + i * laneW + laneW / 2;
      ctx.fillStyle = `rgba(255,255,255,${0.32 + 0.5 * this.laneGlow[i]})`;
      ctx.fillText(KEY_LABELS[i], cx, receptorY + 36);
    }
    ctx.restore();
  }

  _drawCombo(ctx, g) {
    if (g.combo <= 2) return;
    const { left, width, receptorY } = this.pf;
    const cx = left + width / 2;
    const y = receptorY - this.pf.travel * 0.42;

    ctx.save();
    ctx.translate(cx, y);
    ctx.scale(this.comboScale, this.comboScale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Warms from near-white toward gold as the combo climbs.
    const tier = clamp(g.combo / 220, 0, 1);
    const col = [
      Math.round(lerp(235, 255, tier)),
      Math.round(lerp(245, 214, tier)),
      Math.round(lerp(255, 140, tier)),
    ];
    const a = clamp((this.comboScale - 1) * 2.2, 0, 1);

    ctx.font = `800 ${(62 * this.ui).toFixed(1)}px ${FONT}`;
    if (a > 0.01) {
      ctx.shadowColor = `rgba(${col[0]},${col[1]},${col[2]},${a})`;
      ctx.shadowBlur = 26 * a;
    }
    ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},0.88)`;
    ctx.fillText(String(g.combo), 0, 0);
    ctx.shadowBlur = 0;

    ctx.font = `600 ${(13 * this.ui).toFixed(1)}px ${FONT}`;
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '4px';
    ctx.fillStyle = 'rgba(210,225,255,0.45)';
    ctx.fillText('COMBO', 0, 36 * this.ui);
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '0px';
    ctx.restore();
  }

  _drawJudgement(ctx, g, t) {
    const { left, width, receptorY } = this.pf;
    const cx = left + width / 2;

    // Judgement text: a spring pop that settles, then fades and lifts.
    const fx = this.judgeFx;
    if (!fx.show) return;
    const age = t - fx.time;
    const LIFE = 0.62;
    if (age < 0 || age > LIFE) {
      if (age > LIFE) fx.show = false;
      return;
    }
    const p = age / LIFE;
    const pop = age < 0.24 ? easeOutBack(clamp(age / 0.24, 0, 1), 2.4) : 1;
    const scale = lerp(0.7, 1, pop);
    const alpha = p < 0.6 ? 1 : 1 - easeOutCubic((p - 0.6) / 0.4);
    const rise = easeOutQuint(p) * 16;

    ctx.save();
    ctx.translate(cx, receptorY - this.pf.travel * 0.22 - rise);
    ctx.scale(scale, scale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const c = fx.color;
    ctx.shadowColor = `rgba(${c[0]},${c[1]},${c[2]},${0.8 * alpha})`;
    ctx.shadowBlur = 22;
    ctx.font = `800 ${(34 * this.ui).toFixed(1)}px ${FONT}`;
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '2px';
    ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
    ctx.fillText(fx.label, 0, 0);
    ctx.shadowBlur = 0;
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '0px';

    // Early/late hint helps players self-correct without being noisy.
    if (fx.label !== 'MISS' && fx.label !== 'PERFECT' && Math.abs(fx.delta) > 0.001) {
      ctx.font = `600 12px ${FONT}`;
      ctx.fillStyle = `rgba(200,215,245,${alpha * 0.65})`;
      ctx.fillText(fx.delta > 0 ? 'LATE' : 'EARLY', 0, 24);
    }
    ctx.restore();
  }

  _drawHud(ctx, g, t) {
    const { w, ui } = this;
    const pad = this.hudPad;
    const px = (n) => `${(n * ui).toFixed(1)}px`;

    // Progress rail across the very top.
    const prog = clamp(t / g.song.duration, 0, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(0, 0, w, 3);
    const pg = ctx.createLinearGradient(0, 0, w, 0);
    pg.addColorStop(0, `rgba(${LANE_COLORS[0].join(',')},0.9)`);
    pg.addColorStop(1, `rgba(${LANE_COLORS[3].join(',')},0.9)`);
    ctx.fillStyle = pg;
    ctx.fillRect(0, 0, w * prog, 3);

    ctx.save();
    ctx.textBaseline = 'top';

    // Song info, left.
    ctx.textAlign = 'left';
    ctx.font = `700 ${px(15)} ${FONT}`;
    ctx.fillStyle = 'rgba(236,244,255,0.9)';
    ctx.fillText(g.song.name, pad, pad);
    ctx.font = `500 ${px(12)} ${FONT}`;
    ctx.fillStyle = 'rgba(180,198,230,0.6)';
    ctx.fillText(
      `${g.song.difficulty}  ·  ${fmtTime(Math.max(0, t))} / ${fmtTime(g.song.duration)}`,
      pad,
      pad + 20 * ui
    );

    // Score and accuracy, right.
    ctx.textAlign = 'right';
    ctx.font = `700 ${px(30)} ${FONT}`;
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '1px';
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillText(fmtScore(this.displayScore), w - pad, pad - 4 * ui);
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '0px';

    ctx.font = `600 ${px(13)} ${FONT}`;
    ctx.fillStyle = 'rgba(180,198,230,0.75)';
    ctx.fillText(
      `${this.displayAcc.toFixed(2)}%   ·   ${g.maxCombo}x MAX`,
      w - pad,
      pad + 30 * ui
    );

    if (g.autoplay) {
      ctx.textAlign = 'center';
      ctx.font = `700 ${px(12)} ${FONT}`;
      ctx.fillStyle = `rgba(255,226,122,${0.45 + 0.35 * Math.sin(t * 4)})`;
      ctx.fillText('AUTOPLAY', w / 2, pad);
    }
    ctx.restore();

    if (g.countdown > 0) this._drawCountdown(ctx, g.countdown);
  }

  _drawCountdown(ctx, remaining) {
    const { w, h } = this;
    const n = Math.ceil(remaining);
    // 0 the instant a digit appears, 1 just before it is replaced.
    const age = clamp(1 - (remaining - Math.floor(remaining)), 0, 1);
    ctx.save();
    ctx.fillStyle = 'rgba(4,6,16,0.55)';
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const scale = lerp(1.6, 1, easeOutExpo(clamp(age * 2.4, 0, 1)));
    const alpha = clamp(age * 6, 0, 1) * clamp((1 - age) * 4, 0, 1);
    ctx.translate(w / 2, h / 2);
    ctx.scale(scale, scale);
    ctx.font = `800 96px ${FONT}`;
    ctx.shadowColor = `rgba(120,180,255,${0.8 * alpha})`;
    ctx.shadowBlur = 40;
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.fillText(n > 0 ? String(n) : 'GO', 0, 0);
    ctx.restore();
  }
}
