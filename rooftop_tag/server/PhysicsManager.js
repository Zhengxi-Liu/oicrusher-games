'use strict';
/**
 * Rooftop Tag - server-side physics: the collision world, every runner's movement step,
 * the void, position history and lag-compensated hitscan.
 *
 * Runner movement is the shared, deterministic character controller in shared/Movement.js
 * (boxes, ramps, jump pads, slides, wall runs, grappling hook) instead of a general rigid-body
 * engine: the browser runs the same code to predict its own runner, so prediction and the server
 * agree to the millimetre, and a whole room costs a few hundredths of a millisecond per tick.
 */
const { C } = require('../shared/Constants.js');
const M = require('../shared/Movement.js');

class PhysicsManager {
  constructor(map) {
    this.map = map;
    this.world = M.makeWorld(map);
  }

  /** Apply one input to a runner. Returns the movement events of shared stepMove. */
  step(p, inp) { return M.stepMove(p, inp, this.world); }

  fellIntoVoid(p) { return p.y < C.VOID_Y; }

  /** Is there floor under (x, y, z) within `depth` metres? (dropped flags over the void go home) */
  groundBelow(x, y, z, depth = 3) {
    const h = M.raycast(this.world, x, y + 0.5, z, 0, -1, 0, depth + 0.5);
    return h.box ? y + 0.5 - h.t : null;
  }

  record(p, tick) {
    p.hist.push([tick, p.x, p.y, p.z, p.crouch ? 1 : 0]);
    if (p.hist.length > 40) p.hist.shift();
  }

  /** Where was runner q at (fractional) server tick t? -> [x, y, z, crouch] */
  posAt(q, t) {
    const h = q.hist;
    if (!h.length || t >= h[h.length - 1][0]) return [q.x, q.y, q.z, q.crouch ? 1 : 0];
    for (let i = h.length - 1; i > 0; i--) {
      if (h[i - 1][0] <= t) {
        const a = h[i - 1], b = h[i], f = (t - a[0]) / (b[0] - a[0] || 1);
        return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f, b[4]];
      }
    }
    return [h[0][1], h[0][2], h[0][3], h[0][4]];
  }

  /**
   * Hitscan from `o` along unit `d`, targets rewound to tick `when`.
   * `canHit(q)` filters (alive enemies). Returns {t, player?}.
   */
  trace(o, d, maxT, when, players, canHit) {
    const wall = M.raycast(this.world, o[0], o[1], o[2], d[0], d[1], d[2], maxT);
    let best = { t: wall.t, player: null };
    for (const q of players) {
      if (!canHit(q)) continue;
      const [x, y, z, cr] = this.posAt(q, when);
      const t = M.rayBox(o[0], o[1], o[2], d[0], d[1], d[2], M.hitbox(x, y, z, cr), best.t);
      if (t < best.t) best = { t, player: q };
    }
    return best;
  }
}

module.exports = { PhysicsManager };
