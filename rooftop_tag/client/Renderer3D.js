/**
 * Renderer3D - Rooftop Tag in Three.js: a rainy cyberpunk night over school rooftops.
 *   - wet, reflective roofs (roughness maps + an environment map baked from a neon scene)
 *   - a procedural city skyline with lit windows, holo ads and flying traffic; the street far below
 *   - neon trims, animated jump pads, amber grapple beams, glass bridges, billboard walls
 *   - waving team flags, the carrier's neon trail, runner models with run / slide / wall-run poses
 *   - first-person tagger + hook gauntlet, tag beams, hook cables, rain, sparks, "derez" deaths
 * cannon-es only drives cosmetic debris (the cubes a runner shatters into).
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

const { C, TEAMS, FLAG, PF } = window.RTConst;
const RTMove = window.RTMove;

// ---------- small helpers
const rnd = (() => { let s = 11; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function dataTex(w, h, draw) {           // linear (non-colour) data, e.g. roughness
  const t = canvasTex(w, h, draw);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
const css = hex => '#' + hex.toString(16).padStart(6, '0');
const Y = new THREE.Vector3(0, 1, 0);

// ---------- procedural textures
const TEX = {
  roof: () => canvasTex(256, 256, (g, w) => {
    g.fillStyle = '#3c3e48'; g.fillRect(0, 0, w, w);
    for (let i = 0; i < 2600; i++) { g.fillStyle = rnd() < 0.5 ? '#474a55' : '#33353e'; g.fillRect(rnd() * w, rnd() * w, 2, 2); }
    g.strokeStyle = '#2a2b32'; g.lineWidth = 3;
    for (let k = 0; k <= w; k += 128) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, w); g.moveTo(0, k); g.lineTo(w, k); g.stroke(); }
  }),
  roofRough: () => dataTex(256, 256, (g, w) => {        // puddles: smooth (dark) blobs on rough tar
    g.fillStyle = '#b8b8b8'; g.fillRect(0, 0, w, w);
    for (let i = 0; i < 18; i++) {
      const x = rnd() * w, y = rnd() * w, r = 10 + rnd() * 34;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, '#101010'); gr.addColorStop(0.7, '#202020'); gr.addColorStop(1, 'rgba(184,184,184,0)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, r * 1.4, r, rnd() * 3, 0, 7); g.fill();
    }
  }),
  facade: () => canvasTex(256, 256, (g, w) => {
    g.fillStyle = '#22242e'; g.fillRect(0, 0, w, w);
    for (let y = 8; y < w; y += 32) for (let x = 6; x < w; x += 21) {
      const lit = rnd();
      g.fillStyle = lit < 0.5 ? '#2c2f3a' : lit < 0.8 ? '#ffcf8a' : lit < 0.92 ? '#9fd8ff' : '#ff8ad8';
      g.globalAlpha = lit < 0.5 ? 1 : 0.55 + rnd() * 0.45;
      g.fillRect(x, y, 13, 18);
    }
    g.globalAlpha = 1;
  }),
  concrete: () => canvasTex(128, 128, (g, w) => {
    g.fillStyle = '#5a5c66'; g.fillRect(0, 0, w, w);
    for (let i = 0; i < 900; i++) { g.fillStyle = rnd() < 0.5 ? '#666873' : '#4c4e58'; g.fillRect(rnd() * w, rnd() * w, 2, 2); }
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, w - 10, w, 10);
  }),
  panel: () => canvasTex(128, 128, (g, w) => {
    g.fillStyle = '#454c62'; g.fillRect(0, 0, w, w);
    g.strokeStyle = '#2c3142'; g.lineWidth = 3; g.strokeRect(2, 2, w - 4, w - 4);
    g.fillStyle = '#525a74'; for (let x = 10; x < w; x += 16) g.fillRect(x, 0, 3, w);
    g.fillStyle = '#5a6278'; for (const [x, y] of [[8, 8], [w - 10, 8], [8, w - 10], [w - 10, w - 10]]) g.fillRect(x, y, 3, 3);
  }),
  grille: () => canvasTex(128, 128, (g, w) => {
    g.fillStyle = '#4a4f5c'; g.fillRect(0, 0, w, w);
    g.fillStyle = '#1c1f26'; for (let y = 10; y < w - 10; y += 8) g.fillRect(10, y, w - 20, 4);
    g.strokeStyle = '#6b7182'; g.lineWidth = 3; g.strokeRect(4, 4, w - 8, w - 8);
  }),
  plate: () => canvasTex(128, 128, (g, w) => {                    // diamond plate for ramps
    g.fillStyle = '#4b505c'; g.fillRect(0, 0, w, w);
    for (let y = 0; y < w; y += 16) for (let x = (y / 16) % 2 ? 8 : 0; x < w; x += 16) {
      g.fillStyle = '#6a7080'; g.save(); g.translate(x + 4, y + 4); g.rotate(0.7); g.fillRect(-5, -1.5, 10, 3); g.restore();
    }
  }),
  beam: () => canvasTex(128, 32, (g, w, h) => {                   // anchors: amber with chevrons, unmistakable
    g.fillStyle = '#ff9d1a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2a1600';
    for (let x = -32; x < w + 32; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 12, 0); g.lineTo(x + 28, h / 2); g.lineTo(x + 12, h); g.lineTo(x, h); g.lineTo(x + 16, h / 2); g.fill(); }
  }),
  hazard: () => canvasTex(64, 64, (g, w) => {
    g.fillStyle = '#1d1f26'; g.fillRect(0, 0, w, w);
    g.fillStyle = '#d8a21e'; for (let x = -w; x < w * 2; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 8, 0); g.lineTo(x - 24, w); g.lineTo(x - 32, w); g.fill(); }
  }),
  pad: () => canvasTex(128, 128, (g, w) => {
    g.fillStyle = '#04141a'; g.fillRect(0, 0, w, w);
    g.strokeStyle = '#22e6ff'; g.lineWidth = 6;
    for (let y = 18; y < w; y += 40) { g.beginPath(); g.moveTo(20, y + 22); g.lineTo(64, y); g.lineTo(108, y + 22); g.stroke(); }
  }),
  soft: () => canvasTex(64, 64, (g, w) => {
    const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, w);
  }, false),
};

/** Advert / billboard art (emissive). */
function adTexture(seed) {
  const ads = [
    ['NEON HIGH', 'HOME OF THE ROOFRUNNERS', '#ff2fb4', '#22e6ff'],
    ['SYNTH·COLA', 'TASTE THE VOLTAGE', '#22e6ff', '#ffe14d'],
    ['KAIRO AIR', 'FLY ABOVE THE RAIN', '#b46cff', '#ff9d1a'],
    ['GRAPPLE+', 'HOOK · SWING · WIN', '#ff9d1a', '#ff2fb4'],
    ['NO RUNNING', 'ON THE ROOF ;)', '#7dff6a', '#22e6ff'],
  ];
  const [title, sub, c1, c2] = ads[seed % ads.length];
  return canvasTex(512, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#0a0216'); gr.addColorStop(1, '#16031f');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.strokeStyle = c1; g.lineWidth = 8; g.strokeRect(10, 10, w - 20, h - 20);
    g.shadowColor = c1; g.shadowBlur = 24; g.fillStyle = c1; g.font = 'bold 76px Trebuchet MS, sans-serif'; g.textAlign = 'center';
    g.fillText(title, w / 2, h / 2 + 6);
    g.shadowColor = c2; g.fillStyle = c2; g.font = 'bold 30px Trebuchet MS, sans-serif'; g.fillText(sub, w / 2, h / 2 + 60);
    g.shadowBlur = 0; g.fillStyle = 'rgba(0,0,0,.25)'; for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 2);
  }, false);
}

// materials by name: base texture + how wet / metallic it is
const MATS = {
  roof: { tex: 'roof', tile: 4, rough: 1, metal: 0.15, roughMap: true },
  facade: { tex: 'facade', tile: 7, rough: 0.6, metal: 0.3, glow: 0.9 },
  parapet: { tex: 'concrete', tile: 2, rough: 0.55, metal: 0.1 },
  penthouse: { tex: 'panel', tile: 3, rough: 0.35, metal: 0.65 },
  gym: { tex: 'panel', tile: 3, rough: 0.35, metal: 0.65 },
  deck: { tex: 'panel', tile: 2.5, rough: 0.3, metal: 0.7 },
  wall: { tex: 'panel', tile: 2, rough: 0.35, metal: 0.6 },
  rail: { tex: 'hazard', tile: 0.8, rough: 0.4, metal: 0.6 },
  ac: { tex: 'grille', tile: 1.5, rough: 0.35, metal: 0.75 },
  vent: { tex: 'grille', tile: 1.2, rough: 0.35, metal: 0.75 },
  barrier: { tex: 'hazard', tile: 1.2, rough: 0.4, metal: 0.4 },
  ramp: { tex: 'plate', tile: 1.6, rough: 0.28, metal: 0.8 },
  beam: { tex: 'beam', tile: 1.6, rough: 0.4, metal: 0.3, glow: 1.4 },
  pylon: { tex: 'hazard', tile: 1.5, rough: 0.45, metal: 0.6 },
};

/** Box faces with world-space UVs so textures keep a constant scale on any box size. */
function pushBox(arr, b, tile, faces = [0, 1, 2, 3, 4, 5]) {
  const [x0, y0, z0, x1, y1, z1] = b;
  const all = [
    [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], 'zy'],
    [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], 'zy'],
    [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], 'xz'],
    [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], 'xz'],
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], 'xy'],
    [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], 'xy'],
  ];
  for (const fi of faces) {
    const [a, b2, c, d, n, plane] = all[fi];
    const uv = v => plane === 'zy' ? [v[2] / tile, v[1] / tile] : plane === 'xz' ? [v[0] / tile, v[2] / tile] : [v[0] / tile, v[1] / tile];
    for (const v of [a, b2, c, a, c, d]) { arr.pos.push(...v); arr.nor.push(...n); arr.uv.push(...uv(v)); }
  }
}
function geometryFrom(arr) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(arr.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(arr.uv, 2));
  return g;
}

/** Wedge geometry for a ramp (sloped top, two triangular sides, the tall end). */
function rampGeometry(r, tile) {
  const { x0, y0, z0, x1, z1 } = r, hi = r.y1, lo = r.low;
  // corner heights: h(x, z)
  const h = (x, z) => RTMove.rampHeight(r, x, z);
  const arr = { pos: [], nor: [], uv: [] };
  const quad = (a, b, c, d) => {
    const n = new THREE.Vector3().subVectors(new THREE.Vector3(...b), new THREE.Vector3(...a)).cross(new THREE.Vector3().subVectors(new THREE.Vector3(...c), new THREE.Vector3(...a))).normalize();
    const ax = Math.abs(n.x) > 0.5 ? 'zy' : Math.abs(n.z) > 0.5 ? 'xy' : 'xz';
    for (const v of [a, b, c, a, c, d]) {
      arr.pos.push(...v); arr.nor.push(n.x, n.y, n.z);
      arr.uv.push(...(ax === 'zy' ? [v[2] / tile, v[1] / tile] : ax === 'xz' ? [v[0] / tile, v[2] / tile] : [v[0] / tile, v[1] / tile]));
    }
  };
  // top
  quad([x0, h(x0, z1), z1], [x1, h(x1, z1), z1], [x1, h(x1, z0), z0], [x0, h(x0, z0), z0]);
  // sides (as quads down to y0)
  quad([x0, y0, z0], [x1, y0, z0], [x1, h(x1, z0), z0], [x0, h(x0, z0), z0].map((v, i) => v));          // -z face (reversed below if needed)
  quad([x1, y0, z1], [x0, y0, z1], [x0, h(x0, z1), z1], [x1, h(x1, z1), z1]);
  quad([x0, y0, z1], [x0, y0, z0], [x0, h(x0, z0), z0], [x0, h(x0, z1), z1]);
  quad([x1, y0, z0], [x1, y0, z1], [x1, h(x1, z1), z1], [x1, h(x1, z0), z0]);
  void lo; void hi;
  const g = geometryFrom(arr);
  return g;
}

// ---------- runner model
function limb(parent, a, b, r, mat) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b), dir = vb.clone().sub(va), len = dir.length();
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.01, len - r * 2 + 0.04), 4, 10), mat);
  m.position.copy(va).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(Y, dir.normalize());
  parent.add(m);
  return m;
}

/** Tagger pistol (used in the hands of runners and as the first-person viewmodel). */
function taggerModel(teamHex) {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x1c1f28, roughness: 0.35, metalness: 0.8 });
  const glow = new THREE.MeshStandardMaterial({ color: teamHex, emissive: teamHex, emissiveIntensity: 0.9 });
  const add = (geo, mat, x, y, z, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; g.add(m); return m; };
  add(new THREE.BoxGeometry(0.06, 0.07, 0.3), body, 0, 0.02, -0.1);
  add(new THREE.BoxGeometry(0.045, 0.12, 0.06), body, 0, -0.06, 0.0, 0.25);
  add(new THREE.CylinderGeometry(0.022, 0.026, 0.12, 12), body, 0, 0.02, -0.29, Math.PI / 2);
  add(new THREE.BoxGeometry(0.02, 0.008, 0.2), glow, 0, 0.058, -0.1);
  add(new THREE.TorusGeometry(0.03, 0.006, 6, 16), glow, 0, 0.02, -0.34);
  return g;
}

/** A runner: feet at the origin, facing -Z. Team colours on the visor, stripes and shoes. */
function buildRunner(team) {
  const T = TEAMS[team];
  const suit = new THREE.MeshStandardMaterial({ color: 0x1a1c24, roughness: 0.45, metalness: 0.35 });
  const jacket = new THREE.MeshStandardMaterial({ color: team ? 0x10323a : 0x3a1030, roughness: 0.4, metalness: 0.3 });
  const glow = new THREE.MeshStandardMaterial({ color: T.hex, emissive: T.hex, emissiveIntensity: 2.4 });
  const visor = new THREE.MeshStandardMaterial({ color: 0x050505, emissive: T.hex, emissiveIntensity: 1.6, roughness: 0.1, metalness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0x2a2d36, roughness: 0.5, metalness: 0.5 });
  const root = new THREE.Group();
  const mesh = (geo, mat, x, y, z, parent) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); (parent || root).add(m); return m; };

  const body = new THREE.Group(); root.add(body);                // tilts for slides and wall runs
  const hips = new THREE.Group(); hips.position.y = 0.95; body.add(hips);
  mesh(new THREE.BoxGeometry(0.34, 0.18, 0.22), suit, 0, 0, 0, hips);
  const legs = [];
  for (const s of [-1, 1]) {
    const thigh = new THREE.Group(); thigh.position.set(s * 0.1, -0.04, 0); hips.add(thigh);
    limb(thigh, [0, 0, 0], [0, -0.42, 0], 0.075, suit);
    mesh(new THREE.BoxGeometry(0.03, 0.3, 0.02), glow, s * 0.07, -0.2, -0.03, thigh);
    const knee = new THREE.Group(); knee.position.y = -0.42; thigh.add(knee);
    limb(knee, [0, 0, 0], [0, -0.38, 0], 0.065, suit);
    const shoe = mesh(new THREE.BoxGeometry(0.13, 0.1, 0.27), skin, 0, -0.43, -0.04, knee);
    mesh(new THREE.BoxGeometry(0.135, 0.025, 0.272), glow, 0, -0.47, -0.04, knee);
    void shoe;
    legs.push({ thigh, knee });
  }
  const torso = new THREE.Group(); torso.position.y = 1.02; body.add(torso);
  limb(torso, [0, 0, 0], [0, 0.12, 0], 0.12, suit);
  mesh(new THREE.BoxGeometry(0.44, 0.42, 0.26), jacket, 0, 0.3, 0, torso);
  mesh(new THREE.BoxGeometry(0.46, 0.06, 0.27), suit, 0, 0.1, 0, torso);
  for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.03, 0.36, 0.01), glow, s * 0.12, 0.3, -0.135, torso);
  mesh(new THREE.BoxGeometry(0.3, 0.3, 0.12), suit, 0, 0.3, 0.18, torso);           // pack
  mesh(new THREE.BoxGeometry(0.22, 0.03, 0.01), glow, 0, 0.38, 0.245, torso);
  const flagMount = new THREE.Group(); flagMount.position.set(0, 0.3, 0.26); torso.add(flagMount);
  const head = new THREE.Group(); head.position.y = 0.6; torso.add(head);
  mesh(new THREE.SphereGeometry(0.15, 16, 12), suit, 0, 0.1, 0, head).scale.set(1, 1.08, 1.05);
  mesh(new THREE.BoxGeometry(0.26, 0.07, 0.1), visor, 0, 0.12, -0.11, head);
  mesh(new THREE.BoxGeometry(0.03, 0.12, 0.24), glow, 0, 0.24, 0.02, head);           // crest
  // arms (hold the tagger; the left one throws the hook)
  const aim = new THREE.Group(); aim.position.y = 0.44; torso.add(aim);
  const R = [0.25, 0, 0], RE = [0.2, -0.1, -0.22], RH = [0.08, -0.06, -0.44];
  limb(aim, R, RE, 0.055, jacket); limb(aim, RE, RH, 0.048, jacket);
  mesh(new THREE.SphereGeometry(0.05, 10, 8), skin, ...RH, aim);
  const gun = taggerModel(T.hex); gun.position.set(0.08, -0.04, -0.46); aim.add(gun);
  const leftArm = new THREE.Group(); leftArm.position.set(-0.25, 0, 0); aim.add(leftArm);
  limb(leftArm, [0, 0, 0], [0.02, -0.12, -0.24], 0.055, jacket); limb(leftArm, [0.02, -0.12, -0.24], [0.06, -0.08, -0.48], 0.048, jacket);
  mesh(new THREE.BoxGeometry(0.1, 0.1, 0.16), skin, 0.06, -0.08, -0.46, leftArm);    // hook gauntlet
  mesh(new THREE.BoxGeometry(0.105, 0.02, 0.1), glow, 0.06, -0.02, -0.46, leftArm);
  return { root, body, hips, torso, head, aim, legs, leftArm, flagMount };
}

/** Team flag: pole + waving cloth (vertex animation). */
function buildFlag(team) {
  const T = TEAMS[team];
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 8), new THREE.MeshStandardMaterial({ color: 0xc8d0e0, metalness: 0.9, roughness: 0.2 }));
  pole.position.y = 1.1; g.add(pole);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), new THREE.MeshStandardMaterial({ color: T.hex, emissive: T.hex, emissiveIntensity: 3 }));
  tip.position.y = 2.22; g.add(tip);
  const clothGeo = new THREE.PlaneGeometry(1.1, 0.7, 14, 8);
  clothGeo.translate(0.55, 0, 0);
  const clothTex = canvasTex(256, 160, (c, w, h) => {
    c.fillStyle = css(T.hex); c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(0,0,0,.35)'; for (let y = 0; y < h; y += 8) c.fillRect(0, y, w, 3);
    c.fillStyle = '#fff'; c.font = 'bold 64px Trebuchet MS, sans-serif'; c.textAlign = 'center'; c.fillText(team ? '◆' : '✦', w / 2, h / 2 + 24);
  }, false);
  const cloth = new THREE.Mesh(clothGeo, new THREE.MeshStandardMaterial({ map: clothTex, emissive: T.hex, emissiveIntensity: 0.9, side: THREE.DoubleSide, roughness: 0.6 }));
  cloth.position.set(0.03, 1.8, 0); g.add(cloth);
  const light = new THREE.PointLight(T.hex, 25, 7, 1.8); light.position.y = 1.6; g.add(light);
  return { group: g, cloth, base: clothGeo.attributes.position.array.slice(), light };
}

export class Renderer3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.autoClear = false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(88, 16 / 9, 0.05, 600);
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(62, 16 / 9, 0.01, 10);
    this.time = 0;
    this.shake = 0;
    this.players = new Map();
    this.beams = [];
    this.flashes = [];
    this.debris = [];
    this.trails = new Map();
    this.tex = {};
    for (const k of Object.keys(TEX)) this.tex[k] = TEX[k]();
    this.mats = {};
    this.buildEnvironment();
    this.flashPool = [0, 1, 2].map(() => { const l = new THREE.PointLight(0xffffff, 0, 5, 2); this.scene.add(l); return l; });
    this.flashNext = 0;
    this.buildParticles();
    this.buildRain();
    this.buildViewmodel();
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(320, r.width | 0), h = Math.max(180, r.height | 0);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = this.vmCamera.aspect = w / h;
    this.camera.updateProjectionMatrix(); this.vmCamera.updateProjectionMatrix();
  }

  /** Reflections: an environment map baked from a tiny scene of neon panels and a city glow. */
  buildEnvironment() {
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x07040f);
    const panel = (color, x, y, z, w, h, ry = 0) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.rotation.y = ry; env.add(m);
    };
    panel(0xff2fb4, -8, 3, 0, 6, 2, Math.PI / 2); panel(0x22e6ff, 8, 3, 0, 6, 2, -Math.PI / 2);
    panel(0xffb02a, 0, 6, -9, 8, 1); panel(0x6c5cff, 0, 2, 9, 10, 3, Math.PI);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: 0x2a0d3a }));
    glow.rotation.x = Math.PI / 2; glow.position.y = 12; env.add(glow);
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(env, 0.04).texture;
    pm.dispose();
  }

  material(name) {
    if (!this.mats[name]) {
      const def = MATS[name] || MATS.parapet;
      const mat = new THREE.MeshStandardMaterial({ map: this.tex[def.tex], roughness: def.rough, metalness: def.metal, envMapIntensity: 1.1 });
      if (def.roughMap) { mat.roughnessMap = this.tex.roofRough; mat.envMapIntensity = 1.6; }
      if (name === 'ramp') mat.side = THREE.DoubleSide;
      if (def.glow) { mat.emissive = new THREE.Color(0xffffff); mat.emissiveMap = this.tex[def.tex]; mat.emissiveIntensity = def.glow; }
      this.mats[name] = mat;
    }
    return this.mats[name];
  }

  // ---------- the arena
  setMap(def) {
    if (this.map === def) return;
    this.map = def;
    if (this.mapGroup) this.scene.remove(this.mapGroup);
    for (const m of this.flagModels || []) this.scene.remove(m.group);
    this.mapGroup = new THREE.Group();
    this.scene.add(this.mapGroup);
    const G = this.mapGroup, th = def.THEME;

    this.scene.background = canvasTex(16, 512, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, css(th.sky[0])); gr.addColorStop(0.55, css(th.sky[1])); gr.addColorStop(0.78, css(th.sky[2])); gr.addColorStop(1, css(th.bg));
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }, false);
    this.scene.fog = new THREE.Fog(th.fogColor, th.fog[0], th.fog[1]);
    this.rain.visible = th.rain !== false;
    const roof = this.material('roof');           // puddles only when it rains
    roof.roughnessMap = th.rain !== false ? this.tex.roofRough : null; roof.envMapIntensity = th.rain !== false ? 1.6 : 0.6; roof.needsUpdate = true;
    this.renderer.toneMappingExposure = th.exposure;
    G.add(new THREE.HemisphereLight(th.hemi[0], th.hemi[1], th.hemi[2]));
    G.add(new THREE.AmbientLight(0xffffff, th.ambient));
    const sun = new THREE.DirectionalLight(th.sun[0], th.sun[1]); sun.position.set(th.sun[2], th.sun[3], th.sun[4]); G.add(sun);
    for (const L of def.LIGHTS) { const l = new THREE.PointLight(L.color, L.power * 30, L.range, 1.6); l.position.set(...L.pos); G.add(l); }
    for (const [color, x, y, z, sx, sy, sz] of def.NEON) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 3 }));
      m.position.set(x, y, z); G.add(m);
    }

    // static boxes merged per material; tall roof boxes get window facades on their sides
    const groups = {};
    const push = (mat, b, faces) => { (groups[mat] = groups[mat] || { pos: [], nor: [], uv: [] }); pushBox(groups[mat], b, (MATS[mat] || MATS.parapet).tile, faces); };
    let adSeed = 0;
    for (const b of def.BOXES) {
      const mat = b[6];
      if (mat === 'roof') { push('roof', b, [2]); push('facade', b, [0, 1, 4, 5]); continue; }
      if (mat === 'glass' || mat === 'glassrail') {
        const [x0, y0, z0, x1, y1, z1] = b;
        const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), new THREE.MeshStandardMaterial({
          color: mat === 'glass' ? 0x6ad8ff : 0x9fe8ff, transparent: true, opacity: mat === 'glass' ? 0.32 : 0.22, roughness: 0.05, metalness: 0.9, envMapIntensity: 2, depthWrite: false }));
        m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); G.add(m);
        const edge = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: 0x9fefff, transparent: true, opacity: 0.6 }));
        edge.position.copy(m.position); G.add(edge);
        continue;
      }
      if (mat === 'billboard' || mat === 'sign') {
        const [x0, y0, z0, x1, y1, z1] = b;
        const ad = new THREE.MeshStandardMaterial({ map: adTexture(adSeed), emissive: 0xffffff, emissiveMap: adTexture(adSeed++), emissiveIntensity: 1.3, roughness: 0.4 });
        const frame = this.material('pylon');
        const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), [ad, ad, frame, frame, frame, frame]);
        m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); G.add(m);
        continue;
      }
      push(mat, b);
    }
    for (const [mat, arr] of Object.entries(groups)) G.add(new THREE.Mesh(geometryFrom(arr), this.material(mat)));

    // ramps (wedges) with neon side strips
    const world = RTMove.makeWorld(def);
    for (const r of world.ramps) {
      G.add(new THREE.Mesh(rampGeometry(r, MATS.ramp.tile), this.material('ramp')));
      const len = r.axis === 'x' ? r.x1 - r.x0 : r.z1 - r.z0, rise = r.y1 - r.low, ang = Math.atan2(rise, len);
      for (const side of [0, 1]) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, Math.hypot(len, rise)), new THREE.MeshStandardMaterial({ color: 0x9fd8ff, emissive: 0x9fd8ff, emissiveIntensity: 2 }));
        if (r.axis === 'z') {
          strip.position.set(side ? r.x1 - 0.05 : r.x0 + 0.05, (r.low + r.y1) / 2 + 0.03, (r.z0 + r.z1) / 2);
          strip.rotation.x = r.dir > 0 ? ang : -ang;
        } else {
          strip.rotation.y = Math.PI / 2;
          strip.position.set((r.x0 + r.x1) / 2, (r.low + r.y1) / 2 + 0.03, side ? r.z1 - 0.05 : r.z0 + 0.05);
          strip.rotation.z = 0; strip.rotateX(r.dir > 0 ? -ang : ang);
        }
        G.add(strip);
      }
    }

    // jump pads: chevron discs + a column of light
    this.padMeshes = world.pads.map(pd => {
      const w = pd.x1 - pd.x0, d = pd.z1 - pd.z0, g = new THREE.Group();
      const tex = this.tex.pad.clone(); tex.needsUpdate = true; tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      const top = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.6, transparent: true }));
      top.rotation.x = -Math.PI / 2;
      const dir = Math.atan2(pd.v[0], pd.v[2]);
      top.rotation.z = dir + Math.PI;
      top.position.y = 0.02; g.add(top);
      const col = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(w, d) * 0.45, Math.min(w, d) * 0.55, 3, 20, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x22e6ff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      col.position.y = 1.5; g.add(col);
      g.position.set((pd.x0 + pd.x1) / 2, pd.y, (pd.z0 + pd.z1) / 2);
      G.add(g);
      return { g, tex, col };
    });

    // flag home pads
    for (const f of def.FLAGS) {
      const T = TEAMS[f.team];
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.25, 40), new THREE.MeshBasicMaterial({ color: T.hex, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(f.pos[0], f.pos[1] + 0.02, f.pos[2]); G.add(ring);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(1.0, 40), new THREE.MeshStandardMaterial({ color: T.dark, emissive: T.hex, emissiveIntensity: 0.25, roughness: 0.2, metalness: 0.8 }));
      disc.rotation.x = -Math.PI / 2; disc.position.set(f.pos[0], f.pos[1] + 0.015, f.pos[2]); G.add(disc);
    }
    this.flagModels = def.FLAGS.map(f => { const m = buildFlag(f.team); this.scene.add(m.group); return m; });

    this.buildCity(G);

    // colliders for cosmetic debris
    for (const b of this.staticBodies || []) this.world.removeBody(b);
    this.staticBodies = [];
    for (const b of def.BOXES) {
      const [x0, y0, z0, x1, y1, z1] = b;
      if (y1 - y0 > 30) {               // buildings: only their top slab matters
        const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3((x1 - x0) / 2, 1, (z1 - z0) / 2)) });
        body.position.set((x0 + x1) / 2, y1 - 1, (z0 + z1) / 2); this.world.addBody(body); this.staticBodies.push(body);
        continue;
      }
      const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2)) });
      body.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      this.world.addBody(body); this.staticBodies.push(body);
    }
  }

  /** The city around the arena: skyline, holo ads, aviation lights, traffic, the street below. */
  buildCity(G) {
    const arr = { pos: [], nor: [], uv: [] };
    const tops = [];
    for (let i = 0; i < 170; i++) {
      const a = rnd() * Math.PI * 2, r = 55 + rnd() * 150;
      const x = Math.sin(a) * r * 0.85, z = Math.cos(a) * r * 1.15;
      if (Math.abs(x) < 34 && Math.abs(z) < 66) continue;
      const w = 8 + rnd() * 18, d = 8 + rnd() * 18, h = -10 + rnd() * rnd() * 120;
      pushBox(arr, [x - w / 2, -70, z - d / 2, x + w / 2, h, z + d / 2], 7, [0, 1, 2, 4, 5]);
      tops.push([x, h, z, w, d]);
    }
    const city = new THREE.Mesh(geometryFrom(arr), new THREE.MeshStandardMaterial({ map: this.tex.facade, emissive: 0xffffff, emissiveMap: this.tex.facade, emissiveIntensity: 0.8, roughness: 0.7, metalness: 0.2 }));
    G.add(city);
    // aviation lights on the tallest towers, holo ads on some
    const red = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
    this.blinkers = [];
    tops.sort((a, b) => b[1] - a[1]).slice(0, 26).forEach(([x, h, z, w, d], i) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), red); m.position.set(x, h + 0.6, z); G.add(m); this.blinkers.push(m);
      if (i % 3 === 0) {
        const tex = adTexture(i);
        const ad = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.9, w * 0.45), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
        ad.position.set(x, h - w * 0.4, z);
        ad.lookAt(0, h - w * 0.4, 0);
        const dir = new THREE.Vector3(-x, 0, -z).normalize();
        ad.position.addScaledVector(dir, d / 2 + 0.6);
        G.add(ad);
      }
    });
    // the street far below, glowing through the rain
    const street = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshStandardMaterial({ color: 0x0a0812, emissive: 0x1a0a24, roughness: 0.2, metalness: 0.6 }));
    street.rotation.x = -Math.PI / 2; street.position.y = -60; G.add(street);
    // flying traffic: little light pairs on looping lanes
    const n = 140;
    const geo = new THREE.BufferGeometry();
    this.traffic = { pos: new Float32Array(n * 3), lanes: [] };
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const lane = { r: 50 + rnd() * 120, y: -30 + rnd() * 70, a: rnd() * Math.PI * 2, s: (0.05 + rnd() * 0.12) * (rnd() < 0.5 ? -1 : 1), sq: 0.7 + rnd() * 0.6 };
      this.traffic.lanes.push(lane);
      const c = new THREE.Color([0xffe0a0, 0xff3050, 0x9fd8ff, 0xff8ad8][i % 4]);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.traffic.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.6, map: this.tex.soft, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    pts.frustumCulled = false;
    this.traffic.geo = geo;
    G.add(pts);
  }

  // ---------- particles
  buildParticles() {
    const make = (n, size, blending) => {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(n * 3).fill(-999), col = new Float32Array(n * 3);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size, map: this.tex.soft, vertexColors: true, transparent: true, depthWrite: false, blending, sizeAttenuation: true }));
      pts.frustumCulled = false;
      this.scene.add(pts);
      return { pts, pos, col, n, vel: new Float32Array(n * 3), life: new Float32Array(n), max: new Float32Array(n), grav: new Float32Array(n), base: new Float32Array(n * 3), next: 0 };
    };
    this.sparks = make(900, 0.12, THREE.AdditiveBlending);
    this.glow = make(700, 0.5, THREE.AdditiveBlending);
  }

  emit(sys, x, y, z, vx, vy, vz, life, grav, r, g, b) {
    const i = sys.next; sys.next = (sys.next + 1) % sys.n;
    sys.pos[i * 3] = x; sys.pos[i * 3 + 1] = y; sys.pos[i * 3 + 2] = z;
    sys.vel[i * 3] = vx; sys.vel[i * 3 + 1] = vy; sys.vel[i * 3 + 2] = vz;
    sys.life[i] = life; sys.max[i] = life; sys.grav[i] = grav;
    sys.base[i * 3] = r; sys.base[i * 3 + 1] = g; sys.base[i * 3 + 2] = b;
  }

  stepParticles(sys, dt, drag) {
    const k = Math.pow(drag, dt);
    for (let i = 0; i < sys.n; i++) {
      if (sys.life[i] <= 0) continue;
      sys.life[i] -= dt;
      if (sys.life[i] <= 0) { sys.pos[i * 3 + 1] = -999; continue; }
      sys.vel[i * 3 + 1] -= sys.grav[i] * dt;
      sys.vel[i * 3] *= k; sys.vel[i * 3 + 1] *= k; sys.vel[i * 3 + 2] *= k;
      sys.pos[i * 3] += sys.vel[i * 3] * dt; sys.pos[i * 3 + 1] += sys.vel[i * 3 + 1] * dt; sys.pos[i * 3 + 2] += sys.vel[i * 3 + 2] * dt;
      const f = sys.life[i] / sys.max[i];
      sys.col[i * 3] = sys.base[i * 3] * f; sys.col[i * 3 + 1] = sys.base[i * 3 + 1] * f; sys.col[i * 3 + 2] = sys.base[i * 3 + 2] * f;
    }
    sys.pts.geometry.attributes.position.needsUpdate = true;
    sys.pts.geometry.attributes.color.needsUpdate = true;
  }

  /** Rain: streaks in a box that follows the camera. */
  buildRain() {
    const n = 2200;
    this.rainN = n;
    this.rainPos = new Float32Array(n * 6);
    this.rainSeed = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { this.rainSeed[i * 3] = rnd() * 50 - 25; this.rainSeed[i * 3 + 1] = rnd() * 30; this.rainSeed[i * 3 + 2] = rnd() * 50 - 25; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x9fb8ff, transparent: true, opacity: 0.32, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);
  }

  updateRain(cam) {
    const t = this.time, P = this.rainPos, S = this.rainSeed;
    for (let i = 0; i < this.rainN; i++) {
      const fall = (S[i * 3 + 1] - t * 26) % 30;
      const y = cam.y - 12 + (fall < 0 ? fall + 30 : fall);
      const x = cam.x + ((S[i * 3] - cam.x * 0) % 50), z = cam.z + S[i * 3 + 2];
      P[i * 6] = x; P[i * 6 + 1] = y; P[i * 6 + 2] = z;
      P[i * 6 + 3] = x + 0.12; P[i * 6 + 4] = y + 0.7; P[i * 6 + 5] = z + 0.05;
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
  }

  // ---------- runners
  ensurePlayer(id, team, name) {
    let pm = this.players.get(id);
    if (pm && pm.team === team) return pm;
    if (pm) this.removePlayer(id);
    const ch = buildRunner(team);
    const c = document.createElement('canvas'); c.width = 256; c.height = 48;
    const x = c.getContext('2d'); x.font = 'bold 26px Trebuchet MS, sans-serif'; x.textAlign = 'center';
    x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(0, 6, 256, 36);
    x.fillStyle = TEAMS[team].color; x.fillText(name, 128, 34);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
    label.scale.set(1.3, 0.24, 1); label.position.y = 2.25; ch.root.add(label);
    this.scene.add(ch.root);
    pm = { ...ch, label, team, phase: 0, lastY: 0, air: 0, kick: 0, alive: true, roll: 0, slideK: 0 };
    this.players.set(id, pm);
    return pm;
  }

  removePlayer(id) {
    const pm = this.players.get(id);
    if (!pm) return;
    this.scene.remove(pm.root);
    pm.root.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    this.players.delete(id);
  }

  updatePlayer(id, s, dt) {
    const pm = this.players.get(id);
    if (!pm) return;
    const g = pm.root;
    if (!s.alive) { g.visible = false; pm.alive = false; return; }
    if (!pm.alive) { pm.alive = true; g.position.set(s.x, s.y, s.z); }
    g.visible = !(s.bits & PF.PROTECT) || Math.sin(this.time * 30) > -0.3;
    const speed = s.speed != null ? s.speed : Math.hypot(s.x - g.position.x, s.z - g.position.z) / Math.max(dt, 1e-3);
    const vy = (s.y - pm.lastY) / Math.max(dt, 1e-3);
    pm.lastY = s.y;
    const air = !(s.bits & (PF.SLIDE | PF.WALLRUN)) && Math.abs(vy) > 1.2;
    pm.air += ((air ? 1 : 0) - pm.air) * Math.min(1, dt * 8);
    g.position.set(s.x, s.y, s.z);
    g.rotation.set(0, s.yaw, 0, 'YXZ');
    const sliding = !!(s.bits & PF.SLIDE), crouch = !!(s.bits & PF.CROUCH), wall = !!(s.bits & PF.WALLRUN);
    pm.slideK += ((sliding ? 1 : 0) - pm.slideK) * Math.min(1, dt * 10);
    // run cycle
    const amt = Math.min(1, speed / 7) * (1 - pm.slideK);
    pm.phase += Math.min(speed, 12) * dt * 1.5;
    for (let i = 0; i < 2; i++) {
      const ph = pm.phase + i * Math.PI, L = pm.legs[i];
      const walk = Math.sin(ph) * 0.9 * amt, bend = Math.max(0, -Math.cos(ph)) * 1.2 * amt;
      L.thigh.rotation.x = (walk * (1 - pm.air) - 0.6 * pm.air) * (1 - pm.slideK) + (i ? -1.35 : -1.0) * pm.slideK - (crouch && !sliding ? 0.7 : 0);
      L.knee.rotation.x = (bend * (1 - pm.air) + 1.1 * pm.air) * (1 - pm.slideK) + (i ? 0.2 : 1.1) * pm.slideK + (crouch && !sliding ? 1.2 : 0);
    }
    // slide: lean back and drop; crouch: drop; wall run: roll toward the wall
    pm.body.position.y = -0.55 * pm.slideK - (crouch && !sliding ? 0.45 : 0);
    pm.body.rotation.x = 0.55 * pm.slideK - 0.12 * amt;
    const wantRoll = wall ? 0.35 * (Math.sin(this.time * 0) + 1) * (pm.side || 1) : 0;
    pm.roll += (wantRoll - pm.roll) * Math.min(1, dt * 8);
    pm.body.rotation.z = pm.roll;
    pm.torso.position.y = 1.02 + Math.abs(Math.sin(pm.phase)) * 0.04 * amt;
    pm.aim.rotation.x = s.pitch;
    pm.head.rotation.x = s.pitch * 0.5;
    pm.leftArm.rotation.x = (s.bits & PF.HOOK) ? -0.9 : 0;
    if (s.bits & PF.FIRED) pm.kick = 1;
    pm.kick = Math.max(0, pm.kick - dt * 8);
    pm.aim.position.z = pm.kick * 0.05;
  }

  /** Which way to lean while wall running: the side the wall is on (from the local frame). */
  setWallSide(id, side) { const pm = this.players.get(id); if (pm) pm.side = side; }

  // ---------- viewmodel
  buildViewmodel() {
    this.vmScene.add(new THREE.HemisphereLight(0xb0a0ff, 0x301030, 1.2));
    const key = new THREE.DirectionalLight(0xffffff, 1.3); key.position.set(1, 2, 1); this.vmScene.add(key);
    this.vmTeamLight = new THREE.PointLight(0xff2fb4, 1.5, 2); this.vmTeamLight.position.set(0, 0.2, 0.2); this.vmScene.add(this.vmTeamLight);
    this.vm = new THREE.Group(); this.vmScene.add(this.vm);
    this.vmLeft = new THREE.Group(); this.vmScene.add(this.vmLeft);
    this.vmFlash = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.soft, color: 0xffffff, blending: THREE.AdditiveBlending, depthTest: false, transparent: true }));
    this.vmFlash.scale.set(0.22, 0.22, 1); this.vmFlash.visible = false;
    this.vmState = { kick: 0, bob: 0, flash: 0, team: -1, hook: 0, land: 0 };
  }

  setViewTeam(team) {
    if (this.vmState.team === team) return;
    this.vmState.team = team;
    this.vm.clear(); this.vmLeft.clear();
    const T = TEAMS[team];
    const sleeve = new THREE.MeshStandardMaterial({ color: team ? 0x10323a : 0x3a1030, roughness: 0.45, metalness: 0.3 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x22252e, roughness: 0.5, metalness: 0.5 });
    const glow = new THREE.MeshStandardMaterial({ color: T.hex, emissive: T.hex, emissiveIntensity: 0.8 });
    const gun = taggerModel(T.hex); this.vm.add(gun);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.1), glove); hand.position.set(0, -0.07, 0.03); this.vm.add(hand);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.24, 4, 10), sleeve); arm.rotation.x = Math.PI / 2; arm.position.set(0.02, -0.1, 0.2); this.vm.add(arm);
    this.vmFlash.position.set(0, 0.02, -0.36); this.vm.add(this.vmFlash);
    // left: the hook gauntlet
    const larm = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.26, 4, 10), sleeve); larm.rotation.x = Math.PI / 2; larm.position.set(0, -0.02, 0.18); this.vmLeft.add(larm);
    const gaunt = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.1, 0.18), glove); gaunt.position.set(0, 0, -0.02); this.vmLeft.add(gaunt);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.012, 0.12), glow); stripe.position.set(0, 0.05, -0.02); this.vmLeft.add(stripe);
    const claw = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.08, 4), new THREE.MeshStandardMaterial({ color: 0xffb02a, emissive: 0xff8a00, emissiveIntensity: 1.5 }));
    claw.rotation.x = -Math.PI / 2; claw.position.set(0, 0.01, -0.14); this.vmLeft.add(claw);
    this.vmClaw = claw;
    this.vmTeamLight.color.setHex(T.hex);
  }

  vmFire() { this.vmState.kick = 1; this.vmState.flash = 0.05; }
  vmLand(speed) { this.vmState.land = Math.min(1, speed / 14); }

  // ---------- effects
  tagBeam(o, e, color, hit) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...o), new THREE.Vector3(...e)]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending }));
    this.scene.add(line);
    this.beams.push({ obj: line, life: 0.12, max: 0.12 });
    const c = new THREE.Color(color);
    for (let i = 0; i < (hit ? 18 : 8); i++) this.emit(this.sparks, e[0], e[1], e[2], (Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6, 0.4, 10, c.r, c.g, c.b);
    this.emit(this.glow, e[0], e[1], e[2], 0, 0, 0, 0.15, 0, c.r, c.g, c.b);
    const l = this.flashPool[this.flashNext++ % this.flashPool.length];
    l.color.setHex(color); l.intensity = 40; l.position.set(...o);
    this.flashes.push({ obj: l, life: 0.05 });
  }

  /** A runner shatters into glowing cubes (tagged) - or just a fading streak when they fall. */
  derez(x, y, z, team) {
    const T = TEAMS[team], c = new THREE.Color(T.hex);
    const mat = new THREE.MeshStandardMaterial({ color: T.hex, emissive: T.hex, emissiveIntensity: 2, transparent: true });
    for (let i = 0; i < 16; i++) {
      const s = 0.08 + Math.random() * 0.1;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), mat);
      this.scene.add(mesh);
      const body = new CANNON.Body({ mass: 0.3, shape: new CANNON.Box(new CANNON.Vec3(s / 2, s / 2, s / 2)) });
      body.position.set(x + (Math.random() - 0.5) * 0.5, y + 0.3 + Math.random() * 1.5, z + (Math.random() - 0.5) * 0.5);
      body.velocity.set((Math.random() - 0.5) * 7, 2 + Math.random() * 5, (Math.random() - 0.5) * 7);
      body.angularVelocity.set(Math.random() * 10, Math.random() * 10, Math.random() * 10);
      this.world.addBody(body);
      this.debris.push({ mesh, body, life: 2.2 + Math.random(), mat });
    }
    for (let i = 0; i < 40; i++) this.emit(this.sparks, x, y + 1, z, (Math.random() - 0.5) * 8, Math.random() * 6, (Math.random() - 0.5) * 8, 0.8, 6, c.r, c.g, c.b);
    for (let i = 0; i < 10; i++) this.emit(this.glow, x, y + Math.random() * 1.8, z, 0, 0.6, 0, 0.6, 0, c.r, c.g, c.b);
  }

  padBurst(i) {
    const p = this.padMeshes && this.padMeshes[i];
    if (!p) return;
    const { x, y, z } = p.g.position;
    for (let k = 0; k < 30; k++) this.emit(this.sparks, x + (Math.random() - 0.5) * 2, y + 0.1, z + (Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * 2, 6 + Math.random() * 6, (Math.random() - 0.5) * 2, 0.6, 8, 0.2, 0.9, 1);
    p.flash = 1;
  }

  wallSparks(x, y, z, color) {
    const c = new THREE.Color(color);
    for (let k = 0; k < 10; k++) this.emit(this.sparks, x, y, z, (Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3, 0.3, 8, c.r, c.g, c.b);
  }

  // ---------- per frame
  /**
   * view: {dt, cam {x,y,z,yaw,pitch,roll}, fov, players[], flags[{state,x,y,z,carrier}], me {team, speed, moving, onGround, hook, hookPt},
   *        showViewmodel, cables [{from, to, team}]}
   */
  render(view) {
    const dt = Math.min(0.05, view.dt);
    this.time += dt;
    const cam = this.camera;
    cam.position.set(view.cam.x, view.cam.y, view.cam.z);
    cam.rotation.order = 'YXZ';
    cam.rotation.set(view.cam.pitch, view.cam.yaw, view.cam.roll || 0);
    if (this.shake > 0.01) {
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.2;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.2;
      this.shake *= Math.pow(0.02, dt);
    }
    const fov = view.fov || 88;
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 6); cam.updateProjectionMatrix(); }

    // runners
    const seen = new Set();
    for (const s of view.players) { seen.add(s.id); this.updatePlayer(s.id, s, dt); }
    for (const id of [...this.players.keys()]) if (!seen.has(id)) this.removePlayer(id);

    // flags: home, carried on a back, or lying on the roof
    if (this.flagModels) view.flags.forEach((f, i) => {
      const m = this.flagModels[i];
      if (!m) return;
      const carrier = f.state === FLAG.CARRIED ? this.players.get(f.carrier) : null;
      if (f.state === FLAG.CARRIED && f.local) { m.group.visible = false; return; }
      m.group.visible = true;
      if (carrier && carrier.root.visible) {
        const p = new THREE.Vector3(0, 0, 0); carrier.flagMount.getWorldPosition(p);
        m.group.position.set(p.x, p.y - 0.9, p.z);
        m.group.rotation.set(0.25, carrier.root.rotation.y + Math.PI / 2, 0);
        m.group.scale.setScalar(0.75);
      } else {
        m.group.position.set(f.x, f.y, f.z);
        m.group.rotation.set(f.state === FLAG.DROPPED ? 0.5 : 0, this.time * (f.state === FLAG.DROPPED ? 1.5 : 0.25), 0);
        m.group.scale.setScalar(1);
      }
      // wave the cloth
      const pos = m.cloth.geometry.attributes.position, b = m.base;
      for (let k = 0; k < pos.count; k++) {
        const x = b[k * 3];
        pos.array[k * 3 + 2] = Math.sin(x * 5 - this.time * (carrier ? 14 : 6) + k * 0.02) * 0.08 * x * 1.6;
        pos.array[k * 3 + 1] = b[k * 3 + 1] + Math.sin(x * 4 - this.time * 5) * 0.02 * x;
      }
      pos.needsUpdate = true;
      m.light.intensity = 25 + Math.sin(this.time * 4) * 6;
    });

    // carrier trails: a ribbon of glow behind whoever has a flag
    for (const s of view.players) {
      if (!(s.bits & PF.CARRY) || !s.alive) { this.trails.delete(s.id); continue; }
      const enemyTeam = 1 - (s.team | 0), c = new THREE.Color(TEAMS[enemyTeam].hex);
      this.emit(this.glow, s.x + (Math.random() - 0.5) * 0.2, s.y + 1.3 + Math.random() * 0.4, s.z + (Math.random() - 0.5) * 0.2, 0, 0.1, 0, 1.4, 0, c.r, c.g, c.b);
      if (Math.random() < 0.5) this.emit(this.sparks, s.x, s.y + 1.5, s.z, (Math.random() - 0.5), 0.5, (Math.random() - 0.5), 0.6, 2, c.r, c.g, c.b);
    }

    // hook cables
    if (!this.cableGroup) { this.cableGroup = new THREE.Group(); this.scene.add(this.cableGroup); }
    this.cableGroup.clear();
    for (const cbl of view.cables || []) {
      const pts = [];
      const a = new THREE.Vector3(...cbl.from), b = new THREE.Vector3(...cbl.to);
      for (let k = 0; k <= 12; k++) {
        const t = k / 12, p = a.clone().lerp(b, t);
        p.y -= Math.sin(t * Math.PI) * 0.15;
        pts.push(p);
      }
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffc04a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending }));
      this.cableGroup.add(line);
      if (Math.random() < 0.4) this.emit(this.sparks, b.x, b.y, b.z, (Math.random() - 0.5) * 2, Math.random(), (Math.random() - 0.5) * 2, 0.25, 6, 1, 0.75, 0.3);
    }

    // pads, city, rain
    if (this.padMeshes) for (const p of this.padMeshes) {
      p.tex.offset.y = (this.time * 1.2) % 1;
      p.flash = Math.max(0, (p.flash || 0) - dt * 2);
      p.col.material.opacity = 0.1 + p.flash * 0.35 + Math.sin(this.time * 3) * 0.03;
    }
    if (this.traffic) {
      const P = this.traffic.pos;
      this.traffic.lanes.forEach((L, i) => { L.a += L.s * dt; P[i * 3] = Math.sin(L.a) * L.r; P[i * 3 + 1] = L.y; P[i * 3 + 2] = Math.cos(L.a) * L.r * L.sq; });
      this.traffic.geo.attributes.position.needsUpdate = true;
    }
    if (this.blinkers) { const on = Math.sin(this.time * 3) > 0.6; for (const b of this.blinkers) b.visible = on; }
    this.updateRain(view.cam);

    // transient effects
    for (const b of this.beams) { b.life -= dt; b.obj.material.opacity = Math.max(0, b.life / b.max); if (b.life <= 0) { this.scene.remove(b.obj); b.obj.geometry.dispose(); } }
    this.beams = this.beams.filter(b => b.life > 0);
    for (const f of this.flashes) { f.life -= dt; if (f.life <= 0) f.obj.intensity = 0; }
    this.flashes = this.flashes.filter(f => f.life > 0);
    this.stepParticles(this.sparks, dt, 0.3);
    this.stepParticles(this.glow, dt, 0.6);
    this.world.step(1 / 60, dt, 3);
    for (const d of this.debris) {
      d.life -= dt;
      d.mesh.position.copy(d.body.position); d.mesh.quaternion.copy(d.body.quaternion);
      if (d.life < 0.6) d.mesh.scale.setScalar(Math.max(0.01, d.life / 0.6));
    }
    for (const d of this.debris.filter(d => d.life <= 0)) { this.world.removeBody(d.body); this.scene.remove(d.mesh); d.mesh.geometry.dispose(); }
    this.debris = this.debris.filter(d => d.life > 0);

    // viewmodel
    const me = view.me || {}, s = this.vmState;
    if (me.team != null) this.setViewTeam(me.team);
    s.kick *= Math.pow(0.0004, dt);
    s.land *= Math.pow(0.002, dt);
    s.hook += ((me.hook ? 1 : 0) - s.hook) * Math.min(1, dt * 14);
    if (me.moving && me.onGround) s.bob += dt * (6 + Math.min(10, me.speed || 0));
    const bobX = Math.sin(s.bob) * 0.014, bobY = Math.abs(Math.cos(s.bob)) * 0.014;
    const slideTilt = me.sliding ? 0.25 : 0;
    this.vm.position.set(0.22 + bobX, -0.2 - bobY - s.land * 0.06, -0.4 + s.kick * 0.06);
    this.vm.rotation.set(s.kick * 0.18, 0, slideTilt);
    this.vmLeft.position.set(-0.24 - bobX, -0.24 - bobY - s.land * 0.06 + s.hook * 0.12, -0.36 - s.hook * 0.12);
    this.vmLeft.rotation.set(s.hook * 0.5, 0, -slideTilt);
    this.vmLeft.visible = true;
    if (this.vmClaw) this.vmClaw.visible = !me.hook;
    s.flash -= dt;
    this.vmFlash.visible = s.flash > 0;

    this.renderer.clear();
    this.renderer.render(this.scene, cam);
    if (view.showViewmodel) { this.renderer.clearDepth(); this.renderer.render(this.vmScene, this.vmCamera); }
  }
}
