'use strict';
/**
 * Rooftop Tag - server-side bot. It produces the same input packets a browser sends
 * ({m, yaw, pitch, b, rt}), so it moves and tags through exactly the same code as a human.
 *
 * Navigation: a waypoint graph. Walking links are validated against the collision world when the
 * map is first used; every jump pad adds a one-way link to wherever its launch really lands
 * (found by simulating the launch with the shared movement code).
 * Roles: carry the flag home > chase whoever has our flag > grab theirs; in 2v2 one bot defends.
 */
const { C, MOVE, BTN, FLAG } = require('../shared/Constants.js');
const M = require('../shared/Movement.js');

const LEVELS = {
  easy:   { aimErr: 0.08, turn: 0.08, react: 32, burst: 0.5, slide: 0.0 },
  normal: { aimErr: 0.055, turn: 0.12, react: 22, burst: 0.6, slide: 0.4 },
  hard:   { aimErr: 0.018, turn: 0.2, react: 9, burst: 0.95, slide: 0.8 },
};

// ---------- navigation graph (built once per map)
const GRAPHS = new Map();
function graphFor(map) {
  if (!GRAPHS.has(map.id)) GRAPHS.set(map.id, buildGraph(map));
  return GRAPHS.get(map.id);
}
function groundAt(world, x, y, z) {
  const h = M.raycast(world, x, y + 1.2, z, 0, -1, 0, 4);
  return h.box ? y + 1.2 - h.t : null;
}
function onPad(world, x, y, z) {
  return world.pads.findIndex(pd => Math.abs(y - pd.y) < 0.1 && x >= pd.x0 - 0.3 && x <= pd.x1 + 0.3 && z >= pd.z0 - 0.3 && z <= pd.z1 + 0.3);
}
function walkable(world, a, b) {
  const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.4));
  let prevG = a[1];
  for (let i = 1; i <= n; i++) {
    const t = i / n, x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t, y = a[1] + (b[1] - a[1]) * t;
    const g = groundAt(world, x, Math.max(y, prevG), z);
    if (g === null || Math.abs(g - prevG) > 0.6 || Math.abs(g - y) > 1.2) return false;
    // crossing a pad would launch us (stepping onto a pad at the end of a link is the point of the link)
    const fromEnd = Math.min(Math.hypot(x - a[0], z - a[2]), Math.hypot(x - b[0], z - b[2]));
    if (fromEnd > 1.6 && onPad(world, x, g, z) >= 0) return false;
    for (const hgt of [0.65, 1.5]) {
      const px = a[0] + (b[0] - a[0]) * (i - 1) / n, pz = a[2] + (b[2] - a[2]) * (i - 1) / n;
      const dx = x - px, dz = z - pz, l = Math.hypot(dx, dz), base = Math.max(prevG, g);
      if (l > 0 && M.raycast(world, px, base + hgt, pz, dx / l, 0, dz / l, l + C.PLAYER_R).t < l + C.PLAYER_R) return false;
    }
    // stay away from the edge: there must be floor a body-width to either side
    const l = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1, sx = -(b[2] - a[2]) / l * 0.5, sz = (b[0] - a[0]) / l * 0.5;
    if (groundAt(world, x + sx, g, z + sz) === null || groundAt(world, x - sx, g, z - sz) === null) return false;
    prevG = g;
  }
  return true;
}
function buildGraph(map) {
  const world = M.makeWorld(map);
  const nodes = [];
  const add = ([x, y, z]) => {
    const g = groundAt(world, x, y + 0.3, z);
    if (g === null || Math.abs(g - y) > 0.6) return -1;
    if (M.blocked({ x, y: g + 0.02, z }, world)) return -1;
    nodes.push([x, g, z]);
    return nodes.length - 1;
  };
  for (const w of map.WAYPOINTS) add(w);
  // a node on every pad
  const padNodes = world.pads.map(pd => add([(pd.x0 + pd.x1) / 2, pd.y, (pd.z0 + pd.z1) / 2]));
  const links = nodes.map(() => []);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      if (Math.hypot(a[0] - b[0], a[2] - b[2]) > 9) continue;
      const ia = padNodes.includes(i), ib = padNodes.includes(j);
      if (ia && ib) continue;
      // links INTO a pad only (stepping on it launches us); out of it only the launch below
      if (walkable(world, a, b) && walkable(world, b, a)) { if (!ia) links[i].push(j); if (!ib) links[j].push(i); }
    }
  }
  // simulate each launch to find where it lands
  padNodes.forEach((n, i) => {
    if (n < 0) return;
    const pd = world.pads[i], p = { x: nodes[n][0], y: pd.y, z: nodes[n][2], yaw: 0, pitch: 0 };
    M.resetMove(p);
    for (let k = 0; k < 400; k++) {
      M.stepMove(p, { m: 0, yaw: 0, pitch: 0, b: 0 }, world);
      if (p.onGround && k > 5) break;
    }
    if (!p.onGround || p.y < -1) return;
    let best = -1, bd = 4;
    nodes.forEach((q, j) => { if (j === n || padNodes.includes(j)) return; const d = Math.hypot(q[0] - p.x, q[2] - p.z) + Math.abs(q[1] - p.y); if (d < bd) { bd = d; best = j; } });
    if (best >= 0) links[n].push(best);
  });
  return { nodes, links, padNodes: new Set(padNodes.filter(n => n >= 0)) };
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

class Bot {
  constructor(room, p, level) {
    this.room = room;
    this.p = p;
    this.cfg = LEVELS[level] || LEVELS.normal;
    this.rng = room.rng;
    this.route = [];
    this.goal = -1;
    this.replanAt = 0;
    this.target = null;
    this.seenAt = 0;
    this.strafe = 1; this.strafeT = 0;
    this.stuck = 0;
    this.last = { x: p.x, z: p.z };
    this.yaw = p.yaw; this.pitch = 0;
    this.errYaw = 0; this.errPitch = 0; this.errT = 0;
    this.slideHold = 0;
    this.lastAlive = false;
  }

  get graph() { return this.room.graph; }

  nearestNode(x, y, z) {
    let best = 0, bd = Infinity;
    this.graph.nodes.forEach((n, i) => {
      if (this.graph.padNodes.has(i)) return;
      const d = Math.hypot(n[0] - x, n[2] - z) + Math.abs(n[1] - y) * 3;
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  visible(q) {
    const p = this.p, ex = p.x, ey = p.y + M.eyeOf(p), ez = p.z;
    const tx = q.x - ex, ty = q.y + 1.1 - ey, tz = q.z - ez, d = Math.hypot(tx, ty, tz);
    if (d > 45) return false;
    return M.raycast(this.room.phys.world, ex, ey, ez, tx / d, ty / d, tz / d, d).t >= d - 0.05;
  }

  turnTo(yaw, pitch) {
    const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
    const dy = wrap(yaw - this.yaw), t = this.cfg.turn;
    this.yaw = wrap(this.yaw + Math.max(-t, Math.min(t, dy)));
    this.pitch += Math.max(-t, Math.min(t, pitch - this.pitch));
    return Math.abs(dy) + Math.abs(pitch - this.pitch);
  }

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

  /** Is there floor ~1.3 m ahead in direction (dx, dz)? */
  safe(dx, dz) {
    const l = Math.hypot(dx, dz);
    if (l < 0.01) return true;
    const p = this.p, x = p.x + dx / l * 1.3, z = p.z + dz / l * 1.3;
    return groundAt(this.room.phys.world, x, p.y + 0.4, z) !== null;
  }

  /** Where this bot wants to be right now. */
  chooseGoal() {
    const room = this.room, p = this.p, own = room.flags[p.team], enemy = room.flags[1 - p.team];
    if (p.carry) return own.home;                                              // bring it home
    if (own.state === FLAG.CARRIED && own.carrier) return [own.carrier.x, own.carrier.y, own.carrier.z];
    if (own.state === FLAG.DROPPED) return [own.x, own.y, own.z];              // return our flag
    const mates = [...room.players.values()].filter(q => q.team === p.team && q !== p);
    const defender = mates.length && mates.every(q => q.bot ? q.id > p.id : true) && !mates.some(q => q.carry);
    if (defender && own.state === FLAG.BASE && enemy.state !== FLAG.CARRIED) {
      const a = (room.tick / 240 + p.id) % (Math.PI * 2);                      // patrol around our flag
      return [own.home[0] + Math.sin(a) * 6, own.home[1], own.home[2] + Math.cos(a) * 4 * (p.team ? -1 : 1) + (p.team ? -4 : 4)];
    }
    if (enemy.state === FLAG.CARRIED && enemy.carrier) {                       // escort our carrier
      const c = enemy.carrier;
      return [c.x, c.y, c.z];
    }
    return [enemy.x, enemy.y, enemy.z];
  }

  input() {
    const room = this.room, p = this.p, R = this.rng, cfg = this.cfg;
    const inp = { m: 0, yaw: this.yaw, pitch: this.pitch, b: 0, rt: room.tick };
    if (!p.alive || room.phase !== 'play') { this.route = []; this.lastAlive = false; return inp; }
    if (!this.lastAlive) { this.yaw = p.yaw; this.lastAlive = true; this.route = []; }

    // enemy: nearest visible
    let enemy = null, ed = Infinity;
    for (const q of room.players.values()) {
      if (q.team === p.team || !q.alive) continue;
      const d = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
      if (d < ed && this.visible(q)) { ed = d; enemy = q; }
    }
    if (enemy !== this.target) { this.target = enemy; this.seenAt = room.tick; }

    // route to the goal (replanned twice a second or when it runs out)
    if (room.tick >= this.replanAt || !this.route.length) {
      const g = this.chooseGoal();
      const goal = this.nearestNode(g[0], g[1], g[2]);
      if (goal !== this.goal || !this.route.length) {
        this.goal = goal;
        this.route = path(this.graph, this.nearestNode(p.x, p.y, p.z), goal) || [];
      }
      this.replanAt = room.tick + 30;
    }
    let mdx = 0, mdz = 0, onRoute = false;
    if (this.route.length) {
      const node = this.graph.nodes[this.route[0]];
      mdx = node[0] - p.x; mdz = node[2] - p.z;
      if (Math.hypot(mdx, mdz) < 0.9 && Math.abs(node[1] - p.y) < 1.5) this.route.shift();
      onRoute = true;
    } else {
      const g = this.chooseGoal();
      mdx = g[0] - p.x; mdz = g[2] - p.z;
    }
    const airborne = !p.onGround;

    if (enemy) {
      const ex = enemy.x - p.x, ez = enemy.z - p.z, ey = enemy.y + (enemy.crouch ? 0.6 : 1.0) - (p.y + M.eyeOf(p));
      if (--this.errT <= 0) { this.errYaw = (R() - 0.5) * 2 * cfg.aimErr; this.errPitch = (R() - 0.5) * 2 * cfg.aimErr; this.errT = 18 + R() * 24; }
      const dist = Math.hypot(ex, ez);
      // lead a little: aim where they will be in ~80 ms
      const lead = 5 / 60;
      const lx = ex + (enemy.vx || 0) * lead, lz = ez + (enemy.vz || 0) * lead;
      const off = this.turnTo(Math.atan2(-lx, -lz) + this.errYaw, Math.atan2(ey, dist) + this.errPitch);
      if (room.tick - this.seenAt > cfg.react && off < 0.1 && R() < cfg.burst) inp.b |= BTN.FIRE;
      if (--this.strafeT <= 0) { this.strafe = R() < 0.5 ? -1 : 1; this.strafeT = 25 + R() * 40; }
      // keep running the route (the flag matters more), with a little sideways jink
      const sx = -ez / (dist || 1) * this.strafe, sz = ex / (dist || 1) * this.strafe;
      const rl = Math.hypot(mdx, mdz) || 1;
      let ddx = mdx / rl * 1.2 + sx * 0.6, ddz = mdz / rl * 1.2 + sz * 0.6;
      if (!this.safe(ddx, ddz)) { ddx = mdx; ddz = mdz; }
      inp.m = this.moveToward(ddx, ddz);
    } else {
      this.turnTo(Math.atan2(-mdx, -mdz), 0);
      inp.m = this.moveToward(mdx, mdz);
      // slide on long straight stretches of flat ground
      const sp = Math.hypot(p.vx, p.vz);
      if (this.slideHold > 0) { this.slideHold--; inp.m |= MOVE.CROUCH; }
      else if (onRoute && p.onGround && sp > 7.5 && Math.hypot(mdx, mdz) > 7 && R() < cfg.slide * 0.04 && this.safe(mdx * 3, mdz * 3)) this.slideHold = 40;
    }
    // never walk off a roof
    if (!airborne && inp.m && !this.safe(mdx, mdz) && !(onRoute && this.graph.padNodes.has(this.route[0]))) {
      const node = this.route.length ? this.graph.nodes[this.route[0]] : null;
      if (!node || Math.hypot(node[0] - p.x, node[2] - p.z) > 1.5) inp.m = 0;
    }
    inp.yaw = this.yaw; inp.pitch = this.pitch;

    // unstick: no progress for half a second -> hop, then replan
    const moved = Math.hypot(p.x - this.last.x, p.z - this.last.z);
    this.stuck = moved < 0.02 && inp.m ? this.stuck + 1 : 0;
    this.last = { x: p.x, z: p.z };
    if (this.stuck > 30) { inp.m |= MOVE.JUMP; if (this.stuck > 80) { this.route = []; this.stuck = 0; } }
    return inp;
  }
}

module.exports = { Bot, LEVELS, buildGraph, graphFor, path };
