'use strict';
/**
 * Voxel Kart Racing - computer-controlled karts.
 *
 * A bot produces the same input keys a browser sends, so it drives through exactly the same
 * physics as a human. It follows the track's spline samples (the racing line) with its own
 * lane offset, looks further ahead the faster it goes, drifts through corners that are sharp
 * enough (releasing for a mini-turbo), takes shortcuts some of the time, and uses its items with
 * simple rules. Finished humans are driven by the same controller (autopilot, no items).
 */
const { C, KEY, ITEM, SURF } = require('../shared/Constants.js');
const TR = require('../shared/Tracks.js');

const LEVELS = {
  easy:   { cap: 0.84, look: 1.0, drift: 0.35, shortcut: 0.15, itemDelay: 220, wobble: 0.6, tier: 1 },
  normal: { cap: 0.93, look: 1.0, drift: 0.75, shortcut: 0.45, itemDelay: 120, wobble: 0.3, tier: 2 },
  hard:   { cap: 0.99, look: 1.1, drift: 1.0, shortcut: 0.8, itemDelay: 50, wobble: 0.1, tier: 3 },
};

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

class AIController {
  constructor(room, kart, level, autopilot = false) {
    this.room = room;
    this.k = kart;
    this.cfg = LEVELS[level] || LEVELS.normal;
    this.autopilot = autopilot;
    this.rng = room.rng;
    this.si = -1;                        // current sample on the chosen route
    this.lane = (this.rng() * 2 - 1) * 0.45;
    this.laneT = 0;
    this.takeBranch = new Map();         // branch index -> decision for this lap
    this.stuck = 0; this.reverseT = 0;
    this.itemWait = 0;
    this.lastLap = -1;
  }

  get T() { return this.room.track; }

  /** Next sample along the bot's chosen route (branches are decided once per lap). */
  nextOf(si) {
    const T = this.T, s = T.S[si];
    if (s.branch < 0) {
      for (let b = 0; b < T.branches.length; b++) {
        const br = T.branches[b];
        if (s.next === br.from && this.takeBranch.get(b)) return br.first;
      }
    }
    return s.next;
  }

  /** Keep this.si on the sample just ahead of the kart. */
  track() {
    const T = this.T, k = this.k;
    if (this.si < 0 || Math.hypot(T.S[this.si].x - k.x, T.S[this.si].z - k.z) > 16) {
      const g = TR.groundAt(T, k.x, k.z);
      this.si = g.seg >= 0 ? g.seg : T.S.reduce((b, s, i) => (Math.hypot(s.x - k.x, s.z - k.z) < Math.hypot(T.S[b].x - k.x, T.S[b].z - k.z) ? i : b), 0);
    }
    for (let n = 0; n < 12; n++) {
      const s = T.S[this.si];
      if ((k.x - s.x) * s.tx + (k.z - s.z) * s.tz < -1.5 && Math.hypot(k.x - s.x, k.z - s.z) > 2.5) break;   // still before this sample
      this.si = this.nextOf(this.si);
    }
  }

  /** Walk `dist` metres along the route from sample si. */
  ahead(si, dist) {
    let d = 0;
    while (d < dist) { d += this.T.S[si].len; si = this.nextOf(si); }
    return si;
  }

  input() {
    const k = this.k, T = this.T, cfg = this.cfg;
    if (k.rescue > 0) { this.si = -1; return 0; }
    if (k.lap !== this.lastLap) {               // new lap: new shortcut decisions
      this.lastLap = k.lap;
      T.branches.forEach((b, i) => this.takeBranch.set(i, this.rng() < (i === 0 ? cfg.shortcut : 0.5)));
    }
    this.track();
    const speed = Math.hypot(k.vx, k.vz);
    const edgy = T.def.outside === SURF.VOID || T.def.outside === SURF.LAVA;

    // progress watchdog: circling or wedged somewhere -> find the line again and back out
    if (this.room.phase === 'race' && (this.room.tick % 180) === 0) {
      if (this.watchProg !== undefined && k.prog - this.watchProg < 6 && k.spin <= 0) { this.si = -1; this.reverseT = 40; }
      this.watchProg = k.prog;
    }
    if (this.reverseT > 0) {
      this.reverseT--;
      this.track();
      const s = T.S[this.si], err = wrap(Math.atan2(s.x - k.x, s.z - k.z) - k.yaw);
      return KEY.DOWN | (err > 0 ? KEY.RIGHT : KEY.LEFT);   // reversing: steering is mirrored
    }

    // scan the route ahead: corner speed limits (with braking distance), jumps, gaps, narrow bits
    let si = this.si, d = 0, jumpAhead = false, gapAhead = false, narrow = 99, allowed = 99;
    const rateK = edgy ? 0.86 : 1.0;
    while (d < 55) {
      const s = T.S[si];
      if (d < 22) { if (s.flags & TR.F.JUMP) jumpAhead = true; if (s.flags & TR.F.GAP) gapAhead = true; narrow = Math.min(narrow, s.w); }
      const s2 = T.S[this.ahead(si, 8)];
      const dh = Math.abs(wrap(Math.atan2(s2.tx, s2.tz) - Math.atan2(s.tx, s.tz)));
      if (dh > 0.02 && !(s.flags & (TR.F.JUMP | TR.F.GAP))) {
        const R = 8 / dh;
        const vs = rateK * 2.35 * R / (1 + 0.027 * R) * (cfg.drift > 0.5 ? 1.08 : 1);
        allowed = Math.min(allowed, Math.sqrt(vs * vs + 2 * 22 * d));
      }
      d += s.len; si = this.nextOf(si);
    }

    // steering target: a short pure-pursuit point on our lane
    const look = 4 + speed * (edgy ? 0.28 : 0.34);
    const tgt = this.ahead(this.si, look), s1 = T.S[tgt];
    if ((this.laneT -= 1) <= 0) { this.laneT = 120 + this.rng() * 240; this.lane = Math.max(-0.5, Math.min(0.5, this.lane + (this.rng() - 0.5) * cfg.wobble)); }
    const laneW = Math.max(0, s1.w / 2 - (edgy ? 3 : 2.2)) * (narrow < 9 || jumpAhead || gapAhead ? 0 : 1);
    const tx = s1.x + s1.tz * this.lane * laneW, tz = s1.z - s1.tx * this.lane * laneW;
    const err = wrap(Math.atan2(tx - k.x, tz - k.z) - k.yaw);
    const far = T.S[this.ahead(this.si, 24)], s0 = T.S[this.si];
    const turnAhead = wrap(Math.atan2(far.tx, far.tz) - Math.atan2(s0.tx, s0.tz));

    let keys = 0;
    const dead = 0.03;
    if (err > dead) keys |= KEY.LEFT; else if (err < -dead) keys |= KEY.RIGHT;
    // throttle: respect the corner limit; the target behind us means turn hard on the spot
    const over = speed - allowed * (k.boost > 0 ? 1.1 : 1);
    if (Math.abs(err) > 1.3) keys |= speed > 9 ? KEY.DOWN : KEY.UP;
    else if (jumpAhead || gapAhead) keys |= KEY.UP;
    else if (over > 4) keys |= KEY.DOWN;
    else if (over < 0.5) keys |= KEY.UP;

    // drifting: commit into sharp corners, release once the corner opens up (or the sparks are hot enough)
    if (k.drift) {
      const tier = k.charge >= C.DRIFT_TIERS[cfg.tier - 1];
      if (!(Math.abs(turnAhead) < 0.25 || (tier && Math.abs(err) < 0.15) || Math.abs(err) > 0.9 || jumpAhead || gapAhead)) {
        keys |= KEY.DRIFT | KEY.UP;
        keys &= ~(KEY.LEFT | KEY.RIGHT | KEY.DOWN);
        if (err < -0.08) keys |= KEY.RIGHT; else if (err > 0.08) keys |= KEY.LEFT;
      }
    } else if (Math.abs(turnAhead) > 0.7 && speed > 15 && !jumpAhead && !gapAhead && narrow > 8 && k.ground && Math.abs(err) < 0.5 &&
               this.rng() < cfg.drift * (edgy ? 0.5 : 1)) {
      keys = KEY.UP | KEY.DRIFT | (turnAhead < 0 ? KEY.RIGHT : KEY.LEFT);
    }

    if (!this.autopilot) keys |= this.useItem(speed, allowed);
    return keys;
  }

  /** Item rules: fire at karts in front, drop bananas on chasers, boost on straights. */
  useItem(speed, allowed) {
    const k = this.k;
    if (!k.item || this.room.tick < k.itemReady) { this.itemWait = 0; return 0; }
    this.itemWait++;
    if (this.itemWait < this.cfg.itemDelay * (0.5 + this.rng())) return 0;
    const others = [...this.room.karts.values()].filter(o => o !== k && !o.finished);
    const fx = Math.sin(k.yaw), fz = Math.cos(k.yaw);
    const ahead = others.some(o => { const dx = o.x - k.x, dz = o.z - k.z, l = Math.hypot(dx, dz); return l < 35 && (dx * fx + dz * fz) / l > 0.96; });
    const behind = others.some(o => { const dx = o.x - k.x, dz = o.z - k.z, l = Math.hypot(dx, dz); return l < 16 && (dx * fx + dz * fz) / l < -0.7; });
    let use = false;
    switch (k.item) {
      case ITEM.SHROOM: case ITEM.TRIPLE: use = allowed > C.MAX_SPEED * C.BOOST_SPEED + 2 && speed > 12; break;   // only with a long straight ahead
      case ITEM.GREEN: use = ahead || this.itemWait > 600; break;
      case ITEM.RED: use = k.rank > 1; break;
      case ITEM.BANANA: use = behind || this.itemWait > 700; break;
      case ITEM.LIGHTNING: use = k.rank > 2 || this.itemWait > 400; break;
    }
    // KEY.ITEM is edge triggered: release it every other tick
    if (use && !(k.keys & KEY.ITEM)) { this.itemWait = 0; return KEY.ITEM; }
    return 0;
  }
}

module.exports = { AIController, LEVELS };
