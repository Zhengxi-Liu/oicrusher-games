'use strict';
/**
 * Server-side deathmatch bot. It produces the same input packets a browser sends
 * ({m, yaw, pitch, b, w, rt}), so it moves and shoots through exactly the same code as a human.
 * Navigation: a waypoint graph whose links are validated against the collision world at start-up.
 */
const { C, MOVE, BTN, WEAPONS, SLOT } = require('../shared/Constants.js');
const M = require('../shared/Movement.js');

const LEVELS = {
  easy:   { aimErr: 0.09, turn: 0.07, react: 30, burst: 0.55 },
  normal: { aimErr: 0.045, turn: 0.12, react: 18, burst: 0.75 },
  hard:   { aimErr: 0.02, turn: 0.2, react: 10, burst: 0.92 },
};

// ---------- navigation graphs (built once per map, shared by all bots on that map)
const GRAPHS = new Map();
function graphFor(map) {
  if (!GRAPHS.has(map.id)) GRAPHS.set(map.id, buildGraph(M.makeWorld(map.BOXES, []), map.WAYPOINTS));
  return GRAPHS.get(map.id);
}
function groundAt(world, x, y, z) {
  const h = M.raycast(world, x, y + 1.2, z, 0, -1, 0, 4);
  return h.box ? y + 1.2 - h.t : null;
}
function walkable(world, a, b) {
  const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.4));
  let prevG = a[1];
  for (let i = 1; i <= n; i++) {
    const t = i / n, x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t, y = a[1] + (b[1] - a[1]) * t;
    const g = groundAt(world, x, Math.max(y, prevG), z);
    if (g === null || Math.abs(g - prevG) > 0.6 || Math.abs(g - y) > 1.2) return false;
    for (const hgt of [0.65, 1.5]) {                      // wall between the two samples? (above a stair riser)
      const px = a[0] + (b[0] - a[0]) * (i - 1) / n, pz = a[2] + (b[2] - a[2]) * (i - 1) / n;
      const dx = x - px, dz = z - pz, l = Math.hypot(dx, dz), base = Math.max(prevG, g);
      if (l > 0 && M.raycast(world, px, base + hgt, pz, dx / l, 0, dz / l, l + C.PLAYER_R).t < l + C.PLAYER_R) return false;
    }
    prevG = g;
  }
  return true;
}
/** Snap each waypoint onto the floor under it, drop any that sit inside a solid, then link walkable pairs. */
function buildGraph(world, waypoints) {
  const nodes = [];
  for (const [x, y, z] of waypoints) {
    const g = groundAt(world, x, y + 0.3, z);
    if (g === null || Math.abs(g - y) > 0.6) continue;              // landed on top of a crate or pipe: drop it
    if (M.blocked({ x, y: g + 0.02, z }, world)) continue;
    nodes.push([x, g, z]);
  }
  const links = nodes.map(() => []);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      if (Math.hypot(a[0] - b[0], a[2] - b[2]) > 13) continue;
      if (walkable(world, a, b) && walkable(world, b, a)) { links[i].push(j); links[j].push(i); }
    }
  }
  return { nodes, links };
}
function path(graph, from, to) {
  const prev = new Array(graph.nodes.length).fill(-1), seen = new Set([from]), q = [from];
  while (q.length) {
    const n = q.shift();
    if (n === to) break;
    for (const m of graph.links[n]) if (!seen.has(m)) { seen.add(m); prev[m] = n; q.push(m); }
  }
  if (from !== to && prev[to] < 0) return null;
  const out = [];
  for (let n = to; n !== -1 && n !== from; n = prev[n]) out.unshift(n);
  return out;
}

const PREF = [9, 10, 8, 7, 5, 4, 3, 6, 2, 1];     // preferred weapons, best first (rifles over the rest)

class Bot {
  constructor(room, p, level) {
    this.room = room;
    this.p = p;
    this.cfg = LEVELS[level] || LEVELS.normal;
    this.rng = room.rng;
    this.route = [];
    this.target = null;
    this.seenAt = 0;
    this.strafe = 1;
    this.strafeT = 0;
    this.stuck = 0;
    this.last = { x: p.x, z: p.z };
    this.yaw = p.yaw; this.pitch = 0;
    this.errYaw = 0; this.errPitch = 0; this.errT = 0;
    this.nade = 0; this.crouchT = 0; this.crouchWant = false;
  }

  nearestNode() {
    const p = this.p;
    let best = 0, bd = Infinity;
    this.room.graph.nodes.forEach((n, i) => { const d = Math.hypot(n[0] - p.x, n[2] - p.z) + Math.abs(n[1] - p.y) * 3; if (d < bd) { bd = d; best = i; } });
    return best;
  }

  visible(q) {
    const p = this.p, ex = p.x, ey = p.y + M.eyeOf(p), ez = p.z;
    const tx = q.x - ex, ty = q.y + 1.2 - ey, tz = q.z - ez, d = Math.hypot(tx, ty, tz);
    if (d > 40) return false;
    return M.raycast(this.room.world, ex, ey, ez, tx / d, ty / d, tz / d, d).t >= d - 0.05;
  }

  /** Lower is better; used to decide whether to swap the long gun for one lying on the floor. */
  rank(w) { const i = PREF.indexOf(w); return i < 0 ? 99 : i; }

  pickWeapon(dist) {
    const p = this.p;
    const has = w => M.owns(p, w) && (WEAPONS[w].melee || (p.mag[w] | 0) + (p.res[w] | 0) > 0);
    if (dist < 2 && !has(5)) return 1;
    for (const w of PREF) {
      if (!has(w)) continue;
      if (w === 7 && dist < 6) continue;           // no point-blank rockets
      if (w === 8 && dist < 9) continue;           // the AWP is for long range
      if (w === 5 && dist > 14) continue;
      if (w === 1 && dist > 2) continue;
      return w;
    }
    return 2;
  }

  turnTo(yaw, pitch) {
    const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
    const dy = wrap(yaw - this.yaw), t = this.cfg.turn;
    this.yaw = wrap(this.yaw + Math.max(-t, Math.min(t, dy)));
    this.pitch += Math.max(-t, Math.min(t, pitch - this.pitch));
    return Math.abs(dy) + Math.abs(pitch - this.pitch);
  }

  /** Move bits that push toward world direction (dx, dz) given the current facing. */
  moveToward(dx, dz) {
    const l = Math.hypot(dx, dz);
    if (l < 0.01) return 0;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const f = (-sin * dx - cos * dz) / l, s = (cos * dx - sin * dz) / l;
    let m = 0;
    if (f > 0.38) m |= MOVE.FWD; else if (f < -0.38) m |= MOVE.BACK;
    if (s > 0.38) m |= MOVE.RIGHT; else if (s < -0.38) m |= MOVE.LEFT;
    return m;
  }

  input() {
    const room = this.room, p = this.p, R = this.rng, cfg = this.cfg;
    const inp = { m: 0, yaw: this.yaw, pitch: this.pitch, b: 0, w: 0, rt: room.tick };
    if (!p.alive || room.phase !== 'play' || (room.mode === 'team' && room.rphase === 'freeze')) return inp;

    // enemy selection: nearest visible
    let enemy = null, ed = Infinity;
    for (const q of room.players.values()) {
      if (q === p || !q.alive || (room.mode === 'team' && q.team === p.team)) continue;
      const d = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
      if (d < ed && this.visible(q)) { ed = d; enemy = q; }
    }
    if (enemy !== this.target) { this.target = enemy; this.seenAt = room.tick; }

    // moving: follow the route, refresh it when finished
    if (!this.route.length) {
      const from = this.nearestNode();
      let goal = Math.floor(R() * this.room.graph.nodes.length);
      if (room.mode === 'team' && R() < 0.7) {                       // hunt: head for the enemy half of the map
        const sp = room.map.TEAM_SPAWNS[1 - p.team], cz = sp.reduce((a, s) => a + s.z, 0) / sp.length, cx = sp.reduce((a, s) => a + s.x, 0) / sp.length;
        const tz = cz * (0.2 + R() * 0.8), tx = cx + (R() - 0.5) * 30;
        let bd = Infinity; this.room.graph.nodes.forEach((n, i) => { const d = Math.hypot(n[0] - tx, n[2] - tz); if (d < bd) { bd = d; goal = i; } });
      }
      const want = room.pickups.find(k => k.available && k.def.type === 'weapon' && (M.canTake(p, k.def.w) === 'new' || (WEAPONS[k.def.w].slot === SLOT.PRIMARY && this.rank(k.def.w) < this.rank(M.inSlot(p, SLOT.PRIMARY)))));
      if (want && R() < 0.6) { let bd = Infinity; this.room.graph.nodes.forEach((n, i) => { const d = Math.hypot(n[0] - want.def.pos[0], n[2] - want.def.pos[2]); if (d < bd) { bd = d; goal = i; } }); }
      this.route = path(this.room.graph, from, goal) || [];
      if (!this.route.length) this.route = [from];
    }
    const node = this.room.graph.nodes[this.route[0]];
    let mdx = node[0] - p.x, mdz = node[2] - p.z;
    if (Math.hypot(mdx, mdz) < 0.8) this.route.shift();

    if (enemy) {
      const ex = enemy.x - p.x, ez = enemy.z - p.z, ey = enemy.y + (enemy.crouch ? 0.75 : 1.1) - (p.y + M.eyeOf(p));
      if (--this.errT <= 0) { this.errYaw = (R() - 0.5) * 2 * cfg.aimErr; this.errPitch = (R() - 0.5) * 2 * cfg.aimErr; this.errT = 20 + R() * 25; }
      const dist = Math.hypot(ex, ez);
      const lob = p.cur === 11 ? 0.2 + dist * 0.004 : 0;                 // grenades are thrown in an arc
      const off = this.turnTo(Math.atan2(-ex, -ez) + this.errYaw, Math.atan2(ey, dist) + this.errPitch + lob);
      inp.w = this.pickWeapon(dist);
      // now and then lob an HE grenade at someone at mid range
      if (M.owns(p, 11) && dist > 9 && dist < 26 && !this.nade && R() < 0.03) this.nade = 60;
      if (this.nade > 0) { this.nade--; inp.w = 11; if (p.cur !== 11 && this.nade < 5) this.nade = 0; }
      if (p.cur === 8) inp.b |= BTN.SCOPE;
      const steady = p.cur !== 8 || Math.hypot(p.vx, p.vz) < 1;      // snipers stop to shoot
      const def = WEAPONS[p.cur];
      const settled = !def.sprayAdd || dist < 8 || (p.spray || 0) < def.sprayAdd * 3;   // rifles: short bursts at range, like CS bots
      if (inp.w === p.cur && room.tick - this.seenAt > cfg.react && off < (p.cur === 8 ? 0.05 : 0.12) && steady && settled && R() < cfg.burst) inp.b |= BTN.FIRE;
      if (p.cur === 11 && this.nade > 0 && p.switchT === 0 && off < 0.3) { inp.b |= BTN.FIRE; this.nade = 0; }
      if (--this.crouchT <= 0) { this.crouchWant = dist > 14 && (p.cur === 9 || p.cur === 10 || p.cur === 8) && R() < 0.5; this.crouchT = 40 + R() * 60; }
      if (--this.strafeT <= 0) { this.strafe = R() < 0.5 ? -1 : 1; this.strafeT = 30 + R() * 50; }
      // strafe around the enemy while drifting along the route
      const sx = -ez / (dist || 1) * this.strafe, sz = ex / (dist || 1) * this.strafe;
      const close = dist < 5 && p.cur !== 1 ? -1 : 0;
      mdx = sx * 1.2 + mdx * 0.25 + ex / (dist || 1) * close; mdz = sz * 1.2 + mdz * 0.25 + ez / (dist || 1) * close;
      if (inp.w === 1) { mdx = ex; mdz = ez; }
      if (p.cur === 8 && room.tick - this.seenAt > cfg.react - 4) { mdx = 0; mdz = 0; }
    } else {
      this.turnTo(Math.atan2(-mdx, -mdz), 0);
    }
    inp.m = this.moveToward(mdx, mdz);
    if (enemy && this.crouchWant) inp.m |= MOVE.CROUCH;
    inp.yaw = this.yaw; inp.pitch = this.pitch;

    // unstick: no progress for a second -> hop and pick a new route
    const moved = Math.hypot(p.x - this.last.x, p.z - this.last.z);
    this.stuck = moved < 0.02 && inp.m ? this.stuck + 1 : 0;
    this.last = { x: p.x, z: p.z };
    if (this.stuck > 30) { inp.m |= MOVE.JUMP; if (this.stuck > 90) { this.route = []; this.stuck = 0; } }
    if (p.mag[p.cur] === 0 && (p.res[p.cur] | 0) > 0 && !WEAPONS[p.cur].melee) inp.b |= BTN.RELOAD;
    return inp;
  }
}

module.exports = { Bot, LEVELS, buildGraph, graphFor, path };
