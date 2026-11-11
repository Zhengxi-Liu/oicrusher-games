/**
 * Simulation drivers for the browser.
 *  - LocalEngine:  practice / attract mode, a plain 60 Hz simulation with bots.
 *  - OnlineEngine: client-side prediction. The local timeline runs a few ticks AHEAD of the
 *    server so inputs arrive just in time. Every authoritative snapshot is reconciled by
 *    rolling back to it and replaying our own unacknowledged inputs; the opponent is
 *    predicted to keep holding their last known buttons. Position corrections are blended
 *    out visually so a misprediction never warps a fencer.
 */
(function () {
  'use strict';
  const S = window.FencingSim;

  class LocalEngine {
    constructor(bots) {
      this.state = S.create();
      this.bots = bots;            // [bot|null, bot|null]; null seat = human
      this.past = [];              // recent states, so bots react with a delay
      this.smooth = [0, 0];
    }
    get view() { return this.state; }
    tick(humanBits) {
      this.past.push(S.clone(this.state));
      if (this.past.length > 40) this.past.shift();
      const bits = this.bots.map((b, p) => (b ? b.decide(this.past, this.state) : humanBits));
      S.step(this.state, bits);
    }
    frame() {}
  }

  class OnlineEngine {
    constructor(side, send) {
      this.me = side;
      this.send = send;
      this.state = S.create();
      this.tick = 0;               // our predicted "present"
      this.inputs = new Map();     // tick -> our bits
      this.oppBits = 0;            // opponent's buttons at the last snapshot tick
      this.oppKnown = new Map();   // opponent inputs the server already has for later ticks
      this.serverTick = 0;
      this.adv = 3;                // how early our inputs reach the server, in ticks
      this.smooth = [0, 0];        // visual position offsets (px), decay to 0
      this.corrections = 0;
    }
    get view() { return this.state; }

    /** Start `lead` ticks ahead of the server's current tick. */
    begin(serverTick, lead) {
      this.state = S.create();
      this.serverTick = serverTick;
      this.tick = 0;
      while (this.tick < serverTick + lead) this.advance(0, false);
    }

    bitsAt(k) {
      if (this.inputs.has(k)) return this.inputs.get(k);
      for (let j = k - 1; j >= k - 30; j--) if (this.inputs.has(j)) return this.inputs.get(j);
      return 0;
    }

    /** Opponent buttons for tick k: exact if the server forwarded them, else held from the last known. */
    oppAt(k) {
      if (this.oppKnown.has(k)) return this.oppKnown.get(k);
      let best = this.serverTick, bits = this.oppBits;
      for (const [t, b] of this.oppKnown) if (t < k && t > best) { best = t; bits = b; }
      return bits;
    }

    advance(bits, send = true) {
      this.tick++;
      this.inputs.set(this.tick, bits);
      if (send) this.send({ t: 'i', k: this.tick, b: bits });
      const opp = this.oppAt(this.tick);
      S.step(this.state, this.me === 0 ? [bits, opp] : [opp, bits]);
    }

    tickLocal(bits) { this.advance(bits, true); }

    onSnapshot(wire, oppBits, future, adv) {
      const base = S.decode(wire);
      if (base.tick <= this.serverTick) return;
      this.serverTick = base.tick;
      this.oppBits = oppBits;
      this.oppKnown = new Map();
      for (let i = 0; i + 1 < future.length; i += 2) this.oppKnown.set(base.tick + future[i], future[i + 1]);
      this.adv = adv;
      if (base.tick >= this.tick || this.tick - base.tick > 90) {
        // We fell behind the server (tab was hidden, huge lag spike): jump to it.
        this.state = base;
        this.tick = base.tick;
        this.smooth = [0, 0];
        return;
      }
      const before = [this.state.f[0].x, this.state.f[1].x];
      const s = base;
      for (let k = base.tick + 1; k <= this.tick; k++) {
        const mine = this.bitsAt(k), opp = this.oppAt(k);
        S.step(s, this.me === 0 ? [mine, opp] : [opp, mine]);
      }
      for (let p = 0; p < 2; p++) {
        const d = before[p] - s.f[p].x;
        if (d) this.corrections++;
        this.smooth[p] = Math.abs(this.smooth[p] + d) > 80 ? 0 : this.smooth[p] + d;
      }
      this.state = s;
      for (const k of this.inputs.keys()) { if (k < base.tick - 30) this.inputs.delete(k); else break; }
    }

    /**
     * Tick-rate nudge: keep our inputs arriving 1-3 ticks before the server needs them. A small
     * lead keeps the opponent's actions visible early; the server's rewind covers stragglers.
     */
    rateFactor() {
      if (this.adv < 1) return 0.94;
      if (this.adv > 3) return 1.06;
      return 1;
    }

    frame(dt) {
      const k = Math.pow(0.72, dt * 60);
      this.smooth[0] *= k; this.smooth[1] *= k;
    }
  }

  window.FencingEngine = { LocalEngine, OnlineEngine };
})();
