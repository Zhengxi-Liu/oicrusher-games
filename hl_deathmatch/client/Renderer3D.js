/**
 * Renderer3D: Three.js scenes for every map (procedural textures, per-map lighting and sky),
 * blocky Minecraft-style characters with skins, the first-person viewmodel, pickups, projectiles and
 * effects; cannon-es drives cosmetic debris (shell casings, splinters, shrapnel) against the map.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as CANNON from 'cannon-es';

const { WEAPONS, PROJ, COLORS, SKINS } = window.HLConst;

// ---------- procedural textures
function canvasTex(size, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const rnd = (() => { let s = 7; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
function speckle(g, n, size, colors, alpha) {
  for (let i = 0; i < n; i++) { g.fillStyle = colors[i % colors.length]; g.globalAlpha = alpha * rnd(); g.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 2, 1 + rnd() * 2); }
  g.globalAlpha = 1;
}
function hazard(g, y, h, s) {
  for (let x = -s; x < s; x += 32) { g.fillStyle = '#e0b52a'; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 16, y); g.lineTo(x + 16 + h, y + h); g.lineTo(x + h, y + h); g.fill(); }
  g.fillStyle = 'rgba(20,20,20,.9)'; g.fillRect(0, y, s, 2); g.fillRect(0, y + h - 2, s, 2);
}
const TEX = {
  concrete: () => canvasTex(256, (g, s) => {
    g.fillStyle = '#6b6a64'; g.fillRect(0, 0, s, s); speckle(g, 2500, s, ['#57564f', '#7d7b73', '#4a4943'], 0.6);
    g.strokeStyle = 'rgba(30,30,28,.55)'; g.lineWidth = 3; g.strokeRect(0, 0, s, s);
    g.fillStyle = 'rgba(0,0,0,.12)'; for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(rnd() * s, rnd() * s, 10 + rnd() * 30, 0, 7); g.fill(); }
  }),
  wall: () => canvasTex(256, (g, s) => {
    g.fillStyle = '#56606a'; g.fillRect(0, 0, s, s); speckle(g, 1500, s, ['#4a535c', '#636e78'], 0.5);
    g.strokeStyle = '#2b3138'; g.lineWidth = 4; g.strokeRect(2, 2, s - 4, s - 4); g.beginPath(); g.moveTo(s / 2, 0); g.lineTo(s / 2, s); g.stroke();
    g.fillStyle = '#a7b0b8'; for (const x of [12, s / 2 - 12, s / 2 + 12, s - 12]) for (const y of [12, s - 12]) { g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); }
    hazard(g, s - 34, 24, s);
  }),
  metal: () => canvasTex(128, (g, s) => {
    g.fillStyle = '#7c838a'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 2) { g.fillStyle = `rgba(255,255,255,${0.03 + rnd() * 0.05})`; g.fillRect(0, y, s, 1); }
    g.strokeStyle = '#3f454b'; g.lineWidth = 3; g.strokeRect(1, 1, s - 2, s - 2);
  }),
  crate: () => canvasTex(128, (g, s) => {
    g.fillStyle = '#8a6a3c'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 16) { g.fillStyle = `rgba(60,40,20,${0.3 + rnd() * 0.3})`; g.fillRect(0, y, s, 2); }
    g.strokeStyle = '#4a3519'; g.lineWidth = 10; g.strokeRect(5, 5, s - 10, s - 10);
    g.beginPath(); g.moveTo(10, 10); g.lineTo(s - 10, s - 10); g.moveTo(s - 10, 10); g.lineTo(10, s - 10); g.lineWidth = 8; g.stroke();
    g.fillStyle = 'rgba(20,10,0,.75)'; g.font = 'bold 13px monospace'; g.fillText('SECTOR C', 30, 68);
  }, false),
  grate: () => canvasTex(128, (g, s) => {
    g.fillStyle = '#2d3136'; g.fillRect(0, 0, s, s);
    g.strokeStyle = '#7a828a'; g.lineWidth = 3;
    for (let i = 0; i <= s; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, s); g.moveTo(0, i); g.lineTo(s, i); g.stroke(); }
  }),
  stair: () => canvasTex(128, (g, s) => {
    g.fillStyle = '#6e737a'; g.fillRect(0, 0, s, s); speckle(g, 600, s, ['#585d63'], 0.6);
    for (let x = -s; x < s; x += 24) { g.fillStyle = '#e8b923'; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 12, 0); g.lineTo(x + 30, 18); g.lineTo(x + 18, 18); g.fill(); }
  }),
  pit: () => canvasTex(256, (g, s) => {
    g.fillStyle = '#3e4a40'; g.fillRect(0, 0, s, s); speckle(g, 3000, s, ['#2f3a31', '#4f5e51', '#1f2620'], 0.7);
    g.strokeStyle = 'rgba(160,255,120,.25)'; g.lineWidth = 2; g.strokeRect(4, 4, s - 8, s - 8);
  }),
  ceiling: () => canvasTex(128, (g, s) => { g.fillStyle = '#3a3e44'; g.fillRect(0, 0, s, s); g.strokeStyle = '#25282c'; g.lineWidth = 4; g.strokeRect(0, 0, s, s); }),
  pillar: () => canvasTex(128, (g, s) => { g.fillStyle = '#8b8a84'; g.fillRect(0, 0, s, s); speckle(g, 700, s, ['#6f6e68', '#9a9992'], 0.5); }),
  rail: () => canvasTex(64, (g, s) => { g.fillStyle = '#c9a227'; g.fillRect(0, 0, s, s); g.fillStyle = '#7d6413'; g.fillRect(0, s / 2 - 2, s, 4); }),
  barrel: () => canvasTex(128, (g, s) => {
    g.fillStyle = '#9b2a1c'; g.fillRect(0, 0, s, s);
    for (const y of [18, s - 22]) { g.fillStyle = '#5c160d'; g.fillRect(0, y, s, 5); }
    g.fillStyle = '#ffd23a'; g.beginPath(); g.moveTo(s / 2, 40); g.lineTo(s / 2 + 22, 82); g.lineTo(s / 2 - 22, 82); g.closePath(); g.fill();
    g.fillStyle = '#111'; g.font = 'bold 26px sans-serif'; g.fillText('!', s / 2 - 5, 76);
  }, false),
  dirt: () => canvasTex(256, (g, s) => {
    g.fillStyle = '#9a7e5c'; g.fillRect(0, 0, s, s); speckle(g, 5000, s, ['#86694a', '#ad9070', '#6f5840', '#c2a684'], 0.7);
    g.fillStyle = 'rgba(70,50,30,.18)'; for (let i = 0; i < 10; i++) { g.beginPath(); g.ellipse(rnd() * s, rnd() * s, 20 + rnd() * 40, 8 + rnd() * 14, rnd() * 3, 0, 7); g.fill(); }
  }),
  brick: () => canvasTex(256, (g, s) => {
    g.fillStyle = '#5a5048'; g.fillRect(0, 0, s, s);
    for (let row = 0; row < 16; row++) for (let col = -1; col < 5; col++) {
      const x = col * 64 + (row % 2) * 32, y = row * 16;
      g.fillStyle = ['#8e4a32', '#9c5638', '#7d4029', '#a3613f'][(row * 7 + col * 3) & 3];
      g.fillRect(x + 2, y + 2, 60, 12);
    }
    speckle(g, 1200, s, ['#000'], 0.15);
  }),
  sandbag: () => canvasTex(128, (g, s) => {
    g.fillStyle = '#6e6046'; g.fillRect(0, 0, s, s);
    for (let row = 0; row < 4; row++) for (let col = -1; col < 3; col++) {
      const x = col * 64 + (row % 2) * 32, y = row * 32;
      g.fillStyle = ['#b3a27a', '#a8966c', '#bcad86'][(row + col + 3) % 3];
      g.beginPath(); g.ellipse(x + 32, y + 16, 30, 13, 0, 0, 7); g.fill();
      g.strokeStyle = 'rgba(80,70,50,.6)'; g.lineWidth = 2; g.beginPath(); g.moveTo(x + 10, y + 16); g.lineTo(x + 54, y + 16); g.stroke();
    }
  }),
  metalfloor: () => canvasTex(128, (g, s) => {
    g.fillStyle = '#4c5156'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 16) for (let x = 0; x < s; x += 16) {
      g.fillStyle = 'rgba(200,210,220,.22)'; g.save(); g.translate(x + 8, y + 8); g.rotate(((x + y) / 16) % 2 ? 0.8 : -0.8); g.fillRect(-5, -1.5, 10, 3); g.restore();
    }
    g.strokeStyle = '#2b2f33'; g.lineWidth = 3; g.strokeRect(0, 0, s, s);
  }),
  reactor: () => canvasTex(128, (g, s) => {
    g.fillStyle = '#123b36'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 32) { g.fillStyle = '#5cffd8'; g.fillRect(6, y + 10, s - 12, 6); g.fillStyle = 'rgba(92,255,216,.35)'; g.fillRect(0, y + 6, s, 14); }
    g.strokeStyle = '#0a1f1c'; g.lineWidth = 4; g.strokeRect(2, 2, s - 4, s - 4);
  }),
  pipe: () => canvasTex(128, (g, s) => {
    g.fillStyle = '#7b8388'; g.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 64) { g.fillStyle = '#d6a623'; g.fillRect(x + 20, 0, 14, s); }
    for (let y = 0; y < s; y += 3) { g.fillStyle = `rgba(255,255,255,${rnd() * 0.06})`; g.fillRect(0, y, s, 1); }
  }),
  tank: () => canvasTex(128, (g, s) => {
    g.fillStyle = '#d7d9d4'; g.fillRect(0, 0, s, s); speckle(g, 400, s, ['#a8aaa5'], 0.6);
    g.fillStyle = '#2e6f9e'; g.fillRect(0, s * 0.4, s, 20);
    g.fillStyle = '#fff'; g.font = 'bold 14px monospace'; g.fillText('COOLANT', 30, s * 0.4 + 15);
  }),
  truck: () => canvasTex(128, (g, s) => {
    g.fillStyle = '#3d5a6e'; g.fillRect(0, 0, s, s); speckle(g, 1500, s, ['#6b4a2e', '#2c4252', '#87613b'], 0.8);
    g.fillStyle = 'rgba(20,20,20,.35)'; g.fillRect(0, s - 30, s, 30);
  }),
  carpet: () => canvasTex(128, (g, s) => { g.fillStyle = '#4a5260'; g.fillRect(0, 0, s, s); speckle(g, 4000, s, ['#3c4350', '#59626f', '#444b58'], 0.8); }),
  plaster: () => canvasTex(256, (g, s) => {
    g.fillStyle = '#c9bea6'; g.fillRect(0, 0, s, s); speckle(g, 1500, s, ['#bcb099', '#d4cab4'], 0.5);
    g.fillStyle = '#5b5248'; g.fillRect(0, s - 18, s, 18);
    g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(0, s / 2, s, 2);
  }),
  ceilingtile: () => canvasTex(128, (g, s) => { g.fillStyle = '#d9d8d2'; g.fillRect(0, 0, s, s); speckle(g, 800, s, ['#bdbcb6'], 0.6); g.strokeStyle = '#9a9994'; g.lineWidth = 3; g.strokeRect(0, 0, s, s); }),
  wood: () => canvasTex(128, (g, s) => {
    g.fillStyle = '#7a5332'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 4) { g.fillStyle = `rgba(${40 + rnd() * 30},${25 + rnd() * 15},10,${0.2 + rnd() * 0.2})`; g.fillRect(0, y, s, 2); }
  }),
  // ---- Snow World
  snow: () => canvasTex(256, (g, s) => {
    g.fillStyle = '#eef3f8'; g.fillRect(0, 0, s, s);
    speckle(g, 5000, s, ['#dfe7f0', '#ffffff', '#d4dde8'], 0.8);
    for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(180,195,215,.18)'; g.beginPath(); g.ellipse(rnd() * s, rnd() * s, 8 + rnd() * 30, 3 + rnd() * 8, rnd() * 3, 0, 7); g.fill(); }
  }),
  snowbank: () => canvasTex(128, (g, s) => { g.fillStyle = '#f4f7fb'; g.fillRect(0, 0, s, s); speckle(g, 1500, s, ['#dfe6ef', '#ffffff'], 0.8); }),
  rockwall: () => canvasTex(256, (g, s) => {
    g.fillStyle = '#7d8590'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 32) for (let x = (y / 32) % 2 ? -32 : 0; x < s; x += 64) {
      const v = 100 + rnd() * 40 | 0; g.fillStyle = `rgb(${v},${v + 6},${v + 14})`; g.fillRect(x + 2, y + 2, 60, 28);        // grey-blue stones
    }
    g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(0, 0, s, 10); speckle(g, 300, s, ['#ffffff'], 0.5);      // snow on top
  }),
  woodfloor: () => canvasTex(128, (g, s) => {
    g.fillStyle = '#8a6440'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 16) { g.fillStyle = `rgb(${120 + rnd() * 30 | 0},${85 + rnd() * 20 | 0},${52 + rnd() * 15 | 0})`; g.fillRect(0, y + 1, s, 14); g.fillStyle = 'rgba(40,25,10,.5)'; g.fillRect(rnd() * s, y + 1, 2, 14); }
    speckle(g, 300, s, ['#ffffff'], 0.35);
  }),
  woodwall: () => canvasTex(128, (g, s) => {
    g.fillStyle = '#7a5532'; g.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 21) { g.fillStyle = `rgb(${110 + rnd() * 30 | 0},${75 + rnd() * 20 | 0},${45 + rnd() * 15 | 0})`; g.fillRect(x + 1, 0, 19, s); }
    g.fillStyle = 'rgba(30,20,10,.6)'; g.fillRect(0, s * 0.2, s, 5); g.fillRect(0, s * 0.75, s, 5);
  }),
  woodcrate: () => canvasTex(128, (g, s) => {
    g.fillStyle = '#9a6e3e'; g.fillRect(0, 0, s, s);
    g.strokeStyle = '#5e3f20'; g.lineWidth = 10; g.strokeRect(5, 5, s - 10, s - 10);
    g.beginPath(); g.moveTo(10, 10); g.lineTo(s - 10, s - 10); g.moveTo(s - 10, 10); g.lineTo(10, s - 10); g.lineWidth = 7; g.stroke();
    g.fillStyle = 'rgba(255,255,255,.8)'; g.fillRect(0, 0, s, 6);
  }),
  cubicle: () => canvasTex(128, (g, s) => { g.fillStyle = '#5b6b7a'; g.fillRect(0, 0, s, s); speckle(g, 2500, s, ['#4e5d6b', '#6a7b8a'], 0.7); g.fillStyle = '#9aa3aa'; g.fillRect(0, 0, s, 6); }),
  rack: () => canvasTex(128, (g, s) => {
    g.fillStyle = '#16181b'; g.fillRect(0, 0, s, s);
    for (let y = 6; y < s; y += 12) {
      g.fillStyle = '#2a2d31'; g.fillRect(4, y, s - 8, 9);
      for (let x = 10; x < s - 10; x += 9) { g.fillStyle = rnd() < 0.5 ? '#3cff7a' : rnd() < 0.5 ? '#ffb02a' : '#1d1f22'; g.fillRect(x, y + 3, 3, 3); }
    }
  }),
  planter: () => canvasTex(128, (g, s) => { g.fillStyle = '#7d7a72'; g.fillRect(0, 0, s, s); g.fillStyle = '#2f6b2c'; g.fillRect(0, 0, s, 40); speckle(g, 900, s, ['#3e8a37', '#25501f'], 0.9); }),
  soft: () => canvasTex(64, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, s, s);
  }, false),
  flash: () => canvasTex(64, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, 'rgba(255,255,230,1)'); r.addColorStop(0.3, 'rgba(255,200,90,.9)'); r.addColorStop(1, 'rgba(255,120,0,0)');
    g.fillStyle = r; g.fillRect(0, 0, s, s);
    g.strokeStyle = 'rgba(255,240,200,.8)'; g.lineWidth = 3;
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; g.beginPath(); g.moveTo(s / 2, s / 2); g.lineTo(s / 2 + Math.cos(a) * s / 2, s / 2 + Math.sin(a) * s / 2); g.stroke(); }
  }, false),
};

const MATS = {
  concrete: { tex: 'concrete', tile: 2, rough: 0.95, metal: 0 },
  wall: { tex: 'wall', tile: 3, rough: 0.7, metal: 0.35 },
  metal: { tex: 'metal', tile: 1.5, rough: 0.5, metal: 0.6 },
  crate: { tex: 'crate', tile: 1.2, rough: 0.85, metal: 0 },
  grate: { tex: 'grate', tile: 1, rough: 0.6, metal: 0.7 },
  stair: { tex: 'stair', tile: 1.2, rough: 0.6, metal: 0.5 },
  pit: { tex: 'pit', tile: 3, rough: 0.9, metal: 0.1 },
  ceiling: { tex: 'ceiling', tile: 2, rough: 0.9, metal: 0.2 },
  pillar: { tex: 'pillar', tile: 2, rough: 0.9, metal: 0 },
  rail: { tex: 'rail', tile: 1, rough: 0.5, metal: 0.6 },
  dirt: { tex: 'dirt', tile: 4, rough: 1, metal: 0 },
  brick: { tex: 'brick', tile: 3, rough: 0.95, metal: 0 },
  sandbag: { tex: 'sandbag', tile: 1.2, rough: 1, metal: 0 },
  metalfloor: { tex: 'metalfloor', tile: 1.5, rough: 0.55, metal: 0.7 },
  reactor: { tex: 'reactor', tile: 2, rough: 0.4, metal: 0.3, glow: 0.9 },
  pipe: { tex: 'pipe', tile: 1.5, rough: 0.45, metal: 0.8 },
  tank: { tex: 'tank', tile: 3, rough: 0.6, metal: 0.4 },
  truck: { tex: 'truck', tile: 2, rough: 0.8, metal: 0.4 },
  carpet: { tex: 'carpet', tile: 1.5, rough: 1, metal: 0 },
  plaster: { tex: 'plaster', tile: 3.6, rough: 0.9, metal: 0 },
  ceilingtile: { tex: 'ceilingtile', tile: 1.2, rough: 0.9, metal: 0 },
  wood: { tex: 'wood', tile: 1, rough: 0.7, metal: 0 },
  snow: { tex: 'snow', tile: 6, rough: 0.85, metal: 0 },
  snowbank: { tex: 'snowbank', tile: 2, rough: 0.9, metal: 0 },
  rockwall: { tex: 'rockwall', tile: 4, rough: 0.9, metal: 0 },
  woodfloor: { tex: 'woodfloor', tile: 2, rough: 0.8, metal: 0 },
  woodwall: { tex: 'woodwall', tile: 1.6, rough: 0.8, metal: 0 },
  woodcrate: { tex: 'woodcrate', tile: 2.4, rough: 0.8, metal: 0 },
  cubicle: { tex: 'cubicle', tile: 1.5, rough: 1, metal: 0 },
  rack: { tex: 'rack', tile: 1, rough: 0.5, metal: 0.5, glow: 0.6 },
  planter: { tex: 'planter', tile: 0.8, rough: 0.9, metal: 0 },
};

/** Box faces with world-space UVs so textures keep a constant scale on any box size. */
function pushBox(arr, b, tile) {
  const [x0, y0, z0, x1, y1, z1] = b;
  const faces = [
    [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], 'zy'],
    [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], 'zy'],
    [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], 'xz'],
    [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], 'xz'],
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], 'xy'],
    [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], 'xy'],
  ];
  for (const [a, b2, c, d, n, plane] of faces) {
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

// ---------- weapon models (viewmodel, character hands, pickups)
function weaponModel(w) {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.45, metalness: 0.7 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x8b9096, roughness: 0.35, metalness: 0.9 });
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m; };
  const box = (sx, sy, sz) => new THREE.BoxGeometry(sx, sy, sz);
  const cyl = (r, l) => new THREE.CylinderGeometry(r, r, l, 12);
  switch (w) {
    case 1: { const red = new THREE.MeshStandardMaterial({ color: 0xb01f12, roughness: 0.5, metalness: 0.6 });
      add(box(0.035, 0.035, 0.62), red, 0, 0, -0.18); add(box(0.035, 0.035, 0.12), red, 0, 0.05, -0.5, -0.9); add(box(0.03, 0.03, 0.08), red, 0, -0.03, 0.12, 0.7); break; }
    case 2: add(box(0.04, 0.05, 0.2), dark, 0, 0.02, -0.08); add(box(0.035, 0.11, 0.05), dark, 0, -0.05, 0.0, 0.25); break;
    case 3: add(cyl(0.017, 0.24), steel, 0, 0.03, -0.17, Math.PI / 2); add(cyl(0.04, 0.06), steel, 0, 0.02, -0.03, Math.PI / 2); add(box(0.035, 0.11, 0.05), new THREE.MeshStandardMaterial({ color: 0x4a2c16, roughness: 0.8 }), 0, -0.06, 0.03, 0.3); break;
    case 4: add(box(0.05, 0.08, 0.42), dark, 0, 0, -0.1); add(box(0.03, 0.12, 0.05), dark, 0, -0.08, -0.12, 0.15); add(cyl(0.02, 0.18), steel, 0, -0.045, -0.24, Math.PI / 2); add(box(0.035, 0.06, 0.14), dark, 0, -0.01, 0.17); break;
    case 5: add(cyl(0.022, 0.62), steel, 0, 0.02, -0.26, Math.PI / 2); add(cyl(0.022, 0.5), steel, 0, -0.025, -0.22, Math.PI / 2); add(box(0.06, 0.06, 0.16), new THREE.MeshStandardMaterial({ color: 0x5a3519, roughness: 0.8 }), 0, -0.02, -0.12); add(box(0.05, 0.09, 0.24), new THREE.MeshStandardMaterial({ color: 0x4a2c16, roughness: 0.8 }), 0, -0.04, 0.14); break;
    case 6: add(box(0.05, 0.06, 0.52), dark, 0, 0, -0.12); add(box(0.62, 0.02, 0.03), steel, 0, 0.03, -0.32); add(box(0.04, 0.04, 0.16), dark, 0, 0.07, -0.05); break;
    case 7: { const green = new THREE.MeshStandardMaterial({ color: 0x4f5a2a, roughness: 0.7, metalness: 0.3 });
      add(cyl(0.06, 0.8), green, 0, 0, -0.15, Math.PI / 2); add(box(0.05, 0.05, 0.08), dark, 0.07, 0.05, -0.3); add(box(0.04, 0.1, 0.05), dark, 0, -0.09, 0.0); break; }
    case 8: { // AWP: olive body, long fluted barrel, big scope, bolt, magazine, thumbhole stock
      const olive = new THREE.MeshStandardMaterial({ color: 0x4b5a3a, roughness: 0.6, metalness: 0.3 });
      const lens = new THREE.MeshStandardMaterial({ color: 0x1a3a5a, emissive: 0x2a5a8a, emissiveIntensity: 0.6, roughness: 0.1, metalness: 0.9 });
      add(box(0.06, 0.09, 0.62), olive, 0, 0, -0.05);
      add(cyl(0.017, 0.62), dark, 0, 0.015, -0.66, Math.PI / 2);
      add(cyl(0.024, 0.08), dark, 0, 0.015, -0.98, Math.PI / 2);
      add(cyl(0.03, 0.3), dark, 0, 0.085, -0.08, Math.PI / 2);
      add(cyl(0.038, 0.06), dark, 0, 0.085, -0.25, Math.PI / 2); add(cyl(0.034, 0.05), dark, 0, 0.085, 0.09, Math.PI / 2);
      add(cyl(0.03, 0.005), lens, 0, 0.085, -0.281, Math.PI / 2);
      add(new THREE.SphereGeometry(0.018, 8, 6), steel, 0.05, 0.03, 0.05);
      add(box(0.045, 0.09, 0.07), dark, 0, -0.08, -0.02);
      add(box(0.055, 0.12, 0.22), olive, 0, -0.03, 0.33);
      add(box(0.035, 0.1, 0.05), dark, 0, -0.08, 0.13, 0.3);
      break; }
    case 9: { // AK-47: wooden furniture, curved magazine, gas tube
      const wood = new THREE.MeshStandardMaterial({ color: 0x8a4a22, roughness: 0.6, metalness: 0.05 });
      add(box(0.05, 0.08, 0.36), dark, 0, 0, -0.06);
      add(cyl(0.014, 0.42), dark, 0, 0.015, -0.42, Math.PI / 2);
      add(cyl(0.011, 0.3), dark, 0, 0.045, -0.32, Math.PI / 2);
      add(box(0.05, 0.05, 0.2), wood, 0, -0.005, -0.3);
      add(box(0.045, 0.12, 0.26), wood, 0, -0.035, 0.24, -0.12);
      add(box(0.035, 0.1, 0.05), wood, 0, -0.08, 0.06, 0.35);
      for (let i = 0; i < 4; i++) add(box(0.035, 0.05, 0.06), dark, 0, -0.07 - i * 0.04, -0.12 + i * 0.022, -0.35 - i * 0.08);
      add(box(0.012, 0.03, 0.015), steel, 0, 0.055, -0.6);
      break; }
    case 10: { // M4A1: black, rail and carry handle sight, straight magazine, collapsible stock
      add(box(0.05, 0.085, 0.38), dark, 0, 0, -0.05);
      add(cyl(0.013, 0.36), dark, 0, 0.01, -0.42, Math.PI / 2);
      add(cyl(0.022, 0.07), dark, 0, 0.01, -0.62, Math.PI / 2);
      add(box(0.055, 0.06, 0.22), dark, 0, 0.005, -0.33);
      add(box(0.02, 0.05, 0.16), steel, 0, 0.07, -0.03);
      add(box(0.035, 0.13, 0.06), dark, 0, -0.1, -0.08, -0.12);
      add(box(0.035, 0.1, 0.05), dark, 0, -0.08, 0.08, 0.3);
      add(box(0.04, 0.07, 0.2), dark, 0, -0.01, 0.26);
      add(box(0.012, 0.035, 0.015), steel, 0, 0.055, -0.5);
      break; }
    case 11: { // HE grenade: olive body, spoon and pin
      const olive = new THREE.MeshStandardMaterial({ color: 0x4d5a2e, roughness: 0.7, metalness: 0.2 });
      const body = add(new THREE.SphereGeometry(0.045, 14, 10), olive, 0, 0, 0); body.scale.set(1, 1.2, 1);
      add(cyl(0.02, 0.03), steel, 0, 0.06, 0);
      add(box(0.012, 0.07, 0.02), steel, 0.03, 0.035, 0, 0, 0, -0.3);
      add(new THREE.TorusGeometry(0.015, 0.003, 6, 12), steel, -0.02, 0.075, 0);
      break; }
  }
  return g;
}

// ---------- characters
const RB = (w, h, d, r) => new RoundedBoxGeometry(w, h, d, 3, r);
const Y = new THREE.Vector3(0, 1, 0);

// ---------- blocky (Minecraft-style) characters: every part is a box, every face a pixel-art texture
const PX = 0.056;                                         // one skin pixel in metres (32 px tall = 1.79 m)
const SKIN_TONES = ['#c8946a', '#e2b28e', '#8d5a3b', '#d39c74', '#f0c9a6', '#a26c48', '#e9bd99', '#b57e58'];
const HAIR = ['#3b2412', '#1c140e', '#121212', '#4a3420', '#c0903e', '#26130a', '#e2dccf', '#2b2b12'];
const EYES = ['#3b6fd8', '#4b8a3a', '#6a4020', '#2a2a2a', '#3a9a9a', '#5a2a8a', '#2a6ad8', '#8a5a1a'];
const hex = c => '#' + c.toString(16).padStart(6, '0');

/** Seeded pixel painter: `fill` shades each pixel a little, like Minecraft skins. */
function pixelPainter(seed) {
  let st = seed * 9301 + 49297;
  const rand = () => { st = (st * 16807) % 2147483647; return st / 2147483647; };
  return (W, H, paint) => {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const col = new THREE.Color();
    const px = (x, y, css, vary = 0.07) => {
      col.set(css); const k = 1 + (rand() - 0.5) * 2 * vary;
      g.fillStyle = `rgb(${Math.min(255, col.r * 255 * k) | 0},${Math.min(255, col.g * 255 * k) | 0},${Math.min(255, col.b * 255 * k) | 0})`;
      g.fillRect(x, y, 1, 1);
    };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px(x, y, paint(x, y) || '#ff00ff');
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
}

/** Box of w x h x d skin pixels; `faces` = [+x, -x, +y, -y, +z(back), -z(front)] painters (x, y) -> css. */
function pixelBox(tex, w, h, d, faces) {
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  const mats = faces.map((f, i) => new THREE.MeshLambertMaterial({ map: tex(dims[i][0], dims[i][1], f) }));
  return new THREE.Mesh(new THREE.BoxGeometry(w * PX, h * PX, d * PX), mats);
}

/** Palette for one character (skin index + player colour). */
function charPalette(skinIdx, accentCss) {
  const i = skinIdx % SKINS.length, sk = SKINS[i];
  return { skin: SKIN_TONES[i], hair: HAIR[i], eye: EYES[i], shirt: hex(sk.suit), pants: hex(sk.trim), shoe: hex(sk.dark), accent: accentCss };
}

/** Arm painters (vertical arm, shoulder at the top): sleeve, armband in the player colour, bare forearm and hand. */
function armFaces(P, band = true) {
  const side = (x, y) => y < 6 ? (band && y === 4 ? P.accent : y === 5 ? P.pants : P.shirt) : P.skin;
  return [side, side, () => P.shirt, () => P.skin, side, side];
}

/** A blocky character, feet at the origin, facing -Z. */
function buildCharacter(skinIdx, accentCss) {
  const P = charPalette(skinIdx, accentCss);
  const tex = pixelPainter(skinIdx * 7 + 3);
  const root = new THREE.Group();
  const add = (parent, mesh, x, y, z) => { mesh.position.set(x, y, z); parent.add(mesh); return mesh; };

  // legs: pants, shoes, a darker inside seam
  const legs = [];
  for (const s of [-1, 1]) {
    const thigh = new THREE.Group(); thigh.position.set(s * 2 * PX, 12 * PX, 0); root.add(thigh);
    const side = (x, y) => y >= 10 ? P.shoe : y === 0 ? P.shoe : P.pants;
    const front = (x, y) => y >= 10 ? (y === 10 ? P.shoe : '#2a2a2a') : (x === (s > 0 ? 0 : 3) ? P.pants : P.pants);
    add(thigh, pixelBox(tex, 4, 12, 4, [side, side, () => P.pants, () => '#2a2a2a', side, front]), 0, -6 * PX, 0);
    const knee = new THREE.Group(); knee.position.y = -6 * PX; thigh.add(knee);   // kept for the animation code; legs stay rigid
    legs.push({ thigh, knee });
  }

  // body: shirt with an open collar, a centre seam, belt with a buckle in the player colour
  const torso = new THREE.Group(); torso.position.y = 12 * PX; root.add(torso);
  const belt = (x, y) => y === 10 ? P.shoe : null;
  const bodyFront = (x, y) => belt(x, y) && (x === 3 || x === 4 ? P.accent : P.shoe)
    || (y < 2 && (x === 3 || x === 4) ? P.skin : y === 2 && (x === 3 || x === 4) ? P.pants : (x === 3 || x === 4) && y > 2 && y < 10 && y % 3 === 0 ? P.pants : P.shirt);
  const bodyBack = (x, y) => belt(x, y) || P.shirt;
  const bodySide = (x, y) => belt(x, y) || P.shirt;
  add(torso, pixelBox(tex, 8, 12, 4, [bodySide, bodySide, () => P.shirt, () => P.pants, bodyBack, bodyFront]), 0, 6 * PX, 0);

  // head: hair on top, back and sides; eyes, nose shadow and mouth on the front
  const head = new THREE.Group(); head.position.y = 12 * PX; torso.add(head);
  const hairBottom = { 0: 2, 1: 2, 2: 1, 3: 1, 4: 1, 5: 1, 6: 2, 7: 2 };
  const face = (x, y) => {
    if (y < 2 || (y < hairBottom[x] + 1 && (x === 0 || x === 7))) return P.hair;
    if (y === 4 && (x === 1 || x === 6)) return '#f4f4f4';
    if (y === 4 && (x === 2 || x === 5)) return P.eye;
    if (y === 5 && (x === 3 || x === 4)) return new THREE.Color(P.skin).multiplyScalar(0.8).getStyle();
    if (y === 6 && x >= 2 && x <= 5) return new THREE.Color(P.hair).lerp(new THREE.Color(P.skin), 0.35).getStyle();
    return P.skin;
  };
  const headSide = (x, y) => y < 3 || (y < 6 && x >= 5) ? P.hair : y === 4 && x === 1 ? new THREE.Color(P.skin).multiplyScalar(0.85).getStyle() : P.skin;
  const headSideL = (x, y) => headSide(7 - x, y);
  const headBack = (x, y) => y < 6 ? P.hair : P.skin;
  add(head, pixelBox(tex, 8, 8, 8, [headSideL, headSide, () => P.hair, () => P.skin, headBack, face]), 0, 4 * PX, 0);

  // arms reach forward and hold the weapon; they follow the aim pitch
  const aim = new THREE.Group(); aim.position.y = 10 * PX; torso.add(aim);
  const arm = (x, yawIn, pitch) => {
    const g = new THREE.Group(); g.position.set(x, 0, 0); g.rotation.set(Math.PI / 2 - pitch, yawIn, 0, 'YXZ'); aim.add(g);
    add(g, pixelBox(tex, 4, 12, 4, armFaces(P)), 0, -5 * PX, 0);
    return g;
  };
  arm(6 * PX, 0.12, 0.12);
  arm(-6 * PX, -0.5, 0.05);
  const gun = new THREE.Group(); gun.position.set(0.17, -0.06, -0.62); aim.add(gun);

  return { root, hips: root, torso, head, aim, gun, legs, torsoY: 12 * PX };
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
    this.scene.fog = new THREE.Fog(0x0b0d10, 22, 75);
    this.camera = new THREE.PerspectiveCamera(80, 16 / 9, 0.05, 260);
    this.baseFov = 80;
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(62, 16 / 9, 0.01, 10);
    this.time = 0;
    this.shake = 0;
    this.players = new Map();        // id -> character instance
    this.decals = [];
    this.tracers = [];
    this.flashes = [];
    this.booms = [];
    this.projMeshes = new Map();
    this.debris = [];
    this.staticBodies = [];
    this.tex = {};
    for (const k of Object.keys(TEX)) this.tex[k] = TEX[k]();
    this.mats = {};

    this.buildParticles();
    this.buildViewmodel();
    this.buildPhysics();
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

  material(name) {
    if (!this.mats[name]) {
      const def = MATS[name] || MATS.concrete;
      this.mats[name] = new THREE.MeshStandardMaterial({ map: this.tex[def.tex], roughness: def.rough, metalness: def.metal,
        ...(def.glow ? { emissive: 0xffffff, emissiveMap: this.tex[def.tex], emissiveIntensity: def.glow } : {}) });
    }
    return this.mats[name];
  }

  // ---------- maps
  /** Replace the whole world with map `def` (geometry, lights, props, pickups, colliders, atmosphere). */
  setMap(def) {
    if (this.map === def) return;
    if (this.mapGroup) {
      this.scene.remove(this.mapGroup);
      this.mapGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    }
    for (const b of this.staticBodies) this.world.removeBody(b);
    for (const d of this.debris) { this.world.removeBody(d.body); this.scene.remove(d.mesh); }
    for (const m of this.decals) this.scene.remove(m);
    for (const [, m] of this.projMeshes) this.scene.remove(m);
    this.debris = []; this.decals = []; this.staticBodies = []; this.projMeshes.clear();
    this.map = def;
    this.mapGroup = new THREE.Group();
    this.scene.add(this.mapGroup);

    const th = def.THEME;
    if (th.sky) {
      this.scene.background = canvasTex(256, (g, s) => {
        const gr = g.createLinearGradient(0, 0, 0, s);
        gr.addColorStop(0, '#' + th.sky[0].toString(16).padStart(6, '0')); gr.addColorStop(0.75, '#' + th.sky[1].toString(16).padStart(6, '0'));
        gr.addColorStop(1, '#' + th.bg.toString(16).padStart(6, '0'));
        g.fillStyle = gr; g.fillRect(0, 0, s, s);
      }, false);
    } else this.scene.background = new THREE.Color(th.bg);
    this.scene.fog = new THREE.Fog(th.bg, th.fog[0], th.fog[1]);
    if (this.snowfall) { this.scene.remove(this.snowfall.pts); this.snowfall = null; }
    if (th.snow) {
      const n = 1800, pos = new Float32Array(n * 3), seed = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { seed[i * 3] = rnd() * 60 - 30; seed[i * 3 + 1] = rnd() * 24; seed[i * 3 + 2] = rnd() * 60 - 30; }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.09, map: this.tex.soft, color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
      pts.frustumCulled = false; this.scene.add(pts);
      this.snowfall = { pts, pos, seed, n };
    }
    this.renderer.toneMappingExposure = th.exposure || 1.1;
    this.mapGroup.add(new THREE.HemisphereLight(th.hemi[0], th.hemi[1], th.hemi[2]));
    this.mapGroup.add(new THREE.AmbientLight(0xffffff, th.ambient));
    if (th.sun) {
      const sun = new THREE.DirectionalLight(th.sun.color, th.sun.intensity);
      sun.position.set(...th.sun.pos);
      this.mapGroup.add(sun);
    }
    const panel = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3dc, emissiveIntensity: 1.6 });
    for (const L of def.LIGHTS) {
      const l = new THREE.PointLight(L.color, L.power * 30, L.range, 1.6);
      l.position.set(L.pos[0], L.pos[1] - (L.panel ? 0.4 : 0), L.pos[2]);
      this.mapGroup.add(l);
      if (L.panel) { const m = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 0.5), panel); m.position.set(...L.pos); this.mapGroup.add(m); }
    }
    for (const [color, x, y, z, sx, sy, sz] of def.NEON || []) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.2 }));
      m.position.set(x, y, z); this.mapGroup.add(m);
    }

    // static geometry merged per material
    const groups = {};
    for (const b of def.BOXES) { const mat = b[6]; (groups[mat] = groups[mat] || { pos: [], nor: [], uv: [] }); pushBox(groups[mat], b, (MATS[mat] || MATS.concrete).tile); }
    for (const [mat, arr] of Object.entries(groups)) this.mapGroup.add(new THREE.Mesh(geometryFrom(arr), this.material(mat)));

    // destructible props
    this.propMeshes = def.PROPS.map(pr => {
      const [x0, y0, z0, x1, y1, z1] = pr.box;
      const mesh = pr.type === 'crate'
        ? new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), new THREE.MeshStandardMaterial({ map: this.tex.crate, roughness: 0.85 }))
        : new THREE.Mesh(new THREE.CylinderGeometry((x1 - x0) / 2, (x1 - x0) / 2, y1 - y0, 16), new THREE.MeshStandardMaterial({ map: this.tex.barrel, roughness: 0.6, metalness: 0.4 }));
      mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      this.mapGroup.add(mesh);
      return mesh;
    });

    // pickups
    this.pickupMeshes = def.PICKUPS.map(p => {
      const g = new THREE.Group();
      if (p.type === 'weapon') { const wm = weaponModel(p.w); wm.scale.setScalar(p.w === 8 ? 1.3 : 1.6); g.add(wm); }
      else if (p.type === 'health') {
        g.add(new THREE.Mesh(RB(0.45, 0.3, 0.3, 0.04), new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.6 })));
        const red = new THREE.MeshStandardMaterial({ color: 0xd01818, emissive: 0x500000 });
        const a = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.31), red); a.position.y = 0.02; g.add(a);
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.31), red); b.position.y = 0.02; g.add(b);
      } else if (p.type === 'battery') {
        g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.4, 16), new THREE.MeshStandardMaterial({ color: 0x2a6cff, emissive: 0x2a6cff, emissiveIntensity: 1.2 })));
      } else g.add(new THREE.Mesh(RB(0.5, 0.3, 0.32, 0.04), new THREE.MeshStandardMaterial({ color: 0x4b5a2c, roughness: 0.8 })));
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.45, 24), new THREE.MeshBasicMaterial({ color: p.w === 8 ? 0x7dff6a : 0xffb347, transparent: true, opacity: 0.45, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = -0.48;
      g.add(ring);
      g.position.set(p.pos[0], p.pos[1] + 0.5, p.pos[2]);
      this.mapGroup.add(g);
      return g;
    });

    // colliders for cosmetic physics
    for (const b of def.BOXES) {
      const [x0, y0, z0, x1, y1, z1] = b;
      const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2)) });
      body.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      this.world.addBody(body);
      this.staticBodies.push(body);
    }
  }

  // ---------- particles (sparks / smoke / blood)
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
    this.sparks = make(700, 0.09, THREE.AdditiveBlending);
    this.smoke = make(400, 1.1, THREE.NormalBlending);
    this.blood = make(300, 0.16, THREE.NormalBlending);
  }

  emit(sys, x, y, z, vx, vy, vz, life, grav, r, g, b) {
    const i = sys.next; sys.next = (sys.next + 1) % sys.n;
    sys.pos[i * 3] = x; sys.pos[i * 3 + 1] = y; sys.pos[i * 3 + 2] = z;
    sys.vel[i * 3] = vx; sys.vel[i * 3 + 1] = vy; sys.vel[i * 3 + 2] = vz;
    sys.life[i] = sys.max[i] = life; sys.grav[i] = grav;
    sys.base[i * 3] = r; sys.base[i * 3 + 1] = g; sys.base[i * 3 + 2] = b;
  }

  stepParticles(sys, dt, drag) {
    for (let i = 0; i < sys.n; i++) {
      if (sys.life[i] <= 0) continue;
      sys.life[i] -= dt;
      if (sys.life[i] <= 0) { sys.pos[i * 3 + 1] = -999; continue; }
      sys.vel[i * 3 + 1] -= sys.grav[i] * dt;
      const k = Math.pow(drag, dt);
      for (let a = 0; a < 3; a++) { sys.vel[i * 3 + a] *= k; sys.pos[i * 3 + a] += sys.vel[i * 3 + a] * dt; }
      const f = sys.life[i] / sys.max[i];
      for (let a = 0; a < 3; a++) sys.col[i * 3 + a] = sys.base[i * 3 + a] * f;
    }
    sys.pts.geometry.attributes.position.needsUpdate = true;
    sys.pts.geometry.attributes.color.needsUpdate = true;
  }

  // ---------- cannon-es debris
  buildPhysics() {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -18, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = true;
    this.world.defaultContactMaterial.restitution = 0.35;
    this.world.defaultContactMaterial.friction = 0.4;
    this.debrisMats = {
      brass: new THREE.MeshStandardMaterial({ color: 0xd4a537, metalness: 0.9, roughness: 0.3 }),
      shell: new THREE.MeshStandardMaterial({ color: 0xb3241b, roughness: 0.6 }),
      wood: new THREE.MeshStandardMaterial({ map: this.tex.crate, roughness: 0.9 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x8a2418, metalness: 0.6, roughness: 0.5 }),
      rock: new THREE.MeshStandardMaterial({ color: 0x55534d, roughness: 0.95 }),
    };
  }

  addDebris(kind, x, y, z, vx, vy, vz, size, life = 4) {
    if (this.debris.length > 80) { const old = this.debris.shift(); this.world.removeBody(old.body); this.scene.remove(old.mesh); }
    const [sx, sy, sz] = size;
    const body = new CANNON.Body({ mass: 0.3, shape: new CANNON.Box(new CANNON.Vec3(sx / 2, sy / 2, sz / 2)), linearDamping: 0.05, angularDamping: 0.1 });
    body.position.set(x, y, z);
    body.velocity.set(vx, vy, vz);
    body.angularVelocity.set((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20);
    this.world.addBody(body);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), this.debrisMats[kind]);
    this.scene.add(mesh);
    this.debris.push({ body, mesh, life });
  }

  ejectCasing(w, cam) {
    if (w === 1 || w === 6 || w === 7) return;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion), fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const p = cam.position.clone().addScaledVector(right, 0.2).addScaledVector(fwd, 0.4).add(new THREE.Vector3(0, -0.15, 0));
    const v = right.multiplyScalar(2.5 + Math.random()).add(new THREE.Vector3(0, 2 + Math.random(), 0));
    const big = w === 5 || w === 8;
    this.addDebris(w === 5 ? 'shell' : 'brass', p.x, p.y, p.z, v.x, v.y, v.z, big ? [0.022, 0.022, w === 8 ? 0.075 : 0.06] : [0.012, 0.012, 0.03], 3);
  }

  // ---------- characters
  ensurePlayer(id, colorIdx, name, skin) {
    let pm = this.players.get(id);
    if (pm && pm.skin === skin && pm.colorIdx === colorIdx) return pm;
    if (pm) this.removePlayer(id);
    const ch = buildCharacter(skin, COLORS[colorIdx % COLORS.length]);
    const c = document.createElement('canvas'); c.width = 256; c.height = 48;
    const x = c.getContext('2d'); x.font = 'bold 26px sans-serif'; x.textAlign = 'center'; x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(0, 6, 256, 36);
    x.fillStyle = COLORS[colorIdx % COLORS.length]; x.fillText(name, 128, 34);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
    label.scale.set(1.2, 0.22, 1); label.position.y = 2.15; ch.root.add(label);
    this.scene.add(ch.root);
    pm = { ...ch, label, skin, colorIdx, w: 0, phase: 0, dead: 0, lastY: 0, air: 0, kick: 0 };
    this.players.set(id, pm);
    return pm;
  }

  removePlayer(id) {
    const pm = this.players.get(id);
    if (!pm) return;
    this.scene.remove(pm.root);
    pm.root.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      for (const m of [].concat(o.material || [])) { if (m.map) m.map.dispose(); m.dispose(); }
    });
    this.players.delete(id);
  }

  updatePlayer(id, s, dt) {
    const pm = this.players.get(id);
    if (!pm) return;
    const g = pm.root;
    if (!s.alive) {
      pm.dead = Math.min(1, pm.dead + dt * 2.2);
      pm.deadT = (pm.deadT || 0) + dt;
      g.position.set(s.x, s.y, s.z);
      g.rotation.set(-pm.dead * 1.45, s.yaw, 0, 'YXZ');
      for (const L of pm.legs) L.knee.rotation.x = pm.dead * 0.9;
      pm.aim.rotation.x = -pm.dead * 0.8;
      g.visible = pm.deadT < 2.6;
      return;
    }
    pm.dead = 0; pm.deadT = 0; g.visible = true;
    const speed = Math.hypot(s.x - g.position.x, s.z - g.position.z) / Math.max(dt, 1e-3);
    const vy = (s.y - pm.lastY) / Math.max(dt, 1e-3);
    pm.lastY = s.y;
    pm.air = Math.abs(vy) > 1.2 ? Math.min(1, pm.air + dt * 6) : Math.max(0, pm.air - dt * 6);
    g.position.set(s.x, s.y, s.z);
    g.rotation.set(0, s.yaw, 0, 'YXZ');
    const amt = Math.min(1, speed / 5.5);
    pm.phase += Math.min(speed, 8) * dt * 1.7;
    for (let i = 0; i < 2; i++) {
      const ph = pm.phase + i * Math.PI, L = pm.legs[i];
      const walk = Math.sin(ph) * 0.75 * amt, bend = Math.max(0, -Math.cos(ph)) * 1.1 * amt;
      L.thigh.rotation.x = walk * (1 - pm.air) - 0.55 * pm.air;
      L.knee.rotation.x = bend * (1 - pm.air) + 1.0 * pm.air;
    }
    // crouching (Ctrl): sink the whole body and fold the legs forward, lean the torso
    pm.crouchK = (pm.crouchK || 0) + (((s.flags & 8) ? 1 : 0) - (pm.crouchK || 0)) * Math.min(1, dt * 12);
    if (pm.crouchK > 0.01) pm.legs.forEach((L, i) => { L.thigh.rotation.x = L.thigh.rotation.x * (1 - pm.crouchK) + (i ? -0.75 : 0.35) * pm.crouchK; });
    g.position.y = s.y - 0.36 * pm.crouchK;
    pm.torso.position.y = pm.torsoY + Math.abs(Math.sin(pm.phase)) * 0.03 * amt;
    pm.torso.rotation.x = -0.05 * amt - 0.45 * pm.crouchK;
    pm.aim.rotation.x = s.pitch;
    pm.head.rotation.x = s.pitch * 0.6;
    if (s.flags & 1) pm.kick = 1;
    pm.kick = Math.max(0, pm.kick - dt * 8);
    pm.aim.position.z = pm.kick * 0.05;
    if (pm.w !== s.cur) { pm.gun.clear(); pm.gun.add(weaponModel(s.cur)); pm.w = s.cur; }
    if (s.flags & 4) g.visible = Math.sin(this.time * 30) > -0.3;          // spawn protection flicker
  }

  // ---------- viewmodel
  buildViewmodel() {
    this.vmScene.add(new THREE.HemisphereLight(0xc8d2e0, 0x3a3226, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(1, 2, 1); this.vmScene.add(key);
    this.vm = new THREE.Group();
    this.vmScene.add(this.vm);
    this.vmArm = new THREE.Group();
    this.vmGun = new THREE.Group();
    this.vm.add(this.vmGun);
    this.vm.add(this.vmArm);
    this.vmFlash = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.flash, blending: THREE.AdditiveBlending, depthTest: false, transparent: true }));
    this.vmFlash.scale.set(0.3, 0.3, 1);
    this.vmFlash.visible = false;
    this.vm.add(this.vmFlash);
    this.vmState = { w: 0, kick: 0, swing: 0, bob: 0, flash: 0, switchT: 0, reload: 0 };
  }

  /** First-person arm: a Minecraft-style block arm in the chosen skin (shirt sleeve, armband, hand). */
  setViewSkin(skin) {
    this.vmArm.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      for (const m of [].concat(o.material || [])) { if (m.map) m.map.dispose(); m.dispose(); }
    });
    this.vmArm.clear();
    const P = charPalette(skin, '#ffa52a');
    const m = pixelBox(pixelPainter(skin * 7 + 3), 4, 12, 4, armFaces(P, false));
    m.scale.setScalar(0.42);
    m.rotation.x = Math.PI / 2; m.position.set(0.03, -0.1, 0.16);
    this.vmArm.add(m);
  }

  setViewWeapon(w) {
    if (this.vmState.w === w) return;
    this.vmGun.clear();
    this.vmGun.add(weaponModel(w));
    if (w === 1) { this.vmGun.rotation.set(0.55, -0.3, 0.25); this.vmGun.position.set(0.04, -0.02, 0.06); }
    else { this.vmGun.rotation.set(0, 0, 0); this.vmGun.position.set(0, 0, w === 8 ? 0.12 : 0); }
    this.vmArm.visible = w !== 1;
    this.vmState.w = w;
    this.vmState.switchT = 1;
    const muz = { 1: -0.6, 2: -0.2, 3: -0.3, 4: -0.33, 5: -0.58, 6: -0.4, 7: -0.6, 8: -0.9, 9: -0.66, 10: -0.68 }[w] || -0.3;
    if (w === 11) { this.vmGun.position.set(0.02, 0.02, -0.08); this.vmGun.scale.setScalar(1.3); } else this.vmGun.scale.setScalar(1);
    this.vmFlash.position.set(0, 0.02, muz);
  }

  vmFire(w) {
    const s = this.vmState;
    if (w === 1 || w === 11) { s.swing = 1; return; }
    s.kick = Math.min(1.4, s.kick + (WEAPONS[w].kick || 0.03) * 12);
    s.flash = 0.06;
  }

  // ---------- one-shot effects
  muzzleLight(x, y, z, color = 0xffc070, power = 6) {
    const l = new THREE.PointLight(color, power * 20, 8, 2);
    l.position.set(x, y, z);
    this.scene.add(l);
    this.flashes.push({ obj: l, life: 0.06 });
  }

  tracer(o, e, color = 0xffe1a0, life = 0.07) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...o), new THREE.Vector3(...e)]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending }));
    this.scene.add(line);
    this.tracers.push({ obj: line, life });
  }

  impact(x, y, z, surface, normal) {
    if (surface === 1) {
      for (let i = 0; i < 10; i++) this.emit(this.blood, x, y, z, (Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3, 0.5, 9, 0.7, 0.05, 0.03);
      return;
    }
    for (let i = 0; i < 8; i++) this.emit(this.sparks, x, y, z, (Math.random() - 0.5) * 5 + (normal ? normal[0] * 3 : 0), Math.random() * 4, (Math.random() - 0.5) * 5 + (normal ? normal[2] * 3 : 0), 0.35, 12, 1, 0.8, 0.4);
    this.emit(this.smoke, x, y, z, 0, 0.4, 0, 0.6, -0.2, 0.35, 0.33, 0.3);
    if (normal) this.decal(x, y, z, normal);
  }

  decal(x, y, z, n) {
    if (!this.decalMat) this.decalMat = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.05 + Math.random() * 0.03, 8), this.decalMat);
    m.position.set(x + n[0] * 0.01, y + n[1] * 0.01, z + n[2] * 0.01);
    m.lookAt(x + n[0], y + n[1], z + n[2]);
    this.scene.add(m);
    this.decals.push(m);
    if (this.decals.length > 120) this.scene.remove(this.decals.shift());
  }

  explosion(x, y, z, radius, camPos) {
    const core = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffb040, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    core.position.set(x, y, z);
    this.scene.add(core);
    this.booms.push({ obj: core, life: 0.45, max: 0.45, radius });
    this.muzzleLight(x, y, z, 0xff8a2a, 30);
    this.flashes[this.flashes.length - 1].life = 0.25;
    for (let i = 0; i < 60; i++) this.emit(this.sparks, x, y, z, (Math.random() - 0.5) * 16, Math.random() * 12, (Math.random() - 0.5) * 16, 0.6 + Math.random() * 0.5, 14, 1, 0.6, 0.2);
    for (let i = 0; i < 26; i++) this.emit(this.smoke, x, y, z, (Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4, 1.6 + Math.random(), -0.5, 0.25, 0.22, 0.2);
    for (let i = 0; i < 6; i++) this.addDebris('rock', x, y + 0.2, z, (Math.random() - 0.5) * 9, 4 + Math.random() * 6, (Math.random() - 0.5) * 9, [0.12, 0.08, 0.1]);
    const d = camPos ? camPos.distanceTo(new THREE.Vector3(x, y, z)) : 20;
    this.shake = Math.max(this.shake, Math.max(0, 1.2 - d / 18));
  }

  propDestroyed(i) {
    const mesh = this.propMeshes && this.propMeshes[i];
    if (!mesh || !mesh.visible) return;
    mesh.visible = false;
    const { x, y, z } = mesh.position, crate = this.map.PROPS[i].type === 'crate';
    for (let k = 0; k < 9; k++) {
      this.addDebris(crate ? 'wood' : 'metal', x + (Math.random() - 0.5) * 0.6, y + (Math.random() - 0.3) * 0.6, z + (Math.random() - 0.5) * 0.6,
        (Math.random() - 0.5) * 8, 3 + Math.random() * 5, (Math.random() - 0.5) * 8, crate ? [0.5, 0.06, 0.15] : [0.25, 0.25, 0.04], 5);
    }
  }

  // ---------- per frame
  render(view) {
    const dt = Math.min(0.05, view.dt);
    this.time += dt;
    const cam = this.camera;
    cam.position.set(view.cam.x, view.cam.y, view.cam.z);
    cam.rotation.order = 'YXZ';
    cam.rotation.set(view.cam.pitch + (view.punch || 0), view.cam.yaw, 0);
    if (this.shake > 0.01) {
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.25;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.25;
      this.shake *= Math.pow(0.02, dt);
    }
    const fov = view.fov || this.baseFov;
    if (Math.abs(cam.fov - fov) > 0.1) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 16); cam.updateProjectionMatrix(); }

    const seen = new Set();
    for (const s of view.players) { seen.add(s.id); this.updatePlayer(s.id, s, dt); }
    for (const id of [...this.players.keys()]) if (!seen.has(id)) this.removePlayer(id);

    const live = new Set();
    for (const pr of view.projectiles) {
      live.add(pr.id);
      let m = this.projMeshes.get(pr.id);
      if (!m) {
        if (pr.type === PROJ.ROCKET) m = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 8), new THREE.MeshStandardMaterial({ color: 0x9aa070, emissive: 0x332200 }));
        else if (pr.type === PROJ.GRENADE) m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshStandardMaterial({ color: 0x3c4428 }));
        else if (pr.type === PROJ.HE) { m = weaponModel(11); m.scale.setScalar(1.6); }
        else m = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6), new THREE.MeshStandardMaterial({ color: 0xcfd6dc, metalness: 0.8 }));
        this.scene.add(m);
        this.projMeshes.set(pr.id, m);
      }
      m.position.set(pr.x, pr.y, pr.z);
      const v = new THREE.Vector3(pr.vx, pr.vy, pr.vz).normalize();
      if (pr.type === PROJ.HE) { m.rotation.x += dt * 9 * Math.min(1, v.length() * 9); m.rotation.z += dt * 4; }
      else m.quaternion.setFromUnitVectors(Y, v);
      if (pr.type === PROJ.ROCKET) {
        this.emit(this.smoke, pr.x - v.x * 0.3, pr.y - v.y * 0.3, pr.z - v.z * 0.3, (Math.random() - 0.5) * 0.3, 0.3, (Math.random() - 0.5) * 0.3, 1.2, -0.3, 0.55, 0.52, 0.5);
        this.emit(this.sparks, pr.x - v.x * 0.3, pr.y - v.y * 0.3, pr.z - v.z * 0.3, -v.x * 2, -v.y * 2, -v.z * 2, 0.12, 0, 1, 0.6, 0.2);
      }
    }
    for (const [id, m] of this.projMeshes) if (!live.has(id)) { this.scene.remove(m); this.projMeshes.delete(id); }

    if (this.pickupMeshes) this.pickupMeshes.forEach((g, i) => {
      g.visible = !!(view.pickups & (2 ** i));
      g.rotation.y = this.time * 1.4 + i;
      g.children[0].position.y = Math.sin(this.time * 2 + i) * 0.06;
    });
    if (this.propMeshes) this.propMeshes.forEach((m, i) => { m.visible = !!(view.props & (2 ** i)); });
    // dropped weapons (G / on death): lying on their side, spinning while they fly
    if (!this.itemMeshes) this.itemMeshes = new Map();
    const liveItems = new Set();
    for (const it of view.items || []) {
      liveItems.add(it.id);
      let m = this.itemMeshes.get(it.id);
      if (!m) { m = weaponModel(it.w); m.scale.setScalar(it.w === 11 ? 1.6 : 1.4); m.rotation.set(0, (it.id * 2.399) % 6.28, Math.PI / 2); this.scene.add(m); this.itemMeshes.set(it.id, m); }
      m.position.set(it.x, it.y + (it.rest ? 0.04 : 0), it.z);
      if (!it.rest) { m.rotation.x += dt * 7; m.rotation.y += dt * 3; } else m.rotation.x = 0;
    }
    for (const [id, m] of this.itemMeshes) if (!liveItems.has(id)) { this.scene.remove(m); this.itemMeshes.delete(id); }

    for (const list of [this.tracers, this.flashes]) for (const f of list) { f.life -= dt; if (f.life <= 0) this.scene.remove(f.obj); }
    this.tracers = this.tracers.filter(f => f.life > 0);
    this.flashes = this.flashes.filter(f => f.life > 0);
    for (const b of this.booms) {
      b.life -= dt;
      const k = 1 - b.life / b.max;
      b.obj.scale.setScalar(0.3 + k * b.radius * 0.7);
      b.obj.material.opacity = Math.max(0, 0.9 * (1 - k));
      if (b.life <= 0) this.scene.remove(b.obj);
    }
    this.booms = this.booms.filter(b => b.life > 0);
    this.stepParticles(this.sparks, dt, 0.3);
    this.stepParticles(this.smoke, dt, 0.5);
    this.stepParticles(this.blood, dt, 0.4);
    if (this.snowfall) {                                       // flakes drift down and sway, wrapping around the camera
      const S = this.snowfall, t = this.time, c = cam.position;
      for (let i = 0; i < S.n; i++) {
        const fall = ((S.seed[i * 3 + 1] - t * 1.6) % 24 + 24) % 24;
        const wrap = (v, cv) => ((v - cv + 30) % 60 + 60) % 60 - 30 + cv;
        S.pos[i * 3] = wrap(S.seed[i * 3] + Math.sin(t * 0.7 + i) * 0.6, c.x);
        S.pos[i * 3 + 1] = c.y - 8 + fall;
        S.pos[i * 3 + 2] = wrap(S.seed[i * 3 + 2] + Math.cos(t * 0.5 + i * 1.3) * 0.6, c.z);
      }
      S.pts.geometry.attributes.position.needsUpdate = true;
    }

    this.world.step(1 / 60, dt, 3);
    for (const d of this.debris) { d.life -= dt; d.mesh.position.copy(d.body.position); d.mesh.quaternion.copy(d.body.quaternion); }
    for (const d of this.debris.filter(d => d.life <= 0)) { this.world.removeBody(d.body); this.scene.remove(d.mesh); }
    this.debris = this.debris.filter(d => d.life > 0);

    // viewmodel animation
    const s = this.vmState, me = view.me || {};
    if (me.cur) this.setViewWeapon(me.cur);
    s.kick *= Math.pow(0.0005, dt);
    s.swing = Math.max(0, s.swing - dt * 4);
    s.switchT = Math.max(0, s.switchT - dt * 2.5);
    s.reload += ((me.reloading ? 1 : 0) - s.reload) * Math.min(1, dt * 8);
    if (me.moving && me.onGround) s.bob += dt * 9;
    const bobX = Math.sin(s.bob) * 0.012, bobY = Math.abs(Math.cos(s.bob)) * 0.012;
    this.vm.position.set(0.24 + bobX, -0.22 - bobY - s.switchT * 0.35 - s.reload * 0.12, -0.42 + s.kick * 0.05);
    this.vm.rotation.set(s.kick * 0.12 - s.reload * 0.6 - (s.swing > 0 ? Math.sin(s.swing * Math.PI) * 1.1 : 0), (s.swing > 0 ? Math.sin(s.swing * Math.PI) * 0.4 : 0), s.reload * 0.3);
    s.flash -= dt;
    this.vmFlash.visible = s.flash > 0;
    if (this.vmFlash.visible) this.vmFlash.material.rotation = Math.random() * 6;

    this.renderer.clear();
    this.renderer.render(this.scene, cam);
    if (view.showViewmodel) { this.renderer.clearDepth(); this.renderer.render(this.vmScene, this.vmCamera); }
  }
}

export { weaponModel, buildCharacter };
