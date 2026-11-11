/**
 * Voxel Kart Racing - local input: keyboard and on-screen touch buttons -> the input bits the
 * shared physics consumes (shared/KartPhysics.js does the actual arcade handling, drifting and
 * boost timers, identically on the server).
 *
 *   W / Up  accelerate        S / Down  brake, reverse (hold while using a shell: throw it backwards)
 *   A D / Left Right  steer   Shift / Space  hop + drift (hold, steer, release for a mini-turbo)
 *   E / X / Ctrl  use item    B  look back
 */
const { KEY } = window.VKConst;

const MAP = {
  KeyW: KEY.UP, ArrowUp: KEY.UP, KeyS: KEY.DOWN, ArrowDown: KEY.DOWN,
  KeyA: KEY.LEFT, ArrowLeft: KEY.LEFT, KeyD: KEY.RIGHT, ArrowRight: KEY.RIGHT,
  ShiftLeft: KEY.DRIFT, ShiftRight: KEY.DRIFT, Space: KEY.DRIFT,
  KeyE: KEY.ITEM, KeyX: KEY.ITEM, ControlLeft: KEY.ITEM, ControlRight: KEY.ITEM, KeyB: KEY.BACK,
};

export class KartController {
  constructor() {
    this.down = new Set();
    this.touch = 0;
    this.enabled = false;
    this.onEscape = null;
    this.onTab = null;
    addEventListener('keydown', e => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (e.code === 'Escape') { if (this.onEscape) this.onEscape(); return; }
      if (e.code === 'Tab') { e.preventDefault(); if (this.onTab) this.onTab(true); return; }
      if (MAP[e.code] !== undefined && this.enabled) { this.down.add(e.code); e.preventDefault(); }
    });
    addEventListener('keyup', e => {
      if (e.code === 'Tab') { if (this.onTab) this.onTab(false); return; }
      this.down.delete(e.code);
    });
    addEventListener('blur', () => this.down.clear());
  }

  /** Wire the on-screen buttons (elements with data-key="UP|LEFT|..."). */
  bindTouch(root) {
    root.querySelectorAll('[data-key]').forEach(el => {
      const bit = KEY[el.dataset.key];
      const on = e => { e.preventDefault(); this.touch |= bit; el.classList.add('on'); };
      const off = e => { e.preventDefault(); this.touch &= ~bit; el.classList.remove('on'); };
      el.addEventListener('touchstart', on, { passive: false }); el.addEventListener('touchend', off); el.addEventListener('touchcancel', off);
      el.addEventListener('mousedown', on); el.addEventListener('mouseup', off); el.addEventListener('mouseleave', off);
    });
  }

  sample() {
    if (!this.enabled) return 0;
    let k = this.touch;
    for (const c of this.down) k |= MAP[c];
    if ((k & KEY.LEFT) && (k & KEY.RIGHT)) k &= ~(KEY.LEFT | KEY.RIGHT);
    return k;
  }
}
