/**
 * Rooftop Tag - shared movement simulation. The server runs it as the authority; the browser runs
 * the very same code to predict its own runner and replays unacknowledged inputs on top of each
 * snapshot, so every rule here must be deterministic (no randomness, no wall-clock time).
 *
 * World: axis-aligned boxes (solid), ramps (a box whose top is a slope along x or z), jump pads.
 * Player state: {x, y, z (feet), vx, vy, vz, onGround, yaw, pitch, crouch, slide, slideCool,
 *                wr (wall-run budget), wrOn, wrNx, wrNz, lastWx, lastWz, wjCool, jh (jump held),
 *                ch (crouch held), hook, hx, hy, hz, hookT, hookCool, hh (hook held), padCool, carry, cool}
 * Input: {m: MOVE bits, yaw, pitch, b: BTN bits}
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./Constants.js'));
  else root.RTMove = factory(root.RTConst);
})(typeof self !== 'undefined' ? self : this, function (K) {
  'use strict';
  const { C, MOVE, BTN } = K;
  const EPS = 1e-4;

  // ---------- world
  /**
   * boxes: [x0, y0, z0, x1, y1, z1, material, anchor?]
   * ramps: {box: [x0, y0, z0, x1, y1, z1], axis: 'x' | 'z', dir: +1 | -1, mat}  - the top rises from y0 + low
   *        at the low end to y1 at the high end; `dir` is the direction (along `axis`) in which it rises.
   * pads:  {box: [x0, y, z0, x1, z1], v: [vx, vy, vz]}
   */
  function makeWorld(def) {
    const statics = def.BOXES.map(a => ({ x0: Math.min(a[0], a[3]), y0: Math.min(a[1], a[4]), z0: Math.min(a[2], a[5]),
                                          x1: Math.max(a[0], a[3]), y1: Math.max(a[1], a[4]), z1: Math.max(a[2], a[5]), mat: a[6], anchor: !!a[7] }));
    const ramps = (def.RAMPS || []).map(r => {
      const [x0, y0, z0, x1, y1, z1] = r.box;
      const low = r.low || 0;
      const len = r.axis === 'x' ? x1 - x0 : z1 - z0;
      return { x0, y0, z0, x1, y1, z1, axis: r.axis, dir: r.dir, low: y0 + low, mat: r.mat, slope: (y1 - (y0 + low)) / len, ramp: true };
    });
    const pads = (def.PADS || []).map(p => ({ x0: p.box[0], y: p.box[1], z0: p.box[2], x1: p.box[3], z1: p.box[4], v: p.v }));
    return { statics, ramps, pads };
  }

  /** Height of a ramp's top surface at (x, z) (clamped into the footprint). */
  function rampHeight(r, x, z) {
    const s = r.axis === 'x' ? x : z, s0 = r.axis === 'x' ? r.x0 : r.z0, s1 = r.axis === 'x' ? r.x1 : r.z1;
    let t = (Math.max(s0, Math.min(s1, s)) - s0) / (s1 - s0);
    if (r.dir < 0) t = 1 - t;
    return r.low + (r.y1 - r.low) * t;
  }
  const inFoot = (r, x, z, m = 0) => x >= r.x0 - m && x <= r.x1 + m && z >= r.z0 - m && z <= r.z1 + m;

  const heightOf = p => (p.crouch ? C.CROUCH_H : C.PLAYER_H);
  const eyeOf = p => (p.crouch ? C.CROUCH_EYE : C.EYE);

  function overlaps(p, b, h = heightOf(p)) {
    const R = C.PLAYER_R;
    return p.x + R > b.x0 + EPS && p.x - R < b.x1 - EPS && p.z + R > b.z0 + EPS && p.z - R < b.z1 - EPS
        && p.y + h > b.y0 + EPS && p.y < b.y1 - EPS;
  }

  function blocked(p, world, h) {
    for (const b of world.statics) if (overlaps(p, b, h)) return true;
    return false;
  }

  /** Move along one axis and push back out of anything we ran into. Returns the box hit, or null. */
  function moveAxis(p, axis, d, world) {
    if (!d) return null;
    p[axis] += d;
    let hit = null;
    const h = heightOf(p);
    for (const b of world.statics) {
      if (!overlaps(p, b, h)) continue;
      hit = b;
      if (axis === 'x') p.x = d > 0 ? b.x0 - C.PLAYER_R - EPS : b.x1 + C.PLAYER_R + EPS;
      else if (axis === 'z') p.z = d > 0 ? b.z0 - C.PLAYER_R - EPS : b.z1 + C.PLAYER_R + EPS;
      else p.y = d > 0 ? b.y0 - h - EPS : b.y1 + EPS;
    }
    return hit;
  }

  /** A ramp side is a wall: we may only be inside a footprint at (or above) the ramp surface. */
  function insideRampSide(p, world) {
    for (const r of world.ramps) {
      if (!inFoot(r, p.x, p.z)) continue;
      const h = rampHeight(r, p.x, p.z);
      if (p.y < h - C.STEP - 0.15 && p.y + heightOf(p) > r.y0 + EPS) return true;
    }
    return false;
  }

  /** Horizontal move; on the ground, a blocked move retries one stair step higher. */
  function moveHorizontal(p, dx, dz, world) {
    const sx = p.x, sy = p.y, sz = p.z;
    const hx = moveAxis(p, 'x', dx, world), hz = moveAxis(p, 'z', dz, world);
    if (insideRampSide(p, world)) { p.x = sx; p.z = sz; return { hx: true, hz: true }; }
    if (!(hx || hz) || !p.onGround) return { hx, hz };
    const ax = p.x, ay = p.y, az = p.z;
    p.x = sx; p.y = sy; p.z = sz;
    if (moveAxis(p, 'y', C.STEP, world)) { p.x = ax; p.y = ay; p.z = az; return { hx, hz }; }
    moveAxis(p, 'x', dx, world);
    moveAxis(p, 'z', dz, world);
    moveAxis(p, 'y', -C.STEP - 0.02, world);
    const stepped = Math.hypot(p.x - sx, p.z - sz), flat = Math.hypot(ax - sx, az - sz);
    if (stepped <= flat + 1e-3 || p.y < sy - 0.01 || insideRampSide(p, world)) { p.x = ax; p.y = ay; p.z = az; return { hx, hz }; }
    return { hx: null, hz: null };
  }

  function groundBelow(p, world) {
    const y = p.y;
    p.y -= 0.06;
    const g = blocked(p, world);
    p.y = y;
    return g;
  }

  /** Highest ramp surface under the player's centre that the feet may stand on, or null. */
  function rampUnder(p, world, stick) {
    let best = null, bh = -Infinity;
    for (const r of world.ramps) {
      if (!inFoot(r, p.x, p.z)) continue;
      const h = rampHeight(r, p.x, p.z);
      if (p.y >= h - C.STEP - 0.15 && p.y <= h + stick && h > bh) { bh = h; best = r; }
    }
    return best ? { r: best, h: bh } : null;
  }

  /** A wall right beside the player (tall enough to run on): returns its outward normal, or null. */
  function wallBeside(p, world) {
    const probe = { x: p.x, y: p.y + 0.7, z: p.z };
    const h = 1.0;
    for (const [ax, sgn] of [['x', 1], ['x', -1], ['z', 1], ['z', -1]]) {
      probe.x = p.x + (ax === 'x' ? sgn * 0.12 : 0);
      probe.z = p.z + (ax === 'z' ? sgn * 0.12 : 0);
      for (const b of world.statics) {
        if (!overlaps(probe, b, h)) continue;
        return ax === 'x' ? [-sgn, 0] : [0, -sgn];
      }
    }
    return null;
  }

  // ---------- rays
  /** Slab test: distance along a unit ray to box b, or Infinity. A ramp also clips against its slope. */
  function rayBox(ox, oy, oz, dx, dy, dz, b, maxT) {
    let t0 = 0, t1 = maxT;
    for (const [o, d, lo, hi] of [[ox, dx, b.x0, b.x1], [oy, dy, b.y0, b.y1], [oz, dz, b.z0, b.z1]]) {
      if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return Infinity; continue; }
      let a = (lo - o) / d, c = (hi - o) / d;
      if (a > c) { const t = a; a = c; c = t; }
      if (a > t0) t0 = a;
      if (c < t1) t1 = c;
      if (t0 > t1) return Infinity;
    }
    if (b.ramp) {
      // solid where  y <= low + slope * (s - sLow)  ->  f(t) = y(t) - surface(t) <= 0
      const sAx = b.axis === 'x' ? 0 : 2, sLow = b.dir > 0 ? (b.axis === 'x' ? b.x0 : b.z0) : (b.axis === 'x' ? b.x1 : b.z1);
      const os = sAx === 0 ? ox : oz, ds = sAx === 0 ? dx : dz;
      const k = b.slope * b.dir;
      const f0 = oy - (b.low + k * (os - sLow)), fd = dy - k * ds;     // f(t) = f0 + fd * t
      if (Math.abs(fd) < 1e-9) { if (f0 > 0) return Infinity; }
      else {
        const tc = -f0 / fd;
        if (fd > 0) { if (tc < t1) t1 = tc; } else if (tc > t0) t0 = tc;
        if (t0 > t1) return Infinity;
      }
    }
    return t0;
  }

  /** First solid hit along the ray: {t, box} (t = maxT if nothing). */
  function raycast(world, ox, oy, oz, dx, dy, dz, maxT) {
    let best = maxT, hit = null;
    for (const b of world.statics) { const t = rayBox(ox, oy, oz, dx, dy, dz, b, best); if (t < best) { best = t; hit = b; } }
    for (const b of world.ramps) { const t = rayBox(ox, oy, oz, dx, dy, dz, b, best); if (t < best) { best = t; hit = b; } }
    return { t: best, box: hit };
  }

  function aimDir(yaw, pitch) {
    const cp = Math.cos(pitch);
    return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
  }

  /** Body hitbox of a player (lag-compensated traces use the recorded crouch state). */
  function hitbox(x, y, z, crouch) {
    const R = C.PLAYER_R + 0.06;
    return { x0: x - R, x1: x + R, y0: y, y1: y + (crouch ? C.CROUCH_H : C.PLAYER_H) + 0.05, z0: z - R, z1: z + R };
  }

  function resetMove(p) {
    Object.assign(p, { vx: 0, vy: 0, vz: 0, onGround: true, crouch: false, slide: 0, slideCool: 0, wr: C.WALLRUN_TICKS, wrOn: false,
                       wrNx: 0, wrNz: 0, lastWx: 0, lastWz: 0, wjCool: 0, jh: false, ch: false, hook: false, hx: 0, hy: 0, hz: 0,
                       hookT: 0, hookCool: 0, hh: false, padCool: 0, cool: 0, landed: false });
  }

  // ---------- movement
  /**
   * One 1/60 s step. Returns what happened (for sounds/effects and server events):
   *   {pad: index | -1, walljump: bool, hook: 'hit' | 'miss' | 'release' | null, slide: bool (started), land: speed}
   */
  function stepMove(p, inp, world) {
    const dt = C.DT, out = { pad: -1, walljump: false, hook: null, slide: false, land: 0 };
    p.yaw = inp.yaw;
    p.pitch = Math.max(-1.5, Math.min(1.5, inp.pitch));
    if (p.slideCool > 0) p.slideCool--;
    if (p.wjCool > 0) p.wjCool--;
    if (p.hookCool > 0) p.hookCool--;
    if (p.padCool > 0) p.padCool--;

    const jump = !!(inp.m & MOVE.JUMP), jumpEdge = jump && !p.jh;
    const crouchKey = !!(inp.m & MOVE.CROUCH), crouchEdge = crouchKey && !p.ch;
    const hookKey = !!(inp.b & BTN.HOOK), hookEdge = hookKey && !p.hh;
    p.jh = jump; p.ch = crouchKey; p.hh = hookKey;

    const f = ((inp.m & MOVE.FWD) ? 1 : 0) - ((inp.m & MOVE.BACK) ? 1 : 0);
    const s = ((inp.m & MOVE.RIGHT) ? 1 : 0) - ((inp.m & MOVE.LEFT) ? 1 : 0);
    const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
    let wx = -sin * f + cos * s, wz = -cos * f - sin * s;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }
    const speedMul = p.carry ? C.CARRY_MUL : 1;

    const accelerate = (wishSpeed, accel) => {
      const cur = p.vx * wx + p.vz * wz, add = wishSpeed - cur;
      if (add <= 0) return;
      const a = Math.min(add, accel * C.MAX_SPEED * dt);
      p.vx += a * wx; p.vz += a * wz;
    };
    const hspeed = () => Math.hypot(p.vx, p.vz);

    // --- crouch / stand up (only if there is head room)
    const wantCrouch = crouchKey || p.slide > 0;
    if (wantCrouch) p.crouch = true;
    else if (p.crouch && !blocked(p, world, C.PLAYER_H)) p.crouch = false;

    // --- grappling hook
    if (p.hook && (!hookKey || p.hookT++ >= C.HOOK_TICKS)) { p.hook = false; p.hookCool = C.HOOK_COOL; out.hook = 'release'; }
    else if (!p.hook && hookEdge && p.hookCool === 0) {
      const d = aimDir(p.yaw, p.pitch), ey = p.y + eyeOf(p);
      const h = raycast(world, p.x, ey, p.z, d[0], d[1], d[2], C.HOOK_RANGE);
      if (h.box && h.box.anchor) {
        p.hook = true; p.hookT = 0;
        p.hx = p.x + d[0] * h.t; p.hy = ey + d[1] * h.t; p.hz = p.z + d[2] * h.t;
        p.slide = 0; p.wrOn = false;
        out.hook = 'hit';
      } else { p.hookCool = 20; out.hook = 'miss'; }
    }
    if (p.hook) {
      const ey = p.y + eyeOf(p);
      const dx = p.hx - p.x, dy = p.hy - ey, dz = p.hz - p.z, d = Math.hypot(dx, dy, dz);
      if (d < C.HOOK_RELEASE_DIST || jumpEdge) {
        p.hook = false; p.hookCool = C.HOOK_COOL; out.hook = 'release';
        if (jumpEdge) p.vy = Math.max(p.vy, 5.5);
      } else {
        const nx = dx / d, ny = dy / d, nz = dz / d;
        if (p.vx * nx + p.vy * ny + p.vz * nz < C.HOOK_MAX) {
          p.vx += nx * C.HOOK_PULL * dt; p.vy += ny * C.HOOK_PULL * dt; p.vz += nz * C.HOOK_PULL * dt;
        }
        if (p.onGround && ny > -0.2) { p.onGround = false; p.vy = Math.max(p.vy, 2); }
      }
    }

    // --- ground movement, slides, jumps
    const airborne = !p.onGround;                     // at the start of the tick (wall jumps need it)
    const ramp = p.onGround ? rampUnder(p, world, 0.06) : null;
    if (p.onGround && !p.hook) {
      p.wr = C.WALLRUN_TICKS; p.wrOn = false; p.lastWx = 0; p.lastWz = 0;
      // start a slide: crouch while running fast (or land while holding crouch at speed)
      if (p.slide === 0 && p.slideCool === 0 && crouchKey && hspeed() >= C.SLIDE_MIN * speedMul && (crouchEdge || p.landed)) {
        const sp = hspeed(), ns = Math.min(C.MAX_HSPEED, sp + C.SLIDE_BOOST);
        p.vx *= ns / sp; p.vz *= ns / sp;
        p.slide = C.SLIDE_TICKS; p.crouch = true;
        out.slide = true;
      }
      if (p.slide > 0) {
        const sp = hspeed();
        if (sp > 0) { const ns = Math.max(0, sp - Math.max(sp, C.STOP_SPEED) * C.SLIDE_FRICTION * dt) / sp; p.vx *= ns; p.vz *= ns; }
        if (wl > 0) accelerate(1.5, 2);                                  // a little steering
        let downhill = false;
        if (ramp) {                                                      // slopes pull a sliding runner downhill
          const k = ramp.r.slope, a = -ramp.r.dir * C.GRAVITY * k / (1 + k * k) * C.SLIDE_GRAVITY * dt;
          if (ramp.r.axis === 'x') { p.vx += a; downhill = p.vx * -ramp.r.dir > 0; } else { p.vz += a; downhill = p.vz * -ramp.r.dir > 0; }
        }
        if (!downhill) p.slide--;
        if (!crouchKey || hspeed() < 3.2) p.slide = 0;
        if (p.slide === 0) p.slideCool = C.SLIDE_COOL;
      } else {
        const sp = hspeed();
        if (sp > 0) { const ns = Math.max(0, sp - Math.max(sp, C.STOP_SPEED) * C.FRICTION * dt) / sp; p.vx *= ns; p.vz *= ns; }
        if (wl > 0) accelerate((p.crouch ? C.CROUCH_SPEED : C.MAX_SPEED) * speedMul, C.ACCEL);
      }
      if (jump) {
        p.vy = C.JUMP_V; p.onGround = false;
        if (p.slide > 0) { p.slide = 0; p.slideCool = C.SLIDE_COOL; }
      }
    } else if (!p.onGround) {
      if (p.slide > 0) { p.slide = 0; p.slideCool = C.SLIDE_COOL; }
      if (wl > 0) accelerate(C.AIR_WISH, C.AIR_ACCEL * 6);
    }
    p.landed = false;

    // --- wall running and wall jumps (airborne only)
    let gravity = C.GRAVITY;
    if (!p.onGround && !p.hook) {
      const n = wallBeside(p, world);
      const sp = hspeed();
      if (n && jumpEdge && airborne && p.wjCool === 0) {
        p.vx += n[0] * C.WALLJUMP_PUSH; p.vz += n[1] * C.WALLJUMP_PUSH;
        p.vy = Math.max(p.vy, C.WALLJUMP_UP);
        p.wjCool = C.WALLJUMP_COOL; p.wrOn = false;
        p.lastWx = n[0]; p.lastWz = n[1];
        out.walljump = true;
      } else if (n && (inp.m & MOVE.FWD) && sp >= C.WALLRUN_MIN && p.wjCool === 0 && Math.abs((p.vx * n[0] + p.vz * n[1]) / sp) < 0.75) {
        if (!p.wrOn && (n[0] !== p.lastWx || n[1] !== p.lastWz)) p.wr = C.WALLRUN_TICKS;   // a new wall refills the budget
        if (p.wr > 0) {
          if (!p.wrOn && p.vy < 0) p.vy *= 0.35;                          // catch onto the wall
          p.wrOn = true; p.wrNx = n[0]; p.wrNz = n[1]; p.wr--;
          gravity *= C.WALLRUN_GRAVITY;
          const into = p.vx * n[0] + p.vz * n[1];                         // drop velocity into the wall, keep a tiny pull
          p.vx -= n[0] * (into + 0.4); p.vz -= n[1] * (into + 0.4);
          p.lastWx = n[0]; p.lastWz = n[1];
        } else p.wrOn = false;
      } else p.wrOn = false;
    } else if (p.hook) p.wrOn = false;
    if (p.hook) gravity *= 0.45;

    // --- speed cap, integrate
    const hs = hspeed();
    if (hs > C.MAX_HSPEED) { p.vx *= C.MAX_HSPEED / hs; p.vz *= C.MAX_HSPEED / hs; }
    if (!p.onGround) p.vy -= gravity * dt;

    const wasGround = p.onGround, fallV = p.vy;
    const hit = moveHorizontal(p, p.vx * dt, p.vz * dt, world);
    if (hit.hx) p.vx = 0;
    if (hit.hz) p.vz = 0;
    const vy = p.vy;
    if (moveAxis(p, 'y', vy * dt, world)) {
      if (vy < 0) p.onGround = true;
      p.vy = 0;
    } else if (vy <= 0) {
      p.onGround = groundBelow(p, world);
      if (p.onGround) p.vy = 0;
    } else p.onGround = false;

    // ramps: stand on the slope (and stick to it while running downhill)
    if (p.vy <= 0) {
      const ru = rampUnder(p, world, wasGround ? 0.45 : 0.04);
      if (ru && (p.y <= ru.h + 0.04 || wasGround)) {
        if (!blocked({ x: p.x, y: ru.h + EPS, z: p.z, crouch: p.crouch }, world)) { p.y = ru.h + EPS; p.vy = 0; p.onGround = true; }
      }
    }
    if (p.onGround && !wasGround) { p.landed = true; out.land = -fallV; p.wrOn = false; }

    // jump pads
    if (p.onGround && p.padCool === 0) {
      for (let i = 0; i < world.pads.length; i++) {
        const pd = world.pads[i];
        if (Math.abs(p.y - pd.y) < 0.08 && p.x >= pd.x0 && p.x <= pd.x1 && p.z >= pd.z0 && p.z <= pd.z1) {
          p.vx = pd.v[0]; p.vy = pd.v[1]; p.vz = pd.v[2];
          p.onGround = false; p.padCool = 30; p.slide = 0; p.hook = false;
          out.pad = i;
          break;
        }
      }
    }
    if (p.y < -40) { p.y = -40; p.vy = 0; }
    return out;
  }

  /** Tagger timing (damage happens on the server). Returns true when a shot goes off. */
  function stepWeapon(p, inp) {
    if (p.cool > 0) p.cool--;
    if ((inp.b & BTN.FIRE) && p.cool === 0) { p.cool = C.TAGGER_RATE; return true; }
    return false;
  }

  // ---------- state transfer: the server sends a runner its full movement state so the browser can
  // overwrite its prediction and replay unacknowledged inputs exactly
  const STATE = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'onGround', 'crouch', 'slide', 'slideCool', 'wr', 'wrOn', 'wrNx', 'wrNz',
                 'lastWx', 'lastWz', 'wjCool', 'jh', 'ch', 'hook', 'hx', 'hy', 'hz', 'hookT', 'hookCool', 'hh', 'padCool', 'carry', 'cool', 'landed'];
  const BOOLS = new Set(['onGround', 'crouch', 'wrOn', 'jh', 'ch', 'hook', 'hh', 'carry', 'landed']);
  const r4 = v => Math.round(v * 10000) / 10000;
  function packState(p) { return STATE.map(k => (BOOLS.has(k) ? (p[k] ? 1 : 0) : r4(p[k] || 0))); }
  function unpackState(a, p = {}) { STATE.forEach((k, i) => { p[k] = BOOLS.has(k) ? !!a[i] : a[i]; }); return p; }

  return { makeWorld, rampHeight, overlaps, blocked, heightOf, eyeOf, stepMove, stepWeapon, rayBox, raycast, aimDir, hitbox,
           resetMove, wallBeside, packState, unpackState };
});
