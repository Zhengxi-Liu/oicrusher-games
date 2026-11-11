'use strict';
/**
 * One authoritative duel. The server owns the only real timeline:
 *  - every tick it steps the shared simulation with each player's input for that tick;
 *  - a missing input is predicted by repeating that player's last known buttons;
 *  - an input that arrives late (for a tick already simulated, at most MAX_REWIND ago)
 *    rewinds to that tick and re-simulates forward. That is the lag compensation: a parry
 *    pressed in time on a player's own screen still counts if the packet is a little late.
 * Results become final only once they are older than the rewind window.
 */
const Sim = require('../Shared/sim.js');

const MAX_REWIND = 8;              // ticks (~133 ms) of server-side rollback
const KEEP = MAX_REWIND + 4;       // history kept per tick
const MAX_LEAD = 120;              // inputs further than 2 s in the future are bogus

class Room {
  constructor(id, players, hooks) {
    this.id = id;
    this.players = players;        // [client, client]; index = fencer side
    this.hooks = hooks;            // { send(client, msg), onOver(room, result), onClose(room) }
    this.state = Sim.create();
    this.inputs = [new Map(), new Map()];
    this.lastRecv = [0, 0];
    this.lastBits = [0, 0];
    this.used = new Map();         // tick -> bits actually used for that tick
    this.history = new Map([[0, Sim.clone(this.state)]]);
    this.rewindFrom = Infinity;
    this.stats = { rewinds: 0, lateDropped: 0 };
    this.startedAt = Date.now();
    this.overAt = 0;
    this.closed = false;
  }

  get tick() { return this.state.tick; }

  // ---- generic lobby interface (game_server/Lobby.js)
  startInfo() { return { k: this.tick }; }
  onMessage(side, m) { if (m.t === 'i') this.onInput(side, m.k, m.b | 0); }
  isOver() { return this.state.phase === 'over'; }

  bitsFor(p, k) {
    const m = this.inputs[p];
    if (m.has(k)) return m.get(k);
    for (let j = k - 1; j >= 0 && j >= k - 90; j--) if (m.has(j)) return m.get(j);
    return 0;
  }

  onInput(p, k, bits) {
    if (this.closed || !Number.isInteger(k)) return;
    bits &= 31;
    const now = this.tick;
    if (k <= this.lastRecv[p] || k > now + MAX_LEAD) return;
    this.lastRecv[p] = k;
    this.lastBits[p] = bits;
    if (k > now) { this.inputs[p].set(k, bits); return; }
    if (k > now - MAX_REWIND) {
      this.inputs[p].set(k, bits);
      const used = this.used.get(k);
      if (!used || used[p] !== bits) this.rewindFrom = Math.min(this.rewindFrom, k);
      return;
    }
    // Too late to rewind: it takes effect on the next tick instead.
    this.stats.lateDropped++;
    if (!this.inputs[p].has(now + 1)) this.inputs[p].set(now + 1, bits);
  }

  rewind() {
    const from = this.rewindFrom;
    this.rewindFrom = Infinity;
    const base = this.history.get(from - 1);
    if (!base) return;
    const s = Sim.clone(base);
    for (let k = from; k <= this.tick; k++) {
      const bits = [this.bitsFor(0, k), this.bitsFor(1, k)];
      this.used.set(k, bits);
      Sim.step(s, bits);
      this.history.set(k, Sim.clone(s));
    }
    this.state = s;
    this.stats.rewinds++;
  }

  update() {
    if (this.closed) return;
    if (this.rewindFrom <= this.tick) this.rewind();

    const k = this.tick + 1;
    const bits = [this.bitsFor(0, k), this.bitsFor(1, k)];
    this.used.set(k, bits);
    Sim.step(this.state, bits);
    this.history.set(k, Sim.clone(this.state));
    this.history.delete(k - KEEP);
    this.used.delete(k - KEEP);
    if (k % 60 === 0) {
      for (const m of this.inputs) for (const t of m.keys()) { if (t < k - 120) m.delete(t); else break; }
    }

    // Each client gets the state, the opponent's buttons at this tick, and the opponent's inputs
    // the server already holds for upcoming ticks (clients run ahead, so these arrive early):
    // the client replays them at their exact ticks instead of guessing.
    const wire = Sim.encode(this.state);
    for (let p = 0; p < 2; p++) {
      const o = 1 - p, future = [];
      for (let t = k + 1; t <= this.lastRecv[o] && future.length < 32; t++) {
        if (this.inputs[o].has(t)) future.push(t - k, this.inputs[o].get(t));
      }
      this.hooks.send(this.players[p], { t: 's', s: wire, ob: bits[o], of: future, adv: this.lastRecv[p] - k });
    }

    if (this.state.phase === 'over') {
      if (!this.overAt) this.overAt = k;
      else if (k - this.overAt === MAX_REWIND + 1) {     // can no longer be rolled back
        this.hooks.onOver(this, {
          winner: this.state.winner,
          score: this.state.score.slice(),
          duration: Math.round((Date.now() - this.startedAt) / 1000),
          forfeit: false,
        });
      }
    } else {
      this.overAt = 0;
    }
  }

  /** A player left or disconnected. Returns the result if the match was still being decided. */
  forfeit(p) {
    if (this.closed) return null;
    this.closed = true;
    const decided = this.state.phase === 'over' && this.overAt && this.tick - this.overAt > MAX_REWIND;
    if (decided) return null;
    return {
      winner: 1 - p,
      score: this.state.score.slice(),
      duration: Math.round((Date.now() - this.startedAt) / 1000),
      forfeit: true,
    };
  }
}

module.exports = { Room, MAX_REWIND };
