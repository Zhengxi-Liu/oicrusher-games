/**
 * Rooftop Tag - the arena "Neon High": three school rooftops at night, mirrored along z.
 * Team Magenta's base is the north building (z < 0), team Cyan's the south one (z > 0).
 *
 *   base roof (y 0)  |  void gap  |  middle gym roof (y 0)  |  void gap  |  base roof
 *   - each base: stairwell penthouse with ramps to a sniper perch, AC units, flag alcove, spawns
 *   - gaps: a glass bridge in the middle, jump pads near both sides, a neon grapple beam overhead
 *   - middle: gym block with slide ramps up to the skylight, raised side decks with ramps,
 *     tall billboard walls to wall-run along, grapple beams and billboards over the void
 *
 * Boxes: [x0, y0, z0, x1, y1, z1, material, anchor?]  (anchor = the grappling hook can bite)
 * Ramps: {box, axis, dir, mat}  Pads: {box: [x0, y, z0, x1, z1], v}  - see shared/Movement.js
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RTMap = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  let BOXES, RAMPS, PADS, NEON, LIGHTS, WAYPOINTS;
  /** Start a new map: the helpers below write into fresh arrays. */
  const begin = () => { BOXES = []; RAMPS = []; PADS = []; NEON = []; LIGHTS = []; WAYPOINTS = []; };

  const box = (x0, y0, z0, x1, y1, z1, mat, anchor) =>
    BOXES.push([Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1), mat, anchor ? 1 : 0]);
  /** Add a box and its mirror image across z = 0 (the other team's side). */
  const boxZ = (x0, y0, z0, x1, y1, z1, mat, anchor) => { box(x0, y0, z0, x1, y1, z1, mat, anchor); box(x0, y0, -z0, x1, y1, -z1, mat, anchor); };
  /** ... and also across x = 0. */
  const boxX = (x0, y0, z0, x1, y1, z1, mat, anchor) => { box(x0, y0, z0, x1, y1, z1, mat, anchor); box(-x0, y0, z0, -x1, y1, z1, mat, anchor); };
  const boxXZ = (x0, y0, z0, x1, y1, z1, mat, anchor) => { boxZ(x0, y0, z0, x1, y1, z1, mat, anchor); boxZ(-x0, y0, z0, -x1, y1, z1, mat, anchor); };
  const ramp = (x0, y0, z0, x1, y1, z1, axis, dir, mat = 'ramp') =>
    RAMPS.push({ box: [Math.min(x0, x1), y0, Math.min(z0, z1), Math.max(x0, x1), y1, Math.max(z0, z1)], axis, dir, mat });
  const rampZ = (x0, y0, z0, x1, y1, z1, axis, dir, mat) => { ramp(x0, y0, z0, x1, y1, z1, axis, dir, mat); ramp(x0, y0, -z0, x1, y1, -z1, axis, axis === 'z' ? -dir : dir, mat); };
  const rampXZ = (x0, y0, z0, x1, y1, z1, axis, dir, mat) => { rampZ(x0, y0, z0, x1, y1, z1, axis, dir, mat); rampZ(-x0, y0, z0, -x1, y1, z1, axis, axis === 'x' ? -dir : dir, mat); };
  const padZ = (x0, y, z0, x1, z1, v) => {
    PADS.push({ box: [Math.min(x0, x1), y, Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1)], v });
    PADS.push({ box: [Math.min(x0, x1), y, Math.min(-z0, -z1), Math.max(x0, x1), Math.max(-z0, -z1)], v: [v[0], v[1], -v[2]] });
  };
  const neonZ = (color, x, y, z, sx, sy, sz) => { NEON.push([color, x, y, z, sx, sy, sz]); NEON.push([color === 0xff2fb4 ? 0x22e6ff : color === 0x22e6ff ? 0xff2fb4 : color, x, y, -z, sx, sy, sz]); };
  const wpZ = (x, y, z) => { WAYPOINTS.push([x, y, z]); if (z) WAYPOINTS.push([x, y, -z]); };

  const MAG = 0xff2fb4, CYAN = 0x22e6ff, WHITE = 0xe8f4ff, AMBER = 0xffb02a;
  const MAPS = {};

  // =====================================================================================
  // Map 1: "Neon High" - rainy night
  // =====================================================================================
  begin();

  // ===================== base buildings (Magenta north, mirrored to Cyan south)
  boxZ(-15, -40, -52, 15, 0, -30, 'roof');                       // the building itself
  // parapets: back and sides solid, front with gaps for the bridge and the jump pads
  boxZ(-15, 0, -52, 15, 1.0, -51.6, 'parapet');
  boxXZ(14.6, 0, -51.6, 15, 1.0, -30, 'parapet');
  boxXZ(8.4, 0, -30.4, 2.4, 1.0, -30, 'parapet');
  boxXZ(12, 0, -30.4, 15, 0.7, -30, 'parapet');                 // low curb: pad flights clear it, runners don't walk off
  // stairwell penthouse with a sniper perch on top, ramps up both sides
  boxZ(-6, 0, -51.6, 6, 4.5, -47, 'penthouse');
  boxZ(-6, 4.5, -47.2, 6, 5.4, -47, 'rail');
  rampXZ(6, 0, -51.6, 12, 4.5, -49, 'x', -1);
  // cover: AC units, low barriers in front of the flag, a vent stack
  boxXZ(8, 0, -44, 11, 1.5, -41, 'ac');
  boxXZ(1.2, 0, -36.2, 4.2, 1.1, -35.6, 'barrier');
  boxXZ(5.6, 0, -38.5, 7, 2.6, -37, 'vent');
  // the flag alcove: two short walls either side of the flag
  boxXZ(2.6, 0, -45, 3.0, 2.2, -40, 'wall');

  // ===================== gaps between the buildings (z -30 .. -18)
  box(-2.2, -0.35, -30, 2.2, 0, -18, 'glass');                   // glass bridges
  box(-2.2, -0.35, 18, 2.2, 0, 30, 'glass');
  boxXZ(2.2, 0, -30, 2.4, 1.1, -18, 'glassrail');
  // overhead grapple beam and its pylons (the pylons stand in the void)
  boxZ(-15.4, 7, -24.2, 15.4, 7.4, -23.8, 'beam', true);
  boxXZ(15.4, -40, -24.3, 16, 7.6, -23.7, 'pylon');
  // jump pads at the gap edges: base -> middle and middle -> base
  // (the two directions use different lanes so a landing runner is never bounced straight back)
  padZ(8.6, 0, -32.2, 11.2, -30.6, [0, 11.5, 14]);
  padZ(-11.2, 0, -32.2, -8.6, -30.6, [0, 11.5, 14]);
  padZ(12.2, 0, -17.4, 14.6, -15.8, [0, 11.5, -14]);
  padZ(-14.6, 0, -17.4, -12.2, -15.8, [0, 11.5, -14]);

  // ===================== middle building: the school gym (z -18 .. 18)
  box(-18, -40, -18, 18, 0, 18, 'roof');
  boxXZ(15, 0, -18, 18, 1.0, -17.6, 'parapet');
  boxXZ(8.4, 0, -18, 2.4, 1.0, -17.6, 'parapet');
  boxXZ(8.4, 0, -18, 12, 0.7, -17.6, 'parapet');
  boxXZ(17.6, 0, -17.6, 18, 1.0, -10, 'parapet');
  boxXZ(17.6, 0, -10, 18, 4.2, -0.1, 'billboard');                // tall neon walls: wall-run along them
  // gym block with the skylight on top, slide ramps north and south
  box(-6, 0, -5, 6, 3.5, 5, 'gym');
  boxXZ(-6, 3.5, -5, -5.6, 4.3, -2.6, 'rail');
  boxXZ(-6, 3.5, 2.6, -5.6, 4.3, 5, 'rail');
  rampZ(-2.6, 0, -13, 2.6, 3.5, -5, 'z', 1);
  // raised side decks with ramps from both ends
  boxX(10, 0, -4, 16, 2.2, 4, 'deck');
  rampXZ(11, 0, -10, 15, 2.2, -4, 'z', 1);
  // cover on the gym roof
  boxXZ(12, 0, -15, 15, 1.4, -12.5, 'ac');
  boxXZ(5, 0, -12, 7.5, 1.2, -9.5, 'ac');
  boxXZ(7.5, 0, 6.2, 9, 2.4, 7.4, 'vent');
  // grapple beam across the middle on two light poles, billboards over the void
  box(-12.6, 9, -0.25, 12.6, 9.4, 0.25, 'beam', true);
  boxX(12.6, 2.2, -0.3, 13.2, 9.6, 0.3, 'pylon');
  boxXZ(21.5, -40, -12.2, 22, 12, -0.4, 'pylon');
  boxXZ(21.4, 12, -12.4, 22.1, 12.4, -0.2, 'beam', true);
  boxXZ(21.3, 4, -12, 21.5, 11.8, -0.6, 'sign');

  // ===================== flags, spawns
  const FLAGS = [{ team: 0, pos: [0, 0, -42] }, { team: 1, pos: [0, 0, 42] }];
  const SPAWNS = [
    [[-12.8, 0, -48], [12.8, 0, -48], [-4, 0, -45.5], [4, 0, -45.5], [-12.5, 0, -40], [12.5, 0, -40]].map(([x, y, z]) => ({ x, y, z, yaw: Math.PI })),
    [[-12.8, 0, 48], [12.8, 0, 48], [-4, 0, 45.5], [4, 0, 45.5], [-12.5, 0, 40], [12.5, 0, 40]].map(([x, y, z]) => ({ x, y, z, yaw: 0 })),
  ];

  // ===================== neon trims and lights (decoration only)
  neonZ(MAG, 0, 1.02, -51.8, 30, 0.05, 0.08);
  neonZ(MAG, -14.8, 1.02, -41, 0.08, 0.05, 22);
  neonZ(MAG, 14.8, 1.02, -41, 0.08, 0.05, 22);
  neonZ(MAG, 0, 4.4, -46.95, 12, 0.08, 0.06);
  neonZ(MAG, 0, 0.03, -42, 2.6, 0.02, 0.06);
  neonZ(WHITE, -2.25, 1.12, -24, 0.06, 0.04, 12);
  neonZ(WHITE, 2.25, 1.12, -24, 0.06, 0.04, 12);
  neonZ(AMBER, 0, 6.95, -24, 30.8, 0.05, 0.5);
  neonZ(CYAN, 0, 3.52, -5.02, 12, 0.06, 0.06);
  neonZ(MAG, -17.55, 4.15, -5, 0.06, 0.08, 9.8);
  neonZ(CYAN, 17.55, 4.15, -5, 0.06, 0.08, 9.8);
  neonZ(AMBER, 0, 8.95, 0, 25, 0.05, 0.5);

  LIGHTS.push(
    { pos: [0, 4, -42], color: MAG, power: 2.4, range: 16 }, { pos: [0, 4, 42], color: CYAN, power: 2.4, range: 16 },
    { pos: [0, 7.5, -38], color: 0xb46cff, power: 1.4, range: 22 }, { pos: [0, 7.5, 38], color: 0x6c9cff, power: 1.4, range: 22 },
    { pos: [0, 6, -24], color: AMBER, power: 1.4, range: 14 }, { pos: [0, 6, 24], color: AMBER, power: 1.4, range: 14 },
    { pos: [-14, 6, 0], color: MAG, power: 2.0, range: 18 }, { pos: [14, 6, 0], color: CYAN, power: 2.0, range: 18 },
    { pos: [0, 8, -10], color: 0x9fd8ff, power: 1.2, range: 16 }, { pos: [0, 8, 10], color: 0xff9fe0, power: 1.2, range: 16 },
  );

  // ===================== bot waypoints (links are computed from walkability; pads add one-way links)
  for (const x of [-12, -6, 0, 6, 12]) for (const z of [-46, -40, -34, -31.5]) wpZ(x, 0, z);
  wpZ(-13.2, 0, -50.3); wpZ(13.2, 0, -50.3); wpZ(-9, 2.25, -50.3); wpZ(9, 2.25, -50.3); wpZ(-5, 4.5, -50); wpZ(5, 4.5, -50); wpZ(0, 4.5, -49);
  wpZ(0, 0, -27); wpZ(0, 0, -24); wpZ(0, 0, -21);
  for (const x of [-15, -10, -4.5, 4.5, 10, 15]) for (const z of [-16, -11, -7, -2]) wpZ(x, 0, z);
  wpZ(0, 0, -16); wpZ(0, 0, -14); wpZ(0, 1.75, -9); wpZ(0, 3.5, -4); wpZ(0, 3.5, 0); wpZ(-4, 3.5, -2); wpZ(4, 3.5, -2);
  wpZ(-13, 1.1, -7); wpZ(13, 1.1, -7); wpZ(-13, 2.2, -2); wpZ(13, 2.2, -2);
  WAYPOINTS.push([-4.5, 0, 7], [4.5, 0, 7]);

  // THEME: sky [top, middle, horizon], fogColor, hemi [sky, ground, intensity], sun [colour, intensity, x, y, z]
  MAPS.neonhigh = { id: 'neonhigh', name: 'Neon High', BOXES, RAMPS, PADS, NEON, LIGHTS, FLAGS, SPAWNS, WAYPOINTS,
    THEME: { bg: 0x1a1030, fog: [70, 230], fogColor: 0x2a1a44, hemi: [0x9c90ff, 0x4a2a52, 1.15], ambient: 0.42, exposure: 1.5,
             sky: [0x1a1442, 0x5a2a7e, 0x8a3a7a], sun: [0xa8b8ff, 1.2, -30, 60, 20], rain: true } };

  // =====================================================================================
  // Map 2: "Sunset Yards" - golden hour, dry. Same 12 m gaps as Neon High, different inside:
  //   - bases: corner sniper towers with ramps, a barrier line in front of the flag
  //   - gaps: two glass bridges on the side lanes, pads near the outer edges, a grapple beam
  //   - middle: a hollow block around an open light well (a void!) crossed by one glass bridge,
  //     billboard walls along the well to wall-run, a beam over the well, raised side decks
  // =====================================================================================
  begin();
  const SUN = 0xffa040, ROSE = 0xff6a8a, LIME = 0x9dff6a;

  // ===================== base buildings
  boxZ(-15, -40, -52, 15, 0, -30, 'roof');
  boxZ(-15, 0, -52, 15, 1.0, -51.6, 'parapet');
  boxXZ(14.6, 0, -51.6, 15, 1.0, -30, 'parapet');
  boxZ(-3.4, 0, -30.4, 3.4, 1.0, -30, 'parapet');
  boxXZ(6.6, 0, -30.4, 11, 0.7, -30, 'parapet');                 // low curb on the landing lanes, open in front of the pads
  boxXZ(14, 0, -30.4, 14.6, 0.7, -30, 'parapet');
  // corner towers (sniper perches), ramps down toward the middle of the roof
  boxXZ(9, 0, -51.6, 14.6, 3, -46, 'penthouse');
  boxXZ(9, 3, -46.2, 14.6, 3.8, -46, 'rail');
  rampXZ(4, 0, -51.6, 9, 3, -48.5, 'x', 1);
  // cover
  boxZ(-2.5, 0, -40.2, 2.5, 1.1, -39.6, 'barrier');
  boxXZ(5.5, 0, -38, 8.5, 1.1, -37.4, 'barrier');
  boxXZ(10, 0, -42, 13, 1.5, -39, 'ac');
  boxXZ(-1.2, 0, -51.6, -3.6, 2.4, -49.6, 'vent');

  // ===================== gaps (z -30 .. -18): side bridges, pads on the outer lanes, a beam
  boxXZ(3.6, -0.35, -30, 6.4, 0, -18, 'glass');
  boxXZ(3.4, 0, -30, 3.6, 1.1, -18, 'glassrail');
  boxXZ(6.4, 0, -30, 6.6, 1.1, -18, 'glassrail');
  boxZ(-15.4, 7, -24.2, 15.4, 7.4, -23.8, 'beam', true);
  boxXZ(15.4, -40, -24.3, 16, 7.6, -23.7, 'pylon');
  padZ(11.2, 0, -32.2, 13.8, -30.6, [0, 11.5, 14]);
  padZ(-13.8, 0, -32.2, -11.2, -30.6, [0, 11.5, 14]);
  padZ(7.6, 0, -17.4, 10.2, -15.8, [0, 11.5, -14]);
  padZ(-10.2, 0, -17.4, -7.6, -15.8, [0, 11.5, -14]);

  // ===================== middle: a block around an open light well (x -3..3, z -10..10)
  boxZ(-20, -40, -18, 20, 0, -10, 'roof');
  boxX(-20, -40, -10, -3, 0, 10, 'roof');
  boxZ(-3.4, 0, -18, 3.4, 1.0, -17.6, 'parapet');
  boxXZ(6.6, 0, -18, 7.4, 0.7, -17.6, 'parapet');
  boxXZ(10.4, 0, -18, 14.6, 0.7, -17.6, 'parapet');
  boxXZ(14.6, 0, -18, 20, 1.0, -17.6, 'parapet');
  boxXZ(19.6, 0, -17.6, 20, 1.0, -0.1, 'parapet');
  box(-3, -0.35, -1.2, 3, 0, 1.2, 'glass');                       // the only way across the well on foot
  boxXZ(3, 0, -9, 3.4, 4.2, -2, 'billboard');                      // wall-run along the well
  boxZ(-0.25, 9, -12.4, 0.25, 9.4, -0.3, 'beam', true);           // beam over the well, two halves
  boxZ(-0.3, 0, -13.2, 0.3, 9.6, -12.4, 'pylon');
  // raised side decks with ramps from both ends
  boxX(12, 0, -6, 18, 2.4, 6, 'deck');
  rampXZ(13, 0, -12, 17, 2.4, -6, 'z', 1);
  // cover
  boxXZ(6, 0, -14.5, 8.5, 1.4, -12, 'ac');
  boxXZ(7.5, 0, -5, 9, 2.4, -3.6, 'vent');
  boxXZ(15, 0, -15.5, 17.5, 1.2, -14, 'barrier');

  const FLAGS2 = [{ team: 0, pos: [0, 0, -44] }, { team: 1, pos: [0, 0, 44] }];
  const SPAWNS2 = [
    [[-2, 0, -48], [2, 0, -48], [-7, 0, -44], [7, 0, -44], [-12, 0, -35], [12, 0, -35]].map(([x, y, z]) => ({ x, y, z, yaw: Math.PI })),
    [[-2, 0, 48], [2, 0, 48], [-7, 0, 44], [7, 0, 44], [-12, 0, 35], [12, 0, 35]].map(([x, y, z]) => ({ x, y, z, yaw: 0 })),
  ];

  neonZ(MAG, 0, 1.02, -51.8, 30, 0.05, 0.08);
  neonZ(MAG, 0, 0.03, -44, 2.6, 0.02, 0.06);
  neonZ(MAG, 11.8, 2.95, -45.95, 5.6, 0.08, 0.06);
  neonZ(MAG, -11.8, 2.95, -45.95, 5.6, 0.08, 0.06);
  neonZ(WHITE, 3.5, 1.12, -24, 0.06, 0.04, 12);
  neonZ(WHITE, -3.5, 1.12, -24, 0.06, 0.04, 12);
  neonZ(WHITE, 6.5, 1.12, -24, 0.06, 0.04, 12);
  neonZ(WHITE, -6.5, 1.12, -24, 0.06, 0.04, 12);
  neonZ(AMBER, 0, 6.95, -24, 30.8, 0.05, 0.5);
  neonZ(SUN, 0, 0.03, -10.02, 6, 0.03, 0.06);
  neonZ(LIME, 3.02, 0.03, -6, 0.06, 0.03, 8);
  neonZ(LIME, -3.02, 0.03, -6, 0.06, 0.03, 8);
  neonZ(ROSE, 15, 2.42, -6.02, 6, 0.06, 0.06);
  neonZ(AMBER, 0, 8.95, -6.3, 0.5, 0.05, 12);

  LIGHTS.push(
    { pos: [0, 4, -44], color: MAG, power: 2.0, range: 16 }, { pos: [0, 4, 44], color: CYAN, power: 2.0, range: 16 },
    { pos: [0, 6, -24], color: AMBER, power: 1.4, range: 16 }, { pos: [0, 6, 24], color: AMBER, power: 1.4, range: 16 },
    { pos: [0, 3, 0], color: LIME, power: 1.6, range: 14 },
    { pos: [-15, 6, 0], color: ROSE, power: 1.6, range: 18 }, { pos: [15, 6, 0], color: SUN, power: 1.6, range: 18 },
  );

  for (const x of [-12, -6, 0, 6, 12]) for (const z of [-46, -40, -34, -31.5]) wpZ(x, 0, z);
  wpZ(-12, 3, -49); wpZ(12, 3, -49); wpZ(-6.5, 1.5, -50); wpZ(6.5, 1.5, -50); wpZ(-2, 0, -43); wpZ(2, 0, -43);
  for (const x of [-5, 5]) for (const z of [-27, -24, -21]) wpZ(x, 0, z);
  for (const x of [-17, -12, -7, 7, 12, 17]) for (const z of [-16, -12, -8, -4]) wpZ(x, 0, z);
  for (const x of [-17, -11, -6, -4.6, 4.6, 6, 11, 17]) WAYPOINTS.push([x, 0, 0]);
  for (const x of [-5, -2, 2, 5]) wpZ(x, 0, -16);
  wpZ(-1.5, 0, -11.5); wpZ(1.5, 0, -11.5); WAYPOINTS.push([-1.6, 0, 0], [1.6, 0, 0]);
  wpZ(-15, 1.2, -9); wpZ(15, 1.2, -9); wpZ(-15, 2.4, -3); wpZ(15, 2.4, -3);

  MAPS.sunset = { id: 'sunset', name: 'Sunset Yards', BOXES, RAMPS, PADS, NEON, LIGHTS, FLAGS: FLAGS2, SPAWNS: SPAWNS2, WAYPOINTS,
    THEME: { bg: 0x3a2a48, fog: [80, 260], fogColor: 0xc08878, hemi: [0xffe0b8, 0x5a4a66, 1.5], ambient: 0.55, exposure: 1.3,
             sky: [0x3a64b0, 0xe8907a, 0xffb060], sun: [0xffc88a, 2.4, -60, 28, -40], rain: false } };

  const IDS = Object.keys(MAPS);
  return { MAPS, IDS, DEFAULT: 'neonhigh' };
});
