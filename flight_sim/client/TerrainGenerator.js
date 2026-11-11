/**
 * TerrainGenerator - builds the world from shared/World.js:
 *   - a 19 km heightfield mesh (also used as the physics ground, so wheels and terrain always agree)
 *     coloured by height / slope (beach, meadows, forest floor, rock, snow) with a detail texture
 *   - the sea (animated normal map), forests (instanced trees), clouds drifting with the wind
 *   - the airfield: runway with painted markings, edge / threshold / approach lights, a PAPI,
 *     apron, hangar, tower and a windsock that shows the real wind
 *   - the neon checkpoint rings of the race course
 */
import * as THREE from 'three';
import { createOcean } from './Ocean.js?v=7';

const W = window.FSWorld;
const N = 512;                                     // grid cells per side (~51 m)
const CELL = W.SIZE / N;
const HOLES = 48;
const X0 = -W.SIZE / 2, Z0 = -W.SIZE / 2;

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
const rnd = (() => { let s = 9; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();

/** Heights on the render grid + an exact sampler over the same triangles. */
export class HeightField {
  constructor() {
    this.h = new Float32Array((N + 1) * (N + 1));
    for (let iz = 0; iz <= N; iz++) for (let ix = 0; ix <= N; ix++) this.h[iz * (N + 1) + ix] = W.heightAt(X0 + ix * CELL, Z0 + iz * CELL);
    this.sea = false;                              // the carrier map: no island - sea level everywhere (set by main.js)
    this.dmg = null;                               // a FSDamage.DamageField: bomb and missile craters, added on top of the terrain
  }
  /** The ground as physics, wheels, birds and the picture see it: the terrain grid plus every crater. */
  at(x, z) { if (this.sea) return -1; return this.dmg ? this.base(x, z) + this.dmg.dh(x, z) : this.base(x, z); }
  /** The undamaged terrain (the render grid). */
  base(x, z) {
    const fx0 = (x - X0) / CELL, fz0 = (z - Z0) / CELL;
    if (fx0 < 0 || fz0 < 0 || fx0 >= N || fz0 >= N) return W.heightAt(x, z);
    const ix = Math.floor(fx0), iz = Math.floor(fz0), fx = fx0 - ix, fz = fz0 - iz, R = N + 1, h = this.h;
    const ha = h[iz * R + ix], hb = h[(iz + 1) * R + ix], hc = h[(iz + 1) * R + ix + 1], hd = h[iz * R + ix + 1];
    // same split as the mesh: triangles (a, b, d) and (b, c, d), diagonal from b to d
    if (fx + fz <= 1) return ha + (hd - ha) * fx + (hb - ha) * fz;
    return hc + (hb - hc) * (1 - fx) + (hd - hc) * (1 - fz);
  }
  surface(x, z) {
    if (this.sea) return 'water';
    if (this.dmg && this.dmg.rubbleAt(x, z)) return 'rubble';          // broken pavement and rock
    if (W.onRunway(x, z)) return 'runway';
    if (W.onAirstrip(x, z)) return 'dirt';
    return this.at(x, z) < 0.2 ? 'water' : 'grass';
  }
}

export class TerrainGenerator {
  constructor(scene, field) {
    this.scene = scene;
    this.field = field;
    this.group = new THREE.Group();
    scene.add(this.group);
    // craters cut holes in the terrain and runway meshes (their own crater meshes fill them): up to 48 nearest ones
    this.holes = { value: Array.from({ length: HOLES }, () => new THREE.Vector4(0, 0, -1, 0)) };
    this.holeN = { value: 0 };
    this.structs = [];                                          // the destructible things: {name, x, z, r, meshes, solids, dead}
    this.buildTerrain();
    this.buildWater();
    this.buildRunway();
    this.buildAirfield();
    this.buildIsland();
    this.buildTrees();
    this.buildClouds();
    this.buildRings();
  }

  // ---------- terrain
  buildTerrain() {
    const R = N + 1, h = this.field.h;
    const pos = new Float32Array(R * R * 3), col = new Float32Array(R * R * 3), uv = new Float32Array(R * R * 2);
    const c = new THREE.Color(), sand = new THREE.Color(0xd8c9a0), grass = new THREE.Color(0x6f9a45), grass2 = new THREE.Color(0x8aa856),
          forest = new THREE.Color(0x3f6a33), rock = new THREE.Color(0x837a70), rock2 = new THREE.Color(0x6a625c), snow = new THREE.Color(0xf4f6fa),
          mown = new THREE.Color(0x86b45a), seabed = new THREE.Color(0x3d6a74),
          jungle = new THREE.Color(0x3f8a3a), jungle2 = new THREE.Color(0x77a73e), laterite = new THREE.Color(0xa65a33), ashC = new THREE.Color(0x2f2b2a), cinder = new THREE.Color(0x6e3a26);
    for (let iz = 0; iz <= N; iz++) for (let ix = 0; ix <= N; ix++) {
      const i = iz * R + ix, x = X0 + ix * CELL, z = Z0 + iz * CELL, y = h[i];
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      uv[i * 2] = x / 40; uv[i * 2 + 1] = z / 40;
      const hx = h[iz * R + Math.min(N, ix + 1)] - h[iz * R + Math.max(0, ix - 1)], hz = h[Math.min(N, iz + 1) * R + ix] - h[Math.max(0, iz - 1) * R + ix];
      const slope = Math.hypot(hx, hz) / (2 * CELL);
      const n1 = W.fbm(x / 700, z / 700, 3), n2 = W.fbm(x / 160 + 7, z / 160, 2);
      if (y < 0) c.copy(seabed).lerp(sand, Math.max(0, 1 + y / 25));
      else if (y < 7 + n2 * 3) c.copy(sand);
      else {
        c.copy(grass).lerp(grass2, n2 * 0.5 + 0.5);
        if (n1 > 0.12 && y < 900) c.lerp(forest, Math.min(1, (n1 - 0.12) * 4));
        const rk = W.smooth(0.45, 0.8, slope) + W.smooth(650, 1000, y + n1 * 120);
        if (rk > 0) c.lerp(n2 > 0 ? rock : rock2, Math.min(1, rk));
        const sn = W.smooth(1080, 1250, y + n1 * 150) * (1 - W.smooth(0.9, 1.3, slope));
        if (sn > 0) c.lerp(snow, sn);
        if (Math.abs(x) < 140 && Math.abs(z) < 820) c.lerp(mown, 0.7);
        if (Math.abs(x - W.ISLE.x) < 2700 && Math.abs(z - W.ISLE.z) < 2700) {          // Cinder Cay: tropical green, red earth on the plateau, black ash round the cone
          const [ash, earth] = W.isleMix(x, z);
          c.copy(jungle).lerp(jungle2, 0.5 + n2 * 0.5);
          if (n1 > 0.2) c.lerp(forest, 0.35);
          c.lerp(laterite, earth * 0.9);
          c.lerp(ash > 0.6 && n2 > 0.1 ? cinder : ashC, ash);
        }
      }
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    const idx = new Uint32Array(N * N * 6);
    let k = 0;
    for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
      const a = iz * R + ix, b = (iz + 1) * R + ix, cc = (iz + 1) * R + ix + 1, d = iz * R + ix + 1;
      idx[k++] = a; idx[k++] = b; idx[k++] = d; idx[k++] = b; idx[k++] = cc; idx[k++] = d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    const detail = canvasTex(256, 256, (g, w) => {
      g.fillStyle = '#c8c8c8'; g.fillRect(0, 0, w, w);
      for (let i = 0; i < 9000; i++) { const v = 150 + rnd() * 105 | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(rnd() * w, rnd() * w, 1 + rnd() * 3, 1 + rnd() * 3); }
    });
    detail.colorSpace = THREE.NoColorSpace;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 0.95, metalness: 0 });
    this.terrain = new THREE.Mesh(geo, mat);
    this.terrainColors = col; this.terrainDetail = detail;
    this.cutHoles(mat);
    this.terrain.receiveShadow = true;
    this.group.add(this.terrain);
  }

  /** Make a material discard fragments inside the crater discs (uniform vec4 holes: x, z, radius^2). */
  cutHoles(mat) {
    mat.onBeforeCompile = sh => {
      sh.uniforms.uHoles = this.holes; sh.uniforms.uHoleN = this.holeN;
      sh.vertexShader = 'varying vec3 vHolePos;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvHolePos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = `varying vec3 vHolePos;\nuniform vec4 uHoles[${HOLES}];\nuniform int uHoleN;\n` + sh.fragmentShader.replace('void main() {',
        `void main() {\n  for (int i = 0; i < ${HOLES}; i++) { if (i >= uHoleN) break; vec2 d = vHolePos.xz - uHoles[i].xy; if (dot(d, d) < uHoles[i].z) discard; }`);
    };
    mat.customProgramCacheKey = () => 'holes';
    mat.needsUpdate = true;
  }
  /** The terrain's vertex colour at (x, z) (bilinear), so crater meshes fade into the ground around them. */
  terrainColor(x, z, out) {
    const R = N + 1, fx = Math.max(0, Math.min(N - 1e-6, (x - X0) / CELL)), fz = Math.max(0, Math.min(N - 1e-6, (z - Z0) / CELL));
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz, c = this.terrainColors, i00 = (iz * R + ix) * 3, i10 = i00 + 3, i01 = i00 + R * 3, i11 = i01 + 3;
    for (let k = 0; k < 3; k++) out[k] = (c[i00 + k] * (1 - tx) + c[i10 + k] * tx) * (1 - tz) + (c[i01 + k] * (1 - tx) + c[i11 + k] * tx) * tz;
    return out;
  }

  buildWater() {
    // the shared ocean shader (Ocean.js): exact wave normals, fresnel sky reflection, sun glitter, whitecaps
    this.ocean = createOcean({ opacity: 0.94 });
    this.ocean.mesh.position.y = 0;
    this.group.add(this.ocean.mesh);
  }

  // ---------- runway, markings, lights
  buildRunway() {
    const R = W.RUNWAY, L = R.length, Wd = R.width;
    const px = 4;                                                // texture px per metre across
    const tex = canvasTex(Wd * px, 4096, (g, w, h) => {
      const m = h / L;                                           // px per metre along
      g.fillStyle = '#3b3d40'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 26000; i++) { const v = 45 + rnd() * 30 | 0; g.fillStyle = `rgb(${v},${v},${v + 2})`; g.fillRect(rnd() * w, rnd() * h, 1, 2); }
      g.fillStyle = 'rgba(20,20,20,.35)'; for (const end of [0, 1]) for (let i = 0; i < 40; i++) g.fillRect(w * 0.3 + rnd() * w * 0.4, (end ? h - 260 * m : 130 * m) + rnd() * 140 * m, 3, 30 + rnd() * 50);  // tyre marks
      g.fillStyle = '#e8e8e2';
      g.fillRect(2, 0, 3, h); g.fillRect(w - 5, 0, 3, h);                                   // edge lines
      for (let y = 0; y < h; y += 50 * m) g.fillRect(w / 2 - 2, y + 10 * m, 4, 30 * m);      // centreline
      // threshold piano keys and runway numbers at both ends ("36" at the south end, "18" north)
      for (const end of [0, 1]) {
        const y0 = end ? h - 6 * m : 6 * m, dir = end ? -1 : 1;
        for (let i = 0; i < 8; i++) { const x = 8 + i * ((w - 16) / 8) + (i >= 4 ? 10 : 0) - (i >= 4 ? 10 : 0); g.fillRect(x + 2, Math.min(y0, y0 + dir * 30 * m), ((w - 16) / 8) - 6, 30 * m); }
        g.save(); g.translate(w / 2, y0 + dir * 55 * m); if (!end) g.rotate(Math.PI); else g.rotate(0);
        g.font = `bold ${18 * m}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.save(); g.scale(px / m * 0.9, 1); g.fillText(end ? '36' : '18', 0, 0); g.restore(); g.restore();
        // aiming point (300 m) and touchdown zone bars
        const ap = y0 + dir * 300 * m;
        g.fillRect(w * 0.18, Math.min(ap, ap + dir * 50 * m), 6 * px, 50 * m); g.fillRect(w * 0.82 - 6 * px, Math.min(ap, ap + dir * 50 * m), 6 * px, 50 * m);
        for (const d of [150, 450, 600]) { const yy = y0 + dir * d * m; g.fillRect(w * 0.2, Math.min(yy, yy + dir * 22 * m), 3 * px, 22 * m); g.fillRect(w * 0.8 - 3 * px, Math.min(yy, yy + dir * 22 * m), 3 * px, 22 * m); }
      }
    }, false);
    const rw = new THREE.Mesh(new THREE.PlaneGeometry(Wd, L), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2 }));
    rw.rotation.x = -Math.PI / 2; rw.position.set(R.x, R.elev + 0.03, R.z);
    rw.receiveShadow = true;
    this.cutHoles(rw.material);
    this.group.add(rw);
    // shoulders / blast pads
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(Wd + 10, L + 60), new THREE.MeshStandardMaterial({ color: 0x55574f, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1 }));
    pad.rotation.x = -Math.PI / 2; pad.position.set(R.x, R.elev + 0.02, R.z); pad.receiveShadow = true; this.cutHoles(pad.material); this.group.add(pad);

    // lights: edge (white), thresholds (green at the landing end, red far end), approach light bars, PAPI
    const pts = [], cols = [];
    const add = (x, y, z, c) => { pts.push(x, y, z); cols.push(c.r, c.g, c.b); };
    const white = new THREE.Color(1, 0.95, 0.8), green = new THREE.Color(0.2, 1, 0.35), red = new THREE.Color(1, 0.15, 0.1), amber = new THREE.Color(1, 0.7, 0.2);
    for (let z = R.z1; z <= R.z0 + 0.1; z += 60) { add(R.x - Wd / 2 - 1.5, R.elev + 0.4, z, z > R.z0 - 600 ? white : amber); add(R.x + Wd / 2 + 1.5, R.elev + 0.4, z, z > R.z0 - 600 ? white : amber); }
    for (let x = -Wd / 2 - 3; x <= Wd / 2 + 3; x += 3) { add(R.x + x, R.elev + 0.4, R.z0 + 2, green); add(R.x + x, R.elev + 0.4, R.z1 - 2, red); }
    for (let d = 60; d <= 600; d += 60) for (let x = -6; x <= 6; x += 2) { const zz = R.z0 + d; add(R.x + x, Math.max(R.elev, this.field.at(R.x, zz)) + 1.5 + d * 0.004, zz, white); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    this.lightTex = canvasTex(64, 64, (g, w) => { const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); gr.addColorStop(0, '#fff'); gr.addColorStop(0.25, 'rgba(255,255,255,.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); }, false);
    this.lightColors = Float32Array.from(cols);
    this.runwayLights = new THREE.Points(geo, new THREE.PointsMaterial({ size: 2.2, map: this.lightTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    this.group.add(this.runwayLights);
    // PAPI: 4 lamps left of the runway at the aiming point, 2.5 / 2.83 / 3.17 / 3.5 degrees
    this.papi = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      m.position.set(R.x - Wd / 2 - 15 - i * 9, R.elev + 1, R.z0 - 300);
      m.userData.angle = [3.5, 3.17, 2.83, 2.5][i] * Math.PI / 180;
      this.group.add(m); this.papi.push(m);
      const box = new THREE.Mesh(new THREE.BoxGeometry(2, 1.2, 1.4), new THREE.MeshStandardMaterial({ color: 0x333333 })); box.position.set(m.position.x, R.elev + 0.6, m.position.z + 0.8); this.group.add(box);
      this.structs.push({ name: 'a PAPI light', x: m.position.x, z: m.position.z, r: 2, meshes: [m, box], solids: [], dead: false });
    }
  }

  buildAirfield() {
    const R = W.RUNWAY, y = R.elev;
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(120, 260), new THREE.MeshStandardMaterial({ color: 0x6b6d70, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1 }));
    apron.rotation.x = -Math.PI / 2; apron.position.set(R.x + 110, y + 0.02, R.z + 120); apron.receiveShadow = true; this.cutHoles(apron.material); this.group.add(apron);
    const taxi = new THREE.Mesh(new THREE.PlaneGeometry(52, 14), apron.material); taxi.rotation.x = -Math.PI / 2; taxi.position.set(R.x + 41, y + 0.025, R.z + 120); this.group.add(taxi);
    this.buildings = [];                                        // solid boxes the aircraft can fly into
    let open = null;
    const begin = (name, x, z, r) => { open = { name, x, z, r, from: this.group.children.length, sfrom: this.buildings.length }; };
    const end = () => { this.structs.push({ name: open.name, x: open.x, z: open.z, r: open.r, meshes: this.group.children.slice(open.from), solids: this.buildings.slice(open.sfrom), dead: false }); open = null; };
    const solid = (name, x0, y0, z0, x1, y1, z1) => this.buildings.push({ name, x0, y0, z0, x1, y1, z1 });
    const box = (w, h, d, x, z, color, rough = 0.8, name = 'a building') => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: rough })); m.position.set(x, y + h / 2, z); m.castShadow = true; m.receiveShadow = true; this.group.add(m); solid(name, x - w / 2, y, z - d / 2, x + w / 2, y + h, z + d / 2); return m; };
    // hangar with a curved roof
    begin('the hangar', R.x + 150, R.z + 60, 26);
    box(40, 9, 30, R.x + 150, R.z + 60, 0xb8bcc2, 0.8, 'the hangar');
    solid('the hangar', R.x + 130, y + 9, R.z + 45, R.x + 170, y + 14, R.z + 75);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 40, 24, 1, false, -Math.PI / 2, Math.PI), new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.6, roughness: 0.4 }));
    roof.rotation.z = Math.PI / 2; roof.rotation.y = Math.PI / 2; roof.position.set(R.x + 150, y + 9, R.z + 60); roof.scale.set(1, 1, 0.35); roof.castShadow = true; this.group.add(roof);
    box(26, 7, 1, R.x + 130, R.z + 60, 0x2e3a48).position.x = R.x + 129.4;     // hangar door
    end();
    // tower
    begin('the control tower', R.x + 140, R.z + 190, 10);
    box(6, 16, 6, R.x + 140, R.z + 190, 0xd8d4c8, 0.8, 'the control tower');
    solid('the control tower', R.x + 134.8, y + 16, R.z + 184.8, R.x + 145.2, y + 21, R.z + 195.2);
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 4.2, 4, 8), new THREE.MeshStandardMaterial({ color: 0x2a4a68, metalness: 0.7, roughness: 0.15 }));
    cab.position.set(R.x + 140, y + 18, R.z + 190); this.group.add(cab);
    box(11, 0.6, 11, R.x + 140, R.z + 190, 0x555555).position.y = y + 20.3;
    end();
    // parked planes are just shapes; fuel truck
    begin('a fuel truck', R.x + 100, R.z + 200, 5);
    box(7, 2.6, 2.4, R.x + 100, R.z + 200, 0xd03a2a, 0.8, 'a fuel truck');
    end();
    // windsock on a pole beside the threshold
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 8, 8), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
    pole.position.set(R.x - 45, y + 4, R.z0 - 120); this.group.add(pole);
    const sockTex = canvasTex(64, 16, (g, w, h) => { for (let i = 0; i < 5; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#ff5a1a'; g.fillRect(i * w / 5, 0, w / 5, h); } }, false);
    const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.6, 4, 12, 1, true), new THREE.MeshStandardMaterial({ map: sockTex, side: THREE.DoubleSide }));
    sock.geometry.rotateZ(Math.PI / 2); sock.geometry.translate(2, 0, 0);
    this.sock = new THREE.Group(); this.sock.add(sock); this.sock.position.set(R.x - 45, y + 7.6, R.z0 - 120);
    this.group.add(this.sock); this.socks = [this.sock];
    this.structs.push({ name: 'the windsock', x: R.x - 45, z: R.z0 - 120, r: 3, meshes: [pole, this.sock], solids: [], dead: false });
  }

  // ---------- Cinder Cay: the dirt strip, the camp, the smoking volcano
  buildIsland() {
    const A = W.AIRSTRIP, L = A.length, Wd = A.width, y = A.elev, V = W.VOLCANO;
    const px = 4, tex = canvasTex(Wd * px, 2048, (g, w, h) => {
      g.fillStyle = '#c9a374'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 30000; i++) { const v = rnd(), k = 120 + v * 70 | 0; g.fillStyle = `rgb(${k + 80},${k + 30},${k - 20})`; g.globalAlpha = 0.5; g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 3); }
      g.globalAlpha = 1;
      for (const cx of [0.3, 0.7]) { g.fillStyle = 'rgba(70,40,22,.55)'; g.fillRect(w * cx - 6, 0, 12, h); }          // wheel ruts
      g.fillStyle = 'rgba(210,170,120,.35)'; g.fillRect(w / 2 - 8, 0, 16, h);                                           // the crown of the strip
      for (let i = 0; i < 120; i++) { g.fillStyle = `rgba(${60 + rnd() * 40 | 0},${90 + rnd() * 40 | 0},40,.55)`; g.fillRect(rnd() < 0.5 ? rnd() * 5 : w - rnd() * 5, rnd() * h, 2 + rnd() * 4, 3 + rnd() * 9); }   // grass creeping in at the edges
      g.fillStyle = '#efe8d8';                                                                                          // whitewashed stones: threshold bars and the centreline dashes
      for (const end of [0, 1]) for (let i = 0; i < 8; i++) { const yy = end ? h - 30 - rnd() * 3 : 18 + rnd() * 3; g.fillRect(8 + i * (w - 16) / 8, yy, 8, 6); }
      for (let yy = 160; yy < h - 160; yy += 160) g.fillRect(w / 2 - 2, yy, 4, 14);
    }, false);
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(Wd, L), new THREE.MeshStandardMaterial({ map: tex, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 }));
    strip.rotation.x = -Math.PI / 2; strip.position.set(A.x, y + 0.03, A.z); strip.receiveShadow = true; this.cutHoles(strip.material); this.group.add(strip);
    const shoulder = new THREE.Mesh(new THREE.PlaneGeometry(Wd + 18, L + 40), new THREE.MeshStandardMaterial({ color: 0xb4825a, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 }));
    shoulder.rotation.x = -Math.PI / 2; shoulder.position.set(A.x, y + 0.02, A.z); shoulder.receiveShadow = true; this.cutHoles(shoulder.material); this.group.add(shoulder);
    // oil-drum markers along both edges
    const drums = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.28, 0.28, 0.7, 8), new THREE.MeshStandardMaterial({ color: 0xd2541f, roughness: 0.6 }), 2 * 21 + 8), o = new THREE.Object3D();
    let k = 0;
    for (let z = A.z1; z <= A.z0 + 0.1; z += 50) for (const sx of [-1, 1]) { o.position.set(A.x + sx * (Wd / 2 + 2.5), y + 0.35, z); o.updateMatrix(); drums.setMatrixAt(k++, o.matrix); }
    for (let x = -Wd / 2; x <= Wd / 2 + 0.1; x += Wd / 3) { o.position.set(A.x + x, y + 0.35, A.z1 - 4); o.updateMatrix(); drums.setMatrixAt(k++, o.matrix); }
    drums.count = k; drums.castShadow = true; this.group.add(drums);
    // the camp east of the threshold: a tin-roofed hut, a store shed, fuel drums, a lean-to and a windsock
    const cx = A.x + 52, cz = A.z0 - 90, solid = (name, x0, y0, z0, x1, y1, z1) => this.buildings.push({ name, x0, y0, z0, x1, y1, z1 });
    const part = (m, x, yy, z) => { m.position.set(x, yy, z); m.castShadow = m.receiveShadow = true; this.group.add(m); return m; };
    const mat = (c, r = 0.85, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
    const from = this.group.children.length, sfrom = this.buildings.length;
    part(new THREE.Mesh(new THREE.BoxGeometry(12, 3.4, 7), mat(0x8a5a36)), cx, y + 1.7, cz);
    const roof = part(new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 13, 3, 1), mat(0xb9bec4, 0.4, 0.6)), cx, y + 4.7, cz); roof.rotation.z = Math.PI / 2; roof.rotation.x = Math.PI / 2; roof.scale.set(1, 1, 0.55);
    part(new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.2, 1.6), mat(0x2a2018)), cx - 6.05, y + 1.1, cz);
    solid('the camp hut', cx - 6, y, cz - 3.5, cx + 6, y + 6, cz + 3.5);
    part(new THREE.Mesh(new THREE.BoxGeometry(6, 2.8, 5), mat(0x6f7a58)), cx + 15, y + 1.4, cz + 2);
    solid('the store shed', cx + 12, y, cz - 0.5, cx + 18, y + 3, cz + 4.5);
    for (let i = 0; i < 9; i++) part(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 8), mat([0x2f5d9a, 0xd2541f, 0x777a7d][i % 3], 0.6, 0.3)), cx - 14 + (i % 3) * 0.8, y + 0.45, cz + 9 + (i / 3 | 0) * 0.8);
    solid('the fuel drums', cx - 15, y, cz + 8, cx - 12, y + 1, cz + 12);
    this.structs.push({ name: 'the camp', x: cx, z: cz, r: 22, meshes: this.group.children.slice(from), solids: this.buildings.slice(sfrom), dead: false });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 8, 8), mat(0xdddddd)); pole.position.set(A.x - 34, y + 4, A.z0 - 70); this.group.add(pole);
    const sockTex = canvasTex(64, 16, (g, w, h) => { for (let i = 0; i < 5; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#e8c21a'; g.fillRect(i * w / 5, 0, w / 5, h); } }, false);
    const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.6, 4, 12, 1, true), new THREE.MeshStandardMaterial({ map: sockTex, side: THREE.DoubleSide }));
    sock.geometry.rotateZ(Math.PI / 2); sock.geometry.translate(2, 0, 0);
    const g2 = new THREE.Group(); g2.add(sock); g2.position.set(A.x - 34, y + 7.6, A.z0 - 70); this.group.add(g2); this.socks.push(g2);
    this.structs.push({ name: 'the island windsock', x: A.x - 34, z: A.z0 - 70, r: 3, meshes: [pole, g2], solids: [], dead: false });
    // the volcano: a glowing lava lake on the crater floor and a smoke column that drifts downwind
    const vy = this.field.at(V.x, V.z), glow = canvasTex(64, 64, (g, w) => { const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); gr.addColorStop(0, '#fff3a0'); gr.addColorStop(0.35, '#ff8a1e'); gr.addColorStop(0.8, '#a81c08'); gr.addColorStop(1, 'rgba(60,10,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); }, false);
    const lava = new THREE.Mesh(new THREE.CircleGeometry(62, 32), new THREE.MeshBasicMaterial({ map: glow, transparent: true, toneMapped: false }));
    lava.rotation.x = -Math.PI / 2; lava.position.set(V.x, vy + 1.2, V.z); this.group.add(lava); this.lava = lava;
    const smoke = canvasTex(64, 64, (g, w) => { for (let i = 0; i < 6; i++) { const x = w * (0.3 + rnd() * 0.4), yy = w * (0.3 + rnd() * 0.4), r = w * (0.2 + rnd() * 0.15), gr = g.createRadialGradient(x, yy, 0, x, yy, r); gr.addColorStop(0, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); } }, false);
    this.plume = Array.from({ length: 18 }, (_, i) => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smoke, color: 0x57504c, transparent: true, depthWrite: false, fog: true, opacity: 0 })); sp.userData = { ph: i / 18, seed: rnd() }; this.group.add(sp); return sp; });
    this.crater = { x: V.x, z: V.z, y: vy };
  }

  /**
   * What solid object is at (x, y, z)? Trees are cones around a trunk (crown 3.6 m wide at the bottom,
   * 14.5 m tall at scale 1); buildings are boxes. Returns a description for the crash report, or null.
   */
  obstacleAt(x, y, z) {
    for (const b of this.buildings) if (!b.dead && x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1 && z > b.z0 && z < b.z1) return b.name;
    const cx = Math.floor(x / 60), cz = Math.floor(z / 60);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const list = this.treeGrid[(cx + i) + ',' + (cz + j)];
      if (!list) continue;
      for (const [tx, ty, tz, s, ti] of list) {
        if (this.treeState[ti] >= 2) continue;                              // blown over or destroyed
        const hgt = 14.5 * s * (this.treeState[ti] === 1 ? 0.6 : 1), up = y - ty;
        if (up < 0 || up > hgt) continue;
        const r = up < 3.5 * s ? 0.6 * s : 3.6 * s * (1 - (up - 3.5 * s) / (hgt - 3.5 * s)) + 0.3;
        if ((x - tx) ** 2 + (z - tz) ** 2 < r * r) return 'a tree';
      }
    }
    return null;
  }

  /** Point the windsock downwind and droop it in light wind. */
  updateWind(wind) {
    const sp = Math.hypot(wind[0], wind[2]);
    for (const s of this.socks) s.rotation.set(0, Math.atan2(-wind[2], wind[0]), -Math.max(0, 1 - sp / 8) * 1.1);
  }

  // ---------- trees
  buildTrees() {
    const trunk = new THREE.CylinderGeometry(0.4, 0.6, 4, 5); trunk.translate(0, 2, 0);
    const crown = new THREE.ConeGeometry(3.6, 11, 7); crown.translate(0, 9, 0);
    const ints = [];
    this.treeGrid = {};                                         // 60 m cells -> trees, for collisions
    for (let tries = 0, n = 0; tries < 60000 && n < 7000; tries++) {
      const x = (rnd() - 0.5) * 17100, z = (rnd() - 0.5) * 17100;      // the main island's square (the terrain is bigger now)
      const h = this.field.at(x, z);
      if (h < 12 || h > 900) continue;
      if (Math.abs(x) < 200 && Math.abs(z) < 1000) continue;            // keep the airfield clear
      if (W.inSite(x, z, 140)) continue;                               // and the REX plaza / barn meadow
      if (W.fbm(x / 700, z / 700, 3) < 0.1 && rnd() > 0.04) continue;    // forests where the noise says so
      const s = 0.7 + rnd() * 0.8;
      ints.push([x, h - 0.5, z, s, rnd() * 6]);
      const key = Math.floor(x / 60) + ',' + Math.floor(z / 60);
      (this.treeGrid[key] = this.treeGrid[key] || []).push([x, h - 0.5, z, s, n]);
      n++;
    }
    const A = W.AIRSTRIP, V = W.VOLCANO;                       // Cinder Cay: palms and scrub on the green parts
    for (let tries = 0, n = 0; tries < 9000 && n < 800; tries++) {
      const x = W.ISLE.x + (rnd() - 0.5) * 3600, z = W.ISLE.z + (rnd() - 0.5) * 3400;
      const h = this.field.at(x, z), [ash, earth] = W.isleMix(x, z);
      if (h < 5 || h > 170 || ash > 0.5) continue;
      if (Math.abs(x - A.x) < 75 && z > A.z1 - 130 && z < A.z0 + 130) continue;
      if (Math.hypot(x - (A.x + 52), z - (A.z0 - 90)) < 45) continue;            // the camp
      if (earth > 0.4 && rnd() > 0.12) continue;                                  // the plateau is mostly open red ground
      const s = 0.55 + rnd() * 0.5, i = ints.length;
      ints.push([x, h - 0.5, z, s, rnd() * 6, 1]);
      const key = Math.floor(x / 60) + ',' + Math.floor(z / 60);
      (this.treeGrid[key] = this.treeGrid[key] || []).push([x, h - 0.5, z, s, i]);
      n++;
    }
    this.treeData = ints;
    this.treeState = new Uint8Array(ints.length);                // 0 standing, 1 burnt, 2 blown over, 3 destroyed
    const make = (geo, color, tint) => {
      const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true }), ints.length);
      const o = new THREE.Object3D();
      ints.forEach(([x, y, z, s, r, palm], i) => { o.position.set(x, y, z); o.rotation.y = r; o.scale.set(s, s * (0.85 + (r % 1) * 0.3), s); o.updateMatrix(); m.setMatrixAt(i, o.matrix); m.setColorAt(i, palm ? tint : new THREE.Color(1, 1, 1)); });
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
      return m;
    };
    this.treeMeshes = { trunk: make(trunk, 0x5a4030, new THREE.Color(1.3, 1.2, 1.0)), crown: make(crown, 0x2f5a2c, new THREE.Color(1.9, 1.6, 0.8)) };      // island trees: sun-bleached trunks, bright yellow-green crowns
  }

  /** Put tree i into a damage state: 1 scorched (bare, charred), 2 blown over (away from `dir`), 3 destroyed (a charred stump). Only ever worse. */
  setTreeState(i, st, dir) {
    if (st <= this.treeState[i]) return;
    this.treeState[i] = st;
    this.placeTree(i, dir);
  }
  placeTree(i, dir) {
    const [x, y, z, s, r, palm] = this.treeData[i], st = this.treeState[i], o = this.tmpObj || (this.tmpObj = new THREE.Object3D()), sy = s * (0.85 + (r % 1) * 0.3);
    const { trunk, crown } = this.treeMeshes, char = new THREE.Color(0.07, 0.06, 0.05);
    o.position.set(x, y, z); o.rotation.set(0, r, 0); o.scale.set(s, sy, s);
    if (st === 1) { o.updateMatrix(); trunk.setMatrixAt(i, o.matrix); trunk.setColorAt(i, new THREE.Color(0.35, 0.3, 0.28));
                    o.scale.set(s * 0.55, sy * 0.6, s * 0.55); o.updateMatrix(); crown.setMatrixAt(i, o.matrix); crown.setColorAt(i, char); }
    else if (st === 2) {                                        // toppled, pointing away from the blast
      const a = Math.atan2(dir ? dir[1] : 1, dir ? dir[0] : 0);
      o.rotation.set(0, 0, 0); o.rotateY(r); o.position.set(x, y + 0.5, z);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(Math.sin(a), 0, -Math.cos(a)), 1.35 + (r % 0.2));
      o.quaternion.premultiply(q); o.updateMatrix(); trunk.setMatrixAt(i, o.matrix); trunk.setColorAt(i, new THREE.Color(0.5, 0.45, 0.4));
      crown.setMatrixAt(i, o.matrix); crown.setColorAt(i, new THREE.Color(0.45, 0.4, 0.3));
    } else if (st === 3) {
      o.scale.set(s, sy * 0.3, s); o.updateMatrix(); trunk.setMatrixAt(i, o.matrix); trunk.setColorAt(i, char);
      o.scale.setScalar(0); o.updateMatrix(); crown.setMatrixAt(i, o.matrix);
    } else {                                                     // standing again (map reset)
      o.updateMatrix(); trunk.setMatrixAt(i, o.matrix); trunk.setColorAt(i, palm ? new THREE.Color(1.3, 1.2, 1.0) : new THREE.Color(1, 1, 1)); crown.setMatrixAt(i, o.matrix); crown.setColorAt(i, palm ? new THREE.Color(1.9, 1.6, 0.8) : new THREE.Color(1, 1, 1));
    }
    trunk.instanceMatrix.needsUpdate = crown.instanceMatrix.needsUpdate = true;
    trunk.instanceColor.needsUpdate = crown.instanceColor.needsUpdate = true;
  }
  /** Every tree back, every building and light back: the daily map reset. */
  restoreAll() {
    for (let i = 0; i < this.treeState.length; i++) if (this.treeState[i]) { this.treeState[i] = 0; this.placeTree(i); }
    for (const st of this.structs) if (st.dead) { st.dead = false; st.meshes.forEach(m => (m.visible = true)); st.solids.forEach(b => (b.dead = false)); }
    this.runwayLights.geometry.attributes.color.array.set(this.lightColors); this.runwayLights.geometry.attributes.color.needsUpdate = true;
  }
  /** Trees within `r` of (x, z): [index, distance] - through the 60 m grid. */
  treesNear(x, z, r) {
    const out = [], c0 = Math.floor((x - r) / 60), c1 = Math.floor((x + r) / 60), d0 = Math.floor((z - r) / 60), d1 = Math.floor((z + r) / 60);
    for (let i = c0; i <= c1; i++) for (let j = d0; j <= d1; j++) {
      const list = this.treeGrid[i + ',' + j];
      if (list) for (const t of list) { const d = Math.hypot(t[0] - x, t[2] - z); if (d < r) out.push([t[4], d, t]); }
    }
    return out;
  }
  /** A crater destroys what stands within its blast: returns the structures it just took down. */
  destroyStructs(c) {
    const down = [];
    for (const st of this.structs) {
      if (st.dead || Math.hypot(st.x - c.x, st.z - c.z) > st.r + c.R * 2.2) continue;
      st.dead = true; st.meshes.forEach(m => (m.visible = false)); st.solids.forEach(b => (b.dead = true)); down.push(st);
    }
    const col = this.runwayLights.geometry.attributes.color, pos = this.runwayLights.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) if (Math.hypot(pos.getX(i) - c.x, pos.getZ(i) - c.z) < c.R * 1.6 + 2) col.setXYZ(i, 0, 0, 0);
    col.needsUpdate = true;
    return down;
  }

  // ---------- clouds (soft sprites in clusters, drifting with the wind)
  buildClouds() {
    const tex = canvasTex(128, 128, (g, w) => {
      for (let i = 0; i < 14; i++) {
        const x = w * (0.25 + rnd() * 0.5), y = w * (0.3 + rnd() * 0.4), r = w * (0.15 + rnd() * 0.2);
        const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(0, 0, w, w);
      }
    }, false);
    // every cloud puff is a camera-facing quad (what a THREE.Sprite is), but all ~900 of them are ONE instanced draw call instead of ~900:
    // the vertex shader turns each instance to face the camera exactly like the sprite shader, and the puffs are re-sorted back to front
    // every frame (as the renderer sorted the sprites) so the soft edges blend the same
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff, transparent: true, depthWrite: false, fog: true, opacity: 0.9 });
    mat.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', `
        vec4 mvPosition = modelViewMatrix * vec4( instanceMatrix[ 3 ].xyz, 1.0 );
        mvPosition.xy += position.xy * vec2( length( instanceMatrix[ 0 ].xyz ), length( instanceMatrix[ 1 ].xyz ) );
        gl_Position = projectionMatrix * mvPosition;`);
    };
    const clusters = [], puffs = [];
    for (let c = 0; c < 70; c++) {
      const cx = (rnd() - 0.5) * 30000, cz = (rnd() - 0.5) * 30000, cy = 1500 + rnd() * 900;
      const cl = { position: new THREE.Vector3(cx, cy, cz) }; clusters.push(cl);
      const n = 6 + (rnd() * 8 | 0);
      for (let i = 0; i < n; i++) {
        const sz = 250 + rnd() * 350;
        puffs.push({ cl, sx: sz, sy: sz * 0.6, ox: (rnd() - 0.5) * 700, oy: (rnd() - 0.5) * 120, oz: (rnd() - 0.5) * 500 });
      }
    }
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, puffs.length);
    mesh.frustumCulled = false; mesh.renderOrder = -0.5; mesh.castShadow = false; mesh.receiveShadow = false;
    this.clouds = { children: clusters, mesh, puffs, key: new Float32Array(puffs.length), order: Uint16Array.from(puffs, (_, i) => i) };
    this.scene.add(mesh);
  }
  /** Lay the cloud puffs into the instance buffer, farthest from the camera first. */
  drawClouds(cam) {
    const C = this.clouds, P = C.puffs, key = C.key, m = C.mesh.instanceMatrix.array;
    const e = this.camera ? this.camera.matrixWorld.elements : null, fx = e ? -e[8] : 0, fy = e ? -e[9] : 0, fz = e ? -e[10] : -1;
    for (let i = 0; i < P.length; i++) { const p = P[i], c = p.cl.position; key[i] = (c.x + p.ox - cam.x) * fx + (c.y + p.oy - cam.y) * fy + (c.z + p.oz - cam.z) * fz; }
    // insertion sort, farthest first: the order barely changes from one frame to the next, so this is ~one pass and allocates nothing
    const O = C.order;
    for (let i = 1; i < O.length; i++) { const v = O[i], kv = key[v]; let j = i - 1; while (j >= 0 && key[O[j]] < kv) { O[j + 1] = O[j]; j--; } O[j + 1] = v; }
    for (let j = 0; j < P.length; j++) {
      const p = P[C.order[j]], c = p.cl.position, o = j * 16;
      m[o] = p.sx; m[o + 1] = 0; m[o + 2] = 0; m[o + 3] = 0; m[o + 4] = 0; m[o + 5] = p.sy; m[o + 6] = 0; m[o + 7] = 0;
      m[o + 8] = 0; m[o + 9] = 0; m[o + 10] = 1; m[o + 11] = 0; m[o + 12] = c.x + p.ox; m[o + 13] = c.y + p.oy; m[o + 14] = c.z + p.oz; m[o + 15] = 1;
    }
    C.mesh.instanceMatrix.needsUpdate = true;
  }

  // ---------- race rings
  buildRings() {
    this.rings = W.COURSE.map((r, i) => {
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: 0x22e6ff, emissive: 0x22e6ff, emissiveIntensity: 1.6, transparent: true, opacity: 0.9 });
      const torus = new THREE.Mesh(new THREE.TorusGeometry(r.r, 1.4, 12, 48), mat);
      g.add(torus);
      const glow = new THREE.Mesh(new THREE.TorusGeometry(r.r, 4, 8, 48), new THREE.MeshBasicMaterial({ color: 0x22e6ff, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, depthWrite: false }));
      g.add(glow);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 600, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.y = 300 + r.r; g.add(beam);
      const label = canvasTex(128, 64, (c, w, h) => { c.fillStyle = '#fff'; c.font = 'bold 44px Arial'; c.textAlign = 'center'; c.fillText(i === W.COURSE.length - 1 ? 'FINISH' : String(i + 1), w / 2, 46); }, false);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: label, transparent: true, depthWrite: false })); sp.scale.set(30, 15, 1); sp.position.y = r.r + 14; g.add(sp);
      g.position.set(r.x, r.y, r.z);
      g.rotation.y = r.yaw;                                     // torus lies in the xy plane: its axis is z = the course direction
      g.visible = false;
      this.group.add(g);
      return { g, torus, glow, beam, mat, def: r };
    });
  }

  /** Race state: 'next' ring index (or -1 when not racing). */
  setRace(active, next) {
    this.rings.forEach((r, i) => {
      r.g.visible = active && i >= next - 1;
      const isNext = i === next, passed = i < next;
      const color = isNext ? 0xffe14d : passed ? 0x445566 : 0x22e6ff;
      r.mat.color.setHex(color); r.mat.emissive.setHex(color);
      r.glow.material.color.setHex(color);
      r.beam.visible = isNext;
    });
  }

  update(dt, time, cam, wind, planePos) {
    this.ocean.update(time);
    // clouds drift and wrap around the camera
    for (const c of this.clouds.children) {
      c.position.x += wind[0] * dt * 1.5; c.position.z += wind[2] * dt * 1.5;
      if (c.position.x - cam.x > 15000) c.position.x -= 30000; else if (cam.x - c.position.x > 15000) c.position.x += 30000;
      if (c.position.z - cam.z > 15000) c.position.z -= 30000; else if (cam.z - c.position.z > 15000) c.position.z += 30000;
    }
    this.drawClouds(cam);
    for (const r of this.rings) if (r.g.visible) { r.torus.rotation.z = time * 0.3; r.glow.material.opacity = 0.12 + Math.sin(time * 4) * 0.06; }
    if (this.plume) {                                                    // Cinder Cay: the volcano's smoke
      const C = this.crater, wx = wind[0] * 70 + 14, wz = wind[2] * 70;
      this.lava.material.color.setScalar(0.85 + Math.sin(time * 1.7) * 0.15);
      for (const s of this.plume) {
        const ph = (time * 0.03 + s.userData.ph) % 1, e = ph * ph * 0.6 + ph * 0.4;
        s.position.set(C.x + wx * e * 9 + Math.sin(ph * 9 + s.userData.seed * 6) * 25, C.y + 30 + ph * 1100, C.z + wz * e * 9 + Math.cos(ph * 8 + s.userData.seed * 6) * 25);
        const sz = 90 + ph * 520; s.scale.set(sz, sz, 1);
        s.material.opacity = Math.min(1, ph * 12) * (1 - ph) * 0.55;
      }
    }
    // PAPI: white when the viewer is above that lamp's angle, red below
    if (planePos) for (const m of this.papi) {
      const dx = planePos[0] - m.position.x, dz = planePos[2] - m.position.z, d = Math.hypot(dx, dz);
      const ang = Math.atan2(planePos[1] - m.position.y, d);
      m.material.color.setHex(ang > m.userData.angle ? 0xffffff : 0xff2010);
    }
  }
}

export { CELL, N };
