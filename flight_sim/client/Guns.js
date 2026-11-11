/**
 * Guns - cannon rounds as real projectiles (muzzle velocity + the aircraft's own, gravity, 2.5 s life),
 * drawn as tracer streaks. Each frame a round's path is tested against:
 *   - other pilots' airframes (only our own rounds can hit; the victim's browser takes the damage)
 *   - balloons (they pop), trees / buildings / the playground (obstacle names), the terrain and the sea
 * and the impact shows what it hit: wood chips and leaves, gold sparks off the REX statue, stone dust,
 * metal sparks, dirt, or a splash.
 */
import * as THREE from 'three';

const N = 400;
const R = (a, b) => a + Math.random() * (b - a);

export class Guns {
  /** opts: ground(x, z), obstacle(x, y, z) -> name | null, balloons(p0, p1) -> hit?, onStrike(kind, p, mine)? (a round hit something that is not an aircraft) */
  constructor(scene, fx, opts) {
    this.fx = fx; this.opts = opts;
    this.rounds = [];
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(N * 6).fill(-1e5); this.col = new Float32Array(N * 6);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.lines.frustumCulled = false;
    scene.add(this.lines);
    // a glowing head on every tracer (a 1-pixel line alone is hard to see)
    const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d');
    const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,220,140,.8)'); gr.addColorStop(1, 'rgba(255,160,40,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    this.heads = new Float32Array(N * 3).fill(-1e5);
    const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.BufferAttribute(this.heads, 3));
    this.dots = new THREE.Points(hg, new THREE.PointsMaterial({ size: 1.4, map: new THREE.CanvasTexture(c), color: 0xffd080, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
    this.dots.frustumCulled = false; scene.add(this.dots);
    this.qi = new THREE.Quaternion(); this.a = new THREE.Vector3(); this.b = new THREE.Vector3();
  }

  /** A round from p (world) with velocity v; `mine` rounds can hit other pilots. */
  shoot(p, v, mine) {
    if (this.rounds.length >= N) this.rounds.shift();
    this.rounds.push({ p: p.slice(), v: v.slice(), t: 0, mine, from: p.slice() });
    this.fx.fire.emit({ p, v: [v[0] * 0.02, v[1] * 0.02, v[2] * 0.02], life: 0.06, size: [0.9, 1.6], c0: [3, 2.4, 1.4], c1: [2, 0.9, 0.2], a: 1, fadeIn: 0.005, drag: 0 });   // muzzle flash
  }

  /**
   * Advance every round by dt. targets: [{id, pos, prev, q, box}] (box = local [x0,y0,z0,x1,y1,z1]).
   * Returns the hits made by our own rounds: [{id, p}].
   */
  update(dt, targets = []) {
    const hits = [], keep = [];
    for (const r of this.rounds) {
      const p0 = r.p.slice();
      r.v[1] -= 9.81 * dt;
      for (let k = 0; k < 3; k++) r.p[k] += r.v[k] * dt;
      r.t += dt;
      const hit = this.trace(p0, r.p, r.mine ? targets : null);
      if (hit) {
        if (hit.target) hits.push({ id: hit.target.id, p: hit.p });
        else if (this.opts.onStrike) this.opts.onStrike(hit.kind, hit.p, r.mine);
        this.impact(hit.kind, hit.p, r.v);
        continue;
      }
      if (r.t < 2.5) keep.push(r);
    }
    this.rounds = keep;
    // tracer streaks: from the round back along its path (never behind the muzzle)
    for (let i = 0; i < N; i++) {
      const r = this.rounds[i], j = i * 6;
      if (!r) { this.pos[j + 1] = this.pos[j + 4] = -1e5; this.heads[i * 3 + 1] = -1e5; continue; }
      this.heads[i * 3] = r.p[0]; this.heads[i * 3 + 1] = r.p[1]; this.heads[i * 3 + 2] = r.p[2];
      const sp = Math.hypot(...r.v) || 1, len = Math.min(28, r.t * sp);
      this.pos[j] = r.p[0]; this.pos[j + 1] = r.p[1]; this.pos[j + 2] = r.p[2];
      for (let k = 0; k < 3; k++) this.pos[j + 3 + k] = r.p[k] - r.v[k] / sp * len;
      const fade = Math.max(0.25, 1 - r.t / 2.5);
      this.col[j] = 2.2 * fade; this.col[j + 1] = 1.6 * fade; this.col[j + 2] = 0.5 * fade;
      this.col[j + 3] = 0.6 * fade; this.col[j + 4] = 0.25 * fade; this.col[j + 5] = 0.05 * fade;
    }
    const at = this.lines.geometry.attributes; at.position.needsUpdate = at.color.needsUpdate = true;
    this.dots.geometry.attributes.position.needsUpdate = true;
    return hits;
  }

  /** First thing along p0 -> p1: an aircraft (ours only), a balloon, an obstacle, the ground or the sea. */
  trace(p0, p1, targets) {
    const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], len = Math.hypot(...d);
    let best = null;
    if (targets) for (const tg of targets) {
      const t = this.segBox(p0, p1, tg);
      if (t !== null && (!best || t < best.t)) best = { t, target: tg, kind: 'aircraft' };
    }
    if (this.opts.balloons && this.opts.balloons(p0, p1)) return { p: p1, kind: 'balloon' };
    const steps = Math.max(1, Math.ceil(len / 4));
    for (let s = 1; s <= steps; s++) {
      const f = s / steps;
      if (best && f > best.t) break;
      const x = p0[0] + d[0] * f, y = p0[1] + d[1] * f, z = p0[2] + d[2] * f;
      if (this.opts.shield && this.opts.shield(x, y, z)) return { p: [x, y, z], kind: 'shield' };         // an airfield / carrier shield stops every round (only bombs get through)
      const g = this.opts.ground(x, z);
      if (y < Math.max(0, g)) return { p: [x, Math.max(0, g) + 0.1, z], kind: g < 0.2 ? 'water' : 'ground' };
      const ob = this.opts.obstacle(x, y, z);
      if (ob) return { p: [x - d[0] / len * 0.5, y - d[1] / len * 0.5, z - d[2] / len * 0.5], kind: ob };
    }
    if (best) return { p: [p0[0] + d[0] * best.t, p0[1] + d[1] * best.t, p0[2] + d[2] * best.t], target: best.target, kind: 'aircraft' };
    return null;
  }

  /** Segment vs a target's airframe box (slab test in its own axes): fraction along the segment, or null. */
  segBox(p0, p1, tg) {
    const mid = (p0[0] + p1[0]) / 2 - tg.pos.x, mz = (p0[2] + p1[2]) / 2 - tg.pos.z, my = (p0[1] + p1[1]) / 2 - tg.pos.y;
    if (mid * mid + my * my + mz * mz > 60 * 60) return null;
    this.qi.copy(tg.q).invert();
    const a = this.a.set(p0[0] - tg.pos.x, p0[1] - tg.pos.y, p0[2] - tg.pos.z).applyQuaternion(this.qi);
    const b = this.b.set(p1[0] - tg.pos.x, p1[1] - tg.pos.y, p1[2] - tg.pos.z).applyQuaternion(this.qi);
    let t0 = 0, t1 = 1;
    for (const [k, lo, hi] of [['x', 0, 3], ['y', 1, 4], ['z', 2, 5]]) {
      const da = b[k] - a[k], mn = tg.box[lo], mx = tg.box[hi];
      if (Math.abs(da) < 1e-9) { if (a[k] < mn || a[k] > mx) return null; continue; }
      let u0 = (mn - a[k]) / da, u1 = (mx - a[k]) / da;
      if (u0 > u1) [u0, u1] = [u1, u0];
      t0 = Math.max(t0, u0); t1 = Math.min(t1, u1);
      if (t0 > t1) return null;
    }
    return t0;
  }

  /** What a round does to what it hit. */
  impact(kind, p, v) {
    const fx = this.fx, sp = Math.hypot(...v) || 1, back = [-v[0] / sp, -v[1] / sp, -v[2] / sp];
    if (kind === 'shield') { fx.fire.emit({ p, life: 0.18, size: [2.5, 5], c0: [0.5, 1.2, 3], c1: [0.2, 0.5, 1.5], a: 0.9, fadeIn: 0.005, drag: 0 }); return; }
    const spray = (n, speed, c0, c1, size, life, grav = -9.8, sys = fx.spark) => {
      for (let k = 0; k < n; k++) sys.emit({ p, v: [back[0] * speed * R(0.2, 1) + R(-1, 1) * speed * 0.6, Math.abs(back[1]) * speed + R(0, speed * 0.8), back[2] * speed * R(0.2, 1) + R(-1, 1) * speed * 0.6],
                                              life: R(life * 0.5, life), size, c0, c1, a: 1, fadeIn: 0.01, drag: 0.8, acc: grav, land: true, spin: 3 });
    };
    const puff = (c, size, a = 0.6) => fx.smoke.emit({ p, v: [back[0] * 2, 1.5, back[2] * 2], life: R(1.5, 3), size, c0: c, c1: c.map(x => Math.min(1, x + 0.15)), a, fadeIn: 0.03, drag: 1.5, acc: 0.3, wind: 0.6, spin: 0.5 });
    const k = String(kind);
    if (k === 'water') {
      for (let n = 0; n < 10; n++) fx.smoke.emit({ p: [p[0], 0.2, p[2]], v: [R(-1, 1), R(6, 14), R(-1, 1)], life: R(0.8, 1.4), size: [0.6, 1.8], c0: [0.95, 0.97, 1], c1: [0.85, 0.9, 0.95], a: 0.85, fadeIn: 0.02, drag: 0.4, acc: -9.8, land: true });
    } else if (k === 'ground') {
      puff([0.45, 0.38, 0.28], [3, 10], 0.75);
      spray(6, 8, [0.3, 0.22, 0.14], [0.3, 0.22, 0.14], [0.4, 0.3], 1.2, -9.8, fx.smoke);
    } else if (/tree/.test(k)) {                                  // wood chips and shredded leaves
      spray(6, 6, [0.5, 0.33, 0.18], [0.4, 0.26, 0.14], [0.35, 0.25], 1.4, -9.8, fx.smoke);
      for (let n = 0; n < 6; n++) fx.smoke.emit({ p, v: [R(-2, 2), R(0, 2), R(-2, 2)], life: R(2, 3.5), size: [0.35, 0.3], c0: [0.18, 0.4, 0.14], c1: [0.2, 0.35, 0.12], a: 1, fadeIn: 0.01, drag: 2.5, acc: -2, land: true, spin: 4 });
    } else if (/REX/.test(k)) {                                    // gilded metal: bright sparks, a little dust
      spray(16, 16, [3, 3, 2.6], [1.6, 0.8, 0.1], [1.1, 0.4], 0.8);          // white-hot sparks: they show against the gold
      puff([0.22, 0.2, 0.18], [2.5, 9], 0.75);                                // dark smoke: it shows against the gold
      this.fx.fire.emit({ p, life: 0.12, size: [4.5, 7], c0: [3, 2.6, 1.6], c1: [2, 1, 0.3], a: 1, fadeIn: 0.005, drag: 0 });
    } else if (/arch|stack|pedestal|dock|barn/.test(k)) {          // stone / wood: dust and chips
      puff(/barn|dock/.test(k) ? [0.45, 0.32, 0.22] : [0.62, 0.56, 0.48], [2.5, 8], 0.7);
      spray(5, 7, [0.4, 0.36, 0.3], [0.35, 0.3, 0.26], [0.3, 0.25], 1.1, -9.8, fx.smoke);
    } else {                                                       // metal: aircraft, the bridge, hangars, the silo
      spray(12, 14, [3, 2.2, 1], [1.4, 0.5, 0.05], [0.8, 0.25], 0.7);
      puff([0.25, 0.24, 0.23], [2, 6], 0.6);
      this.fx.fire.emit({ p, life: 0.07, size: [1.8, 3], c0: [3, 2.6, 1.6], c1: [2, 1, 0.3], a: 1, fadeIn: 0.005, drag: 0 });
    }
  }

  clear() { this.rounds = []; }
}
