/**
 * Birds - draws BirdSim's flocks and handles what happens when one meets the aircraft.
 *
 * Each species is three InstancedMeshes (body, inner wings, outer wings: 3 draw calls however many birds).
 * Real sizes: goose 1.5 m span, gull 1.4 m, hawk 1.25 m, pigeon 0.65 m. A wing is two hinged segments, so the
 * flap bends the way a real one does: the hand (outer wing) lags the arm by about a sixth of a beat, the
 * wingtips fold in on the upstroke, and in a dive the wings sweep back and tuck. Gliding birds hold their own
 * posture (gull: arm up, hand down, the gull "M"; pigeon: a deep V; hawk: flat and broad; goose: nearly straight).
 * The body banks into turns (roll = atan(V * turn rate / g)) and pitches with its climb.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BirdSim, KINDS, hitPoints } from './BirdSim.js?v=2';

const G = 9.81, TAU = Math.PI * 2;

// wing outline past the elbow: [x as a fraction of the hand length, z in units of the elbow chord from the leading edge at the elbow]
const LOOK = {
  goose: { span: 1.5, len: 0.7, bodyR: 0.1, neck: 0.3, headR: 0.03, beak: 0.05, tail: 0.13, tailW: 0.14, chord: [0.22, 0.16],
           col: { body: '#6a5c4c', neck: '#15130f', beak: '#111111', tail: '#2a2622', wi: '#5b4f41', wo: '#352d25' },
           tip: [[0, -0.4], [0.55, -0.32], [1, 0.25], [0, 0.6]],
           glide: [0.0, -0.08], amp: [0.6, 0.55], lag: 0.9, fold: 0.15 },
  gull:  { span: 1.4, len: 0.45, bodyR: 0.07, neck: 0.05, headR: 0.03, beak: 0.05, tail: 0.15, tailW: 0.13, chord: [0.17, 0.11],
           col: { body: '#f2f2ee', neck: '#f2f2ee', beak: '#e2b22c', tail: '#f4f4f0', wi: '#aeb8c0', wo: '#25272b' },
           tip: [[0, -0.4], [0.55, -0.35], [1, 0.3], [0, 0.6]],
           glide: [0.22, -0.2], amp: [0.5, 0.6], lag: 0.9, fold: 0.2 },
  hawk:  { span: 1.25, len: 0.42, bodyR: 0.08, neck: 0.03, headR: 0.035, beak: 0.04, tail: 0.22, tailW: 0.2, chord: [0.3, 0.25],
           col: { body: '#8a6a4c', neck: '#5b4331', beak: '#2a2a2a', tail: '#a4482c', wi: '#6b4f38', wo: '#4a372a' },
           tip: [[0, -0.4], [0.6, -0.45], [1, -0.1], [0.95, 0.35], [0, 0.6]],
           glide: [0.1, 0.08], amp: [0.45, 0.5], lag: 0.8, fold: 0.1 },
  pigeon: { span: 0.65, len: 0.3, bodyR: 0.05, neck: 0.03, headR: 0.025, beak: 0.02, tail: 0.13, tailW: 0.11, chord: [0.14, 0.1],
           col: { body: '#7d848c', neck: '#5f6872', beak: '#333333', tail: '#3f444a', wi: '#9aa1a8', wo: '#70777e' },
           tip: [[0, -0.4], [0.5, -0.4], [1, 0], [0.7, 0.45], [0, 0.6]],
           glide: [0.3, -0.05], amp: [0.8, 0.7], lag: 0.8, fold: 0.3 },
};

/** A flat convex outline in the XZ plane (x, z pairs), facing up. */
function poly(pts) {
  const pos = [], nor = [];
  for (let i = 1; i < pts.length - 1; i++) {
    let a = pts[0], b = pts[i], c = pts[i + 1];
    if ((b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]) < 0) [b, c] = [c, b];
    for (const p of [a, b, c]) { pos.push(p[0], 0, p[1]); nor.push(0, 1, 0); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}
function paint(g, hex) {
  const n = g.attributes.position.count, c = new THREE.Color(hex), a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function prep(g, hex, m) {
  if (g.index) g = g.toNonIndexed();
  if (m) g.applyMatrix4(m);
  g.deleteAttribute('uv');
  return paint(g, hex);
}

function build(L) {
  const c = L.col, half = L.len / 2, parts = [], M = new THREE.Matrix4(), T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
  parts.push(prep(new THREE.SphereGeometry(1, 10, 8), c.body, M.makeScale(L.bodyR, L.bodyR * 0.95, half)));
  parts.push(prep(new THREE.CylinderGeometry(L.bodyR * 0.3, L.bodyR * 0.45, L.neck + 0.04, 6), c.neck, T(0, L.bodyR * 0.2, -(half + L.neck / 2 - 0.03)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))));
  parts.push(prep(new THREE.SphereGeometry(L.headR, 8, 6), c.neck, T(0, L.bodyR * 0.2, -(half + L.neck))));
  parts.push(prep(new THREE.ConeGeometry(L.headR * 0.55, L.beak, 5), c.beak, T(0, L.bodyR * 0.2, -(half + L.neck + L.headR + L.beak / 2 - 0.005)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2))));
  const tw = L.tailW, tz = half - 0.03;
  parts.push(prep(poly([[-tw * 0.2, tz], [tw * 0.2, tz], [tw * 0.5, tz + L.tail], [-tw * 0.5, tz + L.tail]]), c.tail));
  const body = mergeGeometries(parts);
  const L1 = L.span / 2 * 0.45, L2 = L.span / 2 * 0.55, c0 = L.chord[0], c1 = L.chord[1], sw = L1 * 0.1;
  const inner = paint(poly([[0, -0.4 * c0], [L1, -0.4 * c1 + sw], [L1, 0.6 * c1 + sw], [0, 0.6 * c0]]), c.wi);
  const outer = paint(poly(L.tip.map(([x, z]) => [x * L2, z * c1])), c.wo);
  return { body, inner, outer, L1, sw };
}

const _m = new THREE.Matrix4(), _w = new THREE.Matrix4(), _o = new THREE.Matrix4(), _t = new THREE.Matrix4(), _q = new THREE.Quaternion(),
      _e = new THREE.Euler(0, 0, 0, 'YXZ'), _p = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);

export class Birds {
  /** field: HeightField; fx: Effects (feathers) */
  constructor(scene, field, fx) {
    this.fx = fx; this.sim = new BirdSim((x, z) => field.at(x, z)); this.sets = {};
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
    for (const kind in KINDS) {
      const cap = KINDS[kind].flocks * KINDS[kind].max, g = build(LOOK[kind]), mk = (geo, n) => {
        const m = new THREE.InstancedMesh(geo, mat, n); m.count = 0; m.frustumCulled = false; m.castShadow = false; scene.add(m); return m;
      };
      this.sets[kind] = { n: 0, body: mk(g.body, cap), inner: mk(g.inner, cap * 2), outer: mk(g.outer, cap * 2), L1: g.L1, sw: g.sw, look: LOOK[kind] };
    }
  }

  reset(pl) { this.sim.reset(pl); this.render(); }
  /** The carrier map has no birds. */
  setVisible(v) { for (const k in this.sets) { const s = this.sets[k]; s.body.visible = s.inner.visible = s.outer.visible = v; } }
  update(dt, pl) { this.sim.update(dt, pl); }

  /** Did the aircraft hit a bird this step? Returns a text for the crash screen, or null. */
  strike(prev, cur, q, spec) {
    const hit = this.sim.strike(prev, cur, q, hitPoints(spec));
    if (!hit) return null;
    this.splat(hit.bird);
    this.sim.kill(hit);
    return `bird strike - hit ${KINDS[hit.flock.kind].label}`;
  }

  /** A puff of feathers where the bird was. */
  splat(b) {
    const R = (a, c) => a + Math.random() * (c - a), c = new THREE.Color(LOOK[b.kind].col.body);
    for (let i = 0; i < 40; i++) {
      this.fx.smoke.emit({ p: [b.x, b.y, b.z], v: [R(-6, 6), R(-3, 5), R(-6, 6)], life: R(2, 4), size: [0.15, 0.4], c0: [c.r * 1.4 + 0.3, c.g * 1.4 + 0.3, c.b * 1.4 + 0.3], c1: [c.r + 0.2, c.g + 0.2, c.b + 0.2],
                           a: 0.9, fadeIn: 0.02, drag: 1.4, acc: -1.5, spin: 4 });
    }
  }

  render() {
    for (const k in this.sets) this.sets[k].n = 0;
    for (const f of this.sim.flocks) { const s = this.sets[f.kind]; for (const b of f.birds) this.pose(s, b); }
    for (const k in this.sets) {
      const s = this.sets[k];
      s.body.count = s.n; s.inner.count = s.outer.count = s.n * 2;
      s.body.instanceMatrix.needsUpdate = s.inner.instanceMatrix.needsUpdate = s.outer.instanceMatrix.needsUpdate = true;
    }
  }

  pose(s, b) {
    const L = s.look, i = s.n++, fa = b.fa, sph = Math.sin(b.phase);
    const roll = Math.atan2(b.s * b.psiDot, G), pitch = Math.atan2(b.vz, b.s) + 0.06 * fa * Math.cos(b.phase);
    _e.set(pitch, b.psi, roll, 'YXZ'); _q.setFromEuler(_e);
    _p.set(b.x, b.y + 0.02 * fa * L.span * sph, b.z);
    _m.compose(_p, _q, _one);
    s.body.setMatrixAt(i, _m);
    const a = L.glide[0] * (1 - fa) + fa * (L.amp[0] * sph + 0.05) - 0.25 * b.dive;
    const bb = L.glide[1] * (1 - fa) + fa * L.amp[1] * Math.sin(b.phase - L.lag);
    const tuck = 1 - 0.5 * b.dive - L.fold * fa * Math.max(0, -sph);                // the hand folds in on the upstroke and in a dive
    const sweep = 1.1 * b.dive;
    for (let side = 1, k = 0; k < 2; k++, side = -1) {
      _w.copy(_m).multiply(_t.makeTranslation(0, 0.02, -L.len * 0.12));              // the shoulder
      _w.multiply(_t.makeScale(side, 1, 1));
      if (sweep) _w.multiply(_t.makeRotationY(-sweep));
      _w.multiply(_t.makeRotationZ(a));
      s.inner.setMatrixAt(i * 2 + k, _w);
      _o.copy(_w).multiply(_t.makeTranslation(s.L1, 0, s.sw)).multiply(_t.makeRotationZ(bb)).multiply(_t.makeScale(tuck, 1, 1));
      s.outer.setMatrixAt(i * 2 + k, _o);
    }
  }
}
