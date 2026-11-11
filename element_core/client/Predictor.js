/**
 * Client-side prediction + server reconciliation for the local mage.
 *  - step(): apply a freshly sampled input to our own copy immediately (zero perceived lag),
 *    remember it by sequence number, and spawn predicted bolts if the cast cooldown allows.
 *  - reconcile(): on every snapshot, take the server's authoritative mage, drop inputs the
 *    server has acknowledged, replay the rest with the same shared Movement code, and keep the
 *    visual difference as an offset that decays over a few frames (no snapping).
 * Predicted bolts disappear as soon as the server's own copy of that cast shows up.
 */
(function () {
  'use strict';
  const { C } = window.ElementConst;
  const Move = window.ElementMove;

  class Predictor {
    constructor() {
      this.seq = 0;
      this.pending = [];
      this.p = null;
      this.offset = { x: 0, y: 0 };
      this.bolts = [];
      this.confirmedSeq = 0;      // newest cast seq the server has shown us
      this.corrections = 0;
    }

    reset(sp) {
      this.p = sp ? { ...sp } : null;
      this.pending = [];
      this.offset = { x: 0, y: 0 };
      this.bolts = [];
    }

    step(inp, covers, st, combat) {
      inp.s = ++this.seq;
      this.pending.push(inp);
      if (this.pending.length > 180) this.pending.shift();
      if (combat && this.p && this.p.alive) {
        this.p.aim = inp.a;
        if (Move.stepPlayer(this.p, inp, covers, st)) {
          for (const b of Move.shotPattern(this.p, inp.a, st)) this.bolts.push({ ...b, seq: inp.s, life: st.life });
          return true;
        }
      }
      return false;
    }

    /** Move predicted bolts in straight lines; they stop at walls / cover (the server decides the rest). */
    advanceBolts(covers) {
      for (const b of this.bolts) {
        b.x += b.vx; b.y += b.vy; b.life--;
        if (b.x < 0 || b.y < 0 || b.x > C.ARENA_W || b.y > C.ARENA_H) b.life = 0;
        else for (const c of covers) if (c.hp > 0 && Move.circleRect(b.x, b.y, b.r, c)) { b.life = 0; break; }
      }
      this.bolts = this.bolts.filter(b => b.life > 0 && b.seq > this.confirmedSeq);
    }

    reconcile(sp, ack, covers, st, combat) {
      if (!this.p) { this.p = { ...sp }; return; }
      const px = this.p.x, py = this.p.y;
      this.p = { ...sp };
      this.pending = this.pending.filter(i => i.s > ack);
      if (combat && this.p.alive) for (const inp of this.pending) Move.stepPlayer(this.p, inp, covers, st);
      const dx = px - this.p.x, dy = py - this.p.y;                    // how wrong our prediction was
      if (Math.abs(dx) + Math.abs(dy) > 0.5) this.corrections++;
      const ox = this.offset.x + dx, oy = this.offset.y + dy;          // keep the drawn position continuous
      this.offset = Math.hypot(ox, oy) > 90 ? { x: 0, y: 0 } : { x: ox, y: oy };   // too far off (respawn): snap
    }

    frame(dt) {
      const k = Math.pow(0.8, dt * 60);
      this.offset.x *= k; this.offset.y *= k;
    }

    get pos() { return this.p ? { x: this.p.x + this.offset.x, y: this.p.y + this.offset.y } : null; }
  }

  window.ElementPredictor = { Predictor };
})();
