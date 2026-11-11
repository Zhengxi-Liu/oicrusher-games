'use strict';
/**
 * Server-side practice opponent. It produces the same input packets a browser would
 * ({m, a, f, d}) so it goes through exactly the same simulation path as a human.
 */
const { C, MOVE } = require('../shared/Constants.js');
const { segmentBlocked } = require('./PhysicsEngine.js');

// dodge: chance to notice each incoming bolt at all; react: how many ticks ahead it looks
const LEVELS = {
  easy:   { aimErr: 0.32, lead: 0,   react: 8,  dodge: 0.3,  dashP: 0.1, fireP: 0.4,  keep: [320, 480] },
  normal: { aimErr: 0.12, lead: 0.7, react: 16, dodge: 0.65, dashP: 0.4, fireP: 0.75, keep: [280, 440] },
  hard:   { aimErr: 0.03, lead: 1.0, react: 26, dodge: 0.95, dashP: 0.9, fireP: 1.0,  keep: [280, 420] },
};
const PREFER = ['split', 'homing', 'rapid', 'power', 'bounce', 'chain', 'frost', 'vamp', 'shield', 'swift', 'velocity', 'heavy', 'vital', 'pierce', 'flame'];

class Bot {
  constructor(room, side, level) {
    this.room = room;
    this.side = side;
    this.cfg = LEVELS[level] || LEVELS.normal;
    this.rng = room.rng;
    this.strafe = 1;
    this.strafeT = 0;
    this.err = 0;
    this.errT = 0;
    this.prev = null;
    this.pickAt = 0;
    this.noticed = new Map();     // bolt id -> did we notice it
    this.blind = 0;               // ticks without line of sight
    this.goal = null;             // a spot with line of sight to walk to
  }

  /** Random reachable spot from which the opponent is visible (keeps the bot from camping behind cover). */
  findGoal(op, st) {
    const room = this.room, R = this.rng;
    for (let n = 0; n < 24; n++) {
      const x = 60 + R() * (C.ARENA_W - 120), y = 60 + R() * (C.ARENA_H - 120);
      const d = Math.hypot(op.x - x, op.y - y);
      if (d < 220 || d > 520) continue;
      if (room.covers.some(c => c.hp > 0 && Math.abs(x - c.x) < c.w / 2 + C.PLAYER_R + 6 && Math.abs(y - c.y) < c.h / 2 + C.PLAYER_R + 6)) continue;
      if (!segmentBlocked(x, y, op.x, op.y, room.covers, st.radius)) return { x, y, t: 180 };
    }
    return null;
  }

  bits(vx, vy) {
    const l = Math.hypot(vx, vy);
    if (l < 0.15) return 0;
    let m = 0;
    if (vx > 0.38 * l) m |= MOVE.RIGHT; else if (vx < -0.38 * l) m |= MOVE.LEFT;
    if (vy > 0.38 * l) m |= MOVE.DOWN; else if (vy < -0.38 * l) m |= MOVE.UP;
    return m;
  }

  input() {
    const room = this.room, me = room.P[this.side], op = room.P[1 - this.side], cfg = this.cfg, R = this.rng;
    const opVel = this.prev ? { x: op.x - this.prev.x, y: op.y - this.prev.y } : { x: 0, y: 0 };
    this.prev = { x: op.x, y: op.y };
    const dx = op.x - me.x, dy = op.y - me.y, dist = Math.hypot(dx, dy) || 1;
    const st = room.st[this.side];

    // aim with lead and a slowly wandering error
    if (--this.errT <= 0) { this.err = (R() * 2 - 1) * cfg.aimErr; this.errT = 20 + R() * 30; }
    const t = (dist / st.boltSpeed) * cfg.lead;
    const aim = Math.atan2(op.y + opVel.y * t - me.y, op.x + opVel.x * t - me.x) + this.err;
    if (room.phase !== 'combat') return { m: 0, a: aim, f: 0, d: 0 };

    // desired movement: hold a distance band, strafe, stay off the walls
    let vx = 0, vy = 0;
    const ux = dx / dist, uy = dy / dist;
    if (dist > cfg.keep[1]) { vx += ux; vy += uy; } else if (dist < cfg.keep[0]) { vx -= ux; vy -= uy; }
    if (--this.strafeT <= 0) { this.strafe = R() < 0.5 ? -1 : 1; this.strafeT = 45 + R() * 70; }
    vx += -uy * this.strafe * 0.9; vy += ux * this.strafe * 0.9;
    const margin = 90;
    if (me.x < margin) vx += 1.2; if (me.x > C.ARENA_W - margin) vx -= 1.2;
    if (me.y < margin) vy += 1.2; if (me.y > C.ARENA_H - margin) vy -= 1.2;

    const los = !segmentBlocked(me.x, me.y, op.x, op.y, room.covers, st.radius);
    this.blind = los ? 0 : this.blind + 1;
    if (this.blind > 60 && !this.goal) this.goal = this.findGoal(op, st);
    if (this.goal) {
      const gx = this.goal.x - me.x, gy = this.goal.y - me.y, gl = Math.hypot(gx, gy);
      if (gl < 20 || --this.goal.t <= 0 || los) this.goal = null;
      else { vx = gx / gl * 1.6 + vx * 0.2; vy = gy / gl * 1.6 + vy * 0.2; }
    }
    if (Math.hypot(vx, vy) < 0.3) { this.strafe = -this.strafe; vx += -uy * this.strafe; vy += ux * this.strafe; }   // forces cancelled out

    // dodge the most urgent incoming bolt
    let dash = 0, threat = null, best = Infinity;
    for (const b of room.proj) {
      if (b.owner === this.side) continue;
      if (!this.noticed.has(b.id)) this.noticed.set(b.id, R() < cfg.dodge);
      if (!this.noticed.get(b.id)) continue;
      const rx = me.x - b.x, ry = me.y - b.y, vv = b.vx * b.vx + b.vy * b.vy;
      const tc = Math.max(0, (rx * b.vx + ry * b.vy) / vv);
      if (tc > cfg.react) continue;
      const cx = rx - b.vx * tc, cy = ry - b.vy * tc;
      const miss = Math.hypot(cx, cy);
      if (miss < C.PLAYER_R + b.r + 10 && tc < best) { best = tc; threat = { b, cx, cy }; }
    }
    if (threat) {
      const l = Math.hypot(threat.cx, threat.cy) || 1;
      let ex = threat.cx / l, ey = threat.cy / l;
      if (Math.hypot(threat.cx, threat.cy) < 1) { ex = -threat.b.vy; ey = threat.b.vx; }
      vx = ex * 2 + vx * 0.3; vy = ey * 2 + vy * 0.3;
      if (best < 9 && me.dashCd <= 0 && R() < cfg.dashP) dash = 1;
    }

    if (this.noticed.size > 400) this.noticed = new Map([...this.noticed].slice(-200));
    const fire = (los || st.bounce || st.chainDmg || st.pierce || st.homing) && dist < 950 && R() < cfg.fireP ? 1 : 0;
    return { m: this.bits(vx, vy), a: aim, f: fire, d: dash };
  }

  /** Called every tick during a draft; picks after a short "thinking" delay. */
  draftTick(offers) {
    if (!this.pickAt) this.pickAt = this.room.tick + 60 + Math.floor(this.rng() * 120);
    if (this.room.tick < this.pickAt) return null;
    this.pickAt = 0;
    return [...offers].sort((a, b) => PREFER.indexOf(a) - PREFER.indexOf(b))[this.rng() < 0.7 ? 0 : Math.floor(this.rng() * offers.length)];
  }
}

module.exports = { Bot };
