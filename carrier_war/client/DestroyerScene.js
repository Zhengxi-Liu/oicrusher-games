/**
 * The IJN destroyer escort as a 3D object: a Kagero-class destroyer in her 1944 fit (the superfiring No. 2 mount aft landed for more 25 mm guns, a Type 22
 * radar on the foremast). Lofted hull (fine flared bow with a raked stem, raised forecastle, rounded cruiser stern, red below the waterline, black boot-top),
 * linoleum decks, bridge with a rangefinder, tripod foremast, two raked funnels, two quad 61 cm torpedo mounts, boats on davits, depth-charge racks, ensign.
 * The AA mounts are articulated like the carriers' (CarrierAA.js aims them): two twin 12.7 cm Type 3 gun houses (low-angle guns: 55 deg elevation),
 * triple and single 25 mm Type 96.
 * buildDestroyer(info, parent) -> {label, group, info, flag, wake, stacks, sink, smokeT, mounts, gun}; CarrierMap.js moves it with the fleet.
 * Its geometry (outline, deck heights, bridge / funnels) is the shared CarrierWorld.DD, which is what bombs, torpedoes, rounds and crashes hit.
 */
import * as THREE from 'three';
import { flagTexture, foamTexture } from './CarrierScene.js?v=20';

const CW = window.CWWorld;

/** The hull's half-width at height y over station zl (the same plan as CW.ddHalfWidth at the waterline; flares out above it, rounds in below it). */
function hullW(zl, y) {
  const D = CW.DD, w0 = Math.max(0.04, CW.ddHalfWidth(zl)), deck = CW.ddDeckY(zl), bow = Math.max(0, 1 - (zl + D.len / 2) / 32);
  if (y >= 0) return w0 * (1 + 0.05 * y / deck) + 1.1 * bow * Math.pow(y / deck, 1.6) * Math.min(1, (zl + D.len / 2) / 3);     // bow flare (none at the stem itself)
  const b = keelY(zl); return w0 * (1 - 0.72 * Math.pow(Math.min(1, y / b), 2.4));
}
/** The keel: the forefoot rises at the bow, the run lifts toward the stern (the propellers and rudder sit under the cut-up). */
function keelY(zl) {
  const D = CW.DD, s = (zl + D.len / 2) / D.len;
  return -D.draft * (1 - 0.55 * Math.pow(Math.max(0, 1 - s / 0.06), 2)) * (1 - 0.65 * Math.max(0, (s - 0.88) / 0.12));
}
/** The stem rakes forward above the water: the deck at the bow is ~4 m ahead of the waterline. */
const rakeZ = (zl, y) => zl - 4.2 * Math.pow(Math.max(0, 1 - (zl + CW.DD.len / 2) / 16), 1.5) * Math.max(0, y) / CW.ddDeckY(zl);

function stations() {
  const D = CW.DD, out = [];
  for (let i = 0; i <= 72; i++) { const s = i / 72, zl = -D.len / 2 + D.len * (s < 0.3 ? 0.3 * Math.pow(s / 0.3, 1.25) : s); out.push(zl); }   // denser at the bow
  out.push(D.fcEnd - 0.02, D.fcEnd + 0.02);
  return [...new Set(out.map(z => Math.round(z * 1000) / 1000))].sort((a, b) => a - b);
}

/** A strip of hull side between yA(zl) and yB(zl) on both sides, with the transom (and the keel when `keel`). */
function hullStrip(Z, yA, yB, { keel = false, NL = 5 } = {}) {
  const pos = [], uv = [], idx = [], NS = Z.length - 1;
  for (let side = 0; side < 2; side++) for (let i = 0; i <= NS; i++) for (let j = 0; j <= NL; j++) {
    const zl = Z[i], y = yA(zl) + (yB(zl) - yA(zl)) * j / NL, x = hullW(zl, y) * (side ? 1 : -1);
    pos.push(x, y, rakeZ(zl, y)); uv.push(zl / 10, y / 6);
  }
  const at = (side, i, j) => side * (NS + 1) * (NL + 1) + i * (NL + 1) + j;
  for (let side = 0; side < 2; side++) for (let i = 0; i < NS; i++) for (let j = 0; j < NL; j++) {
    const a = at(side, i, j), b = at(side, i + 1, j), c = at(side, i + 1, j + 1), d = at(side, i, j + 1);
    if (side) idx.push(a, d, c, a, c, b); else idx.push(a, b, c, a, c, d);
  }
  for (let j = 0; j < NL; j++) { const l = at(0, NS, j), r = at(1, NS, j), r1 = at(1, NS, j + 1), l1 = at(0, NS, j + 1); idx.push(l, r, r1, l, r1, l1); }     // transom
  if (keel) for (let i = 0; i < NS; i++) { const l = at(0, i, 0), r = at(1, i, 0), l1 = at(0, i + 1, 0), r1 = at(1, i + 1, 0); idx.push(l, r, l1, r, r1, l1); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals(); return geo;
}
/** The weather decks: forecastle and main deck, one surface (the forecastle break comes out as a bulkhead facing aft). */
function deckGeo(Z) {
  const pos = [], uv = [], idx = [];
  Z.forEach(zl => { const y = CW.ddDeckY(zl), w = hullW(zl, y), z = rakeZ(zl, y); pos.push(-w, y, z, w, y, z); uv.push(0, zl / 4, w / 2.7, zl / 4); });
  for (let i = 0; i < Z.length - 1; i++) { const L = 2 * i, R = 2 * i + 1, L1 = 2 * i + 2, R1 = 2 * i + 3; idx.push(L, L1, R, R, L1, R1); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals(); return geo;
}
function deckTexture() {                                    // brown linoleum held down by brass strips (IJN destroyer weather decks), scuffed
  const c = document.createElement('canvas'); c.width = 64; c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#5d4a3a'; g.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(${i % 2 ? '0,0,0' : '255,240,220'},${0.03 + Math.random() * 0.05})`; g.fillRect(Math.random() * 64, Math.random() * 256, 1 + Math.random() * 6, 1 + Math.random() * 3); }
  g.fillStyle = 'rgba(190,160,90,.55)'; for (let y = 0; y < 256; y += 32) g.fillRect(0, y, 64, 1.5);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
}
function nameTexture() {                                    // the ship's name in white hiragana on the quarter (early-war practice)
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
  g.fillStyle = 'rgba(235,235,230,.92)'; g.font = 'bold 46px "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ゆきかぜ', 128, 34);
  return new THREE.CanvasTexture(c);
}

export function buildDestroyer(info, parent) {
  const D = CW.DD, g = new THREE.Group(), Z = stations();
  const mat = (color, rough = 0.62, metal = 0.25, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
  const grey = mat(0x676f6d, 0.6, 0.3), lightGrey = mat(0x7a827f, 0.65, 0.25), red = mat(0x5e2a24, 0.85, 0.2), black = mat(0x16181a, 0.8, 0.2), steel = mat(0x7d858d, 0.5, 0.6);
  const gunMetal = mat(0x2e3337, 0.55, 0.5), canvas = mat(0x8a8574, 0.95, 0), wood = mat(0x8a6b48, 0.9, 0), glass = mat(0x0e2238, 0.2, 0.6, { emissive: 0x2a5078, emissiveIntensity: 0.4 }), brass = mat(0xa07a3a, 0.4, 0.8);
  const add = (geo, m, x = 0, y = 0, z = 0, p = g) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; p.add(o); return o; };
  const box = (w, h, d, x, y, z, m = grey, p = g) => add(new THREE.BoxGeometry(w, h, d), m, x, y, z, p);
  const cyl = (r0, r1, h, x, y, z, m = grey, p = g, seg = 12) => add(new THREE.CylinderGeometry(r0, r1, h, seg), m, x, y, z, p);
  const FC = D.fc, MD = D.main;

  // ---- hull: anti-fouling red, a black boot-top at the waterline, grey topsides; then the decks
  add(hullStrip(Z, keelY, () => -0.05, { keel: true }), red);
  add(hullStrip(Z, () => -0.05, () => 0.5, { NL: 1 }), black);
  add(hullStrip(Z, () => 0.5, CW.ddDeckY, { NL: 6 }), grey);
  add(deckGeo(Z), new THREE.MeshStandardMaterial({ map: deckTexture(), roughness: 0.9, metalness: 0.05 }));
  // guard rails along the deck edges (stanchions + two wires), the bulwark at the bow
  { const pts = []; for (const side of [-1, 1]) for (let i = 0; i < Z.length - 1; i++) { const z0 = Z[i], z1 = Z[i + 1]; if (Math.abs(z0 - D.fcEnd) < 0.05 && Math.abs(z1 - D.fcEnd) < 0.05) continue;
      for (const h of [0.55, 1.05]) { const y0 = CW.ddDeckY(z0), y1 = CW.ddDeckY(z1); pts.push(side * hullW(z0, y0) * 0.98, y0 + h, rakeZ(z0, y0), side * hullW(z1, y1) * 0.98, y1 + h, rakeZ(z1, y1)); } }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x9aa09c }))); }
  for (const side of [-1, 1]) { const bw = box(0.15, 1.1, 14, side * 2.6, FC + 0.6 + 0.7, -50, grey); bw.rotation.y = side * 0.19; }      // the flare's bulwark at the bow
  { const bk = box(5.2, 1.0, 0.15, 0, FC + 0.5, -46.2, grey); bk.rotation.x = -0.3; }                                                      // breakwater ahead of No. 1 mount
  // ground tackle: anchors in the hawse pipes, chains to the capstans, bollards
  for (const side of [-1, 1]) {
    const an = box(0.25, 1.4, 1.1, side * hullW(-52, FC - 1) + side * 0.12, FC - 1.2, rakeZ(-52, FC - 1), black); an.rotation.y = side * 0.3;
    box(0.3, 0.08, 6, side * 1.0, FC + 0.06, -50, black); cyl(0.35, 0.45, 0.5, side * 1.0, FC + 0.25, -46.8, gunMetal);
    for (const z of [-40, 6, 30, 50]) cyl(0.15, 0.15, 0.45, side * 4.4, CW.ddDeckY(z) + 0.22, z, gunMetal, g, 6);
  }
  // the name on the quarters
  { const nm = new THREE.MeshBasicMaterial({ map: nameTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const side of [-1, 1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), nm); p.position.set(side * (hullW(44, 3.4) + 0.03), 3.4, 44); p.rotation.y = side * Math.PI / 2; g.add(p); } }

  // ---- bridge: deckhouse, enclosed bridge with a window band, open compass platform, the 3 m rangefinder and the Type 94 director
  box(7.4, 2.8, 12.5, 0, FC + 1.4, -24);
  box(6.6, 2.5, 8, 0, FC + 4.05, -25.5);
  { const w = box(6.7, 0.75, 8.1, 0, FC + 4.55, -25.5, glass); w.castShadow = false; }
  box(7.2, 0.35, 8.6, 0, FC + 5.45, -25.5, lightGrey);                                                            // compass platform floor (with the splinter screen below)
  box(7.1, 1.0, 0.12, 0, FC + 6.1, -29.75, grey); for (const side of [-1, 1]) box(0.12, 1.0, 8.4, side * 3.55, FC + 6.1, -25.5, grey);
  cyl(0.9, 1.1, 1.2, 0, FC + 6.3, -24.2, grey);
  { const rf = add(new THREE.CylinderGeometry(0.22, 0.22, 4.2, 8), gunMetal, 0, FC + 7.3, -24.2); rf.rotation.z = Math.PI / 2; for (const s of [-1, 1]) cyl(0.32, 0.32, 0.5, s * 2.1, FC + 7.3, -24.2, gunMetal).rotation.z = Math.PI / 2; }
  box(2.2, 1.5, 2.2, 0, FC + 7.5, -21.6, grey);                                                                   // the director on its tower
  // tripod foremast: pole + two legs, starfish platform with the Type 22 radar horns, yard; masthead at ~25 m
  { const top = 25, base = FC + 5.5;
    cyl(0.22, 0.32, top - base, 0, (top + base) / 2, -20.5, steel, g, 8);
    for (const s of [-1, 1]) { const leg = cyl(0.15, 0.2, 10.5, s * 1.3, base + 4.6, -18.4, steel, g, 6); leg.rotation.z = s * 0.14; leg.rotation.x = -0.2; }
    box(3.2, 0.2, 2.4, 0, 17.6, -20.6, lightGrey);
    for (const s of [-1, 1]) box(0.9, 0.9, 1.4, s * 0.8, 18.3, -21.2, gunMetal);                                    // Type 22 surface radar: the two horn boxes
    const yard = cyl(0.08, 0.08, 7, 0, 21, -20.5, steel, g, 6); yard.rotation.z = Math.PI / 2; }

  // ---- funnels: oval, raked aft, black caps and grilles; deckhouses at their feet, the searchlight platform between them
  const stacks = [];
  for (const [zf, h, r] of [[-8.6, 9.6, 1.9], [6.4, 8.6, 1.75]]) {
    box(5.2, 1.6, 8, 0, MD + 0.8, zf + 0.4, lightGrey);
    const f = new THREE.Group(); f.position.set(0, MD + 1.4, zf); f.rotation.x = 0.13; g.add(f);
    const fg = new THREE.CylinderGeometry(r, r * 1.08, h, 18); fg.translate(0, h / 2, 0); fg.scale(0.72, 1, 1);
    add(fg, grey, 0, 0, 0, f); const cap = new THREE.CylinderGeometry(r * 1.02, r * 1.02, 1.0, 18); cap.translate(0, h - 0.5, 0); cap.scale(0.72, 1, 1); add(cap, black, 0, 0, 0, f);
    for (const s of [-1, 1]) cyl(0.18, 0.18, h * 0.8, s * r * 0.72, h * 0.42, 0.6, steel, f, 6);                     // steam pipes up the side
    stacks.push([0, MD + 1.4 + h + 0.4, zf + h * 0.13]);
  }
  box(3.2, 3.2, 3.2, 0, MD + 1.6 + 1.6, -0.6, lightGrey); cyl(0.75, 0.75, 1.1, 0, MD + 5.6, -0.6, gunMetal);          // searchlight tower
  // ---- torpedo armament: two quad 61 cm Type 92 mounts on the centre line with their shielded breech houses, reload lockers beside the funnels
  for (const [zt, yaw] of [[-1.2 + 4.2, 0.05], [17.5, -0.04]]) {
    const t = new THREE.Group(); t.position.set(0, MD, zt); t.rotation.y = yaw; g.add(t);
    cyl(1.5, 1.7, 0.6, 0, 0.3, 0, gunMetal, t);
    for (let k = 0; k < 4; k++) { const tube = add(new THREE.CylinderGeometry(0.36, 0.36, 8.6, 10), grey, (k - 1.5) * 0.82, 1.15, -0.8, t); tube.rotation.x = Math.PI / 2; }
    box(3.9, 1.9, 3.1, 0, 1.45, 2.3, grey, t); box(3.5, 0.4, 2.7, 0, 2.6, 2.3, grey, t);
  }
  for (const s of [-1, 1]) box(1.4, 1.5, 6.5, s * 3.2, MD + 0.75, 11, lightGrey);
  // mainmast with the ensign (the Rising Sun naval ensign flies from the main at sea)
  cyl(0.16, 0.24, 13, 0, MD + 6.5, 23, steel, g, 8);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.1), new THREE.MeshBasicMaterial({ map: flagTexture(1), side: THREE.DoubleSide })); flag.position.set(0, MD + 11.6, 24.8); flag.rotation.y = Math.PI / 2; g.add(flag);
  // aft deckhouse (where No. 2 mount stood: now a platform for two triple 25 mm), the after control station
  box(5.0, 2.6, 9, 0, MD + 1.3, 33); box(5.6, 0.25, 7.2, 0, MD + 2.7, 33.4, lightGrey);
  // boats on davits amidships, Carley floats on the deckhouses
  for (const s of [-1, 1]) {
    const boat = add(new THREE.SphereGeometry(1, 12, 6), wood, s * 4.5, MD + 2.8, -2.4); boat.scale.set(0.95, 0.55, 3.6);
    for (const dz of [-2.8, 2.8]) { const dv = cyl(0.07, 0.07, 3.4, s * 4.9, MD + 2, -2.4 + dz, steel, g, 5); dv.rotation.z = s * 0.25; }
    box(0.5, 0.35, 2.4, s * 2.3, MD + 1.8, 9.5, canvas);
  }
  // depth-charge racks on the stern and the Type 94 throwers, the paravane crane, smoke generators
  for (const s of [-1, 1]) {
    box(0.9, 0.15, 6, s * 2.6, MD + 0.35, 54.5, gunMetal);
    for (let k = 0; k < 5; k++) { const dc = cyl(0.3, 0.3, 0.75, s * 2.6, MD + 0.8, 52.2 + k * 1.15, mat(0x3a3f2e, 0.8, 0.2), g, 10); dc.rotation.z = Math.PI / 2; }
    const th = cyl(0.18, 0.22, 1.1, s * 1.6, MD + 0.6, 48, gunMetal, g, 8); th.rotation.z = -s * 0.7;
  }
  box(0.8, 0.8, 0.8, 0, MD + 0.4, 57.2, black);

  // ---- AA / guns: articulated mounts {type, x, y, z, yaw, pitch, muzzleLen, maxPitch} for CarrierAA
  const mounts = [];
  const barrel = (pitch, len, r, x0, y0, flashHider) => {
    const b = add(new THREE.CylinderGeometry(r * 0.8, r, len, 8), gunMetal, x0, y0, -len / 2, pitch); b.rotation.x = Math.PI / 2;
    const tip = add(flashHider ? new THREE.CylinderGeometry(r * 2.2, r * 1.1, 0.42, 8) : new THREE.CylinderGeometry(r * 1.1, r * 1.1, 0.3, 8), gunMetal, x0, y0, -len, pitch); tip.rotation.x = Math.PI / 2;
  };
  const addMount = (type, x, z, yBase, yaw0 = 0, tub = true) => {
    const root = new THREE.Group(); root.position.set(x, yBase, z); g.add(root);
    const yaw = new THREE.Group(); yaw.rotation.y = yaw0; root.add(yaw); const pitch = new THREE.Group(); yaw.add(pitch);
    let pivotY, muzzleLen, maxPitch;
    if (type === 'heavy') {                                                             // Type 3 12.7 cm/50 twin in a Model C gun house: slab sides, a sloped face
      cyl(1.9, 2.0, 0.4, 0, 0.2, 0, gunMetal, yaw, 16);
      const hg = new THREE.BoxGeometry(3.7, 2.4, 5.4); const P = hg.attributes.position;
      for (let i = 0; i < P.count; i++) { if (P.getZ(i) < 0 && P.getY(i) > 0) P.setZ(i, P.getZ(i) + 1.1); if (P.getZ(i) > 0 && P.getY(i) > 0) P.setZ(i, P.getZ(i) - 0.35); }
      hg.computeVertexNormals(); add(hg, grey, 0, 1.6, 0.5, yaw);
      box(0.5, 0.35, 0.7, -1.25, 2.95, 0.6, gunMetal, yaw); box(0.5, 0.35, 0.7, 1.25, 2.95, 0.6, gunMetal, yaw);          // sighting hoods
      pivotY = 1.3; pitch.position.set(0, pivotY, -1.9); muzzleLen = 6.35; maxPitch = 55 * Math.PI / 180;
      for (const dx of [-0.62, 0.62]) { barrel(pitch, muzzleLen, 0.13, dx, 0, false); const bag = add(new THREE.CylinderGeometry(0.3, 0.3, 0.7, 8), canvas, dx, 0, -0.1, pitch); bag.rotation.x = Math.PI / 2; }
    } else if (type === 'light') {                                                      // triple 25 mm Type 96 in an open splinter tub
      if (tub) { const t = add(new THREE.CylinderGeometry(2.1, 2.1, 1.1, 16, 1, true), grey, 0, 0.55, 0, root); t.material = grey.clone(); t.material.side = THREE.DoubleSide; }
      cyl(0.45, 0.6, 0.9, 0, 0.45, 0, gunMetal, yaw, 10);
      box(0.4, 0.12, 0.6, -0.95, 0.95, 0.6, gunMetal, yaw); box(0.4, 0.12, 0.6, 0.95, 0.95, 0.6, gunMetal, yaw);                  // the layer's and trainer's seats
      pivotY = 1.25; pitch.position.y = pivotY; muzzleLen = 2.3; maxPitch = 80 * Math.PI / 180;
      box(1.25, 0.5, 1.1, 0, 0, 0.2, gunMetal, pitch);
      for (const dx of [-0.36, 0, 0.36]) { barrel(pitch, muzzleLen, 0.05, dx, 0.05, true); box(0.16, 0.32, 0.42, dx, 0.38, 0.15, gunMetal, pitch); }    // barrels with conical flash hiders, top-mounted magazines
    } else {                                                                            // single 25 mm on a pedestal
      cyl(0.22, 0.35, 1.0, 0, 0.5, 0, gunMetal, yaw, 8);
      pivotY = 1.15; pitch.position.y = pivotY; muzzleLen = 2.3; maxPitch = 80 * Math.PI / 180;
      box(0.4, 0.35, 0.8, 0, 0, 0.2, gunMetal, pitch); barrel(pitch, muzzleLen, 0.05, 0, 0.04, true); box(0.15, 0.3, 0.4, 0, 0.32, 0.15, gunMetal, pitch);
    }
    mounts.push({ type, x, y: yBase + pivotY, z, yaw, pitch, muzzleLen, maxPitch, cool: 1 + Math.random() * 3, left: 0, t: 0, tgt: null, bias: [0, 0, 0] });
  };
  addMount('heavy', 0, -40.5, FC + 0.15, 0);                                            // No. 1 mount on the forecastle
  addMount('heavy', 0, 44.5, MD, Math.PI);                                              // No. 3 mount aft, trained astern
  for (const s of [-1, 1]) {
    addMount('light', s * 1.45, 33.4, MD + 2.85, Math.PI);                                  // two triples where No. 2 mount was
    box(2.6, 0.25, 4.6, s * 3.4, MD + 2.9, 2.8, lightGrey); addMount('light', s * 3.4, 2.8, MD + 3.0, -s * Math.PI / 2);   // beside the after funnel, on bandstands
  }
  box(4.4, 0.25, 3.6, 0, FC + 2.95, -33, lightGrey); addMount('light', 0, -33, FC + 3.1, 0);         // the bandstand ahead of the bridge (1944)
  for (const [x, z] of [[-4.2, -12], [4.2, -12], [-4.4, 15], [4.4, 15], [-4.2, 27], [4.2, 27]]) addMount('tiny', x, z, CW.ddDeckY(z), -Math.sign(x) * Math.PI / 2, false);

  // ---- water: bow wave, hull foam and the wake
  const wake = new THREE.Mesh(new THREE.PlaneGeometry(26, 300), new THREE.MeshBasicMaterial({ map: foamTexture(), transparent: true, depthWrite: false, opacity: 0.85 }));
  wake.rotation.x = -Math.PI / 2; wake.position.set(0, 0.22, 88); wake.renderOrder = 1; g.add(wake);
  // the label seen from afar
  const lbl = document.createElement('canvas'); lbl.width = 512; lbl.height = 64; const lg = lbl.getContext('2d');
  lg.fillStyle = 'rgba(0,0,0,.55)'; lg.fillRect(0, 0, 512, 64); lg.fillStyle = '#e05a52'; lg.font = 'bold 34px Arial'; lg.textAlign = 'center'; lg.fillText(info.name.toUpperCase() + ' (DD)', 256, 44);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(lbl), depthTest: false, transparent: true, fog: false })); sp.scale.set(84, 10.5, 1); sp.position.set(0, 45, 0); sp.renderOrder = 5; g.add(sp);

  g.position.set(info.x, 0, info.z); parent.add(g);
  return { label: sp, group: g, info, flag, wake, stacks, sink: 0, smokeT: 0, stackT: 0, mounts, gun: 'ijnDD', sinkAt: null };
}
