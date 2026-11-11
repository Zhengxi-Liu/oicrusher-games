/**
 * FlightPhysics - a 6-DOF rigid-body aerodynamic model of a light aerobatic monoplane.
 *
 * Nothing is scripted: every frame each lifting surface (left wing, right wing, horizontal tail,
 * fin) computes its own angle of attack from the local airflow (body velocity + rotation x lever
 * arm - wind), then lift and drag from
 *     L = 1/2 rho V^2 S CL(alpha)        D = 1/2 rho V^2 S CD(alpha)
 * Control surfaces change the camber of their surface (aileron / elevator / rudder / flaps shift
 * the lift curve). Stability, damping, adverse effects and stalls fall out of that:
 *   - the tail behind the CG keeps the nose into the wind (pitch and yaw stability + damping)
 *   - wing dihedral gives roll stability; rolling changes each wing's local alpha (roll damping)
 *   - past the critical alpha a surface's lift collapses toward flat-plate values and its centre
 *     of pressure moves aft -> nose drops; if one wing stalls first (aileron down, yaw, roll rate)
 *     that wing drops -> incipient spin. Recover: release back pressure, opposite rudder, power.
 * Thrust comes from a propeller model (falls off with airspeed); landing gear is three
 * spring-damper wheels with rolling / braking / side friction and nose-wheel steering - or, on the
 * floatplane, three float contacts (bow + the two steps): buoyancy on the water, hump-shaped water drag
 * (worst just before the floats get "on the step"), keel side force and a water rudder.
 *
 * Axes (body and world, Three.js style): x right/east, y up, z back/south; the nose points -z.
 * Integration: 4 sub-steps per 1/60 s frame (240 Hz), semi-implicit Euler, quaternion attitude.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FSPhysics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- tiny vector / quaternion helpers (arrays, no allocation-heavy classes)
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = a => Math.hypot(a[0], a[1], a[2]);
  const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  function qrot(q, v) {                       // rotate v by unit quaternion q = [x, y, z, w]
    const [x, y, z, w] = q;
    const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
    return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
  }
  const qconj = q => [-q[0], -q[1], -q[2], q[3]];
  function qmul(a, b) {
    return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
            a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
  }
  function qnorm(q) { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; }
  function qFromEuler(yaw, pitch, roll) {     // yaw about +y, then pitch about +x, then roll about +z (YXZ)
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2), cr = Math.cos(roll / 2), sr = Math.sin(roll / 2);
    return qmul(qmul([0, sy, 0, cy], [sp, 0, 0, cp]), [0, 0, sr, cr]);
  }
  const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const DEG = Math.PI / 180;

  // ---------- the aircraft types. Every number below is used by the physics; nothing is scripted.
  //   surfaces: lever arm r (from the CG), normal n, area, aspect ratio, stall angle, incidence,
  //             control (tau = how much of the deflection becomes camber), downwash, propwash
  //   wheels:   contact point at full extension, spring k, damper c
  //   hardpoints: points that must never touch the ground or an obstacle (tips, nose / prop, tail, belly, fin)
  //   feel.pitchVref: above this airspeed full stick no longer means full elevator (stick forces grow
  //   with speed), so full back stick at 140 kt gives a hard turn instead of an instant stall;
  //   pitchKey = how far a plain W/S key pulls (an aerobatic plane stalls at full stick - Shift = full)
  const dih = d => [Math.sin(d * DEG), Math.cos(d * DEG), 0];
  const wings = (x, y, z, area, ar, stall, inc, tau, dihedral, cd0 = 0.012) => [
    { id: 'wingL', r: [-x, y, z], n: dih(dihedral), area, ar, cd0, stall: stall * DEG, inc: inc * DEG, ctrl: 'aileronL', tau, flap: true },
    { id: 'wingR', r: [x, y, z], n: [-dih(dihedral)[0], dih(dihedral)[1], 0], area, ar, cd0, stall: stall * DEG, inc: inc * DEG, ctrl: 'aileronR', tau, flap: true },
  ];
  const TYPES = {
    trainer: {
      gLimit: 5, id: 'trainer', name: 'Cub Trainer', blurb: 'High wing, slow and forgiving. Lands almost anywhere.',
      mass: 600, inertia: [800, 1250, 700], damp: [0.25, 0.45, 0.15],
      engine: { kind: 'prop', static: 2900, vmax: 72, lag: 0.7, propZ: -2.1 },
      maxDefl: { aileron: 20 * DEG, elevator: 25 * DEG, rudder: 25 * DEG }, deflRate: 2.6, flaps: [0, 20 * DEG, 40 * DEG], flapCL: 0.9,
      fuselage: { side: 3.6, top: 4.4, front: 0.45, at: [0, 0, 0.3] },
      surfaces: [
        ...wings(2.6, 0.95, 0.0, 8.3, 7, 15, 2.5, 0.36, 1.5, 0.014),
        { id: 'htail', r: [0, 0.3, 4.3], n: [0, 1, 0], area: 2.6, ar: 3.6, cd0: 0.01, stall: 20 * DEG, inc: -1.5 * DEG, ctrl: 'elevator', tau: 0.5, downwash: 0.35, wash: true },
        { id: 'vtail', r: [0, 0.9, 4.5], n: [1, 0, 0], area: 1.3, ar: 1.4, cd0: 0.01, stall: 22 * DEG, inc: 0, ctrl: 'rudder', tau: 0.5, wash: true },
      ],
      wheels: [{ id: 'nose', r: [0, -1.05, -1.3], k: 16000, c: 2000, steer: true }, { id: 'mainL', r: [-1.0, -1.1, 0.25], k: 26000, c: 3200, brake: true }, { id: 'mainR', r: [1.0, -1.1, 0.25], k: 26000, c: 3200, brake: true }],
      hardpoints: [[-5.3, 1.0, 0.1], [5.3, 1.0, 0.1], [0, -0.25, -2.1], [0, 0.1, 4.7], [0, -0.6, 0.3], [0, 1.6, 4.6]],
      gearMaxVs: 4.0, feel: { pitchVref: 32, rollKey: 0.9, pitchKey: 0.7 },
      hud: { vs0: 41, vs1: 33, vfe: 70, vne: 110 }, cam: { dist: 12, height: 2.2 }, eye: [0, 0.78, 0.1],
      spawn: { land: { speed: 26, flaps: 1, throttle: 0.4 }, race: { speed: 45, throttle: 1 } },
      stats: { speed: 1, agility: 2, stall: 5 },
    },
    sport: {
      gLimit: 10, id: 'sport', name: 'Skyward S-1', blurb: 'Unlimited-class aerobatic plane: more thrust than weight, hovers, torque rolls, knife-edge.',
      mass: 800, inertia: [1250, 2000, 820], damp: [0.17, 0.4, 0.12],
      engine: { kind: 'prop', static: 9800, vmax: 140, lag: 0.45, propZ: -2.2, wash: 0.6, washWing: 0.3, torque: 650 },
      sideLift: 3.6,                                              // the slab-sided fuselage lifts in a knife-edge
      maxDefl: { aileron: 25 * DEG, elevator: 30 * DEG, rudder: 32 * DEG }, deflRate: 3.2, flaps: [0, 15 * DEG, 32 * DEG], flapCL: 0.85,
      fuselage: { side: 3.2, top: 4.0, front: 0.32, at: [0, 0, 0.4] },
      surfaces: [
        ...wings(2.25, 0.05, 0.1, 7, 6, 16, 2, 0.42, 4),
        { id: 'htail', r: [0, 0.25, 4.6], n: [0, 1, 0], area: 2.9, ar: 4, cd0: 0.01, stall: 20 * DEG, inc: -0.3 * DEG, ctrl: 'elevator', tau: 0.55, downwash: 0.4, wash: true },
        { id: 'vtail', r: [0, 0.95, 4.8], n: [1, 0, 0], area: 1.5, ar: 1.6, cd0: 0.01, stall: 22 * DEG, inc: 0, ctrl: 'rudder', tau: 0.5, wash: true },
      ],
      wheels: [{ id: 'nose', r: [0, -1.32, -1.75], k: 26000, c: 3200, steer: true }, { id: 'mainL', r: [-1.2, -1.36, 0.3], k: 42000, c: 5200, brake: true }, { id: 'mainR', r: [1.2, -1.36, 0.3], k: 42000, c: 5200, brake: true }],
      hardpoints: [[-4.5, 0.35, 0.15], [4.5, 0.35, 0.15], [0, -0.35, -2.75], [0, 0.15, 5.3], [0, -0.75, 0.6], [0, 1.75, 5.1]],
      gearMaxVs: 4.6, feel: { pitchVref: 50, rollKey: 0.8, pitchKey: 0.5 },
      hud: { vs0: 60, vs1: 50, vfe: 100, vne: 175 }, cam: { dist: 14, height: 2.4 }, eye: [0, 0.86, 0.3],
      spawn: { land: { speed: 37, flaps: 1, throttle: 0.32 }, race: { speed: 68, throttle: 0.85 } },
      stats: { speed: 2, agility: 5, stall: 3 },
    },
    warbird: {
      gLimit: 8, id: 'warbird', name: 'Thunder Warbird', blurb: 'Heavy WW2-style fighter: 1500 hp, fast and stable, slow to roll. Carries one 1,000 lb bomb on a swing-arm rack (N) - dive bomber style.',
      mass: 4200, inertia: [14000, 22000, 9000], damp: [0.2, 0.4, 0.12],
      engine: { kind: 'prop', static: 20000, power: 1.1e6, vmax: 240, lag: 0.9, propZ: -3.7 },
      maxDefl: { aileron: 18 * DEG, elevator: 25 * DEG, rudder: 25 * DEG }, deflRate: 2.6, flaps: [0, 20 * DEG, 40 * DEG], flapCL: 0.8,
      fuselage: { side: 6, top: 8, front: 0.2, at: [0, 0, 0.6] },
      surfaces: [
        ...wings(2.9, -0.35, 0.2, 10.9, 5.9, 16, 1.5, 0.2, 5, 0.009),
        { id: 'htail', r: [0, 0.2, 5.6], n: [0, 1, 0], area: 4.6, ar: 4.2, cd0: 0.008, stall: 20 * DEG, inc: -1 * DEG, ctrl: 'elevator', tau: 0.5, downwash: 0.4, wash: true },
        { id: 'vtail', r: [0, 1.1, 5.8], n: [1, 0, 0], area: 2.4, ar: 1.5, cd0: 0.008, stall: 22 * DEG, inc: 0, ctrl: 'rudder', tau: 0.5, wash: true },
      ],
      // taildragger: two mains ahead of the CG and a steerable tail wheel - sits ~12 degrees nose-up, the
      // mains far enough forward that hard braking does not stand it on its propeller
      wheels: [{ id: 'tail', r: [0, -0.62, 5.5], k: 60000, c: 9000, steer: true, stroke: 0.4 }, { id: 'mainL', r: [-1.8, -1.95, -0.9], k: 230000, c: 40000, brake: true, stroke: 0.75 }, { id: 'mainR', r: [1.8, -1.95, -0.9], k: 230000, c: 40000, brake: true, stroke: 0.75 }],
      tailwheel: true, retract: { time: 4.5, drag: 0.3 }, brakeMu: 0.55,
      bombRack: { type: 'b1000', pivot: [0, -0.8, -0.5], arm: 0.9, swing: 1.25, time: 0.5 },     // SBD-style swing arm (trapeze): the bomb is thrown clear of the propeller arc
      // six .50 cal in the wings (P-51 style), fired in turn, aimed to converge 300 m ahead
      gun: { muzzles: [-2.2, -2.45, -2.7, 2.2, 2.45, 2.7].map(x => [x, -0.3, -1.5]), converge: 300, rate: 36, speed: 880, ammo: 600, spread: 0.007 },
      hardpoints: [[-5.65, -0.05, 0.45], [5.65, -0.05, 0.45], [0, -1.45, -3.75], [0, 0.1, 6.2], [0, -0.95, 0.5], [0, 2.3, 5.9]],
      gearMaxVs: 5, feel: { pitchVref: 75, rollKey: 0.75, pitchKey: 0.65 },
      hud: { vs0: 95, vs1: 82, vfe: 160, vne: 420 }, cam: { dist: 19, height: 3.2 }, eye: [0, 1.25, 0.5],
      spawn: { land: { speed: 58, flaps: 2, throttle: 0.38 }, race: { speed: 120, throttle: 0.85 } },
      stats: { speed: 4, agility: 3, stall: 2 },
    },
    jet: {
      gLimit: 10, id: 'jet', name: 'Falcon Jet', blurb: 'Fly-by-wire fighter jet with afterburner (throttle above 90%). Very fast.',
      mass: 9500, inertia: [60000, 70000, 14000], damp: [0.45, 0.5, 0.2],
      engine: { kind: 'jet', static: 64000, ab: 105000, lag: 1.6 },
      maxDefl: { aileron: 20 * DEG, elevator: 28 * DEG, rudder: 25 * DEG }, deflRate: 4.5, flaps: [0, 12 * DEG, 25 * DEG], flapCL: 0.5,
      fuselage: { side: 14, top: 16, front: 0.6, at: [0, 0, 0.8] }, mach: true,
      surfaces: [
        ...wings(2.6, -0.2, 0.3, 14, 3.2, 24, 1.5, 0.3, 0, 0.007),
        { id: 'htail', r: [0, -0.1, 5.4], n: [0, 1, 0], area: 5.5, ar: 2.8, cd0: 0.006, stall: 24 * DEG, inc: 0, ctrl: 'elevator', tau: 0.9, downwash: 0.3 },
        { id: 'vtail', r: [0, 1.6, 5.4], n: [1, 0, 0], area: 5, ar: 1.3, cd0: 0.006, stall: 24 * DEG, inc: 0, ctrl: 'rudder', tau: 0.45 },
      ],
      // fighter gear: long-stroke oleos built for firm landings (~1400 fpm)
      wheels: [{ id: 'nose', r: [0, -1.75, -3.6], k: 190000, c: 30000, steer: true, stroke: 0.8 }, { id: 'mainL', r: [-1.25, -1.8, 0.9], k: 380000, c: 70000, brake: true, stroke: 0.95 }, { id: 'mainR', r: [1.25, -1.8, 0.9], k: 380000, c: 70000, brake: true, stroke: 0.95 }],
      retract: { time: 3.5, drag: 0.45 }, airbrake: { area: 2.2, at: [0, 0.4, 6.8] },
      gun: { muzzle: [-0.78, 0.32, -4.6], rate: 30, speed: 1050, ammo: 510, spread: 0.004 },   // M61-style cannon (one tracer per ~3 real rounds)
      // AIM-9 heat-seekers (client/MissileSim.js): underwing pylons first, then the wingtip rails; 30 flares
      missiles: [[-3.6, -0.62, 1.2], [3.6, -0.62, 1.2], [-4.8, -0.38, 1.7], [4.8, -0.38, 1.7]], flares: 30,
      hardpoints: [[-4.8, -0.2, 1.6], [4.8, -0.2, 1.6], [0, -0.3, -7.6], [0, 0.2, 7.2], [0, -1.25, 0.5], [0, 3.3, 6.6]],
      gearMaxVs: 7, feel: { pitchVref: 95, rollKey: 0.6, pitchKey: 0.6 },
      hud: { vs0: 113, vs1: 104, vfe: 300, vne: 800 }, cam: { dist: 26, height: 4.5 }, eye: [0, 1.15, -3.4],
      spawn: { land: { speed: 78, flaps: 2, throttle: 0.45 }, race: { speed: 170, throttle: 0.8 } },
      stats: { speed: 5, agility: 4, stall: 1 },
    },
    a10: {
      gLimit: 8, id: 'a10', name: 'Warthog A-10', blurb: 'Armoured tank-buster: slow, tough and very manoeuvrable. A 30 mm rotary cannon (Space - twice the punch of the Falcon\'s), six 500 lb bombs (N, one per press), three kinds of air-to-air missile (H fires, Y picks the type) and flares.',
      mass: 14000, inertia: [47000, 74000, 34000], damp: [0.4, 0.5, 0.25],
      engine: { kind: 'jet', static: 70000, ab: 70000, noAB: true, lag: 3.4, vk: -800, exhaust: [[-1.4, 7.1, 0.95], [1.4, 7.1, 0.95]] },      // 2 x TF34 high-bypass turbofans: slow spool-up, thrust falls with speed
      maxDefl: { aileron: 22 * DEG, elevator: 26 * DEG, rudder: 25 * DEG }, deflRate: 3.5, flaps: [0, 10 * DEG, 20 * DEG], flapCL: 0.7,
      fuselage: { side: 24, top: 30, front: 1.0, at: [0, 0, 0.6] },
      surfaces: [
        ...wings(4.5, 0.1, 0.35, 23.5, 6.5, 17, 2, 0.4, 1, 0.02),
        { id: 'htail', r: [0, 0.4, 6.6], n: [0, 1, 0], area: 8.5, ar: 3.4, cd0: 0.008, stall: 22 * DEG, inc: -0.5 * DEG, ctrl: 'elevator', tau: 0.7, downwash: 0.35 },
        { id: 'vtail', r: [0, 1.8, 6.4], n: [1, 0, 0], area: 7.5, ar: 1.3, cd0: 0.008, stall: 24 * DEG, inc: 0, ctrl: 'rudder', tau: 0.5 },
      ],
      wheels: [{ id: 'nose', r: [0, -2.0, -5.2], k: 150000, c: 25000, steer: true, stroke: 0.7 }, { id: 'mainL', r: [-2.6, -2.05, 0.9], k: 300000, c: 60000, brake: true, stroke: 0.9 }, { id: 'mainR', r: [2.6, -2.05, 0.9], k: 300000, c: 60000, brake: true, stroke: 0.9 }],
      retract: { time: 4, drag: 0.35 }, airbrake: { area: 3, at: [0, 0.6, 5.5] },
      // GAU-8 Avenger: one 30 mm barrel cluster in the nose, much heavier rounds than the Falcon's M61 (dmg = damage per round that lands)
      gun: { muzzle: [0, -0.55, -8.5], rate: 70, speed: 1000, ammo: 1170, spread: 0.006, dmg: 2 },
      // the same three missiles as the Falcon: outer pylons (4 rails); the six bombs hang on the inner pylons
      missiles: [[-5.0, -0.95, 0.8], [5.0, -0.95, 0.8], [-6.7, -0.85, 0.9], [6.7, -0.85, 0.9]], flares: 40,
      bombRack: { type: 'b500', count: 6, pylon: true, pylons: [[-1.1, -1.15, 0.3], [1.1, -1.15, 0.3], [-2.4, -1.2, 0.7], [2.4, -1.2, 0.7], [-3.7, -1.1, 0.7], [3.7, -1.1, 0.7]] },
      hardpoints: [[-8.75, 0.3, 0.2], [8.75, 0.3, 0.2], [0, -0.2, -8.3], [0, 0.3, 8.0], [0, -1.35, 0.5], [0, 3.4, 7.2]],
      gearMaxVs: 6, feel: { pitchVref: 80, rollKey: 0.7, pitchKey: 0.6 },
      hud: { vs0: 104, vs1: 90, vfe: 190, vne: 380 }, cam: { dist: 24, height: 4 }, eye: [0, 1.0, -4.8],
      spawn: { land: { speed: 65, flaps: 2, throttle: 0.4 }, race: { speed: 115, throttle: 0.8 } },
      stats: { speed: 3, agility: 4, stall: 4 },
    },
  };
  TYPES.seaplane = {
    gLimit: 5, id: 'seaplane', name: 'Sea Otter', blurb: 'Bush plane on floats: takes off from and lands on the sea. Not on runways!',
    mass: 2100, inertia: [5200, 8200, 4400], damp: [0.6, 0.45, 0.15],           // big tail: calm in pitch as the floats unstick
    engine: { kind: 'prop', static: 7600, power: 2.7e5, vmax: 78, lag: 0.8, propZ: -3.1, wash: 0.45, torque: 150 },
    maxDefl: { aileron: 20 * DEG, elevator: 25 * DEG, rudder: 25 * DEG }, deflRate: 2.4, flaps: [0, 20 * DEG, 40 * DEG], flapCL: 0.9,
    fuselage: { side: 9, top: 11, front: 1.05, at: [0, -0.6, 0.2] },             // the floats add a lot of drag and side area
    surfaces: [
      ...wings(3.6, 1.1, 0.0, 11.6, 9.2, 19, 2.5, 0.36, 1.5, 0.013),            // thick high-lift wing: CLmax ~1.9, stalls ~53 kt like the real Beaver
      { id: 'htail', r: [0, 0.35, 5.2], n: [0, 1, 0], area: 4.6, ar: 4.2, cd0: 0.01, stall: 20 * DEG, inc: -1.5 * DEG, ctrl: 'elevator', tau: 0.5, downwash: 0.35, wash: true },
      { id: 'vtail', r: [0, 1.0, 5.4], n: [1, 0, 0], area: 2.8, ar: 1.4, cd0: 0.01, stall: 22 * DEG, inc: 0, ctrl: 'rudder', tau: 0.5, wash: true },
    ],
    // float contacts: the bow (steered = water rudder), the two steps, and the float sterns that stop the
    // tail going into the water when the pilot over-rotates; k = buoyancy per metre of immersion
    wheels: [{ id: 'bow', r: [0, -2.25, -2.7], k: 18000, c: 7000, steer: true, float: true }, { id: 'stepL', r: [-1.4, -2.3, 0.4], k: 26000, c: 9000, float: true }, { id: 'stepR', r: [1.4, -2.3, 0.4], k: 26000, c: 9000, float: true },
             { id: 'sternL', r: [-1.4, -1.9, 3.0], k: 20000, c: 8000, float: true }, { id: 'sternR', r: [1.4, -1.9, 3.0], k: 20000, c: 8000, float: true }],
    floats: true,
    hardpoints: [[-7.3, 1.25, 0.1], [7.3, 1.25, 0.1], [0, 0, -3.15], [0, 0.25, 6.0], [0, -0.75, 0.3], [0, 2.2, 5.8]],
    gearMaxVs: 3.4, feel: { pitchVref: 38, rollKey: 0.9, pitchKey: 0.35 },          // gentle keys: a hard pull on the water just drags the float heels
    hud: { vs0: 53, vs1: 45, vfe: 90, vne: 160 }, cam: { dist: 17, height: 3.2 }, eye: [0, 0.9, -0.5],
    spawn: { land: { speed: 32, flaps: 1, throttle: 0.35 }, race: { speed: 50, throttle: 1 } },
    stats: { speed: 2, agility: 2, stall: 4 },
  };
  // B-29 Superfortress: 43 m span, 161 m2 wing, four 2,200 hp R-3350s (one lumped engine here), tricycle gear.
  // spec.mass = empty + crew + fuel for a short sortie; the bomb load (Aircraft.setPayload) comes on top, 5-10 t.
  TYPES.b29 = {
    gLimit: 3.5, id: 'b29', name: 'B-29 Superfortress', blurb: 'Four-engine heavy bomber with a 20,000 lb bay. Slow to turn, needs most of the runway. N = bombsight.',
    mass: 39500, inertia: [2.6e6, 4.6e6, 3.0e6], damp: [0.45, 0.55, 0.3],
    engine: { kind: 'prop', static: 152000, power: 5.7e6, vmax: 215, lag: 2.2, propZ: -4, wash: 0.15, exhaust: [[-13, 2.8, 0.5], [-6, 2.8, -0.05], [6, 2.8, -0.05], [13, 2.8, 0.5]] },      // each nacelle's exhaust, behind the wing
    maxDefl: { aileron: 15 * DEG, elevator: 22 * DEG, rudder: 22 * DEG }, deflRate: 1.1, flaps: [0, 15 * DEG, 30 * DEG], flapCL: 0.75,
    fuselage: { side: 120, top: 330, front: 1.0, at: [0, 0, 0.5] },
    surfaces: [
      ...wings(10.2, 0.2, 0.3, 80.6, 11.5, 17, 3, 0.22, 4.5, 0.0115),
      { id: 'htail', r: [0, 1.0, 14.8], n: [0, 1, 0], area: 30, ar: 4.4, cd0: 0.008, stall: 18 * DEG, inc: -1.5 * DEG, ctrl: 'elevator', tau: 0.5, downwash: 0.4, wash: true },
      { id: 'vtail', r: [0, 3.8, 14.8], n: [1, 0, 0], area: 20, ar: 1.5, cd0: 0.008, stall: 22 * DEG, inc: 0, ctrl: 'rudder', tau: 0.5, wash: true },
    ],
    // tricycle gear: nose wheel 8.7 m ahead of the CG (15 % of the weight), two big mains under the inner nacelles
    wheels: [{ id: 'nose', r: [0, -3.8, -8.7], k: 1.1e6, c: 1.2e5, steer: true, stroke: 0.9 }, { id: 'mainL', r: [-4.6, -3.8, 1.6], k: 3.1e6, c: 3.5e5, brake: true, stroke: 1.0 }, { id: 'mainR', r: [4.6, -3.8, 1.6], k: 3.1e6, c: 3.5e5, brake: true, stroke: 1.0 }],
    retract: { time: 10, drag: 1.4 }, brakeMu: 1.0,
    hardpoints: [[-21.5, 1.7, 2.0], [21.5, 1.7, 2.0], [0, -0.6, -13.6], [0, -0.1, 16.2], [0, -1.6, 0.5], [0, 4.6, 15.6]],
    gearMaxVs: 3.2, feel: { pitchVref: 80, rollKey: 0.7, pitchKey: 0.55 },
    hud: { vs0: 90, vs1: 72, vfe: 150, vne: 330 }, cam: { dist: 58, height: 11 }, eye: [-0.6, 1.2, -12.2],
    spawn: { land: { speed: 63, flaps: 2, throttle: 0.30 }, race: { speed: 100, throttle: 0.8 } },
    stats: { speed: 3, agility: 1, stall: 2 },
    noRace: true, bomber: true, payloadMax: 10000,
    // remotely controlled .50 cal turrets (top fore / aft, belly fore / aft, tail): they fire by themselves at armed aircraft in range
    turrets: { mounts: [{ r: [0, 1.7, -6.2], arc: 'top' }, { r: [0, 1.7, 4.4], arc: 'top' }, { r: [0, -1.7, -6.0], arc: 'bottom' }, { r: [0, -1.6, 3.6], arc: 'bottom' }, { r: [0, 0, 17.4], arc: 'tail' }], range: 800, rate: 8, speed: 850, ammo: 1500, spread: 0.012 },
    gun: { muzzles: [[-0.7, -0.6, -13.2], [0.7, -0.6, -13.2]], rate: 14, speed: 850, ammo: 600, spread: 0.006 },   // manual nose guns on Space / left mouse (the turrets above are separate and automatic)
    bay: { at: [0, -1.4, 0.8], doorTime: 1.6 },                     // where bombs leave the aircraft; doors open before release
  };
  const TYPE_IDS = ['trainer', 'sport', 'warbird', 'jet', 'a10', 'seaplane', 'b29'];
  for (const T of Object.values(TYPES)) {
    // the forward (chord) direction for every surface is the nose direction
    for (const s of T.surfaces) { s.f = [0, 0, -1]; s.s = norm(cross(s.f, s.n)); s.cla = 2 * Math.PI * s.ar / (s.ar + 2); s.k = 1 / (Math.PI * 0.88 * s.ar); }
    // resting on the gear: height of the CG and the pitch that puts all three wheels on the ground
    const n = T.wheels[0].r, m = T.wheels[1].r;
    T.restPitch = Math.atan((n[1] - m[1]) / (n[2] - m[2]));
    T.restHeight = -(m[1] * Math.cos(T.restPitch) - m[2] * Math.sin(T.restPitch)) - (T.floats ? 0.3 : 0.06);   // floats sit ~0.3 m deep
  }
  const SPEC = TYPES.sport;

  // War planes (armed, but not the B-29 bomber) fly sharper than their raw numbers: lighter in roll / pitch / yaw,
  // bigger and faster control throws, more elevator at speed - and an airframe built to take the extra pull.
  // Applied when an Aircraft takes the type, so the carrier types derived from the Warbird get it too.
  const AGILE = { inertia: 0.6, aileron: 1.4, elevator: 1.15, rudder: 1.2, deflRate: 1.6, pitchVref: 1.3, gLimit: 1.15 };
  const agileCache = new Map();
  function flown(T) {
    if (!T || !T.gun || T.bomber) return T;
    let A = agileCache.get(T);
    if (A) return A;
    const d = T.maxDefl;
    A = Object.assign({}, T, {
      inertia: T.inertia.map(v => v * AGILE.inertia),
      maxDefl: Object.assign({}, d, { aileron: d.aileron * AGILE.aileron, elevator: d.elevator * AGILE.elevator, rudder: d.rudder * AGILE.rudder }),
      deflRate: T.deflRate * AGILE.deflRate,
      feel: Object.assign({}, T.feel, { pitchVref: T.feel.pitchVref * AGILE.pitchVref }),
      gLimit: (T.gLimit || 8) * AGILE.gLimit,
    });
    agileCache.set(T, A);
    return A;
  }

  /** CL, CD and a 0..1 "how stalled" factor for a surface at geometric alpha `a` with a camber shift `shift` (rad). */
  function coefficients(s, a, shift, flapCL, safe = 0) {
    // control surfaces (shift) move the lift curve sideways, so a down-going aileron stalls its wing
    // first; flaps add camber lift on top and raise CLmax while the wing stalls a little earlier
    // (a control surface only covers part of the span: it moves the whole lift curve but lowers the
    // stall angle only a little - otherwise a rolling wing would stall far above stall speed)
    const ae = a + shift;
    const stall = s.stall - (flapCL > 0 ? 2 * DEG * flapCL / 0.85 : 0);
    const over = Math.abs(a + shift * 0.3) - stall;
    let cl, f = 0;
    if (over <= 0) cl = s.cla * ae + flapCL;
    else {
      f = smooth(0, 6 * DEG, over) * (1 - safe);       // safe (0..1): airspeed above stall speed -> the wing holds its peak lift instead of breaking
      const peak = s.cla * (stall + Math.abs(shift) * 0.7 * Math.sign(shift) * Math.sign(ae)) * Math.sign(ae) + flapCL;
      const flat = 1.05 * Math.sin(2 * a);
      cl = peak * (1 - f) + flat * f;
    }
    const sa = Math.sin(a);
    const cd = s.cd0 * (s.machK || 1) + cl * cl * s.k + 1.15 * sa * sa * (0.25 + 0.75 * f) + flapCL * 0.08;
    return { cl, cd, f };
  }

  class Aircraft {
    /**
     * opts.ground(x, z) -> terrain height;  opts.surface(x, z) -> 'runway' | 'grass' | 'water'
     * opts.obstacle(x, y, z) -> name of a tree / building at that point, or null;  opts.type -> TYPES key
     * opts.deck(x, y, z) -> height of the flat top (roof, statue top) a point is just inside, or null - landable
     */
    constructor(opts) {
      this.spec = flown(TYPES[opts.type] || SPEC);
      this.setPayload(0);
      this.ground = opts.ground;
      this.surfaceAt = opts.surface || (() => 'grass');
      this.obstacle = opts.obstacle || (() => null);           // (x, y, z) -> 'a tree' | 'the hangar' | null
      this.deck = opts.deck || (() => null);                   // (x, y, z) -> top of a flat roof / statue top | null
      this.deckNormal = opts.deckNormal || null;               // (x, y, z) -> [nx, ny, nz] of a tilted deck (a ship heeling in a turn) | null = level
      this.wind = [0, 0, 0];
      this.gust = 0;
      this.time = 0;
      this.ctl = { pitch: 0, roll: 0, yaw: 0, throttle: 0, flaps: 0, brake: 0, trim: 0 };
      this.defl = { aileronL: 0, aileronR: 0, elevator: 0, rudder: 0, flaps: 0 };
      this.reset({ x: 0, y: 2, z: 0, yaw: 0, pitch: 0, roll: 0, speed: 0 });
    }

    /** Switch aircraft type (call reset afterwards). */
    setType(id) { this.spec = flown(TYPES[id] || SPEC); this.setPayload(0); }

    /** Carry `kg` of payload (bombs): the mass and the moments of inertia follow, so a loaded bomber needs more runway and turns slower. */
    setPayload(kg) {
      this.payload = kg; this.mass = this.spec.mass + kg;
      this.I = this.spec.inertia.map(v => v * this.mass / this.spec.mass);
    }

    /** Place the aircraft. On the ground: give `onGround: true` and it is set on its wheels. */
    reset({ x, y, z, yaw = 0, pitch = 0, roll = 0, speed = 0, throttle = 0, flaps = 0, onGround = false, gear = 1 }) {
      this.q = qFromEuler(yaw, pitch, roll);
      if (onGround) {
        // rest on the gear: mains and nose touching (with static compression)
        y = (this.spec.floats && this.surfaceAt(x, z) === 'water' ? 0 : this.ground(x, z)) + this.spec.restHeight;
        this.q = qFromEuler(yaw, this.spec.restPitch, 0);
      }
      this.pos = [x, y, z];
      this.vel = qrot(this.q, [0, 0, -speed]);
      this.w = [0, 0, 0];
      this.engine = throttle;
      this.ctl.throttle = throttle; this.ctl.flaps = flaps; this.ctl.trim = 0;
      this.ctl.gear = this.spec.retract && !onGround ? gear : 1; this.gearPos = this.ctl.gear;   // 1 = down and locked
      this.ctl.airbrake = 0; this.airbrakePos = 0;
      this.scrapeT = 0;
      this.fail = {}; this.heat = { engine: 0, flutter: 0, over: 0, gear: 0, flaps: 0, brake: 0 }; this.warned = {}; this.parkT = 0;     // part failures (see stress())
      this.defl.flaps = this.spec.flaps[flaps];
      this.crashed = null;
      const nw = this.spec.wheels.length;
      this.wheelLoad = new Array(nw).fill(0);
      this.onWater = false;
      this.wasOnGround = onGround;
      this.airborneT = onGround ? 0 : 10;
      this.events = [];
      this.g = 1;
      this.alpha = 0; this.beta = 0; this.stall = 0; this.ias = speed;
      this.gearHit = new Array(nw).fill(false);
      this.wheelAir = new Array(nw).fill(onGround ? 0 : 10);      // time since each wheel last touched
    }

    /** Advance one 60 Hz frame (4 sub-steps). Returns the events since the last frame. */
    step(dt = 1 / 60, subSteps = 4) {
      this.events = [];
      if (this.crashed) return this.events;
      const h = dt / subSteps;
      for (let i = 0; i < subSteps && !this.crashed; i++) this.substep(h);
      return this.events;
    }

    /**
     * Part wear. Every part that is pushed too hard heats up (0..1): the engine at full throttle (afterburner much faster), the
     * control surfaces above Vne (flutter), the airframe above its g limit, the gear and flaps extended above Vfe, the brakes held
     * on at speed. Past 0.7 there is a warning; at 1 the part fails for the rest of the flight (until the aircraft sits parked for
     * a while): a failed part ignores the controls. Returns the control inputs the aircraft really gets.
     */
    stress(dt) {
      const S = this.spec, f = this.fail, h = this.heat, E = S.engine, c = Object.assign({}, this.ctl), ias = (this.ias || 0) * 1.94384;       // knots, like spec.hud
      if (this.crashed) return c;
      const NAMES = { engine: 'ENGINE', aileron: 'AILERON', elevator: 'ELEVATOR', rudder: 'RUDDER', gear: 'LANDING GEAR', flaps: 'FLAPS', brake: 'BRAKES', over: 'AIRFRAME', flutter: 'CONTROLS' };
      const charge = (key, rate, why) => {
        if (rate <= 0 && h[key] <= 0) return false;
        h[key] = clamp(h[key] + rate * dt, 0, 1);
        if (h[key] > 0.7 && !this.warned[key]) { this.warned[key] = true; this.events.push({ type: 'warn', part: key, text: why }); }
        if (h[key] < 0.4) this.warned[key] = false;
        return h[key] >= 1;
      };
      const fail = (key, text) => { f[key] = true; this.events.push({ type: 'fail', part: key, text }); };
      // engine: full throttle cooks it; ~190 s (prop), ~220 s (turbofan), ~110 s in afterburner
      if (!f.engine) {
        const ab = E.kind === 'jet' && !E.noAB && this.engine > 0.9;
        const rate = this.engine > 0.92 ? (ab ? 1 / 110 : E.kind === 'jet' ? 1 / 220 : 1 / 190) * (this.heatScale || 1) : this.engine > 0.8 ? -1 / 120 : -1 / 25;   // heatScale: < 1 heats slower (the ring race)
        if (charge('engine', rate, 'ENGINE OVERHEATING - ease the throttle')) fail('engine', 'ENGINE FAILURE - overheated, no more thrust');
      }
      // flutter: a control surface lets go when you stay above Vne
      const over = ias / S.hud.vne - 1;
      if (charge('flutter', over > 0 ? (0.04 + over * 2.4) / 10 : -0.04, 'FLUTTER - slow down!')) {
        const left = ['aileron', 'elevator', 'rudder'].filter(k => !f[k]);
        if (left.length) { const k = left[Math.floor(Math.random() * left.length)]; fail(k, `${NAMES[k]} FAILURE - the surface is stuck`); }
        h.flutter = 0.4;
      }
      // airframe: over the g limit the wing folds (negative g: the limit is lower)
      const lim = S.gLimit || 8, gr = this.g >= 0 ? this.g / lim : -this.g / (lim * 0.4);
      if (charge('over', gr > 1 ? (gr - 1) * 1.5 + 0.02 : -0.15, 'OVERSTRESS - ease off the pull!')) this.crash('structural failure - the wing folded under the load');
      if (S.flaps[2] && !f.flaps && charge('flaps', c.flaps > 0 || this.defl.flaps > 0.05 ? Math.max(-0.4, ias / S.hud.vfe - 1) * 0.06 : -0.4, 'FLAPS OVERSPEED - slow down')) fail('flaps', 'FLAPS FAILURE - stuck where they are');
      if (!f.brake && charge('brake', this.onGround && c.brake > 0.3 && this.speed > 8 ? this.speed / 30 / 70 : -1 / 12, 'BRAKES HOT')) fail('brake', 'BRAKE FAILURE - no more braking');
      // parked long enough: the ground crew fixes everything
      if (this.onGround && this.speed < 1.5) { if ((this.parkT += dt) > 10 && Object.keys(f).length) { this.fail = {}; this.heat = { engine: 0, flutter: 0, over: 0, gear: 0, flaps: 0, brake: 0 }; this.events.push({ type: 'repair', text: 'Ground crew: all systems repaired' }); } }
      else this.parkT = 0;
      if (f.engine) c.throttle = 0;
      if (f.brake) c.brake = 0;
      return c;
    }

    substep(dt) {
      const S = this.spec, d = this.defl, f = this.fail;
      const c = this.ceff = this.stress(dt);
      this.time += dt;
      // control surfaces chase their commands at the servo rate
      const toward = (cur, want) => cur + clamp(want - cur, -S.deflRate * dt, S.deflRate * dt);
      if (!f.aileron) {
        d.aileronL = toward(d.aileronL, c.roll * S.maxDefl.aileron);
        d.aileronR = toward(d.aileronR, -c.roll * S.maxDefl.aileron);
      }
      // stick forces grow with speed: above feel.pitchVref the same stick gives less elevator
      const authority = Math.min(1, Math.pow(S.feel.pitchVref / Math.max(1, this.ias || 0), 1.4));
      if (!f.elevator) d.elevator = toward(d.elevator, clamp(c.pitch * authority + c.trim, -1, 1) * S.maxDefl.elevator);
      if (!f.rudder) d.rudder = toward(d.rudder, c.yaw * S.maxDefl.rudder);
      if (!f.flaps) d.flaps = toward(d.flaps, S.flaps[c.flaps] || 0);
      this.engine += (c.throttle - this.engine) * Math.min(1, dt / S.engine.lag);
      // retractable gear: moves over retract.time; will not come up with weight on the wheels (squat switch)
      if (S.retract && !f.gear) {
        const want = c.gear === 0 && !this.onGround ? 0 : 1;
        this.gearPos = clamp(this.gearPos + Math.sign(want - this.gearPos) * dt / S.retract.time, 0, 1);
      } else if (!S.retract) this.gearPos = 1;
      if (S.airbrake) this.airbrakePos = clamp(this.airbrakePos + Math.sign((c.airbrake ? 1 : 0) - this.airbrakePos) * dt / 1.2, 0, 1);

      const rho = 1.225 * Math.exp(-Math.max(0, this.pos[1]) / 8500);
      // wind + a little turbulence
      const gx = Math.sin(this.time * 0.9) + Math.sin(this.time * 2.3 + 1.7) * 0.5, gy = Math.sin(this.time * 1.7 + 0.4) * 0.6, gz = Math.cos(this.time * 1.1 + 2) + Math.sin(this.time * 3.1) * 0.4;
      const wind = [this.wind[0] + gx * this.gust, this.wind[1] + gy * this.gust * 0.5, this.wind[2] + gz * this.gust];
      const vAirW = sub(this.vel, wind);
      const vb = qrot(qconj(this.q), vAirW);          // air-relative velocity in body axes
      const V = len(vb);
      this.ias = V * Math.sqrt(rho / 1.225);
      this.alpha = Math.atan2(-vb[1], -vb[2]);
      this.beta = Math.atan2(vb[0], -vb[2]);
      const fwdSpeed = -vb[2];

      let F = [0, 0, 0], T = [0, 0, 0];                // body-frame force / torque
      const apply = (f, r) => { F = add(F, f); T = add(T, cross(r, f)); };

      // thrust: a propeller (falls off with speed, or limited by engine power) or a jet (+ afterburner)
      const E = S.engine, vf = Math.max(0, fwdSpeed);
      let thrust, wash = 0;
      if (E.kind === 'jet') {
        const e = this.engine;
        this.afterburner = e > 0.9 && !E.noAB;
        thrust = (e <= 0.9 ? e / 0.9 * E.static : E.static + (e - 0.9) / 0.1 * (E.ab - E.static)) * Math.max(0.3, 1 + vf / (E.vk || 900)) * (rho / 1.225);
      } else {
        thrust = E.power ? this.engine * Math.min(E.static, E.power / Math.max(vf, 1)) * (1 - smooth(E.vmax * 0.85, E.vmax, vf))
                         : this.engine * E.static * Math.max(0, 1 - vf / E.vmax);
        wash = Math.sqrt(vf * vf + 2 * thrust / (rho * 2.4)) - vf;
        this.afterburner = false;
      }
      this.thrust = thrust;
      apply([0, 0, -thrust], [0, 0, E.propZ || 0]);
      if (E.torque) T = add(T, [0, 0, E.torque * this.engine]);       // engine torque reaction: a slow roll to the left at full power
      // jets: transonic drag rise near Mach 0.85-1
      const machK = S.mach ? 1 + 3 * smooth(265, 335, V) : 1;

      // lifting surfaces
      const flapCL = S.flaps[2] ? d.flaps / S.flaps[2] * S.flapCL : 0;
      let wingAlpha = 0, stallMax = 0, stallL = 0, stallR = 0;
      // above the stall speed (flaps-aware) the wings never stall: lift just saturates at CLmax
      const vStall = d.flaps > 0.05 ? S.hud.vs1 : S.hud.vs0;
      const safe = smooth(vStall, vStall * 1.1, this.ias);
      for (const s of S.surfaces) {
        let u = add(vb, cross(this.w, s.r));                       // surface velocity through the air
        // propwash: air blown backwards over the tail (and the wing roots) = the surface moves forward
        // through that air faster, so the controls still work at zero airspeed with power on
        if (s.wash) u = add(u, mul(s.f, wash * (E.wash || 0.4)));
        else if (s.flap && E.washWing) u = add(u, mul(s.f, wash * E.washWing));
        u = sub(u, mul(s.s, dot(u, s.s)));                         // ignore spanwise flow
        const Vs = len(u);
        if (Vs < 0.3) continue;
        // alpha: the surface moves along +f; air hitting its underside (u . n < 0) is positive alpha
        let a = Math.atan2(-dot(u, s.n), dot(u, s.f)) + s.inc;
        if (s.downwash) a -= s.downwash * wingAlpha;
        const shift = s.ctrl === 'aileronL' ? d.aileronL * s.tau : s.ctrl === 'aileronR' ? d.aileronR * s.tau
                    : s.ctrl === 'elevator' ? -d.elevator * s.tau : s.ctrl === 'rudder' ? -d.rudder * s.tau : 0;
        s.machK = machK;
        const co = coefficients(s, a, shift, s.flap ? flapCL : 0, safe);
        if (s.flap) { wingAlpha += a / 2; stallMax = Math.max(stallMax, co.f); if (s.id === 'wingL') stallL = co.f; else stallR = co.f; }
        const qS = 0.5 * rho * Vs * Vs * s.area;
        const uh = mul(u, 1 / Vs);
        // lift is perpendicular to the flow, in the plane of the flow and the surface normal
        let ld = sub(s.n, mul(uh, dot(s.n, uh)));
        const ll = len(ld);
        ld = ll > 1e-6 ? mul(ld, 1 / ll) : s.n;
        const f = add(mul(ld, co.cl * qS), mul(uh, -co.cd * qS));
        const r = s.flap ? [s.r[0], s.r[1], s.r[2] + 0.55 * co.f] : s.r;   // stalled wing: centre of pressure moves aft
        apply(f, r);
      }
      this.stall = stallMax;
      this.stallSide = stallL - stallR;

      // fuselage drag (also damps sideslip and vertical motion)
      const fu = S.fuselage, ax = -0.5 * rho;
      const front = fu.front + (S.retract ? S.retract.drag * this.gearPos : 0);      // the gear hanging out costs drag
      apply([ax * fu.side * vb[0] * Math.abs(vb[0]), ax * fu.top * vb[1] * Math.abs(vb[1]), ax * front * machK * vb[2] * Math.abs(vb[2])], fu.at);
      if (S.airbrake && this.airbrakePos > 0 && V > 1) apply(mul(vb, ax * S.airbrake.area * this.airbrakePos * V), S.airbrake.at);   // speed brake: drag along the airflow
      if (S.sideLift && V > 1) {
        // a flat-sided fuselage at sideslip acts like a small wing: lift perpendicular to the flow, in the
        // body's side direction. In a knife-edge (wings vertical) this is what holds the aircraft up.
        const beta = Math.atan2(vb[0], -vb[2]), cy = 1.6 * Math.sin(beta) * Math.cos(beta) * (1 - smooth(25 * DEG, 50 * DEG, Math.abs(beta)) * 0.6);
        const qSide = 0.5 * rho * V * V * S.sideLift;
        const vh = mul(vb, 1 / V), sideDir = norm(sub([1, 0, 0], mul(vh, vh[0])));
        apply(mul(sideDir, -cy * qSide), [0, 0, -0.3]);
      }
      // extra rotational damping (fuselage, propeller disc), scaled with the airframe's inertia;
      // yaw gets the most so a rudder input does not leave the nose wagging
      const qd = Math.min(1.5, 0.3 + V / 60);
      T = sub(T, [this.w[0] * this.I[0] * S.damp[0] * qd, this.w[1] * this.I[1] * S.damp[1] * qd, this.w[2] * this.I[2] * S.damp[2] * qd]);

      // landing gear and ground contact (world frame)
      let Fw = qrot(this.q, F);
      Fw[1] -= this.mass * 9.81;
      const groundFT = this.gear(dt);
      Fw = add(Fw, groundFT.F);
      T = add(T, qrot(qconj(this.q), groundFT.T));

      // integrate
      const acc = mul(Fw, 1 / this.mass);
      this.vel = add(this.vel, mul(acc, dt));
      this.pos = add(this.pos, mul(this.vel, dt));
      const I = this.I, w = this.w;
      const Iw = [I[0] * w[0], I[1] * w[1], I[2] * w[2]];
      const gyro = cross(w, Iw);
      this.w = [w[0] + (T[0] - gyro[0]) / I[0] * dt, w[1] + (T[1] - gyro[1]) / I[1] * dt, w[2] + (T[2] - gyro[2]) / I[2] * dt];
      for (let k = 0; k < 3; k++) this.w[k] = clamp(this.w[k], -8, 8);
      this.q = qnorm(add4(this.q, mul4(qmul(this.q, [this.w[0], this.w[1], this.w[2], 0]), 0.5 * dt)));

      // load factor felt by the pilot (non-gravity acceleration along body up)
      const accNoG = add(acc, [0, 9.81, 0]);
      const gNow = dot(qrot(qconj(this.q), accNoG), [0, 1, 0]) / 9.81;
      this.g += (gNow - this.g) * Math.min(1, dt * 12);

      this.checkCrash();
    }

    /** Wheels: spring-damper normal force, rolling / brake / side friction, nose-wheel steering. */
    gear(dt) {
      const S = this.spec, c = this.ceff || this.ctl;
      let F = [0, 0, 0], T = [0, 0, 0], any = false, wet = false;
      const fwd = qrot(this.q, [0, 0, -1]);
      const speed = len(this.vel);
      const locked = this.gearPos > 0.999;
      S.wheels.forEach((wh, i) => {
        if (!locked) { this.wheelLoad[i] = 0; this.gearHit[i] = false; this.wheelAir[i] += dt; return; }   // gear up / in transit
        const rw = qrot(this.q, wh.r), P = add(this.pos, rw);
        // on top of something flat (a roof, the top of a REX letter): hard ground, like pavement
        const deck = this.deck(P[0], P[1], P[2]);
        const type = deck !== null ? 'runway' : this.surfaceAt(P[0], P[2]);
        const g = deck !== null ? Math.max(deck, this.ground(P[0], P[2])) : wh.float && type === 'water' ? 0 : this.ground(P[0], P[2]);     // floats ride on the sea surface
        const pen = g - P[1];
        this.wheelLoad[i] = 0;
        if (pen <= 0) { this.gearHit[i] = false; this.wheelAir[i] += dt; return; }
        any = true;
        if (type === 'water' && !wh.float) { this.crash('ditched in the sea'); return; }
        if (pen > (wh.float ? 1.6 : wh.stroke || 0.5)) { this.crash(wh.float ? 'the floats dug in' : 'the landing gear collapsed'); return; }
        if (wh.float && type === 'water') { wet = true; return this.floatOnWater(wh, i, rw, P, pen, fwd, speed, dt, f => { F = add(F, f); T = add(T, cross(rw, f)); }); }
        const vp = add(this.vel, qrot(this.q, cross(this.w, wh.r)));
        if (!this.gearHit[i]) {
          this.gearHit[i] = true;
          if (this.wheelAir[i] > 0.5) {
            this.events.push({ type: 'touch', wheel: i, vs: -vp[1], pos: P, surface: type });
            if (-vp[1] > S.gearMaxVs) { this.crash('the landing gear collapsed (hard landing)'); return; }
          }
        }
        this.wheelAir[i] = 0;
        const N = Math.max(0, wh.k * pen - wh.c * vp[1]);
        this.wheelLoad[i] = N;
        // wheel rolling direction (steered nose wheel), on the ground plane
        let dir = [fwd[0], 0, fwd[2]];
        if (wh.steer) {
          // nose-wheel steering: generous when taxiing slowly, fading out with speed so a full
          // rudder input at 15 m/s cannot pull a turn tight enough to tip the aircraft over
          // a tail wheel (behind the CG) turns the opposite way: the tail swings left so the nose goes right
          const st = (wh.r[2] > 0 ? -1 : 1) * c.yaw * 0.35 * Math.min(1, Math.pow(4 / Math.max(1, speed), 1.5));
          const cs = Math.cos(st), sn = Math.sin(st);
          dir = [fwd[0] * cs - fwd[2] * sn, 0, fwd[0] * sn + fwd[2] * cs];   // rotated about +y by -st: right rudder steers right
        }
        dir = norm(dir);
        const side = [-dir[2], 0, dir[0]];
        const vl = dot(vp, dir), vs = dot(vp, side);
        // rolling resistance: low on pavement, much higher on grass and growing with speed (bumps, soft ground);
        // brakes: good grip on the runway, about half on grass (floats on land: a heavy skid)
        const sp = Math.abs(dot(vp, dir));
        const roll = type === 'runway' ? 0.018 : type === 'rubble' ? 0.11 + Math.min(0.1, sp * 0.003) : type === 'dirt' ? 0.035 + Math.min(0.03, sp * 0.0007) : 0.06 + Math.min(0.08, sp * 0.002);   // rubble: broken pavement and rock, far worse than grass
        const mu = wh.float ? 0.4 : roll + (wh.brake ? c.brake * (type === 'runway' ? 1.1 : type === 'rubble' ? 0.5 : type === 'dirt' ? 0.75 : 0.6) * (S.brakeMu || 1) : 0);
        const fl = -clamp(vl * this.mass * 6, -mu * N, mu * N);
        const fs = -clamp(vs * this.mass * 5, -0.6 * N, 0.6 * N);          // tyres skid before the aircraft can tip
        const f = [dir[0] * fl + side[0] * fs, N, dir[2] * fl + side[2] * fs];
        if (deck !== null && this.deckNormal) { const n = this.deckNormal(P[0], P[1], P[2]); if (n) { f[0] += N * n[0]; f[1] = N * n[1]; f[2] += N * n[2]; } }    // a slanted deck pushes along its normal
        F = add(F, f);
        T = add(T, cross(rw, f));
      });
      this.onWater = wet;
      if (any) {
        if (!this.wasOnGround) this.wasOnGround = true;
        this.airborneT = 0;
      } else {
        this.airborneT += dt;
        if (this.airborneT > 0.3) this.wasOnGround = false;
      }
      return { F, T };
    }

    /**
     * A float on the water: buoyancy (spring on the immersion + damping), water drag along the float
     * with the "hump" before it planes, keel side force, and the water rudder steering the bow.
     */
    floatOnWater(wh, i, rw, P, pen, fwd, speed, dt, apply) {
      const S = this.spec, c = this.ceff || this.ctl;
      const vp = add(this.vel, qrot(this.q, cross(this.w, wh.r)));
      if (!this.gearHit[i]) {
        this.gearHit[i] = true;
        if (this.wheelAir[i] > 0.5) {
          this.events.push({ type: 'touch', wheel: i, vs: -vp[1], pos: P, surface: 'water' });
          if (-vp[1] > S.gearMaxVs) { this.crash('the floats dug in (hard water landing)'); return; }
        }
      }
      this.wheelAir[i] = 0;
      const N = Math.max(0, wh.k * pen - wh.c * vp[1]);
      this.wheelLoad[i] = N;
      let dir = [fwd[0], 0, fwd[2]];
      if (wh.steer) {                                   // water rudder: works when slow, retracted / useless when fast
        const st = c.yaw * 0.5 * Math.min(1, Math.pow(5 / Math.max(1, speed), 1.2));
        const cs = Math.cos(st), sn = Math.sin(st);
        dir = [fwd[0] * cs - fwd[2] * sn, 0, fwd[0] * sn + fwd[2] * cs];
      }
      dir = norm(dir);
      const side = [-dir[2], 0, dir[0]];
      const vl = dot(vp, dir), vs = dot(vp, side), sp = Math.abs(vl);
      // displacement drag rising to the hump (~9 m/s), then much less once the floats plane on their steps
      // (peak ~18 % of the weight, as for real floats), plus a little skin friction / wave drag with speed
      const mu = 0.045 + 0.13 * Math.exp(-(((sp - 9) / 6) ** 2));
      const fl = -Math.sign(vl) * Math.min(mu * N + sp * this.mass * 0.012, sp * this.mass * 8);
      const fs = -clamp(vs * this.mass * 3, -0.45 * N, 0.45 * N);   // the keels grip sideways, but slide before they can trip it over
      apply([dir[0] * fl + side[0] * fs, N, dir[2] * fl + side[2] * fs]);
    }

    checkCrash() {
      if (this.crashed) return;
      const P = this.pos;
      const S = this.spec;
      if (!S.floats && this.ground(P[0], P[2]) < 0 && P[1] < 0.5) { this.crash('ditched in the sea'); return; }
      for (let k = 0; k < S.hardpoints.length; k++) {
        const hp = S.hardpoints[k];
        const w = add(P, qrot(this.q, hp));
        const deck = this.deck(w[0], w[1], w[2]);                  // a flat top counts as ground (tail scrape, belly landing...)
        const g = deck !== null ? Math.max(deck, this.ground(w[0], w[2])) : this.ground(w[0], w[2]);
        if (w[1] < Math.max(0, g) - 0.02) {                       // the sea surface counts as ground for a wingtip
          const what = g < 0 ? 'the water' : 'the ground';
          if (g < 0 && !S.floats) { this.crash('ditched in the sea'); return; }
          // a gentle tail scrape on a flare that is too high: sparks and a scratched tail, not a crash
          const vp = add(this.vel, qrot(this.q, cross(this.w, hp))), depth = Math.max(0, g) - w[1];
          if (k === 3 && g >= 0 && vp[1] > -2.5 && depth < 0.3) {
            this.pos[1] += depth; this.vel[1] = Math.max(this.vel[1], 0); this.w[0] = Math.min(this.w[0], 0);
            if (this.time - this.scrapeT > 0.4) { this.scrapeT = this.time; this.events.push({ type: 'scrape', pos: w }); }
            continue;
          }
          if (k === 4 && this.gearPos < 0.999) { this.crash(this.gearPos < 0.05 ? 'belly landing - the gear was up' : 'the gear was not down and locked'); return; }
          this.crash(hp[1] > 1.5 ? 'flipped over' : Math.abs(hp[0]) > 1 ? `a wingtip hit ${what}` : hp[2] < 0 ? (S.engine.kind === 'jet' ? `the nose hit ${what}` : `the propeller struck ${what}`) : hp[1] < -0.5 ? 'the fuselage hit ' + what : `the tail struck ${what}`);
          return;
        }
        const hit = deck === null && this.obstacle(w[0], w[1], w[2]);
        if (hit) { this.crash(`flew into ${hit}`); return; }
      }
      const hit = this.obstacle(P[0], P[1], P[2]);
      if (hit) this.crash(`flew into ${hit}`);
    }

    crash(reason) {
      if (this.crashed) return;
      this.crashed = { reason, speed: len(this.vel), pos: this.pos.slice() };
      this.events.push({ type: 'crash', reason, speed: len(this.vel), pos: this.pos.slice() });
    }

    // ---------- readouts for the HUD
    get onGround() { return this.airborneT === 0 || this.wheelLoad.some(l => l > 0); }
    get speed() { return len(this.vel); }
    get altitude() { return this.pos[1]; }
    get agl() { return this.pos[1] - Math.max(0, this.ground(this.pos[0], this.pos[2])) - this.spec.restHeight; }
    get vs() { return this.vel[1]; }
    /** heading (0 = north, clockwise), pitch and bank in radians */
    get attitude() {
      const f = qrot(this.q, [0, 0, -1]), up = qrot(this.q, [0, 1, 0]), right = qrot(this.q, [1, 0, 0]);
      const heading = Math.atan2(f[0], -f[2]);
      const pitch = Math.asin(clamp(f[1], -1, 1));
      const bank = Math.atan2(-right[1], up[1]);
      return { heading: (heading + Math.PI * 2) % (Math.PI * 2), pitch, bank, up, fwd: f, right };
    }
    worldPoint(r) { return add(this.pos, qrot(this.q, r)); }
  }
  function add4(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]]; }
  function mul4(a, s) { return [a[0] * s, a[1] * s, a[2] * s, a[3] * s]; }

  return { Aircraft, SPEC, TYPES, TYPE_IDS, qrot, qconj, qmul, qFromEuler, coefficients, DEG };
});
