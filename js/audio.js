// Web Audio engine: a compact synth rack plus a lookahead scheduler.
//
// The whole soundtrack is synthesised at runtime from an event list, which
// means the chart and the music share one timeline and can never drift apart.
// It also means the game ships with zero binary assets.

import { clamp, mtof } from './util.js';

const SCHEDULE_AHEAD = 0.3; // seconds of audio queued in advance
const TICK_MS = 25; // scheduler wakeup interval

/** Nothing starts or stops faster than this, so no note clicks. */
const MIN_ATTACK = 0.004;
const MIN_RELEASE = 0.07;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.song = null;
    this.events = null;
    this.eventIndex = 0;
    this.startCtxTime = 0;
    this.timer = null;
    this.running = false;

    // Smoothed transport clock (see `update`).
    this.smoothTime = 0;
    this.lastFrameMs = 0;
    this.clockPrimed = false;

    this.masterVolume = 0.75;
    this.hitSoundVolume = 0.5;
    /** Manual audio/visual calibration in seconds, from the settings panel. */
    this.userOffset = 0;

    this.freqData = null;
  }

  // ---------------------------------------------------------------- graph ---

  async createContext() {
    if (this.ctx) return;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctor({ latencyHint: 'interactive' });
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.masterVolume;

    // Everything is synthesised from raw saw and square waves, which are far
    // brighter than any real instrument. Two shelves take the glare off before
    // anything else in the chain sees it.
    this.air = ctx.createBiquadFilter();
    this.air.type = 'highshelf';
    this.air.frequency.value = 5200;
    this.air.gain.value = -7;

    this.tilt = ctx.createBiquadFilter();
    this.tilt.type = 'lowpass';
    this.tilt.frequency.value = 13000;
    this.tilt.Q.value = 0.5;

    // Gentle glue compression keeps the mix from clipping when the drums, bass
    // and lead all land on the same downbeat. A slower attack and a wide knee
    // let transients through instead of chopping their heads off.
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 30;
    this.comp.ratio.value = 2.4;
    this.comp.attack.value = 0.012;
    this.comp.release.value = 0.25;

    // A soft-clip curve after the compressor rounds peaks off rather than
    // letting the output stage square them.
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = this._softClip();
    this.shaper.oversample = '2x';

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.75;
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);

    this.master.connect(this.air);
    this.air.connect(this.tilt);
    this.tilt.connect(this.comp);
    this.comp.connect(this.shaper);
    this.shaper.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    // Reverb bus.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(2.6, 2.2);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 1.1;
    // A darkened tail sits behind the dry signal instead of hissing over it,
    // and is most of why nothing sounds like it stops dead.
    this.reverbTone = ctx.createBiquadFilter();
    this.reverbTone.type = 'lowpass';
    this.reverbTone.frequency.value = 3400;
    this.reverbGain.connect(this.reverb);
    this.reverb.connect(this.reverbTone);
    this.reverbTone.connect(this.master);

    // Dotted-eighth delay bus, low-passed so repeats sit behind the dry signal.
    this.delay = ctx.createDelay(1.5);
    this.delayFb = ctx.createGain();
    this.delayFb.gain.value = 0.34;
    this.delayTone = ctx.createBiquadFilter();
    this.delayTone.type = 'lowpass';
    this.delayTone.frequency.value = 2100;
    this.delaySend = ctx.createGain();
    this.delaySend.gain.value = 0.75;
    this.delaySend.connect(this.delay);
    this.delay.connect(this.delayTone);
    this.delayTone.connect(this.delayFb);
    this.delayFb.connect(this.delay);
    this.delayTone.connect(this.master);

    this.noiseBuffer = this._noise(2.0);
  }

  /** Soft-clip transfer curve: linear in the middle, rounded at the extremes. */
  _softClip() {
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 1.35) / Math.tanh(1.35);
    }
    return curve;
  }

  _noise(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Synthetic impulse response: decaying stereo noise. */
  _impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // A short noise-free head makes the tail feel like a room, not a wash.
        const pre = i < ctx.sampleRate * 0.012 ? 0.25 : 1;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * pre;
      }
    }
    return buf;
  }

  // -------------------------------------------------------------- voices ---

  /**
   * A note's amplitude shape. Every release gets a floor of `MIN_RELEASE`,
   * because what makes synthesised music sound chopped is not short notes — it
   * is notes that reach silence in a couple of milliseconds and click on the
   * way. Attacks get a floor too, for the same reason at the front.
   */
  _env(gainNode, t, attack, decay, peak, sustain = 0, hold = 0) {
    const g = gainNode.gain;
    const a = Math.max(attack, MIN_ATTACK);
    const d = Math.max(decay, MIN_RELEASE);
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    if (hold > 0 && sustain > 0) {
      g.exponentialRampToValueAtTime(Math.max(sustain, 0.0002), t + a + 0.03);
      g.setValueAtTime(Math.max(sustain, 0.0002), t + a + hold);
      g.exponentialRampToValueAtTime(0.0001, t + a + hold + d);
    } else {
      g.exponentialRampToValueAtTime(0.0001, t + a + d);
    }
  }

  _noiseSource(t, dur) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    // Random read offset so repeated hits never phase-align identically.
    src.start(t, Math.random() * 1.5, dur);
    return src;
  }

  _sendTo(node, reverbAmt, delayAmt) {
    if (reverbAmt > 0) {
      const g = this.ctx.createGain();
      g.gain.value = reverbAmt;
      node.connect(g);
      g.connect(this.reverbGain);
    }
    if (delayAmt > 0) {
      const g = this.ctx.createGain();
      g.gain.value = delayAmt;
      node.connect(g);
      g.connect(this.delaySend);
    }
  }

  kick(t, gain = 1) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(165, t);
    osc.frequency.exponentialRampToValueAtTime(44, t + 0.1);
    this._env(g, t, 0.003, 0.34, 0.95 * gain);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.45);

    // Beater click.
    const n = this._noiseSource(t, 0.03);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    const ng = ctx.createGain();
    this._env(ng, t, 0.001, 0.025, 0.22 * gain);
    n.connect(hp);
    hp.connect(ng);
    ng.connect(this.master);
    n.stop(t + 0.06);
  }

  snare(t, gain = 1) {
    const ctx = this.ctx;
    const n = this._noiseSource(t, 0.25);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1500;
    bp.Q.value = 0.7;
    const g = ctx.createGain();
    this._env(g, t, 0.002, 0.17, 0.42 * gain);
    n.connect(bp);
    bp.connect(g);
    g.connect(this.master);
    this._sendTo(g, 0.18, 0);
    n.stop(t + 0.3);

    // Body tone under the noise.
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(210, t);
    osc.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    const og = ctx.createGain();
    this._env(og, t, 0.002, 0.1, 0.22 * gain);
    osc.connect(og);
    og.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  clap(t, gain = 1) {
    // Three fast noise bursts read as a room clap.
    for (let i = 0; i < 3; i++) {
      const off = i * 0.011;
      const n = this._noiseSource(t + off, 0.12);
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1250;
      bp.Q.value = 0.9;
      const g = this.ctx.createGain();
      this._env(g, t + off, 0.001, i === 2 ? 0.16 : 0.04, (i === 2 ? 0.4 : 0.26) * gain);
      n.connect(bp);
      bp.connect(g);
      g.connect(this.master);
      if (i === 2) this._sendTo(g, 0.3, 0.12);
      n.stop(t + off + 0.2);
    }
  }

  hat(t, gain = 1, open = false) {
    const dur = open ? 0.22 : 0.045;
    const n = this._noiseSource(t, dur + 0.05);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = open ? 5200 : 6400;
    const g = this.ctx.createGain();
    this._env(g, t, 0.001, dur, (open ? 0.11 : 0.075) * gain);
    n.connect(hp);
    hp.connect(g);
    g.connect(this.master);
    if (open) this._sendTo(g, 0.15, 0);
    n.stop(t + dur + 0.08);
  }

  bass(t, midi, dur, gain = 1) {
    const ctx = this.ctx;
    const f = mtof(midi);
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.value = f;
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = f / 2;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 2.2;
    lp.frequency.setValueAtTime(clamp(f * 7, 180, 2000), t);
    lp.frequency.exponentialRampToValueAtTime(clamp(f * 2.4, 90, 900), t + dur * 0.8);

    const g = ctx.createGain();
    this._env(g, t, 0.008, 0.14, 0.3 * gain, 0.24 * gain, dur);
    const subG = ctx.createGain();
    subG.gain.value = 0.55;

    saw.connect(lp);
    lp.connect(g);
    sub.connect(subG);
    subG.connect(g);
    g.connect(this.master);

    saw.start(t);
    sub.start(t);
    saw.stop(t + dur + 0.3);
    sub.stop(t + dur + 0.3);
  }

  pluck(t, midi, dur, gain = 1) {
    const ctx = this.ctx;
    const f = mtof(midi);
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 1.2;
    lp.frequency.setValueAtTime(clamp(f * 6, 200, 6000), t);
    lp.frequency.exponentialRampToValueAtTime(clamp(f * 1.8, 160, 2600), t + dur);

    for (const [type, detune, lvl] of [
      ['triangle', -6, 0.6],
      ['sawtooth', 7, 0.35],
    ]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = detune;
      const og = ctx.createGain();
      og.gain.value = lvl;
      o.connect(og);
      og.connect(lp);
      o.start(t);
      o.stop(t + dur * 2 + 0.5);
    }
    // The tail runs well past the note's nominal length: a plucked string does
    // not stop the instant the next one starts.
    this._env(g, t, 0.005, dur * 1.8 + 0.12, 0.17 * gain);
    lp.connect(g);
    g.connect(this.master);
    this._sendTo(g, 0.4, 0.35);
  }

  lead(t, midi, dur, gain = 1) {
    const ctx = this.ctx;
    const f = mtof(midi);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 1.6;
    lp.frequency.setValueAtTime(clamp(f * 7, 200, 6500), t);
    lp.frequency.exponentialRampToValueAtTime(clamp(f * 2.4, 160, 3200), t + dur * 0.9);

    for (const det of [-9, 9]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.detune.value = det;
      const og = ctx.createGain();
      og.gain.value = 0.42;
      o.connect(og);
      og.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.4);
    }
    const g = ctx.createGain();
    this._env(g, t, 0.014, 0.22, 0.2 * gain, 0.14 * gain, dur);
    lp.connect(g);
    g.connect(this.master);
    this._sendTo(g, 0.3, 0.45);
  }

  pad(t, midis, dur, gain = 1) {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(700, t);
    lp.frequency.linearRampToValueAtTime(1500, t + dur * 0.5);
    lp.frequency.linearRampToValueAtTime(600, t + dur);

    for (const m of midis) {
      for (const det of [-8, 8]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(m);
        o.detune.value = det;
        const og = ctx.createGain();
        og.gain.value = 0.16;
        o.connect(og);
        og.connect(lp);
        o.start(t);
        o.stop(t + dur + 1.2);
      }
    }
    const g = ctx.createGain();
    this._env(g, t, 0.5, 0.9, 0.2 * gain, 0.15 * gain, dur);
    lp.connect(g);
    g.connect(this.master);
    this._sendTo(g, 1.0, 0.1);
  }

  riser(t, dur, gain = 1) {
    const ctx = this.ctx;
    const n = this._noiseSource(t, dur + 0.2);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2.5;
    bp.frequency.setValueAtTime(320, t);
    bp.frequency.exponentialRampToValueAtTime(5200, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16 * gain, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.14);
    n.connect(bp);
    bp.connect(g);
    g.connect(this.master);
    this._sendTo(g, 0.4, 0);
    n.stop(t + dur + 0.25);
  }

  crash(t, gain = 1) {
    const ctx = this.ctx;
    const n = this._noiseSource(t, 1.6);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3200;
    const g = ctx.createGain();
    this._env(g, t, 0.006, 1.9, 0.18 * gain);
    n.connect(hp);
    hp.connect(g);
    g.connect(this.master);
    this._sendTo(g, 0.6, 0);
    n.stop(t + 1.7);
  }

  /** Struck electric-piano tone: FM bell partial over a soft triangle body. */
  piano(t, midi, dur, gain = 1) {
    const ctx = this.ctx;
    const f = mtof(midi);
    const g = ctx.createGain();

    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.value = f;

    // The FM partial is what gives it the struck-tine attack; it decays much
    // faster than the body, so the tone softens as it rings out.
    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.value = f * 2.01;
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(f * 2.4, t);
    modGain.gain.exponentialRampToValueAtTime(f * 0.05, t + Math.min(dur, 0.5));
    mod.connect(modGain);
    modGain.connect(body.frequency);

    this._env(g, t, 0.004, Math.max(dur, 0.25) * 0.9, 0.22 * gain, 0.09 * gain, dur * 0.5);
    body.connect(g);
    g.connect(this.master);
    this._sendTo(g, 0.4, 0.18);

    body.start(t); mod.start(t);
    body.stop(t + dur + 0.6); mod.stop(t + dur + 0.6);
  }

  /** Short detuned chord stab — the punctuation in the busier sections. */
  stab(t, midis, dur, gain = 1) {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 1.4;
    lp.frequency.setValueAtTime(3800, t);
    lp.frequency.exponentialRampToValueAtTime(800, t + dur + 0.12);
    for (const m of midis) {
      for (const det of [-11, 11]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(m);
        o.detune.value = det;
        const og = ctx.createGain();
        og.gain.value = 0.13;
        o.connect(og);
        og.connect(lp);
        o.start(t);
        o.stop(t + dur + 0.3);
      }
    }
    const g = ctx.createGain();
    this._env(g, t, 0.008, dur + 0.22, 0.24 * gain);
    lp.connect(g);
    g.connect(this.master);
    this._sendTo(g, 0.3, 0.25);
  }

  /** Glassy bell for intros and outros. */
  bell(t, midi, dur, gain = 1) {
    const ctx = this.ctx;
    const f = mtof(midi);
    const g = ctx.createGain();
    for (const [mult, lvl] of [[1, 0.5], [2.76, 0.18], [5.4, 0.08]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * mult;
      const og = ctx.createGain();
      og.gain.setValueAtTime(lvl, t);
      og.gain.exponentialRampToValueAtTime(0.0001, t + dur * (1 / mult) + 0.2);
      o.connect(og);
      og.connect(g);
      o.start(t);
      o.stop(t + dur + 0.5);
    }
    this._env(g, t, 0.003, dur, 0.2 * gain);
    g.connect(this.master);
    this._sendTo(g, 0.85, 0.35);
  }

  /** Pitched tom, used for fills. */
  tom(t, midi = 45, gain = 1) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(mtof(midi) * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(mtof(midi) * 0.8, t + 0.16);
    this._env(g, t, 0.003, 0.28, 0.5 * gain);
    o.connect(g);
    g.connect(this.master);
    this._sendTo(g, 0.22, 0);
    o.start(t);
    o.stop(t + 0.35);
  }

  /** Ride cymbal: a thin ping riding on a short wash. */
  ride(t, gain = 1) {
    const ctx = this.ctx;
    const n = this._noiseSource(t, 0.4);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 7200;
    bp.Q.value = 1.6;
    const g = ctx.createGain();
    this._env(g, t, 0.002, 0.34, 0.09 * gain);
    n.connect(bp);
    bp.connect(g);
    g.connect(this.master);
    this._sendTo(g, 0.25, 0);
    n.stop(t + 0.45);
  }

  /** Sub drop under section changes. */
  sub(t, midi, dur, gain = 1) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(mtof(midi), t);
    o.frequency.exponentialRampToValueAtTime(mtof(midi - 12), t + dur);
    this._env(g, t, 0.01, dur * 0.4, 0.5 * gain, 0.34 * gain, dur * 0.7);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.2);
  }

  /** Airy vowel pad that sits above the harmony without crowding the lead. */
  choir(t, midis, dur, gain = 1) {
    const ctx = this.ctx;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 1.1;
    for (const m of midis) {
      for (const det of [-14, 0, 14]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(m);
        o.detune.value = det;
        const og = ctx.createGain();
        og.gain.value = 0.07;
        o.connect(og);
        og.connect(bp);
        o.start(t);
        o.stop(t + dur + 1.0);
      }
    }
    const g = ctx.createGain();
    this._env(g, t, 0.6, 1.0, 0.19 * gain, 0.14 * gain, dur);
    bp.connect(g);
    g.connect(this.master);
    this._sendTo(g, 1.0, 0.15);
  }

  /** Short tick layered over the player's own hits. Zero-latency feedback. */
  hitSound(lane = 0) {
    if (!this.ctx || this.hitSoundVolume <= 0) return;
    const t = this.ctx.currentTime;
    const n = this._noiseSource(t, 0.05);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1600 + lane * 300;
    bp.Q.value = 0.9;
    const g = this.ctx.createGain();
    this._env(g, t, 0.001, 0.05, 0.2 * this.hitSoundVolume);
    n.connect(bp);
    bp.connect(g);
    g.connect(this.master);
    n.stop(t + 0.08);
  }

  /** UI blip for menu interactions. */
  ui(kind = 'move') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(kind === 'confirm' ? 660 : 880, t);
    o.frequency.exponentialRampToValueAtTime(kind === 'confirm' ? 1320 : 660, t + 0.08);
    this._env(g, t, 0.002, 0.1, 0.1);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.16);
  }

  // ----------------------------------------------------------- transport ---

  /**
   * Begin playback. `from` starts the transport partway into the song, which is
   * what the chart editor scrubs with; events before that point are skipped
   * rather than crammed into the first scheduler tick.
   */
  async start(song, leadIn = 0.6, from = 0) {
    await this.createContext();
    this.song = song;
    this.events = song.events;
    this.eventIndex = 0;
    while (this.eventIndex < this.events.length && this.events[this.eventIndex].t < from) {
      this.eventIndex++;
    }
    this.startCtxTime = this.ctx.currentTime + leadIn - from;
    this.smoothTime = from - leadIn;
    this.clockPrimed = false;
    this.running = true;

    this._schedule();
    this.timer = setInterval(() => this._schedule(), TICK_MS);
  }

  _schedule() {
    if (!this.running || !this.ctx) return;
    const horizon = this.ctx.currentTime + SCHEDULE_AHEAD;
    const ev = this.events;
    while (this.eventIndex < ev.length) {
      const e = ev[this.eventIndex];
      const when = this.startCtxTime + e.t;
      if (when > horizon) break;
      this.eventIndex++;
      // Never schedule in the past: a backgrounded tab can stall the timer.
      const at = Math.max(when, this.ctx.currentTime + 0.001);
      switch (e.k) {
        case 'kick': this.kick(at, e.g); break;
        case 'snare': this.snare(at, e.g); break;
        case 'clap': this.clap(at, e.g); break;
        case 'hat': this.hat(at, e.g, e.open); break;
        case 'bass': this.bass(at, e.n, e.d, e.g); break;
        case 'pluck': this.pluck(at, e.n, e.d, e.g); break;
        case 'lead': this.lead(at, e.n, e.d, e.g); break;
        case 'pad': this.pad(at, e.n, e.d, e.g); break;
        case 'riser': this.riser(at, e.d, e.g); break;
        case 'crash': this.crash(at, e.g); break;
        case 'piano': this.piano(at, e.n, e.d, e.g); break;
        case 'stab': this.stab(at, e.n, e.d, e.g); break;
        case 'bell': this.bell(at, e.n, e.d, e.g); break;
        case 'tom': this.tom(at, e.n, e.g); break;
        case 'ride': this.ride(at, e.g); break;
        case 'sub': this.sub(at, e.n, e.d, e.g); break;
        case 'choir': this.choir(at, e.n, e.d, e.g); break;
      }
    }
  }

  /**
   * The raw transport position, compensated for output latency so that
   * "now" means "what the player is hearing right now" rather than "what the
   * device has queued".
   */
  rawTime() {
    if (!this.ctx) return 0;
    const latency = (this.ctx.outputLatency || this.ctx.baseLatency || 0);
    return this.ctx.currentTime - latency - this.startCtxTime + this.userOffset;
  }

  /**
   * `AudioContext.currentTime` only advances once per render quantum, so
   * reading it directly makes notes visibly stair-step. Instead we run a free
   * clock off the animation frame delta and slew it toward the audio clock,
   * which gives sub-millisecond-smooth scrolling that still can't drift.
   */
  update(nowMs) {
    if (!this.ctx || !this.running) return this.smoothTime;
    const raw = this.rawTime();
    if (!this.clockPrimed) {
      this.smoothTime = raw;
      this.lastFrameMs = nowMs;
      this.clockPrimed = true;
      return this.smoothTime;
    }
    const dt = clamp((nowMs - this.lastFrameMs) / 1000, 0, 0.25);
    this.lastFrameMs = nowMs;
    this.smoothTime += dt;

    const drift = raw - this.smoothTime;
    if (Math.abs(drift) > 0.08) {
      this.smoothTime = raw; // hard resync after a stall
    } else {
      this.smoothTime += drift * clamp(dt * 6, 0, 1);
    }
    return this.smoothTime;
  }

  get time() {
    return this.smoothTime;
  }

  /** Normalised low-band energy (0..1), used to drive background bloom. */
  bassEnergy() {
    if (!this.analyser) return 0;
    this.analyser.getByteFrequencyData(this.freqData);
    let sum = 0;
    for (let i = 1; i < 8; i++) sum += this.freqData[i];
    return clamp(sum / (7 * 255), 0, 1);
  }

  async pause() {
    if (this.ctx && this.ctx.state === 'running') await this.ctx.suspend();
    this.clockPrimed = false;
  }

  async resume() {
    if (this.ctx && this.ctx.state === 'suspended') await this.ctx.resume();
    this.clockPrimed = false;
  }

  setVolume(v) {
    this.masterVolume = v;
    if (this.master) this.master.gain.value = v;
  }

  /**
   * Tear the context down completely. Simpler and more reliable than trying to
   * cancel every scheduled voice individually when the player restarts.
   */
  async stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.ctx) {
      const ctx = this.ctx;
      this.ctx = null;
      try { await ctx.close(); } catch { /* already closed */ }
    }
  }
}
