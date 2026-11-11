'use strict';
/**
 * Lightweight custom 2D physics for Element Core (cheaper than a rigid-body engine on a
 * 1-CPU VPS): circle mages, circle bolts, axis-aligned destructible cover.
 *  - stepProjectile(): homing, sub-stepped motion, wall / cover bounces, piercing, player hits
 *  - segmentBlocked(): line-of-sight raycast against cover (used by the bot)
 * Game rules (damage, statuses, scoring) are callbacks supplied by GameRoom.
 */
const { C } = require('../shared/Constants.js');
const { circleRect, invulnerable } = require('../shared/Movement.js');

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Advance one bolt by one tick. Returns false when the bolt is gone.
 * hooks: { onCoverHit(cover, bolt, x, y), onWallOrCover(bolt, x, y), onPlayerHit(target, bolt), onBounce(x, y) }
 */
function stepProjectile(b, covers, players, hooks) {
  const enemy = players[1 - b.owner];
  if (b.homing && enemy.alive) {
    const want = Math.atan2(enemy.y - b.y, enemy.x - b.x), cur = Math.atan2(b.vy, b.vx);
    const turn = Math.max(-b.homing, Math.min(b.homing, wrapAngle(want - cur)));
    const sp = Math.hypot(b.vx, b.vy), a = cur + turn;
    b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp;
  }
  const speed = Math.hypot(b.vx, b.vy);
  const steps = Math.min(4, Math.max(1, Math.ceil(speed / (b.r * 1.5))));
  for (let s = 0; s < steps; s++) {
    b.x += b.vx / steps; b.y += b.vy / steps;

    // arena walls
    let wall = false;
    if (b.x < b.r) { b.x = b.r; wall = 'x'; } else if (b.x > C.ARENA_W - b.r) { b.x = C.ARENA_W - b.r; wall = 'x'; }
    if (b.y < b.r) { b.y = b.r; wall = 'y'; } else if (b.y > C.ARENA_H - b.r) { b.y = C.ARENA_H - b.r; wall = 'y'; }
    if (wall) {
      if (b.bounce > 0) { b.bounce--; if (wall === 'x') b.vx = -b.vx; else b.vy = -b.vy; hooks.onBounce(b.x, b.y); }
      else { hooks.onWallOrCover(b, b.x, b.y); return false; }
    }

    // cover
    if (b.passing >= 0 && !circleRect(b.x, b.y, b.r, covers[b.passing])) b.passing = -1;
    for (let i = 0; i < covers.length; i++) {
      const c = covers[i];
      if (c.hp <= 0 || i === b.passing) continue;
      const hit = circleRect(b.x, b.y, b.r, c);
      if (!hit) continue;
      if (b.pierce > 0) { b.pierce--; b.passing = i; continue; }
      hooks.onCoverHit(c, b, b.x, b.y);
      if (b.bounce > 0) {
        b.bounce--;
        const dot = b.vx * hit.nx + b.vy * hit.ny;
        if (dot < 0) { b.vx -= 2 * dot * hit.nx; b.vy -= 2 * dot * hit.ny; }
        b.x += hit.nx * hit.depth; b.y += hit.ny * hit.depth;
        hooks.onBounce(b.x, b.y);
      } else {
        hooks.onWallOrCover(b, b.x, b.y);
        return false;
      }
    }

    // the enemy mage (dash i-frames let bolts pass through)
    if (enemy.alive && !invulnerable(enemy)) {
      const dx = enemy.x - b.x, dy = enemy.y - b.y, rr = b.r + C.PLAYER_R;
      if (dx * dx + dy * dy < rr * rr) { hooks.onPlayerHit(enemy, b); return false; }
    }
  }
  return --b.life > 0;
}

/** Does the segment (thickened by `pad`) cross any standing cover? Slab test per rect. */
function segmentBlocked(x1, y1, x2, y2, covers, pad = 0) {
  const dx = x2 - x1, dy = y2 - y1;
  for (const c of covers) {
    if (c.hp <= 0) continue;
    const minX = c.x - c.w / 2 - pad, maxX = c.x + c.w / 2 + pad, minY = c.y - c.h / 2 - pad, maxY = c.y + c.h / 2 + pad;
    let t0 = 0, t1 = 1, ok = true;
    for (const [p, q] of [[-dx, x1 - minX], [dx, maxX - x1], [-dy, y1 - minY], [dy, maxY - y1]]) {
      if (p === 0) { if (q < 0) { ok = false; break; } continue; }
      const t = q / p;
      if (p < 0) { if (t > t1) { ok = false; break; } if (t > t0) t0 = t; }
      else { if (t < t0) { ok = false; break; } if (t < t1) t1 = t; }
    }
    if (ok && t0 <= t1) return true;
  }
  return false;
}

module.exports = { stepProjectile, segmentBlocked, wrapAngle };
