/**
 * Voxel Kart Racing - the three tracks and the code that turns them into something to drive on.
 *
 * A track is a closed loop of control points [x, z, y, width, tags] joined by a Catmull-Rom
 * spline, plus optional branches (shortcuts / alternative routes) that leave the loop at one
 * control point and rejoin it at another. build() samples every spline about once per metre and
 * paints the samples onto a 1 m grid:
 *
 *   surf  what the cell is (road, offroad, wall, lava, void, boost pad, jump ramp, bridge...)
 *   seg   the nearest spline sample for road / shoulder cells: the road height comes from
 *         projecting onto that sample's segment (smooth slopes), and race progress comes from it
 *   h     fixed height of everything else (wall tops, lava level, flat ground)
 *
 * Tags on a control point affect the segment that starts there:
 *   boost - a boost pad at its start, ramp - a jump ramp at its end, gap - no road (jump it!),
 *   wood  - a narrow bridge without shoulders
 *
 * Shared by the server (physics, AI, progress) and the browser (prediction, rendering).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./Constants.js'));
  else root.VKTracks = factory(root.VKConst);
})(typeof self !== 'undefined' ? self : this, function (K) {
  'use strict';
  const { SURF } = K;

  // sample flags
  const F = { BOOST: 1, JUMP: 2, WOOD: 4, GAP: 8 };
  // rendering hints for cells ("look")
  const LOOK = { DEFAULT: 0, SAND: 1, GRAVEL: 2, TREE: 3, ROCK: 4, HEDGE: 5, FLOWER: 6, CRYSTAL: 7 };

  // =====================================================================================
  const DEFS = {
    // ---------------------------------------------------------------- 1. Blocky Circuit
    circuit: {
      id: 'circuit', name: 'Blocky Circuit', sub: 'Beginner Meadows', difficulty: 1,
      outside: SURF.OFFROAD, outsideH: 0, shoulder: 6, shoulderSurf: SURF.OFFROAD, border: SURF.WALL, borderLook: LOOK.HEDGE,
      trees: 90,
      nodes: [
        [0, 0, 0, 18], [40, 0, 0, 18, 'ramp'], [80, 0, 0, 18], [112, 10, 0, 18], [127, 40, 0, 18], [117, 75, 0, 18],
        [87, 92, 0, 18, 'boost'], [60, 82, 0, 17], [45, 62, 0, 16], [22, 56, 0, 16], [0, 70, 0, 17], [-22, 96, 0, 18],
        [-52, 106, 0, 18], [-86, 96, 0, 18, 'boost'], [-102, 66, 0, 18], [-97, 30, 0, 18], [-76, 8, 0, 18], [-40, 0, 0, 18],
      ],
      rects: [
        { x0: 4, z0: 18, x1: 44, z1: 38, surf: SURF.WATER, h: -0.4 },              // the pond in the infield
        { x0: -70, z0: 30, x1: -50, z1: 70, surf: SURF.OFFROAD, h: 0, look: LOOK.SAND },
        { x0: 70, z0: 30, x1: 98, z1: 62, surf: SURF.OFFROAD, h: 0, look: LOOK.FLOWER },
      ],
      boxes: [2, 6, 11, 15],
      theme: { sky: [0x4aa8ff, 0xbfe6ff], fog: [0xbfe6ff, 120, 420], sun: [0xfff2d0, 2.6], hemi: [0xcfe8ff, 0x5a8a3a, 1.1],
               ground: 'grass', clouds: true, exposure: 1.05 },
    },

    // ---------------------------------------------------------------- 2. Lava Cavern
    cavern: {
      id: 'cavern', name: 'Lava Cavern', sub: 'Underground Mine', difficulty: 2,
      outside: SURF.WALL, outsideH: 9, outsideLook: LOOK.ROCK, shoulder: 1.6, shoulderSurf: SURF.OFFROAD, shoulderLook: LOOK.GRAVEL,
      crystals: 40,
      nodes: [
        [0, 0, 0, 13], [45, 0, 0, 13, 'boost'], [80, -10, 0, 13], [100, -40, 2, 13], [95, -75, 4, 12],
        [70, -96, 4, 7, 'wood'], [35, -101, 4, 7, 'wood'], [3, -95, 4, 7, 'wood'], [-22, -86, 3.5, 12],
        [-35, -78, 3, 12, 'ramp'], [-45, -70, 3.4, 12, 'gap'], [-55, -62, 1.6, 13], [-72, -49, 1, 13, 'boost'],
        [-96, -28, 0.5, 12], [-100, 4, 0, 12], [-84, 28, 0, 12], [-55, 36, 0, 12], [-30, 26, 0, 12], [-18, 6, 0, 13],
      ],
      rects: [
        { x0: 8, z0: -122, x1: 82, z1: -78, surf: SURF.LAVA, h: -3 },                // lava lake under the bridges
        { x0: -66, z0: -86, x1: -30, z1: -50, surf: SURF.LAVA, h: -3 },              // the chasm below the jump
      ],
      hazards: [{ node: 14, n: 2 }, { node: 15, n: 2 }, { node: 2, n: 1 }],    // fireballs sweeping across the road
      boxes: [1, 4, 12, 16],
      theme: { sky: [0x120806, 0x3a1206], fog: [0x2a0c06, 40, 190], sun: [0xffb070, 0.9], hemi: [0xff9a60, 0x200a08, 0.8],
               ground: 'stone', lava: true, ceiling: true, exposure: 1.25 },
    },

    // ---------------------------------------------------------------- 3. Sky High Island
    sky: {
      id: 'sky', name: 'Sky High Island', sub: 'Floating Sky Course', difficulty: 3,
      outside: SURF.VOID, outsideH: -60, shoulder: 0,
      nodes: [
        [0, 0, 10, 12], [60, 0, 10, 12], [92, -14, 12, 12], [97, -45, 14, 12], [72, -60, 15, 11], [32, -54, 15, 11],
        [10, -70, 14, 11], [25, -91, 13, 11], [65, -95, 12, 11], [92, -110, 10, 11], [72, -131, 9, 11, 'boost'],
        [20, -131, 8, 12], [-30, -121, 8, 12], [-62, -96, 9, 11], [-78, -60, 11, 11], [-72, -25, 10, 12], [-45, -5, 10, 12],
      ],
      branches: [
        // the daring shortcut down the middle of the hairpins: narrow, boost, ramp, jump the gap
        // (it lands heading south, then sweeps west and merges into the main road as an extra lane)
        { from: 6, to: 12, nodes: [[7, -84, 13, 6, 'boost'], [8, -93, 12.8, 6, 'ramp'], [9, -100, 12.4, 6, 'gap'], [9, -109, 10.5, 8],
                                   [2, -117, 9, 9], [-12, -120, 8.5, 10]] },
        // a twin lane around the far turn, about as long as the main road
        { from: 12, to: 14, nodes: [[-40, -136, 8, 9], [-62, -139, 8.5, 9], [-84, -116, 9.5, 9]] },
      ],
      boxes: [1, 5, 9, 12, 15],
      theme: { sky: [0x6fb8ff, 0xffe7c2], fog: [0xd8ecff, 160, 520], sun: [0xfff0d8, 2.8], hemi: [0xe0f0ff, 0x7aa0c8, 1.15],
               ground: 'grass', clouds: true, islands: true, exposure: 1.05 },
    },
  };
  const IDS = ['circuit', 'cavern', 'sky'];

  // =====================================================================================
  const tagSet = n => new Set(n.slice(4));
  function cr(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }
  /** Sample a Catmull-Rom spline through pts (each [x, z, y, w, ...tags]); closed or open (with end tangents). */
  function sampleSpline(pts, closed, before, after) {
    const out = [];
    const n = pts.length, segs = closed ? n : n - 1;
    const P = i => closed ? pts[(i + n) % n] : i < 0 ? before : i >= n ? after : pts[i];
    for (let i = 0; i < segs; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const steps = Math.max(2, Math.round(len));
      const tags = tagSet(p1);
      let segStart = out.length;
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        out.push({ x: cr(p0[0], p1[0], p2[0], p3[0], t), z: cr(p0[1], p1[1], p2[1], p3[1], t), y: cr(p0[2], p1[2], p2[2], p3[2], t),
                   w: p1[3] + (p2[3] - p1[3]) * t, flags: 0, node: i });
      }
      // segment-length based tags
      let d = 0;
      const segLen = [];
      for (let k = segStart; k < out.length; k++) {
        const a = out[k], b = k + 1 < out.length ? out[k + 1] : { x: p2[0], z: p2[1] };
        segLen.push(d); d += Math.hypot(b.x - a.x, b.z - a.z);
      }
      for (let k = segStart; k < out.length; k++) {
        const s = out[k], from = segLen[k - segStart], to = d - from;
        if (tags.has('gap')) s.flags |= F.GAP;
        if (tags.has('wood')) s.flags |= F.WOOD;
        if (tags.has('boost') && from < 7) s.flags |= F.BOOST;
        if (tags.has('ramp') && to < 5.5) s.flags |= F.JUMP;
      }
    }
    if (!closed) { const e = pts[n - 1]; out.push({ x: e[0], z: e[1], y: e[2], w: e[3], flags: 0, node: n - 1 }); }
    return out;
  }

  function mulberry(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  const CACHE = new Map();
  function get(id) {
    const def = DEFS[id] || DEFS[IDS[0]];
    if (!CACHE.has(def.id)) CACHE.set(def.id, build(def));
    return CACHE.get(def.id);
  }

  function build(def) {
    // ---------- samples: the main loop first (indices 0..nMain-1), then each branch
    const S = sampleSpline(def.nodes, true);
    const nMain = S.length;
    const nodeSample = [];                     // first sample of each main control point
    S.forEach((s, i) => { s.branch = -1; s.prog = i; s.prev = (i - 1 + nMain) % nMain; s.next = (i + 1) % nMain; if (nodeSample[s.node] === undefined) nodeSample[s.node] = i; });
    const branches = [];
    (def.branches || []).forEach((b, bi) => {
      const A = def.nodes[b.from], B = def.nodes[b.to];
      const pts = [[A[0], A[1], A[2], b.nodes[0][3]], ...b.nodes, [B[0], B[1], B[2], B[3]]];
      const before = def.nodes[(b.from - 1 + def.nodes.length) % def.nodes.length], after = def.nodes[(b.to + 1) % def.nodes.length];
      const bs = sampleSpline(pts, false, before, after);
      bs.pop();                                // the last point is the main loop's own sample
      const first = S.length, p0 = nodeSample[b.from], p1 = nodeSample[b.to];
      const span = ((p1 - p0) + nMain) % nMain;
      bs.forEach((s, k) => {
        s.branch = bi; s.prog = (p0 + span * (k / bs.length)) % nMain;
        s.prev = k === 0 ? (p0 - 1 + nMain) % nMain : first + k - 1;
        s.next = k === bs.length - 1 ? p1 : first + k + 1;
        S.push(s);
      });
      branches.push({ from: p0, to: p1, first, count: bs.length, span });
    });
    // tangents, cumulative distance (main loop only)
    for (const s of S) {
      const n = S[s.next];
      const dx = n.x - s.x, dz = n.z - s.z, l = Math.hypot(dx, dz) || 1;
      s.tx = dx / l; s.tz = dz / l; s.len = l;
    }
    let lapLen = 0;
    for (let i = 0; i < nMain; i++) { S[i].d = lapLen; lapLen += S[i].len; }

    // ---------- grid
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const s of S) { minX = Math.min(minX, s.x - s.w); maxX = Math.max(maxX, s.x + s.w); minZ = Math.min(minZ, s.z - s.w); maxZ = Math.max(maxZ, s.z + s.w); }
    const M = 18 + def.shoulder;
    const x0 = Math.floor(minX - M), z0 = Math.floor(minZ - M);
    const nx = Math.ceil(maxX + M) - x0, nz = Math.ceil(maxZ + M) - z0, N = nx * nz;
    const surf = new Uint8Array(N).fill(def.outside), h = new Float32Array(N).fill(def.outsideH);
    const look = new Uint8Array(N).fill(def.outsideLook || 0);
    const seg = new Int32Array(N).fill(-1), dist = new Float32Array(N).fill(1e9);
    const idx = (gx, gz) => gz * nx + gx;

    for (const r of def.rects || []) {
      for (let gz = Math.max(0, Math.floor(r.z0 - z0)); gz < Math.min(nz, Math.ceil(r.z1 - z0)); gz++)
        for (let gx = Math.max(0, Math.floor(r.x0 - x0)); gx < Math.min(nx, Math.ceil(r.x1 - x0)); gx++) {
          const i = idx(gx, gz); surf[i] = r.surf; h[i] = r.h; look[i] = r.look || 0;
        }
    }

    // paint the road: every cell takes the nearest sample's segment
    S.forEach((s, si) => {
      if (s.flags & F.GAP) return;
      const n = S[s.next];
      const wood = s.flags & F.WOOD;
      const half = s.w / 2, R = half + (wood ? 0 : def.shoulder), RC = R + 1;
      const gx0 = Math.max(0, Math.floor(Math.min(s.x, n.x) - RC - x0)), gx1 = Math.min(nx - 1, Math.ceil(Math.max(s.x, n.x) + RC - x0));
      const gz0 = Math.max(0, Math.floor(Math.min(s.z, n.z) - RC - z0)), gz1 = Math.min(nz - 1, Math.ceil(Math.max(s.z, n.z) + RC - z0));
      const sx = n.x - s.x, sz = n.z - s.z, L2 = sx * sx + sz * sz || 1;
      for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) {
        const cx = x0 + gx + 0.5, cz = z0 + gz + 0.5;
        const t = Math.max(0, Math.min(1, ((cx - s.x) * sx + (cz - s.z) * sz) / L2));
        const d = Math.hypot(cx - (s.x + sx * t), cz - (s.z + sz * t));
        const i = idx(gx, gz);
        if (d > R || d >= dist[i]) continue;
        dist[i] = d; seg[i] = si;
        if (d <= half) {
          const lat = Math.abs((cx - s.x) * s.tz - (cz - s.z) * s.tx);
          surf[i] = s.flags & F.JUMP ? SURF.JUMP : (s.flags & F.BOOST) && lat < half * 0.55 ? SURF.BOOST : wood ? SURF.WOOD : SURF.ROAD;
          look[i] = 0;
        } else { surf[i] = def.shoulderSurf; look[i] = def.shoulderLook || 0; }
      }
    });

    // border hedges / walls, trees and crystals (solid), all away from the road
    const rnd = mulberry(def.id.length * 7919 + nx * 31 + nz);
    if (def.border !== undefined) for (let gz = 0; gz < nz; gz++) for (let gx = 0; gx < nx; gx++) {
      if (gx < 2 || gz < 2 || gx >= nx - 2 || gz >= nz - 2) { const i = idx(gx, gz); surf[i] = def.border; h[i] = 2.5; look[i] = def.borderLook; }
    }
    const props = [];
    const nearRoad = (gx, gz, r) => {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const x = gx + dx, z = gz + dz;
        if (x >= 0 && z >= 0 && x < nx && z < nz && seg[idx(x, z)] >= 0) return true;
      }
      return false;
    };
    const scatter = (count, minClear, kind, height) => {
      for (let tries = 0, n = 0; n < count && tries < count * 60; tries++) {
        const gx = 3 + Math.floor(rnd() * (nx - 6)), gz = 3 + Math.floor(rnd() * (nz - 6)), i = idx(gx, gz);
        if (seg[i] >= 0 || nearRoad(gx, gz, minClear)) continue;
        if (kind === LOOK.TREE && (surf[i] !== SURF.OFFROAD || look[i] !== 0)) continue;
        if (kind === LOOK.CRYSTAL && surf[i] !== SURF.WALL) continue;
        if (props.some(p => Math.abs(p.gx - gx) < 3 && Math.abs(p.gz - gz) < 3)) continue;
        surf[i] = SURF.WALL; h[i] = height; look[i] = kind;
        props.push({ gx, gz, kind, x: x0 + gx + 0.5, z: z0 + gz + 0.5, s: rnd() });
        n++;
      }
    };
    if (def.trees) scatter(def.trees, 3, LOOK.TREE, 5);
    if (def.crystals) scatter(def.crystals, 1, LOOK.CRYSTAL, 9);

    // ---------- item boxes: rows across the road at the given control points (+ middle of each branch)
    const boxes = [];
    const row = (si, count) => {
      const s = S[si];
      for (let k = 0; k < count; k++) {
        const off = (k - (count - 1) / 2) * Math.min(3.2, (s.w - 2) / count);
        boxes.push({ x: s.x + s.tz * off, z: s.z - s.tx * off, y: s.y + 1.2, si });
      }
    };
    for (const n of def.boxes || []) row((nodeSample[n] + 4) % nMain, 4);
    branches.forEach(b => row(b.first + Math.floor(b.count * 0.3), 2));

    // ---------- fireball hazards
    const hazards = [];
    for (const hz of def.hazards || []) for (let k = 0; k < hz.n; k++) {
      const si = (nodeSample[hz.node] + 6 + k * 9) % nMain;
      hazards.push({ si, period: 150 + k * 37 + hz.node * 11, phase: k * 1.7 + hz.node, amp: S[si].w / 2 - 1.2 });
    }

    // ---------- starting grid: two columns behind the line, 5.5 m per row
    const starts = [];
    for (let k = 0; k < 8; k++) {
      const back = 6 + Math.floor(k / 2) * 5.5;
      let si = nMain - 1, acc = 0;
      while (acc < back) { acc += S[si].len; si--; }
      const s = S[si], lat = (k % 2 ? 1 : -1) * s.w * 0.22;
      starts.push({ x: s.x + s.tz * lat, z: s.z - s.tx * lat, y: s.y, yaw: Math.atan2(s.tx, s.tz) });
    }

    return { def, id: def.id, name: def.name, S, nMain, lapLen, branches, nodeSample, boxes, hazards, starts, props,
             grid: { x0, z0, nx, nz, surf, h, seg, look } };
  }

  // =====================================================================================
  /** Height and surface under (x, z). Road / shoulder heights are projected onto the spline. */
  function groundAt(T, x, z) {
    const g = T.grid, gx = Math.floor(x - g.x0), gz = Math.floor(z - g.z0);
    if (gx < 0 || gz < 0 || gx >= g.nx || gz >= g.nz) return { surf: SURF.VOID, h: -1e9, seg: -1 };
    const i = gz * g.nx + gx, surf = g.surf[i], si = g.seg[i];
    if (si >= 0) return { surf, h: segHeight(T, si, x, z), seg: si };
    return { surf, h: surf === SURF.VOID ? -1e9 : g.h[i], seg: -1 };
  }
  function segHeight(T, si, x, z) {
    const s = T.S[si], n = T.S[s.next];
    const sx = n.x - s.x, sz = n.z - s.z, L2 = sx * sx + sz * sz || 1;
    const t = Math.max(0, Math.min(1, ((x - s.x) * sx + (z - s.z) * sz) / L2));
    return s.y + (n.y - s.y) * t;
  }
  /** Position of moving hazard k at tick. */
  function hazardPos(T, hz, tick) {
    const s = T.S[hz.si], o = Math.sin(tick * Math.PI * 2 / hz.period + hz.phase) * hz.amp;
    return { x: s.x + s.tz * o, y: s.y + 1.1, z: s.z - s.tx * o };
  }
  /** Nearest main-loop sample to a progress value (skipping gaps), for rescues. */
  function rescueSample(T, si) {
    let s = si, n = 0;
    while (n++ < 400 && ((T.S[s].flags & F.GAP) || (T.S[T.S[s].next].flags & F.GAP) || (T.S[s].flags & F.JUMP))) s = T.S[s].prev;
    // step a few samples back from any edge-of-gap trouble
    return s;
  }

  return { DEFS, IDS, F, LOOK, get, build, groundAt, segHeight, hazardPos, rescueSample };
});
