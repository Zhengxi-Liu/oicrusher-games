/**
 * Missiles - every air-to-air missile and flare in the sky, flown with MissileSim.js and drawn here.
 *
 * Who decides: every browser flies every missile from the same launch state, but only the browser of
 * the pilot it was fired at (`auth`) decides whether it hit - against its own exact position and its
 * own flares - and tells the others (main.js sends 'mslEnd'). Everyone else's copy is for show and is
 * snapped to that verdict when it arrives.
 *
 * Drawn: the missile (PlaneModel.buildMissile), a white-hot motor plume and a smoke trail while the
 * motor burns (4 s), flares as blinding magnesium points with a smoke trail, the warhead's blast.
 */
import * as THREE from 'three';
import { Missile, Flare } from './MissileSim.js?v=3';
import { buildMissile } from './PlaneModel.js?v=19';

const SUB = 1 / 120;                 // missile physics step (a fuse at Mach 2.5 needs it)
const R = (a, b) => a + Math.random() * (b - a);

function glowTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,248,225,.95)'); gr.addColorStop(0.45, 'rgba(255,190,90,.35)'); gr.addColorStop(1, 'rgba(255,140,40,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Missiles {
  /** opts: ground(x, z), audio, camera */
  constructor(scene, fx, opts) {
    this.scene = scene; this.fx = fx; this.opts = opts;
    this.list = [];                  // {sim, mesh, plume, key, mine, auth, name, ended}
    this.flares = [];                // {f: Flare, sprite, own}
    this.flareId = 1;
    this.glow = glowTex();
  }
  key(from, mid) { return `${from}:${mid}`; }
  get(from, mid) { return this.list.find(m => m.key === this.key(from, mid)); }

  /** A missile leaves the rail. m: {mid, from, tg, p, v, d, name}; mine: we fired it; auth: it was fired at us. */
  launch(m, { mine = false, auth = false } = {}) {
    if (this.get(m.from, m.mid)) return null;
    const sim = new Missile(m);
    const mesh = buildMissile(sim.k);
    const plume = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: 0xfff2d8, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    plume.scale.set(3, 3, 1); mesh.add(plume); plume.position.z = 1.7;
    this.scene.add(mesh);
    const e = { sim, mesh, plume, key: this.key(m.from, m.mid), mine, auth, name: m.name || '', ended: false, prev: m.p.slice() };
    this.place(e);
    this.list.push(e);
    // the motor lights: a flash and a puff of smoke off the rail
    for (let k = 0; k < 14; k++) this.fx.smoke.emit({ p: m.p, v: [m.v[0] * 0.5 + R(-4, 4), m.v[1] * 0.5 + R(-4, 4), m.v[2] * 0.5 + R(-4, 4)], life: R(1.5, 3), size: [1.2, R(4, 7)], c0: [0.92, 0.92, 0.9], c1: [0.8, 0.8, 0.8], a: 0.6, fadeIn: 0.02, drag: 2, wind: 0.6, spin: 0.5 });
    if (this.opts.audio) this.opts.audio.missileLaunch(this.dist(m.p));
    return e;
  }

  /** A flare out of a dispenser at p with velocity v; own = ours (it can decoy missiles fired at us). */
  flare(p, v, own) {
    const f = new Flare(this.flareId++, p, v);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    sprite.position.set(...p); this.scene.add(sprite);
    this.flares.push({ f, sprite, own });
    if (own && this.opts.audio) this.opts.audio.flare();
  }

  dist(p) { const c = this.opts.camera.position; return Math.hypot(p[0] - c.x, p[1] - c.y, p[2] - c.z); }
  place(e) {
    const s = e.sim, v = s.v, l = Math.hypot(...v) || 1;
    e.mesh.position.set(...s.p);
    e.mesh.lookAt(s.p[0] - v[0] / l, s.p[1] - v[1] / l, s.p[2] - v[2] / l);   // the model's nose is -z, lookAt points +z
  }

  /**
   * Advance everything by dt. target(id) -> {p, v, fwd, type, engine} | null.
   * Returns the missiles that ended here this frame: [{e, ev}] (ev = MissileSim end event).
   */
  update(dt, target) {
    for (let i = this.flares.length - 1; i >= 0; i--) {
      const fl = this.flares[i], f = fl.f;
      const alive = f.step(dt);
      const I = f.I, flick = 0.8 + Math.random() * 0.4;
      fl.sprite.position.set(...f.p);
      fl.sprite.scale.setScalar((4 + 10 * I) * flick);
      fl.sprite.material.opacity = Math.min(1, I * 1.6);
      if (Math.random() < 0.25) this.fx.smoke.emit({ p: f.p.slice(), v: [R(-0.5, 0.5), R(0, 1), R(-0.5, 0.5)], life: R(2.5, 4.5), size: [0.8, R(3, 5)], c0: [0.95, 0.95, 0.94], c1: [0.78, 0.78, 0.8], a: 0.5 * Math.min(1, I + 0.2), fadeIn: 0.05, drag: 1, acc: 0.2, wind: 1, spin: 0.4 });
      if (!alive) { this.scene.remove(fl.sprite); fl.sprite.material.dispose(); this.flares.splice(i, 1); }
    }
    const flares = this.flares.map(x => x.f);
    const out = [];
    for (const e of this.list) {
      if (e.ended) continue;
      const s = e.sim, env = { target: () => (s.tg ? target(s.tg) : null), flares, ground: this.opts.ground, shield: this.opts.shield };
      let ev = null;
      const from = s.p.slice();
      for (let t = 0; t < dt - 1e-6 && !ev; t += SUB) ev = s.step(Math.min(SUB, dt - t), env);
      this.place(e);
      // motor plume and the smoke trail, laid along this frame's path
      const burn = s.burning;
      e.plume.visible = burn && !ev;
      if (burn) {
        e.plume.material.opacity = 0.75 + Math.random() * 0.25;
        e.plume.scale.setScalar(2.4 + Math.random() * 1.2);
        const n = Math.min(4, 1 + Math.round(Math.hypot(s.p[0] - from[0], s.p[1] - from[1], s.p[2] - from[2]) / 14));
        for (let k = 0; k < n; k++) {
          const f = k / n, p = [from[0] + (s.p[0] - from[0]) * f, from[1] + (s.p[1] - from[1]) * f, from[2] + (s.p[2] - from[2]) * f];
          this.fx.smoke.emit({ p, v: [R(-0.6, 0.6), R(-0.3, 0.6), R(-0.6, 0.6)], life: R(2, 4), size: [0.9, R(3, 4.5)], c0: [0.93, 0.93, 0.92], c1: [0.82, 0.82, 0.84], a: 0.3, fadeIn: 0.03, drag: 0.8, acc: 0.1, wind: 1, spin: 0.3 });
        }
        this.fx.fire.emit({ p: s.p.slice(), v: [-s.v[0] * 0.02, -s.v[1] * 0.02, -s.v[2] * 0.02], life: 0.05, size: [1.2, 0.6], c0: [3, 2.6, 2], c1: [2, 1, 0.3], a: 1, fadeIn: 0.005, drag: 0 });
      }
      if (ev) { this.finish(e, ev); out.push({ e, ev }); }
    }
    this.list = this.list.filter(e => !e.ended || (e.gone = (e.gone || 0) + dt) < 1);
    return out;
  }

  /** The missile ends (here, or as another browser decided): the warhead goes off / it hits the ground / self-destructs. */
  finish(e, ev) {
    if (e.ended) return;
    e.ended = true;
    this.scene.remove(e.mesh);
    const p = ev.p, v = e.sim.v.map(x => x * 0.15);
    if (ev.water) this.fx.splash([p[0], 0, p[2]], v, 0.35);
    else {
      this.fx.explode(p, v, { violence: 0.35, fuel: 0.22 });
      for (let k = 0; k < 90; k++) {                              // the fragment ring: a flat disc of hot steel rods
        const a = R(0, Math.PI * 2), sp = R(120, 260), ax = e.sim.v.map(x => x / (e.sim.speed || 1));
        let d = [Math.cos(a), R(-0.15, 0.15), Math.sin(a)];
        const dd = d[0] * ax[0] + d[1] * ax[1] + d[2] * ax[2]; d = [d[0] - ax[0] * dd, d[1] - ax[1] * dd, d[2] - ax[2] * dd];
        this.fx.spark.emit({ p: p.slice(), v: [d[0] * sp + v[0], d[1] * sp + v[1], d[2] * sp + v[2]], life: R(0.15, 0.35), size: [0.6, 0.2], c0: [3, 2.4, 1.6], c1: [1.5, 0.5, 0.1], a: 1, fadeIn: 0.005, drag: 3 });
      }
    }
    if (this.opts.audio) this.opts.audio.boom(this.dist(p));
    if (e.mine && ev.kind === 'ground' && this.opts.onImpact) this.opts.onImpact(e, ev);     // the pilot who fired it reports the crater
  }

  /** Another browser (the target's) decided how this missile ended. */
  external(from, mid, ev) {
    const e = this.get(from, mid);
    if (!e || e.ended) return e || null;
    e.sim.done = ev;
    this.finish(e, ev);
    return e;
  }

  /** Live missiles fired at pilot id. */
  incoming(id) { return this.list.filter(e => !e.ended && e.sim.tg === id); }

  clear() {
    for (const e of this.list) this.scene.remove(e.mesh);
    for (const f of this.flares) this.scene.remove(f.sprite);
    this.list = []; this.flares = [];
  }
}
