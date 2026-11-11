/**
 * The things you can hide - small, real-scale models of what a TJ student leaves around.
 * Every model sits on y = 0 (put it straight on a desk / the floor) and faces +z.
 * ITEM_TYPES must match server/HideServer.js.
 */
import * as THREE from 'three';

export const ITEM_TYPES = {
  macbook: { name: 'MacBook', icon: '💻', blurb: 'Someone\'s whole CS portfolio' },
  ti84: { name: 'TI-84 Calculator', icon: '🧮', blurb: 'Programmed with every formula' },
  hydroflask: { name: 'Hydro Flask', icon: '🥤', blurb: 'Covered in stickers' },
  redbull: { name: 'Red Bull Can', icon: '🥫', blurb: 'Finals-week fuel' },
  homework: { name: 'Homework Folder', icon: '📁', blurb: 'Due first period' },
  airpods: { name: 'AirPods Case', icon: '🎧', blurb: 'Tiny and easy to miss' },
  rubik: { name: 'Rubik\'s Cube', icon: '🧩', blurb: 'Solved in 14 seconds' },
  textbook: { name: 'AP Physics C Textbook', icon: '📘', blurb: 'Heavier than it looks' },
};

const cache = {};
function tex(key, w, h, draw) {
  if (cache[key]) return cache[key];
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return (cache[key] = t);
}
const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.1, ...o });
function roundedBox(w, h, d, r, mat) {
  const s = new THREE.Shape(), x = -w / 2, z = -d / 2;
  s.moveTo(x + r, z); s.lineTo(x + w - r, z); s.quadraticCurveTo(x + w, z, x + w, z + r); s.lineTo(x + w, z + d - r);
  s.quadraticCurveTo(x + w, z + d, x + w - r, z + d); s.lineTo(x + r, z + d); s.quadraticCurveTo(x, z + d, x, z + d - r);
  s.lineTo(x, z + r); s.quadraticCurveTo(x, z, x + r, z);
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 4 });
  g.rotateX(Math.PI / 2); g.translate(0, h, 0);
  return new THREE.Mesh(g, mat);
}

const BUILD = {
  macbook() {
    const g = new THREE.Group(), alu = std({ color: 0xb9bcc2, metalness: 0.75, roughness: 0.3 });
    const base = roundedBox(0.304, 0.008, 0.212, 0.01, alu); g.add(base);
    const lid = roundedBox(0.304, 0.006, 0.212, 0.01, alu);
    // lid open at ~110 degrees, hinged at the back edge
    const hinge = new THREE.Group(); hinge.position.set(0, 0.008, -0.106); hinge.rotation.x = -1.9; g.add(hinge);
    lid.position.z = 0.106; hinge.add(lid);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.18), new THREE.MeshBasicMaterial({ map: tex('mbscreen', 256, 168, (c, w, h) => {
      const gr = c.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#1c2b4f'); gr.addColorStop(1, '#9b1b30'); c.fillStyle = gr; c.fillRect(0, 0, w, h);
      c.fillStyle = '#0d1117'; c.fillRect(18, 18, w - 36, h - 36);
      c.font = '12px monospace'; ['int main() {', '  dfs(1, 0);', '  cout << ans;', '}', '// USACO Plat'].forEach((t, i) => { c.fillStyle = i === 4 ? '#7ee787' : '#c9d1d9'; c.fillText(t, 26, 40 + i * 18); });
    }) }));
    screen.rotation.x = Math.PI / 2; screen.position.set(0, -0.0005, 0.106); lid.add(screen);
    const kb = new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.11), new THREE.MeshStandardMaterial({ color: 0x222428, roughness: 0.8 }));
    kb.rotation.x = -Math.PI / 2; kb.position.set(0, 0.0085, -0.025); g.add(kb);
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.07), std({ color: 0xa9adb3, metalness: 0.6 }));
    pad.rotation.x = -Math.PI / 2; pad.position.set(0, 0.0086, 0.06); g.add(pad);
    return g;
  },
  ti84() {
    const g = new THREE.Group();
    const body = roundedBox(0.086, 0.022, 0.19, 0.012, std({ color: 0x23324f, roughness: 0.6 })); g.add(body);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.182), new THREE.MeshStandardMaterial({ map: tex('ti84', 128, 290, (c, w, h) => {
      c.fillStyle = '#23324f'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#9fae8f'; c.fillRect(14, 16, w - 28, 74); c.strokeStyle = '#333'; c.strokeRect(14, 16, w - 28, 74);
      c.strokeStyle = '#223'; c.beginPath(); for (let x = 0; x < w - 32; x++) c.lineTo(16 + x, 54 - Math.sin(x / 8) * 22); c.stroke();
      c.fillStyle = '#ddd'; c.font = 'bold 9px Arial'; c.fillText('TI-84 Plus CE', 30, 106);
      for (let r = 0; r < 9; r++) for (let k = 0; k < 5; k++) {
        c.fillStyle = r < 2 ? '#3a6ec1' : (k === 4 && r > 2 ? '#d0d0d0' : '#141821'); c.fillRect(12 + k * 21, 118 + r * 19, 16, 12);
      }
    }), roughness: 0.6 }));
    face.rotation.x = -Math.PI / 2; face.position.y = 0.0225; g.add(face);
    return g;
  },
  hydroflask() {
    const g = new THREE.Group();
    const color = [0x2a9d8f, 0x9b1b30, 0x1c2b4f, 0xf4a261][(Math.random() * 4) | 0];
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.039, 0.037, 0.23, 24), new THREE.MeshStandardMaterial({ map: tex('flask' + color, 256, 128, (c, w, h) => {
      c.fillStyle = '#' + color.toString(16).padStart(6, '0'); c.fillRect(0, 0, w, h);
      const st = [['#ffd166', 'NASA'], ['#ef476f', 'TJ'], ['#06d6a0', 'O(1)'], ['#ffffff', 'USACO'], ['#118ab2', '∑']];
      st.forEach(([col, t], i) => { c.fillStyle = col; c.beginPath(); c.ellipse(26 + i * 50, 40 + (i % 2) * 44, 20, 14, i, 0, 7); c.fill(); c.fillStyle = '#222'; c.font = 'bold 11px Arial'; c.textAlign = 'center'; c.fillText(t, 26 + i * 50, 44 + (i % 2) * 44); });
    }), roughness: 0.75 }));
    body.position.y = 0.115; g.add(body);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.033, 0.035, 20), new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.7 })); cap.position.y = 0.2475; g.add(cap);
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.005, 6, 14, Math.PI), cap.material); loop.position.y = 0.265; g.add(loop);
    return g;
  },
  redbull() {
    const g = new THREE.Group();
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.0265, 0.0265, 0.135, 22), [new THREE.MeshStandardMaterial({ map: tex('can', 256, 128, (c, w, h) => {
      for (let i = 0; i < 4; i++) { c.fillStyle = i % 2 ? '#c0c5cc' : '#1e3f8a'; c.fillRect(i * w / 4, 0, w / 4, h); }
      c.fillStyle = '#d4202f'; c.beginPath(); c.arc(w * 0.125, h / 2, 16, 0, 7); c.arc(w * 0.625, h / 2, 16, 0, 7); c.fill();
      c.fillStyle = '#f1c40f'; c.font = 'bold 13px Arial'; c.textAlign = 'center'; c.fillText('ENERGY', w * 0.375, h / 2 + 5); c.fillText('ENERGY', w * 0.875, h / 2 + 5);
    }), metalness: 0.55, roughness: 0.3 }), std({ color: 0xc8ccd2, metalness: 0.9, roughness: 0.25 }), std({ color: 0xc8ccd2, metalness: 0.9, roughness: 0.25 })]);
    can.position.y = 0.0675; g.add(can);
    return g;
  },
  homework() {
    const g = new THREE.Group();
    const red = std({ color: 0xa3182c, roughness: 0.8 });
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.003, 0.31), red); back.position.y = 0.0015; g.add(back);
    const paper = new THREE.Mesh(new THREE.BoxGeometry(0.215, 0.008, 0.28), new THREE.MeshStandardMaterial({ color: 0xf6f3ea, roughness: 0.95 }));
    paper.position.set(0.006, 0.007, 0.004); paper.rotation.y = 0.03; g.add(paper);
    const front = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.003, 0.31), [red, red, new THREE.MeshStandardMaterial({ map: tex('hw', 256, 330, (c, w, h) => {
      c.fillStyle = '#a3182c'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#fff'; c.fillRect(40, 60, w - 80, 70); c.fillStyle = '#1c2b4f'; c.font = 'bold 30px Georgia'; c.textAlign = 'center'; c.fillText('HOMEWORK', w / 2, 107);
      c.font = 'italic 18px Georgia'; c.fillStyle = '#fff'; c.fillText('AP Calc BC · Period 3', w / 2, 170);
    }), roughness: 0.8 }), red, red, red]);
    front.position.y = 0.0125; front.rotation.y = -0.05; g.add(front);
    return g;
  },
  airpods() {
    const g = new THREE.Group();
    const m = std({ color: 0xf7f7f5, roughness: 0.25 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.0115, 0.022, 4, 12), m); body.rotation.z = Math.PI / 2; body.scale.set(1, 1, 0.55); body.position.y = 0.012;
    const holder = new THREE.Group(); holder.add(body); holder.scale.set(1.0, 1, 1); g.add(holder);
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.0008, 0.014), std({ color: 0xcfcfcf })); seam.position.y = 0.017; g.add(seam);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.0012, 6, 4), new THREE.MeshBasicMaterial({ color: 0x33ff66 })); led.position.set(0, 0.012, 0.0068); g.add(led);
    return g;
  },
  rubik() {
    const g = new THREE.Group(), s = 0.057, k = s / 3;
    const core = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), std({ color: 0x111111, roughness: 0.6 })); core.position.y = s / 2; g.add(core);
    const cols = [0xff5800, 0xc41e3a, 0xffffff, 0xffd500, 0x009e60, 0x0051ba];
    const faces = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    faces.forEach((n, fi) => {
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const st = new THREE.Mesh(new THREE.PlaneGeometry(k * 0.86, k * 0.86), std({ color: cols[(fi + (a === 0 && b === 0 ? 0 : (Math.random() * 6) | 0)) % 6], roughness: 0.35 }));
        const p = new THREE.Vector3(...n).multiplyScalar(s / 2 + 0.0004);
        const u = Math.abs(n[1]) ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
        const v = new THREE.Vector3().crossVectors(new THREE.Vector3(...n), u);
        p.addScaledVector(u, a * k).addScaledVector(v, b * k); p.y += s / 2;
        st.position.copy(p); st.lookAt(p.clone().add(new THREE.Vector3(...n))); g.add(st);
      }
    });
    g.rotation.y = 0.4;
    return g;
  },
  textbook() {
    const g = new THREE.Group();
    const cover = new THREE.MeshStandardMaterial({ map: tex('book', 256, 330, (c, w, h) => {
      const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#0b3d91'); gr.addColorStop(1, '#061c44'); c.fillStyle = gr; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#7fb3ff'; c.lineWidth = 2; for (let i = 0; i < 6; i++) { c.beginPath(); c.ellipse(w / 2, 200, 30 + i * 14, 12 + i * 6, 0.3, 0, 7); c.stroke(); }
      c.fillStyle = '#fff'; c.font = 'bold 30px Georgia'; c.textAlign = 'center'; c.fillText('AP PHYSICS C', w / 2, 70); c.font = '18px Georgia'; c.fillText('Mechanics · E&M', w / 2, 100);
    }), roughness: 0.7 });
    const pages = new THREE.MeshStandardMaterial({ color: 0xf2eee2, roughness: 0.95 }), side = new THREE.MeshStandardMaterial({ color: 0x061c44, roughness: 0.7 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.205, 0.048, 0.26), [pages, side, cover, side, pages, pages]); b.position.y = 0.024; g.add(b);
    return g;
  },
};

/** A fresh model of `type`, with a soft contact shadow so it reads on any surface. */
export function buildItem(type) {
  const g = (BUILD[type] || BUILD.homework)();
  g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  const sh = new THREE.Mesh(new THREE.CircleGeometry(0.14, 16).rotateX(-Math.PI / 2), shadowMat());
  const bb = new THREE.Box3().setFromObject(g), sz = bb.getSize(new THREE.Vector3());
  sh.scale.setScalar(Math.max(sz.x, sz.z) / 0.2 + 0.1); sh.position.y = 0.002; g.add(sh);
  const root = new THREE.Group(); root.add(g); root.userData.type = type;
  return root;
}
let _shadow;
function shadowMat() {
  if (_shadow) return _shadow;
  const t = tex('shadow', 64, 64, (c, w) => { const gr = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); gr.addColorStop(0, 'rgba(0,0,0,.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, w); });
  return (_shadow = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
}

/** Semi-transparent copy for the placement preview. */
export function ghostOf(obj, ok) {
  const g = obj.clone(true);
  const m = new THREE.MeshBasicMaterial({ color: ok ? 0x5dff8a : 0xff5a5a, transparent: true, opacity: 0.45, depthWrite: false });
  g.traverse(o => { if (o.isMesh) o.material = m; });
  return g;
}
