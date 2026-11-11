/**
 * Half-Life Web Deathmatch maps. Every solid is an axis-aligned box [x0, y0, z0, x1, y1, z1, material];
 * the same list is the collision world on the server and in the browser (prediction) and the
 * render geometry. Each map also lists destructible props, spawns, pickups, bot waypoints (links
 * are computed from walkability at load time), lights and an atmosphere theme.
 *
 *   chamber   Test Chamber  - Black Mesa hall with a central pit, walkways and service corridors
 *   crossfire Crossfire     - open yard at dusk: two bunkers and a sniper tower
 *   reactor   Reactor Core  - three levels of catwalks around a glowing reactor column
 *   office    Office Block  - close quarters: offices, corridors, atrium and cubicle wings
 *   snowworld Snow World    - snowy team arena: two spawn decks, sniper towers, wooden fences you can shoot through
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HLMap = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Small geometry kit shared by the map builders. */
  function kit() {
    const B = [];
    const box = (x0, y0, z0, x1, y1, z1, mat) =>
      B.push([Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1), mat]);
    /**
     * A staircase of 0.5 m steps (0.6 m deep) leading down from a platform at height `top` whose
     * edge is at `start` on `axis`, going in direction `dir` until it reaches `base`.
     * `a0..a1` is its extent along the other horizontal axis.
     */
    const stairs = (axis, a0, a1, start, dir, base, top) => {
      const n = Math.round((top - base) / 0.5) - 1;
      for (let k = 0; k < n; k++) {
        const s0 = start + dir * 0.6 * k, s1 = start + dir * 0.6 * (k + 1), h = top - 0.5 * (k + 1);
        if (axis === 'z') box(a0, base, s0, a1, h, s1, 'stair'); else box(s0, base, a0, s1, h, a1, 'stair');
      }
    };
    return { B, box, stairs };
  }
  const faceCentre = list => list.map(([x, y, z]) => ({ x, y, z, yaw: Math.atan2(x, z) }));

  // =====================================================================================
  function chamber() {
    const { B, box } = kit();
    box(-24, -3.5, -24, 24, 0, -8, 'concrete');
    box(-24, -3.5, 8, 24, 0, 24, 'concrete');
    box(-24, -3.5, -8, -8, 0, 8, 'concrete');
    box(8, -3.5, -8, 24, 0, 8, 'concrete');
    box(-8, -4.5, -8, 8, -2.5, 8, 'pit');
    for (let k = 0; k < 4; k++) {
      box(-1.5, -2.5, -8 + 0.6 * k, 1.5, -0.5 - 0.5 * k, -7.4 + 0.6 * k, 'stair');
      box(-1.5, -2.5, 7.4 - 0.6 * k, 1.5, -0.5 - 0.5 * k, 8 - 0.6 * k, 'stair');
    }
    box(-4, -2.5, -1, -3, -1.3, 1, 'metal');
    box(3, -2.5, -1, 4, -1.3, 1, 'metal');
    box(-25, -3.5, -25, 25, 9, -24, 'wall');
    box(-25, -3.5, 24, 25, 9, 25, 'wall');
    box(-25, -3.5, -24, -24, 9, 24, 'wall');
    box(24, -3.5, -24, 25, 9, 24, 'wall');
    box(-25, 9, -25, 25, 9.5, 25, 'ceiling');
    for (const s of [-1, 1]) {
      const zIn = s * 20, zOut = s * 24;
      box(-20, 3.1, zIn, 20, 3.5, zOut, 'grate');
      box(-16, 3.5, zIn, 16, 4.5, zIn - s * 0.15, 'rail');
      for (const x of [-10, 0, 10]) box(x - 0.4, 0, zIn, x + 0.4, 3.1, zIn + s * 0.8, 'pillar');
      for (const [xa, xb] of [[16, 19.5], [-19.5, -16]]) {
        for (let k = 0; k < 6; k++) box(xa, 0, zIn - s * 0.6 * k, xb, 3.0 - 0.5 * k, zIn - s * 0.6 * (k + 1), 'stair');
      }
    }
    for (const s of [-1, 1]) {
      box(s * 19, 0, -14, s * 20, 4, -2, 'wall');
      box(s * 19, 0, 2, s * 20, 4, 14, 'wall');
      box(s * 19, 3, -2, s * 20, 4, 2, 'wall');
      box(s * 19, 4, -14, s * 24, 4.4, 14, 'metal');
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(sx * 13.5 - 0.6, 0, sz * 11 - 0.6, sx * 13.5 + 0.6, 9, sz * 11 + 0.6, 'pillar');
    box(-15, 0, -4, -13.8, 1.2, -2.8, 'crate'); box(-15, 0, -2.8, -13.8, 1.2, -1.6, 'crate'); box(-15, 1.2, -3.4, -13.8, 2.4, -2.2, 'crate');
    box(13.8, 0, 2.8, 15, 1.2, 4, 'crate'); box(13.8, 0, 1.6, 15, 1.2, 2.8, 'crate'); box(13.8, 1.2, 2.2, 15, 2.4, 3.4, 'crate');
    box(-6, 0, -22.6, -4.8, 1.2, -21.4, 'crate'); box(4.8, 0, 21.4, 6, 1.2, 22.6, 'crate');
    return {
      id: 'chamber', name: 'Test Chamber', BOXES: B,
      PROPS: [
        { type: 'crate', box: [-3, 0, -14, -1.8, 1.2, -12.8] }, { type: 'crate', box: [1.8, 0, 12.8, 3, 1.2, 14] },
        { type: 'crate', box: [10, 0, -16, 11.2, 1.2, -14.8] }, { type: 'crate', box: [-11.2, 0, 14.8, -10, 1.2, 16] },
        { type: 'barrel', box: [6, 0, -11, 6.8, 1.1, -10.2] }, { type: 'barrel', box: [-6.8, 0, 10.2, -6, 1.1, 11] },
        { type: 'barrel', box: [21, 0, -9, 21.8, 1.1, -8.2] }, { type: 'barrel', box: [-21.8, 0, 8.2, -21, 1.1, 9] },
        { type: 'barrel', box: [-6.5, -2.5, 5.5, -5.7, -1.4, 6.3] }, { type: 'barrel', box: [5.7, -2.5, -6.3, 6.5, -1.4, -5.5] },
      ],
      SPAWNS: faceCentre([[-16, 0, 6], [16, 0, -6], [-12, 0, -18], [12, 0, 18], [8, 3.5, -22], [-8, 3.5, 22],
                          [22, 0, -10], [-22, 0, 10], [-6, -2.5, -6], [6, -2.5, 6], [-22, 0, -21], [22, 0, 21]]),
      PICKUPS: [
        { type: 'weapon', w: 3, pos: [0, 3.5, -22] }, { type: 'weapon', w: 6, pos: [0, 3.5, 22] },
        { type: 'weapon', w: 5, pos: [-22, 0, 0] }, { type: 'weapon', w: 4, pos: [22, 0, 0] },
        { type: 'weapon', w: 7, pos: [0, -2.5, 0] }, { type: 'weapon', w: 8, pos: [-18, 3.5, 22.5] },
        { type: 'health', amt: 25, pos: [13.5, 0, 8.8] }, { type: 'health', amt: 25, pos: [-13.5, 0, -8.8] },
        { type: 'health', amt: 25, pos: [-6, -2.5, 0] }, { type: 'health', amt: 25, pos: [18, 3.5, -22] },
        { type: 'battery', amt: 15, pos: [-22, 0, -6] }, { type: 'battery', amt: 15, pos: [22, 0, 6] },
        { type: 'ammo', pos: [-12, 0, 18] }, { type: 'ammo', pos: [12, 0, -18] },
        { type: 'weapon', w: 9, pos: [12, 0, 18] }, { type: 'weapon', w: 10, pos: [-12, 0, -18] },
        { type: 'weapon', w: 11, pos: [-22, 0, 6] }, { type: 'weapon', w: 11, pos: [22, 0, -6] },
      ],
      WAYPOINTS: [
        [-17.7, 0, -15.5], [-17.7, 3.5, -22], [0, 3.5, -22], [17.7, 3.5, -22], [17.7, 0, -15.5],
        [-17.7, 0, 15.5], [-17.7, 3.5, 22], [0, 3.5, 22], [17.7, 3.5, 22], [17.7, 0, 15.5],
        [-12, 0, -14], [0, 0, -12], [12, 0, -14], [-12, 0, 14], [0, 0, 12], [12, 0, 14],
        [-11, 0, 4], [11, 0, -4], [-16, 0, -8], [16, 0, 8],
        [-22, 0, -17], [-22, 0, -8], [-22, 0, 0], [-22, 0, 8], [-22, 0, 17], [-17, 0, 0],
        [22, 0, -17], [22, 0, -8], [22, 0, 0], [22, 0, 8], [22, 0, 17], [17, 0, 0],
        [-9, 3.5, -22], [9, 3.5, -22], [-9, 3.5, 22], [9, 3.5, 22],
        [0, 0, -9.6], [0, -2.5, -4.5], [0, -2.5, 0], [0, 0, 9.6], [0, -2.5, 4.5],
        [-5, -2.5, -5], [5, -2.5, 5], [-5, -2.5, 5], [5, -2.5, -5],
      ],
      LIGHTS: [
        { pos: [0, 8.98, 0], color: 0xfff1d6, power: 2.4, range: 34, panel: true },
        { pos: [-14, 8.98, -12], color: 0xffd9a8, power: 1.2, range: 22, panel: true },
        { pos: [14, 8.98, 12], color: 0xffd9a8, power: 1.2, range: 22, panel: true },
        { pos: [14, 8.98, -12], color: 0xbfe6ff, power: 1.0, range: 22, panel: true },
        { pos: [-14, 8.98, 12], color: 0xbfe6ff, power: 1.0, range: 22, panel: true },
        { pos: [22, 3.2, 0], color: 0xff8a2a, power: 1.4, range: 12 },
        { pos: [-22, 3.2, 0], color: 0x2ad8ff, power: 1.4, range: 12 },
        { pos: [0, -1.2, 0], color: 0x9dff6a, power: 1.0, range: 10 },
      ],
      NEON: [
        [0x7dff6a, 0, -0.08, -8.02, 16, 0.06, 0.06], [0x7dff6a, 0, -0.08, 8.02, 16, 0.06, 0.06],
        [0x7dff6a, -8.02, -0.08, 0, 0.06, 0.06, 16], [0x7dff6a, 8.02, -0.08, 0, 0.06, 0.06, 16],
        [0xff8a2a, 19.5, 3.05, 0, 0.12, 0.08, 4], [0x2ad8ff, -19.5, 3.05, 0, 0.12, 0.08, 4],
      ],
      THEME: { bg: 0x0b0d10, fog: [22, 75], hemi: [0x9aa8b8, 0x2a2620, 0.55], ambient: 0.18, exposure: 1.15 },
    };
  }

  // =====================================================================================
  function crossfire() {
    const { B, box, stairs } = kit();
    box(-37, -1, -21, 37, 0, 21, 'dirt');
    box(-37, 0, -21, 37, 7, -20, 'brick'); box(-37, 0, 20, 37, 7, 21, 'brick');
    box(-37, 0, -20, -36, 7, 20, 'brick'); box(36, 0, -20, 37, 7, 20, 'brick');
    for (const s of [-1, 1]) {
      // bunker: raised firing platform, low parapet with a gap, roof on two pillars, stairs at both ends
      box(s * 27, 0, -9, s * 36, 3, 9, 'concrete');
      box(s * 27, 3, -9, s * 27.4, 4.1, -2.5, 'concrete'); box(s * 27, 3, 2.5, s * 27.4, 4.1, 9, 'concrete');
      box(s * 27, 3, -9, s * 27.6, 6.6, -8.4, 'pillar'); box(s * 27, 3, 8.4, s * 27.6, 6.6, 9, 'pillar');
      box(s * 26.6, 6.6, -9.4, s * 36, 7, 9.4, 'metal');
      stairs('z', s * 29.5, s * 32, 9, 1, 0, 3);
      stairs('z', s * 29.5, s * 32, -9, -1, 0, 3);
      // yard cover
      box(s * 12, 0, -8, s * 16, 1.1, -7.3, 'sandbag'); box(s * 12, 0, 7.3, s * 16, 1.1, 8, 'sandbag');
      box(s * 20, 0, -1.6, s * 20.8, 1.1, 1.6, 'sandbag');
      for (const sz of [-1, 1]) {
        box(s * 6, 0, sz * 14 - 0.4, s * 10, 1.2, sz * 14 + 0.4, 'concrete');
        box(s * 23, 0, sz * 15, s * 24.2, 1.2, sz * 16.2, 'crate');
      }
    }
    // central sniper tower: solid base, stairs east and west, parapets north and south, roof
    box(-3, 0, -3, 3, 4, 3, 'concrete');
    stairs('x', -1.25, 1.25, 3, 1, 0, 4);
    stairs('x', -1.25, 1.25, -3, -1, 0, 4);
    box(-3, 4, -3, 3, 5, -2.7, 'concrete'); box(-3, 4, 2.7, 3, 5, 3, 'concrete');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(sx * 3, 5, sz * 3, sx * 2.7, 8, sz * 2.7, 'pillar');
    box(-3.4, 8, -3.4, 3.4, 8.3, 3.4, 'metal');
    // two burnt-out trucks
    for (const sz of [-1, 1]) { box(-5, 0, sz * 12.6, 1.5, 2.6, sz * 14.8, 'truck'); box(1.5, 0, sz * 12.8, 3.6, 2.2, sz * 14.6, 'truck'); }
    return {
      id: 'crossfire', name: 'Crossfire', BOXES: B,
      PROPS: [
        { type: 'crate', box: [-18.6, 0, 3.4, -17.4, 1.2, 4.6] }, { type: 'crate', box: [17.4, 0, -4.6, 18.6, 1.2, -3.4] },
        { type: 'barrel', box: [-10.4, 0, -1.4, -9.6, 1.1, -0.6] }, { type: 'barrel', box: [9.6, 0, 0.6, 10.4, 1.1, 1.4] },
        { type: 'barrel', box: [-24.4, 0, -12.4, -23.6, 1.1, -11.6] }, { type: 'barrel', box: [23.6, 0, 11.6, 24.4, 1.1, 12.4] },
      ],
      SPAWNS: faceCentre([[-31, 3, -5], [31, 3, 5], [-32, 0, -16], [32, 0, 16], [-16, 0, -16], [16, 0, 16],
                          [-16, 0, 16], [16, 0, -16], [-9, 0, 4], [9, 0, -4], [-24, 0, 0], [24, 0, 0]]),
      PICKUPS: [
        { type: 'weapon', w: 8, pos: [0, 4, 0] }, { type: 'weapon', w: 7, pos: [0, 0, 18] },
        { type: 'weapon', w: 3, pos: [-31.5, 3, 0] }, { type: 'weapon', w: 6, pos: [31.5, 3, 0] },
        { type: 'weapon', w: 4, pos: [-20, 0, 12] }, { type: 'weapon', w: 5, pos: [20, 0, -12] },
        { type: 'health', amt: 25, pos: [12, 0, 0] }, { type: 'health', amt: 25, pos: [-12, 0, 0] }, { type: 'health', amt: 25, pos: [0, 0, -18] },
        { type: 'battery', amt: 15, pos: [-31.5, 3, 6] }, { type: 'battery', amt: 15, pos: [31.5, 3, -6] },
        { type: 'ammo', pos: [0, 0, -9] }, { type: 'ammo', pos: [0, 0, 9] },
        { type: 'weapon', w: 9, pos: [-20, 0, -12] }, { type: 'weapon', w: 10, pos: [20, 0, 12] },
        { type: 'weapon', w: 11, pos: [-12, 0, 6] }, { type: 'weapon', w: 11, pos: [12, 0, -6] },
      ],
      WAYPOINTS: [
        ...[-24, -18, -10, 0, 10, 18, 24].flatMap(x => [-17, -11, -5, 5, 11, 17].map(z => [x, 0, z])),
        [-8, 0, 0], [8, 0, 0], [-2, 4, 0], [2, 4, 0], [0, 4, 0],
        [-31, 3, -6], [-31, 3, 0], [-31, 3, 6], [31, 3, -6], [31, 3, 0], [31, 3, 6],
        [-30.75, 0, -13], [-30.75, 0, 13], [30.75, 0, -13], [30.75, 0, 13], [-30.75, 3, -8], [-30.75, 3, 8], [30.75, 3, -8], [30.75, 3, 8],
        [-24, 0, 0], [24, 0, 0],
      ],
      LIGHTS: [
        { pos: [-31, 6.2, 0], color: 0xffb070, power: 1.2, range: 14 }, { pos: [31, 6.2, 0], color: 0xffb070, power: 1.2, range: 14 },
        { pos: [0, 7.6, 0], color: 0xffd090, power: 1.0, range: 12 },
      ],
      NEON: [],
      THEME: { bg: 0xb08a68, fog: [45, 150], hemi: [0xffdcb0, 0x5a4a38, 0.8], ambient: 0.25, exposure: 1.0,
               sun: { pos: [-40, 55, 25], color: 0xffc890, intensity: 2.4 }, sky: [0x3a4a6a, 0xd89a64] },
    };
  }

  // =====================================================================================
  function reactor() {
    const { B, box, stairs } = kit();
    box(-21, -1, -21, 21, 0, 21, 'metalfloor');
    box(-21, 0, -21, 21, 15, -20, 'wall'); box(-21, 0, 20, 21, 15, 21, 'wall');
    box(-21, 0, -20, -20, 15, 20, 'wall'); box(20, 0, -20, 21, 15, 20, 'wall');
    box(-21, 15, -21, 21, 15.5, 21, 'ceiling');
    box(-3, 0, -3, 3, 15, 3, 'reactor');
    // level 1 (y = 5): ring around the core, balconies north and south, bridges between them
    box(-7, 4.6, -7, 7, 5, -4, 'grate'); box(-7, 4.6, 4, 7, 5, 7, 'grate');
    box(-7, 4.6, -4, -4, 5, 4, 'grate'); box(4, 4.6, -4, 7, 5, 4, 'grate');
    box(-20, 4.6, -20, 20, 5, -16, 'grate'); box(-20, 4.6, 16, 20, 5, 20, 'grate');
    box(-1.25, 4.6, -16, 1.25, 5, -7, 'grate'); box(-1.25, 4.6, 7, 1.25, 5, 16, 'grate');
    stairs('z', 15, 17.5, -16, 1, 0, 5); stairs('z', -17.5, -15, -16, 1, 0, 5);
    stairs('z', 15, 17.5, 16, -1, 0, 5); stairs('z', -17.5, -15, 16, -1, 0, 5);
    // level 2 (y = 10): balconies east and west, upper ring, bridges
    box(16, 9.6, -20, 20, 10, 20, 'grate'); box(-20, 9.6, -20, -16, 10, 20, 'grate');
    box(-6.5, 9.6, -6.5, 6.5, 10, -4, 'grate'); box(-6.5, 9.6, 4, 6.5, 10, 6.5, 'grate');
    box(-6.5, 9.6, -4, -4, 10, 4, 'grate'); box(4, 9.6, -4, 6.5, 10, 4, 'grate');
    box(6.5, 9.6, -1.25, 16, 10, 1.25, 'grate'); box(-16, 9.6, -1.25, -6.5, 10, 1.25, 'grate');
    stairs('x', -19.5, -17, 16, -1, 5, 10);
    stairs('x', 17, 19.5, -16, 1, 5, 10);
    // ground clutter
    box(-14, 0, -6, -6, 1.2, -5, 'pipe'); box(6, 0, 5, 14, 1.2, 6, 'pipe');
    box(-14, 0, 8, -11, 2.6, 11, 'tank'); box(11, 0, -11, 14, 2.6, -8, 'tank');
    box(10, 0, 10, 11.2, 1.2, 11.2, 'crate'); box(-11.2, 0, -11.2, -10, 1.2, -10, 'crate');
    return {
      id: 'reactor', name: 'Reactor Core', BOXES: B,
      PROPS: [
        { type: 'barrel', box: [-8.4, 0, 12.6, -7.6, 1.1, 13.4] }, { type: 'barrel', box: [7.6, 0, -13.4, 8.4, 1.1, -12.6] },
        { type: 'barrel', box: [17, 5, -18.4, 17.8, 6.1, -17.6] }, { type: 'barrel', box: [-17.8, 5, 17.6, -17, 6.1, 18.4] },
        { type: 'crate', box: [-3.6, 0, 12, -2.4, 1.2, 13.2] }, { type: 'crate', box: [2.4, 0, -13.2, 3.6, 1.2, -12] },
      ],
      SPAWNS: faceCentre([[-17, 0, 4], [17, 0, -4], [-10, 0, -18], [10, 0, 18], [-6, 5, -18], [6, 5, 18],
                          [18, 10, 4], [-18, 10, -4], [0, 5, -5.5], [0, 5, 5.5], [12, 0, -4], [-12, 0, 4]]),
      PICKUPS: [
        { type: 'weapon', w: 8, pos: [0, 10, -5.25] }, { type: 'weapon', w: 7, pos: [0, 0, -12] },
        { type: 'weapon', w: 4, pos: [-10, 5, -18] }, { type: 'weapon', w: 5, pos: [10, 5, 18] },
        { type: 'weapon', w: 6, pos: [-18, 10, 8] }, { type: 'weapon', w: 3, pos: [18, 10, -8] },
        { type: 'health', amt: 25, pos: [0, 5, -11] }, { type: 'health', amt: 25, pos: [0, 5, 11] },
        { type: 'health', amt: 25, pos: [-12, 0, 0] }, { type: 'health', amt: 25, pos: [12, 0, 0] },
        { type: 'battery', amt: 15, pos: [18, 10, 10] }, { type: 'battery', amt: 15, pos: [-18, 10, -10] },
        { type: 'ammo', pos: [-12, 0, -15] }, { type: 'ammo', pos: [12, 0, 15] },
        { type: 'weapon', w: 9, pos: [12, 0, -15] }, { type: 'weapon', w: 10, pos: [-12, 0, 15] },
        { type: 'weapon', w: 11, pos: [-12, 0, 4] }, { type: 'weapon', w: 11, pos: [12, 0, -4] },
      ],
      WAYPOINTS: [
        ...[-17, -10, -5, 5, 10, 17].flatMap(x => [-17, -10, -5, 5, 10, 17].map(z => [x, 0, z])),
        [-17, 0, 0], [17, 0, 0], [0, 0, -17], [0, 0, 17], [-8, 0, 0], [8, 0, 0], [0, 0, -8], [0, 0, 8],
        [16.25, 0, -9.5], [-16.25, 0, -9.5], [16.25, 0, 9.5], [-16.25, 0, 9.5],
        [16.25, 5, -18], [-16.25, 5, -18], [16.25, 5, 18], [-16.25, 5, 18], [0, 5, -18], [0, 5, 18],
        [8, 5, -18], [-8, 5, -18], [8, 5, 18], [-8, 5, 18], [0, 5, -11], [0, 5, 11],
        [0, 5, -5.5], [0, 5, 5.5], [-5.5, 5, 0], [5.5, 5, 0], [-5.5, 5, -5.5], [5.5, 5, 5.5], [-5.5, 5, 5.5], [5.5, 5, -5.5],
        [9.5, 5, -18.25], [-9.5, 5, 18.25], [18, 10, -18.25], [-18, 10, 18.25],
        [18, 10, -10], [18, 10, 0], [18, 10, 10], [-18, 10, -10], [-18, 10, 0], [-18, 10, 10],
        [11, 10, 0], [-11, 10, 0], [5.25, 10, 0], [-5.25, 10, 0], [0, 10, 5.25], [0, 10, -5.25],
        [5.25, 10, 5.25], [-5.25, 10, -5.25], [5.25, 10, -5.25], [-5.25, 10, 5.25],
      ],
      LIGHTS: [
        { pos: [0, 2, -4], color: 0x4dffd2, power: 2.0, range: 16 }, { pos: [0, 2, 4], color: 0x4dffd2, power: 2.0, range: 16 },
        { pos: [0, 12, -4], color: 0x7dff6a, power: 1.8, range: 16 }, { pos: [0, 12, 4], color: 0x7dff6a, power: 1.8, range: 16 },
        { pos: [-12, 14.9, -12], color: 0xd8f0ff, power: 1.2, range: 22, panel: true }, { pos: [12, 14.9, 12], color: 0xd8f0ff, power: 1.2, range: 22, panel: true },
        { pos: [12, 14.9, -12], color: 0xd8f0ff, power: 1.0, range: 22, panel: true }, { pos: [-12, 14.9, 12], color: 0xd8f0ff, power: 1.0, range: 22, panel: true },
        { pos: [0, 4.2, -18], color: 0xff8a2a, power: 1.0, range: 12 }, { pos: [0, 4.2, 18], color: 0xff8a2a, power: 1.0, range: 12 },
      ],
      NEON: [
        [0x4dffd2, 0, 5.02, -7.02, 14, 0.06, 0.06], [0x4dffd2, 0, 5.02, 7.02, 14, 0.06, 0.06],
        [0x7dff6a, 0, 10.02, -6.52, 13, 0.06, 0.06], [0x7dff6a, 0, 10.02, 6.52, 13, 0.06, 0.06],
      ],
      THEME: { bg: 0x040808, fog: [20, 62], hemi: [0x6aa0a0, 0x101414, 0.45], ambient: 0.12, exposure: 1.2 },
    };
  }

  // =====================================================================================
  function office() {
    const { B, box } = kit();
    const H = 3.6;
    box(-23, -1, -17, 23, 0, 17, 'carpet');
    box(-23, 0, -17, 23, H, -16, 'plaster'); box(-23, 0, 16, 23, H, 17, 'plaster');
    box(-23, 0, -16, -22, H, 16, 'plaster'); box(22, 0, -16, 23, H, 16, 'plaster');
    box(-23, H, -17, 23, H + 0.4, 17, 'ceilingtile');
    const doors = [-10.5, -3.5, 3.5, 10.5];
    for (const s of [-1, 1]) {
      // office row: front wall with four doorways, dividers, wing separators
      const z0 = s * 8.15, z1 = s * 7.85;
      for (const [a, b] of [[-14, -11.5], [-9.5, -4.5], [-2.5, 2.5], [4.5, 9.5], [11.5, 14]]) box(a, 0, z0, b, H, z1, 'plaster');
      for (const xc of doors) box(xc - 1, 2.4, z0, xc + 1, H, z1, 'plaster');
      for (const x of [-7, 0, 7, -14, 14]) box(x - 0.15, 0, s * 16, x + 0.15, H, z0, 'plaster');
      // desks + cabinets (the north 0..7 office is the server room)
      for (const xc of doors) {
        if (s < 0 && xc === 3.5) continue;
        box(xc - 1.2, 0, s * 14.8, xc + 1.2, 0.78, s * 13.8, 'wood');
        box(xc + 2.2, 0, s * 15.9, xc + 3, 1.3, s * 15.3, 'metal');
      }
      // cubicle wings
      for (const wx of [-1, 1]) {
        for (const z of [-12, -6, 6, 12]) {
          box(wx * 16, 0, z - 0.08, wx * 20.5, 1.5, z + 0.08, 'cubicle');
          box(wx * 16.5, 0, z + 0.5, wx * 18.5, 0.78, z + 1.3, 'wood');
        }
      }
    }
    box(1, 0, -15.4, 6, 2.1, -14.6, 'rack'); box(1, 0, -12.6, 6, 2.1, -11.8, 'rack');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(sx * 7.3, 0, sz * 4.8, sx * 6.7, H, sz * 4.2, 'pillar');
    box(-5, 0, -0.6, -3, 0.8, 0.6, 'planter'); box(3, 0, -0.6, 5, 0.8, 0.6, 'planter');
    const lights = [];
    for (const [x, z] of [[0, 0], [-10.5, -12], [10.5, -12], [-10.5, 12], [10.5, 12], [-3.5, 12], [3.5, -13], [-18, -9], [18, 9], [-18, 9], [18, -9], [-12, 6.5], [12, -6.5]]) {
      lights.push({ pos: [x, H - 0.03, z], color: x === 3.5 && z === -13 ? 0x9fd8ff : 0xfff2dc, power: 0.9, range: 12, panel: true });
    }
    return {
      id: 'office', name: 'Office Block', BOXES: B,
      PROPS: [
        { type: 'barrel', box: [8.6, 0, -6.8, 9.4, 1.1, -6] }, { type: 'barrel', box: [-9.4, 0, 6, -8.6, 1.1, 6.8] },
        { type: 'crate', box: [-6.6, 0, 8.6, -5.4, 1.2, 9.8] }, { type: 'crate', box: [20.4, 0, -15.6, 21.6, 1.2, -14.4] },
        { type: 'crate', box: [-21.6, 0, 14.4, -20.4, 1.2, 15.6] },
      ],
      SPAWNS: faceCentre([[-12, 0, -10], [12, 0, 10], [-2, 0, -10], [2, 0, 10], [19, 0, 14], [-19, 0, -14],
                          [19, 0, -14], [-19, 0, 14], [10, 0, -6.5], [-10, 0, 6.5], [6, 0, 2], [-6, 0, -2]]),
      PICKUPS: [
        { type: 'weapon', w: 5, pos: [0, 0, 0] }, { type: 'weapon', w: 8, pos: [21, 0, 0] },
        { type: 'weapon', w: 7, pos: [3.5, 0, -13.2] }, { type: 'weapon', w: 4, pos: [-18, 0, -9] },
        { type: 'weapon', w: 3, pos: [-3.5, 0, 11.5] }, { type: 'weapon', w: 6, pos: [10.5, 0, 12] },
        { type: 'health', amt: 25, pos: [-10.5, 0, -11] }, { type: 'health', amt: 25, pos: [10.5, 0, -11] },
        { type: 'health', amt: 25, pos: [18, 0, 9] }, { type: 'health', amt: 25, pos: [-18, 0, -3] },
        { type: 'battery', amt: 15, pos: [-3.5, 0, -11] }, { type: 'battery', amt: 15, pos: [3.5, 0, 11] },
        { type: 'ammo', pos: [-18, 0, 3] }, { type: 'ammo', pos: [18, 0, -3] },
        { type: 'weapon', w: 9, pos: [-18, 0, 9] }, { type: 'weapon', w: 10, pos: [18, 0, -9] },
        { type: 'weapon', w: 11, pos: [-10.5, 0, 11] }, { type: 'weapon', w: 11, pos: [10.5, 0, 11] },
      ],
      WAYPOINTS: [
        ...[-20, -14, -10.5, -7, -3.5, 0, 3.5, 7, 10.5, 14, 20].flatMap(x => [[x, 0, -6.5], [x, 0, 6.5]]),
        [0, 0, -2.5], [0, 0, 2.5], [-5, 0, -2.5], [5, 0, 2.5], [-5, 0, 2.5], [5, 0, -2.5], [-10, 0, 0], [10, 0, 0],
        ...doors.flatMap(x => [[x, 0, -11.5], [x, 0, 11.5], [x, 0, -8.8], [x, 0, 8.8]]),
        ...[-21, -18, -15, 15, 18, 21].flatMap(x => [-14, -9, -3, 0, 3, 9, 14].map(z => [x, 0, z])),
      ],
      LIGHTS: lights,
      NEON: [],
      THEME: { bg: 0x16181b, fog: [16, 60], hemi: [0xfff2dc, 0x40382c, 0.5], ambient: 0.2, exposure: 0.85 },
    };
  }

  // =====================================================================================
  // Snow World: a snowy fan-map style arena. Terrorists spawn on the north deck, CTs on the south one;
  // long sniper lanes down the middle, wooden fences and crates you can shoot through (AK / M4 / AWP),
  // thick stone side walls you cannot.
  function snowworld() {
    const { B, box, stairs } = kit();
    const mz = (x0, y0, z0, x1, y1, z1, mat) => { box(x0, y0, z0, x1, y1, z1, mat); box(x0, y0, -z0, x1, y1, -z1, mat); };
    const mxz = (x0, y0, z0, x1, y1, z1, mat) => { mz(x0, y0, z0, x1, y1, z1, mat); mz(-x0, y0, z0, -x1, y1, z1, mat); };
    box(-26, -1, -46, 26, 0, 46, 'snow');
    box(-26, 0, -46, -24, 9, 46, 'rockwall'); box(24, 0, -46, 26, 9, 46, 'rockwall');
    mz(-24, 0, -46, 24, 9, -44, 'rockwall');
    // spawn decks (2.5 m) with a railing, three staircases down to the field
    mz(-24, 0, -44, 24, 2.5, -37, 'woodfloor');
    for (const [a0, a1] of [[-24, -15], [-11, -2], [2, 11], [15, 24]]) mz(a0, 2.5, -37.3, a1, 3.5, -37, 'woodwall');
    for (const [a0, a1] of [[-15, -11], [-2, 2], [11, 15]]) { stairs('z', a0, a1, -37, 1, 0, 2.5); stairs('z', a0, a1, 37, -1, 0, 2.5); }
    // corner sniper towers (5 m) reached by steps along the deck
    mxz(-24, 2.5, -44, -19, 5, -40, 'woodfloor');
    mxz(-24, 5, -40.3, -19, 6, -40, 'woodwall');
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
      const z0 = sz < 0 ? -44 : 41, z1 = sz < 0 ? -41 : 44;
      for (let k = 0; k < 4; k++) {
        const xa = sx * (19 - 0.6 * k), xb = sx * (19 - 0.6 * (k + 1)), h = 5 - 0.5 * (k + 1);       // down toward the middle
        if (h > 2.5) box(xa, 2.5, z0, xb, h, z1, 'stair');
      }
    }
    // the field: crate stacks, snowbanks, thin wooden fences (wallbang), stone side walls with doors
    mxz(-4.2, 0, -14.2, -1.8, 2.4, -11.8, 'woodcrate'); mxz(-4.2, 2.4, -14.2, -3, 3.6, -13, 'woodcrate');
    mxz(-11.2, 0, -6.2, -8.8, 2.4, -3.8, 'woodcrate'); mxz(-11.2, 0, -3.8, -10, 1.2, -2.6, 'woodcrate');
    mxz(-18.2, 0, -26.2, -15.8, 2.4, -23.8, 'woodcrate');
    mxz(-20, 0, -8.6, -16, 1.1, -7.4, 'snowbank'); mxz(-7, 0, -1.6, -3, 1.1, -0.4, 'snowbank');
    mxz(-14, 0, -22.15, -6, 2.8, -21.85, 'woodwall');
    mz(-3, 0, -30.15, 3, 2.8, -29.85, 'woodwall');
    mxz(-14.7, 0, -32, -13.3, 4, -26, 'rockwall'); mxz(-14.7, 0, -20, -13.3, 4, -10, 'rockwall');
    mxz(-1.2, 0, -0.6, 1.2, 1.2, 0.6, 'woodcrate');
    const T = [[-14, 2.5, -41], [-9, 2.5, -39.5], [-4, 2.5, -41], [4, 2.5, -39.5], [9, 2.5, -41], [14, 2.5, -39.5]];
    const CT = T.map(([x, y, z]) => [-x, y, -z]);
    const tSp = T.map(([x, y, z]) => ({ x, y, z, yaw: Math.PI })), ctSp = CT.map(([x, y, z]) => ({ x, y, z, yaw: 0 }));
    const lights = [];
    for (const z of [-40, 40]) for (const x of [-14, 0, 14]) lights.push({ pos: [x, 7, z], color: 0xffe6c8, power: 0.8, range: 14 });
    return {
      id: 'snowworld', name: 'Snow World', BOXES: B,
      PROPS: [
        { type: 'crate', box: [-8.6, 0, 15.4, -7.4, 1.2, 16.6] }, { type: 'crate', box: [7.4, 0, -16.6, 8.6, 1.2, -15.4] },
        { type: 'barrel', box: [-19.4, 0, 1.6, -18.6, 1.1, 2.4] }, { type: 'barrel', box: [18.6, 0, -2.4, 19.4, 1.1, -1.6] },
      ],
      SPAWNS: [...tSp, ...ctSp],
      TEAM_SPAWNS: [tSp, ctSp],
      PICKUPS: [
        { type: 'weapon', w: 9, pos: [-8, 2.5, -42.5] }, { type: 'weapon', w: 10, pos: [8, 2.5, 42.5] },
        { type: 'weapon', w: 8, pos: [-21.5, 5, -42.5] }, { type: 'weapon', w: 8, pos: [21.5, 5, 42.5] },
        { type: 'weapon', w: 10, pos: [-19, 0, -14] }, { type: 'weapon', w: 9, pos: [19, 0, 14] },
        { type: 'weapon', w: 5, pos: [19, 0, -14] }, { type: 'weapon', w: 4, pos: [-19, 0, 14] },
        { type: 'weapon', w: 11, pos: [0, 2.5, -42.5] }, { type: 'weapon', w: 11, pos: [0, 2.5, 42.5] },
        { type: 'weapon', w: 11, pos: [-6, 0, 0] }, { type: 'weapon', w: 11, pos: [6, 0, 0] },
        { type: 'health', amt: 25, pos: [-20, 0, 0] }, { type: 'health', amt: 25, pos: [20, 0, 0] },
        { type: 'battery', amt: 15, pos: [0, 0, -18] }, { type: 'battery', amt: 15, pos: [0, 0, 18] },
        { type: 'ammo', pos: [-12, 0, -34] }, { type: 'ammo', pos: [12, 0, 34] }, { type: 'ammo', pos: [-14, 0, 0] }, { type: 'ammo', pos: [14, 0, 0] },
      ],
      WAYPOINTS: [
        ...[-20, -12, -6, 0, 6, 12, 20].flatMap(x => [-33, -26, -18, -10, -4, 4, 10, 18, 26, 33].map(z => [x, 0, z])),
        ...[-14, -9, -4, 4, 9, 14].flatMap(x => [[x, 2.5, -40.5], [x, 2.5, 40.5]]),
        ...[-13, 0, 13].flatMap(x => [[x, 0, -33.6], [x, 2.5, -38.2], [x, 0, 33.6], [x, 2.5, 38.2]]),
        [-21.5, 5, -42.5], [21.5, 5, -42.5], [-21.5, 5, 42.5], [21.5, 5, 42.5],
        [-15.5, 2.5, -42.5], [15.5, 2.5, -42.5], [-15.5, 2.5, 42.5], [15.5, 2.5, 42.5], [-17.8, 3.75, -42.5], [17.8, 3.75, -42.5], [-17.8, 3.75, 42.5], [17.8, 3.75, 42.5],
        [-19, 0, -14], [19, 0, -14], [-19, 0, 14], [19, 0, 14], [-19, 0, -23], [19, 0, -23], [-19, 0, 23], [19, 0, 23],
      ],
      LIGHTS: lights,
      NEON: [],
      THEME: { bg: 0xdfe7ee, fog: [45, 150], hemi: [0xf2f6ff, 0x8c96a4, 1.05], ambient: 0.35, exposure: 0.95,
               sun: { pos: [30, 60, 25], color: 0xfff4e6, intensity: 2.3 }, sky: [0x7fa6d4, 0xe9eff6], snow: true },
    };
  }

  const MAPS = { chamber: chamber(), crossfire: crossfire(), reactor: reactor(), office: office(), snowworld: snowworld() };
  const IDS = ['chamber', 'crossfire', 'reactor', 'office', 'snowworld'];
  // team mode: maps without explicit sides split their spawns in two halves along the axis they spread
  // out most on (Crossfire: west bunker vs east bunker; the others: north vs south)
  for (const id of IDS) {
    const m = MAPS[id];
    if (m.TEAM_SPAWNS) continue;
    const span = k => Math.max(...m.SPAWNS.map(s => s[k])) - Math.min(...m.SPAWNS.map(s => s[k]));
    const ax = span('x') > span('z') ? 'x' : 'z', other = ax === 'x' ? 'z' : 'x';
    const sorted = [...m.SPAWNS].sort((a, b) => a[ax] - b[ax] || a[other] - b[other]), half = Math.ceil(sorted.length / 2);
    m.TEAM_SPAWNS = [sorted.slice(0, half), sorted.slice(half)];
  }
  return { MAPS, IDS, DEFAULT: 'chamber' };
});
