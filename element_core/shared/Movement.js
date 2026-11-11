/**
 * Element Core - player movement, dash, fire cooldown and cover collision.
 * The server runs this as the authority; the client runs the very same function to predict
 * its own mage, then replays unacknowledged inputs on top of each snapshot.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./Constants.js'));
  else root.ElementMove = factory(root.ElementConst);
})(typeof self !== 'undefined' ? self : this, function (K) {
  'use strict';
  const { C, MOVE } = K;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /** Circle vs axis-aligned rect (centre x/y, w, h). Returns the push-out normal and depth, or null. */
  function circleRect(px, py, r, c) {
    const hx = c.w / 2, hy = c.h / 2;
    const cx = clamp(px, c.x - hx, c.x + hx), cy = clamp(py, c.y - hy, c.y + hy);
    const dx = px - cx, dy = py - cy, d2 = dx * dx + dy * dy;
    if (d2 >= r * r) return null;
    if (d2 > 1e-9) { const d = Math.sqrt(d2); return { nx: dx / d, ny: dy / d, depth: r - d }; }
    const ox = hx - Math.abs(px - c.x), oy = hy - Math.abs(py - c.y);   // centre is inside the rect
    return ox < oy ? { nx: Math.sign(px - c.x) || 1, ny: 0, depth: ox + r } : { nx: 0, ny: Math.sign(py - c.y) || 1, depth: oy + r };
  }

  function resolve(p, covers) {
    const R = C.PLAYER_R;
    for (let pass = 0; pass < 2; pass++) {
      for (const c of covers) {
        if (c.hp <= 0) continue;
        const hit = circleRect(p.x, p.y, R, c);
        if (hit) { p.x += hit.nx * hit.depth; p.y += hit.ny * hit.depth; }
      }
      p.x = clamp(p.x, R, C.ARENA_W - R);
      p.y = clamp(p.y, R, C.ARENA_H - R);
    }
  }

  function moveVector(bits) {
    let mx = ((bits & MOVE.RIGHT) ? 1 : 0) - ((bits & MOVE.LEFT) ? 1 : 0);
    let my = ((bits & MOVE.DOWN) ? 1 : 0) - ((bits & MOVE.UP) ? 1 : 0);
    if (mx && my) { mx *= Math.SQRT1_2; my *= Math.SQRT1_2; }
    return [mx, my];
  }

  /**
   * One tick for one mage. p: {x, y, dashT, dashCd, dashX, dashY, slowT, fireCd}
   * inp: {m: move bits, a: aim angle, f: fire held, d: dash pressed this tick}
   * Returns true when a cast happens this tick.
   */
  function stepPlayer(p, inp, covers, st) {
    if (p.dashCd > 0) p.dashCd--;
    if (p.fireCd > 0) p.fireCd--;
    const [mx, my] = moveVector(inp.m | 0);
    if (inp.d && p.dashT <= 0 && p.dashCd <= 0) {
      let dx = mx, dy = my;
      if (!dx && !dy) { dx = Math.cos(inp.a); dy = Math.sin(inp.a); }
      const l = Math.hypot(dx, dy) || 1;
      p.dashX = dx / l; p.dashY = dy / l;
      p.dashT = C.DASH_TICKS; p.dashCd = st.dashCd;
    }
    let vx, vy;
    if (p.dashT > 0) { vx = p.dashX * C.DASH_SPEED; vy = p.dashY * C.DASH_SPEED; p.dashT--; }
    else {
      const sp = C.SPEED * st.speed * (p.slowT > 0 ? C.SLOW_MUL : 1);
      vx = mx * sp; vy = my * sp;
    }
    if (p.slowT > 0) p.slowT--;
    p.x += vx; p.y += vy;
    resolve(p, covers);
    if (inp.f && p.fireCd <= 0) { p.fireCd = st.fireCd; return true; }
    return false;
  }

  /** Where the bolts of one cast start and how fast they go. */
  function shotPattern(p, aim, st) {
    const out = [];
    for (let k = 0; k < st.count; k++) {
      const a = aim + (k - (st.count - 1) / 2) * st.spread;
      const cs = Math.cos(a), sn = Math.sin(a);
      out.push({ x: p.x + cs * (C.PLAYER_R + 4), y: p.y + sn * (C.PLAYER_R + 4), vx: cs * st.boltSpeed, vy: sn * st.boltSpeed, r: st.radius });
    }
    return out;
  }

  const invulnerable = p => p.dashT > 0;

  return { circleRect, resolve, stepPlayer, shotPattern, invulnerable, clamp };
});
