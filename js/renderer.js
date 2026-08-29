// Canvas renderer.
//
// Two rules keep this smooth:
//   1. Every position is a pure function of the audio clock, so motion is
//      correct at any refresh rate without interpolation hacks.
//   2. Everything that reacts — lane glow, score counter, combo pop — is
//      exponentially damped with `damp`, which is framerate independent.
// Glow-heavy note graphics are pre-rendered to sprites once per resize rather
// than paying for `shadowBlur` on every note, every frame.

import {
  clamp, lerp, damp, easeOutCubic, easeOutQuint, easeOutBack, easeOutExpo,
  mulberry32, roundRect, fmtScore, fmtTime, hexToRgb, rgba, shade,
} from './util.js';
import {
  LANE_COUNT, NOTE_COLORS, PLAIN, JUDGE_HEX, noteRgbTable, keyTable, keyLabel,
  difficultyMeta,
} from './theme.js';

const FONT = `system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif`;
const JUDGE_RGB = Object.fromEntries(
  Object.entries(JUDGE_HEX).map(([k, v]) => [k, hexToRgb(v)])
);

/** Dark playfield colours — the menus are light, the game is not. */
const BG_TOP = [12, 17, 34];
const BG_BOTTOM = [6, 9, 20];

export class Renderer {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.dpr = 1;
    this.w = 0;
    this.h = 0;

    // Damped visual state, owned entirely by the renderer.
    this.laneGlow = new Array(LANE_COUNT).fill(0);
    this.laneHit = new Array(LANE_COUNT).fill(0);
    this.laneTint = new Array(LANE_COUNT).fill(PLAIN);
    this.colorGlow = new Array(NOTE_COLORS.length).fill(0);
    this.displayScore = 0;
    this.displayAcc = 100;
    this.comboScale = 1;
    this.comboShown = 0;
    this.beatPulse = 0;
    this.energy = 0;
    this.flash = 0;
    this.lastSection = null;
    /** 0 in the menus, 1 in a song; cross-fades the whole scene. */
    this.dark = 0;

    this.judgeFx = { label: '', rgb: JUDGE_RGB.PERFECT, time: -10, delta: 0, show: false };

    this.accent = hexToRgb('#37d6ff');
    this.accentTarget = this.accent.slice();

    const rnd = mulberry32(20260808);
    this.motes = Array.from({ length: 54 }, () => ({
      x: rnd(), y: rnd(), z: 0.3 + rnd(), s: 1 + rnd() * 2.6, tw: rnd() * Math.PI * 2,
    }));

    this.refreshColors();
    this.resize();
  }

  /** Re-read note colours and key bindings after the settings change. */
  refreshColors() {
    this.noteRgb = noteRgbTable(this.settings);
    this.keys = keyTable(this.settings).map(keyLabel);
    if (this.w) this._buildSprites();
  }

  /** Tint the menu background with the highlighted song's colour. */
  setMood(hex) {
    this.accentTarget = hexToRgb(hex);
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

    const pfW = clamp(Math.min(w * 0.9, h * 0.64), 260, 580);
    // Two rows of key caps live below the judge line, so it sits higher than a
    // four-key game would normally put it.
    const foot = clamp(h * 0.17, 108, 186);
    this.pf = {
      width: pfW,
      left: (w - pfW) / 2,
      laneW: pfW / LANE_COUNT,
      receptorY: h - foot,
      spawnY: -60,
    };
    this.pf.travel = this.pf.receptorY - this.pf.spawnY;

    this.noteW = this.pf.laneW * 0.82;
    this.noteH = clamp(this.pf.laneW * 0.19, 16, 26);
    this.ui = w < 560 ? 0.8 : w < 780 ? 0.9 : 1;
    this.hudPad = clamp(w * 0.024, 14, 30);

    this._buildSprites();
  }

  /** Layout the input manager needs to map touches to lanes. */
  get layout() {
    return { left: this.pf.left, width: this.pf.width, laneW: this.pf.laneW };
  }

  // ------------------------------------------------------------- sprites ---

  _buildSprites() {
    this.noteSprites = this.noteRgb.map((c, i) => this._noteSprite(c, i !== PLAIN));
    this.padSprite = this._padSprite();
  }

  /**
   * A note is a wide rounded bar with a bright core and a white rim. Coloured
   * notes carry a chevron pointing at the row below, so they stay legible
   * without relying on hue alone.
   */
  _noteSprite(col, isColored) {
    const w = this.noteW;
    const h = this.noteH;
    const pad = 18;
    const c = document.createElement('canvas');
    c.width = Math.ceil((w + pad * 2) * this.dpr);
    c.height = Math.ceil((h + pad * 2) * this.dpr);
    const g = c.getContext('2d');
    g.scale(this.dpr, this.dpr);
    const r = h * 0.42;

    // Halo, baked once so the frame loop never touches shadowBlur.
    g.shadowColor = rgba(col, 0.85);
    g.shadowBlur = 14;
    g.fillStyle = rgba(col, 0.9);
    roundRect(g, pad, pad, w, h, r);
    g.fill();
    g.shadowBlur = 0;

    const grad = g.createLinearGradient(0, pad, 0, pad + h);
    grad.addColorStop(0, rgba(shade(col, 1.4), 1));
    grad.addColorStop(0.4, rgba(col, 1));
    grad.addColorStop(1, rgba(shade(col, 0.52), 1));
    g.fillStyle = grad;
    roundRect(g, pad, pad, w, h, r);
    g.fill();

    // White rim: the single most important readability cue on a dark field.
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = isColored ? 2.4 : 1.8;
    roundRect(g, pad + 0.9, pad + 0.9, w - 1.8, h - 1.8, r);
    g.stroke();

    // Specular sheen along the top edge — enough to read as glass, not so much
    // that it washes the colour out.
    const sheen = g.createLinearGradient(0, pad + h * 0.16, 0, pad + h * 0.5);
    sheen.addColorStop(0, 'rgba(255,255,255,0.6)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sheen;
    roundRect(g, pad + w * 0.07, pad + h * 0.16, w * 0.86, h * 0.34, h * 0.16);
    g.fill();

    if (isColored) {
      const cx = pad + w / 2;
      const cy = pad + h / 2;
      const k = h * 0.24;
      g.strokeStyle = 'rgba(255,255,255,0.95)';
      g.lineWidth = 2.2;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(cx - k, cy - k * 0.55);
      g.lineTo(cx, cy + k * 0.5);
      g.lineTo(cx + k, cy - k * 0.55);
      g.stroke();
    }

    return { canvas: c, w: w + pad * 2, h: h + pad * 2 };
  }

  _padSprite() {
    const w = this.pf.laneW * 0.86;
    const h = 12;
    const pad = 14;
    const c = document.createElement('canvas');
    c.width = Math.ceil((w + pad * 2) * this.dpr);
    c.height = Math.ceil((h + pad * 2) * this.dpr);
    const g = c.getContext('2d');
    g.scale(this.dpr, this.dpr);

    g.fillStyle = 'rgba(255,255,255,0.07)';
    roundRect(g, pad, pad, w, h, h / 2);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.24)';
    g.lineWidth = 1.2;
    roundRect(g, pad + 0.6, pad + 0.6, w - 1.2, h - 1.2, h / 2);
    g.stroke();

    return { canvas: c, w: w + pad * 2, h: h + pad * 2 };
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
      rgb: JUDGE_RGB[label] || JUDGE_RGB.GOOD,
      time,
      delta,
      show: true,
    };
  }

  hitLane(lane, strength = 1, tint = PLAIN) {
    this.laneHit[lane] = Math.max(this.laneHit[lane], strength);
    this.laneTint[lane] = tint;
  }

  // --------------------------------------------------------------- frame ---

  draw(g, dt) {
    const ctx = this.ctx;
    const t = g.time;

    this.dark = damp(this.dark, 1, 6, dt);

    for (let i = 0; i < LANE_COUNT; i++) {
      this.laneGlow[i] = damp(this.laneGlow[i], g.laneHeld[i] ? 1 : 0, 22, dt);
      this.laneHit[i] = damp(this.laneHit[i], 0, 7, dt);
    }
    for (let i = 0; i < NOTE_COLORS.length; i++) {
      this.colorGlow[i] = damp(this.colorGlow[i], g.channelHeld[LANE_COUNT + i] ? 1 : 0, 22, dt);
    }
    this.displayScore = damp(this.displayScore, g.score, 9, dt);
    this.displayAcc = damp(this.displayAcc, g.accuracy, 8, dt);
    this.energy = damp(this.energy, g.bassEnergy, 12, dt);
    this.flash = damp(this.flash, 0, 4, dt);

    if (g.combo !== this.comboShown) {
      if (g.combo > this.comboShown) this.comboScale = 1.22;
      this.comboShown = g.combo;
    }
    this.comboScale = damp(this.comboScale, 1, 14, dt);

    const section = g.song.sections.find((s) => t >= s.start && t < s.end);
    const intensity = section ? section.intensity : 0.25;
    if (section && section !== this.lastSection) {
      if (this.lastSection && section.intensity > this.lastSection.intensity + 0.25) this.flash = 0.45;
      this.lastSection = section;
    }

    const beat = t / g.song.spb;
    this.beatPulse = t > 0 ? Math.pow(1 - (beat - Math.floor(beat)), 3) : 0;

    this._drawScene(ctx, t, intensity, dt);
    this._drawPlayfield(ctx, intensity);
    this._drawBarLines(ctx, g, t);
    // The combo sits behind the notes so an incoming note is never obscured.
    this._drawCombo(ctx, g);
    this._drawHolds(ctx, g, t);
    this._drawNotes(ctx, g, t);
    this._drawReceptors(ctx);
    g.particles.draw(ctx, this.noteRgb);
    this._drawKeyCaps(ctx);
    this._drawJudgement(ctx, t);
    this._drawHud(ctx, g, t);

    if (this.flash > 0.002) {
      ctx.fillStyle = `rgba(255,255,255,${this.flash * 0.14})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
  }

  /**
   * Menu backdrop: a light pastel wash tinted by the highlighted song. The
   * menus themselves are DOM, so this only has to be calm and never fight the
   * cards sitting on top of it.
   */
  drawIdle(t, dt) {
    const ctx = this.ctx;
    const { w, h } = this;
    this.dark = damp(this.dark, 0, 6, dt);
    for (let i = 0; i < 3; i++) {
      this.accent[i] = damp(this.accent[i], this.accentTarget[i], 4, dt);
    }
    this.energy = damp(this.energy, 0.35 + 0.15 * Math.sin(t * 0.8), 2, dt);

    const base = ctx.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, '#f7fbff');
    base.addColorStop(0.55, '#eef4fb');
    base.addColorStop(1, '#e6eef8');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    const blobs = [
      [0.16, 0.2, this.accent, 0.3],
      [0.86, 0.32, hexToRgb('#00c8b4'), 0.22],
      [0.6, 0.92, hexToRgb('#ff6aa2'), 0.16],
    ];
    for (const [bx, by, col, a] of blobs) {
      const x = w * (bx + Math.cos(t * 0.18 + bx * 9) * 0.05);
      const y = h * (by + Math.sin(t * 0.15 + by * 7) * 0.05);
      const r = Math.max(w, h) * 0.5;
      const grd = ctx.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, rgba(col, a));
      grd.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, w, h);
    }

    // Sparkles, the one bit of motion the menu needs.
    for (const m of this.motes) {
      m.y -= dt * 0.018 * m.z;
      if (m.y < -0.03) { m.y = 1.03; m.x = Math.random(); }
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(m.tw + t * 1.1 * m.z));
      ctx.fillStyle = rgba(this.accent, tw * 0.3 * m.z);
      ctx.beginPath();
      ctx.arc(m.x * w, m.y * h, m.s * 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawScene(ctx, t, intensity, dt) {
    const { w, h } = this;
    const k = this.dark;

    // Cross-fade from the menu wash to the dark stage, so entering a song is a
    // dip rather than a cut.
    const top = BG_TOP.map((v, i) => lerp([247, 251, 255][i], v, k));
    const bot = BG_BOTTOM.map((v, i) => lerp([230, 238, 248][i], v, k));
    const base = ctx.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, rgba(top, 1));
    base.addColorStop(1, rgba(bot, 1));
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const pulse = (0.5 + 0.5 * this.energy) * k;

    // One broad glow behind the playfield, breathing with the low end.
    const cx = this.pf.left + this.pf.width / 2;
    const gy = this.pf.receptorY;
    const r = Math.max(w, h) * (0.5 + 0.06 * intensity);
    const grd = ctx.createRadialGradient(cx, gy, 0, cx, gy, r);
    grd.addColorStop(0, rgba(this.accent, (0.1 + 0.16 * intensity) * pulse));
    grd.addColorStop(0.45, rgba(this.accent, 0.05 * pulse));
    grd.addColorStop(1, rgba(this.accent, 0));
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);

    for (const m of this.motes) {
      m.y -= dt * (0.01 + 0.03 * m.z) * (0.5 + intensity);
      if (m.y < -0.03) { m.y = 1.03; m.x = Math.random(); }
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(m.tw + t * 1.3 * m.z));
      ctx.fillStyle = rgba([190, 220, 255], tw * 0.22 * m.z * k);
      ctx.beginPath();
      ctx.arc(m.x * w, m.y * h, m.s * 0.85, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawPlayfield(ctx, intensity) {
    const { left, width, laneW, receptorY, travel } = this.pf;
    const k = this.dark;
    if (k < 0.01) return;

    // A sub-1% scale pulse on the beat. Barely visible alone, but it is what
    // makes the field feel alive rather than static.
    const breathe = 1 + this.beatPulse * 0.005 * intensity;
    ctx.save();
    ctx.translate(left + width / 2, receptorY);
    ctx.scale(breathe, 1);
    ctx.translate(-(left + width / 2), -receptorY);

    const panel = ctx.createLinearGradient(0, 0, 0, receptorY);
    panel.addColorStop(0, `rgba(4,7,18,0)`);
    panel.addColorStop(0.22, `rgba(4,7,18,${0.5 * k})`);
    panel.addColorStop(1, `rgba(7,10,26,${0.78 * k})`);
    ctx.fillStyle = panel;
    ctx.fillRect(left, 0, width, receptorY + 4);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 1; i < LANE_COUNT; i++) {
      const x = left + i * laneW;
      const grd = ctx.createLinearGradient(0, 0, 0, receptorY);
      grd.addColorStop(0, 'rgba(160,200,255,0)');
      grd.addColorStop(1, `rgba(170,205,255,${0.22 * k})`);
      ctx.fillStyle = grd;
      ctx.fillRect(x - 0.5, 0, 1, receptorY);
    }
    for (const x of [left, left + width]) {
      const grd = ctx.createLinearGradient(0, 0, 0, receptorY);
      grd.addColorStop(0, rgba(this.accent, 0));
      grd.addColorStop(1, rgba(this.accent, (0.35 + 0.2 * intensity) * k));
      ctx.fillStyle = grd;
      ctx.fillRect(x - 1, 0, 2, receptorY);
    }

    // Per-lane beams for held keys and recent hits.
    for (let i = 0; i < LANE_COUNT; i++) {
      const amount = Math.max(this.laneGlow[i] * 0.5, this.laneHit[i]) * k;
      if (amount < 0.01) continue;
      const col = this.noteRgb[this.laneHit[i] > 0.02 ? this.laneTint[i] : PLAIN];
      const x = left + i * laneW;
      const top = receptorY - travel * 0.5;
      const grd = ctx.createLinearGradient(0, top, 0, receptorY);
      grd.addColorStop(0, rgba(col, 0));
      grd.addColorStop(1, rgba(col, 0.3 * amount));
      ctx.fillStyle = grd;
      ctx.fillRect(x, top, laneW, receptorY - top);
    }
    ctx.restore();
    ctx.restore();
  }

  _drawBarLines(ctx, g, t) {
    const { left, width, receptorY } = this.pf;
    const barLen = g.song.spb * 4;
    const travel = g.travelTime;
    const first = Math.floor(t / barLen);
    for (let b = first; b < first + Math.ceil(travel / barLen) + 2; b++) {
      const y = this.yFor(b * barLen, t, travel);
      if (y < -10 || y > receptorY + 2) continue;
      ctx.fillStyle = `rgba(170,205,255,${0.1 * clamp(y / (receptorY * 0.4), 0, 1) * this.dark})`;
      ctx.fillRect(left, y, width, 1);
    }
  }

  _drawHolds(ctx, g, t) {
    const { left, laneW, receptorY } = this.pf;
    const travel = g.travelTime;
    const notes = g.song.notes;
    const bw = this.noteW * 0.56;

    for (let i = g.renderFrom; i < notes.length; i++) {
      const n = notes[i];
      const yHead = this.yFor(n.t, t, travel);
      if (yHead < -240) break;
      if (!n.isHold || n.gone) continue;
      const yTail = this.yFor(n.holdEnd, t, travel);
      if (yTail > receptorY + 40) continue;

      const cx = left + n.lane * laneW + laneW / 2;
      // Once the head is struck the body pins to the judge line and visibly
      // drains, which reads instantly as "keep holding".
      const top = n.holdActive ? Math.min(yTail, receptorY) : yTail;
      const bottom = n.holdActive ? receptorY : Math.min(yHead, receptorY + 200);
      if (bottom - top < 1) continue;

      const col = n.holdBroken ? [110, 118, 140] : this.noteRgb[n.play];
      const a = n.holdBroken ? 0.2 : n.holdActive ? 0.8 : 0.5;

      ctx.save();
      roundRect(ctx, cx - bw / 2, top, bw, bottom - top, bw / 2);
      const grd = ctx.createLinearGradient(0, top, 0, bottom);
      grd.addColorStop(0, rgba(col, a * 0.55));
      grd.addColorStop(1, rgba(col, a));
      ctx.fillStyle = grd;
      ctx.fill();

      if (n.holdActive && !n.holdBroken) {
        ctx.clip();
        ctx.globalCompositeOperation = 'lighter';
        const period = 44;
        const off = (t * 200) % period;
        for (let y = top - period + off; y < bottom; y += period) {
          const gg = ctx.createLinearGradient(0, y, 0, y + period);
          gg.addColorStop(0, 'rgba(255,255,255,0)');
          gg.addColorStop(0.5, 'rgba(255,255,255,0.2)');
          gg.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = gg;
          ctx.fillRect(cx - bw / 2, y, bw, period);
        }
      }
      ctx.restore();
    }
  }

  _drawNotes(ctx, g, t) {
    const { left, laneW } = this.pf;
    const travel = g.travelTime;
    const notes = g.song.notes;

    // Notes are sorted by time, so once one is above the spawn line every
    // later note is too and we can stop.
    for (let i = g.renderFrom; i < notes.length; i++) {
      const n = notes[i];
      const y = this.yFor(n.t, t, travel);
      if (y < -140) break;
      if (n.gone || n.headJudged) continue;
      if (y > this.h + 80) continue;

      const sprite = this.noteSprites[n.play];
      const cx = left + n.lane * laneW + laneW / 2;

      // Fade and scale in near the spawn line to fake depth.
      const appear = clamp((1 - (n.t - t) / travel) / 0.12, 0, 1);
      const scale = lerp(0.88, 1, easeOutCubic(appear));
      ctx.globalAlpha = easeOutCubic(appear);
      ctx.drawImage(
        sprite.canvas,
        cx - (sprite.w * scale) / 2,
        y - (sprite.h * scale) / 2,
        sprite.w * scale,
        sprite.h * scale
      );
      ctx.globalAlpha = 1;
    }
  }

  _drawReceptors(ctx) {
    const { left, width, laneW, receptorY } = this.pf;
    const k = this.dark;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    const line = ctx.createLinearGradient(left, 0, left + width, 0);
    line.addColorStop(0, rgba(this.noteRgb[0], 0.55 * k));
    line.addColorStop(0.5, `rgba(255,255,255,${0.75 * k})`);
    line.addColorStop(1, rgba(this.noteRgb[0], 0.55 * k));
    ctx.fillStyle = line;
    roundRect(ctx, left, receptorY - 1.5, width, 3, 1.5);
    ctx.fill();

    const bed = ctx.createLinearGradient(0, receptorY - 30, 0, receptorY + 22);
    bed.addColorStop(0, 'rgba(150,190,255,0)');
    bed.addColorStop(0.55, `rgba(170,205,255,${(0.1 + 0.12 * this.energy) * k})`);
    bed.addColorStop(1, 'rgba(150,190,255,0)');
    ctx.fillStyle = bed;
    ctx.fillRect(left, receptorY - 30, width, 52);

    for (let i = 0; i < LANE_COUNT; i++) {
      const cx = left + i * laneW + laneW / 2;
      const glow = Math.max(this.laneGlow[i], this.laneHit[i]) * k;
      if (glow > 0.01) {
        const col = this.noteRgb[this.laneHit[i] > 0.02 ? this.laneTint[i] : PLAIN];
        const r = laneW * (0.55 + 0.32 * glow);
        const grd = ctx.createRadialGradient(cx, receptorY, 0, cx, receptorY, r);
        grd.addColorStop(0, rgba(col, 0.45 * glow));
        grd.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.ellipse(cx, receptorY, r, r * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      const s = this.padSprite;
      const scale = 1 + glow * 0.1;
      ctx.globalAlpha = (0.6 + glow * 0.4) * k;
      ctx.drawImage(s.canvas, cx - (s.w * scale) / 2, receptorY + 12 - (s.h * scale) / 2, s.w * scale, s.h * scale);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /**
   * Two rows of key caps under the field: the lane keys, and the colour keys
   * below them. This is the whole control scheme, always on screen.
   */
  _drawKeyCaps(ctx) {
    const { left, laneW, receptorY } = this.pf;
    const k = this.dark;
    if (k < 0.02) return;
    const capW = Math.min(laneW * 0.5, 34);
    const capH = capW * 0.78;
    const rowY = [receptorY + 34, receptorY + 34 + capH + 8];

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < LANE_COUNT; i++) {
      const cx = left + i * laneW + laneW / 2;
      for (let row = 0; row < 2; row++) {
        const lit = row === 0 ? this.laneGlow[i] : this.colorGlow[i];
        const col = row === 0 ? [225, 238, 255] : this.noteRgb[i + 1];
        const y = rowY[row];
        ctx.globalAlpha = k;
        ctx.fillStyle = rgba(col, 0.1 + 0.5 * lit);
        roundRect(ctx, cx - capW / 2, y - capH / 2, capW, capH, 7);
        ctx.fill();
        ctx.strokeStyle = rgba(col, 0.3 + 0.5 * lit);
        ctx.lineWidth = 1.2;
        roundRect(ctx, cx - capW / 2, y - capH / 2, capW, capH, 7);
        ctx.stroke();
        ctx.fillStyle = rgba(row === 0 ? [255, 255, 255] : col, 0.55 + 0.45 * lit);
        ctx.font = `700 ${(capH * 0.5).toFixed(1)}px ${FONT}`;
        ctx.fillText(this.keys[row === 0 ? i : LANE_COUNT + i], cx, y + 0.5);
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }

  _drawCombo(ctx, g) {
    if (g.combo <= 2) return;
    const { left, width, receptorY, travel } = this.pf;

    ctx.save();
    ctx.translate(left + width / 2, receptorY - travel * 0.44);
    ctx.scale(this.comboScale, this.comboScale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Warms from near-white toward gold as the combo climbs.
    const tier = clamp(g.combo / 240, 0, 1);
    const col = [lerp(238, 255, tier), lerp(247, 214, tier), lerp(255, 138, tier)];
    const a = clamp((this.comboScale - 1) * 2.4, 0, 1);

    ctx.font = `800 ${(52 * this.ui).toFixed(1)}px ${FONT}`;
    if (a > 0.01) {
      ctx.shadowColor = rgba(col, a);
      ctx.shadowBlur = 22 * a;
    }
    ctx.fillStyle = rgba(col, 0.7);
    ctx.fillText(String(g.combo), 0, 0);
    ctx.shadowBlur = 0;

    ctx.font = `700 ${(11 * this.ui).toFixed(1)}px ${FONT}`;
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '4px';
    ctx.fillStyle = 'rgba(206,224,255,0.42)';
    ctx.fillText('COMBO', 0, 32 * this.ui);
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '0px';
    ctx.restore();
  }

  _drawJudgement(ctx, t) {
    const fx = this.judgeFx;
    if (!fx.show) return;
    const age = t - fx.time;
    const LIFE = 0.6;
    if (age < 0 || age > LIFE) {
      if (age > LIFE) fx.show = false;
      return;
    }
    const { left, width, receptorY, travel } = this.pf;
    const p = age / LIFE;
    const pop = age < 0.22 ? easeOutBack(clamp(age / 0.22, 0, 1), 2.2) : 1;
    const alpha = p < 0.6 ? 1 : 1 - easeOutCubic((p - 0.6) / 0.4);

    ctx.save();
    ctx.translate(left + width / 2, receptorY - travel * 0.2 - easeOutQuint(p) * 14);
    ctx.scale(lerp(0.72, 1, pop), lerp(0.72, 1, pop));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = rgba(fx.rgb, 0.75 * alpha);
    ctx.shadowBlur = 18;
    ctx.font = `800 ${(30 * this.ui).toFixed(1)}px ${FONT}`;
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '2px';
    ctx.fillStyle = rgba(fx.rgb, alpha);
    ctx.fillText(fx.label, 0, 0);
    ctx.shadowBlur = 0;
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '0px';

    // Early/late hint helps players self-correct without being noisy.
    if (fx.label !== 'MISS' && fx.label !== 'PERFECT' && Math.abs(fx.delta) > 0.001) {
      ctx.font = `700 11px ${FONT}`;
      ctx.fillStyle = `rgba(206,222,250,${alpha * 0.6})`;
      ctx.fillText(fx.delta > 0 ? 'LATE' : 'EARLY', 0, 22);
    }
    ctx.restore();
  }

  _drawHud(ctx, g, t) {
    const { w, ui } = this;
    const pad = this.hudPad;
    const px = (n) => `${(n * ui).toFixed(1)}px`;
    const k = this.dark;

    const prog = clamp(t / g.song.duration, 0, 1);
    ctx.fillStyle = `rgba(255,255,255,${0.08 * k})`;
    ctx.fillRect(0, 0, w, 3);
    const pg = ctx.createLinearGradient(0, 0, w, 0);
    pg.addColorStop(0, rgba(this.accent, 0.9 * k));
    pg.addColorStop(1, rgba(this.noteRgb[0], 0.9 * k));
    ctx.fillStyle = pg;
    ctx.fillRect(0, 0, w * prog, 3);

    ctx.save();
    ctx.globalAlpha = k;
    ctx.textBaseline = 'top';

    ctx.textAlign = 'left';
    ctx.font = `700 ${px(15)} ${FONT}`;
    ctx.fillStyle = 'rgba(238,246,255,0.92)';
    ctx.fillText(g.song.title, pad, pad);

    const diff = difficultyMeta(g.song.difficulty);
    ctx.font = `700 ${px(11)} ${FONT}`;
    const label = `${diff.label} ${g.song.level}`;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = rgba(hexToRgb(diff.hex), 0.22);
    roundRect(ctx, pad, pad + 22 * ui, tw + 16, 17 * ui, 8);
    ctx.fill();
    ctx.fillStyle = diff.hex;
    ctx.fillText(label, pad + 8, pad + 25 * ui);

    ctx.fillStyle = 'rgba(184,202,232,0.55)';
    ctx.font = `600 ${px(11)} ${FONT}`;
    ctx.fillText(
      `${fmtTime(Math.max(0, t))} / ${fmtTime(g.song.duration)}`,
      pad + tw + 24,
      pad + 25 * ui
    );

    ctx.textAlign = 'right';
    ctx.font = `700 ${px(30)} ${FONT}`;
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '1px';
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.fillText(fmtScore(this.displayScore), w - pad, pad - 4 * ui);
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '0px';

    ctx.font = `600 ${px(12)} ${FONT}`;
    ctx.fillStyle = 'rgba(184,202,232,0.7)';
    ctx.fillText(`${this.displayAcc.toFixed(2)}%  ·  ${g.maxCombo}x MAX`, w - pad, pad + 30 * ui);

    if (g.autoplay) {
      // Under the difficulty pill rather than centred: the middle of the screen
      // belongs to the playfield.
      ctx.textAlign = 'left';
      ctx.font = `800 ${px(10)} ${FONT}`;
      ctx.fillStyle = `rgba(255,215,94,${0.45 + 0.3 * Math.sin(t * 4)})`;
      ctx.fillText('AUTOPLAY', pad, pad + 46 * ui);
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
    const scale = lerp(1.5, 1, easeOutExpo(clamp(age * 2.4, 0, 1)));
    const alpha = clamp(age * 6, 0, 1) * clamp((1 - age) * 4, 0, 1);
    ctx.translate(w / 2, h / 2);
    ctx.scale(scale, scale);
    ctx.font = `800 88px ${FONT}`;
    ctx.shadowColor = rgba(this.accent, 0.8 * alpha);
    ctx.shadowBlur = 34;
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.fillText(n > 0 ? String(n) : 'GO', 0, 0);
    ctx.restore();
  }
}
