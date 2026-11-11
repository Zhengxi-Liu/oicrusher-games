/**
 * Player - first / third person walker for the school.
 *   WASD / arrows move · Shift sprint · Space jump · C or Ctrl crouch · mouse look (Pointer Lock) · V camera
 * Collision: a 0.3 m circle against every wall segment whose height range overlaps the body
 * (map.walls, bucketed in a 4 m grid). Floor height comes from map.ground() (both floors + the stairs),
 * so stairs are smooth ramps and the step-up / glue-down rules keep the camera steady on them.
 */
const CELL = 4, R = 0.3;

export class Player {
  constructor(canvas, map) {
    this.canvas = canvas;
    this.map = map;
    this.keys = Object.create(null);
    this.pos = { x: map.spawn.x, y: 0, z: map.spawn.z };
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = map.spawn.yaw; this.pitch = -0.05;
    this.onGround = true; this.crouch = 0; this.bob = 0; this.moving = 0;
    this.active = false; this.locked = false; this.third = false;
    this.sens = 0.0022;
    try { const s = Number(localStorage.getItem('tjhsSens')); if (s > 0) this.sens = s; } catch (e) {}
    this.onUnlock = null;
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === canvas;
      if (was && !this.locked && this.onUnlock) this.onUnlock();
    });
    document.addEventListener('mousemove', e => {
      if (!this.locked) return;
      this.yaw -= e.movementX * this.sens;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - e.movementY * this.sens));
    });
    addEventListener('keydown', e => {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      this.keys[e.code] = true;
      if (this.active && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => { this.keys[e.code] = false; });
    addEventListener('blur', () => { this.keys = Object.create(null); });
    this.buildHash();
  }

  lock() { if (!this.locked) { try { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) {} } }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  /** Re-bucket map.walls (call after furniture colliders were added). */
  buildHash() {
    this.hash = new Map();
    this.map.walls.forEach((w, i) => {
      const x0 = Math.floor((Math.min(w.a[0], w.b[0]) - R) / CELL), x1 = Math.floor((Math.max(w.a[0], w.b[0]) + R) / CELL);
      const z0 = Math.floor((Math.min(w.a[1], w.b[1]) - R) / CELL), z1 = Math.floor((Math.max(w.a[1], w.b[1]) + R) / CELL);
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const k = x * 4096 + z;
        let l = this.hash.get(k); if (!l) this.hash.set(k, l = []);
        l.push(i);
      }
    });
  }
  wallsNear(x, z) { return this.hash.get(Math.floor(x / CELL) * 4096 + Math.floor(z / CELL)) || []; }

  get floor() { return this.pos.y > this.map.F2Y - 1 ? 2 : 1; }
  get eye() { return 1.62 - this.crouch * 0.6; }

  teleport(x, y, z, yaw) { this.pos.x = x; this.pos.y = y; this.pos.z = z; this.vel.x = this.vel.y = this.vel.z = 0; if (yaw !== undefined) this.yaw = yaw; }

  update(dt) {
    const k = this.keys, m = this.map, p = this.pos;
    let fx = 0, fz = 0;
    if (this.active) {
      if (k.KeyW || k.ArrowUp) fz += 1;
      if (k.KeyS || k.ArrowDown) fz -= 1;
      if (k.KeyA || k.ArrowLeft) fx -= 1;
      if (k.KeyD || k.ArrowRight) fx += 1;
    }
    const crouching = this.active && (k.KeyC || k.ControlLeft || k.ControlRight);
    this.crouch += ((crouching ? 1 : 0) - this.crouch) * Math.min(1, dt * 10);
    const sprint = this.active && (k.ShiftLeft || k.ShiftRight) && !crouching;
    const speed = crouching ? 2.0 : sprint ? 7.0 : 4.3;
    const len = Math.hypot(fx, fz) || 1;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    // forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw)
    const wx = ((-sy) * fz + cy * fx) / len * speed, wz = ((-cy) * fz - sy * fx) / len * speed;
    const accel = this.onGround ? 14 : 3;
    this.vel.x += (wx * (fx || fz ? 1 : 0) - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (wz * (fx || fz ? 1 : 0) - this.vel.z) * Math.min(1, accel * dt);
    if (this.active && k.Space && this.onGround && !crouching) { this.vel.y = 4.6; this.onGround = false; }
    this.vel.y -= 20 * dt;

    // horizontal move in small steps (fast sprints never tunnel through a wall)
    const steps = Math.max(1, Math.ceil(Math.hypot(this.vel.x, this.vel.z) * dt / 0.15));
    for (let s = 0; s < steps; s++) {
      p.x += this.vel.x * dt / steps; p.z += this.vel.z * dt / steps;
      this.collide();
    }
    const b = m.bounds;
    p.x = Math.max(b.x0, Math.min(b.x1, p.x)); p.z = Math.max(b.z0, Math.min(b.z1, p.z));

    // vertical: gravity, step up onto stairs, stay glued going down them
    const g = m.ground(p.x, p.z, p.y);
    p.y += this.vel.y * dt;
    if (p.y <= g) { p.y = g; this.vel.y = 0; this.onGround = true; }
    else if (this.onGround && this.vel.y <= 0 && p.y - g < 0.55) { p.y = g; this.vel.y = 0; }
    else this.onGround = p.y - g < 0.02;
    if (p.y < -5) this.teleport(m.spawn.x, 0, m.spawn.z, m.spawn.yaw);

    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.moving = sp;
    if (this.onGround && sp > 0.5) this.bob += dt * sp * 1.9;
  }

  collide() {
    const p = this.pos, walls = this.map.walls;
    const feet = p.y + 0.3, head = p.y + 1.75 - this.crouch * 0.6;
    for (let it = 0; it < 3; it++) {
      let moved = false;
      for (const i of this.wallsNear(p.x, p.z)) {
        const w = walls[i];
        if (w.y1 <= feet || w.y0 >= head) continue;
        const ax = w.a[0], az = w.a[1], dx = w.b[0] - ax, dz = w.b[1] - az, l2 = dx * dx + dz * dz;
        const t = l2 ? Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.z - az) * dz) / l2)) : 0;
        const cx = ax + dx * t, cz = az + dz * t, ox = p.x - cx, oz = p.z - cz, d = Math.hypot(ox, oz);
        if (d >= R || d < 1e-6) continue;
        p.x = cx + ox / d * R; p.z = cz + oz / d * R; moved = true;
      }
      if (!moved) break;
    }
  }

  /** First segment hit between two points at height y (for the 3rd-person camera and line of sight). */
  rayBlocked(x0, z0, x1, z1, y, pad = 0) {
    const walls = this.map.walls, seen = new Set();
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (CELL / 2)));
    let best = 1;
    for (let s = 0; s <= n; s++) {
      const x = x0 + (x1 - x0) * s / n, z = z0 + (z1 - z0) * s / n;
      for (const i of this.wallsNear(x, z)) {
        if (seen.has(i)) continue; seen.add(i);
        const w = walls[i];
        if (w.kind === 'furn' || y < w.y0 || y > w.y1) continue;
        const t = segT(x0, z0, x1, z1, w.a[0], w.a[1], w.b[0], w.b[1]);
        if (t !== null && t < best) best = t;
      }
    }
    return best < 1 ? Math.max(0, best - pad) : null;
  }

  /** Camera pose: returns {x, y, z, yaw, pitch} for this frame. */
  camera() {
    const p = this.pos, bob = this.onGround ? Math.sin(this.bob * 2) * 0.035 * Math.min(1, this.moving / 4) : 0;
    const ey = p.y + this.eye + bob;
    if (!this.third) return { x: p.x, y: ey, z: p.z, yaw: this.yaw, pitch: this.pitch };
    const dist = 3.2, back = [Math.sin(this.yaw) * Math.cos(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)];
    let tx = p.x + back[0] * dist, tz = p.z + back[1] * dist;
    const ty = ey + 0.35 - Math.sin(this.pitch) * dist;
    const hit = this.rayBlocked(p.x, p.z, tx, tz, Math.max(p.y + 0.5, Math.min(ty, p.y + 3.5)), 0.08);
    if (hit !== null) { tx = p.x + (tx - p.x) * hit; tz = p.z + (tz - p.z) * hit; }
    return { x: tx, y: Math.max(p.y + 0.4, ty), z: tz, yaw: this.yaw, pitch: this.pitch };
  }
}

/** Parameter t along p0->p1 where it crosses segment q0-q1, or null. */
function segT(x0, z0, x1, z1, ax, az, bx, bz) {
  const rx = x1 - x0, rz = z1 - z0, sx = bx - ax, sz = bz - az;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((ax - x0) * sz - (az - z0) * sx) / den, u = ((ax - x0) * rz - (az - z0) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}
