/**
 * Voxel Kart Racing - renderer: the track (via TrackBuilder), blocky karts and drivers, shells,
 * bananas, item boxes, fireballs and all the juice (drift sparks by tier, boost flames, dirt,
 * item-box bursts, hit stars), plus the chase camera transform handed in by main.js.
 */
import * as THREE from 'three';
import { buildTrack, makeTextures, TEX, pushBlock } from './TrackBuilder.js?v=1';

const K = window.VKConst, TR = window.VKTracks;
const { KF, SURF, COLORS } = K;

const SPARK = [0xffffff, 0x3aa0ff, 0xff9a1a, 0xd040ff];

function pixTex(rows, palette) {
  const c = document.createElement('canvas');
  c.width = rows[0].length; c.height = rows.length;
  const g = c.getContext('2d');
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (palette[ch]) { g.fillStyle = palette[ch]; g.fillRect(x, y, 1, 1); } }));
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const FACE = ['hhhhhhhh', 'hhhhhhhh', 'hssssssh', 'sssssss.', 'swessews', 'ssssssss', 'sssmmsss', 'ssssssss'];
const HAIR = ['#3b2a1a', '#e2c26b', '#1d1d1d', '#8a3b1a', '#5a3a2a', '#d8d8d8', '#2a1a3a', '#b0603a'];

/** Block-built kart: chassis in the racer's colour, black wheels, exhausts, a cube-headed driver. */
function buildKart(colorIdx) {
  const color = COLORS[colorIdx % COLORS.length];
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const paint = new THREE.MeshLambertMaterial({ color });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2a2a2a });
  const metal = new THREE.MeshLambertMaterial({ color: 0x9aa0a8 });
  const box = (w, h, d, mat, x, y, z, parent = body) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); parent.add(m); return m; };
  box(1.5, 0.35, 2.3, paint, 0, 0.45, 0);                 // floor
  box(1.3, 0.35, 0.7, paint, 0, 0.75, 0.85);              // nose
  box(1.6, 0.18, 0.35, dark, 0, 0.55, 1.25);              // bumper
  box(0.9, 0.5, 0.5, paint, 0, 0.85, -0.85);              // engine
  box(0.18, 0.18, 0.5, metal, 0.32, 0.95, -1.2);          // exhausts
  box(0.18, 0.18, 0.5, metal, -0.32, 0.95, -1.2);
  box(1.7, 0.12, 0.45, paint, 0, 1.25, -1.1);             // spoiler
  box(0.12, 0.35, 0.12, dark, 0.55, 1.05, -1.1); box(0.12, 0.35, 0.12, dark, -0.55, 1.05, -1.1);
  box(0.9, 0.12, 0.8, dark, 0, 0.68, -0.2);               // seat
  const wheel = (x, z) => { const w = new THREE.Group(); w.position.set(x, 0.38, z); body.add(w); box(0.42, 0.72, 0.72, dark, 0, 0, 0, w); box(0.44, 0.3, 0.3, metal, 0, 0, 0, w); return w; };
  const wheels = [wheel(0.88, 0.8), wheel(-0.88, 0.8), wheel(0.88, -0.8), wheel(-0.88, -0.8)];
  // driver
  const shirt = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).offsetHSL(0, 0, -0.12) });
  box(0.7, 0.75, 0.45, shirt, 0, 1.15, -0.25);           // torso
  box(0.22, 0.6, 0.22, shirt, 0.42, 1.05, 0.15).rotation.x = -1.1;   // arms reaching the wheel
  box(0.22, 0.6, 0.22, shirt, -0.42, 1.05, 0.15).rotation.x = -1.1;
  const faceTex = pixTex(FACE, { h: HAIR[colorIdx % 8], s: '#e8b58c', w: '#ffffff', e: '#2a3a8a', m: '#8a4a3a' });
  const skin = new THREE.MeshLambertMaterial({ color: 0xe8b58c });
  const hair = new THREE.MeshLambertMaterial({ color: HAIR[colorIdx % 8] });
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.62), [skin, skin, hair, skin, new THREE.MeshLambertMaterial({ map: faceTex }), hair]);
  head.position.set(0, 1.85, -0.25); body.add(head);
  const sw = box(0.5, 0.08, 0.08, dark, 0, 1.1, 0.45);   // steering wheel
  // rescue cloud
  const cloud = new THREE.Group();
  const cm = new THREE.MeshLambertMaterial({ map: TEX.cloud });
  for (const [x, z, s] of [[0, 0, 1.6], [0.9, 0.3, 1.1], [-0.9, -0.2, 1.2], [0.2, -0.9, 1]]) box(s * 1.2, 0.5, s, cm, x, -0.2, z, cloud);
  cloud.visible = false; root.add(cloud);
  return { root, body, wheels, head, sw, cloud, spin: 0, scale: 1, drift: 0, roll: 0 };
}

function shellModel(red) {
  const g = new THREE.Group();
  const shell = new THREE.MeshLambertMaterial({ color: red ? 0xd82a2a : 0x2fb02f });
  const rim = new THREE.MeshLambertMaterial({ color: 0xf4f0e0 });
  const a = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.25, 1.0), rim); a.position.y = 0.15; g.add(a);
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.4, 0.85), shell); b.position.y = 0.45; g.add(b);
  const c = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.5), shell); c.position.y = 0.72; g.add(c);
  return g;
}
function bananaModel() {
  const g = new THREE.Group(), y = new THREE.MeshLambertMaterial({ color: 0xffd83a }), br = new THREE.MeshLambertMaterial({ color: 0x6a4a1a });
  [[0, 0.2, 0], [0.25, 0.4, 0], [0.4, 0.65, 0]].forEach(([x, yy, z]) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), y); m.position.set(x - 0.2, yy, z); g.add(m); });
  const tip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.15, 0.12), br); tip.position.set(0.2, 0.85, 0); g.add(tip);
  [-1, 1].forEach(s => { const p = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.25), y); p.position.set(-0.35, 0.05, s * 0.22); g.add(p); });
  return g;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.r.setPixelRatio(Math.min(1.5, devicePixelRatio || 1));
    this.r.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.1, 2000);
    makeTextures();
    this.karts = new Map();
    this.shots = new Map();
    this.time = 0;
    this.buildParticles();
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const b = this.canvas.getBoundingClientRect();
    const w = Math.max(320, b.width | 0), h = Math.max(200, b.height | 0);
    this.r.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  setTrack(T) {
    if (this.T === T) return;
    this.T = T;
    if (this.world) this.scene.remove(this.world.group);
    this.world = buildTrack(T, this.r);
    this.scene.add(this.world.group);
    this.scene.fog = this.world.fog;
    this.r.toneMappingExposure = this.world.exposure || 1;
  }

  ensureKart(id, color, name, isMe) {
    let k = this.karts.get(id);
    if (k && k.color === color) return k;
    if (k) this.scene.remove(k.root);
    k = buildKart(color);
    k.color = color;
    if (!isMe) {
      const c = document.createElement('canvas'); c.width = 256; c.height = 48;
      const x = c.getContext('2d');
      x.font = 'bold 28px "Press Start 2P", monospace'; x.textAlign = 'center';
      x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(0, 4, 256, 40);
      x.fillStyle = '#' + COLORS[color].toString(16).padStart(6, '0'); x.fillText(name.slice(0, 12), 128, 36);
      const tex = new THREE.CanvasTexture(c); tex.magFilter = THREE.NearestFilter;
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      label.scale.set(3.2, 0.6, 1); label.position.y = 2.9; label.renderOrder = 5;
      k.root.add(label); k.label = label;
    }
    this.scene.add(k.root);
    this.karts.set(id, k);
    return k;
  }

  dropKartsExcept(ids) {
    for (const [id, k] of this.karts) if (!ids.has(id)) { this.scene.remove(k.root); this.karts.delete(id); }
  }

  // ---------- particles: square points (they look like little voxels)
  buildParticles() {
    const n = 2400;
    const geo = new THREE.BufferGeometry();
    this.pp = { n, pos: new Float32Array(n * 3).fill(-9999), col: new Float32Array(n * 3), vel: new Float32Array(n * 3), life: new Float32Array(n), max: new Float32Array(n),
                grav: new Float32Array(n), base: new Float32Array(n * 3), next: 0 };
    geo.setAttribute('position', new THREE.BufferAttribute(this.pp.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pp.col, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.13, vertexColors: true, sizeAttenuation: true, transparent: true, depthWrite: false }));
    this.points.frustumCulled = false;
    this.scene.add(this.points);
    this.glowPts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.26, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.glowPts.frustumCulled = false;
    this.scene.add(this.glowPts);
  }
  emit(x, y, z, vx, vy, vz, life, grav, hex) {
    const P = this.pp, i = P.next; P.next = (P.next + 1) % P.n;
    const c = new THREE.Color(hex);
    P.pos.set([x, y, z], i * 3); P.vel.set([vx, vy, vz], i * 3); P.base.set([c.r, c.g, c.b], i * 3);
    P.life[i] = life; P.max[i] = life; P.grav[i] = grav;
  }
  burst(x, y, z, n, speed, colors, life = 0.8, grav = 12) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, s = speed * (0.4 + Math.random() * 0.6), r = Math.sqrt(1 - u * u);
      this.emit(x, y, z, Math.cos(a) * r * s, Math.abs(u) * s + 2, Math.sin(a) * r * s, life * (0.6 + Math.random() * 0.6), grav, colors[i % colors.length]);
    }
  }
  stepParticles(dt) {
    const P = this.pp;
    for (let i = 0; i < P.n; i++) {
      if (P.life[i] <= 0) continue;
      P.life[i] -= dt;
      if (P.life[i] <= 0) { P.pos[i * 3 + 1] = -9999; continue; }
      P.vel[i * 3 + 1] -= P.grav[i] * dt;
      const k = Math.pow(0.4, dt);
      P.vel[i * 3] *= k; P.vel[i * 3 + 2] *= k;
      P.pos[i * 3] += P.vel[i * 3] * dt; P.pos[i * 3 + 1] += P.vel[i * 3 + 1] * dt; P.pos[i * 3 + 2] += P.vel[i * 3 + 2] * dt;
      const f = Math.min(1, P.life[i] / P.max[i] * 1.5);
      P.col[i * 3] = P.base[i * 3] * f; P.col[i * 3 + 1] = P.base[i * 3 + 1] * f; P.col[i * 3 + 2] = P.base[i * 3 + 2] * f;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  // ---------- effects triggered by events
  boxBurst(x, y, z) { this.burst(x, y, z, 40, 9, [0xffd23a, 0xffffff, 0xff7aff, 0x7af0ff], 0.9, 14); }
  hitFx(x, y, z) { this.burst(x, y + 1, z, 30, 7, [0xffffff, 0xffe14a, 0xff5a5a], 0.8, 10); }
  shellBreak(x, y, z, red) { this.burst(x, y, z, 20, 6, [red ? 0xd82a2a : 0x2fb02f, 0xf4f0e0], 0.7, 16); }

  /**
   * view: {dt, cam {pos, look, roll, fov}, karts [{id,x,y,z,yaw,speed,bits,tier,steer,color,name,me}], shots [{id,type,x,y,z}],
   *        boxesOff: Set, hazardTick}
   */
  render(view) {
    const dt = view.dt;
    this.time += dt;
    const T = this.T;
    if (this.world) {
      this.world.update(dt, this.time);
      this.world.boxMeshes.forEach((m, i) => {
        const off = view.boxesOff && view.boxesOff.has(i);
        const want = off ? 0 : 1;
        m.userData.s = (m.userData.s ?? 1) + (want - (m.userData.s ?? 1)) * Math.min(1, dt * (off ? 30 : 4));
        m.visible = m.userData.s > 0.03;
        m.scale.setScalar(m.userData.s);
        m.rotation.y = this.time * 1.6 + m.userData.phase; m.rotation.x = Math.sin(this.time + m.userData.phase) * 0.3;
        m.position.y = T.boxes[i].y + Math.sin(this.time * 2.2 + m.userData.phase) * 0.15;
        m.material.emissive.setHSL((this.time * 0.25 + i * 0.07) % 1, 0.8, 0.18);
      });
      if (view.hazardTick != null) T.hazards.forEach((hz, i) => {
        const p = TR.hazardPos(T, hz, view.hazardTick), m = this.world.hazardMeshes[i];
        m.position.set(p.x, p.y, p.z); m.rotation.set(this.time * 3, this.time * 2, 0);
        if (Math.random() < dt * 30) this.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 2, 1 + Math.random() * 2, (Math.random() - 0.5) * 2, 0.6, -1, Math.random() < 0.5 ? 0xff5a00 : 0xffd23a);
      });
    }

    // karts
    for (const q of view.karts) {
      const m = this.ensureKart(q.id, q.color, q.name, q.me);
      m.root.position.set(q.x, q.y, q.z);
      const spinning = q.bits & KF.SPIN;
      m.spin = spinning ? m.spin + dt * 16 : m.spin % (Math.PI * 2) * Math.pow(0.001, dt);
      const driftDir = q.tier ? Math.sign(q.tier) : (q.bits & KF.DRIFT ? (q.steer || 1) : 0);
      m.drift += (driftDir * 0.38 - m.drift) * Math.min(1, dt * 8);
      m.root.rotation.set(0, q.yaw + m.spin + m.drift * -1, 0);
      const target = q.bits & KF.SHRINK ? 0.55 : 1;
      m.scale += (target - m.scale) * Math.min(1, dt * 6);
      m.root.scale.setScalar(m.scale);
      m.roll += q.speed * dt / 0.36;
      m.wheels.forEach((w, i) => { w.rotation.x = m.roll; if (i < 2) w.rotation.y = -(q.steer || 0) * 0.4; });
      m.sw.rotation.z = (q.steer || 0) * 0.5;
      m.body.rotation.z = -(q.steer || 0) * Math.min(1, q.speed / 20) * 0.08 + m.drift * 0.15;
      m.body.position.y = q.bits & KF.AIR ? 0.05 : Math.sin(this.time * 30 + q.id) * 0.015 * Math.min(1, q.speed / 10);
      m.cloud.visible = !!(q.bits & KF.RESCUE);
      m.head.rotation.y = (q.steer || 0) * -0.25;

      // juice
      const fx = Math.sin(q.yaw), fz = Math.cos(q.yaw), rx = -fz, rz = fx;
      const rear = (side, back) => [q.x - fx * back + rx * side * 0.85 * m.scale, q.y + 0.15, q.z - fz * back + rz * side * 0.85 * m.scale];
      const tier = Math.abs(q.tier || 0);
      if ((q.bits & KF.DRIFT) && !(q.bits & KF.AIR)) {
        const col = SPARK[tier];
        for (const side of [-1, 1]) if (Math.random() < dt * (tier ? 70 : 30)) {
          const [x, y, z] = rear(side, 0.9 * m.scale);
          this.emit(x, y, z, rx * side * 2 + (Math.random() - 0.5) * 3, 2 + Math.random() * 3, rz * side * 2 + (Math.random() - 0.5) * 3, 0.35, 18, col);
        }
      }
      if (q.bits & KF.BOOST) for (const side of [-1, 1]) if (Math.random() < dt * 60) {
        const x = q.x - fx * 1.5 * m.scale + rx * side * 0.32 * m.scale, z = q.z - fz * 1.5 * m.scale + rz * side * 0.32 * m.scale;
        this.emit(x, q.y + 0.95 * m.scale, z, -fx * 6 + (Math.random() - 0.5), 0.5 + Math.random(), -fz * 6 + (Math.random() - 0.5), 0.3, -2, Math.random() < 0.5 ? 0xff7a1a : 0xffe14a);
      }
      if (T && q.speed > 6 && !(q.bits & KF.AIR) && Math.random() < dt * 25) {
        const g = TR.groundAt(T, q.x, q.z);
        if (g.surf === SURF.OFFROAD || g.surf === SURF.WATER) {
          const [x, y, z] = rear(Math.random() < 0.5 ? -1 : 1, 0.9);
          const col = g.surf === SURF.WATER ? 0x9fd0ff : T.def.theme.ground === 'stone' ? 0x7a706a : 0x8a6a3a;
          this.emit(x, y, z, -fx * 2 + (Math.random() - 0.5) * 2, 2 + Math.random() * 2, -fz * 2 + (Math.random() - 0.5) * 2, 0.5, 10, col);
        }
      }
      if (spinning && Math.random() < dt * 20) this.emit(q.x, q.y + 2.3, q.z, (Math.random() - 0.5) * 3, 1, (Math.random() - 0.5) * 3, 0.5, 2, 0xffe14a);
    }

    // shells and bananas
    const seen = new Set();
    for (const s of view.shots) {
      seen.add(s.id);
      let m = this.shots.get(s.id);
      if (!m) { m = s.type === 0 ? bananaModel() : shellModel(s.type === 2); m.userData.type = s.type; this.scene.add(m); this.shots.set(s.id, m); }
      m.position.set(s.x, s.y - 0.4, s.z);
      if (s.type) { m.rotation.y += dt * 10; if (s.type === 2 && Math.random() < dt * 30) this.emit(s.x, s.y, s.z, 0, 0.5, 0, 0.3, 0, 0xff4a4a); }
    }
    for (const [id, m] of this.shots) if (!seen.has(id)) {
      if (m.userData.type) this.shellBreak(m.position.x, m.position.y + 0.4, m.position.z, m.userData.type === 2);
      this.scene.remove(m); this.shots.delete(id);
    }

    this.stepParticles(dt);

    // camera
    const c = view.cam;
    if (c) {
      this.camera.position.set(c.pos[0], c.pos[1], c.pos[2]);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(c.look[0], c.look[1], c.look[2]);
      if (c.roll) this.camera.rotateZ(c.roll);
      if (Math.abs(this.camera.fov - c.fov) > 0.01) { this.camera.fov = c.fov; this.camera.updateProjectionMatrix(); }
    }
    this.r.render(this.scene, this.camera);
  }
}
