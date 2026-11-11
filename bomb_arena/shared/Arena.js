/**
 * Bomb Arena 3D - the arena grid and grid-locked movement, shared by the server and the browser.
 *
 * Arena: border walls, a pillar on every tile where x and z are both even, crates almost everywhere
 * else except the 8 spawn pockets. A seed makes every round's layout reproducible.
 *
 * Movement (deterministic; the browser predicts its own player with exactly this code):
 *   - the player is a square of 2*HALF tiles; pressing a direction moves along that axis while pulling
 *     the player back onto the centre line of its row / column (so it lines up with the gaps)
 *   - running into a pillar corner while a little off-lane slides the player into the open lane
 *   - a bomb blocks like a wall, except for a player still standing on it (you can walk off your own bomb)
 *
 * World for movement: { tiles: Uint8Array(W*H), bombs: Set(tile index) }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./Constants.js'));
  else root.BAArena = factory(root.BAConst);
})(typeof self !== 'undefined' ? self : this, function (K) {
  'use strict';
  const { C, T, KEY } = K;
  const W = C.W, H = C.H;
  const idx = (cx, cz) => cz * W + cx;

  // spawn tiles: the 4 corners and the middle of each side
  const SPAWNS = [[1, 1], [W - 2, H - 2], [W - 2, 1], [1, H - 2], [8, 1], [8, H - 2], [1, 7], [W - 2, 7]];

  function mulberry(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  /** A fresh arena for a round. */
  function generate(seed) {
    const rnd = mulberry(seed);
    const tiles = new Uint8Array(W * H);
    const keep = new Set();
    for (const [x, z] of SPAWNS) {
      // the spawn tile and the two tiles next to it along each free direction stay open
      for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) keep.add(idx(x + dx, z + dz));
    }
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      const i = idx(x, z);
      if (x === 0 || z === 0 || x === W - 1 || z === H - 1 || (x % 2 === 0 && z % 2 === 0)) tiles[i] = T.WALL;
      else if (!keep.has(i) && rnd() < C.CRATE_DENSITY) tiles[i] = T.CRATE;
    }
    return tiles;
  }

  /** Spiral order of the inner tiles from the outside in (sudden death). */
  function spiral() {
    const out = [];
    let x0 = 1, z0 = 1, x1 = W - 2, z1 = H - 2;
    while (x0 <= x1 && z0 <= z1) {
      for (let x = x0; x <= x1; x++) out.push([x, z0]);
      for (let z = z0 + 1; z <= z1; z++) out.push([x1, z]);
      if (z1 > z0) for (let x = x1 - 1; x >= x0; x--) out.push([x, z1]);
      if (x1 > x0) for (let z = z1 - 1; z > z0; z--) out.push([x0, z]);
      x0++; z0++; x1--; z1--;
    }
    return out;
  }

  const speedOf = p => (C.BASE_SPEED + C.SPEED_STEP * (p.speed | 0)) * C.DT;

  function overlaps(p, cx, cz) {
    return p.x + C.HALF > cx && p.x - C.HALF < cx + 1 && p.z + C.HALF > cz && p.z - C.HALF < cz + 1;
  }

  function blocked(world, p, cx, cz) {
    if (cx < 0 || cz < 0 || cx >= W || cz >= H) return true;
    const t = world.tiles[idx(cx, cz)];
    if (t !== T.FLOOR) return true;
    return world.bombs.has(idx(cx, cz)) && !overlaps(p, cx, cz);
  }

  /**
   * Move along one axis ('x' or 'z') in direction s (+1/-1) by up to `step` tiles.
   * Returns { moved, bump: [cx, cz] | null } - bump is the tile that stopped us (for kicking bombs).
   */
  function moveAxis(p, world, axis, s, step) {
    const A = axis, B = axis === 'x' ? 'z' : 'x';
    const tileAt = (a, b) => (axis === 'x' ? [a, b] : [b, a]);
    const lane = Math.floor(p[B]), off = p[B] - (lane + 0.5);
    const front = s > 0 ? Math.floor(p[A] + C.HALF + step) : Math.floor(p[A] - C.HALF - step);
    const cur = Math.floor(p[A]);
    const isBlocked = (a, b) => { const [cx, cz] = tileAt(a, b); return blocked(world, p, cx, cz); };

    // corner assist: our lane is blocked ahead but the neighbouring lane we lean into is open
    if (front !== cur && isBlocked(front, lane) && Math.abs(off) > 0.06) {
      const side = off > 0 ? 1 : -1;
      if (Math.abs(off) > 0.5 - C.CORNER_ASSIST && !isBlocked(front, lane + side) && !isBlocked(cur, lane + side)) {
        p[B] += side * Math.min(step, 1 - Math.abs(off));
        return { moved: true, bump: null };
      }
    }
    // pull back onto the lane's centre line, using part of the step
    let rem = step;
    if (Math.abs(off) > 1e-6) {
      const a = Math.min(Math.abs(off), step);
      p[B] -= Math.sign(off) * a;
      rem = step - a * 0.5;
    }
    // rows / columns we still overlap after centring
    const b0 = Math.floor(p[B] - C.HALF + 1e-6), b1 = Math.floor(p[B] + C.HALF - 1e-6);
    const target = p[A] + s * rem;
    const edge = s > 0 ? Math.floor(target + C.HALF - 1e-9) : Math.floor(target - C.HALF);
    let hit = null;
    for (let b = b0; b <= b1; b++) {
      if (isBlocked(edge, b)) { hit = tileAt(edge, b); break; }
    }
    if (!hit) { p[A] = target; return { moved: rem > 0, bump: null }; }
    // stop flush against the blocking tile
    const flush = s > 0 ? edge - C.HALF : edge + 1 + C.HALF;
    const moved = s > 0 ? flush > p[A] + 1e-6 : flush < p[A] - 1e-6;
    if (moved) p[A] = flush;
    return { moved: moved || rem < step, bump: hit };
  }

  /**
   * One tick of movement for keys (KEY bits). Returns { bump: [cx, cz] | null, dir: [dx, dz] }.
   * p: { x, z, speed (level), face (0 up 1 right 2 down 3 left), axis ('x'|'z' last moved), moving }
   */
  function step(p, keys, world) {
    const h = ((keys & KEY.RIGHT) ? 1 : 0) - ((keys & KEY.LEFT) ? 1 : 0);
    const v = ((keys & KEY.DOWN) ? 1 : 0) - ((keys & KEY.UP) ? 1 : 0);
    p.moving = false;
    if (!h && !v) return { bump: null, dir: null };
    const sp = speedOf(p);
    const tries = [];
    // with two keys held, try the newer turn first, then keep going the old way
    if (h && v) { if (p.axis === 'x') tries.push(['z', v], ['x', h]); else tries.push(['x', h], ['z', v]); }
    else tries.push(h ? ['x', h] : ['z', v]);
    let bump = null, dir = null;
    for (const [axis, s] of tries) {
      const r = moveAxis(p, world, axis, s, sp);
      dir = axis === 'x' ? [s, 0] : [0, s];
      if (r.moved) { p.axis = axis; p.moving = true; bump = r.bump; break; }
      if (!bump) bump = r.bump;
    }
    if (dir) p.face = dir[1] < 0 ? 0 : dir[0] > 0 ? 1 : dir[1] > 0 ? 2 : 3;
    return { bump, dir };
  }

  const FIELDS = ['x', 'z', 'speed', 'face', 'axis', 'keys'];
  const r4 = v => Math.round(v * 10000) / 10000;
  function packState(p) { return [r4(p.x), r4(p.z), p.speed | 0, p.face | 0, p.axis === 'z' ? 1 : 0, p.keys | 0]; }
  function unpackState(a, p = {}) { p.x = a[0]; p.z = a[1]; p.speed = a[2]; p.face = a[3]; p.axis = a[4] ? 'z' : 'x'; p.keys = a[5]; return p; }

  return { W, H, SPAWNS, idx, generate, spiral, step, blocked, overlaps, packState, unpackState, NSTATE: FIELDS.length };
});
