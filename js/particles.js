// Pooled particle system. Allocation-free during play so the GC never
// introduces a hitch mid-song.

import { clamp, easeOutCubic, easeOutQuint } from './util.js';

const MAX = 900;

export class Particles {
  constructor() {
    this.pool = new Array(MAX);
    for (let i = 0; i < MAX; i++) {
      this.pool[i] = {
        active: false, kind: 'spark', x: 0, y: 0, vx: 0, vy: 0,
        life: 0, maxLife: 1, size: 1, lane: 0, drag: 2.5,
        gravity: 0, rot: 0, spin: 0, alpha: 1,
      };
    }
    this.cursor = 0;
    this.live = 0;
  }

  _take() {
    // Ring buffer: under extreme load the oldest particle is recycled, which
    // degrades far more gracefully than dropping new effects.
    for (let i = 0; i < MAX; i++) {
      const p = this.pool[this.cursor];
      this.cursor = (this.cursor + 1) % MAX;
      if (!p.active) {
        p.active = true;
        this.live++;
        return p;
      }
    }
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % MAX;
    return p;
  }

  clear() {
    for (const p of this.pool) p.active = false;
    this.live = 0;
  }

  /** Burst of sparks when a note is struck. */
  burst(x, y, lane, strength = 1, quality = 1) {
    const count = Math.round(clamp(8 + 12 * strength, 4, 22) * quality);
    for (let i = 0; i < count; i++) {
      const p = this._take();
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.5;
      const speed = (120 + Math.random() * 380) * strength;
      p.kind = 'spark';
      p.x = x + (Math.random() - 0.5) * 26;
      p.y = y + (Math.random() - 0.5) * 8;
      p.vx = Math.cos(ang) * speed * 0.55;
      p.vy = Math.sin(ang) * speed;
      p.maxLife = p.life = 0.32 + Math.random() * 0.42;
      p.size = 1.6 + Math.random() * 3.4;
      p.lane = lane;
      p.drag = 2.2;
      p.gravity = 340;
      p.alpha = 1;
    }
  }

  /** Expanding ring that reads as the impact shockwave. */
  ring(x, y, lane, size = 60, strength = 1) {
    const p = this._take();
    p.kind = 'ring';
    p.x = x;
    p.y = y;
    p.vx = 0;
    p.vy = 0;
    p.maxLife = p.life = 0.42;
    p.size = size * strength;
    p.lane = lane;
    p.alpha = 0.85 * strength;
  }

  /** Soft light bloom at the receptor. */
  bloom(x, y, lane, size = 70) {
    const p = this._take();
    p.kind = 'bloom';
    p.x = x;
    p.y = y;
    p.maxLife = p.life = 0.3;
    p.size = size;
    p.lane = lane;
    p.alpha = 0.9;
  }

  /** Debris shed by a held note while it is being sustained. */
  holdSpark(x, y, lane) {
    const p = this._take();
    p.kind = 'spark';
    p.x = x + (Math.random() - 0.5) * 30;
    p.y = y;
    p.vx = (Math.random() - 0.5) * 90;
    p.vy = -110 - Math.random() * 160;
    p.maxLife = p.life = 0.24 + Math.random() * 0.2;
    p.size = 1.2 + Math.random() * 2;
    p.lane = lane;
    p.drag = 3;
    p.gravity = 120;
    p.alpha = 0.8;
  }

  /** Grey fragments dropping away from a missed note. */
  missDust(x, y) {
    for (let i = 0; i < 7; i++) {
      const p = this._take();
      p.kind = 'dust';
      p.x = x + (Math.random() - 0.5) * 44;
      p.y = y + (Math.random() - 0.5) * 12;
      p.vx = (Math.random() - 0.5) * 70;
      p.vy = 40 + Math.random() * 130;
      p.maxLife = p.life = 0.5 + Math.random() * 0.3;
      p.size = 1.5 + Math.random() * 2.5;
      p.lane = -1;
      p.drag = 1.4;
      p.gravity = 280;
      p.alpha = 0.55;
    }
  }

  update(dt) {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        this.live--;
        continue;
      }
      if (p.kind === 'spark' || p.kind === 'dust') {
        const d = Math.exp(-p.drag * dt);
        p.vx *= d;
        p.vy = p.vy * d + p.gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
    }
  }

  draw(ctx, colors) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.pool) {
      if (!p.active) continue;
      const t = 1 - p.life / p.maxLife;
      const col = p.lane >= 0 ? colors[p.lane] : [150, 160, 190];

      if (p.kind === 'spark') {
        const a = (1 - t) * (1 - t) * p.alpha;
        const r = p.size * (1 - t * 0.4);
        ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'dust') {
        const a = (1 - t) * p.alpha;
        ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${a})`;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      } else if (p.kind === 'ring') {
        const e = easeOutQuint(t);
        const r = p.size * (0.25 + e * 1.0);
        const a = (1 - t) * (1 - t) * p.alpha;
        ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${a})`;
        ctx.lineWidth = 3.5 * (1 - e * 0.75);
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, r, r * 0.42, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.kind === 'bloom') {
        const e = easeOutCubic(t);
        const r = p.size * (0.5 + e * 0.9);
        const a = (1 - t) * p.alpha;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, `rgba(255,255,255,${a * 0.8})`);
        g.addColorStop(0.35, `rgba(${col[0]},${col[1]},${col[2]},${a * 0.5})`);
        g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}
