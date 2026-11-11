/**
 * Bomb Arena 3D - local input: keyboard and the on-screen pad -> the input bits the shared grid
 * movement consumes (shared/Arena.js moves the player identically on the server).
 *
 *   Arrows / WASD  move (hold two keys to turn at the next gap)    Space / Enter / X / J  drop a bomb
 *   Tab  scores    Esc  menu
 */
const { KEY } = window.BAConst;

const MAP = {
  ArrowUp: KEY.UP, KeyW: KEY.UP, ArrowDown: KEY.DOWN, KeyS: KEY.DOWN, ArrowLeft: KEY.LEFT, KeyA: KEY.LEFT, ArrowRight: KEY.RIGHT, KeyD: KEY.RIGHT,
  Space: KEY.BOMB, Enter: KEY.BOMB, KeyX: KEY.BOMB, KeyJ: KEY.BOMB,
};

export class PlayerController {
  constructor() {
    this.down = [];                 // pressed movement codes, newest last (the newest direction wins)
    this.bomb = false;
    this.touch = 0;
    this.enabled = false;
    this.onEscape = null; this.onTab = null;
    addEventListener('keydown', e => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (e.code === 'Escape') { if (this.onEscape) this.onEscape(); return; }
      if (e.code === 'Tab') { e.preventDefault(); if (this.onTab) this.onTab(true); return; }
      const bit = MAP[e.code];
      if (bit === undefined || !this.enabled) return;
      e.preventDefault();
      if (bit === KEY.BOMB) this.bomb = true;
      else if (!this.down.includes(e.code)) this.down.push(e.code);
    });
    addEventListener('keyup', e => {
      if (e.code === 'Tab') { if (this.onTab) this.onTab(false); return; }
      const bit = MAP[e.code];
      if (bit === KEY.BOMB) this.bomb = false;
      this.down = this.down.filter(c => c !== e.code);
    });
    addEventListener('blur', () => { this.down = []; this.bomb = false; });
  }

  bindTouch(root) {
    root.querySelectorAll('[data-key]').forEach(el => {
      const bit = KEY[el.dataset.key];
      const on = e => { e.preventDefault(); this.touch |= bit; el.classList.add('on'); };
      const off = e => { e.preventDefault(); this.touch &= ~bit; el.classList.remove('on'); };
      el.addEventListener('touchstart', on, { passive: false }); el.addEventListener('touchend', off); el.addEventListener('touchcancel', off);
      el.addEventListener('mousedown', on); el.addEventListener('mouseup', off); el.addEventListener('mouseleave', off);
    });
  }

  /** Keys for this tick: the newest held direction plus the one before it (for turning), and the bomb. */
  sample() {
    if (!this.enabled) return 0;
    let k = this.touch;
    const dirs = this.down.slice(-2).map(c => MAP[c]);
    for (const d of dirs) k |= d;
    if ((k & KEY.LEFT) && (k & KEY.RIGHT)) k &= ~(dirs[0] === KEY.LEFT || dirs[0] === KEY.RIGHT ? dirs[0] : 0);
    if ((k & KEY.UP) && (k & KEY.DOWN)) k &= ~(dirs[0] === KEY.UP || dirs[0] === KEY.DOWN ? dirs[0] : 0);
    if (this.bomb) k |= KEY.BOMB;
    return k;
  }
}
