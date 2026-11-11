/**
 * Playground - things to fly through, around and (if you get it wrong) into. Everything that looks solid
 * is solid: the collision shapes are the same polygons the meshes are extruded from.
 *
 *   REX       a giant gilded "REX" on a stepped Art-Deco pedestal 650 m west of the runway, searchlights
 *             sweeping the sky behind it; fly through the R's bowl, the E's notches, the X's V's or between letters
 *   barn      a red barn east of the field with both ends open (30 m x 16 m), and its silo
 *   arch      the Eye of the Needle: a sea arch on the south-west coast, sea stacks to slalom around it
 *   bridge    a suspension bridge across the canyon (the ring race flies under it)
 *   hoops     the Hoop Loop: 8 hoops on a vertical circle over the eastern sea - one loop through all of them
 *   balloons  party balloons over the hills north of the field - pop them all
 *   sea lane  the floatplane's water runway: buoys along both edges, threshold / aiming-point buoys, a dock
 *
 * obstacleAt(x, y, z) -> name | null (for the physics). step(prev, cur, reach) -> events:
 *   {type: 'stunt', id, name} | {type: 'hoop', i, n} | {type: 'pop', pos, color, left, total}
 */
import * as THREE from 'three';

const W = window.FSWorld;

export const STUNTS = [
  { id: 'rexR', name: 'Through the R', how: 'The REX statue west of the runway: fly through the bowl of the R (or under its leg)' },
  { id: 'rexE', name: 'Threading the E', how: 'Through one of the two notches of the E (34 m tall)' },
  { id: 'rexX', name: 'X Marks the Spot', how: 'Through the top or the bottom V of the X' },
  { id: 'rexGap', name: 'Mind the Gap', how: 'Between two letters of REX - 26 m, knife-edge helps' },
  { id: 'barn', name: 'Barnstormer', how: 'Fly through the red barn 800 m east of the runway (30 m wide, 16 m tall)' },
  { id: 'arch', name: 'Eye of the Needle', how: 'Through the sea arch on the south-west coast' },
  { id: 'bridge', name: 'Under the Bridge', how: 'Under the red suspension bridge in the canyon' },
  { id: 'hoops', name: 'Hoop Loop', how: 'Over the eastern sea: fly one loop through all 8 hoops, bottom one first' },
  { id: 'balloons', name: 'Balloon Buster', how: 'Pop every balloon over the hills north of the field' },
];

// ---------- local frames: origin + yaw (the same as an Object3D with rotation.y = yaw)
function frame(x, y, z, yaw) { return { x, y, z, yaw, c: Math.cos(yaw), s: Math.sin(yaw) }; }
function toLocal(f, x, y, z) { const dx = x - f.x, dz = z - f.z; return [dx * f.c - dz * f.s, y - f.y, dx * f.s + dz * f.c]; }
function toWorld(f, u, v, w) { return [f.x + u * f.c + w * f.s, f.y + v, f.z - u * f.s + w * f.c]; }
function inPoly(P, u, v) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i], [xj, yj] = P[j];
    if ((yi > v) !== (yj > v) && u < (xj - xi) * (v - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const arc = (cx, cy, r, a0, a1, n) => { const out = []; for (let i = 0; i <= n; i++) { const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return out; };
const rect = (u0, v0, u1, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
const rnd = (() => { let s = 77; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
const std = (color, roughness = 0.8, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });

export class Playground {
  constructor(scene, field) {
    this.scene = scene; this.field = field;
    this.group = new THREE.Group(); scene.add(this.group);
    this.solids = []; this.zones = []; this.pois = [];
    this.cool = {};
    this.buildRex();
    this.buildBarn();
    this.buildArch();
    this.buildBridge();
    this.buildHoops();
    this.buildBalloons();
    this.buildSeaLane();
  }

  // ---------- collision shapes and fly-through zones
  /** A solid: local box [u0, v0, w0, u1, v1, w1] in frame f, optionally refined by test(u, v, w). */
  solid(name, f, box, test = null) {
    const aabb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const u of [box[0], box[3]]) for (const v of [box[1], box[4]]) for (const w of [box[2], box[5]]) {
      const p = toWorld(f, u, v, w);
      for (let a = 0; a < 3; a++) { aabb[a] = Math.min(aabb[a], p[a]); aabb[a + 3] = Math.max(aabb[a + 3], p[a]); }
    }
    this.solids.push({ name, f, box, test, aabb });
  }
  /** A fly-through window: polygon [[u, v]...] in the plane w = 0 of frame f. */
  zone(id, f, poly) { this.zones.push({ id, f, poly }); }
  /** Add a mesh placed in frame f at local (u, v, w). */
  put(mesh, f, u = 0, v = 0, w = 0, parent = this.group) {
    const p = toWorld(f, u, v, w); mesh.position.set(p[0], p[1], p[2]); mesh.rotation.y = f.yaw;
    parent.add(mesh); return mesh;
  }
  /** A box mesh, axis-aligned in frame f, that is also solid. */
  block(name, f, u0, v0, w0, u1, v1, w1, mat, { collide = true, shadow = true } = {}) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(u1 - u0, v1 - v0, w1 - w0), mat);
    m.castShadow = shadow; m.receiveShadow = true;
    this.put(m, f, (u0 + u1) / 2, (v0 + v1) / 2, (w0 + w1) / 2);
    if (collide) this.solid(name, f, [u0, v0, w0, u1, v1, w1]);
    return m;
  }

  obstacleAt(x, y, z) {
    for (const s of this.solids) {
      const b = s.aabb;
      if (x < b[0] || x > b[3] || y < b[1] || y > b[4] || z < b[2] || z > b[5]) continue;
      const [u, v, w] = toLocal(s.f, x, y, z), l = s.box;
      if (u < l[0] || u > l[3] || v < l[1] || v > l[4] || w < l[2] || w > l[5]) continue;
      if (!s.test || s.test(u, v, w)) return s.name;
    }
    return null;
  }

  // ---------- REX: extruded letters (same polygons for the mesh and the collision test)
  buildRex() {
    const st = W.SITES.rex, f = frame(st.x, st.elev, st.z, st.yaw);
    const S = 1.2, D = 36, P = 26, GAP = 22 * S, B = 2.5;
    const letters = [
      { ch: 'R', w: 118, outer: [[0, 0], [34, 0], [34, 58], [50, 58], [80, 0], [118, 0], [90, 61], ...arc(70, 104, 46, -62, 90, 16), [0, 150]],
        holes: [[[34, 86], ...arc(70, 107, 21, -90, 90, 14), [34, 128]]],
        zones: [['rexR', [[34, 86], ...arc(70, 107, 21, -90, 90, 14), [34, 128]]], ['rexR', [[34, 0], [80, 0], [50, 58], [34, 58]]]] },
      { ch: 'E', w: 100, outer: [[0, 0], [100, 0], [100, 32], [36, 32], [36, 60], [84, 60], [84, 90], [36, 90], [36, 118], [100, 118], [100, 150], [0, 150]], holes: [],
        zones: [['rexE', rect(36, 32, 100, 60)], ['rexE', rect(36, 90, 100, 118)]] },
      { ch: 'X', w: 120, outer: [[0, 0], [36, 0], [60, 52], [84, 0], [120, 0], [80, 75], [120, 150], [84, 150], [60, 98], [36, 150], [0, 150], [40, 75]], holes: [],
        zones: [['rexX', [[36, 150], [60, 98], [84, 150]]], ['rexX', [[36, 0], [84, 0], [60, 52]]]] },
    ];
    const total = letters.reduce((a, l) => a + l.w * S, 0) + GAP * (letters.length - 1);
    const statue = new THREE.Group(); this.put(statue, f);
    const gold = std(0xf0bd4f, 0.26, 0.8, { envMapIntensity: 1.2 }), goldSide = std(0xb88428, 0.34, 0.75);
    let u0 = -total / 2;
    letters.forEach((L, li) => {
      const sc = pts => pts.map(([x, y]) => new THREE.Vector2(u0 + x * S, P + y * S));
      const shape = new THREE.Shape(sc(L.outer));
      for (const h of L.holes) shape.holes.push(new THREE.Path(sc(h)));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: D - 2 * B, bevelEnabled: true, bevelThickness: B, bevelSize: B, bevelOffset: -B, bevelSegments: 2, curveSegments: 8 });
      geo.translate(0, 0, -(D - 2 * B) / 2);
      const m = new THREE.Mesh(geo, [gold, goldSide]); m.castShadow = true; m.receiveShadow = true; statue.add(m);
      const off = u0, outer = L.outer, holes = L.holes;
      this.solid('the REX statue', f, [off, P, -D / 2, off + L.w * S, P + 150 * S, D / 2],
        (u, v) => { const x = (u - off) / S, y = (v - P) / S; return inPoly(outer, x, y) && !holes.some(h => inPoly(h, x, y)); });
      for (const [id, poly] of L.zones) this.zone(id, f, poly.map(([x, y]) => [off + x * S, P + y * S]));
      u0 += L.w * S;
      if (li < letters.length - 1) { this.zone('rexGap', f, rect(u0, P, u0 + GAP, P + 150 * S)); u0 += GAP; }
    });
    // stepped pedestal (Art-Deco), with a gold band on the top step
    const stone = std(0xd6ccb4, 0.85), stone2 = std(0xb9ad93, 0.9), band = std(0xc99a3a, 0.35, 0.7);
    const tiers = [[40, 0, 9, stone2], [24, 9, 18, stone], [10, 18, P - 1, stone]];
    for (const [m, v0, v1, mat] of tiers) this.block('the REX statue pedestal', f, -total / 2 - m, v0, -D / 2 - m, total / 2 + m, v1, D / 2 + m, mat);
    this.block('the REX statue pedestal', f, -total / 2 - 10.4, P - 1, -D / 2 - 10.4, total / 2 + 10.4, P, D / 2 + 10.4, band);
    // a paved plaza
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(1, 64), std(0xb3ab9b, 0.95, 0, { polygonOffset: true, polygonOffsetFactor: -2 }));
    plaza.rotation.x = -Math.PI / 2; plaza.scale.set(st.rx - 6, st.rz - 6, 1); plaza.position.set(st.x, st.elev + 0.05, st.z); plaza.receiveShadow = true;
    this.group.add(plaza);
    // searchlights behind the statue, sweeping the sky (the 20th Century Fox fanfare look)
    this.lights = [];
    const beamGeo = new THREE.CylinderGeometry(70, 1.4, 2600, 20, 12, true); beamGeo.translate(0, 1300, 0);
    const bc = [], bp = beamGeo.attributes.position;
    for (let i = 0; i < bp.count; i++) { const k = Math.pow(1 - bp.getY(i) / 2600, 1.6); bc.push(k, k * 0.96, k * 0.82); }
    beamGeo.setAttribute('color', new THREE.Float32BufferAttribute(bc, 3));
    const beamMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const housingMat = std(0x2a2c30, 0.5, 0.7), lens = new THREE.MeshBasicMaterial({ color: 0xfff4d8 });
    [-190, -115, -40, 40, 115, 190].forEach((u, i) => {
      const w = -D / 2 - 52 - (i % 2) * 14;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.6, 2, 16), housingMat); this.put(base, f, u, 1, w);
      const pivot = new THREE.Group(); this.put(pivot, f, u, 4.5, w); pivot.rotation.order = 'YXZ';
      const can = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.0, 5, 16), housingMat); pivot.add(can);
      const glass = new THREE.Mesh(new THREE.CircleGeometry(2.3, 20), lens); glass.rotation.x = -Math.PI / 2; glass.position.y = 2.52; pivot.add(glass);
      pivot.add(new THREE.Mesh(beamGeo, beamMat));
      this.lights.push({ pivot, phase: i * 1.7, dir: i % 2 ? 1 : -1 });
    });
    this.rexFrame = f;
    this.pois.push({ x: st.x, z: st.z, label: 'REX', color: '#f0bd4f' });
  }

  // ---------- barn + silo
  buildBarn() {
    const st = W.SITES.barn, f = frame(st.x, st.elev, st.z, st.yaw);
    const BW = 30, T = 1.5, H = 16, L = 46, RISE = 11, OV = 1.5, half = BW / 2 + T + OV;
    const planks = canvasTex(256, 128, (g, w, h) => {
      g.fillStyle = '#a3261c'; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 8) { g.fillStyle = `rgba(0,0,0,${0.08 + Math.random() * 0.12})`; g.fillRect(x, 0, 1.5, h); }
      g.strokeStyle = '#f2ece0'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
      g.beginPath(); g.moveTo(3, 3); g.lineTo(w - 3, h - 3); g.moveTo(w - 3, 3); g.lineTo(3, h - 3); g.stroke();
    });
    const red = new THREE.MeshStandardMaterial({ map: planks, roughness: 0.85 }), redPlain = std(0x9e2a1f, 0.85), white = std(0xf2ece0, 0.7), roof = std(0x3c3f44, 0.6, 0.4);
    for (const s of [-1, 1]) this.block('the barn', f, s < 0 ? -BW / 2 - T : BW / 2, 0, -L / 2, s < 0 ? -BW / 2 : BW / 2 + T, H, L / 2, red);
    // roof: a prism (solid) made of two slabs, gables at both ends
    const slope = Math.hypot(half, RISE), ang = Math.atan2(RISE, half);
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(slope, 0.7, L + 2 * OV), roof); m.castShadow = true; m.receiveShadow = true;
      this.put(m, f, s * half / 2, H + RISE / 2 + 0.3, 0); m.rotateZ(-s * ang);
    }
    const gable = new THREE.Shape([new THREE.Vector2(-BW / 2 - T, 0), new THREE.Vector2(BW / 2 + T, 0), new THREE.Vector2(0, RISE * (BW / 2 + T) / half)]);
    for (const s of [-1, 1]) {
      const g = new THREE.Mesh(new THREE.ExtrudeGeometry(gable, { depth: 1.2, bevelEnabled: false }), redPlain); g.castShadow = true;
      this.put(g, f, 0, H, s * L / 2 - 0.6);
      this.block('the barn', f, -BW / 2 - T, H - 1.2, s * L / 2 - 0.8, BW / 2 + T, H, s * L / 2 + 0.4, white);   // lintel
    }
    this.solid('the barn roof', f, [-half, H, -L / 2 - OV, half, H + RISE + 1, L / 2 + OV], (u, v) => v <= H + 0.8 + RISE * (1 - Math.abs(u) / half));
    for (const s of [-1, 1]) for (const e of [-1, 1]) this.block('the barn', f, s * (BW / 2 + T / 2) - 0.6, 0, e * L / 2 - 0.6, s * (BW / 2 + T / 2) + 0.6, H, e * L / 2 + 0.6, white, { collide: false });
    // inside: a darker floor
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(BW, L), std(0x6b5a3e, 1, 0, { polygonOffset: true, polygonOffsetFactor: -2 }));
    this.put(floor, f, 0, 0.06, 0); floor.rotation.order = 'YXZ'; floor.rotation.set(-Math.PI / 2, f.yaw, 0);
    this.zone('barn', f, rect(-BW / 2, 0, BW / 2, H));
    // silo with a dome
    const su = BW / 2 + 18, sw = -10, SR = 7, SH = 38;
    const silo = new THREE.Mesh(new THREE.CylinderGeometry(SR, SR, SH, 28), new THREE.MeshStandardMaterial({ color: 0x9aa6b2, roughness: 0.45, metalness: 0.6 })); silo.castShadow = true;
    this.put(silo, f, su, SH / 2, sw);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(SR, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2), std(0x7d8892, 0.4, 0.7)); dome.castShadow = true; this.put(dome, f, su, SH, sw);
    this.solid('the silo', f, [su - SR, 0, sw - SR, su + SR, SH + SR, sw + SR], (u, v, w) => { const r2 = (u - su) ** 2 + (w - sw) ** 2; return v < SH ? r2 < SR * SR : r2 + (v - SH) ** 2 < SR * SR; });
    this.pois.push({ x: st.x, z: st.z, label: 'barn', color: '#e0503a' });
  }

  // ---------- the Eye of the Needle (a sea arch) and sea stacks
  buildArch() {
    const f = frame(-2400, 0, 4300, Math.PI / 2 + 0.25), D = 30, B = 3;
    const outer = [[-80, -30], [80, -30], [76, 0], [72, 22], [67, 46], [59, 70], [47, 92], [29, 108], [7, 117], [-16, 114], [-37, 104], [-53, 88], [-64, 66], [-71, 40], [-76, 14]];
    const hole = [[-27, -25], [27, -25], [29, 10], [27, 30], [24, 46], [18, 58], [10, 66], [0, 69], [-10, 66], [-18, 58], [-24, 46], [-27, 30], [-29, 10]];
    const shape = new THREE.Shape(outer.map(([u, v]) => new THREE.Vector2(u, v)));
    shape.holes.push(new THREE.Path(hole.map(([u, v]) => new THREE.Vector2(u, v))));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: D - 2 * B, bevelEnabled: true, bevelThickness: B, bevelSize: B, bevelOffset: -B, bevelSegments: 2, steps: 3 });
    geo.translate(0, 0, -(D - 2 * B) / 2);
    this.rockColors(geo);
    const rock = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
    const arch = new THREE.Mesh(geo, rock); arch.castShadow = true; arch.receiveShadow = true; this.put(arch, f);
    this.solid('the sea arch', f, [-80, -30, -D / 2, 80, 117, D / 2], (u, v) => inPoly(outer, u, v) && !inPoly(hole, u, v));
    this.zone('arch', f, hole);
    // sea stacks along the passage, for a slalom
    for (const [u, w, r, h] of [[44, 170, 13, 46], [-52, 310, 15, 62], [36, -180, 12, 40], [-46, -330, 16, 70]]) {
      const g = new THREE.CylinderGeometry(r * 0.7, r, h + 30, 9, 5); g.translate(0, (h + 30) / 2 - 30, 0);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const k = 1 + (rnd() - 0.5) * 0.12; p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
      g.computeVertexNormals(); this.rockColors(g);
      const m = new THREE.Mesh(g, rock); m.castShadow = true; m.receiveShadow = true; this.put(m, f, u, 0, w);
      this.solid('a sea stack', f, [u - r, -30, w - r, u + r, h + 1, w + r], (uu, v, ww) => { const rr = r * (1 - 0.3 * (v + 30) / (h + 30)) * 0.96; return (uu - u) ** 2 + (ww - w) ** 2 < rr * rr; });
    }
    const p = toWorld(f, 0, 0, 0);
    this.pois.push({ x: p[0], z: p[2], label: 'arch', color: '#c8b89a' });
  }
  /** Layered sandstone: wet and dark at the waterline, banded above, a green cap on top. */
  rockColors(geo) {
    const p = geo.attributes.position, col = [], c = new THREE.Color();
    const wet = new THREE.Color(0x3c3833), a = new THREE.Color(0xa08a6e), b = new THREE.Color(0x8a735a), top = new THREE.Color(0x6f7f45);
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      c.copy(a).lerp(b, 0.5 + 0.5 * Math.sin(y * 0.45 + Math.sin(y * 0.11) * 2));
      if (y < 4) c.lerp(wet, Math.min(1, (4 - y) / 6));
      if (y > 100) c.lerp(top, Math.min(1, (y - 100) / 12));
      col.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  }

  // ---------- suspension bridge across the canyon
  buildBridge() {
    const C = W.CANYON, [ax, az] = C[8], [bx, bz] = C[9];
    const mx = (ax + bx) / 2, mz = (az + bz) / 2, l = Math.hypot(bx - ax, bz - az);
    const ux = -(bz - az) / l, uz = (bx - ax) / l;                         // across the canyon
    const floor = W.canyonInfo(mx, mz).floor;
    const f = frame(mx, floor, mz, Math.atan2(-uz, ux));
    const DT = 140, DK = 7, HW = 11, TOP = DT + 78;
    const g = u => { const p = toWorld(f, u, 0, 0); return W.heightAt(p[0], p[2]) - floor; };
    let sR = 40, sL = 40;
    while (g(sR) < DT && sR < 600) sR += 2;
    while (g(-sL) < DT && sL < 600) sL += 2;
    const uL = -sL + 22, uR = sR - 22, um = (uL + uR) / 2, hs = (uR - uL) / 2;
    const cable = u => u < uL ? TOP + (DT + 1 - TOP) * (uL - u) / (uL + sL + 30) : u > uR ? TOP + (DT + 1 - TOP) * (u - uR) / (sR + 30 - uR) : DT + 7 + (TOP - DT - 7) * ((u - um) / hs) ** 2;
    const orange = std(0xc0392b, 0.55, 0.35), road = std(0x34363a, 0.9), steel = std(0x9c2e22, 0.5, 0.4);
    // deck (ends buried in the canyon walls) with side girders
    this.block('the bridge', f, -sL - 30, DT - DK, -HW, sR + 30, DT - 0.4, HW, steel);
    this.block('the bridge', f, -sL - 30, DT - 0.4, -HW + 1, sR + 30, DT, HW - 1, road, { collide: false });
    for (const s of [-1, 1]) this.block('the bridge', f, -sL - 30, DT, s > 0 ? HW - 1 : -HW, sR + 30, DT + 1.4, s > 0 ? HW : -HW + 1, orange, { shadow: false });
    // towers: two legs from the canyon wall up to TOP, with cross beams
    for (const ut of [uL, uR]) {
      const base = Math.min(DT - 30, g(ut)) - 8;
      for (const s of [-1, 1]) this.block('a bridge tower', f, ut - 3, base, s * HW - 3, ut + 3, TOP + 3, s * HW + 3, orange);
      for (const v of [TOP - 2, DT + 40, DT - DK - 10]) this.block('a bridge tower', f, ut - 2.5, v - 2.5, -HW, ut + 2.5, v + 2.5, HW, orange);
    }
    // main cables and hangers
    for (const s of [-1, 1]) {
      const pts = [];
      for (let u = -sL - 30; u <= sR + 30; u += 6) pts.push(new THREE.Vector3(...toWorld(f, u, cable(u), s * (HW - 1.5))));
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, 0.9, 6), orange); tube.castShadow = true; this.group.add(tube);
    }
    const hang = [];
    for (let u = uL + 8; u < uR - 4; u += 8) for (const s of [-1, 1]) { hang.push(...toWorld(f, u, DT + 1.4, s * (HW - 1.5)), ...toWorld(f, u, cable(u), s * (HW - 1.5))); }
    const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.Float32BufferAttribute(hang, 3));
    this.group.add(new THREE.LineSegments(hg, new THREE.LineBasicMaterial({ color: 0x9c2e22 })));
    this.solid('the bridge cables', f, [uL, DT, -HW, uR, TOP, HW], (u, v, w) => Math.abs(Math.abs(w) - (HW - 1.5)) < 1.6 && v < cable(u) + 1);
    this.zone('bridge', f, rect(uL + 3, -60, uR - 3, DT - DK));
    this.pois.push({ x: mx, z: mz, label: 'bridge', color: '#ff6a4a' });
  }

  // ---------- the Hoop Loop
  buildHoops() {
    const c = new THREE.Vector3(2600, 260, 3700), R = 170, r = 20, n = 8, fwd = new THREE.Vector3(0, 0, -1), up = new THREE.Vector3(0, 1, 0);
    this.hoops = [];
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2;
      const p = c.clone().addScaledVector(fwd, R * Math.sin(a)).addScaledVector(up, -R * Math.cos(a));
      const nrm = fwd.clone().multiplyScalar(Math.cos(a)).addScaledVector(up, Math.sin(a)).normalize();
      const g = new THREE.Group(); g.position.copy(p); g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nrm);
      const mat = new THREE.MeshStandardMaterial({ color: 0xff4fd8, emissive: 0xff4fd8, emissiveIntensity: 1.5, roughness: 0.4 });
      g.add(new THREE.Mesh(new THREE.TorusGeometry(r, 1.3, 10, 48), mat));
      const glow = new THREE.Mesh(new THREE.TorusGeometry(r, 3.6, 8, 48), new THREE.MeshBasicMaterial({ color: 0xff4fd8, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, depthWrite: false }));
      g.add(glow);
      const lab = canvasTex(128, 64, (x, w) => { x.fillStyle = '#fff'; x.font = 'bold 46px Arial'; x.textAlign = 'center'; x.fillText(String(i + 1), w / 2, 48); });
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: lab, transparent: true, depthWrite: false })); sp.scale.set(16, 8, 1); sp.position.y = r + 8; g.add(sp);
      this.group.add(g);
      this.hoops.push({ g, mat, glow, p, n: nrm, r });
    }
    this.hoopNext = 0; this.hoopT = 0;
    this.paintHoops();
    this.pois.push({ x: c.x, z: c.z, label: 'hoops', color: '#ff4fd8' });
  }
  paintHoops() {
    this.hoops.forEach((h, i) => {
      const col = i < this.hoopNext ? 0x5dff8a : i === this.hoopNext ? 0xffe14d : 0xff4fd8;
      h.mat.color.setHex(col); h.mat.emissive.setHex(col); h.glow.material.color.setHex(col);
    });
  }

  // ---------- balloons
  buildBalloons() {
    const colors = [0xff3b3b, 0xffd23a, 0x3bb8ff, 0x5ae05a, 0xff7ad8, 0xff8c2a, 0xa36bff];
    const geo = new THREE.SphereGeometry(4.2, 18, 14); geo.scale(1, 1.18, 1);
    const knot = new THREE.ConeGeometry(0.7, 1.2, 8); knot.translate(0, -5.4, 0);
    const strG = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -5.9, 0), new THREE.Vector3(0.6, -11, 0.3), new THREE.Vector3(-0.3, -16, 0)]);
    const strM = new THREE.LineBasicMaterial({ color: 0xeeeeee });
    this.balloons = [];
    for (let k = 0, tries = 0; k < 24 && tries < 500; tries++) {
      const x = -2100 + rnd() * 4200, z = -3300 + rnd() * 2300;
      if (Math.abs(x - W.SITES.rex.x) < 300 && z > -800) continue;
      if (this.balloons.some(b => Math.hypot(b.base[0] - x, b.base[2] - z) < 260)) continue;
      const y = Math.max(0, W.heightAt(x, z)) + 60 + rnd() * 200;
      const color = colors[k % colors.length];
      const g = new THREE.Group();
      g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.05, emissive: color, emissiveIntensity: 0.15 })));
      g.add(new THREE.Mesh(knot, new THREE.MeshStandardMaterial({ color, roughness: 0.4 })));
      g.add(new THREE.Line(strG, strM));
      g.position.set(x, y, z); this.group.add(g);
      this.balloons.push({ g, base: [x, y, z], phase: rnd() * 6.28, color, popped: false });
      k++;
    }
    this.pois.push({ x: 0, z: -2150, label: 'balloons', color: '#ffd23a' });
  }

  // ---------- the sea lane (W.SEALANE): buoys you can taxi past, and a floating dock
  buildSeaLane() {
    const L = W.SEALANE, f = frame(L.x, 0, L.z, 0);
    const geo = new THREE.SphereGeometry(0.9, 14, 10), band = new THREE.CylinderGeometry(0.92, 0.92, 0.45, 14);
    const mat = c => std(c, 0.45, 0.1, { emissive: c, emissiveIntensity: 0.25 });
    const orange = mat(0xff6a1a), white = std(0xf2f2ee, 0.5), green = mat(0x2fd65a), red = mat(0xe8302a), yellow = mat(0xffd21a);
    this.buoys = [];
    const buoy = (x, z, m) => {
      const g = new THREE.Group(); g.add(new THREE.Mesh(geo, m)); const b = new THREE.Mesh(band, white); b.position.y = 0.25; g.add(b);
      g.position.set(x, 0.2, z); this.group.add(g); this.buoys.push({ g, phase: x * 0.13 + z * 0.07 });
    };
    for (let z = L.z1; z <= L.z0 + 0.1; z += 100) for (const s of [-1, 1]) buoy(L.x + s * L.width / 2, z, (z - L.z1) / 100 % 2 ? white : orange);
    for (let x = -L.width / 2; x <= L.width / 2 + 0.1; x += 10) { buoy(L.x + x, L.z0 + 6, green); buoy(L.x + x, L.z1 - 6, red); }
    for (const s of [-1, 1]) for (const dz of [0, 20, 40]) buoy(L.x + s * (L.width / 2 - 8), L.z0 - 300 - dz, yellow);
    // floating dock west of the start, on pilings
    const wood = std(0x8a6a48, 0.9), dark = std(0x4a3a2a, 0.9);
    const du = -L.width / 2 - 36, dw = L.length / 2 - 70;
    this.block('the dock', f, du - 4, -0.4, dw - 40, du + 4, 1.0, dw + 40, wood);
    this.block('the dock', f, du + 4, -0.4, dw - 2, du + 26, 1.0, dw + 2, wood);              // finger pier toward the lane
    for (const [u, w] of [[du - 4, dw - 40], [du + 4, dw - 40], [du - 4, dw + 40], [du + 4, dw + 40], [du + 26, dw - 2], [du + 26, dw + 2], [du - 4, dw], [du + 4, dw]])
      this.block('the dock', f, u - 0.35, -3, w - 0.35, u + 0.35, 2.4, w + 0.35, dark);
    const shed = std(0x2f6f8f, 0.7); this.block('the dock', f, du - 3.5, 1.0, dw + 20, du + 3.5, 4.2, dw + 32, shed);
    this.pois.push({ x: L.x, z: L.z, label: 'sea lane', color: '#2fd6ff' });
  }

  /** New flight: balloons back, hoop progress cleared. Balloons and hoops only show in free flight. */
  reset(free) {
    for (const b of this.balloons) { b.popped = false; b.g.visible = free; }
    for (const h of this.hoops) h.g.visible = free;
    this.free = free; this.hoopNext = 0; this.paintHoops(); this.cool = {};
  }

  /** One physics frame from prev to cur ([x, y, z]); reach = how far from the CG the aircraft extends (half span). */
  step(prev, cur, reach) {
    const ev = [], now = performance.now() / 1000;
    const stunt = id => { if ((this.cool[id] || 0) > now) return; this.cool[id] = now + 2; ev.push({ type: 'stunt', id, name: STUNTS.find(s => s.id === id).name }); };
    for (const z of this.zones) {
      const a = toLocal(z.f, prev[0], prev[1], prev[2]), b = toLocal(z.f, cur[0], cur[1], cur[2]);
      if ((a[2] < 0) === (b[2] < 0) || Math.abs(a[2] - b[2]) > 60) continue;
      const t = a[2] / (a[2] - b[2]);
      if (inPoly(z.poly, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) stunt(z.id);
    }
    if (!this.free) return ev;
    // hoops, in order
    const h = this.hoops[this.hoopNext], first = this.hoops[0];
    const through = hp => {
      const d0 = (prev[0] - hp.p.x) * hp.n.x + (prev[1] - hp.p.y) * hp.n.y + (prev[2] - hp.p.z) * hp.n.z;
      const d1 = (cur[0] - hp.p.x) * hp.n.x + (cur[1] - hp.p.y) * hp.n.y + (cur[2] - hp.p.z) * hp.n.z;
      if (!(d0 < 0 && d1 >= 0)) return false;
      const t = d0 / (d0 - d1), x = prev[0] + (cur[0] - prev[0]) * t - hp.p.x, y = prev[1] + (cur[1] - prev[1]) * t - hp.p.y, z = prev[2] + (cur[2] - prev[2]) * t - hp.p.z;
      return Math.hypot(x, y, z) < hp.r;
    };
    if (this.hoopNext > 0 && now - this.hoopT > 25) { this.hoopNext = 0; this.paintHoops(); }
    if (through(h)) {
      this.hoopNext++; this.hoopT = now;
      ev.push({ type: 'hoop', i: this.hoopNext, n: this.hoops.length });
      if (this.hoopNext >= this.hoops.length) { this.hoopNext = 0; stunt('hoops'); }
      this.paintHoops();
    } else if (this.hoopNext > 0 && through(first)) {
      this.hoopNext = 1; this.hoopT = now; ev.push({ type: 'hoop', i: 1, n: this.hoops.length }); this.paintHoops();
    }
    this.popAlong(prev, cur, 5 + reach * 0.8, ev, stunt);
    return ev;
  }

  /** Balloons whose centre is within `radius` of the segment prev -> cur pop (flown into, or shot). */
  popAlong(prev, cur, radius, ev, stunt) {
    if (!this.free) return ev;
    const dx = cur[0] - prev[0], dy = cur[1] - prev[1], dz = cur[2] - prev[2], l2 = dx * dx + dy * dy + dz * dz || 1, reach = Math.sqrt(l2) + radius;
    for (const b of this.balloons) {
      if (b.popped) continue;
      const p = b.g.position;
      if (Math.abs(p.x - cur[0]) > reach + 20 || Math.abs(p.z - cur[2]) > reach + 20) continue;
      const t = Math.max(0, Math.min(1, ((p.x - prev[0]) * dx + (p.y - prev[1]) * dy + (p.z - prev[2]) * dz) / l2));
      if (Math.hypot(prev[0] + dx * t - p.x, prev[1] + dy * t - p.y, prev[2] + dz * t - p.z) < radius) {
        b.popped = true; b.g.visible = false;
        const left = this.balloons.filter(x => !x.popped).length;
        ev.push({ type: 'pop', pos: [p.x, p.y, p.z], color: b.color, left, total: this.balloons.length });
        if (!left) (stunt || (id => ev.push({ type: 'stunt', id, name: STUNTS.find(x => x.id === id).name })))('balloons');
      }
    }
    return ev;
  }

  update(dt, t) {
    for (const L of this.lights) {                       // slow crossing sweeps, like the fanfare
      L.pivot.rotation.y = this.rexFrame.yaw + Math.sin(t * 0.21 + L.phase) * 0.9;
      L.pivot.rotation.x = L.dir * (0.32 + 0.16 * Math.sin(t * 0.33 + L.phase * 1.3));
    }
    for (const b of this.buoys) { b.g.position.y = 0.15 + Math.sin(t * 1.3 + b.phase) * 0.15; b.g.rotation.z = Math.sin(t * 1.1 + b.phase) * 0.12; }
    for (const b of this.balloons) if (!b.popped) {
      b.g.position.y = b.base[1] + Math.sin(t * 0.7 + b.phase) * 2;
      b.g.rotation.z = Math.sin(t * 0.9 + b.phase) * 0.08;
    }
    if (this.free) for (const h of this.hoops) { h.glow.material.opacity = 0.12 + Math.sin(t * 4) * 0.05; h.g.children[0].rotation.z = t * 0.4; }
  }
}
