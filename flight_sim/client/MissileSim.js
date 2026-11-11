/**
 * MissileSim - an AIM-9M-class infrared (heat-seeking) dogfight missile, as plain maths (no Three.js),
 * so every browser - and a Node test - flies the same missile from the same launch state.
 *
 * Airframe: 86 kg at launch, 61 kg after a 4 s boost (14 kN), 127 mm body. Drag from a Mach-dependent
 * Cd0 (transonic rise, lower while the motor fills the base) plus induced drag when it pulls g, so
 * every hard turn costs speed. How hard it can turn is set by dynamic pressure (q * S * CLmax / m,
 * capped at 35 g): fast and low it out-turns any aircraft, slow or high it is a dart. That is its range.
 *
 * Seeker: looks at everything hot inside its 2.5° field of view, steers toward the intensity-weighted
 * centroid (so a bright flare next to the target drags it off), gimbal limit 40° off the missile's
 * axis, tracking rate limit 35°/s. Guidance: proportional navigation (N = 4) on the seeker's measured
 * line-of-sight rate, plus gravity compensation; the airframe answers a command with a 0.6 s lag.
 * Fuse: active proximity, armed 0.5 s after launch, fires at the closest approach inside 9 m
 * (inside 5 m it kills, further out it damages). Self-destructs after 22 s.
 *
 * How to beat it: be out of range (it runs out of energy), take it head-on / beam it so the closing
 * geometry eats its energy, break hard at the last moment (it saturates its g or its tracking rate),
 * flares while it is looking at you (the seeker rejects 70 % of flares; a flare burns about as bright as a
 * jet at military power, so in afterburner they hardly help - come out of burner), pull the throttle
 * back (a cooler engine is harder to see), put a mountain between you.
 */
const G = 9.81, DEG = Math.PI / 180;

export const AIM9 = {
  mass0: 86, mass1: 61, burn: 4.0, thrust: 14000, sref: Math.PI * 0.0635 * 0.0635,
  saero: 0.09, clmax: 1.4, k: 0.35, gmax: 35, N: 4, tau: 0.6,
  fov: 2.5 * DEG, gimbal: 40 * DEG, trackRate: 35 * DEG, fuse: 9, kill: 5, arm: 0.5, guideAfter: 0.25, life: 22,
  flareReject: 0.7,
};

/**
 * The missile types (both the Falcon and the A-10 carry all three; the pilot picks with Y):
 *   aim9   AIM-9M Sidewinder   - the baseline IR dogfight missile (above)
 *   aim9x  AIM-9X Block II     - a better IR seeker: wide gimbal, fast tracking, high-g airframe, picks flares out better. Lock cone 45 deg.
 *   aim120 AIM-120 AMRAAM      - active radar, fire and forget: long motor, sees 2.5x as far, hardly fooled by flares (only 2 per sortie)
 * `lockCone`: how far off the nose the seeker will pick a target up before launch; `rangeMul`: detection range multiplier.
 */
export const MISSILE_TYPES = {
  aim9: { id: 'aim9', ...AIM9, name: 'AIM-9M', fox: 'FOX 2', lockCone: 20 * DEG, rangeMul: 1, max: 4 },
  aim9x: { id: 'aim9x', ...AIM9, name: 'AIM-9X', fox: 'FOX 2', mass0: 85, mass1: 60, burn: 4.5, thrust: 15500, gmax: 50, N: 5, tau: 0.4, clmax: 1.6,
           fov: 4 * DEG, gimbal: 80 * DEG, trackRate: 70 * DEG, flareReject: 0.88, life: 24, lockCone: 45 * DEG, rangeMul: 1.1, max: 2 },
  aim120: { id: 'aim120', ...AIM9, name: 'AIM-120', fox: 'FOX 3', mass0: 157, mass1: 108, burn: 8, thrust: 14500, sref: Math.PI * 0.089 * 0.089, saero: 0.2, clmax: 1.4, gmax: 40, N: 4, tau: 0.5,
            fov: 8 * DEG, gimbal: 60 * DEG, trackRate: 40 * DEG, fuse: 12, kill: 7, arm: 1.0, guideAfter: 0.6, life: 50, flareReject: 0.96, lockCone: 30 * DEG, rangeMul: 2.5, max: 2 },
};
export const MISSILE_IDS = ['aim9', 'aim9x', 'aim120'];

export const rho = h => 1.225 * Math.exp(-Math.max(0, h) / 9000);
function cd0(M, boost) {
  const c = M < 0.8 ? 0.35 : M < 1.05 ? 0.35 + (M - 0.8) / 0.25 * 0.6 : Math.max(0.6, 0.95 - (M - 1.05) * 0.18);
  return boost ? c - 0.12 : c;
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))));

/** Relative infrared brightness of an aircraft seen from direction toObs (unit, target -> observer). 1 = a jet at full military power from behind. */
const PROP_IR = { warbird: 0.35, sport: 0.15, trainer: 0.12, seaplane: 0.15, a10: 0.5 };      // the A-10's two high-bypass turbofans run cool: hard to see unless you are behind it
export function signature(type, engine, fwd, toObs) {
  const base = type === 'a10' ? 0.2 + 0.4 * engine : type === 'jet' ? 0.3 + 0.7 * engine + (engine > 0.92 ? 0.6 : 0) : (PROP_IR[type] || 0.15) * (0.35 + 0.65 * engine);
  const rear = Math.max(0, -dot(fwd, toObs));                    // 1 = straight up its tailpipe
  return base * (0.3 + 0.7 * Math.pow(rear, 1.5));                // all-aspect seeker: still sees the hot airframe head-on
}
/** How far a seeker can see a source of brightness s. */
export const detectRange = s => 7000 * Math.sqrt(s);

/** A flare: brighter than any engine for a few seconds, slowed by drag at once, falling. */
export class Flare {
  constructor(id, p, v) { this.id = id; this.p = p.slice(); this.v = v.slice(); this.t = 0; this.life = 4.5; }
  get I() { return this.t < 0.12 ? this.t / 0.12 : Math.exp(-(this.t - 0.12) / 1.6); }
  step(dt) {
    this.t += dt;
    const k = Math.exp(-dt * 1.1);
    for (let a = 0; a < 3; a++) { this.v[a] *= k; this.p[a] += this.v[a] * dt; }
    this.v[1] -= G * dt;
    return this.t < this.life;
  }
}

function hash01(a, b) {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export class Missile {
  /**
   * mid: id (unique for its shooter), tg: the pilot it was locked on (0 = fired at nothing),
   * p / v: launch position / velocity, d: where the seeker was looking (unit).
   */
  constructor({ mid, from, tg, p, v, d, k = 'aim9' }) {
    this.A = MISSILE_TYPES[k] || MISSILE_TYPES.aim9; this.k = this.A.id;
    this.mid = mid; this.from = from; this.tg = tg;
    this.p = p.slice(); this.v = v.slice(); this.seek = norm(d); this.t = 0; this.m = this.A.mass0;
    this.tracking = !!tg; this.tp = null; this.g = 0; this.done = null; this.al = [0, 0, 0];
  }
  get burning() { return this.t < this.A.burn; }
  get speed() { return len(this.v); }

  /**
   * One step. env: target() -> {p, v, fwd, type, engine} | null (the aircraft it was fired at),
   * flares: [Flare], ground(x, z). Returns an end event once: {kind: 'prox' | 'ground' | 'sd', p, miss}.
   */
  step(dt, env) {
    if (this.done) return null;
    const A = this.A;
    this.t += dt;
    const V = this.speed, vh = norm(this.v);
    const r = rho(this.p[1]), q = 0.5 * r * V * V, M = V / 340;
    this.m = this.burning ? A.mass0 - (A.mass0 - A.mass1) * this.t / A.burn : A.mass1;
    const tgt = this.tg ? env.target() : null;

    // ---- seeker: everything hot in its field of view, inside its gimbal, bright enough at that range
    let cx = 0, cy = 0, cz = 0, wsum = 0;
    const look = (pos, I) => {
      const d = [pos[0] - this.p[0], pos[1] - this.p[1], pos[2] - this.p[2]], dist = len(d) || 1e-3, u = [d[0] / dist, d[1] / dist, d[2] / dist];
      if (angle(u, this.seek) > A.fov || angle(u, vh) > A.gimbal || dist > detectRange(I) * A.rangeMul) return;
      const w = I / (dist * dist);
      cx += u[0] * w; cy += u[1] * w; cz += u[2] * w; wsum += w;
    };
    if (tgt) look(tgt.p, signature(tgt.type, tgt.engine, tgt.fwd, norm([this.p[0] - tgt.p[0], this.p[1] - tgt.p[1], this.p[2] - tgt.p[2]])));
    for (const f of env.flares || []) if (hash01(this.mid * 7919 + this.from, f.id) >= A.flareReject) look(f.p, f.I);
    let omega = [0, 0, 0];
    this.tracking = wsum > 0;
    if (this.tracking) {
      const c = norm([cx, cy, cz]), ang = angle(this.seek, c);
      let nd = c;
      if (ang > A.trackRate * dt) {                             // the seeker head cannot slew that fast: it lags
        const ax = norm(cross(this.seek, c)), th = A.trackRate * dt;
        nd = norm(rot(this.seek, ax, th));
      }
      omega = cross(this.seek, nd).map(x => x / dt);            // measured line-of-sight rate (rad/s)
      this.seek = nd;
    } else {
      this.seek = norm([this.seek[0] * 0.9 + vh[0] * 0.1, this.seek[1] * 0.9 + vh[1] * 0.1, this.seek[2] * 0.9 + vh[2] * 0.1]);   // caged back toward the nose
    }

    // ---- guidance: proportional navigation + gravity compensation, limited by what the fins can do
    let al = [0, 0, 0];
    if (this.tracking && this.t > A.guideAfter) {
      const pn = cross(omega, this.v).map(x => x * A.N);
      al = [pn[0], pn[1] + G, pn[2]];
      const along = dot(al, vh); al = [al[0] - vh[0] * along, al[1] - vh[1] * along, al[2] - vh[2] * along];
    }
    const amax = Math.min(A.gmax * G, q * A.saero * A.clmax / this.m);
    const am = len(al);
    if (am > amax) al = al.map(x => x * amax / am);
    const kl = 1 - Math.exp(-dt / A.tau);                         // autopilot + fins: first-order response
    al = this.al.map((x, i) => x + (al[i] - x) * kl);
    const along2 = dot(al, vh); al = [al[0] - vh[0] * along2, al[1] - vh[1] * along2, al[2] - vh[2] * along2];
    this.al = al;
    const alat = len(al);
    this.g = alat / G;
    const di = q > 1 ? Math.pow(this.m * alat, 2) * A.k / (q * A.saero) : 0;
    const drag = q * A.sref * cd0(M, this.burning) + di;
    const ax = ((this.burning ? A.thrust : 0) - drag) / this.m;
    const prev = this.p.slice();
    for (let a = 0; a < 3; a++) this.v[a] += (vh[a] * ax + al[a]) * dt;
    this.v[1] -= G * dt;
    for (let a = 0; a < 3; a++) this.p[a] += this.v[a] * dt;

    if (env.shield && env.shield(this.p[0], this.p[1], this.p[2])) return (this.done = { kind: 'sd', p: this.p.slice(), miss: Infinity, shield: true });      // the shield swallows it
    // ---- fuse: closest approach to the target during this step
    if (tgt && this.tp && this.t > A.arm) {
      const r0 = [prev[0] - this.tp[0], prev[1] - this.tp[1], prev[2] - this.tp[2]], r1 = [this.p[0] - tgt.p[0], this.p[1] - tgt.p[1], this.p[2] - tgt.p[2]];
      const dr = [r1[0] - r0[0], r1[1] - r0[1], r1[2] - r0[2]], s = Math.max(0, Math.min(1, -dot(r0, dr) / (dot(dr, dr) || 1)));
      const c = [r0[0] + dr[0] * s, r0[1] + dr[1] * s, r0[2] + dr[2] * s], miss = len(c);
      if (miss < A.fuse && s < 1) {                             // passed its closest point inside the fuse range
        const at = [prev[0] + (this.p[0] - prev[0]) * s, prev[1] + (this.p[1] - prev[1]) * s, prev[2] + (this.p[2] - prev[2]) * s];
        return (this.done = { kind: 'prox', p: at, miss });
      }
    }
    if (tgt) this.tp = tgt.p.slice();
    const gh = env.ground ? Math.max(0, env.ground(this.p[0], this.p[2])) : 0;
    if (this.p[1] < gh) return (this.done = { kind: 'ground', p: [this.p[0], gh, this.p[2]], miss: Infinity, water: gh <= 0.01 });
    if (this.t > A.life) return (this.done = { kind: 'sd', p: this.p.slice(), miss: Infinity });
    return null;
  }
}
function rot(v, k, th) {                                          // Rodrigues: v rotated about unit axis k by th
  const c = Math.cos(th), s = Math.sin(th), kv = cross(k, v), kd = dot(k, v);
  return [v[0] * c + kv[0] * s + k[0] * kd * (1 - c), v[1] * c + kv[1] * s + k[1] * kd * (1 - c), v[2] * c + kv[2] * s + k[2] * kd * (1 - c)];
}

/**
 * Launch zone check for the HUD: fly a copy of the missile now against the target holding its course.
 * Returns {hit, tof} - "IN RANGE" means a non-manoeuvring target would be hit.
 */
export function predict(launch, tgt, ground, dt = 1 / 30) {
  const m = new Missile({ mid: 0, from: 0, tg: 1, ...launch }), A = m.A;
  const p = tgt.p.slice();
  const env = { target: () => ({ ...tgt, p }), flares: [], ground };
  for (let t = 0; t < A.life; t += dt) {
    for (let a = 0; a < 3; a++) p[a] += tgt.v[a] * dt;
    const e = m.step(dt, env);
    if (e) return { hit: e.kind === 'prox' && e.miss < A.kill, tof: m.t };
  }
  return { hit: false, tof: A.life };
}
