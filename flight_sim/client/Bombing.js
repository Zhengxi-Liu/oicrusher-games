/**
 * Bombing - the bombs in the air and the bombsight.
 *
 * BombFleet: every falling bomb (ours and other pilots'), flown with the shared FSBombs ballistics from the same
 * release state in every browser. Our own bombs report where they landed (onImpact); everybody else's wait for
 * the server's 'boom' (which also carries the crater), so the explosion is where the server says it is.
 *
 * Bombsight: the targeting window. A top-down map of the island around the aircraft (hill-shaded from the real
 * height field, craters included) on which the pilot picks the point to hit. It shows the nominal flight of the
 * bomb released right now - predicted impact point, time to impact, trajectory - and how far that is from the
 * target, plus where along the present ground track the bomb would have to leave to land on it. The bomb does not
 * steer: it lands where the physics (and the scatter and the wind the sight does not know about) put it.
 */
import * as THREE from 'three';

const BM = window.FSBombs, DEG = Math.PI / 180;

// ---------- bomb models (one geometry per type, shared)
const GEO = {};
/**
 * An aerial torpedo, nose -z, nothing like a bomb: a long slim steel cylinder with a blunt rounded warhead, cruciform tail fins and
 * bronze contra-rotating propellers. Two real types:
 *   mk13    US Mk 13 (TBF Avenger): 0.57 m x 4.1 m, with the late-war plywood "pickle barrel" drag ring on the nose and the shroud ring
 *           round the tail fins (both break off when it hits the water)
 *   type91  IJN Type 91 (B5N Kate): slimmer and longer (0.45 m x 5.3 m), the wooden box stabiliser (kyoban) round the tail
 */
const TMAT = {};
export function torpedoMesh(variant = 'mk13') {
  const k91 = variant === 'type91', r = k91 ? 0.225 : 0.285, L = k91 ? 5.2 : 4.1;
  if (!TMAT.steel) Object.assign(TMAT, {
    steel: new THREE.MeshStandardMaterial({ color: 0x7d878b, roughness: 0.35, metalness: 0.45 }),
    head: new THREE.MeshStandardMaterial({ color: 0x3a4246, roughness: 0.45, metalness: 0.4 }),
    bronze: new THREE.MeshStandardMaterial({ color: 0xb4823e, roughness: 0.3, metalness: 0.85 }),
    wood: new THREE.MeshStandardMaterial({ color: 0xb48a58, roughness: 0.85, metalness: 0, side: THREE.DoubleSide }),
    band: new THREE.MeshStandardMaterial({ color: 0xd9d4c4, roughness: 0.6, metalness: 0.1 }),
  });
  const M = TMAT, g = new THREE.Group(), n = -L / 2, t = L / 2;
  // one lathe for the whole hull: blunt warhead, long parallel body, the afterbody tapering to the propeller shaft
  const prof = [[0, n], [r * 0.5, n + 0.03], [r * 0.82, n + 0.12], [r * 0.97, n + 0.26], [r, n + 0.4], [r, t - 0.95], [r * 0.9, t - 0.62], [r * 0.62, t - 0.32], [r * 0.34, t - 0.1], [r * 0.26, t]];
  const hullGeo = new THREE.LatheGeometry(prof.map(([a, z]) => new THREE.Vector2(Math.max(0.001, a), z)), 22); hullGeo.rotateX(Math.PI / 2);
  // the hull is steel; the warhead section (the front ~quarter) is painted darker, split by a light ring
  const hull = new THREE.Mesh(hullGeo, M.steel); g.add(hull);
  const head = new THREE.Mesh(new THREE.LatheGeometry(prof.slice(0, 5).concat([[r * 1.003, n + L * 0.27]]).map(([a, z]) => new THREE.Vector2(Math.max(0.001, a * 1.006), z)), 22), M.head); head.geometry.rotateX(Math.PI / 2); g.add(head);
  for (const z of [n + L * 0.27, t - 1.3]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.012, r * 1.012, 0.06, 22), M.band); b.rotation.x = Math.PI / 2; b.position.z = z; g.add(b); }
  // cruciform fins with rudders and the two bronze propellers
  const fz = t - 0.3, span = r * 1.25;
  for (let k = 0; k < 2; k++) { const f = new THREE.Mesh(new THREE.BoxGeometry(k ? 0.025 : span * 2, k ? span * 2 : 0.025, 0.42), M.steel); f.position.z = fz; g.add(f); }
  for (const [z, rot] of [[t + 0.03, 0], [t + 0.14, Math.PI / 4]]) {
    const pg = new THREE.Group(); pg.position.z = z; pg.rotation.z = rot; g.add(pg);
    for (let k = 0; k < 4; k++) { const bl = new THREE.Mesh(new THREE.BoxGeometry(0.08, r * 0.8, 0.02), M.bronze); bl.position.y = r * 0.42; bl.rotation.y = 0.5; const a = new THREE.Group(); a.rotation.z = k * Math.PI / 2; a.add(bl); pg.add(a); }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 10), M.bronze); hub.rotation.x = Math.PI / 2; pg.add(hub);
  }
  if (k91) {
    // the kyoban: a wooden box (four boards) round the fins, plus wooden extensions on the fins
    const w = span + 0.08, len = 0.55;
    for (let k = 0; k < 4; k++) { const a = new THREE.Group(); a.rotation.z = k * Math.PI / 2; const b = new THREE.Mesh(new THREE.BoxGeometry(w * 2, 0.025, len), M.wood); b.position.set(0, w, 0); a.add(b); a.position.z = fz - 0.05; g.add(a); }
    for (let k = 0; k < 2; k++) { const f = new THREE.Mesh(new THREE.BoxGeometry(k ? 0.03 : w * 2, k ? w * 2 : 0.03, len), M.wood); f.position.z = fz - 0.05; g.add(f); }
  } else {
    // Mk 13: the plywood drag ring over the nose and the shroud ring round the fin tips
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.13, r * 1.13, 0.62, 24, 1, true), M.wood); ring.rotation.x = Math.PI / 2; ring.position.z = n + 0.36; g.add(ring);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 1.13, 0.02, 6, 24), M.wood); rim.position.z = n + 0.05; g.add(rim);
    const shroud = new THREE.Mesh(new THREE.CylinderGeometry(span + 0.02, span + 0.02, 0.3, 24, 1, true), M.wood); shroud.rotation.x = Math.PI / 2; shroud.position.z = fz + 0.04; g.add(shroud);
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
  return g;
}

function bombMesh(type, look) {
  if (type === 'tp') return torpedoMesh(look === 'kate' ? 'type91' : 'mk13');
  const S = BM.BOMBS[type];
  if (!GEO[type]) {
    const r = S.diam / 2, L = S.len, body = new THREE.CylinderGeometry(r, r, L * 0.62, 14), nose = new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
          tail = new THREE.ConeGeometry(r, L * 0.3, 14, 1, true), fin = new THREE.BoxGeometry(0.03 + r * 0.05, r * 1.6, L * 0.2);
    GEO[type] = { body, nose, tail, fin, mat: new THREE.MeshStandardMaterial({ color: 0x4a5240, roughness: 0.6, metalness: 0.4 }), band: new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.5, metalness: 0.3 }) };
  }
  const G = GEO[type], g = new THREE.Group(), L = S.len;
  const b = new THREE.Mesh(G.body, G.mat); b.rotation.x = Math.PI / 2; b.position.z = 0; g.add(b);
  const n = new THREE.Mesh(G.nose, G.mat); n.rotation.x = -Math.PI / 2; n.position.z = -L * 0.31; g.add(n);
  const t = new THREE.Mesh(G.tail, G.mat); t.rotation.x = Math.PI / 2; t.position.z = L * 0.46; g.add(t);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(S.diam / 2 * 1.01, S.diam / 2 * 1.01, L * 0.04, 14), G.band); band.rotation.x = Math.PI / 2; band.position.z = -L * 0.18; g.add(band);
  for (let k = 0; k < 4; k++) { const f = new THREE.Mesh(G.fin, G.mat); const h = new THREE.Group(); h.rotation.z = k * Math.PI / 2; f.position.set(0, S.diam / 2 + 0.05, L * 0.52); h.add(f); g.add(h); }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export class BombFleet {
  /** env: {ground(x, z), obstacle(x, y, z)}; onImpact(bomb, ev) is called for our own bombs when they land. */
  constructor(scene, env, onImpact) { this.scene = scene; this.env = env; this.onImpact = onImpact; this.list = []; }
  get(from, id) { return this.list.find(b => b.from === from && b.id === id); }
  launch({ id, from, type, p, v, wind, seed, mine, name, look }) {
    if (this.get(from, id) || !BM.BOMBS[type]) return null;
    const sim = new BM.Bomb({ type, p, v, wind, seed, id }), mesh = bombMesh(type, look);
    this.scene.add(mesh);
    const b = { id, from, mine, name, type, sim, mesh, ended: false };
    this.place(b); this.list.push(b);
    return b;
  }
  place(b) {
    const v = b.sim.v, l = Math.hypot(...v) || 1;
    b.mesh.position.set(...b.sim.p);
    b.mesh.lookAt(b.sim.p[0] - v[0] / l, b.sim.p[1] - v[1] / l, b.sim.p[2] - v[2] / l);       // nose is -z; lookAt aims +z backwards
  }
  update(dt) {
    for (const b of this.list) {
      if (b.ended) continue;
      const ev = b.sim.advance(dt, this.env);
      this.place(b);
      if (b.sim.run) this.wake(b);
      if (ev) { b.ended = true; this.scene.remove(b.mesh); if (b.wakeMesh) { this.scene.remove(b.wakeMesh); b.wakeMesh = null; } if (b.mine) this.onImpact(b, ev); }
    }
    this.list = this.list.filter(b => !b.ended || (b.gone = (b.gone || 0) + dt) < 8);          // keep the record a while: the 'boom' may be late
  }
  /** A running torpedo leaves a bubble track: a long white strip on the surface from where it entered the water. */
  wake(b) {
    const R = b.sim.run;
    if (!b.wakeMesh) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1), new THREE.MeshBasicMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.55, depthWrite: false }));
      m.rotation.order = 'YXZ'; m.rotation.set(-Math.PI / 2, Math.atan2(R.dx, R.dz), 0); b.wakeMesh = m; b.wakeFrom = [b.sim.p[0], b.sim.p[2]]; this.scene.add(m);
      b.mesh.visible = false;
    }
    const d = Math.min(R.dist, 500), m = b.wakeMesh; m.scale.set(1, d + 0.1, 1);
    m.position.set(b.sim.p[0] - R.dx * d / 2, 0.25, b.sim.p[2] - R.dz * d / 2);
    b.mesh.visible = false;
  }
  /** The server's boom for this bomb arrived: stop drawing it (if it is still falling here). */
  settle(from, id) { const b = this.get(from, id); if (b && !b.ended) { b.ended = true; this.scene.remove(b.mesh); if (b.wakeMesh) { this.scene.remove(b.wakeMesh); b.wakeMesh = null; } } }
  clear() { for (const b of this.list) if (!b.ended) { this.scene.remove(b.mesh); if (b.wakeMesh) this.scene.remove(b.wakeMesh); } this.list = []; }
}

// ---------- the bombsight
const el = id => document.getElementById(id);
const fmtT = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const compass = h => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((h % 360) + 360) % 360 / 45) % 8];

export class Bombsight {
  /**
   * opts: { field, world, craters, env, state() -> {pos, vel, wind: [x,z], heading, bay: [x,y,z] world, type, left, mass},
   *         onDrop(n), onClose() }
   */
  constructor(opts) {
    this.o = opts;
    this.root = el('sight'); this.cv = el('sightMap'); this.g = this.cv.getContext('2d');
    this.target = null; this.open_ = false; this.salvo = 1;
    this.view = { x: 0, z: 0, mpp: 12 };
    this.tex = document.createElement('canvas'); this.M = 32; this.tex.width = this.cv.width / 2 + 2 * this.M; this.tex.height = this.cv.height / 2 + 2 * this.M; this.texKey = ''; this.texView = null; this.follow = true;     // the map follows the aircraft until the pilot pans it
    this.drag = null;
    const cv = this.cv;
    cv.addEventListener('mousedown', e => { this.drag = { x: e.clientX, y: e.clientY, vx: this.view.x, vz: this.view.z, moved: false }; });
    addEventListener('mousemove', e => {
      if (!this.drag) return;
      const k = this.cv.width / cv.getBoundingClientRect().width, dx = (e.clientX - this.drag.x) * k, dy = (e.clientY - this.drag.y) * k;
      if (Math.abs(dx) + Math.abs(dy) > 4) this.drag.moved = true;
      if (this.drag.moved) { this.follow = false; this.view.x = this.drag.vx - dx * this.view.mpp; this.view.z = this.drag.vz - dy * this.view.mpp; this.draw(); }
    });
    addEventListener('mouseup', e => {
      const d = this.drag; this.drag = null;
      if (d && !d.moved && e.target === cv) { this.target = this.toWorld(e); this.draw(); }
    });
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const w = this.toWorld(e), f = e.deltaY < 0 ? 0.8 : 1.25, mpp = Math.max(1.2, Math.min(70, this.view.mpp * f));
      this.view.x = w.x - (w.x - this.view.x) * mpp / this.view.mpp; this.view.z = w.z - (w.z - this.view.z) * mpp / this.view.mpp; this.view.mpp = mpp; this.follow = false; this.draw();
    }, { passive: false });
    el('sightClose').onclick = () => this.close();
    el('sightDrop').onclick = () => this.drop();
    el('sightClear').onclick = () => { this.target = null; this.draw(); };
    el('sightCentre').onclick = () => { this.follow = true; this.centre(); this.draw(); };
    el('sightSalvo').oninput = () => { this.salvo = +el('sightSalvo').value; this.draw(); };
    addEventListener('keydown', e => {
      if (!this.open_) return;
      if (e.code === 'Escape' || e.code === 'KeyN') { e.preventDefault(); e.stopPropagation(); this.close(); }
      else if (e.code === 'Enter') { e.preventDefault(); e.stopPropagation(); this.drop(); }
      else if (e.code === 'KeyC') { this.follow = true; this.centre(); this.draw(); }
    }, true);
  }
  toWorld(e) {
    const r = this.cv.getBoundingClientRect(), k = this.cv.width / r.width;
    return { x: this.view.x + ((e.clientX - r.left) * k - this.cv.width / 2) * this.view.mpp, z: this.view.z + ((e.clientY - r.top) * k - this.cv.height / 2) * this.view.mpp };
  }
  sx(x) { return this.cv.width / 2 + (x - this.view.x) / this.view.mpp; }
  sy(z) { return this.cv.height / 2 + (z - this.view.z) / this.view.mpp; }
  centre() { const s = this.o.state(); this.view.x = this.target ? (s.pos[0] + this.target.x) / 2 : s.pos[0]; this.view.z = this.target ? (s.pos[2] + this.target.z) / 2 : s.pos[2]; }

  open() {
    const s = this.o.state();
    this.open_ = true; this.root.classList.remove('hidden');
    this.salvo = Math.max(1, Math.min(this.salvo, s.left));
    const sl = el('sightSalvo'); sl.max = s.left; sl.value = this.salvo;
    this.follow = true; this.centre();
    // fit the aircraft and the target (if any) on the map
    const span = this.target ? Math.hypot(s.pos[0] - this.target.x, s.pos[2] - this.target.z) * 1.4 : 5000;
    this.view.mpp = Math.max(2, Math.min(60, span / this.cv.width));
    this.draw();
  }
  /** Called every frame while the sight is open: the aircraft keeps flying, so the map, the prediction and the cues are redrawn (about 12 times a second). */
  tick(dt) {
    if (!this.open_) return;
    this.age = (this.age || 0) + dt;
    if (this.age < 0.08) return;
    this.age = 0;
    if (this.follow) this.centre();
    const s = this.o.state(); this.salvo = Math.max(1, Math.min(this.salvo, s.left || 1));
    const sl = el('sightSalvo'); if (+sl.max !== s.left) { sl.max = s.left; sl.value = this.salvo; }
    this.draw();
  }
  close() { if (!this.open_) return; this.open_ = false; this.root.classList.add('hidden'); this.o.onClose(); }
  drop() { if (!this.open_) return; const n = this.salvo; this.close(); this.o.onDrop(n); }

  /** The bomb released now: nominal flight over the real ground (craters, trees and buildings included). */
  predict() {
    const s = this.o.state();
    const pr = BM.predict(s.type, s.bay, s.relVel || s.vel, s.wind, this.o.env);       // from the bay as it will be when the doors are open
    return { s, pr };
  }

  /** Hill-shaded map of the ground under the view (cached until the view or the craters change). */
  renderTerrain() {
    const v = this.view, W = this.tex.width, H = this.tex.height, M = this.M, tv = this.texView, ver = this.o.craters.dmg.version;
    if (tv && tv.mpp === v.mpp && tv.ver === ver && Math.abs(tv.x - v.x) / v.mpp < 2 * M - 8 && Math.abs(tv.z - v.z) / v.mpp < 2 * M - 8) return;      // still inside the margin of the cached picture
    this.texView = { x: v.x, z: v.z, mpp: v.mpp, ver };
    const g = this.tex.getContext('2d'), img = g.createImageData(W, H), f = this.o.field, st = v.mpp * 2;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const x = v.x + ((i - M) * 2 - this.cv.width / 2) * v.mpp, z = v.z + ((j - M) * 2 - this.cv.height / 2) * v.mpp, h = f.at(x, z), k = (j * W + i) * 4;
      let r, gr, b;
      if (h < 0.2) { const d = Math.min(1, -h / 70); r = 34 - 18 * d; gr = 96 - 44 * d; b = 138 - 58 * d; }
      else {
        const sh = 1 + Math.max(-0.45, Math.min(0.5, (f.at(x - st, z - st) - f.at(x + st, z + st)) / (st * 0.9)));
        if (h < 7) { r = 216; gr = 201; b = 160; }
        else if (h < 420) { const t = h / 420; r = 108 + 40 * t; gr = 150 - 20 * t; b = 70 + 10 * t; }
        else if (h < 900) { const t = (h - 420) / 480; r = 148 - 10 * t; gr = 130 + 5 * t; b = 80 + 50 * t; }
        else { r = gr = b = 235; }
        r *= sh; gr *= sh; b *= sh;
      }
      img.data[k] = r; img.data[k + 1] = gr; img.data[k + 2] = b; img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }

  draw() {
    if (!this.open_) return;
    const g = this.g, W = this.cv.width, H = this.cv.height, v = this.view;
    this.renderTerrain();
    g.imageSmoothingEnabled = true; const tv = this.texView; g.drawImage(this.tex, (tv.x - v.x) / v.mpp - 2 * this.M, (tv.z - v.z) / v.mpp - 2 * this.M, this.tex.width * 2, this.tex.height * 2);
    const { s, pr } = this.predict();
    // grid
    const step = v.mpp > 25 ? 5000 : v.mpp > 6 ? 1000 : v.mpp > 2.5 ? 250 : 100;
    g.strokeStyle = 'rgba(255,255,255,.16)'; g.fillStyle = 'rgba(255,255,255,.55)'; g.font = '11px sans-serif'; g.lineWidth = 1;
    for (let x = Math.ceil((v.x - W / 2 * v.mpp) / step) * step; x < v.x + W / 2 * v.mpp; x += step) { g.beginPath(); g.moveTo(this.sx(x), 0); g.lineTo(this.sx(x), H); g.stroke(); g.fillText(`${x / 1000}k`, this.sx(x) + 3, 12); }
    for (let z = Math.ceil((v.z - H / 2 * v.mpp) / step) * step; z < v.z + H / 2 * v.mpp; z += step) { g.beginPath(); g.moveTo(0, this.sy(z)); g.lineTo(W, this.sy(z)); g.stroke(); g.fillText(`${-z / 1000}k N`, 4, this.sy(z) - 3); }
    // the runway and the airfield
    const R = window.FSWorld.RUNWAY;
    g.fillStyle = '#2a2c30'; g.fillRect(this.sx(R.x - R.width / 2), this.sy(R.z1), Math.max(2, R.width / v.mpp), R.length / v.mpp);
    g.strokeStyle = '#e8e8e2'; g.lineWidth = 1; g.strokeRect(this.sx(R.x - R.width / 2), this.sy(R.z1), Math.max(2, R.width / v.mpp), R.length / v.mpp);
    for (const st of this.o.world.structs) if (!st.dead) { g.fillStyle = '#c9ced6'; g.fillRect(this.sx(st.x) - Math.max(1.5, st.r / v.mpp), this.sy(st.z) - Math.max(1.5, st.r / v.mpp), Math.max(3, st.r * 2 / v.mpp), Math.max(3, st.r * 2 / v.mpp)); }
    // craters
    g.strokeStyle = 'rgba(30,10,0,.9)'; g.lineWidth = 1.5;
    for (const c of this.o.craters.dmg.list) { const r = Math.max(1.5, c.R / v.mpp); g.beginPath(); g.arc(this.sx(c.x), this.sy(c.z), r, 0, 7); g.stroke(); }
    // the aircraft, its track and the predicted flight of the bomb
    const hdg = Math.atan2(s.vel[0], -s.vel[2]), px = this.sx(s.pos[0]), py = this.sy(s.pos[2]);
    g.setLineDash([6, 6]); g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.sin(hdg) * 4000 / v.mpp * 3, py - Math.cos(hdg) * 4000 / v.mpp * 3); g.stroke(); g.setLineDash([]);
    if (pr) {
      g.strokeStyle = '#ffb347'; g.lineWidth = 2; g.beginPath(); pr.path.forEach((p, i) => (i ? g.lineTo(this.sx(p[0]), this.sy(p[2])) : g.moveTo(this.sx(p[0]), this.sy(p[2])))); g.lineTo(this.sx(pr.p[0]), this.sy(pr.p[2])); g.stroke();
      const ix = this.sx(pr.p[0]), iy = this.sy(pr.p[2]);
      g.strokeStyle = '#ff5a3a'; g.lineWidth = 3; g.beginPath(); g.moveTo(ix - 9, iy - 9); g.lineTo(ix + 9, iy + 9); g.moveTo(ix + 9, iy - 9); g.lineTo(ix - 9, iy + 9); g.stroke();
      g.fillStyle = '#ff5a3a'; g.font = 'bold 12px sans-serif'; g.fillText(`IMPACT ${(pr.t + s.delay).toFixed(1)} s`, ix + 12, iy - 6);
    }
    if (s.delay > 0.05) {                    // where the aircraft will be when the doors are open and the first bomb leaves
      const rx = this.sx(s.relPos[0]), ry = this.sy(s.relPos[2]);
      g.strokeStyle = '#ffd23a'; g.lineWidth = 2; g.beginPath(); g.moveTo(px, py); g.lineTo(rx, ry); g.stroke();
      g.beginPath(); g.arc(rx, ry, 5, 0, 7); g.fillStyle = '#ffd23a'; g.fill();
    }
    g.save(); g.translate(px, py); g.rotate(hdg); g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, -12); g.lineTo(9, 10); g.lineTo(0, 5); g.lineTo(-9, 10); g.closePath(); g.fill(); g.stroke(); g.restore();
    // the target, the miss, the release cue
    let cue = '', miss = '';
    if (this.target && pr) {
      const T = this.target, tx = this.sx(T.x), ty = this.sy(T.z);
      for (const rr of [50, 100, 200]) { g.strokeStyle = 'rgba(80,255,140,.55)'; g.lineWidth = 1; g.beginPath(); g.arc(tx, ty, rr / v.mpp, 0, 7); g.stroke(); }
      g.strokeStyle = '#4dff8a'; g.lineWidth = 2.5; g.beginPath(); g.arc(tx, ty, 9, 0, 7); g.moveTo(tx - 16, ty); g.lineTo(tx + 16, ty); g.moveTo(tx, ty - 16); g.lineTo(tx, ty + 16); g.stroke();
      g.setLineDash([3, 4]); g.beginPath(); g.moveTo(this.sx(pr.p[0]), this.sy(pr.p[2])); g.lineTo(tx, ty); g.stroke(); g.setLineDash([]);
      const u = [Math.sin(hdg), -Math.cos(hdg)], rt = [-u[1], u[0]];            // along the ground track, and to its right
      const dx = pr.p[0] - T.x, dz = pr.p[2] - T.z, along = dx * u[0] + dz * u[1], cross = dx * rt[0] + dz * rt[1];
      miss = `${Math.round(Math.hypot(dx, dz))} m  (${Math.abs(Math.round(along))} m ${along < 0 ? 'short' : 'long'}, ${Math.abs(Math.round(cross))} m ${cross < 0 ? 'left' : 'right'})`;
      // where on the present track the bomb would have to leave: the target minus how far a bomb travels (assumes the same speed / height / heading)
      // where on the present track DROP has to be pressed: the aircraft must be displaced by (target - predicted impact) from where it is now (the doors' delay is already in the prediction)
      const rp = [s.pos[0] + T.x - pr.p[0], s.pos[2] + T.z - pr.p[2]], d = [rp[0] - s.pos[0], rp[1] - s.pos[2]];
      const dAlong = d[0] * u[0] + d[1] * u[1], dCross = d[0] * rt[0] + d[1] * rt[1], gs = Math.hypot(s.vel[0], s.vel[2]);
      g.strokeStyle = '#7fd0ff'; g.lineWidth = 2; g.beginPath(); g.arc(this.sx(rp[0]), this.sy(rp[1]), 6, 0, 7); g.stroke();
      g.fillStyle = '#7fd0ff'; g.font = '11px sans-serif'; g.fillText('press DROP here', this.sx(rp[0]) + 9, this.sy(rp[1]) + 4);
      cue = dAlong > 0 ? `DROP point is ${Math.round(dAlong)} m ahead (${fmtT(dAlong / Math.max(1, gs))}), ${Math.abs(Math.round(dCross))} m ${dCross < 0 ? 'left' : 'right'} of your track` : `DROP point passed ${Math.round(-dAlong)} m ago - turn around`;
    }
    // side panel
    const gs = Math.hypot(s.vel[0], s.vel[2]), hd = (hdg / DEG + 360) % 360, ww = Math.hypot(s.wind[0], s.wind[1]), wf = (Math.atan2(-s.wind[0], s.wind[1]) / DEG + 360) % 360;
    const B = BM.BOMBS[s.type];
    el('sightInfo').textContent = `${s.left} × ${B.name} aboard · ${Math.round(s.mass)} kg of bombs`;
    const agl = s.pos[1] - Math.max(0, this.o.field.at(s.pos[0], s.pos[2]));
    el('sightData').innerHTML = [
      ['Height above ground', `${Math.round(agl)} m (${Math.round(agl * 3.281)} ft)`], ['Ground speed', `${Math.round(gs * 1.944)} kt`],
      ['Track', `${String(Math.round(hd)).padStart(3, '0')}° ${compass(hd)}`], ['Wind', `${String(Math.round(wf)).padStart(3, '0')}° at ${Math.round(ww * 1.944)} kt`],
      ['Predicted impact', pr ? (pr.kind === 'water' ? 'in the sea' : pr.kind === 'object' ? 'on a tree / building' : 'on the ground') : '-'],
      ['Doors open in', s.delay > 0.05 ? `${s.delay.toFixed(1)} s (${Math.round(s.delay * gs)} m of flight)` : 'open'], ['Time to impact', pr ? `${(pr.t + s.delay).toFixed(1)} s from DROP` : '-'], ['Bomb speed at impact', pr ? `${Math.round(Math.hypot(...pr.v))} m/s` : '-'],
      ['Target', this.target ? `${Math.round(Math.hypot(this.target.x - s.pos[0], this.target.z - s.pos[2]))} m away` : 'click the map'], ['Miss if released now', miss || '-'],
      ['Salvo', `${this.salvo} of ${s.left}${this.salvo > 1 ? ` · stick ~${Math.round(gs * B.spacing * (this.salvo - 1))} m long` : ''}`],
    ].map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
    el('sightCue').textContent = cue || (this.target ? '' : 'Pick the point you want to hit. The prediction is for a bomb released this instant; fly so that it lands there, then drop.');
    el('sightSalvoN').textContent = this.salvo;
  }
}
