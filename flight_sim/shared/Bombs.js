/**
 * Bombs - the ballistics of a free-falling bomb, shared by the browser (flight, bombsight, drawing) and the
 * Node server (which re-flies every reported bomb to check that the impact it was told about is possible).
 *
 * A bomb leaves the bay with the aircraft's velocity and then falls under gravity with quadratic drag
 * (F = 1/2 rho V^2 Cd A, rho falling off with altitude) in a wind. Integrated at a fixed 30 Hz whatever the frame
 * rate, so every browser and the server fly the same path from the same release state.
 *
 * Nothing aims for you: a release has a small scatter (seeded from the release, so everyone sees the same one) -
 * a few milliradians of velocity error, a few percent of drag error, a gust the sight does not know about - on
 * top of whatever the pilot's flying did. The bombsight's prediction uses the nominal bomb and the mean wind.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FSBombs = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // mass kg, diameter m, length m, drag coefficient (streamlined, subsonic), w = damage weapon, count = what fits the bay
  const BOMBS = {
    b500:  { id: 'b500',  name: '500 lb GP',            mass: 227,  diam: 0.27, len: 1.5, cd: 0.22, w: 'b500',  count: 24, spacing: 0.12 },
    b1000: { id: 'b1000', name: '1,000 lb GP',          mass: 454,  diam: 0.36, len: 2.1, cd: 0.21, w: 'b1000', count: 1,  spacing: 1 },       // the Warbird's centreline rack
    b2000: { id: 'b2000', name: '2,000 lb GP',          mass: 907,  diam: 0.46, len: 3.0, cd: 0.20, w: 'b2000', count: 6,  spacing: 0.30 },
    // an aerial torpedo (Mk 13 / Type 91): it falls like a bomb, and if it enters the sea gently it dives, levels off and RUNS straight and fast under the surface until it meets a ship's hull
    tp:    { id: 'tp',    name: 'aerial torpedo',      mass: 900,  diam: 0.56, len: 4.1, cd: 0.16, w: 'tp',    count: 1,  spacing: 1, torp: { runSpeed: 22, runMax: 1400, maxEntry: 115 } },
    grand: { id: 'grand', name: '22,000 lb Grand Slam', mass: 9979, diam: 1.17, len: 7.7, cd: 0.18, w: 'grand', count: 1,  spacing: 1 },
  };
  const BOMB_IDS = ['b500', 'b2000', 'grand'];          // what the B-29 can be loaded with (b1000 is the Warbird's single bomb)
  const DT = 1 / 30, ARM_TIME = 2.0, MAX_TIME = 150, G = 9.81;

  function rng(seed) { let s = (seed | 0) || 1; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function randn(r) { return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r()); }

  /**
   * env: { ground(x, z) -> terrain height (< 0.2 = sea), obstacle(x, y, z) -> name | null, floorMax: height above which nothing can be hit }.
   * opts: {type, p, v, wind: [wx, wz] mean wind (m/s), seed, scatter: false for the nominal bomb}
   */
  class Bomb {
    constructor({ type, p, v, wind = [0, 0], seed = 1, scatter = true, id = 0 }) {
      this.spec = BOMBS[type]; this.type = type; this.id = id; this.seed = seed;
      this.p = p.slice(); this.v = v.slice();
      this.wind = [wind[0], 0, wind[1]];
      this.cdK = 1; this.t = 0; this.acc = 0; this.done = null; this.armed = false;
      if (scatter) {
        const r = rng(seed), s = Math.hypot(...v);
        for (let a = 0; a < 3; a++) this.v[a] += randn(r) * 0.003 * s;                 // ~3 mrad of release error
        this.cdK = 1 + randn(r) * 0.04;
        this.wind[0] += randn(r) * 1.2; this.wind[2] += randn(r) * 1.2;                  // a gust the sight does not know about
      }
    }
    /** Advance by real time dt (fixed internal steps). Returns the impact {p, kind, t, armed, v} once, else null. */
    advance(dt, env) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= DT && !this.done && n++ < 40) { this.acc -= DT; this.done = this.step(DT, env); }
      return this.done;
    }
    step(h, env) {
      if (this.run) return this.stepRun(h, env);
      const S = this.spec, rho = 1.225 * Math.exp(-Math.max(0, this.p[1]) / 8500);
      const vr = [this.v[0] - this.wind[0], this.v[1], this.v[2] - this.wind[2]], sp = Math.hypot(...vr);
      const k = 0.5 * rho * S.cd * this.cdK * Math.PI * S.diam * S.diam / 4 * sp / S.mass;       // drag deceleration per unit relative velocity
      const a = [-k * vr[0], -k * vr[1] - G, -k * vr[2]];
      const p0 = this.p.slice();
      for (let i = 0; i < 3; i++) this.v[i] += a[i] * h;
      for (let i = 0; i < 3; i++) this.p[i] += this.v[i] * h;
      this.t += h;
      this.armed = this.t >= ARM_TIME;
      const hit = env.floorMax !== undefined && p0[1] > env.floorMax && this.p[1] > env.floorMax ? null : this.hit(p0, this.p, env);     // nothing to hit above the highest peak
      if (hit && S.torp && hit.kind === 'water') {                                      // a torpedo entering the sea: it runs if it did not hit too hard
        const sp = Math.hypot(...this.v), hs = Math.hypot(this.v[0], this.v[2]);
        if (sp > S.torp.maxEntry || hs < 20) { this.p = hit.p; return { p: hit.p, kind: 'water', broke: true, t: this.t, armed: false, v: this.v.slice() }; }     // too fast (it breaks up) or dropped from far too high / too slow
        this.p = [hit.p[0], -3, hit.p[2]]; this.run = { dx: this.v[0] / hs, dz: this.v[2] / hs, dist: 0 }; this.v = [this.run.dx * S.torp.runSpeed, 0, this.run.dz * S.torp.runSpeed];
        return null;
      }
      if (hit) { this.p = hit.p; return { p: hit.p, kind: hit.kind, t: this.t, armed: this.armed, v: this.v.slice() }; }
      if (this.t > MAX_TIME || this.p[1] < -500) return { p: [this.p[0], 0, this.p[2]], kind: 'water', t: this.t, armed: this.armed, v: this.v.slice() };
      return null;
    }
    /** The torpedo's run: straight and level 3 m down at run speed; ends on a hull (env.hull(x, z) is true inside a ship's waterline outline) or after runMax metres. */
    stepRun(h, env) {
      const T = this.spec.torp, R = this.run, d = T.runSpeed * h;
      this.p[0] += R.dx * d; this.p[2] += R.dz * d; this.p[1] = -3; R.dist += d; this.t += h; this.armed = true;
      if (env.hull && env.hull(this.p[0], this.p[2])) return { p: [this.p[0], -3, this.p[2]], kind: 'hull', t: this.t, armed: true, v: this.v.slice() };
      if (R.dist > T.runMax || this.t > MAX_TIME) return { p: [this.p[0], 0, this.p[2]], kind: 'water', spent: true, t: this.t, armed: true, v: this.v.slice() };
      return null;
    }
    /** First contact along p0 -> p1: the sea surface, the ground, or a solid object (tree, building). */
    hit(p0, p1, env) {
      const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]), n = Math.max(1, Math.ceil(len / 1.5));
      const at = f => [p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f, p0[2] + (p1[2] - p0[2]) * f];
      const test = q => {
        const g = env.ground(q[0], q[2]);
        if (g < 0.2) return q[1] < 0 ? 'water' : null;
        if (q[1] < g) return 'ground';
        return env.obstacle ? env.obstacle(q[0], q[1], q[2]) : null;
      };
      let lo = 0, kind = null;
      for (let i = 1; i <= n && !kind; i++) { kind = test(at(i / n)); if (!kind) lo = i / n; }
      if (!kind) return null;
      let hi = Math.min(1, lo + 1 / n);
      for (let i = 0; i < 10; i++) { const m = (lo + hi) / 2; if (test(at(m))) hi = m; else lo = m; }
      const q = at(hi), g = env.ground(q[0], q[2]);
      return { p: [q[0], kind === 'water' ? 0 : Math.max(q[1], g), q[2]], kind: kind === 'ground' || kind === 'water' ? kind : 'object' };
    }
  }

  /** The nominal flight of a bomb released now: impact point, time of flight, speed and the path (for drawing). */
  function predict(type, p, v, wind, env, pathStep = 0.5) {
    const b = new Bomb({ type, p, v, wind, scatter: false }), path = [p.slice()];
    let ev = null, next = pathStep;
    while (!ev) {
      ev = b.advance(DT, env);
      if (b.t >= next) { path.push(b.p.slice()); next += pathStep; }
      if (b.t > MAX_TIME) break;
    }
    return ev ? { p: ev.p, t: ev.t, kind: ev.kind, v: ev.v, path } : null;
  }

  /**
   * Server-side check: re-fly the release (with its scatter) over the shared terrain and accept the reported impact
   * if it lies on the flight path (a bomb that burst on a tree or building did so early on that path).
   */
  function plausible(rel, impact, env) {
    const b = new Bomb({ type: rel.type, p: rel.p, v: rel.v, wind: rel.wind, seed: rel.seed });
    const pts = [rel.p.slice()];
    let ev = null;
    while (!ev) { ev = b.advance(DT, env); pts.push(b.p.slice()); if (b.t > MAX_TIME) break; }
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {                      // distance from the impact to the path polyline
      const a = pts[i], c = pts[i + 1], dx = c[0] - a[0], dy = c[1] - a[1], dz = c[2] - a[2], l2 = dx * dx + dy * dy + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((impact[0] - a[0]) * dx + (impact[1] - a[1]) * dy + (impact[2] - a[2]) * dz) / l2));
      best = Math.min(best, Math.hypot(impact[0] - (a[0] + dx * t), impact[1] - (a[1] + dy * t), impact[2] - (a[2] + dz * t)));
    }
    return best < 40;
  }

  return { BOMBS, BOMB_IDS, Bomb, predict, plausible, DT, ARM_TIME };
});
