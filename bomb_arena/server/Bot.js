'use strict';
/**
 * Bomb Arena 3D - server-side bot. Produces the same input bits a browser sends, so it moves through
 * exactly the same grid movement as a human.
 *
 * Every few ticks it rebuilds a danger map (each bomb's blast cross, chain reactions included, with
 * the tick it goes off; live flames count as "now") and then:
 *   1. standing in danger -> run to the nearest safe tile it can reach before the flames
 *   2. a bomb here would hit a crate or an enemy AND there is a way out before the fuse -> drop it
 *   3. otherwise walk (only over safe tiles) to a power-up, a good bombing spot, or the nearest enemy
 */
const { C, T, KEY } = require('../shared/Constants.js');
const A = require('../shared/Arena.js');

const W = A.W, H = A.H, idx = A.idx;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const LEVELS = {
  easy:   { replan: 16, bombChance: 0.35, hunt: 0.3, margin: 34, wander: 0.25 },
  normal: { replan: 8, bombChance: 0.7, hunt: 0.65, margin: 24, wander: 0.1 },
  hard:   { replan: 4, bombChance: 0.95, hunt: 0.95, margin: 16, wander: 0.02 },
};

class Bot {
  constructor(room, p, level) {
    this.room = room; this.p = p;
    this.cfg = LEVELS[level] || LEVELS.normal;
    this.rng = room.rng;
    this.reset();
  }
  reset() { this.path = []; this.next = 0; this.bombNext = false; this.goalKind = ''; }

  tileOf() { return [Math.floor(this.p.x), Math.floor(this.p.z)]; }

  /** tile -> ticks until it burns (0 = burning now). */
  danger(extra) {
    const room = this.room, d = new Map();
    for (const [i] of room.flames) d.set(i, 0);
    const bombs = [...room.bombs.values()].map(b => ({ cx: b.cx, cz: b.cz, fuse: b.fuse, range: b.range }));
    if (extra) bombs.push(extra);
    // chain reactions: a bomb inside an earlier blast goes off with it
    const blast = b => {
      const out = [idx(b.cx, b.cz)];
      for (const [dx, dz] of DIRS) for (let r = 1; r <= b.range; r++) {
        const cx = b.cx + dx * r, cz = b.cz + dz * r, i = idx(cx, cz), t = room.tiles[i];
        if (t === T.WALL) break;
        out.push(i);
        if (t === T.CRATE) break;
      }
      return out;
    };
    let changed = true, guard = 0;
    const tiles = bombs.map(blast);
    while (changed && guard++ < 10) {
      changed = false;
      bombs.forEach((b, k) => {
        for (const i of tiles[k]) {
          bombs.forEach((o, j) => { if (j !== k && idx(o.cx, o.cz) === i && o.fuse > b.fuse) { o.fuse = b.fuse; changed = true; } });
        }
      });
    }
    bombs.forEach((b, k) => { for (const i of tiles[k]) d.set(i, Math.min(d.has(i) ? d.get(i) : 1e9, b.fuse)); });
    return d;
  }

  /** Breadth-first search from our tile; goal(cx, cz, steps) -> bool. Avoids tiles that burn when we'd be there. */
  search(goal, danger, maxSteps = 40) {
    const room = this.room, [sx, sz] = this.tileOf();
    const perTile = 60 / (C.BASE_SPEED + C.SPEED_STEP * this.p.speed);
    const prev = new Map([[idx(sx, sz), -1]]), q = [[sx, sz, 0]];
    while (q.length) {
      const [cx, cz, n] = q.shift();
      if (goal(cx, cz, n)) {
        const path = [];
        for (let i = idx(cx, cz); i !== -1 && prev.get(i) !== -1; i = prev.get(i)) path.unshift(i);
        if (!path.length) path.push(idx(cx, cz));      // the goal is our own tile: walk to its centre
        return path;
      }
      if (n >= maxSteps) continue;
      for (const [dx, dz] of DIRS) {
        const x = cx + dx, z = cz + dz, i = idx(x, z);
        if (prev.has(i) || x < 0 || z < 0 || x >= W || z >= H) continue;
        if (room.tiles[i] !== T.FLOOR || room.bombAt.has(i)) continue;
        const t = danger.get(i);
        const arrive = (n + 1) * perTile;
        // never step into fire, nor into a tile that will be burning while we are on it
        if (t !== undefined && (t === 0 || (t < arrive + perTile + 10 && t + C.FLAME_TICKS > arrive - 4))) continue;
        prev.set(i, idx(cx, cz)); q.push([x, z, n + 1]);
      }
    }
    return null;
  }

  /** Would a bomb at our tile hit a crate or an enemy? */
  worthBombing(cx, cz) {
    const room = this.room;
    let score = 0;
    for (const [dx, dz] of DIRS) for (let r = 1; r <= this.p.fire; r++) {
      const x = cx + dx * r, z = cz + dz * r, i = idx(x, z), t = room.tiles[i];
      if (t === T.WALL) break;
      if (t === T.CRATE) { score += 1; break; }
      for (const o of room.players.values()) if (o !== this.p && o.alive && Math.floor(o.x) === x && Math.floor(o.z) === z) score += 3;
    }
    return score;
  }

  plan() {
    const room = this.room, p = this.p, cfg = this.cfg;
    const [cx, cz] = this.tileOf(), here = idx(cx, cz);
    const danger = this.danger();
    this.bombNext = false;
    if (danger.has(here)) {
      this.goalKind = 'flee';
      this.path = this.search((x, z) => !danger.has(idx(x, z)), danger, 30) || [];
      return;
    }
    // drop a bomb here? (only when centred on the tile, so the bomb lands where we checked the way out)
    const centred = Math.abs(p.x - cx - 0.5) < 0.2 && Math.abs(p.z - cz - 0.5) < 0.2;
    if (centred && p.active < p.maxBombs && !room.bombAt.has(here) && this.worthBombing(cx, cz) && this.rng() < cfg.bombChance) {
      const d2 = this.danger({ cx, cz, fuse: C.FUSE, range: p.fire });
      const perTile = 60 / (C.BASE_SPEED + C.SPEED_STEP * p.speed);
      const out = this.search((x, z, n) => !d2.has(idx(x, z)) && n * perTile < C.FUSE - cfg.margin, d2, 12);
      if (out && out.length) { this.bombNext = true; this.path = out; this.goalKind = 'bomb'; return; }
    }
    // power-ups nearby
    // goals must be safe places to stand (passing through a tile that burns later is fine, stopping there is not)
    const safe = (x, z) => !danger.has(idx(x, z));
    let path = this.search((x, z) => safe(x, z) && room.powerups.has(idx(x, z)), danger, 14);
    if (path && path.length) { this.path = path; this.goalKind = 'item'; return; }
    // hunt or farm crates
    const enemies = [...room.players.values()].filter(o => o !== p && o.alive);
    const hunt = this.rng() < cfg.hunt;
    if (hunt && enemies.length) {
      path = this.search((x, z) => safe(x, z) && enemies.some(o => Math.abs(Math.floor(o.x) - x) + Math.abs(Math.floor(o.z) - z) <= Math.min(2, p.fire) &&
                                                    (Math.floor(o.x) === x || Math.floor(o.z) === z)), danger, 30);
      if (path && path.length) { this.path = path; this.goalKind = 'hunt'; return; }
    }
    path = this.search((x, z) => safe(x, z) && this.worthBombing(x, z) > 0, danger, 30);
    if (path && path.length) { this.path = path; this.goalKind = 'crate'; return; }
    if (enemies.length) {
      path = this.search((x, z) => enemies.some(o => Math.floor(o.x) === x && Math.floor(o.z) === z), danger, 40);
      if (path && path.length > 1) { this.path = path.slice(0, -1); this.goalKind = 'chase'; return; }
    }
    this.path = []; this.goalKind = 'idle';
  }

  input() {
    const p = this.p, room = this.room;
    if (!p.alive || room.phase !== 'play') return 0;
    let keys = 0;
    // drop the bomb standing still, then run on the next ticks
    if (this.bombNext) { this.bombNext = false; if (!(p.keys & KEY.BOMB)) return KEY.BOMB; }
    const inDanger = this.goalKind !== 'flee' && (room.flames.size || room.bombs.size) && this.danger().has(idx(Math.floor(p.x), Math.floor(p.z)));
    if (inDanger || room.tick % this.cfg.replan === 0 || !this.path.length) this.plan();
    // follow the path: aim for the next tile's centre
    while (this.path.length) {
      const i = this.path[0], tx = i % W + 0.5, tz = Math.floor(i / W) + 0.5;
      if (Math.abs(p.x - tx) < 0.08 && Math.abs(p.z - tz) < 0.08) { this.path.shift(); continue; }
      const dx = tx - p.x, dz = tz - p.z;
      if (Math.abs(dx) > Math.abs(dz)) keys |= dx > 0 ? KEY.RIGHT : KEY.LEFT;
      else keys |= dz > 0 ? KEY.DOWN : KEY.UP;
      break;
    }
    // bombs are edge-triggered: keep the bomb key up between drops
    if ((keys & KEY.BOMB) && (p.keys & KEY.BOMB)) keys &= ~KEY.BOMB;
    return keys;
  }
}

module.exports = { Bot, LEVELS };
