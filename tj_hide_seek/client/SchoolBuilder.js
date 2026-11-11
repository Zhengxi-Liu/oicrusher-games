/**
 * SchoolBuilder - turns the traced floor plans (shared/SchoolMap.js) into a Three.js TJHSST.
 *
 *   walls      every room draws its own 12 cm wall just inside its outline (so neighbours sit back to back),
 *              with door gaps, frames, open door leaves and a crimson room plaque on the hallway side.
 *              Hallway faces get the cream tile with navy accents, room faces painted block, windows where
 *              the room touches the outside or a courtyard. Outside: brick (floor 1), brick + white band (floor 2).
 *   floors     terrazzo hallways, tile classrooms, maple gyms, library carpet; acoustic ceilings with light panels.
 *   stairs     enclosed switch-back stairwells and the open Grand Staircase in the Nobel Commons.
 *   the Dome   glass drum, white columns, entablature and dome over the main entrance (front door photo).
 *   furniture  one InstancedMesh per prototype: desks, lab benches, computer rows, lockers, bookshelves,
 *              cafeteria tables, vending machines, couches, bleachers, auditorium seats ...
 *   outside    lawn, front plaza, road, parking, trees, lamp posts, flag, stadium with the Colonials field.
 *
 * build() returns { surfaces } - boxes an item can be hidden on/under (see Hiding in main.js) - and adds
 * the furniture colliders to map.walls.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeTextures, makeLabelAtlas, courtTexture, M, CRIMSON, NAVY } from './Textures.js?v=4';

const rnd = (() => { let s = 77; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
const col = hex => new THREE.Color(hex);

// ---------------------------------------------------------------- geometry batches (one draw call per material)
class Batch {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; }
  /** A quad p0..p3 (each [x,y,z]) with uvs; flips itself to face `want` (a normal hint) if given. */
  quad(P, UV, want, color) {
    const ax = P[1][0] - P[0][0], ay = P[1][1] - P[0][1], az = P[1][2] - P[0][2];
    const bx = P[2][0] - P[0][0], by = P[2][1] - P[0][1], bz = P[2][2] - P[0][2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    let order = [0, 1, 2, 0, 2, 3];
    if (want && nx * want[0] + ny * want[1] + nz * want[2] < 0) { order = [0, 2, 1, 0, 3, 2]; nx = -nx; ny = -ny; nz = -nz; }
    const c = color || [1, 1, 1];
    for (const i of order) { this.p.push(...P[i]); this.n.push(nx, ny, nz); this.u.push(...(UV ? UV[i] : [0, 0])); this.c.push(...c); }
  }
  /** Axis-free box from a footprint (centre x,z, half extents along unit dir d and its normal), y0..y1. */
  box(x, z, hx, hz, rot, y0, y1, color) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const pt = (lx, lz, y) => [x + lx * c + lz * s, y, z - lx * s + lz * c];
    const corners = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]];
    const top = corners.map(([a, b]) => pt(a, b, y1)), bot = corners.map(([a, b]) => pt(a, b, y0));
    this.quad(top, null, [0, 1, 0], color);
    this.quad(bot, null, [0, -1, 0], color);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4, mx = (top[i][0] + top[j][0]) / 2 - x, mz = (top[i][2] + top[j][2]) / 2 - z;
      this.quad([bot[i], bot[j], top[j], top[i]], null, [mx, 0, mz], color);
    }
  }
  mesh(material, { shadow = false } = {}) {
    if (!this.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    if (material.vertexColors) g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.matrixAutoUpdate = false;
    m.castShadow = m.receiveShadow = shadow;
    return m;
  }
}
const rgb = hex => { const c = col(hex); return [c.r, c.g, c.b]; };

// ---------------------------------------------------------------- furniture prototypes (merged boxes, vertex colours)
function part(w, h, d, x, y, z, color, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  const c = col(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
/** A flat ring (basketball rim): torus of radius r, tube t, lying in the xz plane. */
function ring(r, t, x, y, z, color) {
  const g = new THREE.TorusGeometry(r, t, 6, 28);
  g.rotateX(Math.PI / 2); g.translate(x, y, z);
  const c = col(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function cyl(r, h, x, y, z, color, seg = 10, rTop = r) {
  const g = new THREE.CylinderGeometry(rTop, r, h, seg);
  g.translate(x, y, z);
  const c = col(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  g.deleteAttribute('uv');
  return g;
}
const legs = (w, d, h, t, color, inset = 0.03) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => part(t, h, t, a * (w / 2 - inset), h / 2, b * (d / 2 - inset), color));
const merge = parts => { parts.forEach(p => p.deleteAttribute('uv')); return mergeGeometries(parts); };

/** Every prototype faces +z (its "front"); footprint hx/hz/h describe its collider / hiding surface. */
function prototypes(T) {
  const P = {};
  const lam = new THREE.MeshLambertMaterial({ vertexColors: true });
  const def = (name, geo, fp, mat = lam) => { P[name] = { geo, mat, fp, list: [] }; };
  // student desk with its chair behind it (the student faces +z, toward the board)
  def('desk', merge([part(0.62, 0.03, 0.46, 0, 0.74, 0.05, '#c9a676'), part(0.03, 0.73, 0.4, -0.28, 0.365, 0.05, '#5a5f66'), part(0.03, 0.73, 0.4, 0.28, 0.365, 0.05, '#5a5f66'),
    part(0.62, 0.012, 0.3, 0, 0.6, 0.12, '#4b5058'),
    part(0.42, 0.03, 0.4, 0, 0.45, -0.42, '#1f3b6e'), part(0.42, 0.34, 0.03, 0, 0.75, -0.63, '#1f3b6e'),
    part(0.025, 0.44, 0.36, -0.19, 0.22, -0.42, '#5a5f66'), part(0.025, 0.44, 0.36, 0.19, 0.22, -0.42, '#5a5f66')]),
    { hx: 0.31, hz: 0.23, h: 0.755, oz: 0.05, top: true });
  def('teacher', merge([part(1.5, 0.04, 0.75, 0, 0.75, 0, '#8b6a45'), part(1.46, 0.7, 0.04, 0, 0.38, -0.33, '#7a5c3b'),
    part(0.04, 0.73, 0.72, -0.72, 0.37, 0, '#7a5c3b'), part(0.04, 0.73, 0.72, 0.72, 0.37, 0, '#7a5c3b'), part(0.4, 0.6, 0.66, 0.5, 0.33, 0, '#7a5c3b'),
    part(0.35, 0.25, 0.02, -0.3, 0.9, 0.1, '#222'), part(0.5, 0.45, 0.5, 0, 0.25, 0.75, '#333a44'), part(0.5, 0.5, 0.06, 0, 0.7, 1.0, '#333a44')]),
    { hx: 0.75, hz: 0.38, h: 0.77, solid: true, top: true });
  def('bench', merge([part(2.4, 0.05, 0.9, 0, 0.9, 0, '#20242a'), part(2.36, 0.82, 0.86, 0, 0.42, 0, '#b8b2a4'),
    part(0.04, 0.3, 0.04, 0.6, 1.07, 0, '#9aa0a8'), part(0.2, 0.03, 0.04, 0.6, 1.2, 0.08, '#9aa0a8')]),
    { hx: 1.2, hz: 0.45, h: 0.925, solid: true, top: true });
  def('stool', merge([cyl(0.17, 0.05, 0, 0.66, 0, '#222'), cyl(0.02, 0.64, 0, 0.32, 0, '#888'), cyl(0.2, 0.03, 0, 0.02, 0, '#666')]), null);
  def('computer', merge([part(1.6, 0.04, 0.75, 0, 0.74, 0, '#d8d4cc'), ...legs(1.56, 0.7, 0.72, 0.04, '#55595f'),
    part(0.55, 0.34, 0.03, -0.4, 1.0, 0.15, '#15171b'), part(0.5, 0.3, 0.01, -0.4, 1.0, 0.135, '#3c6fa8'), part(0.06, 0.16, 0.06, -0.4, 0.82, 0.18, '#15171b'),
    part(0.55, 0.34, 0.03, 0.4, 1.0, 0.15, '#15171b'), part(0.5, 0.3, 0.01, 0.4, 1.0, 0.135, '#2e8a5a'), part(0.06, 0.16, 0.06, 0.4, 0.82, 0.18, '#15171b'),
    part(0.45, 0.02, 0.15, -0.4, 0.77, -0.12, '#2a2d33'), part(0.45, 0.02, 0.15, 0.4, 0.77, -0.12, '#2a2d33'),
    part(0.45, 0.45, 0.45, -0.4, 0.25, -0.6, '#1c1f25'), part(0.45, 0.45, 0.45, 0.4, 0.25, -0.6, '#1c1f25'),
    part(0.45, 0.45, 0.06, -0.4, 0.68, -0.82, '#1c1f25'), part(0.45, 0.45, 0.06, 0.4, 0.68, -0.82, '#1c1f25')]),
    { hx: 0.8, hz: 0.38, h: 0.76, solid: true, top: true });
  def('table', merge([part(1.8, 0.04, 0.9, 0, 0.74, 0, '#c9a676'), ...legs(1.74, 0.84, 0.72, 0.05, '#4b5058')]), { hx: 0.9, hz: 0.45, h: 0.76, top: true });
  // chess club table (Room 23): a small square table with an inlaid 8x8 board
  {
    const sq = [];
    for (let i = 0; i < 64; i++) sq.push(part(0.07, 0.006, 0.07, ((i % 8) - 3.5) * 0.07, 0.776, (((i / 8) | 0) - 3.5) * 0.07, ((i % 8) + ((i / 8) | 0)) % 2 ? '#7a5230' : '#efdcb6'));
    def('chesstable', merge([part(0.9, 0.04, 0.9, 0, 0.74, 0, '#8b6a45'), part(0.62, 0.012, 0.62, 0, 0.766, 0, '#4a3020'), ...sq, ...legs(0.86, 0.86, 0.72, 0.05, '#4b5058')]),
      { hx: 0.45, hz: 0.45, h: 0.78, solid: true, top: true });
  }
  def('chair', merge([part(0.44, 0.03, 0.42, 0, 0.45, 0, '#1f3b6e'), part(0.44, 0.36, 0.03, 0, 0.75, -0.2, '#1f3b6e'), ...legs(0.4, 0.38, 0.44, 0.025, '#5a5f66')]), null);
  def('cafe', merge([part(3.0, 0.04, 0.76, 0, 0.74, 0, '#8a5a36'), part(2.6, 0.06, 0.06, 0, 0.36, 0, '#666'),
    ...[-1.1, -0.37, 0.37, 1.1].flatMap(x => [cyl(0.16, 0.05, x, 0.46, 0.62, '#b0182c', 12), cyl(0.16, 0.05, x, 0.46, -0.62, '#b0182c', 12),
      part(0.03, 0.44, 0.03, x, 0.22, 0.62, '#666'), part(0.03, 0.44, 0.03, x, 0.22, -0.62, '#666')]),
    part(0.05, 0.72, 0.6, -1.3, 0.36, 0, '#555'), part(0.05, 0.72, 0.6, 1.3, 0.36, 0, '#555')]),
    { hx: 1.5, hz: 0.38, h: 0.76, top: true, solid: true });
  def('roundtable', merge([cyl(0.6, 0.04, 0, 0.74, 0, '#c9a676', 16), cyl(0.05, 0.72, 0, 0.36, 0, '#555'),
    ...[0, 1, 2, 3].map(k => cyl(0.17, 0.05, Math.cos(k * 1.57) * 0.85, 0.46, Math.sin(k * 1.57) * 0.85, '#b0182c', 12))]), { hx: 0.6, hz: 0.6, h: 0.76, top: true });
  def('couch', merge([part(2.0, 0.42, 0.85, 0, 0.21, 0, '#3b3e46'), part(2.0, 0.45, 0.2, 0, 0.62, -0.33, '#3b3e46'),
    part(0.2, 0.25, 0.85, -0.9, 0.55, 0, '#3b3e46'), part(0.2, 0.25, 0.85, 0.9, 0.55, 0, '#3b3e46'),
    part(0.78, 0.1, 0.62, -0.4, 0.47, 0.06, '#a3182c'), part(0.78, 0.1, 0.62, 0.4, 0.47, 0.06, '#3b3e46')]),
    { hx: 1.0, hz: 0.43, h: 0.52, solid: true, top: true });
  def('cube', merge([part(0.8, 0.45, 0.8, 0, 0.225, 0, '#3b3e46')]), { hx: 0.4, hz: 0.4, h: 0.45, solid: true, top: true });
  def('bin', merge([part(0.42, 0.75, 0.42, 0, 0.375, 0, '#1f4aa0'), part(0.44, 0.03, 0.44, 0, 0.76, 0, '#173a80')]), { hx: 0.21, hz: 0.21, h: 0.77, solid: true, top: true });
  def('cabinet', merge([part(0.5, 1.3, 0.6, 0, 0.65, 0, '#8d939b'), part(0.36, 0.02, 0.01, 0, 1.1, 0.305, '#555'), part(0.36, 0.02, 0.01, 0, 0.7, 0.305, '#555'), part(0.36, 0.02, 0.01, 0, 0.3, 0.305, '#555')]),
    { hx: 0.25, hz: 0.3, h: 1.3, solid: true, top: true });
  def('counter', merge([part(2.0, 0.04, 0.65, 0, 0.92, 0, '#2a2e33'), part(1.96, 0.88, 0.6, 0, 0.44, 0, '#c8c2b4'), part(0.4, 0.02, 0.3, 0.4, 0.93, 0, '#8a9099')]),
    { hx: 1.0, hz: 0.33, h: 0.94, solid: true, top: true });
  def('steel', merge([part(2.0, 0.04, 0.75, 0, 0.92, 0, '#c4c8cc'), part(1.96, 0.04, 0.7, 0, 0.3, 0, '#aab0b6'), ...legs(1.94, 0.7, 0.9, 0.05, '#9aa0a6')]),
    { hx: 1.0, hz: 0.38, h: 0.94, solid: true, top: true });
  def('seats', merge([...[-1.5, -0.9, -0.3, 0.3, 0.9, 1.5].flatMap(x => [part(0.52, 0.08, 0.5, x, 0.45, 0, '#a3182c'), part(0.52, 0.55, 0.08, x, 0.8, -0.24, '#a3182c'),
    part(0.05, 0.6, 0.5, x + 0.28, 0.3, 0, '#2b2b2b')])]), { hx: 1.8, hz: 0.3, h: 0.5, solid: true, top: true });
  def('bleacher', merge([0, 1, 2, 3, 4].map(k => part(8, 0.45, 0.75, 0, 0.225 + k * 0.45 - (k ? 0 : 0), -k * 0.75 + 1.5, k % 2 ? '#c49a61' : '#b88d55').translate(0, 0, 0))
    .concat([0, 1, 2, 3, 4].map(k => part(8, k * 0.45 + 0.01, 0.75, 0, k * 0.225, -k * 0.75 + 1.5, '#4a4f57')))), { hx: 4, hz: 1.9, h: 2.25, solid: true, top: true });
  def('hoop', merge([part(0.18, 3.2, 0.18, 0, 1.6, -1.1, '#2f3640'), part(0.12, 0.12, 1.2, 0, 3.15, -0.5, '#2f3640'),
    part(1.8, 1.05, 0.05, 0, 3.4, 0.1, '#f2f2f2'), part(0.6, 0.45, 0.06, 0, 3.25, 0.12, '#c8102e'), ring(0.2286, 0.012, 0, 3.05, 0.4, '#ff5a00'), part(0.04, 0.03, 0.16, 0, 3.05, 0.2, '#ff5a00')]),
    { hx: 0.3, hz: 0.3, h: 3.2, oz: -1.1, solid: true });
  def('piano', merge([part(1.5, 1.2, 0.6, 0, 0.6, 0, '#111'), part(1.4, 0.04, 0.3, 0, 0.75, 0.4, '#f5f5f5'), part(1.4, 0.05, 0.31, 0, 0.73, 0.4, '#111')]),
    { hx: 0.75, hz: 0.3, h: 1.2, solid: true, top: true });
  def('stand', merge([cyl(0.015, 1.0, 0, 0.5, 0, '#222', 6), part(0.45, 0.32, 0.02, 0, 1.1, 0.02, '#222')]), null);
  def('machine', merge([part(1.6, 1.8, 1.2, 0, 0.9, 0, '#6f7f8a'), cyl(0.18, 1.6, 0.5, 1.6, 0, '#9aa5ad', 10), part(0.4, 0.3, 0.05, -0.3, 1.3, 0.62, '#2b3a46')]),
    { hx: 0.8, hz: 0.6, h: 1.8, solid: true, top: true });
  def('mat', merge([part(1.0, 0.06, 2.0, 0, 0.03, 0, '#1d3f88')]), null);
  def('rack', merge([part(1.4, 0.06, 0.06, 0, 1.4, 0, '#2a2a2a'), part(0.06, 1.6, 0.06, -0.6, 0.8, 0, '#444'), part(0.06, 1.6, 0.06, 0.6, 0.8, 0, '#444'),
    cyl(0.22, 0.05, -0.75, 1.4, 0, '#111', 12), cyl(0.22, 0.05, 0.75, 1.4, 0, '#111', 12), part(0.5, 0.1, 1.3, 0, 0.45, 0.8, '#222')]),
    { hx: 0.7, hz: 0.3, h: 1.6, solid: true });
  def('stall', merge([part(0.04, 2.0, 1.5, -0.45, 1.1, 0, '#8a6d5a'), part(0.04, 2.0, 1.5, 0.45, 1.1, 0, '#8a6d5a'), part(0.9, 2.0, 0.04, 0, 1.1, 0.75, '#8a6d5a'),
    part(0.4, 0.4, 0.6, 0, 0.2, -0.4, '#f4f4f4')]), { hx: 0.47, hz: 0.77, h: 2.1, solid: true });
  def('sink', merge([part(2.4, 0.06, 0.55, 0, 0.85, 0, '#d9d4c8'), part(2.4, 0.8, 0.04, 0, 0.42, -0.25, '#b0aca2'), part(2.4, 0.8, 0.02, 0, 1.6, -0.27, '#cfe2ee')]),
    { hx: 1.2, hz: 0.28, h: 0.88, solid: true, top: true });
  def('easel', merge([part(0.04, 1.6, 0.04, -0.3, 0.8, 0, '#9b7a52', 0), part(0.04, 1.6, 0.04, 0.3, 0.8, 0, '#9b7a52'), part(0.7, 0.9, 0.03, 0, 1.25, 0.04, '#f6f2e8')]), null);
  def('box', merge([part(0.5, 0.4, 0.4, 0, 0.2, 0, '#b48a5a'), part(0.4, 0.3, 0.4, 0.05, 0.55, 0, '#a77c4e')]), { hx: 0.25, hz: 0.2, h: 0.7, solid: true, top: true });
  def('podium', merge([part(0.6, 1.1, 0.5, 0, 0.55, 0, '#7a5c3b'), part(0.62, 0.04, 0.4, 0, 1.12, 0.05, '#8b6a45', 0)]), { hx: 0.3, hz: 0.25, h: 1.14, solid: true, top: true });
  def('tree', merge([cyl(0.18, 2.6, 0, 1.3, 0, '#5b4330', 7), cyl(1.9, 2.8, 0, 3.9, 0, '#4c7a35', 8, 0.2), cyl(1.4, 2.2, 0, 5.1, 0, '#5a8a3d', 8, 0.1)]),
    { hx: 0.3, hz: 0.3, h: 2.6, solid: true });
  def('lamp', merge([cyl(0.08, 7, 0, 3.5, 0, '#4a4d52', 6), part(0.9, 0.12, 0.35, 0.35, 7, 0, '#3a3d42'), part(0.6, 0.03, 0.25, 0.35, 6.93, 0, '#fff8d8')]),
    { hx: 0.12, hz: 0.12, h: 7, solid: true });
  def('car', merge([part(1.8, 0.7, 4.3, 0, 0.55, 0, '#888'), part(1.6, 0.55, 2.2, 0, 1.15, -0.2, '#888'), part(1.62, 0.45, 2.0, 0, 1.15, -0.2, '#26313b'),
    ...[[-1, 1.4], [1, 1.4], [-1, -1.4], [1, -1.4]].map(([a, b]) => part(0.26, 0.64, 0.64, a * 0.82, 0.32, b, '#16171a'))]),
    { hx: 0.9, hz: 2.15, h: 1.45, solid: true, top: true });
  def('benchOut', merge([part(1.8, 0.06, 0.45, 0, 0.45, 0, '#8a5a36'), part(1.8, 0.4, 0.05, 0, 0.75, -0.2, '#8a5a36'), part(0.06, 0.45, 0.4, -0.8, 0.22, 0, '#333'), part(0.06, 0.45, 0.4, 0.8, 0.22, 0, '#333')]),
    { hx: 0.9, hz: 0.23, h: 0.48, top: true });
  // textured: lockers, bookcases, vending machines (front face +z gets the texture)
  const side = c => new THREE.MeshLambertMaterial({ color: c });
  const faceMats = (front, sideColor) => [side(sideColor), side(sideColor), side(sideColor), side(sideColor), new THREE.MeshLambertMaterial({ map: front }), side(sideColor)];
  def('locker', new THREE.BoxGeometry(0.9, 1.85, 0.45).translate(0, 0.925, 0), { hx: 0.45, hz: 0.225, h: 1.85, solid: true, top: true }, faceMats(T.locker, '#24427a'));
  def('shelf', new THREE.BoxGeometry(1.0, 2.0, 0.42).translate(0, 1.0, 0), { hx: 0.5, hz: 0.21, h: 2.0, solid: true, top: true }, faceMats(T.books, '#5c3f26'));
  def('shelf2', new THREE.BoxGeometry(1.0, 1.6, 0.6).translate(0, 0.8, 0), { hx: 0.5, hz: 0.3, h: 1.6, solid: true, top: true },
    [side('#5c3f26'), side('#5c3f26'), side('#5c3f26'), side('#5c3f26'), new THREE.MeshLambertMaterial({ map: T.books }), new THREE.MeshLambertMaterial({ map: T.books })]);
  def('vending', new THREE.BoxGeometry(1.0, 1.9, 0.8).translate(0, 0.95, 0), { hx: 0.5, hz: 0.4, h: 1.9, solid: true, top: true },
    [side('#1a1a1e'), side('#1a1a1e'), side('#1a1a1e'), side('#1a1a1e'), new THREE.MeshLambertMaterial({ map: T.vending, emissive: 0xffffff, emissiveMap: T.vending, emissiveIntensity: 0.35 }), side('#1a1a1e')]);
  return P;
}

// ---------------------------------------------------------------- the builder
export class SchoolBuilder {
  constructor(map, renderer) {
    this.map = map;
    this.T = makeTextures();
    this.surfaces = [];
    this.renderer = renderer;
  }

  build(scene) {
    const map = this.map, T = this.T, F2Y = map.F2Y, CEIL = map.CEIL, ROOF = map.ROOF;
    const root = new THREE.Group(); root.name = 'school';
    this.root = root;
    const lam = (opts) => new THREE.MeshLambertMaterial(opts);
    const MAT = {
      hall: lam({ map: T.hallWall }), room: lam({ map: T.roomWall }), win: lam({ map: T.windowWall }),
      brick1: lam({ map: T.brick1 }), brick2: lam({ map: T.brick2 }), solid: lam({ vertexColors: true }),
      terrazzo: lam({ map: T.terrazzo }), vct: lam({ map: T.vct }), wood: lam({ map: T.wood }), carpet: lam({ map: T.carpet }),
      ceiling: lam({ map: T.ceiling, emissive: 0xfff6dc, emissiveMap: T.ceilingGlow, emissiveIntensity: 0.9 }),
      grass: lam({ map: T.grass }), asphalt: lam({ map: T.asphalt }), concrete: lam({ map: T.concrete }), pavers: lam({ map: T.pavers }),
      roof: lam({ color: 0x8d9096 }),
      plain: lam({ color: 0xe8e5de }),                                       // painted drywall (stairwells: no block)
      glass: new THREE.MeshLambertMaterial({ color: 0x9cc3dc, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
    };
    this.MAT = MAT;
    const B = {}; for (const k of Object.keys(MAT)) B[k] = new Batch();
    const base = f => (f === 2 ? F2Y : 0);
    const C = { cap: rgb('#d9d6ce'), frame: rgb('#6b7078'), door: rgb('#a8794a'), doorGlass: rgb('#9fc4dc'), white: rgb('#f2f1ec'),
                rail: rgb('#c0c4c9'), step: rgb('#cfcac0'), nose: rgb('#5d6168'), slab: rgb('#e4e2dc') };

    // --- wall emitter: segment a->b (xz), outward normal n, thickness from t0 to t1 along n, height y0..y1
    const wall = (a, b, y0, y1, n, t0, t1, outB, innB, vb, vh, capColor = C.cap) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 0.01) return;
      const P = (p, t, y) => [p[0] + n[0] * t, y, p[1] + n[1] * t];
      const v0 = (y0 - vb) / vh, v1 = (y1 - vb) / vh, u0 = (a.u0 || 0) / 4, u1 = u0 + len / 4;
      if (outB) outB.quad([P(b, t1, y0), P(a, t1, y0), P(a, t1, y1), P(b, t1, y1)], [[u1, v0], [u0, v0], [u0, v1], [u1, v1]], [n[0], 0, n[1]]);
      if (innB) innB.quad([P(a, t0, y0), P(b, t0, y0), P(b, t0, y1), P(a, t0, y1)], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], [-n[0], 0, -n[1]]);
      B.solid.quad([P(a, t0, y1), P(b, t0, y1), P(b, t1, y1), P(a, t1, y1)], null, [0, 1, 0], capColor);
      const d = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      B.solid.quad([P(a, t0, y0), P(a, t1, y0), P(a, t1, y1), P(a, t0, y1)], null, [-d[0], 0, -d[1]], capColor);
      B.solid.quad([P(b, t0, y0), P(b, t1, y0), P(b, t1, y1), P(b, t0, y1)], null, [d[0], 0, d[1]], capColor);
    };
    const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

    // --- room walls, doors, plaques
    const plaqueNames = [...new Set([...map.rooms.map(r => r.name), ...map.courts.map(c => c.name)])];
    const courtSigns = [];
    const plaques = makeLabelAtlas(plaqueNames, { cellW: 256, cellH: 64, cols: 8 });
    const plaqueB = new Batch();
    const doorsOut = [];
    for (const rm of map.rooms) {
      const yb = base(rm.floor), yt = yb + CEIL, t = 0.12;
      rm.edges.forEach((e, i) => {
        const n = [e.nx, e.nz];
        // every wall has both faces: a room is closed from every side, whatever its edge was classified as
        const out = e.side === 'court' ? B.brick1 : B.hall;
        const inn = e.side === 'ext' || e.side === 'court' ? B.win : B.room;
        const gaps = e.gaps.map(g => ({ d: g.door, own: g.own, t0: Math.max(0, g.t0), t1: Math.min(1, g.t1) })).sort((p, q) => p.t0 - q.t0);
        let s = 0;
        const seg = (s0, s1, y0, y1) => { const a = lerp2(e.a, e.b, s0), b = lerp2(e.a, e.b, s1); a.u0 = s0 * e.len; wall(a, b, y0, y1, n, -t, 0, out, inn, yb, CEIL); };
        // double-height gyms: the wall carries on above the floor-1 ceiling up to the roof (brick outside)
        if (rm.tall) { const a = e.a.slice(); a.u0 = 0; wall(a, e.b, yt, ROOF - 0.2, n, -t, 0, B.brick1, B.room, yb, CEIL); }
        for (const g of gaps) {
          if (g.t0 > s) seg(s, g.t0, yb, yt);
          if (g.t1 <= s) continue;
          seg(Math.max(s, g.t0), g.t1, yb + 2.3, yt);                         // header over the door
          if (g.own) doorsOut.push({ rm, e, g, yb });
          s = g.t1;
        }
        if (s < 1) seg(s, 1, yb, yt);
      });
    }
    // door frames, open leaves, plaques on the hallway side
    for (const { rm, e, g, yb } of doorsOut) {
      const n = [e.nx, e.nz], d = [(e.b[0] - e.a[0]) / e.len, (e.b[1] - e.a[1]) / e.len];
      const pa = lerp2(e.a, e.b, g.t0), pb = lerp2(e.a, e.b, g.t1), w = g.d.w;
      const rot = Math.atan2(d[0], d[1]);
      for (const p of [pa, pb]) B.solid.box(p[0] - n[0] * 0.06, p[1] - n[1] * 0.06, 0.09, 0.04, rot, yb, yb + 2.32, C.frame);
      B.solid.box((pa[0] + pb[0]) / 2 - n[0] * 0.06, (pa[1] + pb[1]) / 2 - n[1] * 0.06, 0.09, w / 2 + 0.04, rot, yb + 2.28, yb + 2.36, C.frame);
      const leaves = w > 2 ? [[pa, 1], [pb, -1]] : [[pa, 1]];
      const lw = w > 2 ? w / 2 - 0.04 : w - 0.08;
      for (const [hp, sgn] of leaves) {
        // swung 95 degrees into the room, standing against the wall
        const cx = hp[0] + d[0] * sgn * 0.05 - n[0] * (lw / 2 + 0.14), cz = hp[1] + d[1] * sgn * 0.05 - n[1] * (lw / 2 + 0.14);
        B.solid.box(cx, cz, 0.025, lw / 2, Math.atan2(n[0], n[1]), yb + 0.01, yb + 2.22, C.door);
        B.solid.box(cx - d[0] * sgn * 0.03, cz - d[1] * sgn * 0.03, 0.01, 0.12, Math.atan2(n[0], n[1]), yb + 1.3, yb + 1.9, C.doorGlass);
      }
      if (e.side === 'hall' || e.side === 'stair') {
        const uv = plaques.uv.get(rm.name);
        const side = g.t1 * e.len + 0.42 < e.len ? pb : pa, dir = side === pb ? 1 : -1;
        const c = [side[0] + d[0] * dir * 0.4 + n[0] * 0.012, side[1] + d[1] * dir * 0.4 + n[1] * 0.012];
        const hw = 0.3, y0 = yb + 1.55, y1 = yb + 1.7;
        const A = [c[0] - d[0] * hw, c[1] - d[1] * hw], Bp = [c[0] + d[0] * hw, c[1] + d[1] * hw];
        plaqueB.quad([[Bp[0], y0, Bp[1]], [A[0], y0, A[1]], [A[0], y1, A[1]], [Bp[0], y1, Bp[1]]], [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]], [n[0], 0, n[1]]);
      }
    }
    this.plaques = plaques; this.plaqueB = plaqueB;

    // --- exterior walls (outline), with glass doors at the numbered exits
    for (const f of [1, 2]) {
      const P = map.outline[f].poly, yb = base(f), yt = f === 1 ? F2Y : ROOF, vh = yt - yb, outB = f === 1 ? B.brick1 : B.brick2;
      const doorList = f === 1 ? map.extDoors : [];
      for (let i = 0; i < P.length; i++) {
        if (map.outline[f].open[i]) continue;
        const a = P[i], b = P[(i + 1) % P.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const n = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
        const gaps = [];
        for (const d of doorList) {
          if (map.segDist(d.p[0], d.p[1], a[0], a[1], b[0], b[1]) > 1.2) continue;
          const t = ((d.p[0] - a[0]) * (b[0] - a[0]) + (d.p[1] - a[1]) * (b[1] - a[1])) / (len * len);
          gaps.push({ t0: t - 1.1 / len, t1: t + 1.1 / len });
        }
        gaps.sort((p, q) => p.t0 - q.t0);
        let s = 0;
        const seg = (s0, s1, y0, y1) => { const A = lerp2(a, b, s0), Bq = lerp2(a, b, s1); A.u0 = s0 * len; wall(A, Bq, y0, y1, n, 0, 0.3, outB, B.hall, yb, vh, C.white); };
        for (const g of gaps) {
          if (g.t0 > s) seg(s, g.t0, yb, yt);
          seg(g.t0, g.t1, yb + 2.6, yt);
          const pa = lerp2(a, b, g.t0), pb = lerp2(a, b, g.t1), rot = Math.atan2(b[0] - a[0], b[1] - a[1]);
          for (const p of [pa, pb, lerp2(pa, pb, 0.5)]) B.solid.box(p[0] + n[0] * 0.15, p[1] + n[1] * 0.15, 0.05, 0.16, rot, yb, yb + 2.6, C.frame);
          // canopy over the door
          B.solid.box((pa[0] + pb[0]) / 2 + n[0] * 1.0, (pa[1] + pb[1]) / 2 + n[1] * 1.0, 0.9, 1.6, Math.atan2(n[0], n[1]), yb + 2.9, yb + 3.05, C.white);
          s = g.t1;
        }
        if (s < 1) seg(s, 1, yb, yt);
      }
    }

    // --- courtyards: glass curtain walls where they face a hallway; fascia under the roof edge
    for (const ct of map.courts) {
      const P = ct.poly;
      for (let i = 0; i < P.length; i++) {
        const a = P[i], b = P[(i + 1) % P.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 0.05) continue;
        const n = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];        // points out of the courtyard
        const rot = Math.atan2(b[0] - a[0], b[1] - a[1]);
        wall(a, b, CEIL - 0.05, F2Y, n, 0, 0.25, B.solid && null, null, 0, 1, C.white);
        B.solid.quad([[b[0], CEIL - 0.05, b[1]], [a[0], CEIL - 0.05, a[1]], [a[0], F2Y, a[1]], [b[0], F2Y, b[1]]], null, [-n[0], 0, -n[1]], C.white);
        const mid = lerp2(a, b, 0.5);
        const onEdge = ct.doors.filter(d => map.segDist(d[0], d[1], a[0], a[1], b[0], b[1]) < 1.2);
        const doors = onEdge.map(d => ((d[0] - a[0]) * (b[0] - a[0]) + (d[1] - a[1]) * (b[1] - a[1])) / (len * len));
        // glass where the edge faces a hallway (a room along the courtyard builds its own wall): the whole edge when its
        // middle does, or when it has a door; otherwise - and for a door marked {part: true} - only the stretches that do,
        // sampled along it: one edge can run past a room and then a hallway (107 HPE, then the Gandhi hallway), which used
        // to leave the hallway part an invisible wall
        const facing = map.cell(1, mid[0] + n[0] * 0.7, mid[1] + n[1] * 0.7);
        const part = onEdge.some(d => d.opts && d.opts.part);
        const open = !part && (facing === 'hall' || facing === 'stair' || doors.length) ? [[0, 1]] : [], STEP = Math.min(0.5, 0.25 / len);
        if (!open.length) for (let t = 0; t < 1; t += STEP) {
          const p = lerp2(a, b, Math.min(1, t + STEP / 2)), c = map.cell(1, p[0] + n[0] * 0.7, p[1] + n[1] * 0.7);
          if (c !== 'hall' && c !== 'stair') continue;
          const last = open[open.length - 1];
          if (last && Math.abs(last[1] - t) < 1e-6) last[1] = Math.min(1, t + STEP); else open.push([t, Math.min(1, t + STEP)]);
        }
        if (!open.length && !doors.length) continue;
        const DW = 1.0 / len;                                          // half the door width (2 m) along the edge
        const gaps = doors.map(t => [t - DW, t + DW]).sort((p, q) => p[0] - q[0]);
        const glassSeg = (t0, t1) => {
          if (t1 - t0 < 1e-3) return;
          const p0 = lerp2(a, b, t0), p1 = lerp2(a, b, t1), sl = (t1 - t0) * len, m2 = lerp2(a, b, (t0 + t1) / 2);
          B.glass.quad([[p0[0], 0, p0[1]], [p1[0], 0, p1[1]], [p1[0], CEIL - 0.05, p1[1]], [p0[0], CEIL - 0.05, p0[1]]], null, [n[0], 0, n[1]]);
          const nm = Math.max(1, Math.round(sl / 1.5));
          for (let k = 0; k <= nm; k++) { const p = lerp2(p0, p1, k / nm); B.solid.box(p[0], p[1], 0.04, 0.05, rot, 0, CEIL, C.frame); }
          B.solid.box(m2[0], m2[1], 0.05, sl / 2, rot, 0, 0.12, C.frame);
          B.solid.box(m2[0], m2[1], 0.04, sl / 2, rot, 2.5, 2.56, C.frame);
        };
        for (const [o0, o1] of open) {                                 // glass on the open stretches, minus the doors
          let tt = o0;
          for (const [g0, g1] of gaps) { if (g1 <= tt || g0 >= o1) continue; glassSeg(tt, Math.max(tt, g0)); tt = Math.max(tt, g1); }
          glassSeg(tt, o1);
        }
        for (const t of doors) {
          const pa = lerp2(a, b, t - DW), pb = lerp2(a, b, t + DW), pc = lerp2(a, b, t);
          // frame: two posts, a transom bar, glass above the door
          for (const p of [pa, pb]) B.solid.box(p[0], p[1], 0.08, 0.07, rot, 0, CEIL, C.frame);
          B.solid.box(pc[0], pc[1], 0.08, 1.05, rot, 2.35, 2.47, C.frame);
          B.glass.quad([[pa[0], 2.47, pa[1]], [pb[0], 2.47, pb[1]], [pb[0], CEIL - 0.05, pb[1]], [pa[0], CEIL - 0.05, pa[1]]], null, [n[0], 0, n[1]]);
          // two glass leaves swung open into the courtyard
          const nr = Math.atan2(n[0], n[1]);
          for (const [hp, sg] of [[pa, 1], [pb, -1]]) {
            const d = [(b[0] - a[0]) / len * sg, (b[1] - a[1]) / len * sg];
            const ang = 1.15, ca = Math.cos(ang), sa = Math.sin(ang);
            // leaf direction: from the hinge toward the door centre, rotated out of the building
            const ld = [d[0] * ca - n[0] * sa, d[1] * ca - n[1] * sa];
            const c0 = [hp[0] + ld[0] * 0.48, hp[1] + ld[1] * 0.48], lr = Math.atan2(ld[0], ld[1]);
            B.solid.box(c0[0], c0[1], 0.03, 0.48, lr, 0.02, 0.1, C.frame);
            B.solid.box(c0[0], c0[1], 0.03, 0.48, lr, 2.25, 2.32, C.frame);
            const e0 = [hp[0] + ld[0] * 0.02, hp[1] + ld[1] * 0.02], e1 = [hp[0] + ld[0] * 0.95, hp[1] + ld[1] * 0.95];
            for (const e of [e0, e1]) B.solid.box(e[0], e[1], 0.03, 0.03, lr, 0.02, 2.32, C.frame);
            B.glass.quad([[e0[0], 0.1, e0[1]], [e1[0], 0.1, e1[1]], [e1[0], 2.25, e1[1]], [e0[0], 2.25, e0[1]]], null, null);
            B.solid.box(c0[0] + ld[0] * 0.3, c0[1] + ld[1] * 0.3, 0.05, 0.015, lr, 1.0, 1.05, C.rail);
            void nr;
          }
          // a pad of pavers outside, and the "Courtyard" plaque over the door on the hallway side
          B.solid.box(pc[0] - n[0] * 1.3, pc[1] - n[1] * 1.3, 1.25, 1.3, Math.atan2(n[0], n[1]), 0.03, 0.045, rgb('#bdb6a8'));
          courtSigns.push({ p: pc, n, d: [(b[0] - a[0]) / len, (b[1] - a[1]) / len], name: ct.name });
        }
      }
    }

    for (const cs of courtSigns) {                      // above each courtyard door, facing the hallway
      const uv = plaques.uv.get(cs.name), hw = 0.75, y0 = 2.6, y1 = 2.98, c = [cs.p[0] + cs.n[0] * 0.09, cs.p[1] + cs.n[1] * 0.09];
      const A = [c[0] - cs.d[0] * hw, c[1] - cs.d[1] * hw], Bq = [c[0] + cs.d[0] * hw, c[1] + cs.d[1] * hw];
      plaqueB.quad([[Bq[0], y0, Bq[1]], [A[0], y0, A[1]], [A[0], y1, A[1]], [Bq[0], y1, Bq[1]]], [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]], [cs.n[0], 0, cs.n[1]]);
    }
    root.add(plaqueB.mesh(new THREE.MeshLambertMaterial({ map: plaques.tex })));

    // --- floors, ceilings, roofs (Shape: outline with holes)
    const shapeOf = (poly, holes, flipZ) => {
      const sh = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, flipZ ? -z : z)));
      for (const h of holes) sh.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, flipZ ? -z : z))));
      return sh;
    };
    const flatGeo = (poly, holes, y, up, uvm) => {
      const g = new THREE.ShapeGeometry(shapeOf(poly, holes, up));
      g.rotateX(up ? -Math.PI / 2 : Math.PI / 2);
      g.translate(0, y, 0);
      const uv = g.attributes.uv, pos = g.attributes.position;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / uvm[0], pos.getZ(i) / uvm[1]);
      return g;
    };
    const flat = (poly, holes, y, up, mat, uvm) => {
      const m = new THREE.Mesh(flatGeo(poly, holes, y, up, uvm), mat); m.matrixAutoUpdate = false; root.add(m); return m;
    };
    const floorGeos = new Map();                    // material -> geometries, merged after the loop
    const addFloor = (mat, g) => { if (!floorGeos.has(mat)) floorGeos.set(mat, []); floorGeos.get(mat).push(g); };
    const stairBoxes = map.stairs.map(s => s.box);
    const courtPolys = map.courts.map(c => c.poly);
    const voidPolys = map.voids.map(v => v.poly);
    const o1 = map.outline[1].poly, o2 = map.outline[2].poly;
    this.floorMeshes = [
      flat(o1, courtPolys, 0.02, true, MAT.terrazzo, M.terrazzo),
      flat(o2, [...voidPolys, ...stairBoxes], F2Y, true, MAT.terrazzo, M.terrazzo),
    ];
    const tallPolys = map.rooms.filter(r => r.tall).map(r => r.poly);
    flat(o1, [...courtPolys, ...voidPolys, ...stairBoxes, ...tallPolys], CEIL, false, MAT.ceiling, M.ceiling);
    flat(o1, [...courtPolys, ...voidPolys, ...stairBoxes, ...tallPolys], F2Y - 0.03, true, MAT.roof, [10, 10]);
    for (const tp of tallPolys) { flat(tp, [], ROOF - 0.2, false, MAT.ceiling, M.ceiling); flat(tp, [], ROOF - 0.15, true, MAT.roof, [10, 10]); }
    flat(o2, [], F2Y + CEIL, false, MAT.ceiling, M.ceiling);
    flat(o2, [], ROOF, true, MAT.roof, [10, 10]);
    // the slab edge around the atrium and the stairwell holes (between the floor-1 ceiling and floor 2)
    for (const v of voidPolys) for (let i = 0; i < v.length; i++) {
      const a = v[i], b = v[(i + 1) % v.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
      B.solid.quad([[a[0], CEIL, a[1]], [b[0], CEIL, b[1]], [b[0], F2Y, b[1]], [a[0], F2Y, a[1]]], null, [-n[0], 0, -n[1]], C.white);
      // glass balustrade + steel handrail on floor 2
      B.glass.quad([[a[0], F2Y, a[1]], [b[0], F2Y, b[1]], [b[0], F2Y + 1.05, b[1]], [a[0], F2Y + 1.05, a[1]]], null, [n[0], 0, n[1]]);
      const mid = lerp2(a, b, 0.5), rot = Math.atan2(b[0] - a[0], b[1] - a[1]);
      B.solid.box(mid[0], mid[1], 0.04, len / 2, rot, F2Y + 1.05, F2Y + 1.1, C.rail);
      const nm = Math.max(1, Math.round(len / 1.4));
      for (let k = 0; k <= nm; k++) { const p = lerp2(a, b, k / nm); B.solid.box(p[0], p[1], 0.025, 0.025, rot, F2Y, F2Y + 1.05, C.rail); }
    }
    // the atrium's columns (as in the Nobel Commons photo)
    for (const v of voidPolys) {
      const bb = map.bbox(v);
      for (const x of [bb.x0 + 1.2, (bb.x0 + bb.x1) / 2, bb.x1 - 1.2]) for (const z of [bb.z1 + 0.6]) {
        B.solid.box(x, z, 0.22, 0.22, 0, 0, F2Y, C.white);
        map.walls.push({ a: [x - 0.25, z], b: [x + 0.25, z], y0: 0, y1: CEIL, kind: 'furn' });
      }
    }

    // room floors: tile, maple, carpet ...
    const roomFloor = { class: 'vct', lab: 'vct', cs: 'vct', office: 'carpet', music: 'vct', gym: 'wood', aud: 'carpet', cafe: 'vct', library: 'carpet',
      store: 'concrete', rest: 'vct', lounge: 'carpet', mech: 'concrete', plan: 'carpet', lecture: 'carpet', art: 'vct', kitchen: 'vct',
      locker: 'vct', blackbox: 'asphalt', gymx: 'wood' };
    for (const rm of map.rooms) {
      const y = base(rm.floor) + 0.03;
      if (rm.kind === 'gym' && /Gym/.test(rm.name)) {
        const bb = map.bbox(rm.poly), w = bb.x1 - bb.x0, d = bb.z1 - bb.z0;
        // baselines follow the hoops (shared/Hoops.js moves them in when a door is behind one): rim 1.6 m in front of it
        const tex = courtTexture(T.wood, w, d, window.TJHoops ? TJHoops.hoopOffset(map, rm) + 0.4 - 1.6 : 1.2);
        const g = new THREE.PlaneGeometry(w, d); g.rotateX(-Math.PI / 2); g.translate((bb.x0 + bb.x1) / 2, y, (bb.z0 + bb.z1) / 2);
        const m = new THREE.Mesh(g, lam({ map: tex })); m.matrixAutoUpdate = false; root.add(m);
        continue;
      }
      if (rm.kind === 'gym') { addFloor(rm.name.startsWith('Wrest') ? (MAT.mat || (MAT.mat = lam({ color: 0x1d3f88 }))) : (MAT.rubber || (MAT.rubber = lam({ color: 0x2b2d31 }))), flatGeo(rm.poly, [], y, true, [1, 1])); continue; }
      const k = roomFloor[rm.kind] || 'vct';
      addFloor(MAT[k], flatGeo(rm.poly, [], y, true, M[k] || [3, 3]));
    }
    for (const [mat, list] of floorGeos) { const m = new THREE.Mesh(mergeGeometries(list), mat); m.matrixAutoUpdate = false; root.add(m); }
    // courtyards: lawn
    for (const ct of map.courts) flat(ct.poly, [], 0.03, true, MAT.grass, M.grass);
    // floor decals: crimson + grey panels in the Nobel Commons, a navy runner down the main hallway
    {
      const nob = map.labels.find(l => l.name === 'Nobel Commons').p;
      for (let i = -2; i <= 2; i++) B.solid.box(nob[0] + i * 3.6, nob[1] + 1.0, 1.2, 2.6, 0, 0.026, 0.03, i % 2 ? rgb('#8f2a33') : rgb('#7b7f86'));
    }

    // --- sealed slivers (map.fills): solid block faces where they meet open space
    for (const fl of map.fills) {
      const yb = base(fl.floor), P = fl.poly;
      for (let i = 0; i < P.length; i++) {
        const a = P[i], b = P[(i + 1) % P.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 0.02) continue;
        const n = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len], m = lerp2(a, b, 0.5);
        const c = map.cell(fl.floor, m[0] + n[0] * 0.25, m[1] + n[1] * 0.25);
        if (c !== 'hall' && c !== 'stair' && c !== 'court') continue;
        const A = a.slice(); A.u0 = 0;
        wall(A, b, yb, yb + CEIL, n, -0.01, 0, B.hall, null, yb, CEIL);
      }
    }

    // --- stairs
    for (const st of map.stairs) this.buildStair(st, B, C);
    // --- the Dome
    this.buildDome(root, B, C);

    // --- hanging neighbourhood banners
    const banners = makeLabelAtlas(map.labels.map(l => l.name), { cellW: 512, cellH: 128, cols: 4, style: 'banner' });
    const banB = new Batch();
    for (const l of map.labels) {
      const yb = base(l.floor), uv = banners.uv.get(l.name), [x, z] = l.p;
      // orient along the hallway: try both axes, pick the one with more room
      const room = ang => { let s = 0; for (const k of [-3, -1.5, 1.5, 3]) if (map.cell(l.floor, x + Math.cos(ang) * k, z + Math.sin(ang) * k) === 'hall') s++; return s; };
      const ang = room(0) >= room(Math.PI / 2) ? Math.PI / 2 : 0;               // banner faces along the hall
      const dx = Math.cos(ang + Math.PI / 2), dz = Math.sin(ang + Math.PI / 2), hw = 1.3, y0 = yb + 2.75, y1 = yb + 3.4;
      const A = [x - dx * hw, z - dz * hw], Bq = [x + dx * hw, z + dz * hw], nn = [Math.cos(ang), Math.sin(ang)];
      for (const s of [1, -1]) {
        const off = [nn[0] * 0.02 * s, nn[1] * 0.02 * s];
        const p0 = s > 0 ? Bq : A, p1 = s > 0 ? A : Bq;
        banB.quad([[p0[0] + off[0], y0, p0[1] + off[1]], [p1[0] + off[0], y0, p1[1] + off[1]], [p1[0] + off[0], y1, p1[1] + off[1]], [p0[0] + off[0], y1, p0[1] + off[1]]],
          [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]], [nn[0] * s, 0, nn[1] * s]);
      }
      for (const p of [A, Bq]) B.solid.box(p[0], p[1], 0.01, 0.01, 0, y1, yb + CEIL, C.frame);
    }
    root.add(banB.mesh(new THREE.MeshLambertMaterial({ map: banners.tex, side: THREE.FrontSide })));

    // --- furniture
    this.P = prototypes(T);
    this.boardB = new Batch();
    this.boards = [];              // every whiteboard, so players can write over it (main.js)
    for (const rm of map.rooms) this.furnish(rm);
    root.add(this.boardB.mesh(new THREE.MeshLambertMaterial({ map: T.whiteboard })));
    this.hallways();
    this.courtyards();
    this.outside(root, B, C);
    for (const [name, P] of Object.entries(this.P)) {
      if (!P.list.length) continue;
      const im = new THREE.InstancedMesh(P.geo, P.mat, P.list.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), Yax = new THREE.Vector3(0, 1, 0);
      P.list.forEach((it, i) => {
        q.setFromAxisAngle(Yax, it.rot); s.set(it.sx || 1, it.sy || 1, it.sz || 1);
        im.setMatrixAt(i, m4.compose(new THREE.Vector3(it.x, it.y, it.z), q, s));
        if (it.color) im.setColorAt(i, col(it.color));
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.name = name;
      root.add(im);
    }

    for (const [k, b] of Object.entries(B)) { const m = b.mesh(MAT[k]); if (m) root.add(m); }
    scene.add(root);
    return { surfaces: this.surfaces, boards: this.boards };
  }

  /** Place one furniture instance; registers its collider and hiding surface. */
  put(name, x, y, z, rot, opts = {}) {
    const P = this.P[name];
    P.list.push({ x, y, z, rot, ...opts });
    const fp = P.fp;
    if (!fp) return;
    const sx = opts.sx || 1, sz = opts.sz || 1, sy = opts.sy || 1;
    const c = Math.cos(rot), s = Math.sin(rot), oz = (fp.oz || 0) * sz;
    const cx = x + oz * s, cz = z + oz * c, hx = fp.hx * sx, hz = fp.hz * sz, h = fp.h * sy;
    if (fp.solid) {
      const pt = (lx, lz) => [cx + lx * c + lz * s, cz - lx * s + lz * c];
      const k = [pt(-hx, -hz), pt(hx, -hz), pt(hx, hz), pt(-hx, hz)];
      for (let i = 0; i < 4; i++) this.map.walls.push({ a: k[i], b: k[(i + 1) % 4], y0: y, y1: y + h, kind: 'furn' });
    }
    if (fp.top !== undefined || fp.solid) this.surfaces.push({ x: cx, z: cz, rot, hx, hz, y0: fp.solid ? y : y + h - 0.05, y1: y + h, name });
  }

  // ---------------------------------------------------------------- rooms
  furnish(rm) {
    const map = this.map, yb = rm.floor === 2 ? map.F2Y : 0;
    const bb = map.bbox(rm.poly), cx = (bb.x0 + bb.x1) / 2, cz = (bb.z0 + bb.z1) / 2;
    const doorPts = rm.edges.flatMap(e => e.gaps.map(g => [g.door.x, g.door.z]));   // own doors and neighbours' doors into this room
    const inside = (x, z, m = 0.6) => map.pointInPoly(x, z, rm.poly) && [[m, 0], [-m, 0], [0, m], [0, -m]].every(([a, b]) => map.pointInPoly(x + a, z + b, rm.poly));
    const clear = (x, z, r = 1.6) => doorPts.every(([a, b]) => Math.hypot(a - x, b - z) > r);
    const ok = (x, z, m, r) => inside(x, z, m) && clear(x, z, r);
    // the "front": the longest inside wall without a door (whiteboard there), students face it
    let front = null;
    rm.edges.forEach((e, i) => {
      if (e.side === 'ext' || e.side === 'court') return;
      const hasDoor = rm.doors.some(d => d.edge === i);
      const score = e.len - (hasDoor ? 100 : 0);
      if (!front || score > front.score) front = { e, score };
    });
    if (!front) front = { e: rm.edges.reduce((a, b) => (b.len > a.len ? b : a)) };
    const fe = front.e, fn = [fe.nx, fe.nz], fd = [(fe.b[0] - fe.a[0]) / fe.len, (fe.b[1] - fe.a[1]) / fe.len];
    const faceRot = Math.atan2(fn[0], fn[1]);                                 // +z of a prototype points at the front wall
    const fmid = [(fe.a[0] + fe.b[0]) / 2, (fe.a[1] + fe.b[1]) / 2];
    // local grid: along the front wall (s), and depth into the room (t)
    const at = (s, t) => [fmid[0] + fd[0] * s - fn[0] * t, fmid[1] + fd[1] * s - fn[1] * t];
    const depth = (() => { let t = 1; while (t < 60 && inside(...at(0, t), 0.1)) t += 0.5; return t; })();
    const halfW = fe.len / 2;
    const size = name => { const fp = this.P[name].fp; return fp ? Math.max(fp.hx, fp.hz) : 0.4; };
    const grid = (name, ds, dt, t0, margin, r, opts) => {
      let n = 0;
      r += size(name) * 0.8;
      for (let t = t0; t < depth - margin; t += dt) for (let s = -halfW + margin; s <= halfW - margin + 0.01; s += ds) {
        const [x, z] = at(s, t);
        if (ok(x, z, 0.55, r)) { this.put(name, x, yb, z, faceRot, opts); n++; }
      }
      return n;
    };
    const whiteboard = () => {
      if (fe.len < 3) return;
      const w = Math.min(4.8, fe.len - 1.4), p = [fmid[0] - fn[0] * 0.135, fmid[1] - fn[1] * 0.135];
      const A = [p[0] - fd[0] * w / 2, p[1] - fd[1] * w / 2], Bq = [p[0] + fd[0] * w / 2, p[1] + fd[1] * w / 2], y0 = yb + 1.03, y1 = yb + 2.28;
      const [u0, v0, u1, v1] = this.T.boardUV((rnd() * 16) | 0);
      this.boardB.quad([[A[0], y0, A[1]], [Bq[0], y0, Bq[1]], [Bq[0], y1, Bq[1]], [A[0], y1, A[1]]], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], [-fn[0], 0, -fn[1]]);
      this.boards.push({ key: `${rm.floor}:${rm.name}`, room: rm.name, floor: rm.floor, x: p[0], z: p[1], y0, y1, w, d: fd, n: [-fn[0], -fn[1]] });
    };
    const alongWalls = (name, step, off, skipDoor = 1.6, kinds = ['room', 'hall', 'stair', 'void'], max = 99) => {
      let n = 0;
      skipDoor += size(name) * 0.8;
      for (const e of rm.edges) {
        if (e === fe || !kinds.includes(e.side) || e.len < 2) continue;
        const d = [(e.b[0] - e.a[0]) / e.len, (e.b[1] - e.a[1]) / e.len];
        for (let s = 0.8; s < e.len - 0.8 && n < max; s += step) {
          const x = e.a[0] + d[0] * s - e.nx * off, z = e.a[1] + d[1] * s - e.nz * off;
          if (ok(x, z, 0.2, skipDoor)) { this.put(name, x, yb, z, Math.atan2(-e.nx, -e.nz)); n++; }
        }
      }
      return n;
    };

    switch (rm.kind) {
      case 'class': case 'lecture':
        whiteboard();
        if (rm.kind === 'lecture') { this.putP('podium', at(halfW * 0.5, 1.3), yb, faceRot + Math.PI); grid('desk', 1.0, 1.25, 2.6, 0.8, 1.4); break; }
        if (ok(...at(-halfW + 1.6, 1.3), 0.3, 1.2)) this.putP('teacher', at(-halfW + 1.6, 1.3), yb, faceRot + Math.PI);
        if (window.TJChess && rm.floor === TJChess.ROOM.floor && rm.name === TJChess.ROOM.name) {
          // the chess club: three tables (shared/ChessClub.js), a student bot sits on the chair behind each one
          for (const t of TJChess.spots(map)) { this.put('chesstable', t.x, yb, t.z, 0); this.put('chair', t.npc.x, yb, t.npc.z - 0.04, 0); }
          alongWalls('cabinet', 6, 0.42, 1.6, ['room'], 2);
          break;
        }
        grid('desk', 1.25, 1.45, 2.8, 0.9, 1.4);
        alongWalls('cabinet', 6, 0.42, 1.6, ['room'], 2);
        break;
      case 'lab':
        whiteboard();
        if (/D&T|Robot|Proto|Elec|Energy/.test(rm.name)) { grid('steel', 2.6, 2.3, 2.2, 1.6, 1.6); alongWalls('machine', 5, 0.75, 1.8, ['room', 'hall'], 2); }
        else { grid('bench', 3.0, 2.4, 2.4, 1.8, 1.6); alongWalls('counter', 2.6, 0.4, 1.6, ['room', 'hall', 'ext', 'court']); }
        this.scatterStools(rm, yb);
        break;
      case 'cs': whiteboard(); grid('computer', 1.9, 1.9, 2.0, 1.2, 1.5); break;
      case 'office':
        if (ok(cx, cz, 0.9, 1.4)) this.put('teacher', cx, yb, cz, faceRot);
        alongWalls('cabinet', 3.5, 0.33, 1.4, ['room', 'hall', 'ext', 'court'], 3);
        alongWalls('shelf', 4.5, 0.25, 1.4, ['room'], 2);
        break;
      case 'music':
        whiteboard();
        if (/Band|Orchestra|135/.test(rm.name)) {
          if (ok(...at(halfW - 2, 1.6), 0.8, 1.2)) this.putP('piano', at(halfW - 2, 1.6), yb, faceRot + Math.PI);
          for (let r = 0; r < 4; r++) for (let k = -5; k <= 5; k++) {
            const ang = k * 0.17, rad = 3.6 + r * 1.3, p = at(Math.sin(ang) * rad, 1.2 + Math.cos(ang) * rad * 0.8);
            if (ok(p[0], p[1], 0.4, 1.3)) { this.put('chair', p[0], yb, p[1], faceRot + Math.PI - ang); if (r % 2 === 0) this.put('stand', p[0] + fn[0] * 0.6, yb, p[1] + fn[1] * 0.6, faceRot + Math.PI); }
          }
        } else if (ok(cx, cz, 0.8, 1.2)) this.put('piano', cx, yb, cz, faceRot);
        break;
      case 'library': {
        // two rows of stacks with a reading area, a circulation desk near the doors
        const n = grid('shelf2', 1.0, 2.4, 3.0, 2.2, 2.2);
        void n;
        this.putP('teacher', at(0, depth - 2.0), yb, faceRot);
        break;
      }
      case 'cafe':
        grid('cafe', 3.6, 2.2, 2.6, 1.6, 2.0);
        alongWalls('vending', 1.2, 0.5, 2.0, ['room', 'hall'], 4);
        break;
      case 'gym':
        if (/Gym/.test(rm.name)) {
          const long = bb.x1 - bb.x0 > bb.z1 - bb.z0;
          // the hoops come from shared/Hoops.js (the shooting game and the server use the same positions); each rim sits
          // over the painted basket, 2.8 m from the end wall
          for (const h of TJHoops.hoops(map)) if (h.room === rm.name) this.put('hoop', h.x, yb, h.z, h.rot);
          // bleachers along a long wall - the one with fewer doors, never in front of a door
          const sides = long ? [[cx, bb.z1 - 2.1, Math.PI, 0, 1], [cx, bb.z0 + 2.1, 0, 0, -1]] : [[bb.x1 - 2.1, cz, -Math.PI / 2, 1, 0], [bb.x0 + 2.1, cz, Math.PI / 2, -1, 0]];
          const doorsOn = sd => rm.doors.filter(d => d.nx * sd[3] + d.nz * sd[4] > 0.7);
          const side = sides.sort((p, q) => doorsOn(p).length - doorsOn(q).length)[0], near = doorsOn(side);
          for (let k = -1; k <= 1; k++) {
            const x = long ? side[0] + k * 8.4 : side[0], z = long ? side[1] : side[1] + k * 8.4;
            const blocks = near.some(d => (long ? Math.abs(d.x - x) : Math.abs(d.z - z)) < 4.2 + d.w / 2 + 0.6);
            if (inside(x, z, 0.5) && !blocks) this.put('bleacher', x, yb, z, side[2]);
          }
        } else if (/Wrest/.test(rm.name)) { grid('mat', 1.1, 2.1, 1.2, 1.0, 1.4); }
        else { grid('rack', 2.4, 2.2, 1.6, 1.2, 1.6); }
        break;
      case 'aud': {
        // stage across the north end, seats facing it
        const stageD = (bb.z1 - bb.z0) * 0.3;
        const B2 = new Batch(); B2.box(cx, bb.z0 + stageD / 2, (bb.x1 - bb.x0) / 2 - 0.2, stageD / 2, 0, yb, yb + 1.0, rgb('#3a2a20'));
        B2.box(cx, bb.z0 + 0.4, (bb.x1 - bb.x0) / 2 - 0.2, 0.15, 0, yb + 1, yb + 4.1, rgb('#8c1426'));
        this.root.add(B2.mesh(this.MAT.solid));
        const pts = [[cx - (bb.x1 - bb.x0) / 2 + 0.2, bb.z0 + stageD], [cx + (bb.x1 - bb.x0) / 2 - 0.2, bb.z0 + stageD]];
        this.map.walls.push({ a: pts[0], b: pts[1], y0: yb, y1: yb + 1, kind: 'furn' });
        this.surfaces.push({ x: cx, z: bb.z0 + stageD / 2, rot: 0, hx: (bb.x1 - bb.x0) / 2 - 0.3, hz: stageD / 2 - 0.3, y0: yb, y1: yb + 1, name: 'stage' });
        for (let z = bb.z0 + stageD + 2.5; z < bb.z1 - 1.5; z += 1.05) for (const x of [cx - 7.2, cx - 3.1, cx + 3.1, cx + 7.2]) {
          if (inside(x, z, 0.4) && clear(x, z, 2)) this.put('seats', x, yb, z, Math.PI);
        }
        break;
      }
      case 'plan': {
        const r = 4.5;
        for (let ring = 0; ring < 2; ring++) for (let k = 0; k < 14; k++) {
          const a = k / 14 * Math.PI * 2, x = cx + Math.cos(a) * (r - ring * 1.6), z = cz + Math.sin(a) * (r - ring * 1.6);
          if (ok(x, z, 0.3, 1.5)) this.put('chair', x, yb, z, Math.atan2(cx - x, cz - z) + Math.PI);
        }
        const sky = document.createElement('canvas'); sky.width = 1024; sky.height = 256;
        const sg = sky.getContext('2d'); sg.fillStyle = '#0b1026'; sg.fillRect(0, 0, 1024, 256);
        for (let i = 0; i < 900; i++) { const b = rnd(); sg.fillStyle = `rgba(255,${240 + b * 15},${200 + b * 55},${0.4 + b * 0.6})`; sg.fillRect(rnd() * 1024, rnd() * 256, b > 0.95 ? 2.5 : 1.3, b > 0.95 ? 2.5 : 1.3); }
        const st = new THREE.CanvasTexture(sky); st.colorSpace = THREE.SRGBColorSpace;
        const dome = new THREE.Mesh(new THREE.SphereGeometry(6, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2),
          new THREE.MeshBasicMaterial({ map: st, side: THREE.BackSide }));
        dome.position.set(cx, yb + 0.6, cz); dome.scale.y = 0.55; dome.updateMatrix(); dome.matrixAutoUpdate = false; this.root.add(dome);
        const proj = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), new THREE.MeshLambertMaterial({ color: 0x222222 }));
        proj.position.set(cx, yb + 1.0, cz); proj.updateMatrix(); proj.matrixAutoUpdate = false; this.root.add(proj);
        break;
      }
      case 'art': grid('table', 2.6, 2.2, 2.0, 1.4, 1.6); alongWalls('easel', 1.6, 0.6, 1.4, ['room', 'hall'], 6); break;
      case 'locker': grid('locker', 0.9, 2.6, 1.2, 0.8, 1.6); break;
      case 'rest': {
        let n = 0;
        for (const e of rm.edges) {
          if (n > 0 || e.len < 3 || e.side === 'hall') continue;
          const d = [(e.b[0] - e.a[0]) / e.len, (e.b[1] - e.a[1]) / e.len];
          for (let s = 0.7; s < e.len - 0.6; s += 0.95) { const x = e.a[0] + d[0] * s - e.nx * 0.8, z = e.a[1] + d[1] * s - e.nz * 0.8; if (ok(x, z, 0.2, 1.3)) { this.put('stall', x, yb, z, Math.atan2(-e.nx, -e.nz)); n++; } }
        }
        alongWalls('sink', 3, 0.3, 1.5, ['hall', 'room'], 1);
        break;
      }
      case 'store': case 'mech': alongWalls(rm.kind === 'mech' ? 'machine' : 'shelf', rm.kind === 'mech' ? 2.4 : 1.2, rm.kind === 'mech' ? 0.7 : 0.25, 1.4, ['room', 'hall', 'ext', 'court']);
        if (ok(cx, cz, 0.5, 1.4)) this.put('box', cx, yb, cz, rnd() * 3);
        break;
      case 'kitchen': alongWalls('steel', 2.1, 0.4, 1.4, ['room', 'hall', 'ext', 'court']); break;
      case 'lounge': {
        if (ok(cx, cz, 1.2, 1.4)) { this.put('couch', cx, yb, cz - 1.0, 0); this.put('cube', cx, yb, cz + 0.4, 0); }
        alongWalls('shelf', 3, 0.25, 1.4, ['room'], 2);
        break;
      }
      case 'blackbox': grid('chair', 0.7, 1.0, 4.5, 1.0, 1.4); break;
    }
  }
  putP(name, p, y, rot, opts) { this.put(name, p[0], y, p[1], rot, opts); }

  scatterStools(rm, yb) {
    const P = this.P.bench.list.slice(-40);
    for (const b of P) {
      if (Math.abs(b.y - yb) > 0.1) continue;
      const c = Math.cos(b.rot), s = Math.sin(b.rot);
      for (const k of [-0.7, 0, 0.7]) {
        const lx = k, lz = -0.85;
        const x = b.x + lx * c + lz * s, z = b.z - lx * s + lz * c;
        if (this.map.pointInPoly(x, z, rm.poly)) this.put('stool', x, yb, z, b.rot);
      }
    }
  }

  // ---------------------------------------------------------------- hallways: lockers, bins, couches, vending
  hallways() {
    const map = this.map;
    for (const rm of map.rooms) {
      if (!['class', 'lab', 'cs', 'lecture'].includes(rm.kind)) continue;
      const yb = rm.floor === 2 ? map.F2Y : 0;
      rm.edges.forEach((e, i) => {
        if (e.side !== 'hall' || e.len < 2.6) return;
        const d = [(e.b[0] - e.a[0]) / e.len, (e.b[1] - e.a[1]) / e.len];
        const blocked = rm.doors.filter(dd => dd.edge === i).map(dd => [dd.t * e.len - dd.w / 2 - 0.5, dd.t * e.len + dd.w / 2 + 0.5]);
        let run = null;
        const flush = () => {
          if (run && run.n) {
            const a = [e.a[0] + d[0] * run.s0 + e.nx * 0.47, e.a[1] + d[1] * run.s0 + e.nz * 0.47];
            const b = [e.a[0] + d[0] * run.s1 + e.nx * 0.47, e.a[1] + d[1] * run.s1 + e.nz * 0.47];
            map.walls.push({ a, b, y0: yb, y1: yb + 1.85, kind: 'furn' });
          }
          run = null;
        };
        for (let s = 0.5; s + 0.9 <= e.len - 0.4; s += 0.9) {
          const mid = s + 0.45;
          const x = e.a[0] + d[0] * mid + e.nx * 0.24, z = e.a[1] + d[1] * mid + e.nz * 0.24;
          const free = !blocked.some(([p, q]) => mid + 0.45 > p && mid - 0.45 < q)
            && !(rm.floor === 1 && map.courts.some(c => c.doors.some(d => Math.hypot(d[0] - x, d[1] - z) < 2.2)))
            && map.cell(rm.floor, x + e.nx * 2.3, z + e.nz * 2.3) === 'hall' && map.cell(rm.floor, x + e.nx * 1.0, z + e.nz * 1.0) === 'hall'
            && !map.stairs.some(st => { const [u, v] = map.toLocal(st, x + e.nx * 1.2, z + e.nz * 1.2); return u > -2.5 && u < st.l + 0.5 && v > -0.5 && v < st.w + 0.5; });
          if (!free) { flush(); continue; }
          this.put('locker', x, yb, z, Math.atan2(e.nx, e.nz));
          // lockers collide as one long run (pushed below), so drop the per-unit collider just added
          map.walls.length -= 4;
          if (!run) run = { s0: s, s1: s + 0.9, n: 0 };
          run.s1 = s + 0.9; run.n++;
        }
        flush();
        // a blue recycling bin by some doors
        for (const dd of rm.doors.filter(q => q.edge === i)) if (rnd() < 0.35) {
          const s = dd.t * e.len + dd.w / 2 + 0.35;
          if (s < e.len - 0.3) { const x = e.a[0] + d[0] * s + e.nx * 0.3, z = e.a[1] + d[1] * s + e.nz * 0.3; if (map.cell(rm.floor, x, z) === 'hall') this.put('bin', x, yb, z, 0); }
        }
      });
    }
    // lounge furniture and vending machines at the named commons
    const doorNear = (f, x, z, r) => map.rooms.some(rm => rm.floor === f && rm.doors.some(d => Math.hypot(d.x - x, d.z - z) < r))
      || (f === 1 && map.courts.some(c => c.doors.some(d => Math.hypot(d[0] - x, d[1] - z) < r + 0.5)))
      || map.stairs.some(st => { const [u, v] = map.toLocal(st, x, z); return u > -3 && u < st.l + 1 && v > -1 && v < st.w + 1; });
    const spots = { 'Nobel Commons': [[-4, 2.5], [4, 2.5], [-4, -1.5]], 'Franklin': [[-3, -1], [3, -1]], 'Tesla': [[0, -4]], 'Hopper': [[-3, 0]], 'Curie': [[2, 0]],
      'Cafe Commons': [[-3, 0]], 'Einstein': [[0, -3]] };
    for (const l of map.labels) {
      const s = spots[l.name]; if (!s) continue;
      const yb = l.floor === 2 ? map.F2Y : 0;
      for (const [ox, oz] of s) {
        const x = l.p[0] + ox, z = l.p[1] + oz;
        if (map.cell(l.floor, x, z) === 'hall' && map.cell(l.floor, x + 1.1, z) === 'hall' && map.cell(l.floor, x - 1.1, z) === 'hall' && !doorNear(l.floor, x, z, 2.6)) this.put('couch', x, yb, z, oz > 0 ? Math.PI : 0);
      }
    }
    const vend = [['Nobel Commons', 7, -2.5], ['Cafe Commons', 4, 1.5], ['Tesla', -2.5, 3], ['Galileo', 0, 0.5], ['Hopper', 4, 0]];
    for (const [name, ox, oz] of vend) {
      const l = map.labels.find(q => q.name === name); if (!l) continue;
      const x0 = l.p[0] + ox, z0 = l.p[1] + oz, yb = l.floor === 2 ? map.F2Y : 0;
      // walk toward the closest wall (of 4 directions) and put a pair of machines with their backs to it
      let best = null;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        for (let d = 0.5; d < 8; d += 0.25) {
          if (map.cell(l.floor, x0 + dx * d, z0 + dz * d) !== 'hall') { if (!best || d < best.d) best = { d, dx, dz }; break; }
        }
      }
      if (!best) continue;
      const x = x0 + best.dx * (best.d - 0.45), z = z0 + best.dz * (best.d - 0.45), rot = Math.atan2(-best.dx, -best.dz);
      const sx = -best.dz, sz = best.dx;                    // along the wall
      if (doorNear(l.floor, x, z, 2.8) || map.cell(l.floor, x + sx * 1.2, z + sz * 1.2) !== 'hall' || map.cell(l.floor, x - sx * 1.2, z - sz * 1.2) !== 'hall') continue;
      this.put('vending', x - sx * 0.55, yb, z - sz * 0.55, rot); this.put('vending', x + sx * 0.55, yb, z + sz * 0.55, rot);
    }
  }

  courtyards() {
    const map = this.map;
    for (const ct of map.courts) {
      const bb = map.bbox(ct.poly);
      for (let i = 0; i < 26; i++) {
        const x = bb.x0 + rnd() * (bb.x1 - bb.x0), z = bb.z0 + rnd() * (bb.z1 - bb.z0);
        if (map.cell(1, x, z) !== 'court') continue;
        if ([[2, 0], [-2, 0], [0, 2], [0, -2]].some(([a, b]) => map.cell(1, x + a, z + b) !== 'court')) continue;
        if (i % 3 === 0) this.put('tree', x, 0.03, z, rnd() * 6, { sx: 0.8 + rnd() * 0.5, sy: 0.8 + rnd() * 0.5, sz: 0.8 + rnd() * 0.5 });
        else this.put('benchOut', x, 0.03, z, rnd() * 6);
      }
    }
    // main courtyard: amphitheatre steps at the north end and the round plaza with benches (as on the plan)
    const c1 = map.courts[0], bb = map.bbox(c1.poly);
    const B2 = new Batch();
    const ax = (bb.x0 + bb.x1) / 2 + 2, az = bb.z0 + 2;
    for (let k = 0; k < 3; k++) {
      const r0 = 4 + k * 1.6;
      for (let s = 0; s < 14; s++) {
        const a0 = Math.PI * 0.12 + s / 14 * Math.PI * 0.76, a1 = Math.PI * 0.12 + (s + 1) / 14 * Math.PI * 0.76;
        const p = ang => [ax + Math.cos(ang) * r0, az + Math.sin(ang) * r0 * 0.9];
        const q = ang => [ax + Math.cos(ang) * (r0 + 1.6), az + Math.sin(ang) * (r0 + 1.6) * 0.9];
        const y = 0.03 + 0.42 * (3 - k);
        const A = p(a0), Bp = p(a1), Cq = q(a1), D = q(a0);
        B2.quad([[A[0], y, A[1]], [Bp[0], y, Bp[1]], [Cq[0], y, Cq[1]], [D[0], y, D[1]]], null, [0, 1, 0], rgb('#bdb7aa'));
        B2.quad([[A[0], 0, A[1]], [Bp[0], 0, Bp[1]], [Bp[0], y, Bp[1]], [A[0], y, A[1]]], null, [-(A[0] + Bp[0]) / 2 + ax, 0, -(A[1] + Bp[1]) / 2 + az], rgb('#a8a294'));
      }
    }
    const plaza = [(bb.x0 + bb.x1) / 2 + 0.5, (bb.z0 + bb.z1) / 2 + 3];
    const disc = new THREE.Mesh(new THREE.CircleGeometry(6.2, 40).rotateX(-Math.PI / 2).translate(plaza[0], 0.04, plaza[1]), this.MAT.pavers);
    disc.matrixAutoUpdate = false; this.root.add(disc);
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; this.put('benchOut', plaza[0] + Math.cos(a) * 5.2, 0.04, plaza[1] + Math.sin(a) * 5.2, -a + Math.PI / 2); }
    // east courtyard: the greenhouse pavilion
    const c2 = map.courts[1], b2 = map.bbox(c2.poly);
    const gx = b2.x0 + (b2.x1 - b2.x0) * 0.62, gz = b2.z0 + (b2.z1 - b2.z0) * 0.55;
    B2.box(gx, gz, 4.2, 6.5, 0, 0.03, 0.5, rgb('#7a7a76'));
    this.root.add(B2.mesh(this.MAT.solid));
    const gh = new THREE.Mesh(new THREE.BoxGeometry(8.2, 3.0, 12.8), this.MAT.glass); gh.position.set(gx, 2.0, gz); gh.updateMatrix(); gh.matrixAutoUpdate = false; this.root.add(gh);
    const pts = [[gx - 4.2, gz - 6.5], [gx + 4.2, gz - 6.5], [gx + 4.2, gz + 6.5], [gx - 4.2, gz + 6.5]];
    for (let i = 0; i < 4; i++) map.walls.push({ a: pts[i], b: pts[(i + 1) % 4], y0: 0, y1: 3.5, kind: 'furn' });
    this.surfaces.push({ x: gx, z: gz, rot: 0, hx: 4.1, hz: 6.4, y0: 0, y1: 0.5, name: 'planter' });
    for (let k = -2; k <= 2; k++) this.put('box', gx - 2.5, 0.5, gz + k * 2.2, 0, { color: '#6b8f4e' });
  }

  // ---------------------------------------------------------------- stairs
  buildStair(st, B, C) {
    const map = this.map, F2Y = map.F2Y, ROOF = map.ROOF;
    const L = (u, v) => map.toWorld(st, u, v);
    const rot = Math.atan2(st.r[0], st.r[1]);                                 // local x (v) along r
    const boxUV = (u0, u1, v0, v1, y0, y1, color) => {
      const c = L((u0 + u1) / 2, (v0 + v1) / 2);
      B.solid.box(c[0], c[1], (u1 - u0) / 2, (v1 - v0) / 2, rot, y0, y1, color);   // box: hx along f (u), hz along r (v)
    };
    const wallUV = (u0, v0, u1, v1, y0, y1, inner) => {
      const a = L(u0, v0), b = L(u1, v1), len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.05) return;
      const n = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
      // which side faces into the stairwell? test the centre
      const c = L(st.l / 2, st.w / 2), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const into = (c[0] - m[0]) * n[0] + (c[1] - m[1]) * n[1] > 0;
      const nn = into ? [-n[0], -n[1]] : n;
      const vb = y0 >= F2Y - 0.01 ? F2Y : 0;
      const wall = (A, Bq) => {
        const P = (p, t, y) => [p[0] + nn[0] * t, y, p[1] + nn[1] * t];
        const vv = y => (y - vb) / map.CEIL;
        // painted drywall on both faces (stairwells are not block)
        B.plain.quad([P(A, -0.1, y0), P(Bq, -0.1, y0), P(Bq, -0.1, y1), P(A, -0.1, y1)], [[0, vv(y0)], [len / 4, vv(y0)], [len / 4, vv(y1)], [0, vv(y1)]], [-nn[0], 0, -nn[1]]);
        B.plain.quad([P(Bq, 0.02, y0), P(A, 0.02, y0), P(A, 0.02, y1), P(Bq, 0.02, y1)], [[len / 4, vv(y0)], [0, vv(y0)], [0, vv(y1)], [len / 4, vv(y1)]], [nn[0], 0, nn[1]]);
        void inner;
      };
      wall(a, b);
    };
    if (st.type === 'straight') {
      const n = 26, run = st.l / n, rise = F2Y / n;
      for (let k = 0; k < n; k++) {
        boxUV(k * run, (k + 1) * run, 0, st.w, 0, (k + 1) * rise, C.step);                // flush, so the sides never z-fight
        boxUV(k * run, k * run + 0.05, 0, st.w, (k + 1) * rise - 0.02, (k + 1) * rise + 0.005, C.nose);
      }
      for (const v of [0.02, st.w - 0.02]) {
        for (let k = 0; k <= 8; k++) { const u = k / 8 * st.l; const p = L(u, v); B.solid.box(p[0], p[1], 0.025, 0.025, rot, F2Y * (u / st.l), F2Y * (u / st.l) + 1.0, C.rail); }
        const a = L(0, v), b = L(st.l, v);
        B.glass.quad([[a[0], 0.1, a[1]], [b[0], F2Y + 0.1, b[1]], [b[0], F2Y + 1.0, b[1]], [a[0], 1.0, a[1]]], null, [st.r[0], 0, st.r[1]]);
        B.solid.quad([[a[0], 1.0, a[1]], [b[0], F2Y + 1.0, b[1]], [b[0], F2Y + 1.06, b[1]], [a[0], 1.06, a[1]]], null, [st.r[0], 0, st.r[1]], C.rail);
      }
      // upstairs the hole is open on three sides (only the top end, u = l, is the way off): a level glass balustrade along
      // both long sides and across the bottom end, like the atrium's. The long ones sit 4 cm outside the stair's own sloped
      // glass so the two never z-fight; the slab edge (floor-1 ceiling up to floor 2) closes the gap between them.
      const balustrade = (a, b) => {
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]), r2 = Math.atan2(b[0] - a[0], b[1] - a[1]);
        B.glass.quad([[a[0], F2Y, a[1]], [b[0], F2Y, b[1]], [b[0], F2Y + 1.05, b[1]], [a[0], F2Y + 1.05, a[1]]], null, [st.f[0], 0, st.f[1]]);
        B.solid.box((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.04, len / 2, r2, F2Y + 1.05, F2Y + 1.1, C.rail);
        const nm = Math.max(1, Math.round(len / 1.4));
        for (let k = 0; k <= nm; k++) { const t = k / nm, p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; B.solid.box(p[0], p[1], 0.025, 0.025, r2, F2Y, F2Y + 1.05, C.rail); }
      };
      const g = 0.04;
      balustrade(L(-g, -g), L(st.l, -g));
      balustrade(L(-g, st.w + g), L(st.l, st.w + g));
      balustrade(L(-g, -g), L(-g, st.w + g));
      const edge = (u0, v0, u1, v1, n) => { const a = L(u0, v0), b = L(u1, v1); B.solid.quad([[a[0], map.CEIL, a[1]], [b[0], map.CEIL, b[1]], [b[0], F2Y, b[1]], [a[0], F2Y, a[1]]], null, n, C.white); };
      edge(0, 0, st.l, 0, [st.r[0], 0, st.r[1]]);
      edge(st.l, st.w, 0, st.w, [-st.r[0], 0, -st.r[1]]);
      edge(0, st.w, 0, 0, [st.f[0], 0, st.f[1]]);
      return;
    }
    // two flights side by side with an open well between them, a landing at the far end
    const half = st.w / 2, runL = st.l - st.landing, n = 14, run = runL / n, rise = (F2Y / 2) / n, well = 0.2;
    const lowV = st.up === 'L' ? [0.1, half - well] : [half + well, st.w - 0.1], hiV = st.up === 'L' ? [half + well, st.w - 0.1] : [0.1, half - well];
    const lowY = u => (F2Y / 2) * (u / runL), hiY = u => F2Y / 2 + (F2Y / 2) * (1 - u / runL);
    const P3 = (u, v, y) => { const p = L(u, v); return [p[0], y, p[1]]; };
    const tube = (a, b, r, color) => {
      const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
      const s1 = new THREE.Vector3().crossVectors(d, Math.abs(d.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(r);
      const s2 = new THREE.Vector3().crossVectors(s1, d).normalize().multiplyScalar(r);
      const c = (p, i, j) => [p[0] + s1.x * i + s2.x * j, p[1] + s1.y * i + s2.y * j, p[2] + s1.z * i + s2.z * j];
      const k = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
      for (let q = 0; q < 4; q++) { const [i0, j0] = k[q], [i1, j1] = k[(q + 1) % 4]; B.solid.quad([c(a, i0, j0), c(b, i0, j0), c(b, i1, j1), c(a, i1, j1)], null, [s1.x * (i0 + i1) + s2.x * (j0 + j1), s1.y * (i0 + i1) + s2.y * (j0 + j1), s1.z * (i0 + i1) + s2.z * (j0 + j1)], color); }
    };
    for (let k = 0; k < n; k++) {
      const y = (k + 1) * rise;
      boxUV(k * run, (k + 1) * run, lowV[0], lowV[1], 0, y, C.step);
      boxUV(k * run, k * run + 0.04, lowV[0], lowV[1], y - 0.015, y + 0.006, C.nose);
      // the upper flight climbs back toward the entry face; each step reaches down to the sloped underside
      const u0 = runL - (k + 1) * run, yy = F2Y / 2 + (k + 1) * rise;
      boxUV(u0, u0 + run, hiV[0], hiV[1], hiY(u0 + run) - 0.32, yy, C.step);
      boxUV(u0, u0 + 0.04, hiV[0], hiV[1], yy - 0.015, yy + 0.006, C.nose);
    }
    // sloped soffit under the upper flight
    B.solid.quad([P3(0, hiV[0], F2Y - 0.32), P3(runL, hiV[0], F2Y / 2 - 0.32), P3(runL, hiV[1], F2Y / 2 - 0.32), P3(0, hiV[1], F2Y - 0.32)], null, [0, -1, 0], C.slab);
    boxUV(runL - 0.01, st.l - 0.1, 0.1, st.w - 0.1, F2Y / 2 - 0.3, F2Y / 2, C.slab);
    // walls of the stairwell (both floors) and the entry face
    wallUV(0, 0, st.l, 0, 0, ROOF - 0.05); wallUV(0, st.w, st.l, st.w, 0, ROOF - 0.05); wallUV(st.l, 0, st.l, st.w, 0, ROOF - 0.05);
    const lowAt0 = st.up === 'L' ? [0, half] : [half, st.w], hiAt0 = st.up === 'L' ? [half, st.w] : [0, half];
    wallUV(0, lowAt0[0], 0, lowAt0[1], 2.4, ROOF - 0.05, false);              // header on floor 1, solid on floor 2
    wallUV(0, hiAt0[0], 0, hiAt0[1], 0, F2Y, false);                          // under the upper flight on floor 1
    wallUV(0, hiAt0[0], 0, hiAt0[1], F2Y + 2.4, ROOF - 0.05, false);
    // a door in each entrance (same jambs as the collision walls in SchoolMap): floor 1 into the lower flight,
    // floor 2 off the top of the upper flight; frame + a leaf standing open against the jamb inside
    const DW = map.STAIR_DOOR;
    for (const [lane, y0] of [[lowAt0, 0], [hiAt0, F2Y]]) {
      const c = (lane[0] + lane[1]) / 2, d0 = c - DW / 2, d1 = c + DW / 2;
      wallUV(0, lane[0], 0, d0, y0, y0 + 2.4, false); wallUV(0, d1, 0, lane[1], y0, y0 + 2.4, false);
      for (const v of [d0, d1]) boxUV(-0.06, 0.08, v - 0.05, v + 0.05, y0, y0 + 2.32, C.frame);
      boxUV(-0.06, 0.08, d0 - 0.05, d1 + 0.05, y0 + 2.28, y0 + 2.4, C.frame);
      // the leaf stands open on the hallway side, flat against the entry wall toward the middle (solid) part of it
      const toMid = (lane[0] + lane[1]) / 2 < st.w / 2 ? 1 : -1, h0 = toMid > 0 ? d1 + 0.04 : d0 - DW + 0.06, h1 = h0 + DW - 0.1;
      boxUV(-0.09, -0.05, h0, h1, y0 + 0.01, y0 + 2.22, C.door);
      boxUV(-0.1, -0.04, (h0 + h1) / 2 - 0.12, (h0 + h1) / 2 + 0.12, y0 + 1.3, y0 + 1.9, C.doorGlass);
    }
    // glass balustrades + steel handrails along the well, handrails on the outer walls, a rail across the landing well
    const lowIn = st.up === 'L' ? lowV[1] : lowV[0], hiIn = st.up === 'L' ? hiV[0] : hiV[1];
    const lowOut = st.up === 'L' ? 0.07 : st.w - 0.07, hiOut = st.up === 'L' ? st.w - 0.07 : 0.07;
    for (const [v, fy, outer] of [[lowIn, lowY, false], [hiIn, hiY, false], [lowOut, lowY, true], [hiOut, hiY, true]]) {
      const a0 = 0.05, a1 = runL;
      if (!outer) {
        B.glass.quad([P3(a0, v, fy(a0) + 0.05), P3(a1, v, fy(a1) + 0.05), P3(a1, v, fy(a1) + 0.95), P3(a0, v, fy(a0) + 0.95)], null, null);
        for (let k = 0; k <= 4; k++) { const u = a0 + (a1 - a0) * k / 4; tube(P3(u, v, fy(u)), P3(u, v, fy(u) + 0.95), 0.02, C.rail); }
      }
      tube(P3(a0, v, fy(a0) + (outer ? 0.88 : 0.97)), P3(a1, v, fy(a1) + (outer ? 0.88 : 0.97)), 0.025, C.rail);
    }
    tube(P3(runL, lowIn, F2Y / 2 + 0.97), P3(runL, hiIn, F2Y / 2 + 0.97), 0.025, C.rail);
    // a ceiling light over the landing
    const lc = L(st.l - st.landing / 2, half);
    B.solid.box(lc[0], lc[1], 0.5, 0.25, rot, ROOF - 0.32, ROOF - 0.28, rgb('#fffbe8'));
    // a sign by each entrance
    void C;
  }

  // ---------------------------------------------------------------- the Dome (main entrance)
  buildDome(root, B, C) {
    const map = this.map, d = map.dome, H = 9.2;
    const floor = new THREE.Mesh(new THREE.CircleGeometry(d.r, 48).rotateX(-Math.PI / 2).rotateY(Math.PI).translate(d.x, 0.035, d.z), new THREE.MeshLambertMaterial({ map: this.T.seal }));
    floor.matrixAutoUpdate = false; root.add(floor);
    // openings match the collision gaps in SchoolMap: front doors (north) and the neck into the Nobel Commons (south)
    const front = Math.asin(0.2), neck = Math.asin(0.42);
    const arcs = [[-Math.PI / 2 + front, Math.PI - front - neck], [Math.PI / 2 + neck, Math.PI - neck - front]];
    for (const [a0, len] of arcs) {
      // three.js cylinders measure theta from +z toward +x; convert from our atan2(z, x) angles
      const g = new THREE.CylinderGeometry(d.r, d.r, H, 32, 1, true, Math.PI / 2 - (a0 + len), len).translate(d.x, H / 2, d.z);
      const m = new THREE.Mesh(g, this.MAT.glass); m.matrixAutoUpdate = false; root.add(m);
    }
    for (const a of [-Math.PI / 2 - front, -Math.PI / 2 + front, Math.PI / 2 - neck, Math.PI / 2 + neck]) {
      const x = d.x + Math.cos(a) * d.r, z = d.z + Math.sin(a) * d.r;
      B.solid.box(x, z, 0.09, 0.09, -a, 0, H, C.frame);
    }
    const fx = d.x, fz = d.z - d.r;
    B.solid.box(fx, fz, 0.12, d.r * 0.2 + 0.1, Math.PI / 2, 2.6, 2.75, C.frame);
    B.solid.box(fx, fz - 1.0, 1.0, 1.6, Math.PI / 2, 3.0, 3.12, C.white);
    const inOpening = a => { const c = Math.cos(a), sn = Math.sin(a); return (Math.abs(c) < 0.2 && sn < 0) || (Math.abs(c) < 0.42 && sn > 0); };
    for (let k = 0; k < 24; k++) {
      const a = k / 24 * Math.PI * 2 + Math.PI / 24, x = d.x + Math.cos(a) * d.r, z = d.z + Math.sin(a) * d.r;
      if (!inOpening(a)) B.solid.box(x, z, 0.05, 0.06, -a, 0, H, C.frame);
    }
    for (const y of [2.6, 5.6, H - 0.2]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(d.r, 0.06, 6, 48).rotateX(Math.PI / 2).translate(d.x, y, d.z), new THREE.MeshLambertMaterial({ color: 0x6b7078 }));
      ring.matrixAutoUpdate = false; root.add(ring);
    }
    const white = new THREE.MeshLambertMaterial({ color: 0xf3f2ee });
    const colGeo = mergeGeometries([new THREE.CylinderGeometry(0.42, 0.48, H, 16).translate(0, H / 2, 0), new THREE.BoxGeometry(1.2, 0.35, 1.2).translate(0, 0.175, 0),
      new THREE.CylinderGeometry(0.62, 0.45, 0.4, 16).translate(0, H - 0.2, 0), new THREE.BoxGeometry(1.25, 0.18, 1.25).translate(0, H + 0.09, 0)].map(g => { g.deleteAttribute('uv'); return g; }));
    const cols = new THREE.InstancedMesh(colGeo, white, map.columns.length);
    map.columns.forEach(([x, z], i) => cols.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, 0, z)));
    cols.computeBoundingSphere(); root.add(cols);
    const R = d.cols + 0.75;
    const ent = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 1.4, 48, 1, true).translate(d.x, H + 0.88, d.z), white); ent.matrixAutoUpdate = false; root.add(ent);
    const cornice = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.35, R, 0.35, 48).translate(d.x, H + 1.75, d.z), white); cornice.matrixAutoUpdate = false; root.add(cornice);
    const soffit = new THREE.Mesh(new THREE.RingGeometry(d.r, R, 48).rotateX(Math.PI / 2).translate(d.x, H + 0.18, d.z), new THREE.MeshLambertMaterial({ color: 0xe6e4de, side: THREE.DoubleSide }));
    soffit.matrixAutoUpdate = false; root.add(soffit);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(R - 0.2, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.5, 1).translate(d.x, H + 1.9, d.z),
      new THREE.MeshLambertMaterial({ color: 0xf6f5f1, side: THREE.DoubleSide }));
    dome.matrixAutoUpdate = false; root.add(dome);
    const ceil = new THREE.Mesh(new THREE.CircleGeometry(d.r, 48).rotateX(Math.PI / 2).translate(d.x, H, d.z),
      new THREE.MeshLambertMaterial({ color: 0xfff7e0, emissive: 0xfff2d0, emissiveIntensity: 0.55 }));
    ceil.matrixAutoUpdate = false; root.add(ceil);
    // front plaza, steps and a walk out to the road
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(d.cols + 4, 48).rotateX(-Math.PI / 2).translate(d.x, 0.015, d.z), this.MAT.concrete);
    plaza.matrixAutoUpdate = false; root.add(plaza);
  }

  // ---------------------------------------------------------------- campus around the building
  outside(root, B, C) {
    const map = this.map, d = map.dome;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2), this.MAT.grass);
    const uv = ground.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 900 / M.grass[0], uv.getY(i) * 900 / M.grass[1]);
    ground.matrixAutoUpdate = false; root.add(ground);
    const flatRect = (x0, z0, x1, z1, y, mat, m) => {
      const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, y, (z0 + z1) / 2);
      const u = g.attributes.uv; for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * (x1 - x0) / m[0], u.getY(i) * (z1 - z0) / m[1]);
      const mesh = new THREE.Mesh(g, mat); mesh.matrixAutoUpdate = false; root.add(mesh); return mesh;
    };
    // walk from the Dome to the road, the road (Minor Lane side), the bus loop
    flatRect(d.x - 2.5, d.z - 40, d.x + 2.5, d.z - d.cols - 3, 0.012, this.MAT.concrete, M.concrete);
    flatRect(-200, -118, 200, -104, 0.01, this.MAT.asphalt, M.asphalt);
    flatRect(-200, -104, 200, -101, 0.013, this.MAT.concrete, M.concrete);
    for (let x = -196; x < 196; x += 6) B.solid.box(x, -111, 1.4, 0.07, Math.PI / 2, 0.011, 0.016, rgb('#e8c547'));
    // parking lot to the west, with cars
    flatRect(-185, -70, -128, 95, 0.01, this.MAT.asphalt, M.asphalt);
    const carCols = ['#c9ccd1', '#1d1f24', '#8a1c22', '#2e4f86', '#f0f0ec', '#5b5f66', '#3d6b47'];
    for (let r = 0; r < 4; r++) for (let k = 0; k < 28; k++) {
      const x = -180 + r * 14 + (r % 2) * 5.5, z = -64 + k * 5.6;
      B.solid.box(x + (r % 2 ? -2.9 : 2.9), z, 0.06, 1.2, 0, 0.011, 0.016, rgb('#e9e9e4'));
      if (rnd() < 0.6) this.put('car', x, 0.01, z + 1.4, (r % 2 ? 1 : -1) * Math.PI / 2, { color: carCols[(rnd() * carCols.length) | 0] });
    }
    // stadium to the north across the road: track + Colonials field
    const fx = -40, fz = -205;
    flatRect(fx - 48, fz - 86, fx + 48, fz + 86, 0.012, new THREE.MeshLambertMaterial({ map: this.T.track }), [8, 8]);
    flatRect(fx - 30, fz - 62, fx + 30, fz + 62, 0.018, new THREE.MeshLambertMaterial({ map: this.T.field }), [60, 124]);
    for (const s of [-1, 1]) { const Bq = new Batch(); for (let k = 0; k < 6; k++) Bq.box(fx + s * (52 + k * 0.8), fz, 0.4, 40, 0, 0, 0.5 + k * 0.5, k % 2 ? rgb('#c3c6cb') : rgb('#9fa4ab')); root.add(Bq.mesh(this.MAT.solid)); }
    // trees around campus (not on the road, lot or building)
    for (let i = 0; i < 160; i++) {
      const x = -230 + rnd() * 450, z = -150 + rnd() * 300;
      if (z > -122 && z < -98) continue;
      if (x > -190 && x < -122 && z > -75 && z < 100) continue;
      if (map.pointInPoly(x, z, map.outline[1].poly) || Math.hypot(x - d.x, z - d.z) < d.cols + 8) continue;
      let near = false; for (let k = 0; k < map.outline[1].poly.length; k++) { const a = map.outline[1].poly[k], b = map.outline[1].poly[(k + 1) % map.outline[1].poly.length]; if (map.segDist(x, z, a[0], a[1], b[0], b[1]) < 6) { near = true; break; } }
      if (near || Math.abs(x - d.x) < 5 && z < d.z) continue;
      this.put('tree', x, 0, z, rnd() * 6, { sx: 0.8 + rnd() * 0.7, sy: 0.8 + rnd() * 0.6, sz: 0.8 + rnd() * 0.7 });
    }
    for (let x = -190; x < 190; x += 24) this.put('lamp', x, 0, -100, Math.PI / 2);
    // flagpole with the US flag by the front walk
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 12, 8).translate(d.x + 9, 6, d.z - 14), new THREE.MeshLambertMaterial({ color: 0xd8dade }));
    pole.matrixAutoUpdate = false; root.add(pole);
    map.walls.push({ a: [d.x + 8.8, d.z - 14], b: [d.x + 9.2, d.z - 14], y0: 0, y1: 12, kind: 'furn' });
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.4, 12, 2), new THREE.MeshLambertMaterial({ map: this.T.flag, side: THREE.DoubleSide }));
    flag.position.set(d.x + 10.35, 11.2, d.z - 14); root.add(flag); this.flag = flag;
    // the school sign at the road
    const signTex = makeLabelAtlas(['Thomas Jefferson High School for Science and Technology'], { cellW: 1024, cellH: 128, cols: 1, style: 'banner' });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.12), new THREE.MeshLambertMaterial({ map: signTex.tex }));
    const u = sign.geometry.attributes.uv, r = signTex.uv.values().next().value;
    for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) ? r[2] : r[0], u.getY(i) ? r[3] : r[1]);
    sign.position.set(d.x + 14, 1.5, -97.8); sign.updateMatrix(); sign.matrixAutoUpdate = false; root.add(sign);
    const back = new Batch(); back.box(d.x + 14, -98.1, 4.8, 0.25, 0, 0, 2.3, rgb('#8e4c38')); root.add(back.mesh(this.MAT.solid));
    map.walls.push({ a: [d.x + 9.2, -98.1], b: [d.x + 18.8, -98.1], y0: 0, y1: 2.3, kind: 'furn' });
    void C;
  }
}
