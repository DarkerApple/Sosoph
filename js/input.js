// Low-latency lane input for keyboard and touch.
//
// Key events carry a `timeStamp` on the same clock as `performance.now()`, so
// we can reconstruct the exact moment a key went down rather than judging it on
// the next animation frame. That is worth several milliseconds of accuracy.

export const LANE_COUNT = 4;

const KEY_MAP = {
  KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3,
  KeyS: 0, KeyL: 3,
  ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3,
};

export class InputManager {
  constructor() {
    this.held = new Array(LANE_COUNT).fill(false);
    this.enabled = false;
    /** Queue of {lane, down, time} drained by the game each frame. */
    this.queue = [];
    this.onPause = null;
    this.touchLanes = new Map(); // pointerId -> lane
    /** Filled in by the renderer so touches can be mapped to lanes. */
    this.layout = null;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
  }

  attach(canvas) {
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    canvas.addEventListener('pointerdown', this._onPointerDown);
    canvas.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerUp);
    // A dropped keyup (alt-tab, OS shortcut) would otherwise leave a lane stuck.
    window.addEventListener('blur', () => this.releaseAll());
  }

  /** Convert a DOM event timestamp into "seconds ago", clamped for sanity. */
  _eventAge(ev) {
    const ts = typeof ev.timeStamp === 'number' ? ev.timeStamp : 0;
    const age = (performance.now() - ts) / 1000;
    return age >= 0 && age < 0.25 ? age : 0;
  }

  _push(lane, down, ev) {
    this.queue.push({ lane, down, age: this._eventAge(ev) });
  }

  _onKeyDown(ev) {
    if (ev.code === 'Escape') {
      if (this.onPause) this.onPause();
      return;
    }
    // Let focused UI controls keep their own arrow-key behaviour.
    if (this._isFormTarget(ev)) return;
    const lane = KEY_MAP[ev.code];
    if (lane === undefined) return;
    ev.preventDefault();
    if (ev.repeat || !this.enabled || this.held[lane]) return;
    this.held[lane] = true;
    this._push(lane, true, ev);
  }

  _isFormTarget(ev) {
    const tag = ev.target && ev.target.tagName;
    return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
  }

  _onKeyUp(ev) {
    if (this._isFormTarget(ev)) return;
    const lane = KEY_MAP[ev.code];
    if (lane === undefined) return;
    ev.preventDefault();
    if (!this.held[lane]) return;
    this.held[lane] = false;
    if (this.enabled) this._push(lane, false, ev);
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
    if (!this.held[lane]) {
      this.held[lane] = true;
      this._push(lane, true, ev);
    }
  }

  /** Sliding across lanes retriggers, which is how touch VSRGs are played. */
  _onPointerMove(ev) {
    if (!this.enabled || !this.touchLanes.has(ev.pointerId)) return;
    const prev = this.touchLanes.get(ev.pointerId);
    const lane = this._laneAt(ev.clientX);
    if (lane < 0 || lane === prev) return;
    this._releaseLaneIfUnclaimed(prev, ev, ev.pointerId);
    this.touchLanes.set(ev.pointerId, lane);
    if (!this.held[lane]) {
      this.held[lane] = true;
      this._push(lane, true, ev);
    }
  }

  _onPointerUp(ev) {
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
    for (let i = 0; i < LANE_COUNT; i++) {
      if (this.held[i]) {
        this.held[i] = false;
        this.queue.push({ lane: i, down: false, age: 0 });
      }
    }
    this.touchLanes.clear();
  }

  drain() {
    const q = this.queue;
    this.queue = [];
    return q;
  }
}
