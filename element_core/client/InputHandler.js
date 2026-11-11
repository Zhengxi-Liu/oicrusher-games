/**
 * Keyboard + mouse. sample() is called once per 60 Hz client tick and returns one input packet:
 *   { m: WASD bits, a: aim angle from the mage to the cursor, f: LMB held, d: dash pressed }
 * main.js stamps it with an input sequence number before sending and predicting.
 */
(function () {
  'use strict';
  const { MOVE } = window.ElementConst;
  const DIRS = [
    [MOVE.UP, ['KeyW', 'ArrowUp']], [MOVE.DOWN, ['KeyS', 'ArrowDown']],
    [MOVE.LEFT, ['KeyA', 'ArrowLeft']], [MOVE.RIGHT, ['KeyD', 'ArrowRight']],
  ];

  class InputHandler {
    constructor(canvas, toWorld) {
      this.keys = Object.create(null);
      this.toWorld = toWorld;
      this.client = { x: 0, y: 0 };
      this.cursor = { x: 0, y: 0 };
      this.mouseDown = false;
      this.dashTap = false;
      this.enabled = false;
      this.onKey = null;              // extra key hook (draft hotkeys, Esc)

      addEventListener('keydown', e => {
        if (e.target.tagName === 'INPUT') return;
        if (this.onKey && this.onKey(e)) { e.preventDefault(); return; }
        this.keys[e.code] = true;
        if (e.code === 'Space' && !e.repeat) this.dashTap = true;
        if (this.enabled && (e.code === 'Space' || e.code.startsWith('Arrow'))) e.preventDefault();
      });
      addEventListener('keyup', e => { this.keys[e.code] = false; });
      addEventListener('blur', () => { this.keys = Object.create(null); this.mouseDown = false; });
      addEventListener('mousemove', e => { this.client.x = e.clientX; this.client.y = e.clientY; });
      canvas.addEventListener('mousedown', e => { if (e.button === 0) { this.mouseDown = true; e.preventDefault(); } });
      addEventListener('mouseup', e => { if (e.button === 0) this.mouseDown = false; });
      canvas.addEventListener('contextmenu', e => e.preventDefault());
    }

    sample(origin) {
      this.cursor = this.toWorld(this.client.x, this.client.y);
      const a = Math.atan2(this.cursor.y - origin.y, this.cursor.x - origin.x);
      if (!this.enabled) { this.dashTap = false; return { m: 0, a, f: 0, d: 0 }; }
      let m = 0;
      for (const [bit, codes] of DIRS) if (codes.some(c => this.keys[c])) m |= bit;
      const d = this.dashTap ? 1 : 0;
      this.dashTap = false;
      return { m, a: Math.round(a * 1000) / 1000, f: this.mouseDown ? 1 : 0, d };
    }
  }

  window.ElementInput = { InputHandler };
})();
