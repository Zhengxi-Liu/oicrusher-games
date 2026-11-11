/**
 * Voxel Kart Racing - arcade kart physics, shared by the server and the browser.
 *
 * Deterministic: the server steps every kart with this code once per received input, and the
 * browser replays its own unacknowledged inputs through the same code after each snapshot, so
 * the local kart responds instantly and only drifts from the server when something the client
 * cannot predict happens (a bump, a shell, a rescue).
 *
 * The model is arcade, not a tyre simulation: velocity is split into a forward and a sideways
 * part; the forward part chases the target speed, the sideways part is bled off by "grip"
 * (a lot normally, very little while drifting, which makes the kart slide).
 *
 * Kart state: {x, y, z, vx, vy, vz, yaw, ground, drift (-1/0/1), charge, boost, spin, shrink,
 *              keys (last tick's keys, for edge detection), hop, rescue (ticks left on the rescue cloud)}
 * Heading: forward = (sin yaw, cos yaw) on the x/z plane; steering right lowers yaw.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./Constants.js'), require('./Tracks.js'));
  else root.VKPhys = factory(root.VKConst, root.VKTracks);
})(typeof self !== 'undefined' ? self : this, function (K, TR) {
  'use strict';
  const { C, KEY, SURF } = K;
  const DT = C.DT;

  function reset(k, pos) {
    Object.assign(k, { x: pos.x, y: pos.y, z: pos.z, vx: 0, vy: 0, vz: 0, yaw: pos.yaw, ground: true, drift: 0, charge: 0,
                       boost: 0, spin: 0, shrink: 0, keys: 0, hop: 0, rescue: 0 });
    return k;
  }

  /** Is a circle of the kart's radius at (x, z) blocked at height y (walls, cliffs higher than a step)? */
  function blocked(T, x, z, y) {
    const r = C.KART_R;
    for (let a = 0; a < 8; a++) {
      const px = x + Math.cos(a * Math.PI / 4) * r, pz = z + Math.sin(a * Math.PI / 4) * r;
      const g = TR.groundAt(T, px, pz);
      if (g.surf === SURF.WALL ? y < g.h + 0.05 : g.h > y + C.STEP_UP) return true;
    }
    return false;
  }

  const driftTier = charge => (charge >= C.DRIFT_TIERS[2] ? 3 : charge >= C.DRIFT_TIERS[1] ? 2 : charge >= C.DRIFT_TIERS[0] ? 1 : 0);

  /**
   * Advance one kart by one tick with the given input keys.
   * Returns events: {turbo: tier released (0 none), hop, land: impact speed, rescue: fell / lava, bonk: wall hit speed, pad}
   */
  function step(k, keys, T) {
    const out = { turbo: 0, hop: false, land: 0, rescue: false, bonk: 0, pad: false };
    if (k.rescue > 0) { k.rescue--; k.keys = keys; return out; }      // riding the rescue cloud: no control
    const prev = k.keys;
    k.keys = keys;
    const up = keys & KEY.UP, down = keys & KEY.DOWN;
    const steer = ((keys & KEY.RIGHT) ? 1 : 0) - ((keys & KEY.LEFT) ? 1 : 0);
    const driftHeld = keys & KEY.DRIFT, driftPressed = driftHeld && !(prev & KEY.DRIFT);

    const fx = Math.sin(k.yaw), fz = Math.cos(k.yaw), rx = -fz, rz = fx;
    let fwd = k.vx * fx + k.vz * fz, lat = k.vx * rx + k.vz * rz;
    const g0 = TR.groundAt(T, k.x, k.z);
    const offroad = g0.surf === SURF.OFFROAD || g0.surf === SURF.WATER;
    const boosting = k.boost > 0;
    const maxS = C.MAX_SPEED * (k.cap || 1) * (k.shrink > 0 ? C.SHRINK_MUL : 1) * (offroad && !boosting ? C.OFFROAD_MUL : 1) * (boosting ? C.BOOST_SPEED : 1);

    if (k.ground) {
      if (k.spin > 0) { fwd *= 0.94; lat *= 0.9; }
      else {
        if (boosting) fwd = Math.min(maxS, fwd + C.BOOST_ACCEL * DT);
        else if (up) { if (fwd < maxS) fwd = Math.min(maxS, fwd + C.ACCEL * DT * (1.15 - 0.55 * Math.max(0, fwd) / C.MAX_SPEED) + (fwd < 0 ? C.BRAKE * DT : 0)); }
        else if (down) fwd = fwd > 0.5 ? fwd - C.BRAKE * DT : Math.max(-C.REVERSE_SPEED, fwd - C.ACCEL * 0.7 * DT);
        else fwd = fwd > 0 ? Math.max(0, fwd - C.COAST * DT) : Math.min(0, fwd + C.COAST * DT);
        if (fwd > maxS) fwd = Math.max(maxS, fwd - 34 * DT);          // offroad / end of boost: shed speed quickly
      }
      lat *= 1 - (k.drift ? C.DRIFT_GRIP : C.GRIP);
      // pads and ramps
      if (g0.surf === SURF.BOOST || g0.surf === SURF.JUMP) { if (k.boost < C.PAD_TICKS) out.pad = true; k.boost = Math.max(k.boost, C.PAD_TICKS); }
      if (g0.surf === SURF.JUMP && fwd > 4) { k.vy = C.JUMP_V; k.ground = false; k.hop = 0; }
    } else {
      fwd *= 0.999;
      lat *= 0.995;
    }

    // ---------- drifting
    const speed = Math.abs(fwd);
    if (k.spin > 0 || speed < C.DRIFT_MIN_SPEED * 0.6 || fwd < 0) { k.drift = 0; k.charge = 0; }
    if (driftPressed && k.ground && k.spin <= 0) { k.vy = C.HOP_V; k.ground = false; k.hop = 1; out.hop = true; }
    if (driftHeld && !k.drift && steer && speed >= C.DRIFT_MIN_SPEED && k.spin <= 0 && (k.ground || k.hop)) { k.drift = steer; k.charge = 0; }
    if (k.drift && !driftHeld) {
      const tier = driftTier(k.charge);
      if (tier) { k.boost = Math.max(k.boost, C.DRIFT_BOOST[tier - 1]); out.turbo = tier; }
      k.drift = 0; k.charge = 0;
    }
    if (k.drift && k.ground) k.charge += steer === k.drift ? 1.6 : steer === 0 ? 1 : 0.5;

    // ---------- steering
    if (k.spin <= 0) {
      const auth = Math.min(1, speed / 7) * (1 - 0.3 * Math.min(1, speed / C.MAX_SPEED)) * (k.ground ? 1 : 0.55);
      let rate;
      if (k.drift) rate = k.drift * C.TURN_RATE * C.DRIFT_TURN * (0.55 + 0.45 * steer * k.drift) * Math.max(0.6, auth);
      else rate = steer * C.TURN_RATE * auth * (fwd < 0 ? -1 : 1);
      k.yaw -= rate * DT;
      if (k.yaw > Math.PI) k.yaw -= Math.PI * 2; else if (k.yaw < -Math.PI) k.yaw += Math.PI * 2;
    }

    // rebuild the velocity on the (possibly new) heading: the kart carries its speed through turns,
    // except for the sideways part, which grip bleeds off
    const nfx = Math.sin(k.yaw), nfz = Math.cos(k.yaw), nrx = -nfz, nrz = nfx;
    k.vx = nfx * fwd + nrx * lat;
    k.vz = nfz * fwd + nrz * lat;

    // ---------- move horizontally, one axis at a time so karts slide along walls
    const nx = k.x + k.vx * DT;
    if (blocked(T, nx, k.z, k.y)) { out.bonk = Math.max(out.bonk, Math.abs(k.vx)); k.vx *= -0.35; k.vz *= 0.85; k.drift = 0; k.charge = 0; }
    else k.x = nx;
    const nz = k.z + k.vz * DT;
    if (blocked(T, k.x, nz, k.y)) { out.bonk = Math.max(out.bonk, Math.abs(k.vz)); k.vz *= -0.35; k.vx *= 0.85; k.drift = 0; k.charge = 0; }
    else k.z = nz;

    // ---------- vertical: gravity, landing, sticking to downhill roads
    const g = TR.groundAt(T, k.x, k.z);
    const wasGround = k.ground;
    k.vy -= C.GRAVITY * DT;
    let ny = k.y + k.vy * DT;
    if (wasGround && k.vy <= 0 && g.h < k.y && k.y - g.h < 0.75) ny = g.h;           // glue to slopes and small drops
    if (ny <= g.h) {
      if (!wasGround) out.land = -k.vy;
      k.y = g.h; k.vy = 0; k.ground = true; k.hop = 0;
    } else { k.y = ny; k.ground = false; }
    if (!k.ground && k.y < g.h + 0.02) k.ground = true;

    if (g.surf === SURF.LAVA && k.y <= g.h + 0.3) out.rescue = true;
    if (k.y < C.VOID_Y) out.rescue = true;

    if (k.boost > 0) k.boost--;
    if (k.spin > 0) k.spin--;
    if (k.shrink > 0) k.shrink--;
    return out;
  }

  // ---------- network packing of the full movement state (for the owner's reconciliation)
  const FIELDS = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'yaw', 'ground', 'drift', 'charge', 'boost', 'spin', 'shrink', 'keys', 'hop', 'rescue'];
  const r4 = v => Math.round(v * 10000) / 10000;
  function packState(k) { return FIELDS.map(f => (typeof k[f] === 'boolean' ? (k[f] ? 1 : 0) : r4(k[f]))); }
  function unpackState(a, k = {}) { FIELDS.forEach((f, i) => { k[f] = f === 'ground' ? !!a[i] : a[i]; }); return k; }

  return { reset, step, blocked, driftTier, packState, unpackState, NSTATE: FIELDS.length };
});
