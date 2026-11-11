/**
 * Bomb Arena 3D - renderer: a bright low-poly arena (grass checkerboard, stone walls and pillars,
 * wooden crates), neon bombs with sparking fuses, flame crosses, shockwaves, floating power-ups and
 * chibi bombers with antennae; particles for sparks, smoke, wood chips and pickups; a tilted overhead
 * camera with screen shake.
 */
import * as THREE from 'three';

const K = window.BAConst, AR = window.BAArena;
const { C, T, PU, COLORS } = K;
const W = AR.W, H = AR.H;

function canvasTex(size, draw) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
let seed = 3;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

const TEX = {
  crate: () => canvasTex(64, (g, n) => {
    g.fillStyle = '#c98a3f'; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 260; i++) { g.fillStyle = rnd() < 0.5 ? '#b97a33' : '#d69a4f'; g.fillRect(rnd() * n, rnd() * n, 3, 1); }
    g.strokeStyle = '#7a4a1c'; g.lineWidth = 6; g.strokeRect(3, 3, n - 6, n - 6);
    g.lineWidth = 5; g.beginPath(); g.moveTo(6, 6); g.lineTo(n - 6, n - 6); g.moveTo(n - 6, 6); g.lineTo(6, n - 6); g.stroke();
  }),
  stone: () => canvasTex(64, (g, n) => {
    g.fillStyle = '#8d93a6'; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 300; i++) { g.fillStyle = rnd() < 0.5 ? '#7f8598' : '#9aa0b3'; g.fillRect(rnd() * n, rnd() * n, 2, 2); }
    g.fillStyle = '#5f6476'; g.fillRect(0, n / 2 - 1, n, 3); g.fillRect(n / 2 - 1, 0, 3, n / 2); g.fillRect(n / 4, n / 2, 3, n / 2); g.fillRect(3 * n / 4, n / 2, 3, n / 2);
    g.strokeStyle = '#4f5466'; g.lineWidth = 3; g.strokeRect(1, 1, n - 2, n - 2);
  }),
  pillar: () => canvasTex(64, (g, n) => {
    const gr = g.createLinearGradient(0, 0, n, n); gr.addColorStop(0, '#a7aec4'); gr.addColorStop(1, '#7d849b');
    g.fillStyle = gr; g.fillRect(0, 0, n, n);
    g.strokeStyle = '#5a6075'; g.lineWidth = 4; g.strokeRect(4, 4, n - 8, n - 8);
    g.fillStyle = '#c3c9dc'; g.fillRect(10, 10, 12, 4);
  }),
};

/** Power-up icon on a coloured tile. */
function puTexture(type) {
  const bg = { [PU.BOMB]: '#3d5afe', [PU.FIRE]: '#ff5722', [PU.SPEED]: '#00c853', [PU.KICK]: '#aa00ff' }[type];
  const icon = { [PU.BOMB]: '💣', [PU.FIRE]: '🔥', [PU.SPEED]: '👟', [PU.KICK]: '🦶' }[type];
  return canvasTex(128, (g, n) => {
    g.fillStyle = bg; g.fillRect(0, 0, n, n);
    g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(0, 0, n, n / 2);
    g.strokeStyle = '#fff'; g.lineWidth = 10; g.strokeRect(5, 5, n - 10, n - 10);
    g.font = '76px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(icon, n / 2, n / 2 + 6);
  });
}

/** Chibi bomber: big round head with a visor, antenna with a ball, small body, arms and feet. */
function buildBomber(colorIdx) {
  const col = new THREE.Color(COLORS[colorIdx % COLORS.length]);
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const suit = new THREE.MeshLambertMaterial({ color: col });
  const white = new THREE.MeshLambertMaterial({ color: colorIdx === 0 ? 0xdde6ff : 0xffffff });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2a2f45 });
  const skin = new THREE.MeshLambertMaterial({ color: 0xffd7b5 });
  const pink = new THREE.MeshLambertMaterial({ color: 0xff7aa8 });
  const add = (geo, mat, x, y, z, parent = body) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
  add(new THREE.CylinderGeometry(0.2, 0.24, 0.32, 10), white, 0, 0.36, 0);                                  // torso
  add(new THREE.CylinderGeometry(0.245, 0.245, 0.06, 10), dark, 0, 0.27, 0);                               // belt
  const head = add(new THREE.SphereGeometry(0.3, 16, 12), colorIdx === 0 ? white : suit, 0, 0.78, 0);   // helmet in the player's colour
  add(new THREE.SphereGeometry(0.22, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2.2), skin, 0, 0.76, 0.12).rotation.x = Math.PI / 2;   // face
  add(new THREE.BoxGeometry(0.05, 0.1, 0.02), dark, -0.07, 0.8, 0.33); add(new THREE.BoxGeometry(0.05, 0.1, 0.02), dark, 0.07, 0.8, 0.33);   // eyes
  add(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 6), dark, 0, 1.12, 0);                                    // antenna
  const ball = add(new THREE.SphereGeometry(0.07, 10, 8), pink, 0, 1.25, 0);
  ball.material = new THREE.MeshLambertMaterial({ color: col, emissive: col, emissiveIntensity: 0.4 });
  const arm = s => { const g = new THREE.Group(); g.position.set(s * 0.25, 0.46, 0); body.add(g); add(new THREE.SphereGeometry(0.08, 8, 6), white, 0, -0.1, 0, g); return g; };
  const leg = s => { const g = new THREE.Group(); g.position.set(s * 0.1, 0.2, 0); body.add(g); add(new THREE.BoxGeometry(0.13, 0.12, 0.2), suit, 0, -0.12, 0.03, g); return g; };
  return { root, body, head, arms: [arm(-1), arm(1)], legs: [leg(-1), leg(1)], phase: 0, yaw: 0, dead: 0 };
}

function buildBomb() {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 1), new THREE.MeshStandardMaterial({ color: 0x1b1e2b, roughness: 0.35, metalness: 0.4, flatShading: true }));
  shell.position.y = 0.36; shell.castShadow = true; g.add(shell);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 8, 24), new THREE.MeshBasicMaterial({ color: 0x00e5ff }));
  band.rotation.x = Math.PI / 2; band.position.y = 0.36; g.add(band);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.1, 8), new THREE.MeshLambertMaterial({ color: 0x8892a6 }));
  cap.position.y = 0.72; g.add(cap);
  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 6), new THREE.MeshLambertMaterial({ color: 0xc8b48a }));
  fuse.position.set(0.04, 0.82, 0); fuse.rotation.z = -0.4; g.add(fuse);
  return { g, shell, band };
}

export class Renderer3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.r.setPixelRatio(Math.min(1.5, devicePixelRatio || 1));
    this.r.shadowMap.enabled = true; this.r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.r.toneMapping = THREE.ACESFilmicToneMapping; this.r.toneMappingExposure = 1.1;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8fd3ff);
    this.scene.fog = new THREE.Fog(0x8fd3ff, 40, 90);
    this.camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 200);
    this.time = 0; this.shake = 0;
    this.players = new Map(); this.bombs = new Map(); this.pus = new Map();
    this.tex = { crate: TEX.crate(), stone: TEX.stone(), pillar: TEX.pillar() };
    this.puTex = {}; for (const t of [PU.BOMB, PU.FIRE, PU.SPEED, PU.KICK]) this.puTex[t] = puTexture(t);
    this.buildWorld();
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

  buildWorld() {
    const S = this.scene;
    S.add(new THREE.HemisphereLight(0xdff3ff, 0x5a8a3a, 1.2));
    const sun = new THREE.DirectionalLight(0xfff2d6, 2.4);
    sun.position.set(W / 2 - 8, 22, H / 2 + 6); sun.target.position.set(W / 2, 0, H / 2);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 60 });
    sun.shadow.bias = -0.0005;
    S.add(sun, sun.target);

    // floor: a checkerboard of two greens, slightly raised tiles inside the walls
    const ftex = canvasTex(W * 8, (g, n) => {
      for (let z = 0; z < W; z++) for (let x = 0; x < W; x++) { g.fillStyle = (x + z) % 2 ? '#6cc24a' : '#78cf55'; g.fillRect(x * 8, z * 8, 8, 8); }
    });
    ftex.magFilter = THREE.NearestFilter;
    ftex.repeat.set(1, H / W);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshLambertMaterial({ map: ftex }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(W / 2, 0, H / 2); floor.receiveShadow = true; S.add(floor);
    // the ground around the arena
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshLambertMaterial({ color: 0x4f9a3a }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(W / 2, -0.02, H / 2); ground.receiveShadow = true; S.add(ground);

    // instanced walls / pillars / crates
    const max = W * H;
    const mk = (geo, mat) => { const m = new THREE.InstancedMesh(geo, mat, max); m.castShadow = true; m.receiveShadow = true; m.count = 0; S.add(m); return m; };
    this.wallMesh = mk(new THREE.BoxGeometry(1, 1.15, 1), new THREE.MeshLambertMaterial({ map: this.tex.stone }));
    this.pillarMesh = mk(new THREE.BoxGeometry(0.96, 1, 0.96), new THREE.MeshLambertMaterial({ map: this.tex.pillar }));
    this.crateMesh = mk(new THREE.BoxGeometry(0.88, 0.88, 0.88), new THREE.MeshLambertMaterial({ map: this.tex.crate }));
    this.flameMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.92, 0.7, 0.92), new THREE.MeshBasicMaterial({ color: 0xffb02a, transparent: true, opacity: 0.85 }), max);
    this.flameMesh.count = 0; S.add(this.flameMesh);
    this.flameCore = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 0.9, 0.55), new THREE.MeshBasicMaterial({ color: 0xfff3b0 }), max);
    this.flameCore.count = 0; S.add(this.flameCore);
    this.dropping = [];             // sudden-death blocks still falling
    this.rings = [];
    this.flashLight = new THREE.PointLight(0xffa040, 0, 12, 1.6); S.add(this.flashLight);
  }

  /** Rebuild the static instances when the grid changed. */
  setGrid(tiles) {
    const m4 = new THREE.Matrix4();
    let w = 0, p = 0, c = 0;
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      const t = tiles[z * W + x];
      if (t === T.WALL) {
        const border = x === 0 || z === 0 || x === W - 1 || z === H - 1;
        const pillar = !border && x % 2 === 0 && z % 2 === 0;
        if (pillar) { m4.makeTranslation(x + 0.5, 0.5, z + 0.5); this.pillarMesh.setMatrixAt(p++, m4); }
        else { m4.makeTranslation(x + 0.5, 0.575, z + 0.5); this.wallMesh.setMatrixAt(w++, m4); }
      } else if (t === T.CRATE) { m4.makeTranslation(x + 0.5, 0.44, z + 0.5); this.crateMesh.setMatrixAt(c++, m4); }
    }
    this.wallMesh.count = w; this.pillarMesh.count = p; this.crateMesh.count = c;
    for (const m of [this.wallMesh, this.pillarMesh, this.crateMesh]) m.instanceMatrix.needsUpdate = true;
  }

  ensurePlayer(id, color, name, isMe) {
    let pm = this.players.get(id);
    if (pm && pm.color === color) return pm;
    if (pm) this.scene.remove(pm.root);
    pm = buildBomber(color); pm.color = color;
    const c = document.createElement('canvas'); c.width = 256; c.height = 48;
    const x = c.getContext('2d');
    x.font = 'bold 28px system-ui, sans-serif'; x.textAlign = 'center';
    x.fillStyle = 'rgba(0,0,0,.45)'; x.beginPath(); x.roundRect(28, 6, 200, 36, 18); x.fill();
    x.fillStyle = isMe ? '#ffe14a' : '#fff'; x.fillText(name.slice(0, 14), 128, 34);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
    label.scale.set(1.9, 0.36, 1); label.position.y = 1.55; label.renderOrder = 5;
    pm.root.add(label);
    this.scene.add(pm.root);
    this.players.set(id, pm);
    return pm;
  }
  dropPlayersExcept(ids) { for (const [id, pm] of this.players) if (!ids.has(id)) { this.scene.remove(pm.root); this.players.delete(id); } }

  // ---------- particles: square points
  buildParticles() {
    const n = 3000, geo = new THREE.BufferGeometry();
    this.pp = { n, pos: new Float32Array(n * 3).fill(-999), col: new Float32Array(n * 3), vel: new Float32Array(n * 3), life: new Float32Array(n),
                max: new Float32Array(n), grav: new Float32Array(n), base: new Float32Array(n * 3), next: 0 };
    geo.setAttribute('position', new THREE.BufferAttribute(this.pp.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pp.col, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.14, vertexColors: true, transparent: true, depthWrite: false }));
    this.points.frustumCulled = false; this.scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, life, grav, hex) {
    const P = this.pp, i = P.next; P.next = (P.next + 1) % P.n;
    const c = new THREE.Color(hex);
    P.pos.set([x, y, z], i * 3); P.vel.set([vx, vy, vz], i * 3); P.base.set([c.r, c.g, c.b], i * 3);
    P.life[i] = life; P.max[i] = life; P.grav[i] = grav;
  }
  burst(x, y, z, n, speed, colors, life = 0.7, grav = 9) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, u = Math.random(), s = speed * (0.3 + Math.random() * 0.7);
      this.emit(x, y, z, Math.cos(a) * s * (1 - u * 0.5), u * s + 1, Math.sin(a) * s * (1 - u * 0.5), life * (0.5 + Math.random() * 0.7), grav, colors[i % colors.length]);
    }
  }
  stepParticles(dt) {
    const P = this.pp, k = Math.pow(0.3, dt);
    for (let i = 0; i < P.n; i++) {
      if (P.life[i] <= 0) continue;
      P.life[i] -= dt;
      if (P.life[i] <= 0) { P.pos[i * 3 + 1] = -999; continue; }
      P.vel[i * 3 + 1] -= P.grav[i] * dt;
      P.vel[i * 3] *= k; P.vel[i * 3 + 2] *= k;
      P.pos[i * 3] += P.vel[i * 3] * dt; P.pos[i * 3 + 1] = Math.max(0.03, P.pos[i * 3 + 1] + P.vel[i * 3 + 1] * dt); P.pos[i * 3 + 2] += P.vel[i * 3 + 2] * dt;
      const f = Math.min(1, P.life[i] / P.max[i] * 1.6);
      P.col[i * 3] = P.base[i * 3] * f; P.col[i * 3 + 1] = P.base[i * 3 + 1] * f; P.col[i * 3 + 2] = P.base[i * 3 + 2] * f;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  // ---------- one-shot effects
  explosion(cx, cz, tiles, near) {
    const x = cx + 0.5, z = cz + 0.5;
    for (let i = 0; i < tiles.length; i += 2) this.burst(tiles[i] + 0.5, 0.4, tiles[i + 1] + 0.5, 10, 3.5, [0xffd23a, 0xff7a1a, 0xff3d1a], 0.5, 2);
    this.burst(x, 0.6, z, 30, 6, [0x555a66, 0x777c88, 0xffd23a], 1.0, -1);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.55, 32), new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.08, z); this.scene.add(ring); this.rings.push({ m: ring, t: 0 });
    this.flashLight.position.set(x, 1.5, z); this.flashLight.intensity = 40;
    this.shake = Math.min(1, this.shake + (near ? 0.55 : 0.18));
  }
  crateBreak(cx, cz) { this.burst(cx + 0.5, 0.5, cz + 0.5, 22, 4, [0xc98a3f, 0x8a5a26, 0xe0b070], 0.9, 14); }
  pickupFx(x, z, type) { this.burst(x, 0.8, z, 24, 3, [{ 1: 0x3d5afe, 2: 0xff5722, 3: 0x00c853, 4: 0xaa00ff }[type], 0xffffff], 0.6, -2); }
  deathFx(x, z, color) { this.burst(x, 0.7, z, 40, 4.5, [COLORS[color], 0xffffff, 0x333333], 1.0, 6); }
  dropBlock(cx, cz) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1.15, 1), new THREE.MeshLambertMaterial({ map: this.tex.stone, color: 0xffb0b0 }));
    m.position.set(cx + 0.5, 9, cz + 0.5); m.castShadow = true; this.scene.add(m);
    this.dropping.push({ m, cx, cz });
  }

  /**
   * view: { dt, players [{id,x,z,face,alive,moving,color,name,me,speed}], bombs [{id,x,z,fuse,owner}],
   *         flames [[tileIdx, ticksLeft]], powerups [[tileIdx, type]], focus {x, z} | null }
   */
  render(v) {
    const dt = v.dt;
    this.time += dt;
    // players
    const seen = new Set();
    for (const q of v.players) {
      seen.add(q.id);
      const pm = this.ensurePlayer(q.id, q.color, q.name, q.me);
      const wantYaw = [Math.PI, Math.PI / 2, 0, -Math.PI / 2][q.face | 0];
      let d = wantYaw - pm.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      pm.yaw += d * Math.min(1, dt * 16);
      if (q.alive) {
        if (pm.dead) { pm.dead = 0; pm.root.scale.setScalar(1); pm.root.visible = true; }
        pm.phase += dt * (q.moving ? 12 + (q.speed | 0) * 1.5 : 0);
        const sw = q.moving ? Math.sin(pm.phase) : 0;
        pm.legs[0].rotation.x = sw * 0.7; pm.legs[1].rotation.x = -sw * 0.7;
        pm.arms[0].rotation.x = -sw * 0.8; pm.arms[1].rotation.x = sw * 0.8;
        pm.body.position.y = q.moving ? Math.abs(Math.sin(pm.phase)) * 0.06 : Math.sin(this.time * 3 + q.id) * 0.015;
        pm.root.position.set(q.x, 0, q.z);
        pm.root.rotation.set(0, pm.yaw, 0);
      } else {
        pm.dead = (pm.dead || 0) + dt;
        const k = Math.max(0, 1 - pm.dead * 1.4);
        pm.root.rotation.set(0, pm.yaw + pm.dead * 14, 0);
        pm.root.scale.set(k, k * (1 + pm.dead), k);
        pm.root.visible = k > 0.02;
      }
    }
    for (const [id, pm] of this.players) if (!seen.has(id)) { this.scene.remove(pm.root); this.players.delete(id); }

    // bombs
    const bseen = new Set();
    for (const b of v.bombs) {
      bseen.add(b.id);
      let bm = this.bombs.get(b.id);
      if (!bm) { bm = buildBomb(); this.scene.add(bm.g); this.bombs.set(b.id, bm); bm.band.material = new THREE.MeshBasicMaterial({ color: COLORS[b.color || 0] === 0x2b2b2b ? 0x00e5ff : COLORS[b.color || 0] }); }
      bm.g.position.set(b.x, 0, b.z);
      const urgency = 1 - Math.max(0, b.fuse) / C.FUSE;
      const pulse = 1 + Math.sin(this.time * (6 + urgency * 26)) * (0.05 + urgency * 0.08);
      bm.shell.scale.setScalar(pulse);
      bm.band.material.color.offsetHSL(0, 0, 0);
      bm.shell.material.emissive = bm.shell.material.emissive || new THREE.Color();
      bm.shell.material.emissive.setRGB(urgency > 0.7 && Math.sin(this.time * 30) > 0 ? 0.5 : 0, 0, 0);
      if (Math.random() < dt * 40) this.emit(b.x + 0.1, 0.92, b.z, (Math.random() - 0.5) * 1.5, 1.5 + Math.random(), (Math.random() - 0.5) * 1.5, 0.3, 4, Math.random() < 0.5 ? 0xffe14a : 0xff7a1a);
    }
    for (const [id, bm] of this.bombs) if (!bseen.has(id)) { this.scene.remove(bm.g); this.bombs.delete(id); }

    // flames
    const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3();
    let n = 0;
    for (const [i, t] of v.flames) {
      const x = i % W + 0.5, z = Math.floor(i / W) + 0.5, k = Math.min(1, t / (C.FLAME_TICKS * 0.6));
      const fl = 0.85 + Math.sin(this.time * 40 + i) * 0.15;
      p3.set(x, 0.35 * k, z); s3.set(k * fl, k * (0.8 + fl * 0.4), k * fl); m4.compose(p3, q4, s3);
      this.flameMesh.setMatrixAt(n, m4);
      p3.set(x, 0.45 * k, z); s3.set(k, k * fl, k); m4.compose(p3, q4, s3);
      this.flameCore.setMatrixAt(n, m4);
      n++;
      if (Math.random() < dt * 20) this.emit(x + (Math.random() - 0.5) * 0.6, 0.6, z + (Math.random() - 0.5) * 0.6, 0, 2, 0, 0.4, -1, Math.random() < 0.5 ? 0xff7a1a : 0xffd23a);
    }
    this.flameMesh.count = this.flameCore.count = n;
    this.flameMesh.instanceMatrix.needsUpdate = this.flameCore.instanceMatrix.needsUpdate = true;

    // power-ups
    const pseen = new Set();
    for (const [i, type] of v.powerups) {
      const key = i + ':' + type;
      pseen.add(key);
      let m = this.pus.get(key);
      if (!m) {
        m = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.62), new THREE.MeshLambertMaterial({ map: this.puTex[type], emissive: 0x222222 }));
        m.castShadow = true; m.position.set(i % W + 0.5, 0.45, Math.floor(i / W) + 0.5); m.userData.t = 0;
        this.scene.add(m); this.pus.set(key, m);
      }
      m.userData.t += dt;
      m.rotation.y = this.time * 1.5; m.position.y = 0.45 + Math.sin(this.time * 3 + i) * 0.08;
      m.scale.setScalar(Math.min(1, m.userData.t * 5));
    }
    for (const [k, m] of this.pus) if (!pseen.has(k)) { this.scene.remove(m); this.pus.delete(k); }

    // falling sudden-death blocks
    this.dropping = this.dropping.filter(d => {
      d.m.position.y -= dt * 22;
      if (d.m.position.y <= 0.575) { this.scene.remove(d.m); this.burst(d.cx + 0.5, 0.2, d.cz + 0.5, 14, 3, [0x8d93a6, 0x5f6476], 0.6, 10); this.shake = Math.min(1, this.shake + 0.08); return false; }
      return true;
    });
    // shockwave rings, flash
    this.rings = this.rings.filter(r => {
      r.t += dt; const s = 1 + r.t * 9; r.m.scale.set(s, s, s); r.m.material.opacity = Math.max(0, 0.9 - r.t * 2.4);
      if (r.t > 0.4) { this.scene.remove(r.m); return false; }
      return true;
    });
    this.flashLight.intensity *= Math.pow(0.002, dt);
    this.stepParticles(dt);

    // camera: tilted overhead, drifting a little toward the player we follow
    const f = v.focus || { x: W / 2, z: H / 2 };
    const cx = W / 2 + (f.x - W / 2) * 0.35, cz = H / 2 + (f.z - H / 2) * 0.3;
    this.camT = this.camT || { x: cx, z: cz };
    this.camT.x += (cx - this.camT.x) * Math.min(1, dt * 3); this.camT.z += (cz - this.camT.z) * Math.min(1, dt * 3);
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const sx = (Math.random() - 0.5) * this.shake * 0.5, sy = (Math.random() - 0.5) * this.shake * 0.5;
    const aspectFit = Math.max(1, 1.45 / this.camera.aspect);
    this.camera.position.set(this.camT.x + sx, 17.5 * aspectFit + sy, this.camT.z + 11.5 * aspectFit);
    this.camera.lookAt(this.camT.x, 0, this.camT.z + 0.6);
    this.r.render(this.scene, this.camera);
  }
}
