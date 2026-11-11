'use strict';
/**
 * Server-side weapon behaviour. Stats live in shared/Constants.js (the client needs them for
 * ammo, cooldown and recoil prediction); this file turns a "fire" decision from the shared
 * weapon timer into hitscan traces, melee swings and projectiles. All spread uses the room RNG.
 */
const { C, BTN, WEAPONS, PROJ, EV, HEG } = require('../shared/Constants.js');
const M = require('../shared/Movement.js');

/** Random direction inside a cone around `d` (unit vector) with the given spread (radians-ish). */
function spreadDir(d, spread, rng) {
  if (!spread) return d;
  const up = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  // right = d x up, upv = right x d
  let rx = d[1] * up[2] - d[2] * up[1], ry = d[2] * up[0] - d[0] * up[2], rz = d[0] * up[1] - d[1] * up[0];
  const rl = Math.hypot(rx, ry, rz); rx /= rl; ry /= rl; rz /= rl;
  const ux = ry * d[2] - rz * d[1], uy = rz * d[0] - rx * d[2], uz = rx * d[1] - ry * d[0];
  const a = rng() * Math.PI * 2, r = spread * Math.sqrt(rng());
  const ox = Math.cos(a) * r, oy = Math.sin(a) * r;
  const x = d[0] + rx * ox + ux * oy, y = d[1] + ry * ox + uy * oy, z = d[2] + rz * ox + uz * oy, l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

const r2 = v => Math.round(v * 100) / 100;

/**
 * Perform one shot. `kind` is 'primary' | 'alt' | 'empty' (from Movement.stepWeapon).
 * `inp.rt` is the tick the shooter was looking at when firing (lag compensation for hitscan).
 */
function fire(room, p, shot, inp) {
  const w = shot.w, def = WEAPONS[w];
  if (shot.kind === 'empty') { room.ev(EV.EMPTY, p.id); return; }
  const eye = [p.x, p.y + M.eyeOf(p), p.z];
  const dir = M.aimDir(inp.yaw, inp.pitch);
  p.firedAt = room.tick;

  if (def.melee) {
    const h = room.trace(p, eye, dir, def.range, inp.rt);
    if (h.player) room.damage(h.player, def.dmg, p, w, false);
    else if (h.prop) room.damageProp(h.prop, def.dmg, p);
    const end = [eye[0] + dir[0] * h.t, eye[1] + dir[1] * h.t, eye[2] + dir[2] * h.t];
    room.ev(EV.MELEE, p.id, h.player ? 2 : h.t < def.range ? 1 : 0, r2(end[0]), r2(end[1]), r2(end[2]));
    return;
  }

  const muzzle = [eye[0] + dir[0] * 0.6, eye[1] + dir[1] * 0.6 - 0.1, eye[2] + dir[2] * 0.6];
  if (def.grenade) {                                   // HE: thrown overhand (LMB) or lobbed underhand (RMB)
    const lob = shot.kind === 'alt';
    const d = M.aimDir(inp.yaw, inp.pitch + (lob ? 0.1 : 0.12));
    room.spawnProjectile(PROJ.HE, p, [eye[0] + d[0] * 0.5, eye[1] - 0.1, eye[2] + d[2] * 0.5], d, lob ? HEG.lob : HEG.speed);
    const g = room.projectiles[room.projectiles.length - 1];
    g.vx += p.vx * 0.6; g.vy += Math.max(0, p.vy) * 0.6; g.vz += p.vz * 0.6;
    room.ev(EV.SHOT, p.id, 11, r2(eye[0]), r2(eye[1]), r2(eye[2]));
    return;
  }
  if (w === 6) { room.spawnProjectile(PROJ.BOLT, p, muzzle, dir, def.boltSpeed); room.ev(EV.SHOT, p.id, w, r2(eye[0]), r2(eye[1]), r2(eye[2])); return; }
  if (w === 7) { room.spawnProjectile(PROJ.ROCKET, p, muzzle, dir, def.rocketSpeed); room.ev(EV.SHOT, p.id, w, r2(eye[0]), r2(eye[1]), r2(eye[2])); return; }
  if (w === 4 && shot.kind === 'alt') {
    const v = [dir[0], dir[1] + 0.12, dir[2]];
    room.spawnProjectile(PROJ.GRENADE, p, muzzle, v, def.grenadeSpeed);
    room.ev(EV.SHOT, p.id, 40, r2(eye[0]), r2(eye[1]), r2(eye[2]));   // 40 = MP5 grenade launch
    return;
  }

  // hitscan: Glock, .357, MP5, shotgun pellets, AWP, AK-47, M4A1
  const pellets = w === 5 ? (shot.kind === 'alt' ? def.altPellets : def.pellets) : 1;
  // CS-style cone: base + accumulated spray (both tighter when crouched) + running / jumping penalties
  let spread = w === 5 ? def.spread : M.spreadOf(p, w, shot.spray || 0);
  if (w === 2 && shot.kind === 'alt') spread += def.altSpread;
  if (w === 8) {                                   // AWP: pinpoint only through the scope, worse on the move
    const moving = Math.hypot(p.vx, p.vz) > 1.2 || !p.onGround;
    spread = (inp.b & BTN.SCOPE) ? (moving ? def.movingSpread : def.scopedSpread) : def.spread;
    if (p.crouch && !moving && !(inp.b & BTN.SCOPE)) spread *= 0.8;
  }
  const range = 120;
  const dealt = new Map();                       // target -> {amount, head}
  const out = [];
  for (let i = 0; i < pellets; i++) {
    const d = spreadDir(dir, spread, room.rng);
    const h = room.trace(p, eye, d, range, inp.rt, def.pen || 0);
    // holes where the bullet went through a wall (surface 3: impact + decal, no tracer of its own)
    for (const wl of h.walls) for (const tt of [wl.tIn, wl.tOut]) out.push(r2(eye[0] + d[0] * tt), r2(eye[1] + d[1] * tt), r2(eye[2] + d[2] * tt), 3);
    const ex = eye[0] + d[0] * h.t, ey = eye[1] + d[1] * h.t, ez = eye[2] + d[2] * h.t;
    out.push(r2(ex), r2(ey), r2(ez), h.player ? 1 : h.t < range ? 0 : 2);
    if (h.player) {
      const cur = dealt.get(h.player) || { amount: 0, head: false };
      cur.amount += def.dmg * (h.head ? def.head || 1 : 1) * Math.pow(def.penMult || 1, h.walls.length);   // each wall costs damage
      cur.head = cur.head || h.head;
      dealt.set(h.player, cur);
    } else if (h.prop) room.damageProp(h.prop, def.dmg, p);
  }
  room.ev(EV.SHOT, p.id, w + (shot.kind === 'alt' ? 10 : 0), r2(eye[0]), r2(eye[1]), r2(eye[2]), ...out);
  for (const [target, d] of dealt) room.damage(target, d.amount, p, w, d.head);
}

module.exports = { fire, spreadDir };
