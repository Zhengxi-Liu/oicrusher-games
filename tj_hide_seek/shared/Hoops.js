/**
 * TJ Hide and Seek - "Shoot Around": three-point shooting at the hoops in Gym 1 and Gym 2.
 * Shared by the client (hoop models, aiming, the ball's flight) and the server (which replays every shot to decide
 * whether it went in, so a streak on the leaderboard is always real). UMD: window.TJHoops / module.exports.
 *
 * A shot is { hoop, x, z, ang (launch angle, degrees), pow (0..1, where the player let go of the power meter) }.
 * The ball flies at the speed that would drop it through the middle of the rim, off by an error that depends on how far
 * pow was from the meter's sweet spot: inside the green zone it always goes in, just outside it rattles around the rim,
 * further out it misses. The zone is widest for a nice high arc (about 52 degrees) and its spot moves up with distance.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TJHoops = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const G = 9.81;
  const BALL_R = 0.12;              // men's ball, 29.5"
  const RIM_R = 0.2286;             // 18" rim
  const RIM_TUBE = 0.01;
  const RIM_Y = 3.05;               // 10 ft
  const RIM_OUT = 0.4;              // rim centre in front of the hoop's origin (the backboard face is at 0.125)
  const BOARD = { z: 0.125, hw: 0.9, y0: 2.875, y1: 3.925 };
  const RELEASE_Y = 2.25;           // jump shot
  const THREE_PT = 6.75;            // the painted arc (FIBA); straight lines in the corners
  const BASELINE = 1.6;             // baseline behind the rim centre
  const MAX_D = 9.5;                // keep it a three, not a half-court heave
  const HOOP_OFF = 2.4;             // hoop origin from the end wall (rim centre 2.8 m out, the painted basket)
  const HOOP_OFF_DOOR = 4.4;        // ...2 m further in when a door in an end wall would open right onto the hoop's pole
  const ANG = [40, 70];
  const BEST_ANG = 52;

  /**
   * How far the hoops stand from the end walls in this gym. Normally HOOP_OFF; if a door in either end wall is near the
   * middle (where the pole would stand in front of it), both hoops - and the painted court, see courtTexture - move in.
   */
  function hoopOffset(map, rm) {
    const bb = map.bbox(rm.poly), long = bb.x1 - bb.x0 > bb.z1 - bb.z0, cx = (bb.x0 + bb.x1) / 2, cz = (bb.z0 + bb.z1) / 2;
    const blocked = rm.doors.some(d => long ? Math.abs(d.nx) > 0.7 && Math.abs(d.z - cz) < 2.5 + d.w / 2 : Math.abs(d.nz) > 0.7 && Math.abs(d.x - cx) < 2.5 + d.w / 2);
    return blocked ? HOOP_OFF_DOOR : HOOP_OFF;
  }

  /** Every hoop: {id, room, x, z, rot, dir:[dx,dz], side:[sx,sz], rim:{x,y,z}, ball:{x,z}} - two per gym, at the ends. */
  function hoops(map) {
    const out = [];
    for (const rm of map.rooms) {
      if (rm.kind !== 'gym' || !/^Gym \d/.test(rm.name)) continue;
      const bb = map.bbox(rm.poly), cx = (bb.x0 + bb.x1) / 2, cz = (bb.z0 + bb.z1) / 2;
      const long = bb.x1 - bb.x0 > bb.z1 - bb.z0, off = hoopOffset(map, rm);
      const ends = long ? [[bb.x0 + off, cz, Math.PI / 2], [bb.x1 - off, cz, -Math.PI / 2]]
                        : [[cx, bb.z0 + off, 0], [cx, bb.z1 - off, Math.PI]];
      ends.forEach(([x, z, rot], i) => {
        const dir = [Math.sin(rot), Math.cos(rot)], side = [dir[1], -dir[0]];
        const rim = { x: x + dir[0] * RIM_OUT, y: RIM_Y, z: z + dir[1] * RIM_OUT };
        out.push({ id: out.length, room: rm.name, end: i, x, z, rot, dir, side, rim, ball: { x: rim.x + dir[0] * 0.5, z: rim.z + dir[1] * 0.5 } });
      });
    }
    return out;
  }

  /** (along, lat): metres in front of the rim centre (towards the court) and to its side. */
  const local = (h, x, z) => { const dx = x - h.rim.x, dz = z - h.rim.z; return [dx * h.dir[0] + dz * h.dir[1], dx * h.side[0] + dz * h.side[1]]; };
  const world = (h, a, l) => [h.rim.x + h.dir[0] * a + h.side[0] * l, h.rim.z + h.dir[1] * a + h.side[1] * l];

  /** Behind the three-point line (and in front of the baseline, not too deep)? */
  function isThree(h, x, z, tol = 0) {
    const [a, l] = local(h, x, z), d = Math.hypot(a, l);
    if (a < -BASELINE + 0.3 - tol || d > MAX_D + tol) return false;
    return a < 0 ? Math.abs(l) >= THREE_PT - tol : d >= THREE_PT - tol;
  }
  /** The nearest legal spot: pushed back behind the arc / corner lines, pulled in from too deep. */
  function clampSpot(h, x, z) {
    let [a, l] = local(h, x, z);
    a = Math.max(a, -BASELINE + 0.3);
    let d = Math.hypot(a, l);
    if (a < 0) { if (Math.abs(l) < THREE_PT) l = (l < 0 ? -1 : 1) * THREE_PT; }
    else if (d < THREE_PT) { const k = THREE_PT / (d || 1e-6); a = d ? a * k : THREE_PT; l *= k; }
    d = Math.hypot(a, l);
    if (d > MAX_D) { a *= MAX_D / d; l *= MAX_D / d; }
    return world(h, a, l);
  }

  // ---------------------------------------------------------------- the power meter
  /** Where on the meter (0..1) the perfect release is for a shot from distance d: further = more power. */
  const sweet = d => Math.max(0.35, Math.min(0.9, 0.55 + (d - THREE_PT) * 0.12));
  /** Half-width of the green zone: 0.035 at the best arc, down to 0.014 for a flat or very high one. */
  const zone = ang => 0.035 * Math.max(0.4, 1 - Math.abs(ang - BEST_ANG) / 22);
  /** Launch speed that drops the ball through the middle of the rim, or 0 if that angle cannot get there. */
  function idealSpeed(d, ang) {
    const t = ang * Math.PI / 180, dh = RIM_Y - RELEASE_Y, den = 2 * Math.cos(t) ** 2 * (d * Math.tan(t) - dh);
    return den > 0 ? Math.sqrt(G * d * d / den) : 0;
  }

  /** Initial position and velocity of a shot (aimed straight at the rim; only its speed is off). */
  function launch(h, shot) {
    const ang = Math.max(ANG[0], Math.min(ANG[1], +shot.ang || 0)), pow = Math.max(0, Math.min(1, +shot.pow || 0));
    const dx = h.rim.x - shot.x, dz = h.rim.z - shot.z, d = Math.hypot(dx, dz) || 1;
    const e = pow - sweet(d), z = zone(ang), a = Math.abs(e);
    const tau = 0.6 * (RIM_R - BALL_R) / (2 * (d - 0.3));              // relative speed error that still swishes, with margin
    const err = (a <= z ? (a / z) * tau : tau + (a - z) * 0.35) * Math.sign(e);
    // the release point is 0.3 m in front of the shooter, so the ball has 0.3 m less to fly
    const v = idealSpeed(d - 0.3, ang) * (1 + err), t = ang * Math.PI / 180;
    return { p: [shot.x + dx / d * 0.3, RELEASE_Y, shot.z + dz / d * 0.3], v: [dx / d * v * Math.cos(t), v * Math.sin(t), dz / d * v * Math.cos(t)], d, err };
  }

  /**
   * Fly the ball: gravity, the rim (a thin torus), the backboard, the floor. Fixed 1/240 s steps, so the client and
   * the server get the same answer. Returns {made, swish, path: [[x,y,z] every 1/60 s]}.
   */
  function simulate(h, shot) {
    const L = launch(h, shot), p = L.p.slice(), v = L.v.slice(), dt = 1 / 240;
    const path = [p.slice()];
    let made = false, rimHit = false, boardHit = false, bounces = 0;
    for (let i = 1; i <= 240 * 4; i++) {
      const py = p[1];
      v[1] -= G * dt;
      p[0] += v[0] * dt; p[1] += v[1] * dt; p[2] += v[2] * dt;
      // rim: closest point on the ring
      const rx = p[0] - h.rim.x, rz = p[2] - h.rim.z, rh = Math.hypot(rx, rz) || 1e-6;
      const q = [h.rim.x + rx / rh * RIM_R, RIM_Y, h.rim.z + rz / rh * RIM_R];
      const n = [p[0] - q[0], p[1] - q[1], p[2] - q[2]], nl = Math.hypot(n[0], n[1], n[2]);
      if (nl < BALL_R + RIM_TUBE && nl > 1e-6) {
        n[0] /= nl; n[1] /= nl; n[2] /= nl;
        const push = BALL_R + RIM_TUBE - nl;
        p[0] += n[0] * push; p[1] += n[1] * push; p[2] += n[2] * push;
        const vn = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
        if (vn < 0) {
          for (let k = 0; k < 3; k++) v[k] = (v[k] - vn * n[k]) * 0.8 - 0.55 * vn * n[k];
          rimHit = true;
        }
      }
      // backboard (front face only)
      const [ba, bl] = local(h, p[0], p[2]), bz = ba + RIM_OUT - BOARD.z;
      if (bz < BALL_R && bz > -0.15 && Math.abs(bl) < BOARD.hw && p[1] > BOARD.y0 && p[1] < BOARD.y1) {
        const push = BALL_R - bz;
        p[0] += h.dir[0] * push; p[2] += h.dir[1] * push;
        const vn = v[0] * h.dir[0] + v[2] * h.dir[1];
        if (vn < 0) { v[0] -= 1.6 * vn * h.dir[0]; v[2] -= 1.6 * vn * h.dir[1]; boardHit = true; }
      }
      // through the hoop: the centre crosses the rim plane going down, inside the ring
      if (!made && py >= RIM_Y && p[1] < RIM_Y && v[1] < 0 && Math.hypot(p[0] - h.rim.x, p[2] - h.rim.z) < RIM_R) {
        made = true;
        v[0] *= 0.35; v[2] *= 0.35; v[1] *= 0.6;                // the net
      }
      if (p[1] < BALL_R) { p[1] = BALL_R; if (v[1] < 0) { v[1] = -v[1] * 0.6; v[0] *= 0.8; v[2] *= 0.8; bounces++; } }
      if (i % 4 === 0) path.push([+p[0].toFixed(3), +p[1].toFixed(3), +p[2].toFixed(3)]);
      if (bounces >= 3) break;
    }
    return { made, swish: made && !rimHit && !boardHit, rim: rimHit, board: boardHit, path, d: L.d };
  }

  return { BALL_R, RIM_R, RIM_Y, RELEASE_Y, THREE_PT, MAX_D, ANG, BEST_ANG, RIM_OUT, BASELINE, hoopOffset, hoops, local, world, isThree, clampSpot, sweet, zone, idealSpeed, launch, simulate };
});
