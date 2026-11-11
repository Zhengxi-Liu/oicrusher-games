/**
 * Effects - particles with a life of their own (size, colour and opacity over life, drag, buoyancy or
 * gravity, wind drift, rotation, a start delay) and the explosions built from them.
 *
 *   fire   additive flame puffs: white-hot core -> orange -> dull red, rising
 *   smoke  normal-blended billows: the fireball turns into black smoke that rises, spreads and drifts
 *   spark  additive embers on ballistic arcs that die on the ground
 *
 * explode(): flash (a point light + a short bright core), a fireball that rolls upward and turns into a
 * black mushroom of smoke, embers, a ground-hugging dust ring and dirt thrown out, or - in the sea -
 * a splash column, spray, mist and a spreading foam ring. Burning fragments trail fire and smoke.
 * WreckFire: the flames, flickering light and wind-blown smoke column of a burning wreck.
 */
import * as THREE from 'three';

function puffTex(core, blobs, seed) {
  let s = seed; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  for (let i = 0; i < blobs; i++) {                                   // lumpy billow, kept inside the circle so it can rotate
    const a = r() * Math.PI * 2, d = r() * 26, x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d, rad = 22 + r() * 18;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(255,255,255,${core})`); gr.addColorStop(0.6, `rgba(255,255,255,${core * 0.35})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }
  const img = g.getImageData(0, 0, 128, 128);                        // fine grain, and a soft round edge
  for (let i = 0; i < 128 * 128; i++) {
    const x = i % 128 - 64, y = (i / 128 | 0) - 64, e = Math.max(0, 1 - Math.hypot(x, y) / 62);
    img.data[i * 4 + 3] = img.data[i * 4 + 3] * Math.min(1, e * 2.2) * (0.82 + r() * 0.18);
  }
  g.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}

export class FxSystem {
  constructor(scene, n, { map, blending = THREE.NormalBlending, ground = null }) {
    this.n = n; this.next = 0; this.ground = ground;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3).fill(-1e5); this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n); this.alpha = new Float32Array(n); this.rot = new Float32Array(n);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1));
    const mat = new THREE.PointsMaterial({ size: 1, map, vertexColors: true, transparent: true, depthWrite: false, blending, sizeAttenuation: true });
    mat.onBeforeCompile = sh => {
      sh.vertexShader = 'attribute float aSize;\nattribute float aAlpha;\nattribute float aRot;\nvarying float vAlpha;\nvarying float vRot;\n' +
        sh.vertexShader.replace('gl_PointSize = size;', 'gl_PointSize = size * aSize; vAlpha = aAlpha; vRot = aRot;');
      sh.fragmentShader = 'varying float vAlpha;\nvarying float vRot;\n' + sh.fragmentShader
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse, opacity * vAlpha );')
        .replace('#include <map_particle_fragment>', `
          vec2 pc = gl_PointCoord - 0.5; float cr = cos(vRot), sr = sin(vRot);
          vec2 uv = vec2(cr * pc.x - sr * pc.y, sr * pc.x + cr * pc.y) + 0.5; uv.y = 1.0 - uv.y;
          #ifdef USE_MAP
            diffuseColor *= texture2D( map, uv );
          #endif`);
    };
    this.pts = new THREE.Points(geo, mat);
    this.pts.frustumCulled = false; this.pts.renderOrder = 2;
    scene.add(this.pts);
    // per particle: velocity, age/life/delay, size and colour ramps, physics
    this.vel = new Float32Array(n * 3); this.age = new Float32Array(n); this.life = new Float32Array(n); this.delay = new Float32Array(n);
    this.s0 = new Float32Array(n); this.s1 = new Float32Array(n); this.c0 = new Float32Array(n * 3); this.c1 = new Float32Array(n * 3);
    this.a0 = new Float32Array(n); this.fadeIn = new Float32Array(n); this.drag = new Float32Array(n); this.acc = new Float32Array(n);
    this.windK = new Float32Array(n); this.spin = new Float32Array(n); this.land = new Uint8Array(n);
  }

  /** p, v: [x, y, z]; size: [start, end] metres; c0 / c1: start / end colour; a: peak opacity. */
  emit({ p, v = [0, 0, 0], life = 1, delay = 0, size = [1, 1], c0 = [1, 1, 1], c1 = c0, a = 1, fadeIn = 0.05, drag = 0.5, acc = 0, wind = 0, spin = 0, land = false }) {
    const i = this.next; this.next = (i + 1) % this.n;
    this.pos.set(delay > 0 ? [-1e5, -1e5, -1e5] : p, i * 3); this.vel.set(v, i * 3);
    if (delay > 0) (this.pending = this.pending || new Map()).set(i, p.slice());   // placed when it appears
    else if (this.pending) this.pending.delete(i);
    this.age[i] = -delay; this.life[i] = life; this.delay[i] = delay;
    this.s0[i] = size[0]; this.s1[i] = size[1]; this.c0.set(c0, i * 3); this.c1.set(c1, i * 3);
    this.a0[i] = a; this.fadeIn[i] = fadeIn; this.drag[i] = drag; this.acc[i] = acc; this.windK[i] = wind;
    this.rot[i] = Math.random() * 6.283; this.spin[i] = (Math.random() - 0.5) * 2 * spin; this.land[i] = land ? 1 : 0;
    this.alpha[i] = 0; this.size[i] = size[0];
  }

  step(dt, wind = [0, 0, 0]) {
    const P = this.pos, V = this.vel;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.age[i] += dt;
      if (this.age[i] < 0) continue;                                   // still waiting to appear
      if (this.pending && this.pending.has(i)) { P.set(this.pending.get(i), i * 3); this.pending.delete(i); }
      const k = this.age[i] / this.life[i];
      if (k >= 1) { this.life[i] = 0; this.alpha[i] = 0; P[i * 3 + 1] = -1e5; continue; }
      const dk = Math.exp(-this.drag[i] * dt), j = i * 3;
      V[j] *= dk; V[j + 1] = V[j + 1] * dk + this.acc[i] * dt; V[j + 2] *= dk;
      P[j] += (V[j] + wind[0] * this.windK[i]) * dt; P[j + 1] += V[j + 1] * dt; P[j + 2] += (V[j + 2] + wind[2] * this.windK[i]) * dt;
      if (this.land[i] && this.ground) {                               // embers and clods stop on the ground
        const g = Math.max(0, this.ground(P[j], P[j + 2]));
        if (P[j + 1] < g + 0.1) { P[j + 1] = g + 0.1; V[j] *= 0.3; V[j + 1] = 0; V[j + 2] *= 0.3; if (this.land[i] === 1) this.age[i] = Math.max(this.age[i], this.life[i] * 0.85); this.land[i] = 2; }
      }
      const e = 1 - (1 - k) * (1 - k);
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * e;
      for (let a = 0; a < 3; a++) this.col[j + a] = this.c0[j + a] + (this.c1[j + a] - this.c0[j + a]) * k;
      this.alpha[i] = this.a0[i] * Math.min(1, this.age[i] / Math.max(1e-3, this.fadeIn[i])) * (1 - k) * (1 - k * 0.3);
      this.rot[i] += this.spin[i] * dt;
    }
    const at = this.pts.geometry.attributes;
    at.position.needsUpdate = at.color.needsUpdate = at.aSize.needsUpdate = at.aAlpha.needsUpdate = at.aRot.needsUpdate = true;
  }

  clear() { this.life.fill(0); this.alpha.fill(0); this.pos.fill(-1e5); if (this.pending) this.pending.clear(); }
}

const R = (a, b) => a + Math.random() * (b - a);
function sphereDir() { const u = R(-1, 1), a = R(0, Math.PI * 2), s = Math.sqrt(1 - u * u); return [s * Math.cos(a), u, s * Math.sin(a)]; }

export class Effects {
  constructor(scene, ground) {
    this.scene = scene; this.ground = ground;
    this.fire = new FxSystem(scene, 2400, { map: puffTex(1, 7, 3), blending: THREE.AdditiveBlending });
    this.smoke = new FxSystem(scene, 3200, { map: puffTex(0.9, 10, 7), ground });
    this.spark = new FxSystem(scene, 1200, { map: puffTex(1, 2, 11), blending: THREE.AdditiveBlending, ground });
    this.flashes = []; this.trails = []; this.rings = []; this.wrecks = [];
    this.wind = [0, 0, 0];
    // two point lights that always exist (adding lights later would recompile every lit material mid-crash)
    this.flashLight = new THREE.PointLight(0xffb060, 0, 700, 1.6);
    this.wreckLight = new THREE.PointLight(0xff8a3a, 0, 160, 1.4);
    scene.add(this.flashLight, this.wreckLight);
  }

  /**
   * An aircraft blowing up at p with velocity v. violence 0..1 (impact speed), fuel ~0.6 (light aircraft)
   * .. 1.6 (a heavy jet), water: hit the sea, air: blew up well above the ground (no dust ring).
   */
  explode(p, v, { violence = 1, fuel = 1, water = false } = {}) {
    const gh = Math.max(0, this.ground(p[0], p[2])), low = p[1] - gh < 12;
    const carry = [v[0] * 0.18, low ? Math.abs(v[1]) * 0.1 : v[1] * 0.18, v[2] * 0.18];
    const scale = (0.6 + violence * 0.6) * Math.sqrt(fuel);
    if (water) return this.splash(p, v, scale);
    // flash: a real light for a moment, and a blinding core
    this.flashLight.position.set(p[0], p[1] + 4, p[2]);
    this.flashes = [{ t: 0, life: 0.9, peak: 9000 * scale }];
    this.fire.emit({ p: [p[0], p[1] + 2, p[2]], life: 0.22, size: [10 * scale, 34 * scale], c0: [3, 2.6, 2], c1: [2, 1, 0.3], a: 1, fadeIn: 0.01, drag: 0 });
    // the fireball: rolling, buoyant flame puffs; each leaves black smoke behind as it burns out
    const nFire = Math.round(70 * scale);
    for (let k = 0; k < nFire; k++) {
      const d = sphereDir(); if (low) d[1] = Math.abs(d[1]) * 0.8 + 0.2;
      const sp = R(4, 16) * scale, life = R(0.8, 1.9);
      const q = [p[0] + d[0] * R(0, 3), Math.max(gh + 0.5, p[1] + d[1] * R(0, 3)), p[2] + d[2] * R(0, 3)];
      const vel = [d[0] * sp + carry[0], d[1] * sp + carry[1] + 3, d[2] * sp + carry[2]];
      this.fire.emit({ p: q, v: vel, life, size: [R(3, 6) * scale, R(12, 22) * scale], c0: [2.6, R(1.5, 1.9), 0.7], c1: [0.5, 0.08, 0.01], a: 0.9, fadeIn: 0.04, drag: 2.2, acc: 7, wind: 0.2, spin: 1.5 });
      this.smoke.emit({ p: q, v: [vel[0] * 0.5, vel[1] * 0.5 + 2, vel[2] * 0.5], life: R(7, 12), delay: life * 0.55, size: [R(6, 9) * scale, R(26, 40) * scale],
                        c0: [0.05, 0.045, 0.04], c1: [0.3, 0.29, 0.28], a: 0.85, fadeIn: 0.5, drag: 1.1, acc: 2.5, wind: 0.9, spin: 0.3 });
    }
    // the mushroom: a column of black smoke punching up through the fireball
    for (let k = 0; k < 30 * scale; k++)
      this.smoke.emit({ p: [p[0] + R(-3, 3), Math.max(gh, p[1]) + R(0, 4), p[2] + R(-3, 3)], v: [R(-2, 2), R(10, 20) * scale, R(-2, 2)], life: R(8, 14), delay: R(0.2, 1.4),
                        size: [8 * scale, R(30, 46) * scale], c0: [0.06, 0.055, 0.05], c1: [0.34, 0.33, 0.32], a: 0.8, fadeIn: 0.6, drag: 0.9, acc: 1, wind: 1, spin: 0.25 });
    // embers / bits of burning metal on ballistic arcs
    for (let k = 0; k < 110 * scale; k++) {
      const d = sphereDir(); if (low) d[1] = Math.abs(d[1]);
      const sp = R(12, 45) * (0.6 + violence * 0.5);
      this.spark.emit({ p: [p[0], Math.max(gh + 0.3, p[1]), p[2]], v: [d[0] * sp + carry[0] * 2, d[1] * sp + 4, d[2] * sp + carry[2] * 2], life: R(1, 2.6),
                        size: [R(0.5, 0.9), 0.3], c0: [3, 1.8, 0.7], c1: [1.2, 0.25, 0.02], a: 1, fadeIn: 0.01, drag: 0.5, acc: -9.8, land: true });
    }
    // a few big burning pieces that arc away trailing fire and smoke
    for (let k = 0; k < 2 + violence * 2.5; k++) {
      const d = sphereDir(); d[1] = Math.abs(d[1]) * 0.9 + 0.4;
      const sp = R(10, 24) * (0.5 + violence * 0.5);
      this.trails.push({ p: [p[0], Math.max(gh + 1, p[1]) + 1, p[2]], v: [d[0] * sp + carry[0], d[1] * sp, d[2] * sp + carry[2]], t: 0, life: R(1.2, 2.4) });
    }
    if (low) {
      // dust thrown up and rolling out along the ground, clods of earth
      for (let k = 0; k < 46 * scale; k++) {
        const a = R(0, Math.PI * 2), sp = R(14, 34) * (0.5 + violence * 0.5);
        this.smoke.emit({ p: [p[0] + Math.cos(a) * 2, gh + 1.5, p[2] + Math.sin(a) * 2], v: [Math.cos(a) * sp, R(1, 4), Math.sin(a) * sp], life: R(3.5, 6),
                          size: [R(4, 7), R(16, 26) * scale], c0: [0.42, 0.36, 0.27], c1: [0.6, 0.56, 0.5], a: 0.55, fadeIn: 0.1, drag: 1.8, acc: 0.3, wind: 0.6, spin: 0.4 });
      }
      for (let k = 0; k < 50 * violence; k++) {
        const d = sphereDir(); d[1] = Math.abs(d[1]) * 1.2 + 0.4;
        const sp = R(8, 26);
        this.smoke.emit({ p: [p[0], gh + 0.5, p[2]], v: [d[0] * sp, d[1] * sp, d[2] * sp], life: R(1.5, 3), size: [R(0.6, 1.4), 0.8], c0: [0.12, 0.09, 0.06], c1: [0.12, 0.09, 0.06], a: 1, fadeIn: 0.01, drag: 0.3, acc: -9.8, land: true });
      }
    }
  }

  splash(p, v, scale) {
    const sp = Math.hypot(v[0], v[2]);
    for (let k = 0; k < 220 * scale; k++) {                            // the splash column and its spray
      const a = R(0, Math.PI * 2), r = R(0, 6), up = R(8, 34) * scale;
      this.smoke.emit({ p: [p[0] + Math.cos(a) * r, 0.3, p[2] + Math.sin(a) * r], v: [Math.cos(a) * R(2, 9) + v[0] * 0.12, up, Math.sin(a) * R(2, 9) + v[2] * 0.12], life: R(1.4, 3),
                        size: [R(1.5, 3), R(5, 9)], c0: [0.95, 0.97, 1], c1: [0.85, 0.9, 0.95], a: 0.85, fadeIn: 0.02, drag: 0.4, acc: -9.8, land: true });
    }
    for (let k = 0; k < 60 * scale; k++)                                // mist hanging over the water
      this.smoke.emit({ p: [p[0] + R(-8, 8), R(1, 6), p[2] + R(-8, 8)], v: [R(-4, 4) + v[0] * 0.05, R(0.5, 3), R(-4, 4) + v[2] * 0.05], life: R(4, 7), delay: R(0, 0.6),
                        size: [6, R(20, 32) * scale], c0: [0.9, 0.93, 0.96], c1: [0.8, 0.84, 0.88], a: 0.35, fadeIn: 0.4, drag: 1, acc: 0.3, wind: 1, spin: 0.3 });
    // a foam ring spreading on the surface, stretched along the direction of travel
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 1, 48), new THREE.MeshBasicMaterial({ color: 0xf2f6f8, transparent: true, opacity: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(p[0], 0.15, p[2]); this.scene.add(ring);
    this.rings.push({ mesh: ring, t: 0, life: 9, size: (24 + sp * 0.3) * scale });
  }

  /** A burning wreck at pos for `secs`; move it with w.pos (the fire follows the main piece of wreckage). */
  wreckFire(pos, { scale = 1, secs = 45, light = true } = {}) {
    const w = { pos: pos.slice(), light, t: 0, life: secs, scale };
    this.wrecks.push(w);
    return w;
  }

  /** Fire and smoke from a burning thing at p (a tumbling fragment): rate 0..1. */
  burn(p, rate, scale = 1) {
    if (Math.random() < 0.6 * rate) this.fire.emit({ p: [p[0] + R(-0.5, 0.5), p[1] + 0.3, p[2] + R(-0.5, 0.5)], v: [R(-1, 1), R(2, 4), R(-1, 1)], life: R(0.4, 0.8), size: [R(1, 2) * scale, R(2.5, 4) * scale],
                                                c0: [2.4, 1.4, 0.5], c1: [0.6, 0.1, 0.01], a: 0.85, fadeIn: 0.05, drag: 1.5, acc: 5, wind: 0.4, spin: 2 });
    if (Math.random() < 0.3 * rate) this.smoke.emit({ p: [p[0], p[1] + 1, p[2]], v: [R(-0.5, 0.5), R(3, 5), R(-0.5, 0.5)], life: R(5, 8), size: [R(2, 3) * scale, R(10, 16) * scale],
                                                      c0: [0.07, 0.065, 0.06], c1: [0.3, 0.3, 0.3], a: 0.7, fadeIn: 0.3, drag: 0.8, acc: 0.8, wind: 1, spin: 0.3 });
  }

  update(dt, wind) {
    this.wind = wind || this.wind;
    for (const f of this.flashes) { f.t += dt; const k = f.t / f.life; this.flashLight.intensity = k < 1 ? f.peak * Math.pow(1 - k, 3) * (0.8 + Math.random() * 0.4) : 0; }
    this.flashes = this.flashes.filter(f => f.t < f.life);
    let lit = null;
    for (const t of this.trails) {                                      // burning pieces: ballistic, trailing smoke
      t.t += dt; t.v[1] -= 9.8 * dt;
      for (let a = 0; a < 3; a++) t.p[a] += t.v[a] * dt;
      const g = Math.max(0, this.ground(t.p[0], t.p[2]));
      if (t.p[1] < g) { t.p[1] = g; t.v = [0, 0, 0]; }
      const k = 1 - t.t / t.life;
      this.fire.emit({ p: t.p.slice(), v: [0, 1, 0], life: 0.3, size: [2.2 * k + 0.6, 3.5 * k + 0.6], c0: [2.4, 1.3, 0.4], c1: [0.6, 0.1, 0], a: 0.8, fadeIn: 0.02, drag: 1, wind: 0.2 });
      if (Math.random() < 0.5) this.smoke.emit({ p: t.p.slice(), v: [0, 1.5, 0], life: R(2.5, 4), size: [3, R(9, 14)], c0: [0.1, 0.095, 0.09], c1: [0.4, 0.4, 0.4], a: 0.35 * k + 0.08, fadeIn: 0.15, drag: 1, acc: 0.6, wind: 0.8, spin: 0.4 });
    }
    this.trails = this.trails.filter(t => t.t < t.life);
    for (const r of this.rings) {
      r.t += dt; const k = r.t / r.life;
      r.mesh.scale.setScalar(2 + r.size * Math.sqrt(k)); r.mesh.material.opacity = 0.7 * (1 - k);
      if (k >= 1) { this.scene.remove(r.mesh); r.mesh.geometry.dispose(); }
    }
    this.rings = this.rings.filter(r => r.t < r.life);
    for (const w of this.wrecks) {                                      // a burning wreck: flames, flicker, the smoke column
      w.t += dt;
      if (w.moving) continue;
      const fade = Math.max(0, Math.min(1, (w.life - w.t) / 12)), s = w.scale;
      if (w.light) lit = { w, i: fade * (110 + Math.random() * 90) * s };
      if (Math.random() < 0.9 * fade) this.fire.emit({ p: [w.pos[0] + R(-3, 3) * s, w.pos[1] + R(0, 1), w.pos[2] + R(-3, 3) * s], v: [R(-1, 1), R(3, 6), R(-1, 1)], life: R(0.5, 1.1),
                                                        size: [R(2, 3.5) * s, R(4, 7) * s], c0: [2.6, 1.5, 0.5], c1: [0.6, 0.08, 0.01], a: 0.85, fadeIn: 0.06, drag: 1.6, acc: 6, wind: 0.35, spin: 2 });
      if (Math.random() < 0.2 * fade) this.smoke.emit({ p: [w.pos[0] + R(-2, 2), w.pos[1] + 3, w.pos[2] + R(-2, 2)], v: [R(-1, 1), R(5, 8), R(-1, 1)], life: R(14, 22),
                                                          size: [R(4, 6) * s, R(30, 48) * s], c0: [0.06, 0.055, 0.05], c1: [0.36, 0.36, 0.37], a: 0.6, fadeIn: 0.8, drag: 0.5, acc: 0.4, wind: 0.85, spin: 0.15 });
    }
    this.wrecks = this.wrecks.filter(w => w.t <= w.life);
    this.wreckLight.intensity = lit ? lit.i : 0;
    if (lit) this.wreckLight.position.set(lit.w.pos[0], lit.w.pos[1] + 3, lit.w.pos[2]);
    this.fire.step(dt, this.wind); this.smoke.step(dt, this.wind); this.spark.step(dt, this.wind);
  }

  clear() {
    for (const r of this.rings) this.scene.remove(r.mesh);
    this.flashLight.intensity = this.wreckLight.intensity = 0;
    this.flashes = []; this.trails = []; this.rings = []; this.wrecks = [];
    this.fire.clear(); this.smoke.clear(); this.spark.clear();
  }
}
