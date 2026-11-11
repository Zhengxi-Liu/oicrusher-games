/**
 * The two carriers as 3D objects (hull, flight deck with its markings, island, radar, AA mounts, wake): used by the carrier map of the flight sim.
 * buildCarrier(info, parent) -> {label, group, info, dish, flag, sink, smokeT}; CarrierMap.js moves them with the round clock.
 */
import * as THREE from 'three';
import { buildCarrierPlane } from './CarrierModels.js?v=19';

const CW = window.CWWorld;
const TEAM_COL = ['#4f8fe0', '#e05a52'];

function deckTexture(team) {
  const w = 256, h = 1440, c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), D = CW.DECK, X = z => (D.len / 2 + z) / D.len * h * 0 + (z + D.len / 2) / D.len * h, Y = x => (x + D.hw) / (2 * D.hw) * w, S = w / (2 * D.hw);
  const grd = g.createLinearGradient(0, 0, w, 0); grd.addColorStop(0, '#42474d'); grd.addColorStop(0.5, '#4d535a'); grd.addColorStop(1, '#42474d');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${i % 3 ? '0,0,0' : '255,255,255'},${0.02 + Math.random() * 0.03})`; g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 14, 1 + Math.random() * 3); }
  // elevators (the lift outlines), catapult tracks, edge lines, centre line, landing-area box, wires, numerals
  g.lineWidth = 3; g.strokeStyle = '#d9b43a';
  for (const [x0, x1, z0, z1] of [[-22, -6, -70, -42], [6, 22, 10, 38]]) { g.strokeRect(Y(x0), X(z0), (x1 - x0) * S, (z1 - z0) * (h / D.len)); g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(Y(x0), X(z0), (x1 - x0) * S, (z1 - z0) * (h / D.len)); }
  g.strokeStyle = '#2c3034'; g.lineWidth = 5;
  for (const x of [-4, 4]) { g.beginPath(); g.moveTo(Y(x), X(-122)); g.lineTo(Y(x), X(70)); g.stroke(); }
  g.strokeStyle = '#2c3034'; g.lineWidth = 2; for (const x of [-4, 4]) for (let z = -120; z < 70; z += 6) { g.beginPath(); g.moveTo(Y(x) - 3, X(z)); g.lineTo(Y(x) + 3, X(z)); g.stroke(); }
  g.strokeStyle = '#e9e9e1'; g.lineWidth = 4; g.beginPath(); g.moveTo(Y(-D.hw + 1.5), 0); g.lineTo(Y(-D.hw + 1.5), h); g.moveTo(Y(D.hw - 1.5), 0); g.lineTo(Y(D.hw - 1.5), h); g.stroke();
  g.setLineDash([34, 22]); g.lineWidth = 3; g.beginPath(); g.moveTo(Y(0), 0); g.lineTo(Y(0), h); g.stroke(); g.setLineDash([]);
  g.strokeRect(Y(-11), X(15), 22 * S, 100 * (h / D.len));                                    // the landing area
  g.strokeStyle = '#1c1f22'; g.lineWidth = 4;                                                // arrestor wires across the landing area, with their rollers
  for (const z of [25, 45, 65, 85]) { const y = X(D.len / 2 - z); g.beginPath(); g.moveTo(Y(-D.hw + 3), y); g.lineTo(Y(D.hw - 3), y); g.stroke(); g.fillStyle = '#7d848b'; g.fillRect(Y(-D.hw + 1), y - 4, 10, 8); g.fillRect(Y(D.hw - 1) - 10, y - 4, 10, 8); }
  for (let k = 0; k < 40; k++) { g.fillStyle = 'rgba(10,10,10,.22)'; g.fillRect(Y((Math.random() - 0.5) * 16), X(25 + Math.random() * 70), 3, 5 + Math.random() * 20); }   // tyre marks
  g.fillStyle = '#e9e9e1'; g.font = 'bold 130px Arial'; g.textAlign = 'center';
  g.save(); g.translate(Y(0), X(-62)); g.fillText(team ? '赤' : '27', 0, 0); g.restore();
  g.fillStyle = team ? '#c4161c' : '#1b3b84'; g.beginPath(); g.arc(Y(0), X(-108), 22, 0, 7); g.fill();
  g.fillStyle = '#e9e9e1'; g.beginPath(); g.moveTo(Y(-12), X(-96)); g.lineTo(Y(12), X(-96)); g.lineTo(Y(0), X(-80)); g.fill();
  const t = new THREE.CanvasTexture(g.canvas); t.anisotropy = 8; return t;
}
function sideTexture(team) {                              // hull side: plating seams, rivet rows, weathering streaks, a row of portholes
  const c = document.createElement('canvas'); c.width = 512; c.height = 128; const g = c.getContext('2d');
  const base = team ? [66, 78, 72] : [76, 88, 100];
  g.fillStyle = `rgb(${base})`; g.fillRect(0, 0, 512, 128);
  for (let i = 0; i < 90; i++) { const x = Math.random() * 512, w = 2 + Math.random() * 6, l = 20 + Math.random() * 90; const gr = g.createLinearGradient(0, 0, 0, l); gr.addColorStop(0, 'rgba(40,30,22,.28)'); gr.addColorStop(1, 'rgba(40,30,22,0)'); g.fillStyle = gr; g.save(); g.translate(x, Math.random() * 60); g.fillRect(0, 0, w, l); g.restore(); }
  g.strokeStyle = 'rgba(20,25,30,.35)'; g.lineWidth = 1.5;
  for (let y = 24; y < 128; y += 26) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
  for (let x = 0; x < 512; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 128); g.stroke(); }
  g.fillStyle = 'rgba(255,255,255,.07)'; for (let y = 22; y < 128; y += 26) for (let x = 0; x < 512; x += 6) g.fillRect(x, y, 2, 1.5);
  for (let x = 14; x < 512; x += 32) { g.fillStyle = '#0c1116'; g.beginPath(); g.arc(x, 20, 5, 0, 7); g.fill(); g.strokeStyle = 'rgba(210,214,218,.55)'; g.lineWidth = 1.5; g.stroke(); }
  g.fillStyle = 'rgba(70,35,20,.16)'; for (let i = 0; i < 40; i++) g.fillRect(Math.random() * 512, 90 + Math.random() * 38, 3 + Math.random() * 22, 2 + Math.random() * 6);
  const grd = g.createLinearGradient(0, 0, 0, 128); grd.addColorStop(0, 'rgba(255,255,255,.1)'); grd.addColorStop(1, 'rgba(0,0,0,.28)'); g.fillStyle = grd; g.fillRect(0, 0, 512, 128);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}
function foamBlobTexture() {                               // soft foam noise for the water around the hull
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 700; i++) { const x = Math.random() * 128, y = Math.random() * 128, r = 1 + Math.random() * 5; for (const [ox, oy] of [[0, 0], [128, 0], [-128, 0], [0, 128], [0, -128]]) { const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r); gr.addColorStop(0, `rgba(255,255,255,${0.2 + Math.random() * 0.5})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2); } }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
/** A lofted hull between two heights: station 0 is the bow (z = -L/2) and 1 the stern. Upper levels flare out and overhang the bow. */
function hullGeo(D, y0, y1, k0, k1, { uvScale = 1, closed = false, capped = false } = {}) {
  const NS = 48, NL = 4, L = D.hullLen, pos = [], uv = [], idx = [];
  const plan = s => s < 0.16 ? Math.pow(s / 0.16, 0.75) : s > 0.92 ? 1 - 0.22 * Math.pow((s - 0.92) / 0.08, 2) : 1;
  for (let side = 0; side < 2; side++) for (let i = 0; i <= NS; i++) for (let j = 0; j <= NL; j++) {
    const s = i / NS, f = j / NL, y = y0 + (y1 - y0) * f, k = k0 + (k1 - k0) * f;
    const rake = 1 + 0.07 * Math.max(0, (y - 0) / 20) * (s < 0.5 ? 1 : 0.4);                 // the top overhangs at the bow
    const flare = 1 + 0.4 * Math.max(0, 1 - s / 0.28) * Math.max(0, y / 20);                 // bow flare
    const z = (s - 0.5) * L * (s < 0.5 ? rake : 1 + 0.02 * Math.max(0, y / 20)), x = D.hullHw * k * plan(s) * flare * (side ? 1 : -1);
    pos.push(x, y, z); uv.push(z / 40 * uvScale, f);
  }
  const at = (side, i, j) => side * (NS + 1) * (NL + 1) + i * (NL + 1) + j;
  for (let side = 0; side < 2; side++) for (let i = 0; i < NS; i++) for (let j = 0; j < NL; j++) {
    const a = at(side, i, j), b = at(side, i + 1, j), c = at(side, i + 1, j + 1), d = at(side, i, j + 1);
    if (side) idx.push(a, d, c, a, c, b); else idx.push(a, b, c, a, c, d);                      // bow to stern, outward faces
  }
  for (let j = 0; j < NL; j++) { const a = at(0, NS, j), b = at(1, NS, j), c = at(1, NS, j + 1), d = at(0, NS, j + 1); idx.push(a, d, c, a, c, b); }   // transom
  if (closed) for (let i = 0; i < NS; i++) { const a = at(0, i, 0), b = at(0, i + 1, 0), c = at(1, i + 1, 0), d = at(1, i, 0); idx.push(a, c, b, a, d, c); }   // keel
  if (capped) for (let i = 0; i < NS; i++) { const a = at(0, i, NL), b = at(0, i + 1, NL), c = at(1, i + 1, NL), d = at(1, i, NL); idx.push(a, b, c, a, c, d); }   // a lid under the flight deck, so nobody can see into the hollow hull
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals(); return geo;
}
export function flagTexture(team) {
  const c = document.createElement('canvas'); c.width = 96; c.height = 56; const g = c.getContext('2d');
  if (team === 0) { for (let i = 0; i < 7; i++) { g.fillStyle = i % 2 ? '#f2f2f2' : '#b22234'; g.fillRect(0, i * 8, 96, 8); } g.fillStyle = '#1b3b84'; g.fillRect(0, 0, 40, 32); g.fillStyle = '#fff'; for (let y = 4; y < 30; y += 7) for (let x = 5; x < 38; x += 8) g.fillRect(x, y, 2, 2); }
  else { g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, 96, 56); g.fillStyle = '#c4161c'; g.beginPath(); g.arc(40, 28, 17, 0, 7); g.fill(); for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; g.beginPath(); g.moveTo(40, 28); g.arc(40, 28, 56, a, a + 0.1); g.fill(); } }
  return new THREE.CanvasTexture(c);
}
export function foamTexture() {                                // the bow wave, hull foam and a long straight wake astern
  const c = document.createElement('canvas'); c.width = 128; c.height = 1024; const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 1024);
  for (let i = 0; i < 5000; i++) {
    const v = Math.random(), y = v * 1024, edge = y < 300 ? 0.5 + y / 300 * 0.5 : 1;                 // top = bow
    const wake = y > 330 ? Math.max(0, 1 - (y - 330) / 694) : 1, spread = y > 330 ? 0.18 + (y - 330) / 694 * 0.8 : 0.28 + Math.min(1, y / 300) * 0.1;
    const x = 64 + (Math.random() + Math.random() - 1) * 64 * spread * (y > 330 ? 1 : 1.2);
    g.fillStyle = `rgba(255,255,255,${(0.1 + Math.random() * 0.5) * wake * edge})`; g.fillRect(x, y, 1 + Math.random() * 5, 2 + Math.random() * 9);
  }
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
}
/** A parked, wings-folded aircraft as a handful of merged meshes (the full model is hundreds of parts; a deck holds eight): one prototype per type, cloned per spot. */
const parkedProto = {};
function parkedPlane(id) {
  if (!parkedProto[id]) {
    const m = buildCarrierPlane(id, { cockpit: false, fold: true }), root = m.root; m.disc.visible = false; root.updateMatrixWorld(true);
    const buckets = new Map(), keep = new THREE.Group();
    root.traverse(o => {
      if (!o.isMesh || !o.visible) return;
      if (o.material.map || o.material.transparent) { const c = o.clone(); o.matrixWorld.decompose(c.position, c.quaternion, c.scale); keep.add(c); return; }
      let geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      geo.applyMatrix4(o.matrixWorld);
      for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
      if (!geo.attributes.normal) geo.computeVertexNormals();
      const key = o.material.uuid; if (!buckets.has(key)) buckets.set(key, { mat: o.material, geos: [] }); buckets.get(key).geos.push(geo);
    });
    const out = new THREE.Group();
    for (const { mat, geos } of buckets.values()) {
      let n = 0; for (const q of geos) n += q.attributes.position.count;
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3); let at = 0;
      for (const q of geos) { pos.set(q.attributes.position.array, at * 3); nor.set(q.attributes.normal.array, at * 3); at += q.attributes.position.count; }
      const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); mg.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      const mesh = new THREE.Mesh(mg, mat); mesh.castShadow = true; mesh.receiveShadow = true; out.add(mesh);
    }
    for (const c of keep.children) out.add(c);
    const spec = window.FSPhysics.TYPES[id], rest = new THREE.Group();
    out.position.y = spec.restHeight; out.rotation.x = spec.restPitch;                       // wheels on the deck
    rest.add(out); parkedProto[id] = rest;
  }
  const c = parkedProto[id].clone(); c.rotation.y = Math.PI;                     // tails to the bow: nose toward the stern, the way deck crews spot them
  const wrap = new THREE.Group(); wrap.add(c); return wrap;
}
export function buildCarrier(info, parent) {
  const D = CW.DECK, g = new THREE.Group(), half = D.len / 2;
  const mat = (color, rough = 0.62, metal = 0.25, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
  const hullGrey = mat(info.team ? 0x5a665f : 0x66717c, 0.6, 0.3), rust = mat(0x5e2a24, 0.85, 0.2), towerM = mat(0x9099a2, 0.7, 0.2), dark = mat(0x23272c, 0.7, 0.3), steel = mat(0x7d858d, 0.5, 0.6);
  const glassM = mat(0x0e2238, 0.2, 0.6, { emissive: 0x2a5078, emissiveIntensity: 0.55 });
  const outline = (hw, k = 1) => {                                                 // plan view; shape y = -z, so +y is the bow
    const s = new THREE.Shape(), L = half * k;
    s.moveTo(-hw, -L); s.lineTo(hw, -L); s.lineTo(hw + 0.5, L * 0.3); s.lineTo(hw - 3, L * 0.8); s.lineTo(hw * 0.35, L * 0.97); s.lineTo(0, L); s.lineTo(-hw * 0.35, L * 0.97); s.lineTo(-hw + 3, L * 0.8); s.lineTo(-hw - 0.5, L * 0.3); s.closePath(); return s;
  };
  const slab = (shape, y0, y1, m) => { const geo = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, curveSegments: 4 }); geo.rotateX(-Math.PI / 2); geo.translate(0, y0, 0); const mesh = new THREE.Mesh(geo, m); mesh.castShadow = mesh.receiveShadow = true; g.add(mesh); return mesh; };
  const lowerHull = new THREE.Mesh(hullGeo(D, -9, 0.6, 0.55, 1.0, { closed: true }), rust); lowerHull.castShadow = true; g.add(lowerHull);       // below the waterline: red anti-fouling paint
  const sideMat = new THREE.MeshStandardMaterial({ map: sideTexture(info.team), roughness: 0.62, metalness: 0.25, side: THREE.DoubleSide });
  const upperHull = new THREE.Mesh(hullGeo(D, 0.6, D.y - 1.2, 1.0, 1.42, { capped: true }), sideMat); upperHull.castShadow = upperHull.receiveShadow = true; g.add(upperHull);   // the flared hull up to the deck edge
  // the flight deck: tapered at the bow, with the deck texture mapped on by position
  const dshape = new THREE.Shape(), hw = D.hw;
  dshape.moveTo(-hw, -half); dshape.lineTo(hw, -half); dshape.lineTo(hw, half - 34); dshape.lineTo(hw - 10, half - 8); dshape.lineTo(hw - 16, half); dshape.lineTo(-hw + 16, half); dshape.lineTo(-hw + 10, half - 8); dshape.lineTo(-hw, half - 34); dshape.closePath();
  const dgeo = new THREE.ExtrudeGeometry(dshape, { depth: 1.2, bevelEnabled: false }); dgeo.rotateX(-Math.PI / 2); dgeo.translate(0, D.y - 1.2, 0);
  { const p = dgeo.attributes.position, uv = dgeo.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + hw) / (2 * hw), (half - p.getZ(i)) / D.len); }
  const deck = new THREE.Mesh(dgeo, [new THREE.MeshStandardMaterial({ map: deckTexture(info.team), roughness: 0.88, metalness: 0.05 }), hullGrey]); deck.receiveShadow = true; deck.castShadow = true; g.add(deck);
  // deck-edge: catwalk strips with safety netting and handrails, plus the deck-edge lights
  const rail = mat(0x2a2f34, 0.8, 0.3), netM = new THREE.MeshStandardMaterial({ color: 0x3a4a3a, roughness: 1, transparent: true, opacity: 0.7, side: THREE.DoubleSide });
  for (const s of [-1, 1]) {
    const cw = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.3, 250), rail); cw.position.set(s * (D.hw + 1.1), D.y - 0.9, 8); cw.castShadow = true; g.add(cw);
    const net = new THREE.Mesh(new THREE.PlaneGeometry(250, 1.4), netM); net.rotation.y = Math.PI / 2; net.position.set(s * (D.hw + 2.2), D.y - 0.1, 8); g.add(net);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9, 250), rail); lip.position.set(s * (D.hw + 2.25), D.y + 0.05, 8); g.add(lip);
    for (let z = -118; z <= 128; z += 18) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.28, 6, 4), new THREE.MeshBasicMaterial({ color: s < 0 ? 0xff5a3a : 0x6aff8a })); l.position.set(s * (D.hw - 0.6), D.y + 0.15, z); g.add(l); }
  }
  // parked aircraft: the real models with their wings folded up, in two columns hard against the deck edges (outside every take-off lane and the landing area)
  const parked = new THREE.Group(); g.add(parked);
  { const kinds = info.team ? ['zero', 'suisei', 'val', 'kate'] : ['hellcat', 'corsair', 'dauntless', 'avenger'];
    [[-19.6, -97, 0.04], [-19.6, -79, -0.03], [-19.6, -61, 0.05], [-19.6, -43, -0.02], [19.6, -97, -0.05], [19.6, -79, 0.03], [19.6, -61, -0.04], [19.6, -43, 0.02]].forEach(([px, pz, rot], n) => {
      const p = parkedPlane(kinds[n % 4]); p.position.set(px, D.y, pz); p.rotation.y = Math.PI * 0 + rot; parked.add(p);
    }); }
  // the island: stacked blocks, bridge windows, a raked funnel, a tripod mast with a rotating radar, yardarm and a flag
  const isl = new THREE.Group(); isl.position.set(22.5, D.y, -18); g.add(isl);
  const box = (w, h, d, x, y, z, m = towerM, parent = isl) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = b.receiveShadow = true; parent.add(b); return b; };
  box(17, 8, 31, 0, 4, 0); box(14, 4, 22, -1, 10, 2); box(10.5, 3.6, 14, -1.5, 13.8, 0);
  for (const z of [-7.05, 7.05]) box(10, 1.3, 0.2, -1.5, 13.9, z * (z < 0 ? 1 : 1) * 1.0, glassM);                  // bridge windows (fore and aft faces)
  box(0.2, 1.3, 13, 3.75, 13.9, 0, glassM); box(0.2, 1.3, 13, -6.75, 13.9, 0, glassM);
  box(3.6, 2.4, 5, 1.0, 16.6, 1, towerM);                                                                        // the flag bridge / radar room
  const funnel = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 3.5, 9, 18), dark); funnel.position.set(3.2, 8.5, 13.5); funnel.rotation.x = -0.14; funnel.castShadow = true; isl.add(funnel);
  const fcap = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 2.9, 0.5, 18), mat(0x0a0a0a)); fcap.position.set(3.2 + 0.35, 13.1, 13.5 + 0.65); fcap.rotation.x = -0.14; isl.add(fcap);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 12, 8), steel); mast.position.set(0.5, 24.5, 1); isl.add(mast);
  for (const [dx, dz] of [[-1.6, -1.2], [1.6, -1.2], [0, 2]]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 9.5, 6), steel); leg.position.set(0.5 + dx * 0.55, 21.2, 1 + dz * 0.55); leg.rotation.set(dz * 0.07, 0, -dx * 0.07); isl.add(leg); }
  const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 9, 6), steel); yard.rotation.z = Math.PI / 2; yard.position.set(0.5, 27.4, 1); isl.add(yard);
  const dish = new THREE.Group(); dish.position.set(0.5, 31, 1); isl.add(dish);
  { const bowl = new THREE.Mesh(new THREE.SphereGeometry(2.4, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), steel); bowl.rotation.x = Math.PI / 2.4; bowl.scale.set(1.5, 0.45, 1); bowl.position.y = 0.4; dish.add(bowl);
    const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 4), dark); feed.rotation.x = Math.PI / 2; feed.position.set(0, 0.5, -0.9); dish.add(feed);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 1.2, 8), steel); base.position.y = -0.5; dish.add(base); }
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(5, 3), new THREE.MeshBasicMaterial({ map: flagTexture(info.team), side: THREE.DoubleSide })); flag.position.set(0.5, 29, 4.5); flag.rotation.y = Math.PI / 2; isl.add(flag);
  // AA: real articulated mounts (the AA module aims them). USN: 5"/38 dual-purpose guns, quad 40 mm Bofors, single 20 mm Oerlikons.
  // IJN: twin 12.7 cm Type 89 guns and triple 25 mm Type 96 mounts. Each mount = {type, x, y, z, yaw, pitch, muzzleLen, pivotY}
  const usn = !info.team, mounts = [], gunMetal = mat(0x30363c, 0.55, 0.5), gunHouse = mat(info.team ? 0x59645c : 0x626d78, 0.7, 0.3);
  const MOUNT_DEFS = info.team
    ? { heavy: [[-28, -70], [-28, 10], [-28, 90], [28.5, -92], [28.5, 52], [28.5, 112]], light: [[-27, -122], [-27, -30], [-27, 50], [-27, 120], [27.5, -118], [27.5, 12], [27.5, 76], [27.5, 134]] }
    : { heavy: [[27.5, -58], [27.5, 70], [-27.5, -88], [-27.5, 82]], light: [[-27, -122], [-27, -40], [-27, 20], [27, 36], [27, 100], [27, -96]], tiny: [[-25.5, -105], [-25.5, -62], [-25.5, 2], [-25.5, 60], [-25.5, 112], [25.5, -110], [25.5, 130], [-25.5, 134]] };
  const addMount = (type, x, z) => {
    const y = D.y - 1.6, root = new THREE.Group(); root.position.set(x, y, z); g.add(root);
    const spon = new THREE.Mesh(new THREE.BoxGeometry(type === 'heavy' ? 8 : 6.4, 1.2, type === 'heavy' ? 9 : 7), hullGrey); spon.position.y = -0.7; spon.castShadow = true; root.add(spon);
    const tub = new THREE.Mesh(new THREE.CylinderGeometry(type === 'heavy' ? 2.5 : 1.9, type === 'heavy' ? 2.7 : 2.1, 1.5, 14, 1, true), hullGrey); tub.position.y = 0.4; tub.material.side = THREE.DoubleSide; root.add(tub);
    const yaw = new THREE.Group(); root.add(yaw); const pitch = new THREE.Group(); yaw.add(pitch);
    let pivotY = 1.2, muzzleLen = 3;
    const barrel = (len, r, x0, y0) => { const b = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, len, 8), gunMetal); b.rotation.x = Math.PI / 2; b.position.set(x0, y0, -len / 2); b.castShadow = true; pitch.add(b); const tip = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.15, r * 1.15, 0.35, 8), gunMetal); tip.rotation.x = Math.PI / 2; tip.position.set(x0, y0, -len); pitch.add(tip); };
    if (type === 'heavy') {                                                       // a gun house with the barrels coming out of a mantlet
      const house = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 2.0, 1.6, 14), gunHouse); house.position.y = 1.2; house.castShadow = true; yaw.add(house);
      const top = new THREE.Mesh(new THREE.SphereGeometry(1.7, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), gunHouse); top.position.y = 1.9; top.scale.y = 0.55; top.castShadow = true; yaw.add(top);
      pivotY = 1.5; pitch.position.y = pivotY; muzzleLen = usn ? 5.6 : 5.0;
      const man = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.0, 1.0), gunHouse); man.position.set(0, 0, -1.5); pitch.add(man);
      for (const dx of [-0.5, 0.5]) barrel(muzzleLen, usn ? 0.13 : 0.15, dx, 0);
    } else if (type === 'light') {                                                // quad Bofors (USN) / triple 25 mm (IJN)
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.5, 0.9, 10), gunHouse); base.position.y = 0.45; yaw.add(base);
      const shield = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.6, 0.18), gunHouse); shield.position.set(0, 1.5, -0.4); yaw.add(shield);
      pivotY = 1.5; pitch.position.y = pivotY; muzzleLen = usn ? 2.4 : 2.2;
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 1.2), gunMetal); body.position.z = 0.1; pitch.add(body);
            for (const [dx, dy] of (usn ? [[-0.4, -0.25], [0.4, -0.25], [-0.4, 0.25], [0.4, 0.25]] : [[-0.45, -0.2], [0.45, -0.2], [0, 0.3]])) barrel(muzzleLen, 0.07, dx, dy);
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.6), dark); seat.position.set(0, 1.1, 1.3); yaw.add(seat);
    } else {                                                                      // single 20 mm on a pedestal
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 1.2, 8), gunMetal); ped.position.y = 0.6; yaw.add(ped);
      pivotY = 1.4; pitch.position.y = pivotY; muzzleLen = 1.8;
      const sh = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 0.1), gunHouse); sh.position.set(0, 0.1, -0.5); pitch.add(sh);
      barrel(muzzleLen, 0.05, 0, 0);
    }
    mounts.push({ type, x, y: y + pivotY, z, yaw, pitch, muzzleLen, cool: 1 + Math.random() * 3, left: 0, t: 0, tgt: null, bias: [0, 0, 0] });
  };
  for (const [x, z] of MOUNT_DEFS.heavy) addMount('heavy', x, z);
  for (const [x, z] of MOUNT_DEFS.light) addMount('light', x, z);
  for (const [x, z] of (MOUNT_DEFS.tiny || [])) addMount('tiny', x, z);
  // water: hull foam and a straight wake behind the stern (the carrier steams north: +z is astern)
  const foam = new THREE.Mesh(new THREE.PlaneGeometry(70, 640), new THREE.MeshBasicMaterial({ map: foamTexture(), transparent: true, depthWrite: false, opacity: 0.9 }));
  foam.rotation.x = -Math.PI / 2; foam.position.set(0, 0.25, 145); foam.renderOrder = 1; g.add(foam);
  const lbl = document.createElement('canvas'); lbl.width = 512; lbl.height = 64; const lg = lbl.getContext('2d');
  lg.fillStyle = 'rgba(0,0,0,.55)'; lg.fillRect(0, 0, 512, 64); lg.fillStyle = TEAM_COL[info.team]; lg.font = 'bold 40px Arial'; lg.textAlign = 'center'; lg.fillText(info.name.toUpperCase(), 256, 46);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(lbl), depthTest: false, transparent: true, fog: false })); sp.scale.set(120, 15, 1); sp.position.set(0, D.y + 70, 0); sp.renderOrder = 5; g.add(sp);
  g.position.set(info.x, 0, info.z); parent.add(g);
  return { label: sp, group: g, info, dish, flag, sink: 0, smokeT: 0, mounts };
}
