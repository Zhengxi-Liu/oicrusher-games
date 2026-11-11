/**
 * Half-Life Web Deathmatch - shared simulation: collision world, player movement, raycasts and
 * weapon timing. The server runs it as the authority; the browser runs the very same code to
 * predict its own player and replays unacknowledged inputs on top of each snapshot.
 *
 * Player state used here: {x, y, z (feet), vx, vy, vz, onGround, crouch, yaw, pitch,
 *                         owned (bitmask), cur, prev, mag{}, res{}, alt, cool, reloadT, switchT, spray}
 * (mag[11] is the number of HE grenades carried)
 * Input: {m: MOVE bits, yaw, pitch, b: BTN bits, w: weapon slot request (0 = none)}
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./Constants.js'));
  else root.HLMove = factory(root.HLConst);
})(typeof self !== 'undefined' ? self : this, function (K) {
  'use strict';
  const { C, MOVE, BTN, WEAPONS, SLOT, HEG } = K;
  const EPS = 1e-4;

  // ---------- collision world
  /** Boxes as {x0,y0,z0,x1,y1,z1}. `props` are destructible boxes that only collide while alive. */
  function makeWorld(boxes, props) {
    const toBox = a => ({ x0: a[0], y0: a[1], z0: a[2], x1: a[3], y1: a[4], z1: a[5], mat: a[6] });
    return { statics: boxes.map(toBox), props: (props || []).map(p => ({ ...toBox(p.box), type: p.type, alive: true })) };
  }

  function forEachSolid(world, fn) {
    for (const b of world.statics) if (fn(b) === false) return;
    for (const b of world.props) if (b.alive && fn(b) === false) return;
  }

  const heightOf = p => (p.crouch ? C.CROUCH_H : C.PLAYER_H);
  const eyeOf = p => (p.crouch ? C.CROUCH_EYE : C.EYE);

  function overlaps(p, b, h = heightOf(p)) {
    const R = C.PLAYER_R;
    return p.x + R > b.x0 + EPS && p.x - R < b.x1 - EPS && p.z + R > b.z0 + EPS && p.z - R < b.z1 - EPS
        && p.y + h > b.y0 + EPS && p.y < b.y1 - EPS;
  }

  /** Move along one axis and push back out of anything we ran into. Returns true on contact. */
  function moveAxis(p, axis, d, world) {
    if (!d) return false;
    p[axis] += d;
    let hit = false;
    forEachSolid(world, b => {
      if (!overlaps(p, b)) return;
      hit = true;
      if (axis === 'x') p.x = d > 0 ? b.x0 - C.PLAYER_R - EPS : b.x1 + C.PLAYER_R + EPS;
      else if (axis === 'z') p.z = d > 0 ? b.z0 - C.PLAYER_R - EPS : b.z1 + C.PLAYER_R + EPS;
      else p.y = d > 0 ? b.y0 - heightOf(p) - EPS : b.y1 + EPS;
    });
    return hit;
  }

  function blocked(p, world, h) {
    let any = false;
    forEachSolid(world, b => { if (overlaps(p, b, h)) { any = true; return false; } });
    return any;
  }

  /**
   * Crouch (Ctrl / C). On the ground the box shrinks from the top; in the air the legs come up
   * (the box shrinks from the bottom), which is what makes a crouch-jump reach higher ledges.
   * Standing up needs head room.
   */
  function updateCrouch(p, want, world) {
    const dh = C.PLAYER_H - C.CROUCH_H;
    if (want && !p.crouch) {
      p.crouch = true;
      if (!p.onGround) { p.y += dh; if (blocked(p, world)) p.y -= dh; }
    } else if (!want && p.crouch) {
      if (!p.onGround) {
        const y = p.y;
        p.y -= dh;                                            // legs back down
        if (!blocked(p, world, C.PLAYER_H)) { p.crouch = false; return; }
        p.y = y;
      }
      if (!blocked(p, world, C.PLAYER_H)) p.crouch = false;
    }
  }

  /** Horizontal move; on the ground, a blocked move retries one stair step higher. */
  function moveHorizontal(p, dx, dz, world) {
    const sx = p.x, sy = p.y, sz = p.z;
    const hx = moveAxis(p, 'x', dx, world), hz = moveAxis(p, 'z', dz, world);
    if (!(hx || hz) || !p.onGround) return;
    const ax = p.x, ay = p.y, az = p.z;
    p.x = sx; p.y = sy; p.z = sz;
    if (moveAxis(p, 'y', C.STEP, world)) { p.x = ax; p.y = ay; p.z = az; return; }
    moveAxis(p, 'x', dx, world);
    moveAxis(p, 'z', dz, world);
    moveAxis(p, 'y', -C.STEP - 0.02, world);
    const stepped = Math.hypot(p.x - sx, p.z - sz), flat = Math.hypot(ax - sx, az - sz);
    if (stepped <= flat + 1e-3 || p.y < sy - 0.01) { p.x = ax; p.y = ay; p.z = az; }
  }

  function groundBelow(p, world) {
    const y = p.y;
    p.y -= 0.06;
    const g = blocked(p, world);
    p.y = y;
    return g;
  }

  /** Quake/Half-Life style movement: ground friction + acceleration, a little air control. */
  function stepMove(p, inp, world) {
    const dt = C.DT;
    p.yaw = inp.yaw;
    p.pitch = Math.max(-1.5, Math.min(1.5, inp.pitch));
    const f = ((inp.m & MOVE.FWD) ? 1 : 0) - ((inp.m & MOVE.BACK) ? 1 : 0);
    const s = ((inp.m & MOVE.RIGHT) ? 1 : 0) - ((inp.m & MOVE.LEFT) ? 1 : 0);
    updateCrouch(p, !!(inp.m & MOVE.CROUCH), world);
    const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
    let wx = -sin * f + cos * s, wz = -cos * f - sin * s;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }

    const accelerate = (wishSpeed, accel) => {
      const cur = p.vx * wx + p.vz * wz, add = wishSpeed - cur;
      if (add <= 0) return;
      const a = Math.min(add, accel * C.MAX_SPEED * dt);
      p.vx += a * wx; p.vz += a * wz;
    };

    if (p.onGround) {
      const sp = Math.hypot(p.vx, p.vz);
      if (sp > 0) {
        const drop = Math.max(sp, C.STOP_SPEED) * C.FRICTION * dt, ns = Math.max(0, sp - drop) / sp;
        p.vx *= ns; p.vz *= ns;
      }
      if (wl > 0) accelerate(C.MAX_SPEED * (p.crouch ? C.CROUCH_SPEED : 1), C.ACCEL);
      if (inp.m & MOVE.JUMP) { p.vy = C.JUMP_V; p.onGround = false; }
    } else if (wl > 0) {
      accelerate(C.AIR_WISH, C.AIR_ACCEL * 6);
    }
    if (!p.onGround) p.vy -= C.GRAVITY * dt;

    moveHorizontal(p, p.vx * dt, p.vz * dt, world);
    const vy = p.vy;
    if (moveAxis(p, 'y', vy * dt, world)) {
      if (vy < 0) p.onGround = true;
      p.vy = 0;
    } else if (vy <= 0) {
      p.onGround = groundBelow(p, world);
      if (p.onGround) p.vy = 0;
    } else p.onGround = false;
    if (p.y < -20) p.y = -20;                       // never fall out of the world
  }

  // ---------- rays
  /** Slab test: distance along a unit ray to box b, or Infinity. */
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
    return t0;
  }

  /** First solid hit along the ray: {t, box} (t = maxT if nothing). */
  function raycast(world, ox, oy, oz, dx, dy, dz, maxT) {
    let best = maxT, hit = null;
    forEachSolid(world, b => {
      const t = rayBox(ox, oy, oz, dx, dy, dz, b, best);
      if (t < best) { best = t; hit = b; }
    });
    return { t: best, box: hit };
  }

  /** Distance along a unit ray at which it leaves box b (the far side of the slab). */
  function rayBoxExit(ox, oy, oz, dx, dy, dz, b) {
    let t1 = Infinity;
    for (const [o, d, lo, hi] of [[ox, dx, b.x0, b.x1], [oy, dy, b.y0, b.y1], [oz, dz, b.z0, b.z1]]) {
      if (Math.abs(d) < 1e-9) continue;
      const c = Math.max((lo - o) / d, (hi - o) / d);
      if (c < t1) t1 = c;
    }
    return t1;
  }

  /**
   * Wall penetration (AK / M4 / AWP): follow the bullet through walls thinner than what is left of
   * its penetration budget `pen` (metres of wall in total). Returns the walls passed
   * [{tIn, tOut, box}], where the bullet stops (tEnd, the face of the wall it could not get through,
   * or maxT) and, for each wall, the damage factor `mult` applies once more.
   */
  function wallTrace(world, ox, oy, oz, dx, dy, dz, maxT, pen) {
    const walls = [];
    let t = 0, budget = pen || 0;
    for (let guard = 0; guard < 4; guard++) {
      const h = raycast(world, ox + dx * t, oy + dy * t, oz + dz * t, dx, dy, dz, maxT - t);
      if (!h.box) return { walls, tEnd: maxT, stopped: null };
      const tIn = t + h.t;
      const tOut = t + rayBoxExit(ox + dx * t, oy + dy * t, oz + dz * t, dx, dy, dz, h.box);
      const thick = tOut - tIn;
      if (thick > budget || tOut >= maxT) return { walls, tEnd: tIn, stopped: h.box };
      budget -= thick;
      walls.push({ tIn, tOut, box: h.box });
      t = tOut + 0.01;
    }
    return { walls, tEnd: t, stopped: null };
  }

  /** Body and head hitboxes of a player at (x, y, z), standing or crouched. */
  function hitboxes(x, y, z, crouch) {
    const R = C.PLAYER_R + 0.05, top = y + (crouch ? C.CROUCH_H : C.PLAYER_H) + 0.05, neck = top - C.HEAD;
    return {
      body: { x0: x - R, x1: x + R, y0: y, y1: neck, z0: z - R, z1: z + R },
      head: { x0: x - 0.24, x1: x + 0.24, y0: neck, y1: top, z0: z - 0.24, z1: z + 0.24 },
    };
  }

  function aimDir(yaw, pitch) {
    const cp = Math.cos(pitch);
    return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
  }

  // ---------- weapons (timing only; damage happens on the server)
  const owns = (p, w) => !!(p.owned & (1 << w));
  const slotOf = w => (WEAPONS[w] ? WEAPONS[w].slot : 0);
  /** The weapon the player holds in a slot (0 = empty). */
  function inSlot(p, slot) {
    for (let w = 1; w <= K.NUM_WEAPONS; w++) if (owns(p, w) && WEAPONS[w].slot === slot) return w;
    return 0;
  }
  /** What to hold after dropping / throwing: primary, else pistol, else the crowbar. */
  function bestWeapon(p) { return inSlot(p, SLOT.PRIMARY) || inSlot(p, SLOT.PISTOL) || 1; }
  /** Can the player pick up weapon w? 'new' (free slot), 'ammo' (already has it) or null (slot taken). */
  function canTake(p, w) {
    if (owns(p, w)) return WEAPONS[w].grenade ? ((p.mag[w] | 0) < HEG.max ? 'ammo' : null) : 'ammo';
    const slot = slotOf(w);
    if (slot === SLOT.GRENADE) return 'new';
    return inSlot(p, slot) ? null : 'new';
  }
  const droppable = w => slotOf(w) === SLOT.PRIMARY || slotOf(w) === SLOT.PISTOL;

  function giveDefaultLoadout(p) {
    p.owned = (1 << 1) | (1 << 2);
    p.cur = 2; p.prev = 1;
    p.mag = { 2: WEAPONS[2].mag };
    p.res = { 2: WEAPONS[2].start };
    p.alt = 0;
    p.cool = 0; p.reloadT = 0; p.switchT = 0; p.spray = 0;
  }

  /**
   * Cone of fire for a hitscan shot: base spread and the accumulated spray, both tightened by
   * crouching, plus penalties for running and for being in the air. (The AWP uses its own scope rule.)
   */
  function spreadOf(p, w, spray = p.spray || 0) {
    const d = WEAPONS[w];
    if (!d || d.melee || d.grenade) return 0;
    const speed = Math.hypot(p.vx || 0, p.vz || 0);
    const crouch = p.crouch && p.onGround ? 0.7 : 1;
    let s = ((d.spread || 0) + spray) * crouch;
    if (d.moving && speed > 1.2) s += d.moving * Math.min(1, speed / C.MAX_SPEED);
    if (d.air && !p.onGround) s += d.air;
    return s;
  }

  function switchTo(p, w) {
    if (w === p.cur) return;
    p.prev = p.cur; p.cur = w; p.switchT = C.SWITCH_TICKS; p.reloadT = 0; p.spray = 0;
  }

  /**
   * Advance weapon timers for one input and decide what happens.
   * Returns null, or {w, kind: 'primary' | 'alt' | 'empty' | 'drop', spray, mag, res}.
   * Ammo is consumed here (both sides), so the client predicts magazines, drops and throws.
   */
  function stepWeapon(p, inp) {
    if (p.cool > 0) p.cool--;
    if (p.switchT > 0) p.switchT--;
    // spray recovers only while the trigger is released (holding it keeps the spray up, as in CS)
    if (p.spray > 0 && !(inp.b & (BTN.FIRE | BTN.ALT))) p.spray = Math.max(0, p.spray - ((WEAPONS[p.cur] && WEAPONS[p.cur].sprayDecay) || 0.004));
    if (p.reloadT > 0 && --p.reloadT === 0) {
      const def = WEAPONS[p.cur], need = def.mag - (p.mag[p.cur] | 0), take = Math.min(need, p.res[p.cur] | 0);
      p.mag[p.cur] = (p.mag[p.cur] | 0) + take; p.res[p.cur] -= take;
    }
    // G: throw the current long gun / pistol on the floor (CS style)
    if ((inp.b & BTN.DROP) && droppable(p.cur)) {
      const w = p.cur, out = { w, kind: 'drop', mag: p.mag[w] | 0, res: p.res[w] | 0 };
      p.owned &= ~(1 << w); p.mag[w] = 0; p.res[w] = 0; p.reloadT = 0;
      p.cur = bestWeapon(p); p.prev = p.cur; p.switchT = C.SWITCH_TICKS; p.spray = 0;
      return out;
    }
    if (inp.w && inp.w !== p.cur && owns(p, inp.w)) { switchTo(p, inp.w); return null; }
    const def = WEAPONS[p.cur];
    if (p.switchT > 0 || p.reloadT > 0) return null;
    const mag = p.mag[p.cur] | 0, res = p.res[p.cur] | 0;
    if ((inp.b & BTN.RELOAD) && def.mag && mag < def.mag && res > 0) { p.reloadT = def.reload; p.spray = 0; return null; }
    if (p.cool > 0) return null;

    const fire = inp.b & BTN.FIRE, alt = inp.b & BTN.ALT;
    if (def.melee) {
      if (fire || alt) { p.cool = def.rate; return { w: p.cur, kind: 'primary' }; }
      return null;
    }
    if (def.grenade) {                                       // HE grenade: throw (LMB) or lob (RMB)
      if (!(fire || alt) || mag <= 0) return null;
      p.mag[p.cur] = mag - 1; p.cool = def.rate;
      const out = { w: p.cur, kind: alt ? 'alt' : 'primary' };
      if (mag - 1 <= 0) {
        p.owned &= ~(1 << p.cur);
        const back = p.prev && p.prev !== p.cur && owns(p, p.prev) ? p.prev : bestWeapon(p);
        p.cur = back; p.prev = back; p.switchT = C.SWITCH_TICKS;
      }
      return out;
    }
    if (alt && def.id === 4) {                               // MP5 grenade launcher
      if (p.alt > 0) { p.alt--; p.cool = def.altRate; return { w: 4, kind: 'alt' }; }
      return null;
    }
    if (alt && (def.id === 2 || def.id === 5)) {             // Glock rapid fire / shotgun double barrel
      const need = def.id === 5 ? 2 : 1;
      if (mag >= need) {
        const spray = p.spray || 0;
        p.mag[p.cur] = mag - need; p.cool = def.altRate;
        if (def.sprayAdd) p.spray = Math.min(def.sprayMax, spray + def.sprayAdd * 1.5);
        return { w: p.cur, kind: 'alt', spray };
      }
      if (res > 0) p.reloadT = def.reload; else return { w: p.cur, kind: 'empty' };
      return null;
    }
    if (fire) {
      if (mag > 0) {
        const spray = p.spray || 0;
        p.mag[p.cur] = mag - 1; p.cool = def.rate;
        if (def.sprayAdd) p.spray = Math.min(def.sprayMax, spray + def.sprayAdd);
        return { w: p.cur, kind: 'primary', spray };
      }
      if (res > 0) p.reloadT = def.reload;
      else { p.cool = 20; return { w: p.cur, kind: 'empty' }; }
    }
    return null;
  }

  return { makeWorld, forEachSolid, overlaps, blocked, moveAxis, stepMove, rayBox, rayBoxExit, wallTrace, raycast, hitboxes, aimDir, heightOf, eyeOf,
           giveDefaultLoadout, owns, stepWeapon, inSlot, bestWeapon, canTake, slotOf, spreadOf, droppable };
});
