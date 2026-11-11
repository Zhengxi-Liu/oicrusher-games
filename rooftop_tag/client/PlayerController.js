/**
 * PlayerController: Pointer Lock mouse look and the runner's controls.
 *   WASD move · Space jump / wall jump · Shift, C or Ctrl crouch (slide when running)
 *   LMB tagger · RMB or E (hold) grappling hook · Tab scores · Esc menu
 * sample() is called once per 60 Hz tick and returns one input packet for prediction + the server.
 * The physics of sliding, wall running and the hook live in shared/Movement.js (same on the server).
 */
const { MOVE, BTN } = window.RTConst;

export class PlayerController {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = Object.create(null);
    this.yaw = 0;
    this.pitch = 0;
    this.buttons = 0;
    this.tapped = 0;             // pressed since the last tick (a click shorter than a frame still counts)
    this.jumpTap = false;
    this.active = false;         // in-game and not in a menu
    this.locked = false;
    this.sens = 0.0022;
    try { const s = Number(localStorage.getItem('rtSens')); if (s > 0) this.sens = s; } catch (e) {}
    this.onEscape = null;
    this.onScoreboard = null;

    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === canvas;
      if (was && !this.locked && this.active && this.onEscape) this.onEscape();
    });
    document.addEventListener('mousemove', e => {
      if (!this.locked) return;
      this.yaw -= e.movementX * this.sens;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - e.movementY * this.sens));
    });
    canvas.addEventListener('mousedown', e => {
      if (!this.active) return;
      if (!this.locked) this.lock();
      const bit = e.button === 0 ? BTN.FIRE : e.button === 2 ? BTN.HOOK : 0;
      this.buttons |= bit; this.tapped |= bit;
      e.preventDefault();
    });
    addEventListener('mouseup', e => { this.buttons &= ~(e.button === 0 ? BTN.FIRE : e.button === 2 ? BTN.HOOK : 0); });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      if (!this.active) return;
      this.keys[e.code] = true;
      if (e.code === 'Space') this.jumpTap = true;
      if (e.code === 'Tab') { e.preventDefault(); if (this.onScoreboard) this.onScoreboard(true); }
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ControlLeft', 'KeyC'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => {
      this.keys[e.code] = false;
      if (e.code === 'Tab' && this.onScoreboard) this.onScoreboard(false);
    });
    addEventListener('blur', () => { this.keys = Object.create(null); this.buttons = 0; });
  }

  lock() {
    try {
      const r = this.canvas.requestPointerLock && this.canvas.requestPointerLock();
      if (r && r.catch) r.catch(() => {});
    } catch (e) { /* no pointer lock: keyboard + click still work */ }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
  setLook(yaw, pitch) { this.yaw = yaw; this.pitch = pitch; }

  sample() {
    const k = this.keys;
    let m = 0;
    if (k.KeyW || k.ArrowUp) m |= MOVE.FWD;
    if (k.KeyS || k.ArrowDown) m |= MOVE.BACK;
    if (k.KeyA || k.ArrowLeft) m |= MOVE.LEFT;
    if (k.KeyD || k.ArrowRight) m |= MOVE.RIGHT;
    if (k.Space || this.jumpTap) m |= MOVE.JUMP;
    if (k.ShiftLeft || k.ShiftRight || k.KeyC || k.ControlLeft) m |= MOVE.CROUCH;
    let b = (this.buttons | this.tapped) & (BTN.FIRE | BTN.HOOK);
    if (k.KeyE || k.KeyF) b |= BTN.HOOK;
    // a tap of the hook button shorter than a tick still fires it, but holding is what keeps reeling
    this.tapped = 0;
    this.jumpTap = false;
    if (!this.active) { m = 0; b = 0; }
    return { m, yaw: this.yaw, pitch: this.pitch, b };
  }

  setSensitivity(v) { this.sens = v; try { localStorage.setItem('rtSens', String(v)); } catch (e) {} }
}
