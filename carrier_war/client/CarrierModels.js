/**
 * CarrierModels - the eight carrier aircraft, built from the island sim's own parts (lofted airfoil wings with hinged control surfaces,
 * propellers, landing gear from PlaneModel.js) but shaped like the real thing: super-elliptic lofted fuselages with each type's own side
 * profile (the Avenger's deep bay, the Hellcat's hump and chin, the Corsair's long nose), framed greenhouse canopies, each type's fin,
 * 1943 US star-and-bar / Hinomaru laid onto the skin, IJN brown props, the torpedoes from Bombing.js (Mk 13 / Type 91):
 *   F6F Hellcat    fat round R-2800 cowling, raised turtledeck behind a bubble canopy, big three-blade prop, six wing guns
 *   SBD Dauntless  deep fuselage, long two-seat greenhouse with the rear gunner's twin guns, PERFORATED SPLIT DIVE BRAKES top and bottom of
 *                  every wing, bomb trapeze (swing arm) under the belly, tailhook
 *   A6M Zero       slim fuselage, small black cowl, teardrop canopy, long elliptical wings with yellow leading-edge ID strips, two 20 mm wing cannon
 *   D3A Val        elliptical wings, fixed spatted undercarriage, long greenhouse, dive brakes under the wings, bomb crutch under the belly
 *   TBF Avenger    barrel fuselage, huge wings, a ball turret on the back, the torpedo hung under the belly
 *   B5N Kate       slim fuselage, long glasshouse, the torpedo under the belly
 * Same frame as the physics: nose -z, up +y, CG at the origin. Returns what animatePlane() and main.js use:
 *   {root, hinges, prop, disc, canopy, cockpitGroup, gear, speedBrake, rack, hook, livery}
 */
import * as THREE from 'three';
import { surface, fuselage, propeller, wheel, camoMaterial } from '../../flight_sim/client/PlaneModel.js?v=19';
import { PAINT } from './CarrierPlanes.js?v=8';
import { buildCockpit } from '../../flight_sim/client/Cockpit.js?v=6';
import { torpedoMesh } from '../../flight_sim/client/Bombing.js?v=4';

const CP = window.CWPlanes;

/** Perforated dive-brake plate texture: dark plate with a grid of round holes. */
function perforated() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64; const g = c.getContext('2d');
  g.fillStyle = '#6f757c'; g.fillRect(0, 0, 128, 64); g.fillStyle = '#15181b';
  for (let y = 5; y < 64; y += 10) for (let x = (y / 10 | 0) % 2 ? 9 : 4; x < 128; x += 10) { g.beginPath(); g.arc(x, y, 3.2, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

// ---------- per-aircraft layout. Wing stations are [span, chord, leading edge z, height]; the physics wing spans match (see CarrierPlanes.js).
// body: fuselage cross-sections [z, half width, top y, bottom y] (super-ellipses, so the sides can be flat and the belly deep, unlike a lathe);
// hood: the canopy [z, half width, top y] from the windscreen back, a frame at every station (it sits on the body's top line).
// vtail / htail stations as the wing. spin: spinner colour (null: a bare prop hub, as on the US radials).
const CFG = {
  corsair: {                                                         // F4U-1D: very long nose, cockpit far aft under a blown "Malcolm" hood, INVERTED GULL wing (the kink is the lowest point, the gear sits on it)
    body: [[-3.0, 1.05, 1.06, -1.04], [-2.0, 1.0, 1.05, -1.02], [-0.6, 0.92, 1.03, -0.96], [0.6, 0.84, 1.03, -0.88], [1.7, 0.74, 1.12, -0.78], [2.7, 0.6, 1.08, -0.64], [3.9, 0.44, 0.82, -0.48], [5.0, 0.3, 0.62, -0.32], [6.0, 0.15, 0.5, -0.16], [6.5, 0.03, 0.42, 0.0]],
    cowl: { r: 1.08, z0: -4.4, z1: -2.95 }, prop: { blades: 3, radius: 2.0, chord: 0.32, z: -4.7 },
    hood: [[-0.35, 0.34, 1.05], [0.1, 0.42, 1.42], [0.9, 0.46, 1.58], [1.8, 0.43, 1.52], [2.55, 0.3, 1.16]],
    wing: [[0.5, 3.5, -1.3, 0.5], [2.2, 3.0, -1.0, -0.78], [4.3, 2.2, -0.75, -0.55], [6.2, 1.25, -0.4, -0.15]], flap: [0.8, 4.2], ail: [4.4, 5.95], tip: 6.2, gull: true,
    htail: [[0.15, 1.55, 4.95, 0.25], [1.9, 1.2, 5.12, 0.25], [2.7, 0.55, 5.45, 0.25]], vtail: [[0.3, 1.95, 4.8, 0], [1.6, 1.45, 5.2, 0], [2.35, 0.9, 5.62, 0], [2.6, 0.4, 5.95, 0]],
    gear: { main: [2.0, -2.05, -0.9, 0.46], strut: [1.7, -0.55, -0.75] }, tail: [0, -0.62, 5.6, 0.18], guns: 3, insignia: 3.0, pylonBombs: true, under: 0xe9eae6,
  },
  suisei: {                                                          // D4Y: liquid-cooled inline engine (a pointed nose, chin radiator, exhaust stacks, no round cowling), slim fuselage, long glasshouse, tall swept fin
    body: [[-3.15, 0.33, 0.36, -0.32], [-2.7, 0.5, 0.56, -0.5], [-1.8, 0.62, 0.74, -0.64], [-0.5, 0.66, 0.84, -0.66], [1.0, 0.6, 0.86, -0.6], [2.4, 0.48, 0.8, -0.48], [3.6, 0.36, 0.66, -0.36], [5.0, 0.23, 0.54, -0.22], [5.85, 0.11, 0.46, -0.1], [6.1, 0.02, 0.42, 0.0]],
    cowl: { r: 0.36, z0: -3.5, z1: -3.1, inline: true }, prop: { blades: 3, radius: 1.45, chord: 0.24, z: -3.7 }, spin: 0x6a3426,
    hood: [[-0.75, 0.3, 0.88], [-0.35, 0.36, 1.24], [0.4, 0.38, 1.32], [1.2, 0.38, 1.32], [2.0, 0.36, 1.26], [2.75, 0.26, 0.98]],
    wing: [[0.4, 2.5, -1.0, -0.35], [3.0, 1.9, -0.7, -0.2], [5.75, 0.85, -0.2, 0.0]], flap: [0.7, 3.0], ail: [3.3, 5.4], tip: 5.75,
    htail: [[0.12, 1.3, 4.7, 0.25], [1.7, 0.95, 4.92, 0.25], [2.2, 0.5, 5.15, 0.25]], vtail: [[0.25, 1.8, 4.4, 0], [1.6, 1.2, 4.98, 0], [2.3, 0.72, 5.36, 0], [2.45, 0.35, 5.6, 0]],
    gunner: 2.3, chin: true, gear: { main: [1.5, -1.9, -0.9, 0.38], strut: [1.2, -0.5, -0.75] }, tail: [0, -0.58, 5.3, 0.14], guns: 0, nose: 1, insignia: 2.6, brakes: 'under', trapeze: true, rudderBand: true, under: 0xa3aa9c,
  },
  hellcat: {                                                         // F6F-5: big deep fuselage with the cowling's chin intakes, the cockpit high on a hump, flat centre section then dihedral, square-cut tips, tall rounded fin
    body: [[-2.75, 0.98, 0.98, -1.1], [-1.8, 0.95, 1.02, -1.08], [-0.6, 0.87, 1.06, -1.02], [0.6, 0.79, 1.06, -0.96], [1.7, 0.67, 1.18, -0.84], [3.1, 0.5, 0.9, -0.64], [4.5, 0.34, 0.66, -0.44], [5.6, 0.18, 0.52, -0.24], [6.35, 0.04, 0.44, 0.0]],
    cowl: { r: 1.0, z0: -3.95, z1: -2.65, sy: 1.06, y: -0.05, chin: true }, prop: { blades: 3, radius: 1.75, chord: 0.3, z: -4.2 },
    hood: [[-0.8, 0.4, 1.1], [-0.35, 0.44, 1.48], [0.3, 0.46, 1.58], [1.1, 0.43, 1.53], [1.75, 0.34, 1.26]],
    wing: [[0.5, 3.0, -1.35, -0.55], [2.1, 2.72, -1.2, -0.52], [6.0, 1.2, -0.42, -0.02]], flap: [0.7, 3.0], ail: [3.2, 5.7], tip: 6.0,
    htail: [[0.15, 1.6, 4.85, 0.3], [2.0, 1.22, 5.08, 0.3], [2.7, 0.6, 5.4, 0.3]], vtail: [[0.3, 2.0, 4.6, 0], [1.6, 1.55, 5.05, 0], [2.3, 1.0, 5.5, 0], [2.6, 0.42, 5.92, 0]],
    gear: { main: [1.8, -1.95, -0.9, 0.44], strut: [1.4, -0.5, -0.75] }, tail: [0, -0.62, 5.5, 0.18], guns: 3, insignia: 2.5, under: null,
  },
  dauntless: {                                                       // SBD-3: deep fuselage, a long two-seat greenhouse with the gunner's twin .30s, the telescopic sight through the windscreen, square-ish fin, perforated split flaps
    body: [[-2.75, 0.9, 0.92, -0.92], [-1.8, 0.88, 0.98, -0.94], [-0.6, 0.82, 1.0, -0.92], [0.6, 0.76, 1.0, -0.88], [1.8, 0.66, 0.98, -0.78], [3.0, 0.52, 0.86, -0.64], [4.4, 0.36, 0.66, -0.46], [5.5, 0.2, 0.54, -0.26], [6.45, 0.04, 0.44, 0.0]],
    cowl: { r: 0.93, z0: -3.85, z1: -2.7 }, prop: { blades: 3, radius: 1.6, chord: 0.27, z: -4.05 },
    hood: [[-0.65, 0.34, 1.02], [-0.25, 0.4, 1.4], [0.45, 0.42, 1.48], [1.2, 0.42, 1.48], [1.95, 0.42, 1.46], [2.65, 0.38, 1.36], [3.15, 0.28, 1.08]],
    wing: [[0.5, 3.0, -1.3, -0.55], [3.0, 2.6, -1.05, -0.28], [5.6, 1.75, -0.6, -0.02], [6.1, 1.1, -0.38, 0.03]], flap: [0.7, 3.2], ail: [3.4, 5.9], tip: 6.1,
    htail: [[0.15, 1.65, 4.85, 0.3], [2.2, 1.2, 5.15, 0.3], [2.75, 0.6, 5.45, 0.3]], vtail: [[0.3, 2.0, 4.6, 0], [1.6, 1.62, 4.95, 0], [2.3, 1.15, 5.35, 0], [2.6, 0.5, 5.8, 0]],
    gunner: 2.6, sight: true, gear: { main: [1.85, -1.95, -0.9, 0.44], strut: [1.4, -0.55, -0.75] }, tail: [0, -0.62, 5.5, 0.18], guns: 0, nose: 2, insignia: 3.4, brakes: 'split', trapeze: true, under: 0xdfe2df,
  },
  avenger: {                                                         // TBF-1: a barrel of a fuselage with the deep torpedo bay, the step of the ventral gun position behind it, a long greenhouse ending in the ball turret, a huge angular fin
    body: [[-2.8, 1.03, 1.05, -1.06], [-1.8, 1.02, 1.12, -1.22], [-0.4, 0.98, 1.2, -1.24], [1.0, 0.92, 1.22, -1.22], [2.0, 0.8, 1.2, -1.14], [2.55, 0.72, 1.12, -0.82], [3.6, 0.56, 0.96, -0.7], [4.8, 0.38, 0.78, -0.48], [5.9, 0.2, 0.64, -0.26], [6.6, 0.04, 0.55, 0.0]],
    cowl: { r: 1.05, z0: -4.0, z1: -2.75 }, prop: { blades: 3, radius: 1.8, chord: 0.31, z: -4.3 },
    hood: [[-0.75, 0.42, 1.24], [-0.3, 0.5, 1.66], [0.5, 0.52, 1.76], [1.3, 0.5, 1.76], [2.0, 0.48, 1.72], [2.4, 0.44, 1.66]], turret: 2.75, tunnel: 2.3,
    wing: [[0.5, 3.3, -1.45, -0.6], [2.4, 3.0, -1.3, -0.55], [6.0, 1.75, -0.6, 0.0], [6.4, 1.2, -0.45, 0.04]], flap: [0.7, 3.2], ail: [3.5, 6.1], tip: 6.4,
    htail: [[0.15, 1.8, 4.95, 0.4], [2.4, 1.3, 5.2, 0.4], [3.05, 0.7, 5.5, 0.4]], vtail: [[0.3, 2.2, 4.65, 0], [2.0, 1.6, 5.22, 0], [2.85, 1.08, 5.58, 0], [3.1, 0.5, 5.9, 0]],
    gear: { main: [2.0, -2.0, -0.9, 0.46], strut: [1.5, -0.55, -0.75] }, tail: [0, -0.7, 5.6, 0.18], guns: 1, insignia: 3.9, torp: 'mk13', under: 0xe6e8e6,
  },
  kate: {                                                            // B5N2: slim fuselage, a very long three-seat glasshouse, the Type 91 torpedo slung under the belly, tall rounded fin
    body: [[-2.7, 0.78, 0.86, -0.76], [-1.8, 0.78, 0.9, -0.8], [-0.6, 0.74, 0.92, -0.78], [0.8, 0.68, 0.92, -0.72], [2.2, 0.56, 0.86, -0.6], [3.5, 0.42, 0.74, -0.46], [4.8, 0.28, 0.6, -0.3], [5.8, 0.14, 0.5, -0.14], [6.3, 0.03, 0.44, 0.02]],
    cowl: { r: 0.82, z0: -3.7, z1: -2.65, y: 0.04 }, prop: { blades: 3, radius: 1.55, chord: 0.25, z: -3.9 }, spin: 0x9ea3a2,
    hood: [[-0.95, 0.32, 0.92], [-0.55, 0.38, 1.3], [0.2, 0.4, 1.38], [1.0, 0.4, 1.38], [1.8, 0.4, 1.38], [2.6, 0.38, 1.32], [3.25, 0.28, 1.02]],
    wing: [[0.4, 2.8, -1.2, -0.42], [3.0, 2.3, -0.95, -0.24], [5.4, 1.5, -0.55, -0.02], [6.3, 0.75, -0.3, 0.04]], flap: [0.7, 3.2], ail: [3.4, 6.0], tip: 6.3,
    htail: [[0.15, 1.4, 4.9, 0.3], [1.9, 1.05, 5.08, 0.3], [2.45, 0.5, 5.35, 0.3]], vtail: [[0.3, 1.95, 4.55, 0], [1.5, 1.55, 4.9, 0], [2.2, 1.0, 5.28, 0], [2.45, 0.42, 5.62, 0]],
    gunner: 2.85, gear: { main: [1.8, -1.95, -0.9, 0.4], strut: [1.45, -0.5, -0.75] }, tail: [0, -0.6, 5.4, 0.15], guns: 0, nose: 1, insignia: 3.0, torp: 'type91', rudderBand: true, under: 0xb9bfb2,
  },
  zero: {                                                            // A6M2: slim and light, black cowl, a long framed canopy faired into the spine, wide rounded wingtips, rounded fin with the tail cone running past the rudder
    body: [[-2.5, 0.72, 0.8, -0.68], [-1.6, 0.7, 0.84, -0.7], [-0.4, 0.66, 0.86, -0.68], [0.8, 0.6, 0.88, -0.62], [1.8, 0.52, 0.88, -0.54], [3.0, 0.4, 0.72, -0.42], [4.4, 0.26, 0.56, -0.28], [5.5, 0.13, 0.45, -0.12], [6.1, 0.03, 0.38, 0.02]],
    cowl: { r: 0.76, z0: -3.55, z1: -2.45, y: 0.05, dark: true }, prop: { blades: 3, radius: 1.5, chord: 0.24, z: -3.7 }, spin: 0x9ea3a2,
    hood: [[-0.6, 0.3, 0.86], [-0.2, 0.36, 1.24], [0.45, 0.38, 1.32], [1.15, 0.35, 1.28], [1.75, 0.28, 1.12], [2.3, 0.18, 0.93]],
    wing: [[0.4, 2.5, -1.05, -0.45], [3.2, 1.95, -0.7, -0.22], [5.2, 1.3, -0.35, -0.05], [6.0, 0.55, -0.05, 0.02]], flap: [0.7, 3.0], ail: [3.3, 5.5], tip: 6.0,
    htail: [[0.12, 1.3, 4.9, 0.22], [1.7, 1.0, 5.05, 0.22], [2.2, 0.5, 5.3, 0.22]], vtail: [[0.25, 1.7, 4.55, 0], [1.3, 1.38, 4.82, 0], [2.0, 0.85, 5.2, 0], [2.25, 0.36, 5.55, 0]],
    idstrip: true, gear: { main: [1.7, -1.9, -0.9, 0.4], strut: [1.3, -0.5, -0.75] }, tail: [0, -0.6, 5.4, 0.15], guns: 1, cowlGuns: true, insignia: 2.9, under: 0xb4bca6,
  },
  val: {                                                             // D3A1: elliptical wing, fixed spatted gear, long greenhouse, a dorsal fin fillet running far forward along the spine, the telescopic sight, dive brakes under the wings
    body: [[-3.0, 0.76, 0.84, -0.8], [-2.0, 0.76, 0.88, -0.82], [-0.8, 0.72, 0.9, -0.8], [0.8, 0.66, 0.9, -0.74], [2.2, 0.54, 0.84, -0.6], [3.5, 0.4, 0.72, -0.46], [4.8, 0.27, 0.6, -0.3], [5.9, 0.13, 0.5, -0.14], [6.2, 0.03, 0.46, 0.0]],
    cowl: { r: 0.84, z0: -3.7, z1: -2.95, y: 0.02 }, prop: { blades: 3, radius: 1.55, chord: 0.25, z: -3.9 }, spin: 0x9ea3a2,
    hood: [[-0.85, 0.32, 0.92], [-0.45, 0.38, 1.3], [0.35, 0.4, 1.38], [1.15, 0.4, 1.38], [1.95, 0.38, 1.34], [2.65, 0.32, 1.18], [3.05, 0.24, 0.96]],
    wing: [[0.4, 2.7, -1.15, -0.4], [2.6, 2.4, -1.0, -0.25], [4.9, 1.65, -0.7, -0.05], [6.5, 0.7, -0.25, 0.1]], flap: [0.7, 3.0], ail: [3.2, 6.0], tip: 6.5,
    htail: [[0.15, 1.4, 4.85, 0.3], [1.8, 1.05, 5.02, 0.3], [2.3, 0.5, 5.28, 0.3]], vtail: [[0.3, 1.95, 4.5, 0], [1.5, 1.45, 4.92, 0], [2.2, 0.92, 5.26, 0], [2.45, 0.4, 5.55, 0]],
    fillet: [[0.3, 2.6, 2.4, 0], [0.95, 0.9, 4.6, 0]], gunner: 2.6, sight: true, spats: true,
    gear: { main: [1.75, -1.95, -0.9, 0.4], strut: [1.5, -0.5, -0.75] }, tail: [0, -0.6, 5.4, 0.15], guns: 0, nose: 2, insignia: 3.0, brakes: 'under', rudderBand: true, under: 0xa9ae9f,
  },
};

const lerpSt = (st, z, k) => { if (z <= st[0][0]) return st[0][k]; for (let i = 0; i < st.length - 1; i++) { const a = st[i], b = st[i + 1]; if (z <= b[0]) return a[k] + (b[k] - a[k]) * (z - a[0]) / (b[0] - a[0]); } return st[st.length - 1][k]; };
const SE = 2.5;                                                       // cross-section squareness (2 = ellipse)
const sepow = (v, n) => Math.sign(v) * Math.abs(v) ** (2 / n);
/** The fuselage as two lofted halves: the upper in the top colour, the lower in the underside colour. */
function body(st, top, under) {
  const SEG = 14, half = (a0, a1, mat) => {
    const pos = [], idx = [];
    for (const [z, w, yt, yb] of st) { const mid = (yt + yb) / 2, h = (yt - yb) / 2;
      for (let i = 0; i <= SEG; i++) { const a = a0 + (a1 - a0) * i / SEG; pos.push(w * sepow(Math.cos(a), SE), mid + h * sepow(Math.sin(a), SE), z); } }
    for (let k = 0; k < st.length - 1; k++) for (let i = 0; i < SEG; i++) { const p = k * (SEG + 1) + i, q = p + SEG + 1; idx.push(p, p + 1, q, p + 1, q + 1, q); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; return m;
  };
  return [half(0, Math.PI, top), half(Math.PI, Math.PI * 2, under)];
}
/** Half width of the fuselage side at height y, station z (for decals that lie on the skin). */
function sideX(st, y, z) {
  const w = lerpSt(st, z, 1), yt = lerpSt(st, z, 2), yb = lerpSt(st, z, 3), mid = (yt + yb) / 2, h = (yt - yb) / 2;
  const t = Math.min(1, Math.abs((y - mid) / h)); return w * Math.pow(Math.max(0, 1 - t ** SE), 1 / SE);
}
/** A framed greenhouse canopy on the fuselage's top line: glass panels plus a frame at every station, a spine and sills. */
function greenhouse(hood, st, glass, frameMat) {
  const SEG = 12, g = new THREE.Group(), rings = hood.map(([z, w, yt]) => {
    const base = lerpSt(st, z, 2) - 0.1, h = yt - base, pts = [];
    for (let i = 0; i <= SEG; i++) { const a = Math.PI * i / SEG; pts.push(new THREE.Vector3(w * sepow(Math.cos(a), 2.6), base + h * Math.abs(Math.sin(a)) ** (2 / 2.2), z)); }
    return pts;
  });
  const pos = [], idx = [];
  for (const r of rings) for (const p of r) pos.push(p.x, p.y, p.z);
  for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < SEG; i++) { const p = k * (SEG + 1) + i, q = p + SEG + 1; idx.push(p, p + 1, q, p + 1, q + 1, q); }
  for (const [k, flip] of [[0, false], [rings.length - 1, true]]) { const c = pos.length / 3; const r = rings[k]; pos.push(0, r[0].y, r[0].z); for (let i = 0; i < SEG; i++) { const p = k * (SEG + 1) + i; flip ? idx.push(c, p, p + 1) : idx.push(c, p + 1, p); } }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo, glass));
  const tube = (pts, r = 0.02) => { const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, r, 5, false), frameMat); g.add(m); };
  for (const r of rings) tube(r.map(p => new THREE.Vector3(p.x * 1.03, p.y + 0.012, p.z)), 0.024);
  tube(rings.map(r => r[SEG / 2].clone().setY(r[SEG / 2].y + 0.015)), 0.018);
  for (const i of [2, SEG - 2]) tube(rings.map(r => r[i].clone().multiply(new THREE.Vector3(1.03, 1, 1))), 0.014);
  return g;
}
/** A flat decal (geometry in its XY plane) laid onto the fuselage side at station iz, height iy. */
function onSkin(geo, st, s, iz, iy, lift) {
  const P = geo.attributes.position;
  for (let i = 0; i < P.count; i++) { const u = P.getX(i), v = P.getY(i), z = iz - s * u, y = iy + v; P.setXYZ(i, s * (sideX(st, y, z) + lift), y, z); }
  P.needsUpdate = true; return geo;
}
function starShape(R) { const sh = new THREE.Shape(); for (let k = 0; k < 10; k++) { const a = Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? R * 0.382 : R; k ? sh.lineTo(Math.cos(a) * r, Math.sin(a) * r) : sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); } return sh; }

export function buildCarrierPlane(id, { cockpit = true, fold = false } = {}) {
  const C = CFG[id], L = PAINT[id], team = CP.PLANES[id].team, ijn = team === 1;
  const std = (color, rough = 0.5, metal = 0.15) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, side: THREE.DoubleSide });
  const mats = { main: std(L.main, L.rough, L.metal), accent: std(L.accent), trim: std(L.trim, 0.45, 0.25), metal: std(0xa0a6ae, 0.3, 0.85), dark: std(0x1b1d21, 0.6, 0.3),
                 rubber: std(0x16171a, 0.9, 0), glass: new THREE.MeshPhysicalMaterial({ color: 0x9ab8d8, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.34, side: THREE.DoubleSide }),
                 under: C.under == null ? null : std(C.under, 0.55, 0.1) };
  if (L.camo) camoMaterial(mats.main, L.camo);
  if (!mats.under) mats.under = mats.main;                                                          // the late Hellcat: glossy sea blue all over
  mats.ctrl = mats.main;                                                                            // control surfaces in the airframe's own paint
  mats.flap = std(new THREE.Color(L.main).lerp(new THREE.Color(0xdfe6ee), 0.35), 0.5, 0.2);              // the big Fowler flaps read as separate light panels
  const root = new THREE.Group(), hinges = {};
  const add = (o, parent = root) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } parent.add(o); return o; };
  const addSurface = (res, to = root) => { to.add(res.group); Object.assign(hinges, res.hinges); };
  // parked on a carrier: each wing (with everything bolted to it) swings up about the fuselage line, so it takes up a third of the deck width
  const wingPivot = { '-1': new THREE.Group(), '1': new THREE.Group() }; for (const s of [-1, 1]) { root.add(wingPivot[s]); if (fold) wingPivot[s].rotation.z = s * 1.32; }
  const onWing = s => wingPivot[s];
  const speedBrake = [];
  const B = C.body, topAt = z => lerpSt(B, z, 2), botAt = z => lerpSt(B, z, 3), zEnd = B[B.length - 1][0];

  // fuselage: the upper half in the top colour, the belly in the underside colour
  const [fusMain, belly] = body(B, mats.main, mats.under); root.add(fusMain); root.add(belly);

  // engine
  const cw = C.cowl, cl = cw.z1 - cw.z0, cmat = cw.dark ? mats.dark : mats.main, cy = cw.y || 0, csy = cw.sy || 1;
  if (cw.inline) {
    // the D4Y's inline engine: the nose is the fuselage itself; a row of exhaust stacks each side and the spinner
    for (const s of [-1, 1]) for (let k = 0; k < 6; k++) { const z = -2.85 + k * 0.28, ex = add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.16), mats.dark)); ex.position.set(s * (sideX(B, 0.3, z) + 0.03), 0.3, z); }
  } else {
    // radial cowling: a fat cylinder, a bright lip ring, dark engine face with cylinder heads, cowl flaps
    const cowl = add(new THREE.Mesh(new THREE.CylinderGeometry(cw.r * 0.97, cw.r, cl, 32, 1, true), cmat)); cowl.rotation.x = Math.PI / 2; cowl.position.set(0, cy, (cw.z0 + cw.z1) / 2); cowl.scale.set(1, 1, csy);
    const lip = add(new THREE.Mesh(new THREE.TorusGeometry(cw.r * 0.94, cw.r * 0.09, 10, 36), mats.metal)); lip.position.set(0, cy, cw.z0); lip.scale.set(1, csy, 1);
    const face = add(new THREE.Mesh(new THREE.CircleGeometry(cw.r * 0.88, 30), mats.dark)); face.position.set(0, cy, cw.z0 + 0.25); face.rotation.y = Math.PI;
    for (let k = 0; k < (id === 'hellcat' || id === 'corsair' || id === 'avenger' ? 18 : 14); k++) { const a = k / (id === 'hellcat' || id === 'corsair' || id === 'avenger' ? 18 : 14) * Math.PI * 2, h = add(new THREE.Mesh(new THREE.CylinderGeometry(cw.r * 0.06, cw.r * 0.07, 0.22, 8), mats.metal)); h.rotation.x = Math.PI / 2; h.position.set(Math.cos(a) * cw.r * (0.5 + (k % 2) * 0.16), cy + Math.sin(a) * cw.r * (0.5 + (k % 2) * 0.16), cw.z0 + 0.3); }
    const gear = add(new THREE.Mesh(new THREE.CylinderGeometry(cw.r * 0.3, cw.r * 0.34, 0.3, 18), mats.dark)); gear.rotation.x = Math.PI / 2; gear.position.set(0, cy, cw.z0 + 0.15);
    for (let k = 0; k < 18; k++) { const a = k / 18 * Math.PI * 2, f = add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, cw.r * 0.45), mats.dark)); f.position.set(Math.cos(a) * cw.r * 0.99, cy + Math.sin(a) * cw.r * 0.99 * csy, cw.z1 - 0.2); f.rotation.z = a + Math.PI / 2; }
    for (const s of [-1, 1]) { const ex = add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.7), mats.dark)); ex.position.set(s * (cw.r * 0.86), cy - 0.35, cw.z1 + 0.35); ex.rotation.y = s * 0.1; }   // exhaust stubs
    if (cw.chin) {                                                  // the F6F's chin: the oil-cooler and intercooler intakes in the bottom of the cowling
      const ch = add(new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mats.main)); ch.scale.set(1.3, 0.5, 1.6); ch.position.set(0, cy - cw.r * 0.82, cw.z0 + 0.75);
      for (const s of [-1, 0, 1]) { const m = add(new THREE.Mesh(new THREE.BoxGeometry(s ? 0.34 : 0.26, 0.15, 0.06), mats.dark)); m.position.set(s * 0.33, cy - cw.r * 0.84, cw.z0 + 0.05); }
    }
  }
  const prop = propeller(C.prop.blades, C.prop.radius, C.prop.chord, ijn ? std(0x5a3d29, 0.5, 0.3) : mats.dark, mats.metal); prop.position.set(0, cy, C.prop.z); root.add(prop);
  if (ijn) prop.traverse(o => { if (o.isMesh && o.material.color && o.material.color.getHex() === 0xffd23a) o.material = std(0xb8261c); });   // IJN props: brown with red tip stripes
  if (C.spin != null) { const sp = add(new THREE.Mesh(new THREE.ConeGeometry(cw.inline ? 0.36 : 0.3, cw.inline ? 0.75 : 0.65, 20), std(C.spin, 0.35, 0.6))); sp.rotation.x = -Math.PI / 2; sp.position.set(0, cy, C.prop.z - 0.28); }
  else { const hub = add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 8), mats.dark)); hub.scale.set(1, 1, 1.25); hub.position.set(0, cy, C.prop.z - 0.06); }      // US radials: a bare prop hub
  const disc = new THREE.Mesh(new THREE.CircleGeometry(C.prop.radius, 40), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
  disc.position.set(0, cy, C.prop.z - 0.02); root.add(disc);

  // canopy: a framed greenhouse (the glass and its frames hide together in the cockpit view)
  const canopy = greenhouse(C.hood, B, mats.glass, mats.trim); root.add(canopy);
  const hoodEnd = C.hood[C.hood.length - 1];
  if (C.gunner != null) {                                           // the rear gunner: twin guns on a flexible mount, poking out of the open rear of the glasshouse
    const gz = C.gunner, gy = lerpSt(C.hood, gz, 2) - 0.12;
    for (const s of [-1, 1]) { const b = add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.95, 6), mats.dark)); b.rotation.x = Math.PI / 2 - 0.12; b.position.set(s * 0.07, gy, gz + 0.55); }
    const ring = add(new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.02, 6, 16), mats.metal)); ring.position.set(0, gy - 0.06, gz); ring.rotation.x = Math.PI / 2;
  }
  if (C.turret != null) {                                           // TBF: the electric ball turret with its .50 at the end of the greenhouse, on a faired base
    const tz = C.turret, ty = topAt(tz);
    const base = add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.58, 0.32, 20), mats.main)); base.position.set(0, ty + 0.1, tz);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.5, 18, 12), mats.glass); ball.position.set(0, ty + 0.42, tz); canopy.add(ball);
    for (const a of [0, Math.PI / 2]) { const fr = new THREE.Mesh(new THREE.TorusGeometry(0.505, 0.018, 5, 24), mats.trim); fr.position.copy(ball.position); fr.rotation.y = a; canopy.add(fr); }
    const gun = add(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.2, 6), mats.dark)); gun.rotation.x = Math.PI / 2 - 0.12; gun.position.set(0.12, ty + 0.5, tz + 0.75);
  }
  if (C.tunnel != null) {                                           // TBF: the ventral gunner's step with its window and the .30 sticking aft
    const tz = C.tunnel + 0.3, ty = botAt(tz) + 0.05;
    const win = add(new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.25), mats.glass)); win.rotation.x = Math.PI / 2 - 0.25; win.position.set(0, ty, tz - 0.05);
    const gun = add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 6), mats.dark)); gun.rotation.x = Math.PI / 2 + 0.1; gun.position.set(0, ty - 0.05, tz + 0.4);
    for (const s of [-1, 1]) { const sw = add(new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.22), mats.glass)); sw.rotation.y = Math.PI / 2; sw.position.set(s * (sideX(B, -0.2, 3.0) + 0.01), -0.2, 3.0); }   // the radioman's side windows
  }
  if (C.sight) { const tl = add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.7, 8), mats.dark)); tl.rotation.x = Math.PI / 2; tl.position.set(0, C.hood[0][2] + 0.08, C.hood[0][0] - 0.15); }   // the telescopic sight through the windscreen
  if (C.cowlGuns) for (const s of [-1, 1]) { const g = add(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.6, 6), mats.dark)); g.rotation.x = Math.PI / 2; g.position.set(s * 0.2, cy + cw.r * 0.86, cw.z1 - 0.1); }   // the Zero's two 7.7s in the top of the cowl
  if (C.fillet) addSurface(surface(C.fillet, [], mats, { vertical: true, t: 0.07, camber: 0 }));   // the Val's long dorsal fin fillet
  const tail0 = add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), mats.dark)); tail0.position.set(0, topAt(zEnd) - 0.05, zEnd + 0.02);
  const mast = add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.035, 0.55, 6), mats.dark)); mast.position.set(0, topAt(hoodEnd[0] + 0.4) + 0.25, hoodEnd[0] + 0.4); mast.rotation.x = 0.35;   // radio mast behind the canopy
  { const a = mast.position.clone().add(new THREE.Vector3(0, 0.25, 0.1)), b = new THREE.Vector3(0, topAt(4.6) + 1.4, 4.75), d = b.clone().sub(a);       // the aerial wire to the fin
    const w = add(new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, d.length(), 3), mats.dark)); w.position.copy(a).addScaledVector(d, 0.5); w.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); }

  // wings (low, with flaps and ailerons), tailplane, fin + rudder
  const wing = C.wing;
  // height / chord / leading edge of the wing at span x (the gull wing's parts must follow its bend)
  const wingAt = x => { for (let i = 0; i < wing.length - 1; i++) { const a = wing[i], b = wing[i + 1]; if (x <= b[0] || i === wing.length - 2) { const f = Math.max(0, Math.min(1, (x - a[0]) / (b[0] - a[0]))); return { c: a[1] + (b[1] - a[1]) * f, le: a[2] + (b[2] - a[2]) * f, h: a[3] + (b[3] - a[3]) * f, slope: (b[3] - a[3]) / (b[0] - a[0]) }; } } };
  // a bent wing's flap is one hinged panel per straight section, so each follows its section (the inner one ends at the kink)
  const flapCuts = side => {
    const n = side < 0 ? 'L' : 'R', mat = C.gull ? mats.flap : undefined;
    if (!C.gull) return [{ s0: C.flap[0], s1: C.flap[1], name: 'flap' + n, mat }];
    const kink = wing[1][0];
    return [{ s0: C.flap[0], s1: kink, name: 'flap' + n, mat }, { s0: kink, s1: C.flap[1], name: 'flap' + n + '2', mat }];
  };
  for (const side of [-1, 1]) {
    addSurface(surface(wing, [...flapCuts(side), { s0: C.ail[0], s1: C.ail[1], name: side < 0 ? 'aileronL' : 'aileronR' }], mats, { side, t: 0.14, camber: 0.02 }), onWing(side));
    addSurface(surface(C.htail, [{ s0: C.htail[0][0] + 0.05, s1: C.htail[C.htail.length - 2][0], name: side < 0 ? 'elevL' : 'elevR' }], mats, { side, t: 0.09, camber: 0 }));
  }
  addSurface(surface(C.vtail, [{ s0: C.vtail[0][0] + 0.05, s1: C.vtail[C.vtail.length - 2][0], name: 'rudder', mat: C.rudderBand ? mats.accent : mats.ctrl }], mats, { vertical: true, t: 0.09, camber: 0 }));
  // wing guns (and, on the Zero, the long 20 mm barrels sticking out), tip lights
  const g0 = id === 'zero' ? 1.9 : 2.2;
  for (const s of [-1, 1]) for (let k = 0; k < C.guns; k++) { const gun = add(new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, id === 'zero' ? 0.95 : 0.5, 6), mats.dark)); gun.rotation.x = Math.PI / 2; gun.position.set(s * (g0 + k * 0.28), wingAt(g0 + k * 0.28).h - 0.12, wingAt(g0 + k * 0.28).le - 0.1); onWing(s).add(gun); }
  for (const s of [-1, 1]) for (let k = 0; k < (C.nose || 0); k++) { const gun = add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 6), mats.dark)); gun.rotation.x = Math.PI / 2; gun.position.set(s * 0.22, topAt(-2.3) - 0.1, -2.4); }
  for (const s of [-1, 1]) { const nav = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: s < 0 ? 0xff2020 : 0x20ff40 })); nav.position.set(s * C.tip, wingAt(C.tip).h + 0.09, wingAt(C.tip).le + 0.4 * wingAt(C.tip).c); onWing(s).add(nav); }
  if (C.idstrip) for (const s of [-1, 1]) { const y = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.04, 0.12), new THREE.MeshStandardMaterial({ color: 0xe8c43a, roughness: 0.5 })); y.position.set(s * 4.4, -0.07, -0.9); y.rotation.z = -s * 0.03; onWing(s).add(y); }   // IJN yellow leading-edge ID strips

  // landing gear: two mains on struts, a tail wheel; the Val has fixed spats (and the gear never retracts: see CarrierPlanes)
  const G = C.gear, T = C.tail;
  for (const s of [-1, 1]) for (const o of wheel(s * G.main[0], G.main[1], G.main[2], G.main[3], C.spats ? { ...mats, accent: mats.main } : mats, { pant: !!C.spats, strutTo: [s * G.strut[0], G.strut[1], G.strut[2]] })) root.add(o);
  for (const o of wheel(T[0], T[1], T[2], T[3], mats, { strutTo: [0, T[1] + 0.4, T[2] - 0.2] })) root.add(o);

  // the tailhook: an arm hinged under the rear fuselage that lies flush (up) or hangs down (main.js sets hook.rotation.x)
  const hook = new THREE.Group(); hook.position.set(0, -0.3, 4.3); root.add(hook);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 1.5), mats.dark); arm.position.set(0, 0, 0.75); arm.castShadow = true; hook.add(arm);
  const claw = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.18, 0.12), mats.metal); claw.position.set(0, -0.05, 1.5); hook.add(claw);

  // dive brakes
  if (C.brakes === 'split') {
    // SBD: perforated split flaps at the trailing edge of each wing - the upper plate swings up, the lower one down (together they open like a clam)
    const pm = new THREE.MeshStandardMaterial({ map: perforated(), roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide });
    for (const sd of [-1, 1]) for (const dir of [-1, 1]) {
      const x = sd * 1.95, hz = 0.88, hy = -0.26 + dir * -0.0;
      const g = new THREE.Group(); g.position.set(x, hy + (dir < 0 ? 0.16 : -0.16), hz); onWing(sd).add(g);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.035, 0.75), pm); plate.position.z = 0.4; plate.castShadow = true; g.add(plate);
      speedBrake.push({ group: g, axis: new THREE.Vector3(1, 0, 0), angle: dir < 0 ? -1.15 : 1.15 });
    }
  } else if (C.brakes === 'under') {
    // Val: perforated plates under each wing that swing down into the airflow
    const pm = new THREE.MeshStandardMaterial({ map: perforated(), roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide });
    for (const sd of [-1, 1]) {
      const g = new THREE.Group(); g.position.set(sd * 2.6, -0.5, -0.1); onWing(sd).add(g);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.03, 0.8), pm); plate.position.z = 0.4; g.add(plate);
      speedBrake.push({ group: g, axis: new THREE.Vector3(1, 0, 0), angle: 1.3 });
    }
  }

  // bomb on the belly: the Dauntless's swing-arm trapeze (a "fork" that throws the bomb clear of the prop) or the Val's crutch
  let rack = null, pylonBombs = null;
  if (C.torp) {                                                    // the torpedo (the same model as the one that falls, Bombing.js) on its crutch under the belly; hidden when dropped, like the pylon bombs
    const t = new THREE.Group(), P = window.FSPhysics.TYPES[id].bombRack.pylons[0]; t.position.set(...P);
    const tm = torpedoMesh(C.torp); tm.position.set(0, -0.12, C.torp === 'type91' ? 0.2 : 0); t.add(tm);
    const yTop = botAt(P[2]) - P[1];                                   // from the torpedo up to the skin
    for (const dz of [-0.9, 0.7]) { const sl = new THREE.Mesh(new THREE.BoxGeometry(0.1, Math.max(0.1, yTop + 0.1), 0.1), mats.metal); sl.position.set(0, (yTop + 0.1) / 2 - 0.0, dz); t.add(sl);   // suspension band and sway braces
      for (const sd of [-1, 1]) { const br = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.4), mats.metal); br.position.set(sd * 0.22, 0.13, dz); br.rotation.z = sd * 0.6; t.add(br); } }
    if (id === 'avenger') for (const sd of [-1, 1]) {                // the TBF carried it in a bomb bay: the long doors hang open while it is aboard (closed = gone with it)
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.62, 3.2), mats.under); d.position.set(sd * 0.62, yTop - 0.3, 0.1); d.rotation.z = sd * 0.25; t.add(d);
      const bay = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.04, 3.2), mats.dark); bay.position.set(0, yTop + 0.02, 0.1); t.add(bay);
    }
    root.add(t); pylonBombs = [t];
  } else if (id === 'val' || id === 'corsair' || id === 'zero') {                      // the physics hangs the bombs on pylons (Val / Corsair: two under the wings, the bakusen Zero: one on the belly); they vanish as they are dropped
    const pm2 = new THREE.MeshStandardMaterial({ color: 0x4a5236, roughness: 0.6, metalness: 0.2 });
    pylonBombs = window.FSPhysics.TYPES[id].bombRack.pylons.map(r => {
      const b = new THREE.Group(); b.position.set(...r); if (fold) b.position.x = Math.sign(r[0]) * 0.5;       // parked with the wings folded: the bombs hang on the centreline racks
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.9, 6, 12), pm2); body.rotation.x = Math.PI / 2; body.castShadow = true; b.add(body);
      const lug = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.3), mats.metal); lug.position.y = 0.2; b.add(lug);
      root.add(b); return b;
    });
  } else if (C.trapeze) {
    const g = new THREE.Group(); g.position.set(0, -0.85, -0.3); root.add(g);
    const arm1 = id === 'dauntless' ? 1.05 : 0.7;
    for (const sx of [-0.1, 0.1]) { const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, arm1, 0.07), mats.metal); bar.position.set(sx, -arm1 / 2, 0); bar.castShadow = true; g.add(bar); }
    const bomb = new THREE.Group(); bomb.position.set(0, -arm1, 0); g.add(bomb);
    const big = id === 'dauntless' ? 0.2 : 0.14, len = id === 'dauntless' ? 1.25 : 0.95;
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(big, len, 6, 14), new THREE.MeshStandardMaterial({ color: 0x4a5236, roughness: 0.6, metalness: 0.2 })); body.rotation.x = Math.PI / 2; body.castShadow = true; bomb.add(body);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(big * 1.02, big * 1.02, 0.06, 14), new THREE.MeshStandardMaterial({ color: 0xd8c040 })); band.rotation.x = Math.PI / 2; band.position.z = -0.2; bomb.add(band);
    for (let k = 0; k < 4; k++) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, big * 1.8, 0.28), mats.dark); fin.position.set(0, 0, len / 2 + 0.2); fin.rotation.z = k * Math.PI / 2; bomb.add(fin); }
    rack = { group: g, bomb };
  }

  if (C.gull) {                                                      // the Corsair's details: oil-cooler intakes in the wing roots, a chin scoop, a whip aerial
    for (const sd of [-1, 1]) {
      const intake = add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.26, 0.22), mats.dark)); intake.position.set(sd * 1.5, -0.12, -1.72); intake.rotation.z = sd * -0.35;
      const ilip = add(new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.02, 6, 12, Math.PI), mats.metal)); ilip.position.set(sd * 1.5, -0.12, -1.83); ilip.rotation.set(0, 0, Math.PI / 2);
    }
    const oil = add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.5, 12, 1, true), mats.dark)); oil.rotation.x = Math.PI / 2; oil.position.set(0, -0.82, -2.65);                 // the chin intake under the cowling
    const aer = add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.3, 4), mats.dark)); aer.rotation.x = -0.5; aer.position.set(0, 1.5, 2.8);
  }
  if (C.chin) { const ch = add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.32, 1.1), mats.dark)); ch.position.set(0, -0.55, -1.9); const lipc = add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.06), mats.metal)); lipc.position.set(0, -0.55, -2.46); }     // the inline engine's chin radiator
  // national insignia: fuselage sides and wing tops (US blue roundel with white star bar, Japanese red Hinomaru)
  { const iz = C.insignia, iy = (topAt(iz) + botAt(iz)) / 2 + 0.03, col = team === 0 ? 0x1b3b84 : 0xc4161c, R = Math.min(ijn ? 0.5 : 0.46, (topAt(iz) - botAt(iz)) * 0.36);   // no bigger than the skin it sits on
    const bm = c => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const white = bm(0xf4f4f4), blue = bm(col);
    for (const s of [-1, 1]) {                                       // fuselage sides, laid onto the curved skin
      if (ijn) { if (id === 'suisei') root.add(new THREE.Mesh(onSkin(new THREE.CircleGeometry(R + 0.07, 32), B, s, iz, iy, 0.01), white)); root.add(new THREE.Mesh(onSkin(new THREE.CircleGeometry(R, 32), B, s, iz, iy, 0.016), blue)); continue; }
      // US 1943 insignia: white bars with a blue surround, the blue disc, the white star
      root.add(new THREE.Mesh(onSkin(new THREE.PlaneGeometry(R * 3.9, R * 0.62, 24, 4), B, s, iz, iy, 0.008), blue));
      root.add(new THREE.Mesh(onSkin(new THREE.PlaneGeometry(R * 3.6, R * 0.44, 24, 4), B, s, iz, iy, 0.012), white));
      root.add(new THREE.Mesh(onSkin(new THREE.CircleGeometry(R, 32), B, s, iz, iy, 0.016), blue));
      root.add(new THREE.Mesh(onSkin(new THREE.ShapeGeometry(starShape(R * 0.96), 4), B, s, iz, iy, 0.02), white));
    }
    for (const s of [-1, 1]) {                                       // wing tops (and the US star on them), tilted with the wing at that span
      const k = wingAt(C.tip * 0.62), g = new THREE.Group(); g.position.set(s * C.tip * 0.62, k.h + 0.09 * k.c + 0.02, k.le + 0.4 * k.c); g.rotation.order = 'ZXY'; g.rotation.set(-Math.PI / 2, 0, s * Math.atan(k.slope)); onWing(s).add(g);
      const d = new THREE.Mesh(new THREE.CircleGeometry(ijn ? 0.7 : 0.62, 28), blue); g.add(d);
      if (!ijn) { const st = new THREE.Mesh(new THREE.ShapeGeometry(starShape(0.6)), white); st.position.z = 0.004; g.add(st); }
    }
  }

  // cockpit-only items (the view from the pilot's seat)
  let cockpitGroup = null;
  if (cockpit) {
    const eye = window.FSPhysics.TYPES[id].eye;
    cockpitGroup = buildCockpit(eye, team); root.add(cockpitGroup);
    // the pilot's eye is above the fuselage's top line: in the cockpit view the decking is sunk so the panel, coaming and cockpit tub stand clear of it
    { const drop = [fusMain, belly], sink = Math.max(0.38, topAt(eye[2]) - 0.52); let on = false; drop.forEach(m => { if (m) m.userData.sink = true; });
      Object.defineProperty(cockpitGroup, 'visible', { get: () => on, set: v => { if (v === on) return; on = v; for (const m of drop) m.position.y += v ? -sink : sink; } }); }
    cockpitGroup.visible = false;
  }
  const gear = root.children.filter(o => o.userData.leg).map(leg => {
    const centre = Math.abs(leg.position.x) < 0.3;
    return { group: leg, axis: centre ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1), angle: centre ? Math.PI / 2 : Math.sign(leg.position.x) * -Math.PI / 2 };
  });
  root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { root, hinges, prop, disc, canopy, frame: null, cockpitGroup, flame: null, gear, speedBrake, missiles: [], pylonBombs, fans: null, props: null, bay: null, rack, hook, livery: L, type: id };
}
