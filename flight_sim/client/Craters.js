/**
 * Craters - what bombs and missiles leave behind, and the blast that makes it.
 *
 * The damage itself is FSDamage.DamageField (shared/Damage.js): a height function added to the terrain by
 * HeightField.at(), so the aircraft's wheels, the birds and everything else already stand on the crater floor.
 * This file draws exactly that surface:
 *   - one pooled mesh (400 slots, one draw call): every crater is a polar grid whose heights come from
 *     field.at() - the same function the physics uses - coloured soil / sand / rock / broken asphalt, scorched
 *     black in the middle, fading into the terrain colour at the edge. The terrain and runway meshes cut a hole
 *     under the nearest 48 craters (TerrainGenerator.cutHoles) so the bowl shows instead of the coarse grid.
 *   - one instanced mesh of debris (28 pieces a crater): asphalt slabs on a runway, clods, boulders on rock
 *   - trees felled / burnt / blown over, buildings, lights and PAPI lamps destroyed (TerrainGenerator)
 *   - the temporary part: fireball, mushroom, dust and clods of the right colour; on water a splash column, rings
 *     rolling outward over many seconds, a patch of foam and mist (nothing of it stays)
 */
import * as THREE from 'three';

const DM = window.FSDamage, RW = window.FSWorld.RUNWAY;
const SLOTS = 400, NS = 32, NR = 14, VPC = 1 + NR * NS, TPC = NS + (NR - 1) * NS * 2, DEB = 28;
const R = (a, b) => a + Math.random() * (b - a);
const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const SOOT = [0.04, 0.035, 0.03];
const BASE = {            // [bowl, rim] colours
  soil: [[0.17, 0.12, 0.08], [0.40, 0.31, 0.21]], sand: [[0.42, 0.36, 0.26], [0.68, 0.60, 0.44]],
  rock: [[0.24, 0.23, 0.22], [0.42, 0.40, 0.38]], pavement: [[0.30, 0.30, 0.32], [0.27, 0.27, 0.29]],
};
const DUST = { soil: [0.36, 0.29, 0.21], sand: [0.74, 0.66, 0.5], rock: [0.52, 0.5, 0.48], pavement: [0.56, 0.56, 0.56] };

export class Craters {
  /** opts: { audio, dist(p) -> metres to the camera } */
  constructor(scene, world, field, fx, opts = {}) {
    this.scene = scene; this.world = world; this.field = field; this.fx = fx; this.opts = opts;
    this.dmg = field.dmg = new DM.DamageField();
    this.slot = new Map();               // crater id -> slot
    this.used = 0; this.holeT = 0; this.fires = []; this.ripples = []; this.foam = [];
    const pos = new Float32Array(SLOTS * VPC * 3).fill(0), col = new Float32Array(SLOTS * VPC * 3), nor = new Float32Array(SLOTS * VPC * 3), uv = new Float32Array(SLOTS * VPC * 2);
    const idx = new Uint32Array(SLOTS * TPC * 3);
    for (let s = 0; s < SLOTS; s++) {
      const v0 = s * VPC;
      let k = s * TPC * 3;
      for (let j = 0; j < NS; j++) { idx[k++] = v0; idx[k++] = v0 + 1 + (j + 1) % NS; idx[k++] = v0 + 1 + j; }                 // centre fan (faces up)
      for (let r = 0; r < NR - 1; r++) for (let j = 0; j < NS; j++) {
        const a = v0 + 1 + r * NS + j, b = v0 + 1 + r * NS + (j + 1) % NS, c = a + NS, d = b + NS;
        idx[k++] = a; idx[k++] = b; idx[k++] = c; idx[k++] = b; idx[k++] = d; idx[k++] = c;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.setDrawRange(0, 0);
    this.geo = geo;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: world.terrainDetail, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.mesh = new THREE.Mesh(geo, mat); this.mesh.frustumCulled = false; this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    // debris
    const dmat = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true });
    this.debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), dmat, SLOTS * DEB);
    this.debris.frustumCulled = false; this.debris.receiveShadow = true; this.debris.count = 0;
    const z = new THREE.Matrix4().makeScale(0, 0, 0), c0 = new THREE.Color(0.3, 0.3, 0.3);
    for (let i = 0; i < SLOTS * DEB; i++) { this.debris.setMatrixAt(i, z); this.debris.setColorAt(i, c0); }
    scene.add(this.debris);
    // foam / ripple geometry shared by the water effects
    this.ringGeo = new THREE.RingGeometry(0.92, 1, 64);
    this._c = [0, 0, 0]; this._m = new THREE.Matrix4(); this._o = new THREE.Object3D();
  }

  // ---------- the persistent part
  clear() {
    this.dmg.clear(); this.slot.clear(); this.used = 0; this.geo.setDrawRange(0, 0); this.debris.count = 0;
    this.world.restoreAll(); this.updateHoles(null, true);
    this.fires.length = 0;
  }
  /** Load a whole list (a joining player, or after a reset). */
  loadAll(list) { this.clear(); for (const r of list || []) this.apply(r, { fresh: false }); }

  /** Add or update a crater: height field, mesh, debris, and whatever it destroys. */
  apply(rec, { fresh = false } = {}) {
    const c = this.dmg.add(rec);
    let s = this.slot.get(rec.id);
    if (s === undefined) { if (this.used >= SLOTS) return c; s = this.used++; this.slot.set(rec.id, s); }
    // the ground changed here: refresh this crater and every neighbour whose surface it touches
    for (const [id, sl] of this.slot) { const o = this.dmg.byId.get(id); if (o && (o === c || Math.hypot(o.x - c.x, o.z - c.z) < o.Ri + c.Ri)) this.fill(sl, o); }
    this.geo.setDrawRange(0, this.used * TPC * 3);
    this.debrisFor(s, c);
    this.destroyAround(c, fresh);
    this.updateHoles(null, true);
    return c;
  }

  /** Rebuild one slot's polar grid from the (damaged) ground. */
  fill(slot, c) {
    const pos = this.geo.attributes.position.array, col = this.geo.attributes.color.array, nor = this.geo.attributes.normal.array, uv = this.geo.attributes.uv.array, f = this.field, w = this.world;
    const bias = 0.03 + (slot % 7) * 0.006, tc = this._c, base = BASE[c.mat] || BASE.soil, pave = c.mat === 'pavement';
    const e = 0.6;
    for (let k = 0; k <= NR; k++) {
      const r = c.Ri * Math.pow(k / NR, 1.5), cnt = k === 0 ? 1 : NS;
      for (let j = 0; j < cnt; j++) {
        const th = j / NS * Math.PI * 2, x = c.x + Math.cos(th) * r, z = c.z + Math.sin(th) * r;
        const vi = slot * VPC + (k === 0 ? 0 : 1 + (k - 1) * NS + j), y = f.at(x, z) + bias;
        pos[vi * 3] = x; pos[vi * 3 + 1] = y; pos[vi * 3 + 2] = z; uv[vi * 2] = x / 40; uv[vi * 2 + 1] = z / 40;
        const dx = f.at(x + e, z) - f.at(x - e, z), dz = f.at(x, z + e) - f.at(x, z - e), nl = Math.hypot(dx, 2 * e, dz);
        nor[vi * 3] = -dx / nl; nor[vi * 3 + 1] = 2 * e / nl; nor[vi * 3 + 2] = -dz / nl;
        // colour
        const Re = c.R * (1 + 0.10 * Math.sin(3 * th + c.a) + 0.06 * Math.sin(5 * th + c.b)), p = r / Re;
        const onPave = pave && Math.abs(x - RW.x) <= RW.width / 2 + 5 && z <= RW.z0 + 30 && z >= RW.z1 - 30;
        const set = onPave ? BASE.pavement : pave ? BASE.soil : base;
        const t = onPave ? 0.5 : smooth(0.6, 1.5, p), soot = Math.exp(-p * p / 3.2) * (c.w === 'msl' ? 0.9 : 0.8);
        w.terrainColor(x, z, tc);
        const edge = smooth(1.9, 2.7, p), n = 0.9 + 0.2 * DM.hash2(Math.floor(x * 1.7), Math.floor(z * 1.7), c.seed);
        for (let a = 0; a < 3; a++) {
          let v = (set[0][a] + (set[1][a] - set[0][a]) * t) * n;
          v = v * (1 - soot) + SOOT[a] * soot;
          col[vi * 3 + a] = v * (1 - edge) + tc[a] * edge;
        }
      }
    }
    this.geo.attributes.position.needsUpdate = this.geo.attributes.color.needsUpdate = this.geo.attributes.normal.needsUpdate = this.geo.attributes.uv.needsUpdate = true;
  }

  /** The 28 pieces of rubble round a crater (deterministic from its seed, so everyone sees the same). */
  debrisFor(slot, c) {
    const rnd = DM.rng(c.seed * 7 + c.v), o = this._o, mesh = this.debris, pave = c.mat === 'pavement', rock = c.mat === 'rock';
    const n = Math.min(DEB, Math.round((pave ? c.R * 5 : rock ? c.R * 6 : c.R * 2.5) + 4)), col = new THREE.Color();
    for (let i = 0; i < DEB; i++) {
      const k = slot * DEB + i;
      if (i >= n) { o.scale.setScalar(0); o.updateMatrix(); mesh.setMatrixAt(k, o.matrix); continue; }
      const th = rnd() * Math.PI * 2, r = c.R * (0.95 + 1.5 * Math.pow(rnd(), 1.3)), x = c.x + Math.cos(th) * r, z = c.z + Math.sin(th) * r;
      const big = 0.5 + Math.min(1.5, c.R / 8), sz = pave ? [R(0.8, 2.2) * big, R(0.12, 0.3), R(0.6, 1.6) * big] : rock ? [R(0.6, 2.0) * big, R(0.5, 1.4) * big, R(0.6, 1.8) * big] : [R(0.3, 0.9) * big, R(0.2, 0.5) * big, R(0.3, 0.9) * big];
      o.position.set(x, this.field.at(x, z) + sz[1] * 0.3, z);
      o.rotation.set(pave ? (rnd() - 0.5) * 0.7 : rnd() * 3, rnd() * 6.28, pave ? (rnd() - 0.5) * 0.7 : rnd() * 3);
      o.scale.set(...sz); o.updateMatrix(); mesh.setMatrixAt(k, o.matrix);
      const g = pave ? 0.32 + rnd() * 0.2 : rock ? 0.3 + rnd() * 0.18 : 0.18 + rnd() * 0.1;
      col.setRGB(pave || rock ? g : g * 1.5, pave || rock ? g : g * 1.15, pave || rock ? g * 1.02 : g * 0.8); mesh.setColorAt(k, col);
    }
    mesh.count = Math.max(mesh.count, (slot + 1) * DEB);
    mesh.instanceMatrix.needsUpdate = mesh.instanceColor.needsUpdate = true;
  }

  /** Trees, buildings and lights inside the blast. `fresh` = it just happened: flames and debris. */
  destroyAround(c, fresh) {
    let burning = 0;
    for (const [i, d, t] of this.world.treesNear(c.x, c.z, c.Rt)) {
      const fate = DM.treeFate(i, d, c);
      if (!fate) continue;
      const before = this.world.treeState[i];
      this.world.setTreeState(i, fate, [t[0] - c.x, t[2] - c.z]);
      if (fresh && fate > before && burning < 14 && (fate === 1 || Math.random() < 0.35)) { this.fires.push({ p: [t[0], t[1] + 3, t[2]], t: 0, life: R(18, 40), k: R(0.6, 1.2) }); burning++; }
    }
    for (const st of this.world.destroyStructs(c)) {
      if (!fresh) continue;
      const p = [st.x, this.field.at(st.x, st.z) + 2, st.z];
      this.fx.explode(p, [0, 0, 0], { violence: 0.7, fuel: st.r > 8 ? 0.8 : 0.2 });
      this.fires.push({ p, t: 0, life: 50, k: Math.min(3, st.r / 8 + 0.8) });
    }
  }

  /** Cut holes under the nearest craters (every 0.4 s, or at once when forced). */
  updateHoles(cam, force) {
    const w = this.world, list = this.dmg.list;
    w.holeN.value = 0;
    if (!list.length) return;
    const cx = cam ? cam.x : this._cam ? this._cam.x : 0, cz = cam ? cam.z : this._cam ? this._cam.z : 0;
    if (cam) this._cam = { x: cam.x, z: cam.z };
    const near = list.filter(c => this.slot.has(c.id)).map(c => [Math.hypot(c.x - cx, c.z - cz) - c.Ri, c]).sort((a, b) => a[0] - b[0]).slice(0, w.holes.value.length);
    near.forEach(([, c], i) => w.holes.value[i].set(c.x, c.z, (c.Ri * 0.965) ** 2, 0));
    w.holeN.value = near.length;
  }

  // ---------- the temporary part
  /** A bomb on land: flash, fireball, mushroom, a column of ejecta in the colour of the ground, a dust ring. */
  landBlast(p, ex, mat, bigness = 1) {
    const fx = this.fx, scale = Math.min(6.5, 0.9 + 0.32 * Math.cbrt(ex) * bigness), fuel = (scale / 1.2) ** 2, dust = DUST[mat] || DUST.soil;
    fx.explode(p, [0, 0, 0], { violence: 1, fuel });
    const cube = Math.cbrt(ex);
    for (let k = 0; k < Math.min(160, 30 + cube * 6); k++) {                 // the ejecta column: earth thrown up and falling back
      const a = R(0, Math.PI * 2), sp = R(2, 10 + cube * 1.4), up = R(10, 28 + cube * 6);
      fx.smoke.emit({ p: [p[0] + Math.cos(a) * R(0, 2 + cube * 0.3), p[1] + 0.5, p[2] + Math.sin(a) * R(0, 2 + cube * 0.3)], v: [Math.cos(a) * sp, up, Math.sin(a) * sp], life: R(2.5, 5.5),
                      size: [R(1.5, 3), R(8, 14 + cube)], c0: [dust[0] * 0.55, dust[1] * 0.55, dust[2] * 0.55], c1: dust, a: 0.75, fadeIn: 0.05, drag: 0.5, acc: -6, wind: 0.6, spin: 0.3 });
    }
    for (let k = 0; k < Math.min(120, 20 + cube * 8); k++) {                  // clods and chunks on ballistic arcs
      const a = R(0, Math.PI * 2), sp = R(10, 30 + cube * 3), up = R(10, 35 + cube * 4);
      fx.smoke.emit({ p: [p[0], p[1] + 0.5, p[2]], v: [Math.cos(a) * sp, up, Math.sin(a) * sp], life: R(2, 4.5), size: [R(0.6, 1.4), 0.8], c0: [dust[0] * 0.3, dust[1] * 0.3, dust[2] * 0.3], c1: [dust[0] * 0.3, dust[1] * 0.3, dust[2] * 0.3], a: 1, fadeIn: 0.01, drag: 0.2, acc: -9.8, land: true });
    }
    for (let k = 0; k < 40 * scale; k++) {                                    // a broad dust ring racing outward
      const a = R(0, Math.PI * 2), sp = R(20, 55) * Math.min(2, scale / 2 + 0.5);
      fx.smoke.emit({ p: [p[0], p[1] + 1, p[2]], v: [Math.cos(a) * sp, R(1, 5), Math.sin(a) * sp], life: R(5, 9), size: [R(5, 9), R(24, 40) * Math.min(2, scale / 2)], c0: dust, c1: [dust[0] * 1.15, dust[1] * 1.15, dust[2] * 1.15], a: 0.5, fadeIn: 0.1, drag: 1.4, acc: 0.3, wind: 0.7, spin: 0.3 });
    }
  }

  /** A bomb in the sea: a splash column, rings that roll outward for ten seconds, a foam patch and mist - no crater. */
  waterBlast(p, ex) {
    const scale = Math.min(6, 0.6 + 0.3 * Math.cbrt(ex)), cube = Math.cbrt(ex);
    this.fx.splash([p[0], 0, p[2]], [0, 0, 0], scale);
    for (let k = 0; k < Math.min(90, 20 + cube * 5); k++) {                    // tall thin column of spray in the middle
      const a = R(0, Math.PI * 2), r = R(0, 2 + cube * 0.3);
      this.fx.smoke.emit({ p: [p[0] + Math.cos(a) * r, 0.3, p[2] + Math.sin(a) * r], v: [Math.cos(a) * R(0, 3), R(25, 55 + cube * 6), Math.sin(a) * R(0, 3)], life: R(2.5, 5), size: [R(2, 4), R(7, 12)],
                       c0: [0.96, 0.98, 1], c1: [0.84, 0.9, 0.95], a: 0.8, fadeIn: 0.02, drag: 0.25, acc: -9.8, land: true });
    }
    const mk = (delay, life, maxR, op, w) => {
      const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: 0xe8f0f4, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
      m.rotation.x = -Math.PI / 2; m.position.set(p[0], 0.18, p[2]); m.scale.setScalar(0.01); m.visible = false; this.scene.add(m);
      this.ripples.push({ m, t: -delay, life, maxR, op, w });
    };
    const R0 = 10 + cube * 4;                                                  // the surface shock, then the swell: five rings, each slower and softer
    mk(0, 4, R0 * 2.2, 0.8); mk(0.5, 8, R0 * 2.8, 0.55); mk(1.4, 12, R0 * 3.2, 0.45); mk(2.6, 16, R0 * 3.6, 0.35); mk(4.2, 20, R0 * 4, 0.25);
    const foam = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: 0xf2f6f8, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    foam.rotation.x = -Math.PI / 2; foam.position.set(p[0], 0.14, p[2]); this.scene.add(foam);
    this.foam.push({ m: foam, t: 0, life: 28, r: R0 * 0.9 });
  }

  /** A missile on land: a small burst of earth and a scorch (the Missiles module draws the fireball). */
  missileBlast(p, mat) {
    const dust = DUST[mat] || DUST.soil;
    for (let k = 0; k < 26; k++) {
      const a = R(0, Math.PI * 2), sp = R(2, 9);
      this.fx.smoke.emit({ p: [p[0], p[1] + 0.3, p[2]], v: [Math.cos(a) * sp, R(4, 14), Math.sin(a) * sp], life: R(1.5, 3.5), size: [R(0.8, 1.6), R(4, 8)], c0: [dust[0] * 0.5, dust[1] * 0.5, dust[2] * 0.5], c1: dust, a: 0.6, fadeIn: 0.05, drag: 0.7, acc: -5, wind: 0.6, spin: 0.4 });
    }
  }

  update(dt, cam) {
    if ((this.holeT -= dt) <= 0) { this.holeT = 0.4; this.updateHoles(cam); }
    for (const f of this.fires) {                                              // burning trees and buildings
      f.t += dt;
      const fade = Math.max(0, Math.min(1, (f.life - f.t) / 8));
      if (Math.random() < 0.5) this.fx.burn(f.p, fade * 0.9, 1.4 * f.k);
    }
    this.fires = this.fires.filter(f => f.t < f.life);
    for (const r of this.ripples) {
      r.t += dt;
      if (r.t < 0) continue;
      r.m.visible = true;
      const k = Math.min(1, r.t / r.life), rad = 1 + r.maxR * (1 - Math.pow(1 - k, 2.2));
      r.m.scale.setScalar(rad); r.m.material.opacity = r.op * Math.pow(1 - k, 1.5) * Math.min(1, r.t / 0.15);
    }
    this.ripples = this.ripples.filter(r => { if (r.t >= r.life) { this.scene.remove(r.m); r.m.material.dispose(); return false; } return true; });
    for (const f of this.foam) {
      f.t += dt; const k = f.t / f.life;
      f.m.scale.setScalar(f.r * (0.5 + 0.9 * Math.sqrt(k))); f.m.material.opacity = 0.6 * Math.pow(1 - k, 1.4) * Math.min(1, f.t / 0.3);
    }
    this.foam = this.foam.filter(f => { if (f.t >= f.life) { this.scene.remove(f.m); f.m.geometry.dispose(); f.m.material.dispose(); return false; } return true; });
  }
}
