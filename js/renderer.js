// Canvas renderer.
//
// Two rules keep this smooth:
//   1. Every position is a pure function of the audio clock, so motion is
//      correct at any refresh rate without interpolation hacks.
//   2. Everything that reacts — lane glow, score counter, combo pop — is
//      exponentially damped with `damp`, which is framerate independent.
// Glow-heavy note graphics are pre-rendered to sprites once per resize rather
// than paying for `shadowBlur` on every note, every frame.
//
// The look is deliberately plain: a flat dark field, hard lane rules and a
// solid judge line. Everything that moves is either a note or feedback about a
// note the player just hit.

import {
  clamp, lerp, damp, easeOutCubic, easeOutQuint, easeOutBack, easeOutExpo,
  roundRect, fmtScore, fmtTime, hexToRgb, rgba, shade,
} from './util.js';
import {
  LANE_COUNT, FLICK, JUDGE_HEX, noteRgbTable, keyTable, keyLabel, difficultyMeta,
} from './theme.js';

const FONT = `system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif`;
const JUDGE_RGB = Object.fromEntries(
  Object.entries(JUDGE_HEX).map(([k, v]) => [k, hexToRgb(v)])
);

const BG_TOP = [22, 23, 26];
const BG_BOTTOM = [12, 12, 14];
const PANEL = [4, 4, 5];

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
    this.laneTint = new Array(LANE_COUNT).fill(null);
    this.downGlow = new Array(LANE_COUNT).fill(0);
    this.displayScore = 0;
    this.displayAcc = 100;
    this.comboScale = 1;
    this.comboShown = 0;

    this.judgeFx = { label: '', rgb: JUDGE_RGB.PERFECT, time: -10, delta: 0, show: false };

    this.refreshColors();
    this.resize();
  }

  /** Re-read note colours and key bindings after the settings change. */
  refreshColors() {
    this.noteRgb = noteRgbTable(this.settings);
    this.keys = keyTable(this.settings).map(keyLabel);
    if (this.w) this._buildSprites();
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

    const pfW = clamp(Math.min(w * 0.9, h * 0.66), 260, 600);
    // Two rows of key caps live below the judge line, so it sits higher than a
    // four-key game would normally put it.
    const foot = clamp(h * 0.17, 112, 190);
    this.pf = {
      width: pfW,
      left: Math.round((w - pfW) / 2),
      laneW: pfW / LANE_COUNT,
      receptorY: Math.round(h - foot),
      spawnY: -60,
    };
    this.pf.travel = this.pf.receptorY - this.pf.spawnY;

    this.metrics = this._noteMetrics();
    this.ui = w < 560 ? 0.82 : w < 780 ? 0.92 : 1;
    this.hudPad = clamp(w * 0.025, 16, 32);

    this._buildSprites();
  }

  /** Layout the input manager needs to map touches to lanes. */
  get layout() {
    return { left: this.pf.left, width: this.pf.width, laneW: this.pf.laneW };
  }

  // -------------------------------------------------------------- sprites --

  /**
   * Note geometry for the chosen style and size. Every style keeps the same
   * footprint so a chart reads the same however it is drawn.
   */
  _noteMetrics() {
    const laneW = this.pf.laneW;
    const scale = clamp(this.settings.noteScale ?? 1, 0.5, 1.6);
    const base = clamp(laneW * 0.1, 8, 15) * scale;
    const style = this.settings.noteStyle || 'bar';
    if (style === 'circle') {
      const d = clamp(base * 2.4, 14, laneW * 0.62);
      return { style, w: d, h: d, r: d / 2 };
    }
    if (style === 'capsule') {
      const h = base * 1.15;
      return { style, w: laneW * 0.66, h, r: h / 2 };
    }
    return { style, w: laneW * 0.72, h: base, r: Math.min(3, base * 0.28) };
  }

  _buildSprites() {
    const c = this.noteRgb;
    this.noteSprites = {
      tap: this._noteSprite(c.tap, FLICK.NONE),
      hold: this._noteSprite(c.hold, FLICK.NONE),
      flick1: this._noteSprite(c.flick, FLICK.LEFT),
      flick2: this._noteSprite(c.flick, FLICK.RIGHT),
      flick3: this._noteSprite(c.flick, FLICK.DOWN),
    };
  }

  /** Sprite key for a note, given the flick actually in force. */
  spriteFor(note) {
    if (note.play) return this.noteSprites[`flick${note.play}`];
    return note.isHold ? this.noteSprites.hold : this.noteSprites.tap;
  }

  /**
   * A note is a small filled shape with a bright top edge. A flick carries a
   * chevron pointing the way it must be rolled — direction is the one thing a
   * player has to read off the note itself, so it is drawn, not implied.
   */
  _noteSprite(col, flick) {
    const { w, h, r, style } = this.metrics;
    const pad = 8;
    const c = document.createElement('canvas');
    c.width = Math.ceil((w + pad * 2) * this.dpr);
    c.height = Math.ceil((h + pad * 2) * this.dpr);
    const g = c.getContext('2d');
    g.scale(this.dpr, this.dpr);

    const grad = g.createLinearGradient(0, pad, 0, pad + h);
    grad.addColorStop(0, rgba(shade(col, 1.15), 1));
    grad.addColorStop(1, rgba(shade(col, 0.72), 1));
    g.fillStyle = grad;
    if (style === 'circle') {
      g.beginPath();
      g.arc(pad + w / 2, pad + h / 2, w / 2, 0, Math.PI * 2);
      g.fill();
    } else {
      roundRect(g, pad, pad, w, h, r);
      g.fill();
    }

    if (flick) {
      const cx = pad + w / 2;
      const cy = pad + h / 2;
      const k = Math.max(2.6, Math.min(w, h) * 0.24);
      g.strokeStyle = 'rgba(255,255,255,0.95)';
      g.lineWidth = Math.max(1.4, k * 0.5);
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      if (flick === FLICK.DOWN) {
        g.moveTo(cx - k, cy - k * 0.45);
        g.lineTo(cx, cy + k * 0.5);
        g.lineTo(cx + k, cy - k * 0.45);
      } else {
        const s = flick === FLICK.LEFT ? -1 : 1;
        g.moveTo(cx - s * k * 0.45, cy - k);
        g.lineTo(cx + s * k * 0.5, cy);
        g.lineTo(cx - s * k * 0.45, cy + k);
      }
      g.stroke();
    }

    return { canvas: c, w: w + pad * 2, h: h + pad * 2 };
  }

  /** Vertical position of a note at song time `t`. */
  yFor(noteTime, t, travelTime) {
    const p = (noteTime - t) / travelTime; // 1 = spawn, 0 = receptor
    return this.pf.receptorY - p * this.pf.travel;
  }

  // -------------------------------------------------------------- effects --

  showJudge(label, delta, time) {
    this.judgeFx = { label, rgb: JUDGE_RGB[label] || JUDGE_RGB.GOOD, time, delta, show: true };
  }

  hitLane(lane, strength = 1, tint = null) {
    this.laneHit[lane] = Math.max(this.laneHit[lane], strength);
    this.laneTint[lane] = tint;
  }

  // ---------------------------------------------------------------- frame --

  draw(g, dt) {
    const ctx = this.ctx;
    const t = g.time;

    for (let i = 0; i < LANE_COUNT; i++) {
      this.laneGlow[i] = damp(this.laneGlow[i], g.laneHeld[i] ? 1 : 0, 24, dt);
      this.laneHit[i] = damp(this.laneHit[i], 0, 8, dt);
    }
    for (let i = 0; i < LANE_COUNT; i++) {
      this.downGlow[i] = damp(this.downGlow[i], g.channelHeld[LANE_COUNT + i] ? 1 : 0, 24, dt);
    }
    this.displayScore = damp(this.displayScore, g.score, 10, dt);
    this.displayAcc = damp(this.displayAcc, g.accuracy, 8, dt);

    if (g.combo !== this.comboShown) {
      if (g.combo > this.comboShown) this.comboScale = 1.16;
      this.comboShown = g.combo;
    }
    this.comboScale = damp(this.comboScale, 1, 14, dt);

    this._drawBackground(ctx);
    this._drawPlayfield(ctx);
    this._drawBarLines(ctx, g, t);
    // The combo sits behind the notes so an incoming note is never obscured.
    this._drawCombo(ctx, g);
    this._drawHolds(ctx, g, t);
    this._drawNotes(ctx, g, t);
    this._drawJudgeLine(ctx);
    // Effects are clipped to the field: a hit is feedback about a lane, so it
    // should never spill sideways across the page.
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.pf.left, 0, this.pf.width, this.h);
    ctx.clip();
    g.particles.draw(ctx);
    ctx.restore();
    this._drawKeyCaps(ctx);
    this._drawJudgement(ctx, t);
    this._drawHud(ctx, g, t);

    if (g.countdown > 0) this._drawCountdown(ctx, g.countdown);
  }

  _drawBackground(ctx) {
    const grad = ctx.createLinearGradient(0, 0, 0, this.h);
    grad.addColorStop(0, rgba(BG_TOP, 1));
    grad.addColorStop(1, rgba(BG_BOTTOM, 1));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  _drawPlayfield(ctx) {
    const { left, width, laneW, receptorY, travel } = this.pf;

    // The field is darker than the page around it, so its edges read without
    // needing a glow to mark them.
    ctx.fillStyle = rgba(PANEL, 1);
    ctx.fillRect(left, 0, width, receptorY);

    for (let i = 1; i < LANE_COUNT; i++) {
      ctx.fillStyle = 'rgba(255,255,255,0.09)';
      ctx.fillRect(Math.round(left + i * laneW) - 0.5, 0, 1, receptorY);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.26)';
    ctx.fillRect(left - 1, 0, 1, receptorY);
    ctx.fillRect(left + width, 0, 1, receptorY);

    // Held keys and recent hits tint their lane from the judge line upward.
    for (let i = 0; i < LANE_COUNT; i++) {
      const amount = Math.max(this.laneGlow[i] * 0.55, this.laneHit[i]);
      if (amount < 0.01) continue;
      const col = (this.laneHit[i] > 0.02 && this.laneTint[i]) || this.noteRgb.tap;
      const top = receptorY - travel * 0.4;
      const grad = ctx.createLinearGradient(0, top, 0, receptorY);
      grad.addColorStop(0, rgba(col, 0));
      grad.addColorStop(1, rgba(col, 0.22 * amount));
      ctx.fillStyle = grad;
      ctx.fillRect(left + i * laneW, top, laneW, receptorY - top);
    }
  }

  _drawBarLines(ctx, g, t) {
    const { left, width, receptorY } = this.pf;
    const barLen = g.song.spb * (g.song.beatsPerBar || 4);
    const travel = g.travelTime;
    const first = Math.floor(t / barLen);
    ctx.fillStyle = 'rgba(255,255,255,0.13)';
    for (let b = first; b < first + Math.ceil(travel / barLen) + 2; b++) {
      const y = Math.round(this.yFor(b * barLen, t, travel));
      if (y < 0 || y > receptorY - 2) continue;
      ctx.fillRect(left, y, width, 1);
    }
  }

  _drawHolds(ctx, g, t) {
    const { left, laneW, receptorY } = this.pf;
    const travel = g.travelTime;
    const notes = g.song.notes;
    const bw = this.metrics.w * 0.6;

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

      const col = n.holdBroken ? [104, 112, 128] : this.noteRgb.hold;
      ctx.fillStyle = rgba(col, n.holdBroken ? 0.2 : n.holdActive ? 0.62 : 0.45);
      roundRect(ctx, cx - bw / 2, top, bw, bottom - top, bw * 0.3);
      ctx.fill();
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
      if (y < -120) break;
      if (n.gone || n.headJudged) continue;
      if (y > this.h + 80) continue;

      const sprite = this.spriteFor(n);
      const cx = left + n.lane * laneW + laneW / 2;
      // A short fade at the spawn line, so notes appear rather than pop in.
      ctx.globalAlpha = clamp((1 - (n.t - t) / travel) / 0.08, 0, 1);
      ctx.drawImage(sprite.canvas, cx - sprite.w / 2, y - sprite.h / 2);
      ctx.globalAlpha = 1;
    }
  }

  _drawJudgeLine(ctx) {
    const { left, width, receptorY } = this.pf;
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(left, receptorY - 6, width, 6);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(left, receptorY - 2, width, 3);
  }

  /**
   * Two rows of key caps under the field: the lane keys, and the row a downward
   * flick rolls onto. This is the whole control scheme, always on screen.
   */
  _drawKeyCaps(ctx) {
    const { left, laneW, receptorY } = this.pf;
    const capW = Math.min(laneW * 0.62, 40);
    const capH = Math.min(capW * 0.72, 28);
    const rowY = [receptorY + 30, receptorY + 30 + capH + 8];

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < LANE_COUNT; i++) {
      const cx = left + i * laneW + laneW / 2;
      for (let row = 0; row < 2; row++) {
        const lit = row === 0 ? this.laneGlow[i] : this.downGlow[i];
        const col = row === 0 ? [226, 232, 240] : this.noteRgb.flick;
        const y = rowY[row];
        ctx.fillStyle = rgba(col, 0.08 + 0.42 * lit);
        roundRect(ctx, cx - capW / 2, y - capH / 2, capW, capH, 5);
        ctx.fill();
        ctx.strokeStyle = rgba(col, 0.4 + 0.5 * lit);
        ctx.lineWidth = 1;
        roundRect(ctx, cx - capW / 2 + 0.5, y - capH / 2 + 0.5, capW - 1, capH - 1, 5);
        ctx.stroke();
        ctx.fillStyle = rgba(row === 0 ? [255, 255, 255] : col, 0.75 + 0.25 * lit);
        ctx.font = `700 ${(capH * 0.48).toFixed(1)}px ${FONT}`;
        ctx.fillText(this.keys[row === 0 ? i : LANE_COUNT + i], cx, y + 0.5);
      }
    }
    ctx.restore();
  }

  _drawCombo(ctx, g) {
    if (g.combo <= 2) return;
    const { left, width, receptorY, travel } = this.pf;

    ctx.save();
    ctx.translate(left + width / 2, receptorY - travel * 0.46);
    ctx.scale(this.comboScale, this.comboScale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${(46 * this.ui).toFixed(1)}px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillText(String(g.combo), 0, 0);
    ctx.font = `700 ${(10 * this.ui).toFixed(1)}px ${FONT}`;
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '3px';
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillText('COMBO', 0, 26 * this.ui);
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '0px';
    ctx.restore();
  }

  _drawJudgement(ctx, t) {
    const fx = this.judgeFx;
    if (!fx.show) return;
    const age = t - fx.time;
    const LIFE = 0.55;
    if (age < 0 || age > LIFE) {
      if (age > LIFE) fx.show = false;
      return;
    }
    const { left, width, receptorY, travel } = this.pf;
    const p = age / LIFE;
    const pop = age < 0.18 ? easeOutBack(clamp(age / 0.18, 0, 1), 1.8) : 1;
    const alpha = p < 0.65 ? 1 : 1 - easeOutCubic((p - 0.65) / 0.35);

    ctx.save();
    ctx.translate(left + width / 2, receptorY - travel * 0.2 - easeOutQuint(p) * 12);
    ctx.scale(lerp(0.8, 1, pop), lerp(0.8, 1, pop));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${(28 * this.ui).toFixed(1)}px ${FONT}`;
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '2px';
    ctx.fillStyle = rgba(fx.rgb, alpha);
    ctx.fillText(fx.label, 0, 0);
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '0px';

    // Early/late hint helps players self-correct without being noisy.
    if (fx.label !== 'MISS' && fx.label !== 'PERFECT' && Math.abs(fx.delta) > 0.001) {
      ctx.font = `700 11px ${FONT}`;
      ctx.fillStyle = `rgba(214,224,238,${alpha * 0.7})`;
      ctx.fillText(fx.delta > 0 ? 'LATE' : 'EARLY', 0, 22);
    }
    ctx.restore();
  }

  _drawHud(ctx, g, t) {
    const { w, ui } = this;
    const pad = this.hudPad;
    const px = (n) => `${(n * ui).toFixed(1)}px`;

    const prog = clamp(t / g.song.duration, 0, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(0, 0, w, 3);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w * prog, 3);

    ctx.save();
    ctx.textBaseline = 'top';

    ctx.textAlign = 'left';
    ctx.font = `650 ${px(16)} ${FONT}`;
    ctx.fillStyle = 'rgba(240,244,250,0.95)';
    ctx.fillText(g.song.title, pad, pad);

    // Difficulty as a solid badge, the same chip the song list uses. It takes
    // the lifted `glow` weight, since the dark badge colour would vanish here.
    const diff = difficultyMeta(g.song.difficulty);
    const label = `${diff.label} ${g.song.level}`;
    ctx.font = `700 ${px(11)} ${FONT}`;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = diff.glow;
    ctx.fillRect(pad, pad + 24 * ui, tw + 14, 18 * ui);
    ctx.fillStyle = '#101114';
    ctx.fillText(label, pad + 7, pad + 28 * ui);

    ctx.fillStyle = 'rgba(180,192,208,0.75)';
    ctx.font = `600 ${px(12)} ${FONT}`;
    ctx.fillText(
      `${fmtTime(Math.max(0, t))} / ${fmtTime(g.song.duration)}`,
      pad + tw + 24,
      pad + 28 * ui
    );

    if (g.autoplay) {
      ctx.fillStyle = 'rgba(255,215,94,0.9)';
      ctx.font = `700 ${px(11)} ${FONT}`;
      ctx.fillText('AUTOPLAY', pad, pad + 48 * ui);
    }

    ctx.textAlign = 'right';
    ctx.font = `700 ${px(30)} ${FONT}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(fmtScore(this.displayScore), w - pad, pad - 2 * ui);

    ctx.font = `600 ${px(13)} ${FONT}`;
    ctx.fillStyle = 'rgba(180,192,208,0.8)';
    ctx.fillText(`${this.displayAcc.toFixed(2)}%   ${g.maxCombo}x max`, w - pad, pad + 32 * ui);
    ctx.restore();
  }

  _drawCountdown(ctx, remaining) {
    const { w, h } = this;
    const n = Math.ceil(remaining);
    // 0 the instant a digit appears, 1 just before it is replaced.
    const age = clamp(1 - (remaining - Math.floor(remaining)), 0, 1);
    ctx.save();
    ctx.fillStyle = 'rgba(6,9,14,0.7)';
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.translate(w / 2, h / 2);
    const scale = lerp(1.4, 1, easeOutExpo(clamp(age * 2.4, 0, 1)));
    ctx.scale(scale, scale);
    ctx.font = `700 84px ${FONT}`;
    ctx.fillStyle = `rgba(255,255,255,${clamp(age * 6, 0, 1) * clamp((1 - age) * 4, 0, 1)})`;
    ctx.fillText(n > 0 ? String(n) : 'GO', 0, 0);
    ctx.restore();
  }
}
