// Low-latency input for eight channels: four lane keys (D F J K) and the four
// keys on the row below (C V N M) that a downward flick rolls onto.
//
// Key events carry a `timeStamp` on the same clock as `performance.now()`, so a
// press can be judged at the instant the key physically went down rather than
// on the next animation frame. That is worth several milliseconds of accuracy.

import { keyTable, LANE_COUNT, DOWN_KEYS, FLICK } from './theme.js';

export const CHANNELS = LANE_COUNT + DOWN_KEYS.length;


/** How far a finger must travel before it counts as a swipe. */
const SWIPE_PX = 26;

/** Arrow keys mirror the lane row for players without a full keyboard. */
const ALIASES = { ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3 };

export class InputManager {
  constructor(settings) {
    this.settings = settings;
    this.held = new Array(CHANNELS).fill(false);
    this.enabled = false;
    /** Drained by the game once per frame. */
    this.queue = [];
    this.onPause = null;
    this.touchLanes = new Map(); // pointerId -> lane
    this.touchStart = new Map(); // pointerId -> where the finger went down
    /** Set by the renderer so touches can be mapped to lanes. */
    this.layout = null;

    this.rebind();

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
  }

  /** Rebuild the keycode lookup after the bindings change. */
  rebind() {
    this.map = new Map();
    keyTable(this.settings).forEach((code, ch) => this.map.set(code, ch));
    for (const [code, ch] of Object.entries(ALIASES)) {
      if (!this.map.has(code)) this.map.set(code, ch);
    }
  }

  attach(canvas) {
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    canvas.addEventListener('pointerdown', this._onPointerDown);
    canvas.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerUp);
    // A dropped keyup (alt-tab, OS shortcut) would otherwise stick a channel on.
    window.addEventListener('blur', () => this.releaseAll());
  }

  /** DOM event timestamp -> "seconds ago", clamped for sanity. */
  _eventAge(ev) {
    const ts = typeof ev.timeStamp === 'number' ? ev.timeStamp : 0;
    const age = (performance.now() - ts) / 1000;
    return age >= 0 && age < 0.25 ? age : 0;
  }

  _push(channel, down, ev) {
    this.queue.push({ channel, down, age: this._eventAge(ev) });
  }

  _isFormTarget(ev) {
    const tag = ev.target && ev.target.tagName;
    return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
  }

  _onKeyDown(ev) {
    if (ev.code === 'Escape') {
      if (this.onPause) this.onPause();
      return;
    }
    if (this._isFormTarget(ev)) return;
    const ch = this.map.get(ev.code);
    if (ch === undefined) return;
    ev.preventDefault();
    if (ev.repeat || !this.enabled || this.held[ch]) return;
    this.held[ch] = true;
    this._push(ch, true, ev);
  }

  _onKeyUp(ev) {
    if (this._isFormTarget(ev)) return;
    const ch = this.map.get(ev.code);
    if (ch === undefined) return;
    ev.preventDefault();
    if (!this.held[ch]) return;
    this.held[ch] = false;
    if (this.enabled) this._push(ch, false, ev);
  }

  _laneAt(clientX) {
    const l = this.layout;
    if (!l) return -1;
    const x = clientX - l.left;
    if (x < -l.laneW * 0.5 || x > l.width + l.laneW * 0.5) return -1;
    return Math.max(0, Math.min(LANE_COUNT - 1, Math.floor(x / l.laneW)));
  }

  _onPointerDown(ev) {
    if (!this.enabled || ev.pointerType === 'mouse') return;
    const lane = this._laneAt(ev.clientX);
    if (lane < 0) return;
    ev.preventDefault();
    this.touchLanes.set(ev.pointerId, lane);
    this.touchStart.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, lane, swiped: false });
    if (!this.held[lane]) {
      this.held[lane] = true;
      this._push(lane, true, ev);
    }
  }

  /**
   * On touch a flick is a literal swipe, so a pointer that moves far enough in
   * one direction reports that direction rather than a second key. Sliding
   * across lanes still retriggers, which is how touch VSRGs are played.
   */
  _onPointerMove(ev) {
    if (!this.enabled || !this.touchLanes.has(ev.pointerId)) return;
    const start = this.touchStart.get(ev.pointerId);
    if (start && !start.swiped) {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (Math.abs(dx) > SWIPE_PX || dy > SWIPE_PX) {
        const dir = dy > Math.abs(dx) ? FLICK.DOWN : dx < 0 ? FLICK.LEFT : FLICK.RIGHT;
        start.swiped = true;
        this.queue.push({ channel: start.lane, swipe: dir, age: 0 });
        return;
      }
    }

    const prev = this.touchLanes.get(ev.pointerId);
    const lane = this._laneAt(ev.clientX);
    if (lane < 0 || lane === prev) return;
    this._releaseLaneIfUnclaimed(prev, ev, ev.pointerId);
    this.touchLanes.set(ev.pointerId, lane);
    this.touchStart.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, lane, swiped: false });
    if (!this.held[lane]) {
      this.held[lane] = true;
      this._push(lane, true, ev);
    }
  }

  _onPointerUp(ev) {
    this.touchStart.delete(ev.pointerId);
    if (!this.touchLanes.has(ev.pointerId)) return;
    const lane = this.touchLanes.get(ev.pointerId);
    this.touchLanes.delete(ev.pointerId);
    this._releaseLaneIfUnclaimed(lane, ev, ev.pointerId);
  }

  _releaseLaneIfUnclaimed(lane, ev, ignoreId) {
    for (const [id, l] of this.touchLanes) {
      if (id !== ignoreId && l === lane) return; // another finger still holds it
    }
    if (this.held[lane]) {
      this.held[lane] = false;
      if (this.enabled) this._push(lane, false, ev);
    }
  }

  releaseAll() {
    for (let i = 0; i < CHANNELS; i++) {
      if (this.held[i]) {
        this.held[i] = false;
        this.queue.push({ channel: i, down: false, age: 0 });
      }
    }
    this.touchLanes.clear();
    this.touchStart.clear();
  }

  drain() {
    const q = this.queue;
    this.queue = [];
    return q;
  }
}
