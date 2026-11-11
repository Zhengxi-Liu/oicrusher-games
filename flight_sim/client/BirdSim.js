/**
 * BirdSim - the birds' flight, as plain maths (no Three.js, so Node can run it).
 *
 * Four kinds, each flying the way the real bird does:
 *   goose   a V of 5-9 on a long cross-country leg: steady flapping, the occasional shared glide, followers hold
 *           a slot behind and beside the one in front, the leader steers for a waypoint 4-8 km away
 *   gull    loose flocks working a coastline: each bird loops its own wide circle round a drifting spot, climbing in
 *           flap bursts and sinking in glides (flap-glide), never far above the water
 *   hawk    alone: circles in a thermal (tight, gentle bank, net climb 1-2 m/s), at the ceiling it glides straight
 *           to the next thermal over land, sinking about 1 m/s
 *   pigeon  boids flocks (alignment, cohesion, separation, a roaming attractor) low over the land, flap-and-glide
 *
 * Every bird is a point mass flown like a small aircraft: heading rate limited by its bank angle (g*tan(bank)/V) and
 * smoothed, speed and climb rate lag their targets, it drifts with the wind, and it never goes below the ground.
 * They notice a fast aircraft closing in and (most of them, after a reaction time) dive or break away - but not all.
 *
 * Flocks live around the player: one that falls too far behind is re-created ahead of the aircraft.
 */
const R = (a, b) => a + Math.random() * (b - a);
const RI = (a, b) => Math.floor(R(a, b + 1));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = a => { a %= Math.PI * 2; return a > Math.PI ? a - Math.PI * 2 : a < -Math.PI ? a + Math.PI * 2 : a; };
const headingTo = (dx, dz) => Math.atan2(-dx, -dz);                    // forward is (-sin psi, -cos psi), like the models
const G = 9.81, LIM = 8500;                                             // keep the flocks inside the 19 km map

export const KINDS = {
  //          label       flocks max  hit radius (m)  cruise (m/s)  wingbeat Hz  max bank  notice distance (m)  chance to react
  goose:  { label: 'a goose',   flocks: 2, max: 9,  hitR: 0.55, cruise: 19,   hz: 3.2, bank: 0.6, alert: 220, reactP: 0.55, minAgl: 30 },
  gull:   { label: 'a gull',    flocks: 8, max: 10, hitR: 0.50, cruise: 10.5, hz: 2.8, bank: 0.9, alert: 140, reactP: 0.6,  minAgl: 5 },
  hawk:   { label: 'a hawk',    flocks: 10, max: 1,  hitR: 0.45, cruise: 10,   hz: 3.0, bank: 0.8, alert: 120, reactP: 0.7,  minAgl: 12 },
  pigeon: { label: 'a pigeon',  flocks: 14, max: 30, hitR: 0.30, cruise: 13,   hz: 7.5, bank: 1.0, alert: 150, reactP: 0.6,  minAgl: 4 },
};

/** What the steering code wants this step (one shared object: the bird is flown right after it is filled in). */
const W = { psi: 0, speed: 10, vz: 0, flap: false, dive: 0, tau: 0.6 };

export class BirdSim {
  /** ground(x, z): terrain height (below 0 = sea) */
  constructor(ground) { this.ground = ground; this.flocks = []; this.t = 0; this._off = []; }

  floor(x, z) { return Math.max(0, this.ground(x, z)); }
  isLand(x, z, h = 8) { return this.ground(x, z) > h; }
  coastal(x, z) {
    let sea = 0, land = 0;
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; if (this.ground(x + Math.cos(a) * 350, z + Math.sin(a) * 350) < 0.2) sea++; else land++; }
    return sea > 0 && land > 0;
  }

  /** (Re)populate the sky round the player. */
  reset(pl) {
    this.t = 0; this.flocks = [];
    for (const kind in KINDS) for (let i = 0; i < KINDS[kind].flocks; i++) this.flocks.push(this.spawn(kind, pl, true));
  }

  /** pl: { pos, vel, wind } of the aircraft. Safe with any dt (substepped at 30 Hz or better). */
  update(dt, pl) {
    if (!(dt > 0)) return;
    for (const f of this.flocks) for (const b of f.birds) { b.px = b.x; b.py = b.y; b.pz = b.z; }
    const n = Math.ceil(dt * 30), h = dt / n;
    for (let k = 0; k < n; k++) {
      this.t += h;
      for (const f of this.flocks) this['step_' + f.kind](f, h, pl);
    }
    for (let i = 0; i < this.flocks.length; i++) {          // a flock left far behind (or wiped out) comes back ahead of us
      const f = this.flocks[i];
      if (!f.birds.length) { this.flocks[i] = this.spawn(f.kind, pl, false); continue; }
      const c = f.birds[0];
      if (Math.hypot(c.x - pl.pos[0], c.z - pl.pos[2]) > (f.kind === 'goose' ? 5200 : 3600)) this.flocks[i] = this.spawn(f.kind, pl, false);
    }
  }

  // ---------- spawning
  spot(kind, pl, rmin, rmax, ahead) {
    const fast = Math.hypot(pl.vel[0], pl.vel[2]) > 15, course = Math.atan2(pl.vel[2], pl.vel[0]);
    let best = null;
    for (let i = 0; i < 40; i++) {
      const a = ahead && fast ? course + R(-1.5, 1.5) : R(0, Math.PI * 2), r = R(rmin, rmax);
      const x = pl.pos[0] + Math.cos(a) * r, z = pl.pos[2] + Math.sin(a) * r;
      if (Math.abs(x) > LIM || Math.abs(z) > LIM) continue;
      best = [x, z];
      const ok = kind === 'gull' ? this.coastal(x, z) : kind === 'hawk' ? this.isLand(x, z, 20) : kind === 'pigeon' ? this.isLand(x, z, 3) : true;
      if (ok) return best;
    }
    return best || [clamp(pl.pos[0] + R(-3000, 3000), -LIM, LIM), clamp(pl.pos[2] + R(-3000, 3000), -LIM, LIM)];
  }

  bird(kind, x, y, z, psi, s) {
    return { kind, x, y, z, px: x, py: y, pz: z, psi, psiDot: 0, s, vz: 0, phase: R(0, 6.28), fa: 0, dive: 0, hzK: R(0.92, 1.08),
             react: undefined, flee: null, st: 'glide', stT: 0, R: 0, agl: 0 };
  }

  spawn(kind, pl, first) {
    const K = KINDS[kind], [x, z] = this.spot(kind, pl, ...(kind === 'goose' ? (first ? [500, 4000] : [3000, 4500]) : (first ? [150, 2800] : [1500, 3200])), !first);
    const f = { kind, birds: [] };
    if (kind === 'goose') {
      f.alt = R(180, 650); f.glideT = 0; f.glideIn = R(10, 40); f.flap = true;
      const L = this.bird(kind, x, Math.max(f.alt, this.floor(x, z) + 140), z, R(0, Math.PI * 2), K.cruise * R(0.95, 1.05));
      f.birds.push(L); this.pickWp(f, L);
      for (let i = 1, n = RI(5, K.max); i < n; i++) {
        const [sx, sz] = this.slot(L, i);
        f.birds.push(this.bird(kind, sx, L.y + R(-0.5, 0.5), sz, L.psi, L.s));
      }
    } else if (kind === 'gull') {
      f.ax = x; f.az = z; f.dir = Math.random() < 0.5 ? 1 : -1; f.wpsi = R(0, Math.PI * 2);
      for (let i = 0, n = RI(5, K.max); i < n; i++) {
        const th = R(0, Math.PI * 2), r = R(120, 420), bx = x + Math.cos(th) * r, bz = z + Math.sin(th) * r;
        const b = this.bird(kind, bx, 0, bz, headingTo(-f.dir * Math.sin(th), f.dir * Math.cos(th)), K.cruise * R(0.9, 1.1));
        b.R = r; b.agl = R(20, 100); b.y = this.floor(bx, bz) + b.agl; b.ph = R(0, 6.28);
        f.birds.push(b);
      }
    } else if (kind === 'hawk') {
      f.mode = 'soar'; this.startSoar(f, x, z, R(450, 850));
      const th = R(0, Math.PI * 2), b = this.bird(kind, f.cx + Math.cos(th) * f.r, 0, f.cz + Math.sin(th) * f.r, headingTo(-f.dir * Math.sin(th), f.dir * Math.cos(th)), K.cruise);
      b.y = this.floor(b.x, b.z) + R(100, f.ceil - this.floor(f.cx, f.cz));
      f.birds.push(b);
    } else {
      f.A = { x, z, psi: R(0, Math.PI * 2), s: 12, rate: 0, tc: 0, agl: R(25, 80), hx: x, hz: z };
      for (let i = 0, n = RI(18, K.max); i < n; i++) {
        const bx = x + R(-14, 14), bz = z + R(-14, 14), b = this.bird(kind, bx, 0, bz, f.A.psi + R(-0.2, 0.2), K.cruise * R(0.9, 1.1));
        b.y = this.floor(bx, bz) + f.A.agl + R(-5, 5); b.ph = R(0, 6.28); b.stT = R(0, 5); b.st = 'flap';
        f.birds.push(b);
      }
    }
    return f;
  }

  // ---------- one bird's flight
  /** Fly b towards W for h seconds (turn rate limited by its bank, speed and climb lag), flapping or not. */
  fly(b, h, pl) {
    const K = KINDS[b.kind];
    const maxRate = G * Math.tan(K.bank) / Math.max(b.s, 4);
    const rate = clamp(wrap(W.psi - b.psi) * 2.5, -maxRate, maxRate);
    b.psiDot += (rate - b.psiDot) * (1 - Math.exp(-h / 0.35));             // the roll takes a moment to build
    b.psi += b.psiDot * h;
    b.s += clamp(W.speed - b.s, -3 * h, 3 * h);
    b.vz += (W.vz - b.vz) * (1 - Math.exp(-h / W.tau));
    b.x += (-Math.sin(b.psi) * b.s + pl.wind[0]) * h;
    b.z += (-Math.cos(b.psi) * b.s + pl.wind[2]) * h;
    b.y += b.vz * h;
    const lo = this.floor(b.x, b.z) + K.minAgl * (b.kind === 'goose' ? 1 : 0.5);   // never into the ground
    if (b.y < lo) { b.y = lo; if (b.vz < 0) b.vz = 0; }
    b.fa += ((W.flap ? 1 : 0) - b.fa) * (1 - Math.exp(-h / 0.2));
    b.dive += (W.dive - b.dive) * (1 - Math.exp(-h / 0.25));
    if (b.fa > 0.02) b.phase += Math.PI * 2 * K.hz * b.hzK * h;
  }

  /** Notice the aircraft, decide (once per approach) whether to get out of the way, then fly (or flee) and move. */
  drive(f, b, h, pl) {
    const K = KINDS[b.kind];
    if (b.flee) {
      const fl = b.flee;
      if (fl.delay > 0) fl.delay -= h;
      else {
        fl.t -= h;
        W.psi = fl.psi; W.speed = K.cruise * 1.3; W.vz = fl.vz; W.dive = fl.dive; W.flap = fl.dive < 0.5; W.tau = 0.25;
        if (fl.t <= 0) { b.flee = null; b.react = Infinity; }
      }
    } else {
      const rx = b.x - pl.pos[0], ry = b.y - pl.pos[1], rz = b.z - pl.pos[2], d2 = rx * rx + ry * ry + rz * rz;
      if (d2 > (K.alert * 1.6) ** 2) b.react = undefined;                   // it has gone: the next approach is a new decision
      else if (d2 < K.alert * K.alert) {
        const d = Math.sqrt(d2) + 1e-3, closing = -(rx * pl.vel[0] + ry * pl.vel[1] + rz * pl.vel[2]) / d;
        if (closing > 15) {
          if (b.react === undefined) b.react = Math.random() < K.reactP ? this.t + R(0.15, 0.5) : Infinity;
          if (this.t >= b.react) this.startFlee(f, b, pl, rx, ry, rz);
        }
      }
    }
    this.fly(b, h, pl);
  }

  startFlee(f, b, pl, rx, ry, rz) {
    const sx = pl.vel[0], sz = pl.vel[2], sl = Math.hypot(sx, sz) || 1;
    let ox = rx - (rx * sx + rz * sz) / (sl * sl) * sx, oz = rz - (rx * sx + rz * sz) / (sl * sl) * sz;   // its offset from our track
    if (Math.hypot(ox, oz) < 1.5) { const s = Math.random() < 0.5 ? 1 : -1; ox = -sz / sl * s; oz = sx / sl * s; }
    const agl = b.y - this.floor(b.x, b.z), down = agl > 25 && (ry < -2 || Math.random() < 0.7);
    b.flee = { t: R(2, 3), delay: 0, psi: headingTo(ox, oz) + R(-0.3, 0.3), vz: down ? -R(4, 9) : R(2, 4), dive: down ? 1 : 0 };
    if (b.kind === 'pigeon') for (const o of f.birds) {                     // the whole flock bursts
      if (o === b || o.flee) continue;
      o.flee = { t: R(2, 3), delay: R(0.05, 0.35), psi: o.psi + R(-1.8, 1.8), vz: R(-3, 4), dive: 0 };
    }
  }

  // ---------- geese
  slot(L, i) {                                                              // the i-th follower's place in the V
    const rank = Math.ceil(i / 2), side = i % 2 ? 1 : -1, fx = -Math.sin(L.psi), fz = -Math.cos(L.psi);
    const lat = side * rank * 2.4, back = rank * 2.2;
    return [L.x - fx * back - fz * lat, L.z - fz * back + fx * lat];
  }
  pickWp(f, L) {
    for (let i = 0; i < 12; i++) {
      const a = L.psi + R(-1, 1), d = R(4000, 8000), x = L.x - Math.sin(a) * d, z = L.z - Math.cos(a) * d;
      if (Math.abs(x) < LIM && Math.abs(z) < LIM) { f.wp = [x, z]; return; }
    }
    f.wp = [R(-5000, 5000), R(-5000, 5000)];
  }
  step_goose(f, h, pl) {
    const B = f.birds, L = B[0], K = KINDS.goose;
    if (Math.hypot(f.wp[0] - L.x, f.wp[1] - L.z) < 400) this.pickWp(f, L);
    f.glideIn -= h;
    if (f.glideT > 0) f.glideT -= h; else if (f.glideIn <= 0) { f.glideT = R(3, 6); f.glideIn = R(25, 60); }
    const gl = f.glideT > 0, fx = -Math.sin(L.psi), fz = -Math.cos(L.psi);
    const yT = Math.max(f.alt, Math.max(this.floor(L.x + fx * 700, L.z + fz * 700), this.floor(L.x, L.z)) + 140);
    f.flap = !gl;
    W.psi = headingTo(f.wp[0] - L.x, f.wp[1] - L.z); W.speed = K.cruise * (gl ? 0.95 : 1); W.vz = clamp((yT - L.y) * 0.12 - (gl ? 1 : 0), -2.5, 3);
    W.flap = f.flap; W.dive = 0; W.tau = 0.6;
    this.drive(f, L, h, pl);
    for (let i = 1; i < B.length; i++) {
      const b = B[i], [sx, sz] = this.slot(L, i), rank = Math.ceil(i / 2);
      const lx = -Math.sin(L.psi), lz = -Math.cos(L.psi), vx = lx * L.s + 0.6 * (sx - b.x), vz = lz * L.s + 0.6 * (sz - b.z);
      W.psi = headingTo(vx, vz); W.speed = clamp(Math.hypot(vx, vz), L.s * 0.7, L.s * 1.35); W.vz = clamp(L.vz + 0.6 * (L.y - b.y), -3.5, 3.5);
      W.flap = f.flap; W.dive = 0; W.tau = 0.6;
      this.drive(f, b, h, pl);
      if (f.flap && !b.flee) b.phase = L.phase - rank * 0.45;               // the beat passes down the V
    }
  }

  // ---------- gulls
  step_gull(f, h, pl) {
    const K = KINDS.gull;
    f.wpsi += R(-1, 1) * 0.08 * h;                                           // the working area drifts along the shore with the wind
    if (Math.abs(f.ax) > LIM - 600 || Math.abs(f.az) > LIM - 600) f.wpsi = headingTo(-f.ax, -f.az);
    f.ax += (-Math.sin(f.wpsi) * 1.2 + pl.wind[0] * 0.6) * h; f.az += (-Math.cos(f.wpsi) * 1.2 + pl.wind[2] * 0.6) * h;
    const B = f.birds;
    for (const b of B) {
      const ang = Math.atan2(b.z - f.az, b.x - f.ax) + f.dir * 0.35;        // a point on its own circle, a little ahead
      let tx = f.ax + b.R * Math.cos(ang), tz = f.az + b.R * Math.sin(ang);
      for (const o of B) {                                                   // loose spacing
        if (o === b) continue;
        const dx = b.x - o.x, dz = b.z - o.z, dy = b.y - o.y, d2 = dx * dx + dz * dz;
        if (d2 < 64 && Math.abs(dy) < 6) { const d = Math.sqrt(d2) + 0.1; tx += dx / d * 12; tz += dz / d * 12; }
      }
      const fl = this.floor(b.x, b.z), ahead = this.floor(b.x - Math.sin(b.psi) * 150, b.z - Math.cos(b.psi) * 150);
      const yT = Math.max(fl, ahead) + b.agl + 10 * Math.sin(this.t * 0.1 + b.ph), need = yT - b.y;
      if ((b.stT -= h) <= 0) { b.st = need > 4 || Math.random() < 0.15 ? 'flap' : 'glide'; b.stT = R(1.5, 4); }
      if (b.y - fl < 6) { b.st = 'flap'; b.stT = 1; }
      const fp = b.st === 'flap';
      W.psi = headingTo(tx - b.x, tz - b.z); W.speed = K.cruise * (fp ? 1.05 : 0.92);
      W.vz = fp ? clamp(need * 0.3, 0.4, 2.5) : clamp(need * 0.3, -2.5, -0.6);
      W.flap = fp; W.dive = 0; W.tau = 0.6;
      this.drive(f, b, h, pl);
    }
  }

  // ---------- hawks
  startSoar(f, x, z, ceilAgl) {
    f.mode = 'soar'; f.cx = x; f.cz = z; f.r = R(35, 60); f.dir = Math.random() < 0.5 ? 1 : -1;
    f.ceil = Math.min(1100, this.floor(x, z) + ceilAgl); f.lift = R(0.9, 1.8);
  }
  hawkGlide(f, b) {
    for (let i = 0; i < 25; i++) {
      const a = b.psi + R(-1.2, 1.2), d = R(1500, 3500), x = b.x - Math.sin(a) * d, z = b.z - Math.cos(a) * d;
      if (Math.abs(x) < LIM && Math.abs(z) < LIM && this.isLand(x, z, 15)) { f.mode = 'glide'; f.tx = x; f.tz = z; return; }
    }
    for (let i = 0; i < 25; i++) {                                           // nothing ahead: anywhere on land
      const x = R(-LIM, LIM), z = R(-LIM, LIM);
      if (this.isLand(x, z, 15)) { f.mode = 'glide'; f.tx = x; f.tz = z; return; }
    }
    f.mode = 'glide'; f.tx = 0; f.tz = 0;
  }
  step_hawk(f, h, pl) {
    const b = f.birds[0], K = KINDS.hawk, fl = this.floor(b.x, b.z);
    W.flap = false; W.dive = 0; W.tau = 0.6;
    if (f.mode === 'soar') {
      f.cx += pl.wind[0] * h; f.cz += pl.wind[2] * h;                       // the thermal drifts with the wind
      let ux = b.x - f.cx, uz = b.z - f.cz; const d = Math.hypot(ux, uz) || 1; ux /= d; uz /= d;
      const e = (d - f.r) / f.r;                                              // outside the circle -> lean in
      W.psi = headingTo(f.dir * -uz - 1.5 * e * ux, f.dir * ux - 1.5 * e * uz);
      W.speed = K.cruise; W.vz = f.lift * (1 + 0.25 * Math.sin(this.t * 0.4));
      if (b.y > f.ceil || this.ground(f.cx, f.cz) < 0.2) this.hawkGlide(f, b);
    } else {
      const dx = f.tx - b.x, dz = f.tz - b.z, fx = -Math.sin(b.psi), fz = -Math.cos(b.psi);
      W.psi = headingTo(dx, dz); W.speed = 14; W.vz = -1;                    // best-glide speed, about 14:1
      const low = b.y - fl < 70 || this.floor(b.x + fx * 250, b.z + fz * 250) > b.y - 30;
      if (Math.hypot(dx, dz) < 150) this.startSoar(f, f.tx, f.tz, R(450, 850));
      else if (low) {                                                         // too low to make it: turn in the first lift it can find
        this.startSoar(f, b.x - fz * 50, b.z + fx * 50, R(300, 600)); f.lift = R(1, 1.5);
      }
    }
    this.drive(f, b, h, pl);
  }

  // ---------- pigeons
  step_pigeon(f, h, pl) {
    const A = f.A, B = f.birds, K = KINDS.pigeon;
    if ((A.tc -= h) <= 0) { A.rate = R(-0.12, 0.12); A.tc = R(4, 8); }
    A.psi += A.rate * h;
    const homeD = Math.hypot(A.x - A.hx, A.z - A.hz);
    if (homeD > 1800 || Math.abs(A.x) > LIM - 500 || Math.abs(A.z) > LIM - 500) A.psi += clamp(wrap(headingTo(A.hx - A.x, A.hz - A.z) - A.psi), -0.4, 0.4) * h;
    A.x += (-Math.sin(A.psi) * A.s + pl.wind[0]) * h; A.z += (-Math.cos(A.psi) * A.s + pl.wind[2]) * h;
    for (const b of B) {
      let n = 0, cx = 0, cy = 0, cz = 0, ax = 0, az = 0, sx = 0, sz = 0, sy = 0;
      for (const o of B) {
        if (o === b) continue;
        const dx = o.x - b.x, dz = o.z - b.z, dy = o.y - b.y, d2 = dx * dx + dz * dz + dy * dy;
        if (d2 > 900) continue;
        n++; cx += o.x; cy += o.y; cz += o.z; ax += -Math.sin(o.psi) * o.s; az += -Math.cos(o.psi) * o.s;
        if (d2 < 16) { const d = Math.sqrt(d2) + 0.1, k = (4 - d) / d; sx -= dx * k; sz -= dz * k; sy -= dy * k; }
      }
      const ownx = -Math.sin(b.psi) * b.s, ownz = -Math.cos(b.psi) * b.s;
      let Dx = 0.3 * ownx + 0.25 * clamp(A.x - b.x, -40, 40) + 1.2 * sx, Dz = 0.3 * ownz + 0.25 * clamp(A.z - b.z, -40, 40) + 1.2 * sz;
      let yT = this.floor(b.x, b.z) + A.agl, vzw = 0.4 * (yT + 6 * Math.sin(this.t * 0.3 + b.ph) - b.y) + 0.5 * sy;
      if (n) { Dx += 1.0 * ax / n + 0.5 * (cx / n - b.x); Dz += 1.0 * az / n + 0.5 * (cz / n - b.z); vzw += 0.4 * (cy / n - b.y); }
      else { Dx += ownx; Dz += ownz; }
      const ahead = this.floor(b.x + ownx * 3, b.z + ownz * 3);
      if (ahead + 10 > b.y) vzw = Math.max(vzw, 3);                           // a rise ahead
      if ((b.stT -= h) <= 0) { b.st = b.st === 'flap' ? 'glide' : 'flap'; b.stT = b.st === 'flap' ? R(3, 7) : R(0.4, 1); }
      W.psi = headingTo(Dx, Dz); W.speed = clamp(Math.hypot(Dx, Dz), 9, 16);
      W.vz = clamp(vzw, -3, 3) - (b.st === 'glide' ? 0.8 : 0);
      W.flap = b.st === 'flap'; W.dive = 0; W.tau = 0.6;
      this.drive(f, b, h, pl);
    }
  }

  // ---------- collisions
  /**
   * Did the aircraft (its hit points moved prev -> cur this step, orientation q = [x, y, z, w]) touch a bird?
   * Returns { flock, bird } or null. Birds are swept over the same step so a fast pass cannot tunnel through.
   */
  strike(prev, cur, q, pts) {
    const off = this._off;
    for (let i = 0; i < pts.length; i++) {                                    // body-frame points -> world offsets
      const v = pts[i], o = off[i] || (off[i] = [0, 0, 0]);
      const tx = 2 * (q[1] * v[2] - q[2] * v[1]), ty = 2 * (q[2] * v[0] - q[0] * v[2]), tz = 2 * (q[0] * v[1] - q[1] * v[0]);
      o[0] = v[0] + q[3] * tx + (q[1] * tz - q[2] * ty); o[1] = v[1] + q[3] * ty + (q[2] * tx - q[0] * tz); o[2] = v[2] + q[3] * tz + (q[0] * ty - q[1] * tx);
    }
    for (const f of this.flocks) for (const b of f.birds) {
      const ex = b.x - cur[0], ey = b.y - cur[1], ez = b.z - cur[2];
      if (ex * ex + ey * ey + ez * ez > 2500) continue;                       // more than 50 m away
      const r = KINDS[f.kind].hitR + 0.3, r2 = r * r;                         // the bird plus a bit of airframe thickness
      for (let k = 1; k <= 4; k++) {
        const t = k / 4, cx = prev[0] + (cur[0] - prev[0]) * t, cy = prev[1] + (cur[1] - prev[1]) * t, cz = prev[2] + (cur[2] - prev[2]) * t;
        const bx = b.px + (b.x - b.px) * t, by = b.py + (b.y - b.py) * t, bz = b.pz + (b.z - b.pz) * t;
        for (let i = 0; i < pts.length; i++) {
          const dx = cx + off[i][0] - bx, dy = cy + off[i][1] - by, dz = cz + off[i][2] - bz;
          if (dx * dx + dy * dy + dz * dz < r2) return { flock: f, bird: b };
        }
      }
    }
    return null;
  }

  /** Remove a bird that was hit. */
  kill(hit) { const a = hit.flock.birds, i = a.indexOf(hit.bird); if (i >= 0) a.splice(i, 1); }
}

/** Points on an aircraft that can meet a bird: the hardpoints plus the wing line, fuselage, tailplane and (props) the disc. */
const hp = new WeakMap();
export function hitPoints(spec) {
  if (!hp.has(spec)) {
    const H = spec.hardpoints, [l, r, nose, tail] = H, lerp = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
    const pts = [[0, 0, 0], ...H];
    for (let u = 0.125; u < 1; u += 0.125) pts.push(lerp(l, r, u));
    for (const u of [0.25, 0.5, 0.75]) pts.push(lerp(nose, tail, u));
    pts.push([r[0] * 0.3, tail[1], tail[2]], [l[0] * 0.3, tail[1], tail[2]]);
    if (spec.engine.kind !== 'jet') pts.push([0.9, nose[1], nose[2]], [-0.9, nose[1], nose[2]], [0, nose[1] + 0.9, nose[2]], [0, nose[1] - 0.9, nose[2]]);
    hp.set(spec, pts);
  }
  return hp.get(spec);
}
