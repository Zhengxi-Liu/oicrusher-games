/**
 * Voxel Kart Racing - builds the 3D world for a track from the shared track grid.
 *
 *   - every road / shoulder cell is a 1 m pixel-textured tile whose corner heights come from the
 *     same spline projection the physics uses (so slopes look exactly like they drive)
 *   - flat terrain is merged into long runs; height steps get vertical "block" sides
 *   - floating road edges (Sky High) get a thick dirt-and-stone underside
 *   - props: blocky trees, hedges, glowing crystals; lava, water, clouds, floating islands
 * All textures are 16x16 pixel art drawn on canvases, sampled with NearestFilter.
 */
import * as THREE from 'three';

const { SURF } = window.VKConst;
const TR = window.VKTracks;
const LOOK = TR.LOOK;

// ---------- pixel textures
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
function pix(draw, size = 16) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapLinearFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const noise = (base, vars, amount = 1) => (g, n) => {
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { g.fillStyle = rnd() < amount ? vars[Math.floor(rnd() * vars.length)] : base; g.fillRect(x, y, 1, 1); }
};
export const TEX = {};
export function makeTextures() {
  if (TEX.grass) return TEX;
  TEX.grass = pix(noise('#5fa83a', ['#57a033', '#68b544', '#4f9430', '#71bd4b'], 0.7));
  TEX.grassSide = pix((g, n) => { noise('#866043', ['#7a573b', '#94704f', '#6d4e35'], 0.7)(g, n); for (let x = 0; x < n; x++) { const d = 3 + Math.floor(rnd() * 3); for (let y = 0; y < d; y++) { g.fillStyle = ['#5fa83a', '#57a033', '#68b544'][Math.floor(rnd() * 3)]; g.fillRect(x, y, 1, 1); } } });
  TEX.dirt = pix(noise('#866043', ['#7a573b', '#94704f', '#6d4e35', '#5e4330'], 0.7));
  TEX.sand = pix(noise('#e3d39a', ['#d9c98e', '#ece0aa', '#d2c085'], 0.6));
  TEX.flower = pix((g, n) => { noise('#5fa83a', ['#57a033', '#68b544', '#4f9430'], 0.7)(g, n); for (let i = 0; i < 6; i++) { g.fillStyle = ['#ff5a5a', '#ffe14a', '#ffffff', '#c86bff'][i % 4]; g.fillRect(Math.floor(rnd() * 15), Math.floor(rnd() * 15), 2, 2); } });
  TEX.stone = pix(noise('#8a8a8a', ['#7d7d7d', '#969696', '#727272', '#a0a0a0'], 0.6));
  TEX.road = pix((g, n) => {                                     // stone bricks
    noise('#9a9a9a', ['#8e8e8e', '#a6a6a6', '#929292'], 0.5)(g, n);
    g.fillStyle = '#6c6c6c';
    g.fillRect(0, 7, n, 1); g.fillRect(0, 15, n, 1); g.fillRect(7, 0, 1, 7); g.fillRect(3, 8, 1, 7); g.fillRect(11, 8, 1, 7); g.fillRect(15, 0, 1, 7);
  });
  TEX.gravel = pix(noise('#6e6560', ['#5a524d', '#857b74', '#4a4440', '#91877f'], 0.9));
  TEX.rock = pix(noise('#3b3434', ['#332c2c', '#463d3d', '#2b2525', '#514646'], 0.8));
  TEX.planks = pix((g, n) => { noise('#a8814f', ['#9b7647', '#b48b57', '#957043'], 0.5)(g, n); g.fillStyle = '#6b4f2e'; for (const y of [3, 7, 11, 15]) g.fillRect(0, y, n, 1); g.fillRect(5, 0, 1, 3); g.fillRect(12, 4, 1, 3); g.fillRect(2, 8, 1, 3); g.fillRect(9, 12, 1, 3); });
  TEX.lava = pix(noise('#ff7a00', ['#ff5a00', '#ffb000', '#ffd23a', '#e04a00'], 0.85));
  TEX.water = pix(noise('#3a6fe0', ['#3466d4', '#4a80ee', '#2f5cc4'], 0.6));
  TEX.leaves = pix(noise('#3f8a2a', ['#357a22', '#4b9a34', '#2d6a1c', '#5aa83e'], 0.85));
  TEX.log = pix((g, n) => { noise('#6b4f2e', ['#5e4428', '#77593a'], 0.5)(g, n); g.fillStyle = '#4d3820'; for (const x of [2, 6, 10, 13]) g.fillRect(x, 0, 1, n); });
  TEX.crystal = pix(noise('#7a5cff', ['#9a80ff', '#c4b0ff', '#5a3cf0', '#3fe0ff'], 0.7));
  TEX.boost = pix((g, n) => {
    g.fillStyle = '#ff9a1a'; g.fillRect(0, 0, n, n);
    g.fillStyle = '#ffe14a';
    for (const o of [0, 8]) for (let i = 0; i < 4; i++) { g.fillRect(4 + i, o + i, 2, 1); g.fillRect(10 - i, o + i, 2, 1); }
  });
  TEX.jump = pix((g, n) => { for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { g.fillStyle = ((x + y) >> 2) % 2 ? '#ffd23a' : '#2a2a2a'; g.fillRect(x, y, 1, 1); } });
  TEX.curb = pix((g, n) => { g.fillStyle = '#e83a3a'; g.fillRect(0, 0, n, n); g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, n, n / 2); });
  TEX.checker = pix((g, n) => { for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4'; g.fillRect(x * 4, y * 4, 4, 4); } });
  TEX.box = pix((g, n) => {                                      // the mystery block
    g.fillStyle = '#f7b500'; g.fillRect(0, 0, n, n);
    g.fillStyle = '#b07400'; g.fillRect(0, 0, n, 1); g.fillRect(0, n - 1, n, 1); g.fillRect(0, 0, 1, n); g.fillRect(n - 1, 0, 1, n);
    g.fillStyle = '#ffffff';
    const q = ['..XXXX..', '.XX..XX.', '.....XX.', '....XX..', '...XX...', '...XX...', '........', '...XX...'];
    q.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === 'X') g.fillRect(4 + x, 4 + y, 1, 1); }));
  });
  TEX.cloud = pix(noise('#ffffff', ['#f2f6ff', '#e6eefc'], 0.3));
  return TEX;
}

// ---------- geometry buckets: plain arrays turned into BufferGeometry per material
class Bucket {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; }
  quad(a, b, c, d, n, uvs, shade = 1) {
    this.pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let i = 0; i < 6; i++) { this.nor.push(...n); this.col.push(shade, shade, shade); }
    const [ua, ub, uc, ud] = uvs;
    this.uv.push(...ua, ...ub, ...uc, ...ua, ...uc, ...ud);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/** A solid block (all 6 faces) into a bucket, UVs in world metres. */
export function pushBlock(B, x0, y0, z0, x1, y1, z1, shadeTop = 1) {
  B.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0], [[x0, z0], [x0, z1], [x1, z1], [x1, z0]], shadeTop);
  B.quad([x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [0, -1, 0], [[x0, z1], [x0, z0], [x1, z0], [x1, z1]], 0.55);
  B.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0], [[z0, y0], [z0, y1], [z1, y1], [z1, y0]], 0.8);
  B.quad([x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], [-1, 0, 0], [[z1, y0], [z1, y1], [z0, y1], [z0, y0]], 0.8);
  B.quad([x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1], [0, 0, 1], [[x1, y0], [x1, y1], [x0, y1], [x0, y0]], 0.9);
  B.quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [0, 0, -1], [[x0, y0], [x0, y1], [x1, y1], [x1, y0]], 0.7);
}

/**
 * Build the whole track scene. Returns { group, lava (texture to animate), water, lights, boxMeshes, hazardMeshes, update(dt, t) }.
 */
export function buildTrack(T, renderer) {
  makeTextures();
  seed = 7 + T.id.length;
  const group = new THREE.Group();
  const th = T.def.theme;
  const g = T.grid, { nx, nz, x0, z0 } = g;
  const B = {};
  const bucket = name => (B[name] = B[name] || new Bucket());
  const I = (gx, gz) => gz * nx + gx;

  // Road / shoulder corners are shared by up to four cells: give each grid corner ONE height (the
  // mean of what the neighbouring spline cells project there) so neighbouring tiles never crack.
  const corner = new Float32Array((nx + 1) * (nz + 1)).fill(NaN);
  const cornerH = (cx, cz) => {
    const k = cz * (nx + 1) + cx;
    if (!Number.isNaN(corner[k])) return corner[k];
    let sum = 0, n = 0;
    for (const [dx, dz] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
      const gx = cx + dx, gz = cz + dz;
      if (gx < 0 || gz < 0 || gx >= nx || gz >= nz) continue;
      const si = g.seg[I(gx, gz)];
      if (si >= 0) { sum += TR.segHeight(T, si, x0 + cx, z0 + cz); n++; }
    }
    return (corner[k] = n ? sum / n : 0);
  };
  // corner height of cell i at world (x, z) (a cell corner)
  const cellH = (i, x, z) => {
    const si = g.seg[i];
    if (si >= 0) return cornerH(Math.round(x - x0), Math.round(z - z0));
    if (g.look[i] === LOOK.TREE) return T.def.outsideH;          // trees are solid for physics, but stand on the ground
    return g.surf[i] === SURF.VOID ? null : g.h[i];
  };
  const isRoadEdge = (gx, gz) => {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = gx + dx, z = gz + dz;
      if (x < 0 || z < 0 || x >= nx || z >= nz) return true;
      const s = g.surf[I(x, z)];
      if (s !== SURF.ROAD && s !== SURF.BOOST && s !== SURF.JUMP) return true;
    }
    return false;
  };
  const finishSi = 0, fin = T.S[finishSi];

  // ---------- tops
  const topMat = (i, gx, gz) => {
    const s = g.surf[i], look = g.look[i];
    switch (s) {
      case SURF.ROAD: {
        const cx = x0 + gx + 0.5, cz = z0 + gz + 0.5;
        const along = (cx - fin.x) * fin.tx + (cz - fin.z) * fin.tz, lat = Math.abs((cx - fin.x) * fin.tz - (cz - fin.z) * fin.tx);
        if (Math.abs(along) < 1.6 && lat < fin.w / 2 + 0.5 && g.seg[i] < T.nMain) return 'checker';
        if (th.ground === 'grass' && T.def.shoulder > 0 && isRoadEdge(gx, gz)) return 'curb';
        return 'road';
      }
      case SURF.BOOST: return 'boost';
      case SURF.JUMP: return 'jump';
      case SURF.WOOD: return 'planks';
      case SURF.LAVA: return 'lava';
      case SURF.WATER: return 'water';
      case SURF.OFFROAD: return look === LOOK.SAND ? 'sand' : look === LOOK.FLOWER ? 'flower' : look === LOOK.GRAVEL ? 'gravel' : th.ground === 'stone' ? 'gravel' : 'grass';
      case SURF.WALL: return look === LOOK.ROCK || look === LOOK.CRYSTAL ? 'rock' : look === LOOK.HEDGE ? 'leaves' : look === LOOK.TREE ? 'grass' : 'stone';
      default: return null;
    }
  };
  const sideMat = top => (top === 'grass' || top === 'flower' || top === 'curb' || top === 'road' || top === 'checker' || top === 'boost' || top === 'jump'
    ? (th.ground === 'grass' ? 'grassSide' : 'rock') : top === 'planks' ? 'planks' : top === 'sand' ? 'sand' : top === 'leaves' ? 'leaves' : top === 'water' ? 'dirt' : top === 'lava' ? 'rock' : top === 'gravel' ? 'rock' : 'rock');

  // flat cells are merged along x; spline cells (sloped) get one tile each
  for (let gz = 0; gz < nz; gz++) {
    let run = null;
    const flush = () => {
      if (!run) return;
      const xa = x0 + run.gx0, xb = x0 + run.gx1 + 1, za = z0 + gz, zb = za + 1, y = run.h;
      bucket(run.mat).quad([xa, y, za], [xa, y, zb], [xb, y, zb], [xb, y, za], [0, 1, 0], [[xa, za], [xa, zb], [xb, zb], [xb, za]]);
      run = null;
    };
    for (let gx = 0; gx < nx; gx++) {
      const i = I(gx, gz), mat = topMat(i, gx, gz);
      if (!mat || g.seg[i] >= 0) { flush(); }
      if (!mat) continue;
      if (g.seg[i] >= 0) {
        const xa = x0 + gx, xb = xa + 1, za = z0 + gz, zb = za + 1;
        const h00 = cellH(i, xa, za), h01 = cellH(i, xa, zb), h11 = cellH(i, xb, zb), h10 = cellH(i, xb, za);
        let uvs = [[xa, za], [xa, zb], [xb, zb], [xb, za]];
        if (mat === 'boost' || mat === 'jump') {        // orient the arrows along the road
          const s = T.S[g.seg[i]];
          const uv = (x, z) => [(x * s.tz - z * s.tx), (x * s.tx + z * s.tz)];
          uvs = [uv(xa, za), uv(xa, zb), uv(xb, zb), uv(xb, za)];
        }
        bucket(mat).quad([xa, h00, za], [xa, h01, zb], [xb, h11, zb], [xb, h10, za], [0, 1, 0], uvs);
        continue;
      }
      let h = cellH(i, 0, 0);
      if (mat === 'water') h += 0.25;
      if (mat === 'lava') h += 0.0;
      if (run && run.mat === mat && run.h === h && run.gx1 === gx - 1) run.gx1 = gx;
      else { flush(); run = { mat, h, gx0: gx, gx1: gx }; }
    }
    flush();
  }

  // ---------- vertical sides where neighbouring cells differ in height (and under floating edges)
  const islandDepth = 5;
  for (let gz = 0; gz < nz; gz++) for (let gx = 0; gx < nx; gx++) {
    const i = I(gx, gz), mat = topMat(i, gx, gz);
    if (!mat) continue;
    const side = sideMat(mat);
    const xa = x0 + gx, xb = xa + 1, za = z0 + gz, zb = za + 1;
    // edges: +x, -x, +z, -z with their corner pairs (outward winding)
    const edges = [
      [1, 0, [xb, zb], [xb, za], [1, 0, 0]], [-1, 0, [xa, za], [xa, zb], [-1, 0, 0]],
      [0, 1, [xa, zb], [xb, zb], [0, 0, 1]], [0, -1, [xb, za], [xa, za], [0, 0, -1]],
    ];
    for (const [dx, dz, p, q, n] of edges) {
      const ox = gx + dx, oz = gz + dz;
      const out = ox < 0 || oz < 0 || ox >= nx || oz >= nz;
      const j = out ? -1 : I(ox, oz);
      const hp = cellH(i, p[0], p[1]), hq = cellH(i, q[0], q[1]);
      let lp, lq;
      const nmat = out ? null : topMat(j, ox, oz);
      if (out || !nmat) {
        lp = hp - (th.islands ? islandDepth : 3); lq = hq - (th.islands ? islandDepth : 3);
      } else {
        lp = cellH(j, p[0], p[1]); lq = cellH(j, q[0], q[1]);
        if (nmat === 'water') { lp += 0.25; lq += 0.25; }
      }
      if (lp === null || lq === null) { lp = hp - islandDepth; lq = hq - islandDepth; }
      if (hp - lp < 0.04 && hq - lq < 0.04) continue;
      const top = [p[0], hp, p[1]], top2 = [q[0], hq, q[1]];
      const bot = [p[0], Math.min(lp, hp), p[1]], bot2 = [q[0], Math.min(lq, hq), q[1]];
      const u0 = dx ? p[1] : p[0], u1 = dx ? q[1] : q[0];
      const shade = n[0] ? 0.82 : n[2] > 0 ? 0.92 : 0.72;
      // dirt/stone below the top metre on tall drops
      const split = Math.max(bot[1], hp - 1), split2 = Math.max(bot2[1], hq - 1);
      bucket(side).quad(bot.map((v, k) => (k === 1 ? split : v)), top, top2, bot2.map((v, k) => (k === 1 ? split2 : v)), n,
        [[u0, -split], [u0, -hp], [u1, -hq], [u1, -split2]], shade);
      if (split > bot[1] + 0.01 || split2 > bot2[1] + 0.01) {
        const deep = side === 'grassSide' ? 'dirt' : side;
        bucket(deep).quad(bot, [p[0], split, p[1]], [q[0], split2, q[1]], bot2, n, [[u0, -bot[1]], [u0, -split], [u1, -split2], [u1, -bot2[1]]], shade);
      }
    }
    // underside of floating islands
    if (th.islands && (g.seg[i] >= 0)) {
      const y = Math.min(cellH(i, xa, za), cellH(i, xb, zb)) - islandDepth;
      bucket('rockUnder').quad([xa, y, zb], [xa, y, za], [xb, y, za], [xb, y, zb], [0, -1, 0], [[xa, zb], [xa, za], [xb, za], [xb, zb]], 0.5);
    }
  }

  // ---------- props
  for (const p of T.props) {
    const gx = p.gx, gz = p.gz, xa = x0 + gx, za = z0 + gz;
    if (p.kind === LOOK.TREE) {
      const base = 0, hgt = 3 + Math.floor(p.s * 3);
      pushBlock(bucket('log'), xa + 0.2, base, za + 0.2, xa + 0.8, base + hgt, za + 0.8);
      const L = bucket('leaves');
      pushBlock(L, xa - 1, base + hgt - 1, za - 1, xa + 2, base + hgt + 1, za + 2);
      pushBlock(L, xa - 0.5, base + hgt + 1, za - 0.5, xa + 1.5, base + hgt + 2, za + 1.5);
    } else if (p.kind === LOOK.CRYSTAL) {
      const h = g.h[I(gx, gz)], C = bucket('crystal');
      pushBlock(C, xa + 0.3, h, za + 0.3, xa + 0.7, h + 1.6 + p.s * 1.6, za + 0.7);
      pushBlock(C, xa - 0.1, h, za + 0.5, xa + 0.25, h + 0.9 + p.s, za + 0.85);
      pushBlock(C, xa + 0.6, h, za - 0.1, xa + 0.95, h + 1.1, za + 0.3);
    }
  }

  // ---------- materials and meshes
  const lavaTex = TEX.lava.clone(); lavaTex.needsUpdate = true;
  const waterTex = TEX.water.clone(); waterTex.needsUpdate = true;
  const MATS = {
    grass: { map: TEX.grass }, grassSide: { map: TEX.grassSide }, dirt: { map: TEX.dirt }, sand: { map: TEX.sand }, flower: { map: TEX.flower },
    stone: { map: TEX.stone }, road: { map: TEX.road }, gravel: { map: TEX.gravel }, rock: { map: TEX.rock }, rockUnder: { map: TEX.stone },
    planks: { map: TEX.planks }, leaves: { map: TEX.leaves }, log: { map: TEX.log }, curb: { map: TEX.curb }, checker: { map: TEX.checker },
    boost: { map: TEX.boost, emissive: 0xff7a00, emissiveIntensity: 0.6 }, jump: { map: TEX.jump, emissive: 0x332200, emissiveIntensity: 0.4 },
    lava: { map: lavaTex, emissive: 0xffffff, emissiveMap: lavaTex, emissiveIntensity: 1.1 },
    water: { map: waterTex, transparent: true, opacity: 0.78 },
    crystal: { map: TEX.crystal, emissive: 0xffffff, emissiveMap: TEX.crystal, emissiveIntensity: 0.9 },
  };
  for (const [name, b] of Object.entries(B)) {
    const def = MATS[name] || { map: TEX.stone };
    const mat = new THREE.MeshLambertMaterial({ ...def, vertexColors: true, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(b.geometry(), mat);
    if (name === 'water' || name === 'lava') mesh.renderOrder = 1;
    group.add(mesh);
  }

  // ---------- sky, fog, light
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 12), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(th.sky[0]) }, bottom: { value: new THREE.Color(th.sky[1]) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float t = clamp(vP.y * 1.6 + 0.25, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, t), 1.0); }',
  }));
  group.add(sky);
  const fog = new THREE.Fog(th.fog[0], th.fog[1], th.fog[2]);
  group.add(new THREE.HemisphereLight(th.hemi[0], th.hemi[1], th.hemi[2]));
  const sun = new THREE.DirectionalLight(th.sun[0], th.sun[1]);
  sun.position.set(-120, 200, 80);
  group.add(sun);
  group.add(new THREE.AmbientLight(0xffffff, 0.25));

  // the world below: grass plain far down for the circuit, a lava sea in the cavern, clouds under the islands
  const cx = x0 + nx / 2, cz = z0 + nz / 2;
  if (th.lava) {
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshLambertMaterial({ map: lavaTex, emissive: 0xff5a00, emissiveIntensity: 0.6 }));
    sea.rotation.x = -Math.PI / 2; sea.position.set(cx, -6, cz); group.add(sea);
    // a few lava glows (point lights) over the lava lakes
    for (const r of T.def.rects || []) if (r.surf === SURF.LAVA) {
      const l = new THREE.PointLight(0xff6a1a, 60, 60, 1.6); l.position.set((r.x0 + r.x1) / 2, 2, (r.z0 + r.z1) / 2); group.add(l);
    }
    // the cave roof: rock blocks floating high above, hidden in the dark fog
    const R = bucket('rockRoof');
    for (let i = 0; i < 160; i++) {
      const x = x0 + rnd() * nx, z = z0 + rnd() * nz, s = 4 + rnd() * 10;
      pushBlock(R, x, 26 + rnd() * 8, z, x + s, 40, z + s);
      if (rnd() < 0.5) pushBlock(R, x + s * 0.3, 20 + rnd() * 6, z + s * 0.3, x + s * 0.6, 27, z + s * 0.6);
    }
    group.add(new THREE.Mesh(R.geometry(), new THREE.MeshLambertMaterial({ map: TEX.rock, vertexColors: true })));
  }
  if (th.clouds) {
    const Cb = new Bucket();
    for (let i = 0; i < 40; i++) {
      const x = cx + (rnd() - 0.5) * 900, z = cz + (rnd() - 0.5) * 900, y = (th.islands ? 40 : 70) + rnd() * 40;
      const w = 12 + rnd() * 26, d = 8 + rnd() * 18;
      pushBlock(Cb, x, y, z, x + w, y + 3, z + d);
      pushBlock(Cb, x + w * 0.2, y + 3, z + d * 0.2, x + w * 0.7, y + 5, z + d * 0.7);
    }
    if (th.islands) for (let i = 0; i < 26; i++) {           // clouds drifting below the track
      const x = cx + (rnd() - 0.5) * 700, z = cz + (rnd() - 0.5) * 700, y = -30 - rnd() * 40;
      const w = 18 + rnd() * 40, d = 12 + rnd() * 30;
      pushBlock(Cb, x, y, z, x + w, y + 4, z + d);
    }
    group.add(new THREE.Mesh(Cb.geometry(), new THREE.MeshLambertMaterial({ map: TEX.cloud, vertexColors: true, transparent: true, opacity: 0.92 })));
  }
  if (th.islands) {
    // distant floating islands: grass on top, dirt sides, a stone point hanging below
    const top = new Bucket(), side = new Bucket(), under = new Bucket();
    for (let i = 0; i < 22; i++) {
      const a = rnd() * Math.PI * 2, r = 180 + rnd() * 260;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, y = -20 + rnd() * 60, s = 10 + rnd() * 26;
      top.quad([x, y, z], [x, y, z + s], [x + s, y, z + s], [x + s, y, z], [0, 1, 0], [[x, z], [x, z + s], [x + s, z + s], [x + s, z]]);
      pushBlock(side, x, y - 3, z, x + s, y - 0.01, z + s);
      for (let k = 1; k < 5; k++) { const m = s * k * 0.11; pushBlock(under, x + m, y - 3 - k * 3, z + m, x + s - m, y - 3 - (k - 1) * 3, z + s - m); }
      if (rnd() < 0.6) { pushBlock(side, x + s / 2, y, z + s / 2, x + s / 2 + 1, y + 4, z + s / 2 + 1); }
    }
    group.add(new THREE.Mesh(top.geometry(), new THREE.MeshLambertMaterial({ map: TEX.grass, vertexColors: true })));
    group.add(new THREE.Mesh(side.geometry(), new THREE.MeshLambertMaterial({ map: TEX.grassSide, vertexColors: true })));
    group.add(new THREE.Mesh(under.geometry(), new THREE.MeshLambertMaterial({ map: TEX.stone, vertexColors: true })));
  }
  if (!th.lava && !th.islands) {
    // the circuit sits on an endless meadow
    const plain = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshLambertMaterial({ map: TEX.grass }));
    plain.material.map = TEX.grass.clone(); plain.material.map.needsUpdate = true; plain.material.map.repeat.set(2000, 2000);
    plain.rotation.x = -Math.PI / 2; plain.position.set(cx, -0.05, cz); group.add(plain);
  }

  // ---------- item boxes
  const boxGeo = new THREE.BoxGeometry(1.3, 1.3, 1.3);
  const boxMeshes = T.boxes.map((b, i) => {
    const m = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ map: TEX.box, emissive: 0x553300, transparent: true, opacity: 0.95 }));
    m.position.set(b.x, b.y, b.z); m.userData.phase = i * 0.7;
    group.add(m);
    return m;
  });

  // ---------- fireballs
  const fireGeo = new THREE.BoxGeometry(1.2, 1.2, 1.2), fireMat = new THREE.MeshBasicMaterial({ color: 0xffa020 });
  const hazardMeshes = T.hazards.map(() => {
    const m = new THREE.Group();
    const core = new THREE.Mesh(fireGeo, fireMat); m.add(core);
    const shell = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.7, 1.7), new THREE.MeshBasicMaterial({ color: 0xff4a00, transparent: true, opacity: 0.45 }));
    m.add(shell);
    const l = new THREE.PointLight(0xff7a20, 25, 14, 1.8); m.add(l);
    group.add(m);
    return m;
  });

  return {
    group, fog, boxMeshes, hazardMeshes, exposure: th.exposure,
    update(dt, t) {
      lavaTex.offset.set((t * 0.05) % 1, (t * 0.031) % 1);
      waterTex.offset.set((t * 0.02) % 1, (t * 0.013) % 1);
    },
  };
}
