/**
 * Carrier anti-aircraft fire (client side, drawn and resolved in each browser; only the pilot's own browser applies damage to its own aircraft,
 * the same trust model as bombs and the other pilots' guns).
 *
 * Every mount on a carrier (see CarrierScene.js) is an independent gunner that behaves like a 1940s fire-control system, not an aimbot:
 *   - it sees the target a moment late (REACTION s), measures its velocity coarsely, and assumes it keeps flying straight and level
 *     at that velocity - so jinking, diving and turning spoil the solution
 *   - it misjudges range, and its pointing error is a per-burst bias (slow training of the mount) plus per-round dispersion
 *   - heavy guns (5"/38, 12.7 cm Type 89) fire single time-fuzed shells every few seconds. The USN round has a VT proximity fuze (bursts within ~20 m
 *     of the target when it gets that close), the IJN round only has a clockwork time fuze set with an error. A burst is a flash plus a black
 *     smoke puff; fragments hurt inside ~30 m, a lot inside ~10 m
 *   - light guns (40 mm Bofors / 25 mm Type 96 / 20 mm Oerlikon) fire short bursts of tracer rounds with contact fuzes: hit radius a few metres,
 *     the shell self-destructs when its time runs out (a little puff in the sky)
 * Targets are the enemy pilots inside ENGAGE metres of a mount. Nothing here touches the ships' hit points (the server keeps those).
 * The ships are the two carriers and the IJN destroyer escort (DestroyerScene.js): each {info (CarrierWorld ship), mounts, gun?}. A mount may have
 * maxPitch (the destroyer's 12.7 cm guns elevate to 55 deg only: a plane diving on her from overhead is out of their reach). Rounds striking the
 * destroyer near a gun send its crew for cover for a few seconds (suppress()).
 */
import * as THREE from 'three';

const CW = window.CWWorld;
const R = (a, b) => a + Math.random() * (b - a);
const G = 9.81, ENGAGE = 900, REACTION = 0.6, MAX_SHELLS = 260;
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 0.5;            // ~N(0,1), clipped to +-3
// per type: muzzle speed, rate (rounds/s inside a burst), burst length, pause between bursts, dispersion (mrad), range error (fraction), pointing bias (mrad), hit radius, damage in "hits", max range
const GUN = {
  usn: {
    heavy: { v: 790, rate: 0.3, burst: 1, pause: [2.2, 3.6], disp: 3, rng: 0.05, bias: 10, vt: 20, blast: 32, dmg: 2.6, range: 900, fuseErr: 0.025, size: 1 },
    light: { v: 880, rate: 6, burst: [8, 16], pause: [1.5, 3.5], disp: 5, rng: 0.12, bias: 22, hit: 4.5, dmg: 0.5, range: 750, life: 2.2, size: 0.8 },
    tiny:  { v: 840, rate: 7, burst: [10, 20], pause: [1.5, 3.5], disp: 7, rng: 0.15, bias: 28, hit: 3.0, dmg: 0.3, range: 550, life: 1.6, size: 0.5 },
  },
  ijn: {
    heavy: { v: 720, rate: 0.28, burst: 1, pause: [2.8, 4.2], disp: 4, rng: 0.09, bias: 16, vt: 0, blast: 28, dmg: 2.8, range: 800, fuseErr: 0.06, size: 1 },
    light: { v: 900, rate: 4, burst: [6, 12], pause: [2, 4.5], disp: 6, rng: 0.16, bias: 30, hit: 3.2, dmg: 0.4, range: 650, life: 2.0, size: 0.6 },
  },
  // the Kagero-class destroyer: the Type 3 12.7 cm was a surface gun (hand-loaded, slow at high angles, a clockwork time fuze, no AA director worth the name);
  // the 25 mm Type 96 triples and singles did the real work
  ijnDD: {
    heavy: { v: 910, rate: 0.2, burst: 1, pause: [4, 6.5], disp: 4, rng: 0.11, bias: 20, vt: 0, blast: 28, dmg: 2.8, range: 800, fuseErr: 0.07, size: 1 },
    light: { v: 900, rate: 4, burst: [6, 12], pause: [2, 4.5], disp: 6, rng: 0.16, bias: 30, hit: 3.2, dmg: 0.4, range: 650, life: 2.0, size: 0.6 },
    tiny:  { v: 900, rate: 3.5, burst: [5, 10], pause: [2, 4], disp: 7, rng: 0.17, bias: 32, hit: 3.0, dmg: 0.4, range: 600, life: 2.0, size: 0.5 },
  },
};
const MUZZLE = { heavy: 1, light: 0.55, tiny: 0.35 };
// BALANCE: the guns above keep each navy's character (the USN's VT-fuzed 5"/38s and quad Bofors put far more steel near a target than the IJN's
// time-fuzed 12.7 cm and 25 mm), but left alone that made the USN fleet ~4.5x as deadly as the IJN one on the same attack run. LETHAL scales the
// damage of every round so the two fleets cost an attacker the same on the same run (measured with a Monte Carlo of dive and torpedo runs from
// random bearings: a straight 60 deg dive takes ~9.5 AA hits from either fleet, a weaving one ~1, a straight torpedo run ~5). The destroyer is
// left as it was (it only matters to attacks that pass near her).
const LETHAL = { usn: 0.32, ijn: 1.43, ijnDD: 1 };

export class CarrierAA {
  /** host: { audio: {boom(d), gun(), hit()}, hurt(hits, who), say(), camera, shielded(pos) } */
  constructor(scene, fx, ships, host) {
    this.fx = fx; this.host = host; this.ships = ships; this.shells = []; this.track = new Map(); this.near = 0; this.clock = 0; this.stats = { fired: 0, bursts: 0, hits: 0, hurt: 0 };
    const N = MAX_SHELLS;
    const geo = new THREE.BufferGeometry();
    this.lp = new Float32Array(N * 6).fill(-1e5); this.lc = new Float32Array(N * 6);
    geo.setAttribute('position', new THREE.BufferAttribute(this.lp, 3)); geo.setAttribute('color', new THREE.BufferAttribute(this.lc, 3));
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); this.lines.frustumCulled = false; scene.add(this.lines);
    const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d');
    const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,230,150,.85)'); gr.addColorStop(1, 'rgba(255,150,40,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    this.hp = new Float32Array(N * 3).fill(-1e5); const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.BufferAttribute(this.hp, 3));
    this.dots = new THREE.Points(hg, new THREE.PointsMaterial({ size: 2.4, map: new THREE.CanvasTexture(c), color: 0xffe0a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true })); this.dots.frustumCulled = false; scene.add(this.dots);
  }

  clear() { this.shells = []; for (const c of this.ships) for (const m of c.mounts) { m.left = 0; m.tgt = null; m.cool = 1 + Math.random() * 2; } }

  /** Rounds hit the destroyer at p: the crews of the guns within a few metres take cover (stop firing for a few seconds). */
  suppress(p) {
    for (const c of this.ships) if (c.info.dd) for (const m of c.mounts) {
      const w = CW.toWorld(c.info, m.x, m.y, m.z);
      if (Math.hypot(w[0] - p[0], w[1] - p[1], w[2] - p[2]) < (m.type === 'heavy' ? 4 : 6)) { m.left = 0; m.cool = Math.max(m.cool, R(2, 4)); }
    }
  }

  /** targets: [{key, team, pos:[x,y,z], mine}] - every aircraft that can be shot at (me included). active: ship index -> may fire */
  update(dt, targets, active) {
    if (dt <= 0 || dt > 0.25) dt = Math.min(Math.max(dt, 0), 0.25);
    // velocity estimates (smoothed, from positions: works the same for my aircraft and for remote ones)
    this.clock += dt; const seen = new Set();
    for (const t of targets) {
      seen.add(t.key); let k = this.track.get(t.key);
      if (!k) { k = { p: t.pos.slice(), v: [0, 0, 0], hist: [] }; this.track.set(t.key, k); }
      else if (dt > 0) { for (let a = 0; a < 3; a++) { const v = (t.pos[a] - k.p[a]) / dt; k.v[a] += (v - k.v[a]) * Math.min(1, dt * 4); k.p[a] = t.pos[a]; } }
      k.hist.push({ t: this.clock, p: t.pos.slice(), v: k.v.slice() }); while (k.hist.length > 1 && this.clock - k.hist[0].t > REACTION + 0.1) k.hist.shift();
      t.k = k;
    }
    for (const key of this.track.keys()) if (!seen.has(key)) this.track.delete(key);

    this.ships.forEach((c, i) => {
      const I = c.info, spec = GUN[c.gun || (I.team ? 'ijn' : 'usn')];
      for (const m of c.mounts) this.stepMount(dt, m, c, I, spec[m.type] || spec.light, targets.filter(t => t.team !== I.team), active[i], c);
    });
    this.stepShells(dt, targets);
    this.draw();
  }

  stepMount(dt, m, c, I, S, foes, on, ship) {
    const w = CW.toWorld(I, m.x, m.y, m.z), mx = w[0], my = w[1], mz = w[2];        // the ship turns and heels under the mount
    // pick / keep a target: the nearest foe in range and above the horizon of the mount (the ones low in the water or on a deck are not engaged)
    let best = null, bd = 1e9;
    if (on) for (const t of foes) { const d = Math.hypot(t.pos[0] - mx, t.pos[1] - my, t.pos[2] - mz); if (d < S.range && d < bd && t.pos[1] > 4 && !(t.mine && this.host.onDeck(t.pos))) { best = t; bd = d; } }
    if (!best) { m.tgt = null; m.left = 0; this.relax(dt, m); return; }
    m.tgt = best;
    const sol = this.solve(m, mx, my, mz, best, S);
    // slew the mount (traverse is limited: ~60 deg/s heavy, 90 deg/s light)
    const slew = (m.type === 'heavy' ? 1.0 : 1.6) * dt, yawT = Math.atan2(-sol.d[0], -sol.d[2]) - I.yaw, pitT = Math.min(m.maxPitch || 1.6, Math.asin(Math.max(-0.2, Math.min(1, sol.d[1]))));
    let dy = yawT - m.yaw.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); m.yaw.rotation.y += Math.max(-slew, Math.min(slew, dy));
    m.pitch.rotation.x += Math.max(-slew, Math.min(slew, pitT - m.pitch.rotation.x));
    const aligned = Math.abs(dy) < 0.12 && Math.abs(pitT - m.pitch.rotation.x) < 0.12;
    if (m.left > 0) {
      m.t -= dt;
      while (m.t <= 0 && m.left > 0) { this.fire(m, mx, my, mz, sol, S, ship); m.left--; m.t += 1 / S.rate; if (m.left <= 0) m.cool = R(...S.pause); }
    } else {
      m.cool -= dt;
      if (m.cool <= 0 && aligned) {
        m.left = Array.isArray(S.burst) ? Math.round(R(S.burst[0], S.burst[1])) : S.burst; m.t = 0;
        const b = S.bias / 1000 * bd; m.bias = [gauss() * b, gauss() * b * 0.7, gauss() * b];       // this burst's pointing error, metres at the target
        m.rngErr = gauss() * S.rng;
      }
    }
  }
  relax(dt, m) { m.pitch.rotation.x += (0.15 - m.pitch.rotation.x) * Math.min(1, dt * 2); }

  /** The gunner's firing solution: where the target was REACTION s ago, extrapolated straight at the velocity then measured. */
  solve(m, mx, my, mz, t, S) {
    const k = t.k, h = k.hist[0] || { p: t.pos, v: k.v };
    const p0 = h.p, v = h.v, age = REACTION, rngErr = 1 + (m.rngErr || 0), muzzle = (MUZZLE[m.type] || 1) * 3;
    let T = Math.hypot(p0[0] - mx, p0[1] - my, p0[2] - mz) / S.v, ax = p0[0], ay = p0[1], az = p0[2];
    for (let it = 0; it < 4; it++) {
      ax = p0[0] + v[0] * (T + age); ay = p0[1] + v[1] * (T + age); az = p0[2] + v[2] * (T + age);
      T = Math.hypot(ax - mx, ay - my, az - mz) / S.v;
    }
    const D = Math.hypot(ax - mx, ay - my, az - mz) || 1, dir = [(ax - mx) / D, (ay - my + 0.5 * G * T * T) / D, (az - mz) / D], n = Math.hypot(...dir);
    return { d: dir.map(x => x / n), T, D, rngErr, aim: [ax, ay, az], muzzle };
  }

  fire(m, mx, my, mz, sol, S, ship) {
    const fx = this.fx, d = sol.d, off = m.muzzleLen + 0.5, p = [mx + d[0] * off, my + d[1] * off, mz + d[2] * off];
    const bias = m.bias || [0, 0, 0], disp = S.disp / 1000;
    // direction with the burst's bias (metres at the aim point, as an angle) and per-round dispersion
    const e = [(bias[0] / sol.D) + gauss() * disp, (bias[1] / sol.D) + gauss() * disp, (bias[2] / sol.D) + gauss() * disp];
    let v = [d[0] + e[0], d[1] + e[1], d[2] + e[2]]; const n = Math.hypot(...v); v = v.map(x => x / n * S.v);
    const heavy = m.type === 'heavy', cam = this.host.camera.position, cd = Math.hypot(p[0] - cam.x, p[1] - cam.y, p[2] - cam.z);
    const s = { p, v, t: 0, heavy, S, k: LETHAL[ship.gun || (ship.info.team ? 'ijn' : 'usn')] || 1, team: ship.info.team, by: ship.info.dd ? ship.info.name : 'carrier', from: p.slice(), kind: m.type };
    if (heavy) s.fuse = sol.T * (1 + (m.rngErr || 0) * 0.8 + gauss() * S.fuseErr), s.life = s.fuse + 0.05;
    else s.life = S.life;
    if (this.shells.length >= MAX_SHELLS) this.shells.shift();
    this.shells.push(s); this.stats.fired++;
    // muzzle blast: flash, powder smoke; the big guns kick out a ball of flame and a cloud and thump the air
    const k = MUZZLE[m.type] || 0.5;
    fx.fire.emit({ p, v: [d[0] * 12, d[1] * 12, d[2] * 12], life: heavy ? 0.14 : 0.07, size: [2.2 * k * 2.4, 7 * k * 2.4], c0: [3, 2.4, 1.4], c1: [2, 0.9, 0.2], a: 1, fadeIn: 0.005, drag: 2 });
    if (heavy || Math.random() < 0.35) fx.smoke.emit({ p, v: [d[0] * 5 + R(-1, 1), d[1] * 5 + 1.5, d[2] * 5 + R(-1, 1)], life: heavy ? R(3, 5) : R(1, 2), size: [1.5 * k * 2, (heavy ? 9 : 3.5) * k * 1.6], c0: [0.5, 0.5, 0.5], c1: [0.7, 0.7, 0.7], a: heavy ? 0.6 : 0.3, fadeIn: 0.05, drag: 1.2, acc: 0.3, wind: 0.8, spin: 0.4 });
    if (heavy && cd < 1500) this.host.audio.boom(cd * 1.8);
    else if (cd < 500 && Math.random() < 0.3) this.host.audio.gun();
  }

  stepShells(dt, targets) {
    const keep = [], fx = this.fx;
    for (const s of this.shells) {
      const p0 = s.p.slice(), steps = Math.max(1, Math.ceil(dt * Math.hypot(...s.v) / 25)), h = dt / steps;
      let dead = false;
      for (let st = 0; st < steps && !dead; st++) {
        const a = s.p.slice();
        s.v[1] -= G * h; for (let q = 0; q < 3; q++) s.p[q] += s.v[q] * h; s.t += h;
        // proximity / contact against the targets
        for (const t of targets) {
          if (t.team === s.team) continue;
          const d = segDist(a, s.p, t.pos);
          if (s.heavy) { if (s.S.vt && d < s.S.vt && s.t > 0.3) { this.burst(s, closest(a, s.p, t.pos), targets); dead = true; break; } }
          else if (d < s.S.hit) { this.contact(s, closest(a, s.p, t.pos), t); dead = true; break; }
        }
        if (dead) break;
        if (s.p[1] < 0.2) { this.splash(s); dead = true; break; }
        if (s.t >= s.life) { if (s.heavy) this.burst(s, s.p.slice(), targets); else this.popLight(s); dead = true; break; }
      }
      if (!dead) keep.push(s);
    }
    this.shells = keep;
  }

  /** A time- or proximity-fuzed shell bursts: flash, black smoke, fragments; hurts my aircraft by distance. */
  burst(s, p, targets) {
    const fx = this.fx; this.stats.bursts++;
    fx.fire.emit({ p, life: 0.2, size: [6, 20], c0: [3, 2.4, 1.6], c1: [2, 0.7, 0.15], a: 1, fadeIn: 0.01, drag: 0 });
    for (let k = 0; k < 6; k++) fx.fire.emit({ p: [p[0] + R(-2, 2), p[1] + R(-2, 2), p[2] + R(-2, 2)], v: [R(-8, 8), R(-6, 8), R(-8, 8)], life: R(0.25, 0.5), size: [2, 7], c0: [2.6, 1.3, 0.4], c1: [0.6, 0.1, 0.01], a: 0.9, fadeIn: 0.02, drag: 2 });
    for (let k = 0; k < 9; k++) fx.smoke.emit({ p: [p[0] + R(-2, 2), p[1] + R(-2, 2), p[2] + R(-2, 2)], v: [R(-7, 7), R(-5, 7), R(-7, 7)], life: R(8, 14), size: [R(3, 5), R(14, 26)], c0: [0.025, 0.025, 0.028], c1: [0.2, 0.2, 0.21], a: 0.9, fadeIn: 0.1, drag: 2.2, acc: 0.15, wind: 0.9, spin: 0.2 });
    for (let k = 0; k < 14; k++) fx.spark.emit({ p, v: [R(-60, 60), R(-40, 60), R(-60, 60)], life: R(0.3, 0.8), size: [0.5, 0.2], c0: [3, 2, 0.8], c1: [1, 0.3, 0.02], a: 1, fadeIn: 0.01, drag: 0.8, acc: -9.8 });
    const cam = this.host.camera.position, cd = Math.hypot(p[0] - cam.x, p[1] - cam.y, p[2] - cam.z);
    this.host.audio.boom(cd * 1.2);
    for (const t of targets) if (t.mine) {
      const d = Math.hypot(t.pos[0] - p[0], t.pos[1] - p[1], t.pos[2] - p[2]);
      if (d < s.S.blast) { const n = s.S.dmg * s.k * Math.pow(1 - d / s.S.blast, 1.4); this.stats.hurt += n; this.host.hurt(n, s.by + ' flak', d < 14 ? 'close' : 'near'); }
    }
  }
  contact(s, p, t) {
    const fx = this.fx; this.stats.hits++;
    fx.fire.emit({ p, life: 0.12, size: [2, 6], c0: [3, 2.5, 1.5], c1: [2, 0.9, 0.2], a: 1, fadeIn: 0.005, drag: 0 });
    fx.smoke.emit({ p, v: [R(-2, 2), R(1, 3), R(-2, 2)], life: R(1.5, 3), size: [1.5, 7], c0: [0.1, 0.1, 0.1], c1: [0.35, 0.35, 0.35], a: 0.7, fadeIn: 0.03, drag: 1, wind: 0.6 });
    for (let k = 0; k < 8; k++) fx.spark.emit({ p, v: [R(-18, 18), R(-8, 18), R(-18, 18)], life: R(0.3, 0.7), size: [0.5, 0.2], c0: [3, 2, 0.8], c1: [1, 0.3, 0.02], a: 1, fadeIn: 0.01, drag: 0.8, acc: -9.8 });
    if (t.mine) { this.stats.hurt += s.S.dmg * s.k; this.host.hurt(s.S.dmg * s.k, s.by + ' AA', 'hit'); }
  }
  popLight(s) {                                                                    // the shell self-destructs: a small puff in the sky
    this.fx.fire.emit({ p: s.p, life: 0.1, size: [1.5, 5], c0: [3, 2.4, 1.4], c1: [2, 0.8, 0.15], a: 0.9, fadeIn: 0.005, drag: 0 });
    this.fx.smoke.emit({ p: s.p, life: R(2, 4), size: [1.5, 7], c0: [0.2, 0.2, 0.2], c1: [0.5, 0.5, 0.5], a: 0.5, fadeIn: 0.05, drag: 1, wind: 0.8 });
  }
  splash(s) {
    const p = s.p, k = s.heavy ? 2.5 : 0.7;
    for (let n = 0; n < (s.heavy ? 14 : 4); n++) this.fx.smoke.emit({ p: [p[0], 0.3, p[2]], v: [R(-2, 2), R(6, 16) * k * 0.6, R(-2, 2)], life: R(0.8, 1.6), size: [0.7 * k, 2.4 * k], c0: [0.95, 0.97, 1], c1: [0.85, 0.9, 0.95], a: 0.85, fadeIn: 0.02, drag: 0.4, acc: -9.8, land: true });
  }

  draw() {
    const N = MAX_SHELLS;
    for (let i = 0; i < N; i++) {
      const s = this.shells[i], j = i * 6;
      if (!s || s.heavy) { this.lp[j + 1] = this.lp[j + 4] = -1e5; this.hp[i * 3 + 1] = -1e5; continue; }       // the big shells are too small and fast to see
      const sp = Math.hypot(...s.v) || 1, len = Math.min(26, s.t * sp);
      this.lp[j] = s.p[0]; this.lp[j + 1] = s.p[1]; this.lp[j + 2] = s.p[2];
      for (let k = 0; k < 3; k++) this.lp[j + 3 + k] = s.p[k] - s.v[k] / sp * len;
      this.hp[i * 3] = s.p[0]; this.hp[i * 3 + 1] = s.p[1]; this.hp[i * 3 + 2] = s.p[2];
      const f = 1 - s.t / (s.life + 0.2);
      this.lc[j] = 2.4 * f; this.lc[j + 1] = 1.0 * f; this.lc[j + 2] = 0.3 * f; this.lc[j + 3] = 0.6 * f; this.lc[j + 4] = 0.2 * f; this.lc[j + 5] = 0.05 * f;       // red-orange tracers (the Bofors / Type 96 look)
    }
    const at = this.lines.geometry.attributes; at.position.needsUpdate = at.color.needsUpdate = true; this.dots.geometry.attributes.position.needsUpdate = true;
  }
}

function closest(a, b, p) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / l2));
  return [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
}
function segDist(a, b, p) { const c = closest(a, b, p); return Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]); }
