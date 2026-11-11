/**
 * PlaneModel - the four aircraft, built in body axes (nose -z, up +y, CG at the origin: the same
 * frame FlightPhysics uses, so wheels and wingtips sit where the physics puts them).
 *
 * Wings and tails are lofted from a NACA-style airfoil section (taper, sweep, dihedral). Control
 * surfaces are cut out of the trailing edge of the real surface: the wing keeps 0-72 % of the chord
 * there and the aileron / flap / elevator / rudder is the remaining 28 %, hinged on that line, so
 * it sits flush with the wing and rotates about its true (swept) hinge axis.
 *
 *   trainer  Cub Trainer      high wing with struts, cabin windows, two-blade prop
 *   sport    Skyward S-1      low wing, bubble canopy, wheel pants
 *   warbird  Thunder Warbird  long nose, four-blade prop, belly radiator, bubble canopy
 *   jet      Falcon Jet       cropped delta, all-moving tailplane, intake, nozzle + afterburner
 *   seaplane Sea Otter        bush plane on twin floats: high wing with struts, radial engine, water rudders
 *   b29      B-29 Superfortress four-engine bomber: glazed nose, four 4-blade props, bomb-bay doors that open, tricycle gear
 */
import * as THREE from 'three';
import { buildCockpit } from './Cockpit.js?v=6';

/**
 * Six liveries per aircraft family (the index is what the server relays): civil aircraft get glossy paint, war aircraft
 * get service finishes - camouflage (a procedural blotch pattern, see camoMaterial), bare metal, stealth grey.
 * `main` / `accent` / `trim`: paint; `rough` / `metal`: surface finish; `camo: [c1, c2]`: extra blotch colours over `main`.
 */
export const LIVERIES = [
  { name: 'Candy Red', main: 0xd8262e, accent: 0xf6f3ea, trim: 0x1d2a44, rough: 0.2, metal: 0.35,
    war: { name: 'Woodland Camo', main: 0x4b5a31, accent: 0x2b3020, trim: 0x1e2418, camo: [0x2c3a22, 0x6b5a38], rough: 0.7, metal: 0.05 } },
  { name: 'Ocean Metallic', main: 0x1f6fb8, accent: 0xf6f3ea, trim: 0x10233f, rough: 0.22, metal: 0.55,
    war: { name: 'Desert Camo', main: 0xb59a68, accent: 0x6e5a38, trim: 0x3a3022, camo: [0x8c7048, 0xd2bf94], rough: 0.75, metal: 0.04 } },
  { name: 'Sunburst', main: 0xffc93a, accent: 0xe8501e, trim: 0x2a1a10, rough: 0.28, metal: 0.25,
    war: { name: 'Polished Silver', main: 0xccd1d9, accent: 0x2a4a8a, trim: 0x4a5058, rough: 0.2, metal: 0.95 } },
  { name: 'Carbon Neon', main: 0x23262b, accent: 0x9be15d, trim: 0x0c0e10, rough: 0.3, metal: 0.6,
    war: { name: 'Stealth Grey', main: 0x3b4047, accent: 0x565c64, trim: 0x15181c, rough: 0.85, metal: 0.1 } },
  { name: 'Vintage Green', main: 0x3f6b46, accent: 0xf4f0e0, trim: 0x1a2a1a, rough: 0.4, metal: 0.15,
    war: { name: 'Navy Sea Grey', main: 0x8591a0, accent: 0xc8281e, trim: 0x2a3340, camo: [0x6a7684, 0x9aa5b2], rough: 0.55, metal: 0.2 } },
  { name: 'Chrome Pink', main: 0xff6fb5, accent: 0xffffff, trim: 0x3a1030, rough: 0.15, metal: 0.7,
    war: { name: 'Gold Ace', main: 0xd8b13a, accent: 0x15110a, trim: 0x3a2c0c, rough: 0.22, metal: 0.92 } },
];
const WAR_TYPES = ['warbird', 'jet', 'a10', 'b29'];
/** The paint scheme for aircraft `type` in livery slot `idx`: {name, main, accent, trim, rough, metal, camo?}. */
export function liveryOf(type, idx) {
  const L = LIVERIES[(idx | 0) % LIVERIES.length];
  return WAR_TYPES.includes(type) ? L.war : L;
}

/** Procedural camouflage: blotches of two extra colours over the base paint, from the model-space position (no UVs needed). */
export function camoMaterial(mat, [c1, c2]) {
  const col1 = new THREE.Color(c1), col2 = new THREE.Color(c2);
  mat.onBeforeCompile = sh => {
    sh.uniforms.camo1 = { value: col1 }; sh.uniforms.camo2 = { value: col2 };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvCP = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vCP; uniform vec3 camo1; uniform vec3 camo2;
float ch(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float cn(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(ch(i), ch(i + vec3(1,0,0)), f.x), mix(ch(i + vec3(0,1,0)), ch(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(ch(i + vec3(0,0,1)), ch(i + vec3(1,0,1)), f.x), mix(ch(i + vec3(0,1,1)), ch(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{ float n = cn(vCP * vec3(0.32, 0.5, 0.2)) * 0.65 + cn(vCP * 0.9) * 0.35, m = cn(vCP * vec3(0.4, 0.6, 0.26) + 9.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, camo1, smoothstep(0.5, 0.54, n));
  diffuseColor.rgb = mix(diffuseColor.rgb, camo2, smoothstep(0.58, 0.62, m) * 0.95); }`);
  };
  return mat;
}

// ---------- airfoil loft
const HINGE = 0.72;                                   // control surfaces: the rear 28 % of the chord
/** Upper / lower surface offsets (fraction of chord) of a lightly cambered airfoil at chord fraction x. */
function airfoil(x, t, camber) {
  const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
  const p = 0.4, yc = camber * (x < p ? (2 * p * x - x * x) / (p * p) : ((1 - 2 * p) + 2 * p * x - x * x) / ((1 - p) ** 2));
  return [yc + yt, yc - yt];
}
/**
 * Loft between spanwise stations. A station: {s (span coordinate), c (chord), le (leading edge z),
 * h (height offset: dihedral)}. `range` = [x0, x1] chord fractions to build (whole wing or a slice),
 * `vertical` swaps span onto +y (fins). Returns a BufferGeometry in body axes.
 */
function loft(stations, { t = 0.12, camber = 0.02, range = [0, 1], vertical = false, n = 14 } = {}) {
  const xs = [];
  for (let i = 0; i <= n; i++) { const u = i / n; xs.push(range[0] + (range[1] - range[0]) * (1 - Math.cos(u * Math.PI)) / 2); }
  const ring = st => {                                // closed outline: upper LE->TE, lower TE->LE
    const pts = [];
    for (const x of xs) { const [u] = airfoil(x, t, camber); pts.push([x, u]); }
    for (let i = xs.length - 1; i >= 0; i--) { const [, l] = airfoil(xs[i], t, camber); pts.push([xs[i], l]); }
    return pts.map(([x, y]) => {
      const z = st.le + x * st.c, yy = st.h + y * st.c;
      return vertical ? [yy, st.s, z] : [st.s, yy, z];
    });
  };
  const rings = stations.map(ring), pos = [];
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  for (let k = 0; k < rings.length - 1; k++) {
    const A = rings[k], B = rings[k + 1];
    for (let i = 0; i < A.length; i++) { const j = (i + 1) % A.length; tri(A[i], B[i], B[j]); tri(A[i], B[j], A[j]); }
  }
  for (const [R, flip] of [[rings[0], true], [rings[rings.length - 1], false]]) {   // end caps
    const c = R.reduce((a, p) => [a[0] + p[0] / R.length, a[1] + p[1] / R.length, a[2] + p[2] / R.length], [0, 0, 0]);
    for (let i = 0; i < R.length; i++) { const j = (i + 1) % R.length; if (flip) tri(c, R[j], R[i]); else tri(c, R[i], R[j]); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * A lifting surface with optional control-surface cut-outs.
 *  span: [[s, c, le, h], ...] stations from root to tip (s grows outward; mirrored for the left side)
 *  cuts: [{s0, s1, name}] spanwise ranges where the rear of the chord is a hinged control surface
 * Returns {group, hinges: {name: {group, axis}}}.
 */
export function surface(stations, cuts, mats, opts = {}) {
  const side = opts.side || 1, vertical = !!opts.vertical;
  const at = s => {                                   // interpolate a station at span s
    for (let i = 0; i < stations.length - 1; i++) {
      const a = stations[i], b = stations[i + 1];
      if (s >= a[0] - 1e-6 && s <= b[0] + 1e-6) { const f = (s - a[0]) / ((b[0] - a[0]) || 1); return a.map((v, k) => v + (b[k] - v) * f); }
    }
    return stations[stations.length - 1];
  };
  const st = arr => ({ s: arr[0] * side, c: arr[1], le: arr[2], h: arr[3] });
  // split the span at every cut boundary
  const marks = new Set(stations.map(a => a[0]));
  for (const c of cuts) { marks.add(c.s0); marks.add(c.s1); }
  const spans = [...marks].sort((a, b) => a - b);
  const group = new THREE.Group(), hinges = {};
  for (let i = 0; i < spans.length - 1; i++) {
    const s0 = spans[i], s1 = spans[i + 1], cut = cuts.find(c => s0 >= c.s0 - 1e-6 && s1 <= c.s1 + 1e-6);
    const sts = [st(at(s0)), st(at(s1))];
    if (side < 0 && !vertical) sts.reverse();
    const main = new THREE.Mesh(loft(sts, { ...opts, range: [0, cut ? HINGE : 1], vertical }), mats.main);
    main.castShadow = main.receiveShadow = true; group.add(main);
  }
  for (const c of cuts) {
    const a = st(at(c.s0)), b = st(at(c.s1));
    const ha = vertical ? [a.h, a.s, a.le + HINGE * a.c] : [a.s, a.h, a.le + HINGE * a.c];
    const hb = vertical ? [b.h, b.s, b.le + HINGE * b.c] : [b.s, b.h, b.le + HINGE * b.c];
    const pivot = new THREE.Vector3(...ha);
    let axis = new THREE.Vector3(hb[0] - ha[0], hb[1] - ha[1], hb[2] - ha[2]).normalize();
    if (!vertical && axis.x < 0) axis.negate();        // +angle = trailing edge down on both wings
    const sts = side < 0 && !vertical ? [b, a] : [a, b];
    const geo = loft(sts, { ...opts, range: [HINGE + 0.005, 1], vertical });
    geo.translate(-pivot.x, -pivot.y, -pivot.z);
    const g = new THREE.Group(); g.position.copy(pivot);
    const m = new THREE.Mesh(geo, c.mat || mats.ctrl); m.castShadow = m.receiveShadow = true; g.add(m);
    group.add(g);
    hinges[c.name] = { group: g, axis };
  }
  return { group, hinges };
}

/** Fuselage from a lathe profile [[radius, z], ...] with a vertical squash. */
export function fuselage(profile, mat, { sx = 1, sy = 1, seg = 24, yOff = 0 } = {}) {
  const g = new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(Math.max(0.001, r), z)), seg);
  g.rotateX(Math.PI / 2); g.scale(sx, sy, 1); g.translate(0, yOff, 0);
  const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true;
  return m;
}

export function propeller(blades, radius, chord, mat, hubMat) {
  const prop = new THREE.Group();
  for (let i = 0; i < blades; i++) {
    const b = new THREE.Group(); b.rotation.z = (i / blades) * Math.PI * 2;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(chord, radius, 0.035), mat); blade.position.y = radius / 2 + 0.08; blade.rotation.y = 0.35;
    blade.castShadow = true; b.add(blade);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(chord * 1.01, 0.12, 0.037), new THREE.MeshStandardMaterial({ color: 0xffd23a })); tip.position.y = radius + 0.02; tip.rotation.y = 0.35; b.add(tip);
    prop.add(b);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.12, 12), hubMat); hub.rotation.x = Math.PI / 2; prop.add(hub);
  return prop;
}

export function wheel(x, y, z, r, mats, { pant = false, strutTo = null } = {}) {
  // the whole leg hangs from a pivot at the top of its strut (retractable gear folds about it)
  const top = strutTo ? new THREE.Vector3(...strutTo) : new THREE.Vector3(x, y + r, z);
  const leg = new THREE.Group(); leg.position.copy(top); leg.userData.leg = true;
  const g = new THREE.Group(); g.position.set(x - top.x, y + r - top.y, z - top.z);
  const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, r * 0.55, 18), mats.rubber); t.rotation.z = Math.PI / 2; t.castShadow = true; g.add(t);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.45, r * 0.45, r * 0.58, 12), mats.metal); hub.rotation.z = Math.PI / 2; g.add(hub);
  if (pant) { const p = new THREE.Mesh(new THREE.SphereGeometry(r * 1.2, 16, 10), mats.accent); p.scale.set(0.5, 0.75, 1.7); p.position.y = r * 0.25; p.castShadow = true; g.add(p); }
  leg.add(g);
  if (strutTo) {
    const a = g.position.clone(), d = a.clone().negate();
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, d.length(), 8), mats.metal);
    s.position.copy(a).addScaledVector(d, 0.5); s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()); s.castShadow = true;
    leg.add(s);
  }
  return [leg];
}

/**
 * Build an aircraft. `type` = 'trainer' | 'sport' | 'warbird' | 'jet'.
 * Returns {root, hinges, prop, disc, canopy, frame, cockpitGroup, flame, livery, type}.
 */
export function buildPlane(type = 'sport', liveryIdx = 0, { cockpit = true } = {}) {
  const L = liveryOf(type, liveryIdx);
  const std = (color, rough = 0.38, metal = 0.12) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, side: THREE.DoubleSide });
  const mats = {
    main: std(type === 'jet' ? (L.main === 0xf4f4f0 || L.main === 0xffffff ? 0x8a929c : L.main) : type === 'b29' ? (L.main === 0xf4f4f0 || L.main === 0xffffff ? 0xc3c8cf : L.main) : L.main, type === 'jet' ? 0.55 : type === 'b29' ? 0.3 : 0.35, type === 'jet' ? 0.35 : type === 'b29' ? 0.55 : 0.12),
    accent: std(L.accent), trim: std(L.trim, 0.45, 0.25), metal: std(0xa0a6ae, 0.3, 0.85), dark: std(0x22252a, 0.6, 0.3),
    rubber: std(0x16171a, 0.9, 0), glass: new THREE.MeshPhysicalMaterial({ color: 0x9ab8d8, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.38, side: THREE.DoubleSide }),
  };
  mats.main.roughness = L.rough; mats.main.metalness = L.metal;
  if (L.camo) camoMaterial(mats.main, L.camo);
  mats.ctrl = mats.main;
  const root = new THREE.Group(), hinges = {};
  const add = (o, parent = root) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } parent.add(o); return o; };
  const addSurface = res => { root.add(res.group); Object.assign(hinges, res.hinges); };
  let prop = null, disc = null, canopy, frame, flame = null, props = null, bay = null, rack = null;
  const speedBrake = [];
  let missiles = [], pylonBombs = null, fans = null;

  if (type === 'trainer') {
    // boxy fuselage (8-sided lathe), high wing on top of the cabin, struts, big windows
    add(fuselage([[0.05, -2.25], [0.42, -2.1], [0.55, -1.6], [0.62, -0.8], [0.62, 0.6], [0.5, 1.8], [0.3, 3.4], [0.12, 4.8], [0.02, 4.95]], mats.main, { seg: 8, sy: 1.15, yOff: 0.1 }));
    add(fuselage([[0.63, -1.0], [0.635, 0.6], [0.52, 1.8], [0.31, 3.4]], mats.accent, { seg: 8, sy: 0.25, yOff: -0.2 }));
    for (const s of [-1, 1]) { const w = add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.5, 1.3), mats.glass)); w.position.set(s * 0.6, 0.55, -0.05); }
    const wsh = add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.05), mats.glass)); wsh.position.set(0, 0.6, -0.85); wsh.rotation.x = -0.6; canopy = wsh;
    for (const side of [-1, 1]) addSurface(surface([[0.1, 1.6, -0.75, 0.95], [5.35, 1.55, -0.75, 1.05]],
      [{ s0: 0.6, s1: 2.6, name: side < 0 ? 'flapL' : 'flapR' }, { s0: 2.7, s1: 5.0, name: side < 0 ? 'aileronL' : 'aileronR', mat: mats.accent }], mats, { side, t: 0.13, camber: 0.03 }));
    for (const s of [-1, 1]) for (const dz of [-0.6, 0.4]) {          // V-struts from the lower fuselage to the wing
      const a = new THREE.Vector3(s * 0.45, -0.35, dz * 0.4), b = new THREE.Vector3(s * 3.1, 0.98, dz), d = b.clone().sub(a);
      const m = add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, d.length(), 6), mats.trim)); m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    }
    for (const side of [-1, 1]) addSurface(surface([[0.05, 0.95, 4.0, 0.3], [1.65, 0.7, 4.15, 0.3]], [{ s0: 0.15, s1: 1.65, name: side < 0 ? 'elevL' : 'elevR', mat: mats.accent }], mats, { side, t: 0.09, camber: 0 }));
    addSurface(surface([[0.3, 1.1, 3.85, 0], [1.6, 0.6, 4.4, 0]], [{ s0: 0.35, s1: 1.6, name: 'rudder', mat: mats.accent }], mats, { vertical: true, t: 0.09, camber: 0 }));
    prop = propeller(2, 0.85, 0.16, mats.dark, mats.metal); prop.position.set(0, 0.05, -2.32); root.add(prop);
    const sp = add(new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 14), mats.accent)); sp.rotation.x = -Math.PI / 2; sp.position.set(0, 0.05, -2.42);
    for (const o of wheel(0, -1.05, -1.3, 0.22, mats, { strutTo: [0, -0.2, -1.4] })) root.add(o);
    for (const s of [-1, 1]) for (const o of wheel(s * 1.0, -1.1, 0.25, 0.3, mats, { strutTo: [s * 0.4, -0.35, 0.2] })) root.add(o);
  } else if (type === 'sport') {
    add(fuselage([[0.0, -2.75], [0.32, -2.62], [0.55, -2.35], [0.62, -1.7], [0.64, -0.6], [0.6, 0.6], [0.45, 2.4], [0.28, 4.2], [0.14, 5.3], [0.0, 5.42]], mats.main, { sx: 0.92 }));
    const st = new THREE.LatheGeometry([[0.655, -2.0], [0.66, 0.0], [0.6, 1.2], [0.45, 2.8], [0.29, 4.4]].map(([r, z]) => new THREE.Vector2(r, z)), 24, Math.PI * 0.42, Math.PI * 0.16);
    st.rotateX(Math.PI / 2); st.scale(0.93, 1.005, 1);
    const s1 = add(new THREE.Mesh(st, mats.accent)), s2 = s1.clone(); s2.scale.x = -1; root.add(s2);
    canopy = new THREE.Mesh(new THREE.SphereGeometry(0.62, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), mats.glass); canopy.scale.set(0.75, 0.75, 1.7); canopy.position.set(0, 0.48, 0.25); root.add(canopy);
    for (const side of [-1, 1]) addSurface(surface([[0.3, 1.75, -0.8, -0.32], [4.5, 1.05, -0.5, -0.32 + Math.tan(4 * Math.PI / 180) * 4.2]],
      [{ s0: 0.55, s1: 2.45, name: side < 0 ? 'flapL' : 'flapR' }, { s0: 2.55, s1: 4.3, name: side < 0 ? 'aileronL' : 'aileronR', mat: mats.accent }], mats, { side, t: 0.13, camber: 0.02 }));
    for (const side of [-1, 1]) { const tip = add(new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), mats.accent)); tip.scale.set(0.6, 0.5, 4.2); tip.position.set(side * 4.52, -0.32 + Math.tan(4 * Math.PI / 180) * 4.2 + 0.01, 0.05); }
    for (const side of [-1, 1]) addSurface(surface([[0.1, 0.95, 4.0, 0.22], [1.75, 0.55, 4.25, 0.22]], [{ s0: 0.15, s1: 1.75, name: side < 0 ? 'elevL' : 'elevR', mat: mats.accent }], mats, { side, t: 0.09, camber: 0 }));
    addSurface(surface([[0.2, 1.3, 4.05, 0], [1.7, 0.6, 4.7, 0]], [{ s0: 0.25, s1: 1.7, name: 'rudder', mat: mats.accent }], mats, { vertical: true, t: 0.09, camber: 0 }));
    prop = propeller(2, 0.9, 0.17, mats.trim, mats.metal); prop.position.set(0, 0, -2.85); root.add(prop);
    const sp = add(new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.55, 18), mats.accent)); sp.rotation.x = -Math.PI / 2; sp.position.set(0, 0, -2.98);
    for (const o of wheel(0, -1.32, -1.75, 0.24, mats, { strutTo: [0, -0.4, -1.8] })) root.add(o);
    for (const s of [-1, 1]) for (const o of wheel(s * 1.2, -1.36, 0.3, 0.25, mats, { pant: true, strutTo: [s * 0.8, -0.45, 0.25] })) root.add(o);
  } else if (type === 'warbird') {
    add(fuselage([[0.0, -4.05], [0.3, -3.95], [0.6, -3.6], [0.72, -2.4], [0.78, -0.8], [0.74, 0.8], [0.58, 2.8], [0.38, 4.8], [0.2, 6.1], [0.0, 6.3]], mats.main, { sx: 0.9, sy: 1.1 }));
    const scoop = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 1.6, 6, 12), mats.main)); scoop.rotation.x = Math.PI / 2; scoop.scale.set(1, 0.7, 1); scoop.position.set(0, -0.82, 1.1);
    const lip = add(new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.04, 6, 16), mats.dark)); lip.position.set(0, -0.82, 0.1);
    {                                                                       // the swing arm (trapeze) and the 1,000 lb bomb it carries
      const R = (globalThis.FSPhysics || {}).TYPES?.warbird?.bombRack || { pivot: [0, -0.8, -0.5], arm: 0.9 };
      const g = new THREE.Group(); g.position.set(...R.pivot); root.add(g);
      for (const sx of [-0.07, 0.07]) { const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, R.arm, 0.07), mats.metal); bar.position.set(sx, -R.arm / 2, 0); bar.castShadow = true; g.add(bar); }
      const bomb = new THREE.Group(); bomb.position.set(0, -R.arm, 0); g.add(bomb);
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 1.2, 6, 14), new THREE.MeshStandardMaterial({ color: 0x4a5236, roughness: 0.6, metalness: 0.2 })); body.rotation.x = Math.PI / 2; body.castShadow = true; bomb.add(body);
      for (let k = 0; k < 4; k++) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.34, 0.3), mats.dark); fin.position.set(0, 0, 0.78); fin.rotation.z = k * Math.PI / 2; bomb.add(fin); }
      rack = { group: g, bomb };
    }
    canopy = new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), mats.glass); canopy.scale.set(0.8, 0.85, 1.9); canopy.position.set(0, 0.62, 0.55); root.add(canopy);
    const band = add(fuselage([[0.79, -3.3], [0.8, -2.7]], mats.accent, { sx: 0.91, sy: 1.11 })); void band;
    for (const side of [-1, 1]) addSurface(surface([[0.4, 2.6, -1.1, -0.42], [3.5, 2.0, -0.8, -0.42 + 0.27], [5.65, 1.1, -0.35, -0.42 + 0.47]],
      [{ s0: 0.7, s1: 3.0, name: side < 0 ? 'flapL' : 'flapR' }, { s0: 3.2, s1: 5.4, name: side < 0 ? 'aileronL' : 'aileronR' }], mats, { side, t: 0.14, camber: 0.02 }));
    for (const s of [-1, 1]) for (const k of [0, 1, 2]) { const gun = add(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 6), mats.dark)); gun.rotation.x = Math.PI / 2; gun.position.set(s * (2.2 + k * 0.25), -0.3, -1.25); }
    for (const side of [-1, 1]) addSurface(surface([[0.15, 1.45, 4.9, 0.2], [2.3, 0.85, 5.3, 0.2]], [{ s0: 0.2, s1: 2.3, name: side < 0 ? 'elevL' : 'elevR' }], mats, { side, t: 0.09, camber: 0 }));
    addSurface(surface([[0.3, 1.6, 4.85, 0], [2.2, 0.8, 5.6, 0]], [{ s0: 0.35, s1: 2.2, name: 'rudder', mat: mats.accent }], mats, { vertical: true, t: 0.09, camber: 0 }));
    prop = propeller(4, 1.55, 0.24, mats.dark, mats.metal); prop.position.set(0, 0, -4.1); root.add(prop);
    const sp = add(new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.75, 20), mats.accent)); sp.rotation.x = -Math.PI / 2; sp.position.set(0, 0, -4.3);
    for (const s of [-1, 1]) { const ex = add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.9), mats.dark)); ex.position.set(s * 0.66, 0.15, -2.6); }
    // taildragger: big mains ahead of the CG, a small tail wheel
    for (const o of wheel(0, -0.62, 5.5, 0.17, mats, { strutTo: [0, -0.22, 5.3] })) root.add(o);
    for (const s of [-1, 1]) for (const o of wheel(s * 1.8, -1.95, -0.9, 0.42, mats, { strutTo: [s * 1.55, -0.5, -0.75] })) root.add(o);
  } else if (type === 'seaplane') {
    // boxy cabin behind a round radial cowling, big windows, high wing with V-struts
    add(fuselage([[0.05, -3.1], [0.52, -3.05], [0.66, -2.75], [0.7, -2.0], [0.74, -1.2], [0.76, -0.2], [0.72, 1.0], [0.55, 2.6], [0.34, 4.3], [0.15, 5.7], [0.03, 5.95]], mats.main, { seg: 10, sy: 1.12, yOff: 0.05 }));
    add(fuselage([[0.77, -1.1], [0.775, 0.9], [0.56, 2.6], [0.35, 4.3]], mats.accent, { seg: 10, sy: 0.22, yOff: -0.32 }));
    const cowl = add(new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.72, 0.9, 20, 1, true), mats.trim)); cowl.rotation.x = Math.PI / 2; cowl.position.set(0, 0.05, -2.75);
    for (let i = 0; i < 9; i++) {                                       // the radial's cylinders peeking out of the cowl
      const a = i / 9 * Math.PI * 2, cyl = add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.22, 8), mats.metal));
      cyl.position.set(Math.cos(a) * 0.5, 0.05 + Math.sin(a) * 0.5, -3.12); cyl.rotation.x = Math.PI / 2;
    }
    for (const s of [-1, 1]) for (const z of [-0.95, 0.15, 1.15]) { const w = add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.48, 0.8), mats.glass)); w.position.set(s * 0.74, 0.5, z); }
    const wsh = add(new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.55, 0.05), mats.glass)); wsh.position.set(0, 0.62, -1.55); wsh.rotation.x = -0.65; canopy = wsh;
    for (const side of [-1, 1]) addSurface(surface([[0.1, 1.62, -1.0, 1.05], [7.3, 1.55, -0.95, 1.25]],
      [{ s0: 0.7, s1: 3.7, name: side < 0 ? 'flapL' : 'flapR' }, { s0: 3.9, s1: 7.0, name: side < 0 ? 'aileronL' : 'aileronR', mat: mats.accent }], mats, { side, t: 0.14, camber: 0.035 }));
    for (const s of [-1, 1]) for (const dz of [-0.75, 0.35]) {          // wing struts
      const a = new THREE.Vector3(s * 0.55, -0.5, dz * 0.5), b = new THREE.Vector3(s * 3.6, 1.1, dz), d = b.clone().sub(a);
      const m = add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, d.length(), 6), mats.trim)); m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    }
    for (const side of [-1, 1]) addSurface(surface([[0.05, 1.35, 4.55, 0.35], [2.6, 0.85, 4.85, 0.35]], [{ s0: 0.15, s1: 2.6, name: side < 0 ? 'elevL' : 'elevR', mat: mats.accent }], mats, { side, t: 0.09, camber: 0 }));
    addSurface(surface([[0.3, 1.7, 4.3, 0], [2.0, 0.85, 5.0, 0]], [{ s0: 0.35, s1: 2.0, name: 'rudder', mat: mats.accent }], mats, { vertical: true, t: 0.09, camber: 0 }));
    prop = propeller(3, 1.3, 0.2, mats.dark, mats.metal); prop.position.set(0, 0.05, -3.2); root.add(prop);
    const sp = add(new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.5, 18), mats.metal)); sp.rotation.x = -Math.PI / 2; sp.position.set(0, 0.05, -3.4);
    // twin floats: a planing bottom with a step, on N-struts, water rudders at the sterns
    const floatMat = std(0xe8e4d8, 0.4, 0.2);
    for (const s of [-1, 1]) {
      const fl = fuselage([[0.03, -3.3], [0.22, -3.0], [0.36, -2.4], [0.42, -1.4], [0.43, 0.4], [0.36, 1.6], [0.24, 2.8], [0.08, 3.5]], floatMat, { seg: 12, sx: 0.9, sy: 0.85 });
      fl.position.set(s * 1.4, -1.95, 0); root.add(fl);
      const stripe = fuselage([[0.435, -2.2], [0.44, 0.4], [0.37, 1.6]], mats.accent, { seg: 12, sx: 0.9, sy: 0.18 }); stripe.position.set(s * 1.4, -1.9, 0); root.add(stripe);
      for (const [z0, z1] of [[-1.3, -1.0], [0.6, 0.3], [-1.3, 0.3]]) {
        const a = new THREE.Vector3(s * 1.4, -1.6, z0), b = new THREE.Vector3(s * 0.55, -0.6, z1), d = b.clone().sub(a);
        const m = add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, d.length(), 6), mats.metal)); m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      }
      const wr = add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.35, 0.3), mats.dark)); wr.position.set(s * 1.4, -2.25, 3.55);
    }
    for (const z of [-1.2, 0.5]) { const sp2 = add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.8, 6), mats.metal)); sp2.rotation.z = Math.PI / 2; sp2.position.set(0, -1.6, z); }   // spreader bars
  } else if (type === 'b29') {
    // pressurised tube with a glazed bubble nose, mid wing with four R-3350 nacelles, tall fin, tricycle gear
    add(fuselage([[0.05, -14.0], [0.7, -13.6], [1.2, -12.6], [1.5, -11], [1.56, -8], [1.56, 0], [1.46, 6], [1.0, 11], [0.55, 14.5], [0.16, 16.1], [0.02, 16.3]], mats.main, { seg: 20, sy: 1.0 }));
    add(fuselage([[1.565, -9.6], [1.57, -8.6]], mats.accent, { seg: 20 }));
    canopy = new THREE.Mesh(new THREE.SphereGeometry(1.25, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), mats.glass); canopy.scale.set(0.95, 0.8, 2.6); canopy.position.set(0, 0.5, -11.8); root.add(canopy);
    const nose = add(new THREE.Mesh(new THREE.SphereGeometry(1.0, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), mats.glass)); nose.rotation.x = -Math.PI / 2; nose.scale.set(1.0, 1.0, 1.0); nose.position.set(0, 0, -13.25);
    for (let k = 0; k < 4; k++) { const rib = add(new THREE.Mesh(new THREE.TorusGeometry(1.17 - k * 0.07, 0.025, 6, 20, Math.PI), mats.trim)); rib.position.set(0, 0.5, -10.4 - k * 0.95); rib.rotation.set(0, 0, 0); rib.scale.set(0.95, 0.8, 1); }
    const tunnel = add(fuselage([[0.5, -7.2], [0.5, -2.4]], mats.dark, { seg: 10, sy: 0.6, yOff: 1.35 })); void tunnel;     // the crew tunnel over the bays
    for (const z of [-6.2, -2.4, 4.2]) for (const sy of [1]) { const t = add(new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mats.glass)); t.position.set(0, 1.4 * sy, z); t.scale.set(1, 0.8, 1.3); }
    for (const z of [-6.0, 3.4]) { const t = add(new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8), mats.glass)); t.position.set(0, -1.3, z); t.scale.set(1, 0.9, 1.3); }   // belly sighting blisters
    for (const sd of [-1, 1]) { const bl = add(new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), mats.glass)); bl.position.set(sd * 1.5, 0.15, 6.4); bl.scale.set(0.7, 1, 1.2); }   // waist blisters
    const tail = add(new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.1, 12), mats.glass)); tail.rotation.x = -Math.PI / 2; tail.position.set(0, 0.0, 16.6);
    for (const sd of [-1, 1]) { const gun = add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6), mats.dark)); gun.rotation.x = Math.PI / 2; gun.position.set(sd * 0.18, -0.05, 17.2); }
    for (const side of [-1, 1]) addSurface(surface([[1.4, 6.3, -1.3, -0.3], [21.5, 2.3, 0.0, 1.5]],
      [{ s0: 1.9, s1: 12.5, name: side < 0 ? 'flapL' : 'flapR' }, { s0: 14.5, s1: 21.0, name: side < 0 ? 'aileronL' : 'aileronR', mat: mats.accent }], mats, { side, t: 0.14, camber: 0.025 }));
    for (const side of [-1, 1]) addSurface(surface([[0.3, 3.2, 13.4, 0.9], [6.4, 1.6, 15.0, 0.9]], [{ s0: 0.5, s1: 6.2, name: side < 0 ? 'elevL' : 'elevR' }], mats, { side, t: 0.09, camber: 0 }));
    addSurface(surface([[0.8, 6.2, 10.4, 0], [4.7, 2.2, 14.0, 0]], [{ s0: 1.4, s1: 4.6, name: 'rudder', mat: mats.accent }], mats, { vertical: true, t: 0.09, camber: 0 }));
    // four nacelles (inner at 6 m, outer at 13 m), each with a 4-blade prop and a disc; the mains fold up into the inner pair
    props = []; const discs = [];
    for (const sx of [-13, -6, 6, 13]) {
      const ny = -0.3 + Math.tan(4.5 * Math.PI / 180) * (Math.abs(sx) - 1.4) - 0.1;
      add(fuselage([[0.3, -4.1], [0.85, -3.95], [1.0, -3.4], [1.02, -2], [1.0, 0], [0.8, 2.2], [0.45, 3.9], [0.05, 4.4]], mats.main, { seg: 14, sy: 0.95 })).position.set(sx, ny, 0);
      const cowl = add(new THREE.Mesh(new THREE.TorusGeometry(0.93, 0.07, 8, 20), mats.metal)); cowl.position.set(sx, ny, -3.95);
      const pr = propeller(4, 2.45, 0.32, mats.dark, mats.metal); pr.position.set(sx, ny, -4.35); root.add(pr); props.push(pr);
      const sp = add(new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 14), mats.metal)); sp.rotation.x = -Math.PI / 2; sp.position.set(sx, ny, -4.7);
      const dc = new THREE.Mesh(new THREE.CircleGeometry(2.45, 40), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
      dc.position.set(sx, ny, -4.37); root.add(dc); discs.push(dc);
    }
    // bomb-bay doors: hinged on their outer edge, they swing down and out
    bay = [];
    for (const sd of [-1, 1]) {
      const g = new THREE.Group(); g.position.set(sd * 0.9, -1.5, 0.8); root.add(g);
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.05, 5.4), mats.main); d.position.set(-sd * 0.45, 0, 0); d.castShadow = true; g.add(d);
      bay.push({ group: g, sign: sd });
    }
    for (const o of wheel(0, -3.8, -8.7, 0.55, mats, { strutTo: [0, -1.2, -8.5] })) root.add(o);
    for (const sd of [-1, 1]) for (const o of wheel(sd * 4.6, -3.8, 1.6, 0.95, mats, { strutTo: [sd * 4.6, -0.7, 1.3] })) root.add(o);
    props.discs = discs;
  } else if (type === 'a10') {
    // A-10: bathtub fuselage, two high turbofans on pylons behind the wing, straight wing, twin fins on an H-tail, GAU-8 nose
    add(fuselage([[0.0, -8.2], [0.3, -7.9], [0.55, -7.0], [0.78, -5.4], [0.92, -3.4], [0.95, 0.5], [0.85, 3.0], [0.68, 5.0], [0.48, 6.6], [0.3, 7.7], [0.22, 8.2]], mats.main, { sx: 0.92, sy: 1.0 }));
    const cone = add(new THREE.Mesh(new THREE.ConeGeometry(0.36, 1.2, 14), mats.dark)); cone.rotation.x = -Math.PI / 2; cone.position.set(0, -0.15, -8.6);   // radome / gun fairing
    for (let k = 0; k < 7; k++) { const a = k * Math.PI * 2 / 7, b = add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.1, 6), mats.metal)); b.rotation.x = Math.PI / 2; b.position.set(Math.cos(a) * 0.12, -0.55 + Math.sin(a) * 0.12, -8.55); }
    fans = []; flame = new THREE.Group(); root.add(flame); const flames = []; flame.userData.flames = flames;
    for (const sd of [-1, 1]) {                                          // TF34 high-bypass turbofan: big fan up front, a hot core inside a longer bypass duct, tapered nozzle
      const x = sd * 1.4, y = 0.95;                                      // pods hug the rear fuselage sides, above the wing trailing edge
      const nac = add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 4.2, 28, 1, true), mats.main)); nac.rotation.x = Math.PI / 2; nac.position.set(x, y, 4.3);
      nac.material = mats.main.clone(); nac.material.side = THREE.DoubleSide;
      const lip = add(new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.06, 8, 28), mats.metal)); lip.position.set(x, y, 2.2);
      const well = add(new THREE.Mesh(new THREE.CircleGeometry(0.58, 24), mats.dark)); well.position.set(x, y, 2.75); well.rotation.y = Math.PI;
      const fan = new THREE.Group(); fan.position.set(x, y, 2.55); root.add(fan);
      for (let k = 0; k < 20; k++) { const bl = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.03), mats.metal); const a = k * Math.PI * 2 / 20; bl.position.set(Math.sin(a) * 0.3, Math.cos(a) * 0.3, 0); bl.rotation.z = -a; bl.rotation.y = 0.5; fan.add(bl); }
      const spin = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.5, 14), mats.metal); spin.rotation.x = -Math.PI / 2; spin.position.z = -0.25; fan.add(spin);
      fans.push(fan);
      const tail = add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.46, 0.9, 20, 1, true), mats.metal)); tail.material = mats.metal.clone(); tail.material.side = THREE.DoubleSide; tail.rotation.x = Math.PI / 2; tail.position.set(x, y, 6.65);   // hot-section nozzle sticking out the back
      const noz = add(new THREE.Mesh(new THREE.CircleGeometry(0.3, 18), new THREE.MeshStandardMaterial({ color: 0x331a10, emissive: 0xff5a1a, emissiveIntensity: 0.12 }))); noz.position.set(x, y, 7.1); noz.rotation.y = Math.PI;
      const py = add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 3.2), mats.main)); py.position.set(sd * 0.95, 0.65, 4.2);   // pylon blending pod into fuselage
      const fg = new THREE.Group(); fg.position.set(x, y, 7.15); flame.add(fg); flames.push(fg);                                  // small exhaust flame behind each engine (no afterburner)
      const fo = new THREE.Mesh(new THREE.ConeGeometry(0.26, 1.6, 14, 1, true), new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      fo.rotation.x = Math.PI / 2; fo.position.z = 0.8; fg.add(fo);
      const fi = new THREE.Mesh(new THREE.ConeGeometry(0.15, 1.0, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      fi.rotation.x = Math.PI / 2; fi.position.z = 0.5; fg.add(fi);
    }
    canopy = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), mats.glass); canopy.scale.set(0.95, 1.0, 2.5); canopy.position.set(0, 0.72, -4.7); root.add(canopy);
    for (const side of [-1, 1]) addSurface(surface([[0.8, 3.9, -1.35, -0.1], [8.75, 2.5, -0.55, 0.25]],
      [{ s0: 1.0, s1: 4.2, name: side < 0 ? 'flapL' : 'flapR' }, { s0: 4.5, s1: 8.4, name: side < 0 ? 'aileronL' : 'aileronR', mat: mats.accent }], mats, { side, t: 0.15, camber: 0.03 }));
    for (const side of [-1, 1]) addSurface(surface([[0.1, 1.9, 5.9, 0.45], [3.3, 1.5, 6.25, 0.45]], [{ s0: 0.15, s1: 3.2, name: side < 0 ? 'elevL' : 'elevR' }], mats, { side, t: 0.1, camber: 0 }));
    for (const side of [-1, 1]) addSurface(surface([[0.45, 2.9, 5.5, side * 3.3], [3.4, 1.5, 6.6, side * 3.3]], [{ s0: 0.6, s1: 3.2, name: side < 0 ? 'rudder' : 'rudderB', mat: mats.accent }], mats, { vertical: true, t: 0.08, camber: 0 }));
    for (const s of [-1, 1]) {                                          // the aileron-split speed brakes: petals behind the nacelles
      const hinge = new THREE.Group(); hinge.position.set(s * 3.4, 0.35, 5.2); root.add(hinge);
      const petal = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.8, 1.2), mats.main); petal.position.set(0, 0, 0.6); petal.castShadow = true; hinge.add(petal);
      speedBrake.push({ group: hinge, axis: new THREE.Vector3(0, 1, 0), angle: -s * 0.75 });
    }
    const T = ((globalThis.FSPhysics || {}).TYPES || {}).a10 || {};
    pylonBombs = (T.bombRack ? T.bombRack.pylons : []).map(r => {         // six 500 lb bombs on the inner pylons: they vanish as they are dropped
      const hh = 0.0 - (r[1] + 0.14), py = add(new THREE.Mesh(new THREE.BoxGeometry(0.1, hh, 1.2), mats.main)); py.position.set(r[0], r[1] + 0.14 + hh / 2, r[2]);   // reaches up into the wing
      const b = new THREE.Group(); b.position.set(...r); root.add(b);
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 1.0, 6, 12), new THREE.MeshStandardMaterial({ color: 0x4a5236, roughness: 0.6, metalness: 0.2 })); body.rotation.x = Math.PI / 2; body.castShadow = true; b.add(body);
      for (let k = 0; k < 4; k++) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.3, 0.26), mats.dark); fin.position.set(0, 0, 0.62); fin.rotation.z = k * Math.PI / 2; b.add(fin); }
      return b;
    });
    missiles = (T.missiles || []).map(r => {                             // four rails on the outer pylons
      const hh = 0.0 - (r[1] + 0.12), py = add(new THREE.Mesh(new THREE.BoxGeometry(0.08, hh, 1.6), mats.main)); py.position.set(r[0], r[1] + 0.12 + hh / 2, r[2] - 0.2);   // reaches up into the wing
      const m = buildMissile(); m.position.set(...r); root.add(m); return m;
    });
    for (const o of wheel(0, -2.0, -5.2, 0.3, mats, { strutTo: [0, -0.2, -5.2] })) root.add(o);
    for (const s of [-1, 1]) for (const o of wheel(s * 2.6, -2.05, 0.9, 0.42, mats, { strutTo: [s * 2.1, 0.0, 0.9] })) root.add(o);
  } else {
    // jet: area-ruled fuselage, chin intake, cropped delta, all-moving tailplane, nozzle
    add(fuselage([[0.0, -7.7], [0.25, -7.0], [0.55, -5.6], [0.8, -3.6], [0.92, -1.0], [0.95, 1.5], [0.85, 4.5], [0.7, 6.4], [0.62, 7.1]], mats.main, { sx: 0.95, sy: 1.0 }));
    const intake = add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.75, 3.6), mats.main)); intake.position.set(0, -0.85, -1.4);
    const mouth = add(new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.62, 0.05), mats.dark)); mouth.position.set(0, -0.85, -3.2);
    const nozzle = add(new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 0.8, 18, 1, true), mats.metal)); nozzle.rotation.x = Math.PI / 2; nozzle.position.set(0, 0, 7.4);
    const inner = add(new THREE.Mesh(new THREE.CircleGeometry(0.5, 18), new THREE.MeshStandardMaterial({ color: 0x331a10, emissive: 0xff5a1a, emissiveIntensity: 0.4 }))); inner.position.set(0, 0, 7.2);
    flame = new THREE.Group(); flame.position.set(0, 0, 7.8); root.add(flame);
    const fc = new THREE.Mesh(new THREE.ConeGeometry(0.5, 3.4, 18, 1, true), new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    fc.rotation.x = Math.PI / 2; fc.position.z = 1.7; flame.add(fc);
    const fi = new THREE.Mesh(new THREE.ConeGeometry(0.3, 2.2, 14, 1, true), new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    fi.rotation.x = Math.PI / 2; fi.position.z = 1.1; flame.add(fi);
    canopy = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), mats.glass); canopy.scale.set(0.95, 0.95, 3.2); canopy.position.set(0, 0.8, -3.6); root.add(canopy);
    for (const side of [-1, 1]) addSurface(surface([[0.7, 5.6, -2.6, -0.2], [4.75, 1.4, 1.65, -0.2]],
      [{ s0: 1.1, s1: 2.6, name: side < 0 ? 'flapL' : 'flapR' }, { s0: 2.8, s1: 4.5, name: side < 0 ? 'aileronL' : 'aileronR' }], mats, { side, t: 0.05, camber: 0 }));
    for (const s of [-1, 1]) { const rail = add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3, 8), mats.metal)); rail.rotation.x = Math.PI / 2; rail.position.set(s * 4.8, -0.2, 2.0); }
    // all-moving tailplane: the whole stabilator is the 'elevator'
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group(); pivot.position.set(side * 0.7, -0.1, 5.4); root.add(pivot);
      const res = surface([[0.0, 2.6, -1.0, 0], [2.1, 0.9, 0.6, 0]], [], mats, { side, t: 0.05, camber: 0 });
      res.group.position.set(-side * 0.0, 0, 0); pivot.add(res.group);
      hinges[side < 0 ? 'elevL' : 'elevR'] = { group: pivot, axis: new THREE.Vector3(1, 0, 0) };
    }
    addSurface(surface([[0.8, 3.8, 3.2, 0], [3.4, 1.4, 6.0, 0]], [{ s0: 1.0, s1: 3.2, name: 'rudder', mat: mats.accent }], mats, { vertical: true, t: 0.05, camber: 0 }));
    // split speed-brake petals either side of the nozzle, hinged at their front edge
    for (const s of [-1, 1]) {
      const hinge = new THREE.Group(); hinge.position.set(s * 0.72, 0.05, 6.3); root.add(hinge);
      const petal = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 1.3), mats.main); petal.position.set(0, 0, 0.65); petal.castShadow = true; hinge.add(petal);
      speedBrake.push({ group: hinge, axis: new THREE.Vector3(0, 1, 0), angle: -s * 0.75 });
    }
    // AIM-9s: two on underwing pylons, two on the wingtip rails
    const rails = ((globalThis.FSPhysics || {}).TYPES || {}).jet?.missiles || [];
    missiles = rails.map(r => {
      if (Math.abs(r[0]) < 4.5) { const py = add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 1.6), mats.main)); py.position.set(r[0], r[1] + 0.27, r[2] - 0.2); }
      const m = buildMissile(); m.position.set(...r); root.add(m); return m;
    });
    // M61-style gun in the left wing root
    const port = add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 10), mats.dark)); port.rotation.x = Math.PI / 2; port.position.set(-0.78, 0.32, -4.3);
    for (const o of wheel(0, -1.75, -3.6, 0.3, mats, { strutTo: [0, -0.9, -3.6] })) root.add(o);
    for (const s of [-1, 1]) for (const o of wheel(s * 1.25, -1.8, 0.9, 0.38, mats, { strutTo: [s * 0.7, -0.9, 0.9] })) root.add(o);
  }
  if (prop) {
    disc = new THREE.Mesh(new THREE.CircleGeometry(type === 'warbird' ? 1.65 : type === 'seaplane' ? 1.4 : type === 'trainer' ? 0.95 : 1.0, 40),
      new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
    disc.position.copy(prop.position); disc.position.z -= 0.02; root.add(disc);
  }
  // canopy frame (a thin bar) and nav lights at the wingtips, strobe on the tail
  frame = add(new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.007, 6, 20, Math.PI), mats.trim));
  frame.position.copy(canopy.position); frame.position.z -= 0.6; frame.visible = type !== 'trainer' && type !== 'seaplane' && type !== 'b29';
  const tipX = { trainer: 5.35, sport: 4.55, warbird: 5.65, jet: 4.85, a10: 8.75, seaplane: 7.3, b29: 21.5 }[type], tipY = { trainer: 1.05, sport: -0.03, warbird: 0.05, jet: -0.2, a10: 0.3, seaplane: 1.25, b29: 1.7 }[type], tipZ = { trainer: 0.0, sport: 0.1, warbird: 0.3, jet: 1.8, a10: 0.2, seaplane: 0.0, b29: 1.0 }[type];
  for (const s of [-1, 1]) { const nav = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: s < 0 ? 0xff2020 : 0x20ff40 })); nav.position.set(s * tipX, tipY, tipZ); root.add(nav); }

  // cockpit-only items: glare shield + panel (seen from the pilot's seat)
  let cockpitGroup = null;
  if (cockpit) {
    const eye = { trainer: [0, 0.78, 0.1], sport: [0, 0.86, 0.3], warbird: [0, 1.25, 0.5], jet: [0, 1.15, -3.4], a10: [0, 1.0, -4.8], seaplane: [0, 0.9, -0.5], b29: [-0.6, 1.2, -12.2] }[type];
    cockpitGroup = buildCockpit(eye, 0, { trainer: 'civil', sport: 'civil', seaplane: 'civil', jet: 'jet', a10: 'jet' }[type] || 'ww2'); root.add(cockpitGroup);
    // the eye sits above the fuselage's top line: in the cockpit view the decking is sunk so the panel and coaming stand clear of it
    { const drop = root.children.filter(o => o.isMesh && o.geometry.type === 'LatheGeometry'), sink = { trainer: 0.4, sport: 0.32, warbird: 0.38, jet: 0.3, a10: 0.3, seaplane: 0.3, b29: 0.3 }[type] || 0.2; let on = false; drop.forEach(m => { m.userData.sink = true; });       // (the static mesh merge leaves these alone)
      Object.defineProperty(cockpitGroup, 'visible', { get: () => on, set: v => { if (v === on) return; on = v; for (const m of drop) m.position.y += v ? -sink : sink; } }); }
    cockpitGroup.visible = false;
  }
  const gear = root.children.filter(o => o.userData.leg).map(leg => {
    const centre = Math.abs(leg.position.x) < 0.3;
    return { group: leg, axis: centre ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1), angle: centre ? Math.PI / 2 : Math.sign(leg.position.x) * -Math.PI / 2 };
  });
  return { root, hinges, prop, disc, canopy, frame, cockpitGroup, flame, gear, speedBrake, missiles, pylonBombs, fans, props, bay, rack, livery: L, type };
}

/**
 * An AIM-9 (2.9 m, 127 mm): white body, glass seeker dome, canards up front, tail fins with rollerons.
 * Points along -z like the aircraft; origin at its middle.
 */
let MSL = null;
export function buildMissile(k = 'aim9') {
  if (!MSL) {
    const std = (color, rough, metal) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    const fin = (span, root, tip, sweep) => { const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(root, 0); sh.lineTo(sweep + tip, span); sh.lineTo(sweep, span); sh.closePath(); return new THREE.ExtrudeGeometry(sh, { depth: 0.01, bevelEnabled: false }); };
    MSL = { body: new THREE.CylinderGeometry(0.0635, 0.0635, 2.6, 12), nose: new THREE.SphereGeometry(0.0635, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
            canard: fin(0.2, 0.28, 0.06, 0.18), tail: fin(0.24, 0.42, 0.16, 0.22), roller: new THREE.CylinderGeometry(0.035, 0.035, 0.012, 10),
            white: std(0xe8e8e2, 0.5, 0.2), dome: std(0x2a3036, 0.1, 0.6), band: std(0x8a7a3a, 0.5, 0.3), grey: std(0xb8bcc2, 0.4, 0.5) };
  }
  const g = new THREE.Group();
  const body = new THREE.Mesh(MSL.body, MSL.white); body.rotation.x = Math.PI / 2; g.add(body);
  const nose = new THREE.Mesh(MSL.nose, MSL.dome); nose.rotation.x = -Math.PI / 2; nose.position.z = -1.3; nose.scale.set(1, 1.6, 1); g.add(nose);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.06, 12), MSL.band); band.rotation.x = Math.PI / 2; band.position.z = -0.7; g.add(band);   // live warhead: yellow band
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2;
    for (const [geo, z] of [[MSL.canard, -1.15], [MSL.tail, 0.85]]) {
      const f = new THREE.Mesh(geo, MSL.grey);
      f.rotation.set(0, -Math.PI / 2, 0);                           // shape x -> back along the body, shape y -> out
      const holder = new THREE.Group(); holder.rotation.z = a; holder.add(f); f.position.set(0, 0.06, z); g.add(holder);
    }
    const r = new THREE.Mesh(MSL.roller, MSL.grey); r.rotation.z = Math.PI / 2; r.position.set(0, 0.29, 1.25);
    const h2 = new THREE.Group(); h2.rotation.z = a; h2.add(r); g.add(h2);
  }
  if (k === 'aim120') {                                              // the AMRAAM: fatter and longer, grey, no canard-and-roller look
    g.scale.set(1.45, 1.45, 1.4);
    g.children[0].material = MSL.grey;
  } else if (k === 'aim9x') g.children[2].material = MSL.blue || (MSL.blue = new THREE.MeshStandardMaterial({ color: 0x2f6fd0, roughness: 0.5, metalness: 0.3 }));     // blue band: inert-marked training colours, but it is the X
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

/** Apply the physical state to the model: surface deflections, propeller, afterburner. */
export function animatePlane(m, defl, engine, dt, afterburner = false, gearPos = 1, airbrake = 0, bayPos = 0, rackPos = 0) {
  const h = m.hinges, set = (name, angle) => { if (h[name]) h[name].group.setRotationFromAxisAngle(h[name].axis, angle); };
  set('aileronL', defl.aileronL); set('aileronR', defl.aileronR);         // + = trailing edge down
  set('flapL', defl.flaps); set('flapR', defl.flaps); set('flapL2', defl.flaps); set('flapR2', defl.flaps);       // flapL2/R2: the outer flap of a bent (gull) wing
  set('elevL', -defl.elevator); set('elevR', -defl.elevator);             // stick back = trailing edge up
  set('rudder', defl.rudder); set('rudderB', defl.rudder);                                              // right rudder = trailing edge right
  if (m.prop) {
    m.propAngle = (m.propAngle || 0) + dt * (8 + engine * 140);
    m.prop.rotation.z = m.propAngle;
    m.prop.visible = engine < 0.25;
    m.disc.material.opacity = Math.min(0.35, engine * 0.5);
  }
  if (m.props) {                                                          // four props (B-29): slightly out of step so they do not look locked
    m.propAngle = (m.propAngle || 0) + dt * (8 + engine * 110);
    m.props.forEach((p, i) => { p.rotation.z = m.propAngle * (1 + i * 0.013) + i; p.visible = engine < 0.25; });
    m.props.discs.forEach(d => { d.material.opacity = Math.min(0.35, engine * 0.5); });
  }
  if (m.fans) { m.fanAngle = (m.fanAngle || 0) + dt * (4 + engine * 90); for (const f of m.fans) f.rotation.z = m.fanAngle; }      // the turbofan's fan: windmills at idle, a blur at power
  if (m.bay) for (const b of m.bay) b.group.rotation.z = b.sign * bayPos * 1.25;      // the bomb-bay doors
  if (m.rack) { m.rack.group.rotation.x = rackPos * 1.25; m.rack.bomb.rotation.x = -rackPos * 0.9; }     // the swing arm throws the bomb forward and down, nose staying roughly level
  if (m.gear) for (const g of m.gear) {                                   // retracting gear folds up into the airframe
    g.group.setRotationFromAxisAngle(g.axis, g.angle * (1 - gearPos));
    g.group.visible = gearPos > 0.03;
  }
  if (m.speedBrake) for (const b of m.speedBrake) b.group.setRotationFromAxisAngle(b.axis, b.angle * airbrake);
  if (m.flame && m.flame.userData.flames) {                              // A-10: two small flames, longer and brighter with throttle
    m.flame.visible = engine > 0.05;
    for (const g of m.flame.userData.flames) { g.scale.set(1, 1, 0.5 + engine * 0.8 + Math.random() * 0.12); g.children[0].material.opacity = 0.15 + engine * 0.3; }
  } else if (m.flame) {
    m.flame.visible = engine > 0.05;
    const k = afterburner ? 1.5 + Math.random() * 0.2 : 0.25 + engine * 0.5;
    m.flame.scale.set(afterburner ? 1.15 : 0.8, afterburner ? 1.15 : 0.8, k);
    m.flame.children[0].material.opacity = afterburner ? 0.6 : 0.12 + engine * 0.15;
  }
}
