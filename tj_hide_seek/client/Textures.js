/**
 * Procedural textures for TJ Hide and Seek - all drawn on canvases, nothing to download.
 * Colours follow the reference photos: speckled terrazzo, cream wall tile with navy accent tiles,
 * navy-blue lockers, red brick outside with a white band upstairs, crimson TJ signage.
 * Every repeating texture is laid out for UVs in metres (see `M`: how many metres one tile covers).
 */
import * as THREE from 'three';

export const CRIMSON = '#9b1b30', NAVY = '#1c2b4f';
const rnd = (() => { let s = 20240917; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();

function canvasTex(w, h, draw, { repeat = true, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function speckle(g, w, h, n, colors, size = [1, 3]) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[(rnd() * colors.length) | 0];
    const s = size[0] + rnd() * (size[1] - size[0]);
    g.fillRect(rnd() * w, rnd() * h, s, s * (0.6 + rnd() * 0.8));
  }
}
function noise(g, w, h, n, alpha) {
  for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${alpha * rnd()})`; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
}

/** Metres covered by one repeat of each tiling texture (u, v). */
export const M = {
  terrazzo: [3, 3], vct: [2.4, 2.4], wood: [4, 4], carpet: [3, 3], ceiling: [2.4, 2.4], grass: [6, 6], asphalt: [8, 8],
  concrete: [3, 3], hallWall: [4, 1], roomWall: [4, 1], windowWall: [4, 1], brick1: [4, 1], brick2: [4, 1], pavers: [2, 2],
};

export function makeTextures() {
  const T = {};
  T.terrazzo = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#d8d4ca'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 9000, ['#3b3f49', '#555a66', '#8a8d93', '#f4f2ec', '#b9b4a8', '#2a2d35'], [1, 3.4]);
    g.strokeStyle = 'rgba(120,115,105,.25)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, 1); g.lineTo(w, 1); g.moveTo(1, 0); g.lineTo(1, h); g.stroke();
  });
  T.vct = canvasTex(256, 256, (g, w, h) => {           // classroom floor tile, 30 cm squares
    const n = 8, s = w / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const v = 226 + ((rnd() * 14) | 0);
      g.fillStyle = `rgb(${v},${v - 4},${v - 14})`; g.fillRect(i * s, j * s, s, s);
    }
    speckle(g, w, h, 1500, ['rgba(150,140,120,.35)', 'rgba(255,255,255,.4)'], [1, 2]);
    g.strokeStyle = 'rgba(140,130,115,.35)'; g.lineWidth = 1;
    for (let k = 0; k <= n; k++) { g.beginPath(); g.moveTo(k * s, 0); g.lineTo(k * s, h); g.moveTo(0, k * s); g.lineTo(w, k * s); g.stroke(); }
  });
  T.wood = canvasTex(512, 512, (g, w, h) => {          // gym maple
    const rows = 32, rh = h / rows;
    for (let r = 0; r < rows; r++) {
      let x = -rnd() * 200;
      while (x < w) {
        const len = 120 + rnd() * 220, v = 196 + ((rnd() * 26) | 0);
        g.fillStyle = `rgb(${v},${(v * 0.78) | 0},${(v * 0.5) | 0})`; g.fillRect(x, r * rh, len, rh - 1);
        g.fillStyle = 'rgba(90,50,20,.35)'; g.fillRect(x, r * rh, 1, rh);
        x += len;
      }
    }
    noise(g, w, h, 4000, 0.06);
  });
  T.carpet = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#3d4a63'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 7000, ['#4b5a78', '#323d54', '#56637e', '#2b3448', '#6a3442'], [1, 2]);
  });
  T.ceiling = canvasTex(512, 512, (g, w, h) => {        // 60 cm acoustic tiles, one 2x4 light panel per 2.4 m
    g.fillStyle = '#eceae4'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 5000, ['rgba(160,155,145,.45)', 'rgba(120,115,110,.3)'], [1, 2]);
    g.strokeStyle = '#c9c6bd'; g.lineWidth = 4;
    for (let k = 0; k <= 4; k++) { const p = k * w / 4; g.beginPath(); g.moveTo(p, 0); g.lineTo(p, h); g.moveTo(0, p); g.lineTo(w, p); g.stroke(); }
    g.fillStyle = '#ffffff'; g.fillRect(w / 4 + 4, h / 4 + 4, w / 4 - 8, h / 2 - 8);
    g.strokeStyle = '#d9d9d9'; g.lineWidth = 3; g.strokeRect(w / 4 + 6, h / 4 + 6, w / 4 - 12, h / 2 - 12);
  });
  T.ceilingGlow = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fffbe8'; g.fillRect(w / 4 + 6, h / 4 + 6, w / 4 - 12, h / 2 - 12);
  });
  // walls: v covers the whole wall height (0 at the floor, 1 at the ceiling = 4.2 m); u repeats every 4 m
  const wallH = 4.2, PX = 128;              // px per metre
  const yPx = y => (1 - y / wallH) * wallH * PX;
  T.hallWall = canvasTex(4 * PX, wallH * PX, (g, w, h) => {
    g.fillStyle = '#e9e1cc'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(165,155,130,.55)'; g.lineWidth = 2;
    for (let y = 0; y < h; y += 0.2 * PX) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    for (let r = 0; r * 0.2 < wallH; r++) for (let x = (r % 2) * 0.2 * PX; x < w; x += 0.4 * PX) {
      g.beginPath(); g.moveTo(x, h - r * 0.2 * PX); g.lineTo(x, h - (r + 1) * 0.2 * PX); g.stroke();
    }
    // navy accent tiles (as in the hallway photo): a broken band at ~1.1 m and a few vertical grey strips
    g.fillStyle = '#2d4a7a';
    g.fillRect(0.2 * PX, yPx(1.3), 1.6 * PX, 0.2 * PX); g.fillRect(2.4 * PX, yPx(1.1), 1.2 * PX, 0.2 * PX);
    g.fillRect(0.6 * PX, yPx(0.7), 0.8 * PX, 0.2 * PX);
    g.fillStyle = '#9da3ab'; g.fillRect(2.0 * PX, yPx(2.3), 0.2 * PX, 1.4 * PX); g.fillRect(3.6 * PX, yPx(1.9), 0.2 * PX, 1.0 * PX);
    g.fillStyle = '#6b6e75'; g.fillRect(0, yPx(0.12), w, 0.12 * PX);        // base
    noise(g, w, h, 3000, 0.05);
  });
  const painted = (g, w, h) => {
    g.fillStyle = '#ecebe5'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(180,178,170,.4)'; g.lineWidth = 2;               // painted block
    for (let r = 0; r * 0.2 < wallH; r++) {
      const y = h - r * 0.2 * PX; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
      for (let x = (r % 2) * 0.2 * PX; x < w; x += 0.4 * PX) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 0.2 * PX); g.stroke(); }
    }
    g.fillStyle = '#5d6168'; g.fillRect(0, yPx(0.1), w, 0.1 * PX);
  };
  T.roomWall = canvasTex(4 * PX, wallH * PX, painted);
  T.windowWall = canvasTex(4 * PX, wallH * PX, (g, w, h) => {
    painted(g, w, h);
    const x0 = 0.7 * PX, x1 = 3.3 * PX, y0 = yPx(2.7), y1 = yPx(0.95);
    const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, '#bcd8f0'); gr.addColorStop(0.65, '#e3f0f8'); gr.addColorStop(1, '#a9c58f');
    g.fillStyle = gr; g.fillRect(x0, y0, x1 - x0, y1 - y0);
    g.strokeStyle = '#8f949b'; g.lineWidth = 8; g.strokeRect(x0, y0, x1 - x0, y1 - y0);
    g.lineWidth = 5; g.beginPath(); g.moveTo((x0 + x1) / 2, y0); g.lineTo((x0 + x1) / 2, y1); g.moveTo(x0, y0 + (y1 - y0) * 0.3); g.lineTo(x1, y0 + (y1 - y0) * 0.3); g.stroke();
    g.fillStyle = '#c7c9cc'; g.fillRect(x0 - 6, y1, x1 - x0 + 12, 10);
  });
  const brick = (g, w, h, y0px, y1px) => {
    g.fillStyle = '#8e4c38'; g.fillRect(0, y0px, w, y1px - y0px);
    const bh = 0.075 * PX, bw = 0.2 * PX;
    for (let y = y1px, r = 0; y > y0px; y -= bh, r++) for (let x = (r % 2) * bw / 2 - bw; x < w; x += bw) {
      const v = rnd();
      g.fillStyle = `rgb(${(130 + v * 40) | 0},${(62 + v * 22) | 0},${(44 + v * 16) | 0})`;
      g.fillRect(x + 1, y - bh + 1, bw - 2, bh - 2);
    }
  };
  const extWindow = (g, x, y, ww, hh) => {
    g.fillStyle = '#e4e4e0'; g.fillRect(x - 6, y - 6, ww + 12, hh + 12);
    const gr = g.createLinearGradient(0, y, 0, y + hh); gr.addColorStop(0, '#3e5868'); gr.addColorStop(0.5, '#6f8e9e'); gr.addColorStop(1, '#2c3e4a');
    g.fillStyle = gr; g.fillRect(x, y, ww, hh);
    g.strokeStyle = '#d7d9d6'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(x + ww / 2, y); g.lineTo(x + ww / 2, y + hh); g.moveTo(x, y + hh * 0.35); g.lineTo(x + ww, y + hh * 0.35); g.stroke();
  };
  const extH = 4.5;
  T.brick1 = canvasTex(4 * PX, extH * PX, (g, w, h) => {      // floor 1 outside: brick, one window per 4 m
    brick(g, w, h, 0, h);
    g.fillStyle = '#7a7a76'; g.fillRect(0, h - 0.3 * PX, w, 0.3 * PX);
    extWindow(g, 1.0 * PX, h - 3.0 * PX, 2.0 * PX, 1.7 * PX);
    g.fillStyle = '#d8d6cf'; g.fillRect(0, 0, w, 0.25 * PX);
  });
  T.brick2 = canvasTex(4 * PX, extH * PX, (g, w, h) => {      // floor 2 outside: brick, windows, white band on top
    brick(g, w, h, 0.9 * PX, h);
    extWindow(g, 1.0 * PX, h - 3.0 * PX, 2.0 * PX, 1.7 * PX);
    g.fillStyle = '#f1f1ee'; g.fillRect(0, 0, w, 0.9 * PX);
    g.fillStyle = '#c9c9c4'; g.fillRect(0, 0.9 * PX - 6, w, 6); g.fillRect(0, 0, w, 8);
  });
  T.grass = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#5f8a3a'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 9000, ['#6e9a45', '#557d33', '#7aa64e', '#4d722e'], [1, 3]);
  });
  T.asphalt = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#4a4c50'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 8000, ['#55575c', '#3e4044', '#62646a', '#36383c'], [1, 2]);
  });
  T.concrete = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#c9c7c0'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 4000, ['#d3d1ca', '#bdbbb4', '#b0aea7'], [1, 2]);
    g.strokeStyle = '#a7a59e'; g.lineWidth = 2; g.strokeRect(0, 0, w, h);
  });
  T.pavers = canvasTex(256, 256, (g, w, h) => {
    const n = 4, s = w / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const v = 170 + rnd() * 30; g.fillStyle = `rgb(${v},${v * 0.92},${v * 0.84})`; g.fillRect(i * s + 2, j * s + 2, s - 4, s - 4); }
  });
  T.locker = canvasTex(256, 512, (g, w, h) => {             // one unit = 3 lockers (0.9 x 1.8 m)
    g.fillStyle = '#26467d'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3; i++) {
      const x = i * w / 3;
      g.fillStyle = '#2b5191'; g.fillRect(x + 4, 4, w / 3 - 8, h - 8);
      g.fillStyle = '#1b3463';
      for (let k = 0; k < 5; k++) { g.fillRect(x + 18, 24 + k * 9, w / 3 - 36, 4); g.fillRect(x + 18, h - 70 + k * 9, w / 3 - 36, 4); }
      g.fillStyle = '#b8bec8'; g.fillRect(x + w / 3 - 22, h * 0.48, 8, 34);
      g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(x + 6, 6, 6, h - 12);
    }
  }, { repeat: false });
  T.books = canvasTex(256, 512, (g, w, h) => {              // a 4-shelf bookcase face
    g.fillStyle = '#6b4a2e'; g.fillRect(0, 0, w, h);
    const cols = ['#9b1b30', '#1c2b4f', '#2f6b3a', '#c49a2c', '#5a2d6e', '#a24d1d', '#e4e0d4', '#2f5d8a', '#333'];
    for (let s = 0; s < 4; s++) {
      const y0 = 10 + s * (h - 20) / 4, sh = (h - 20) / 4 - 12;
      g.fillStyle = '#3a2716'; g.fillRect(8, y0, w - 16, sh);
      let x = 10;
      while (x < w - 14) {
        const bw = 6 + rnd() * 10, bh = sh * (0.7 + rnd() * 0.28);
        g.fillStyle = cols[(rnd() * cols.length) | 0]; g.fillRect(x, y0 + sh - bh, bw - 1, bh);
        g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(x + 1, y0 + sh - bh + 6, bw - 3, 2);
        x += bw;
      }
    }
  }, { repeat: false });
  // 16 different whiteboards in one atlas (4 x 4 boards of 512 x 256): physics, math and English lessons
  T.whiteboard = canvasTex(2048, 1024, g => { for (let i = 0; i < BOARDS; i++) drawBoard(g, (i % 4) * 512, Math.floor(i / 4) * 256, i); }, { repeat: false });
  T.boardUV = i => { const k = i % BOARDS, x = (k % 4) / 4, y = Math.floor(k / 4) / 4; return [x, 1 - y - 0.25, x + 0.25, 1 - y]; };
  T.vending = canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = '#1a1a1e'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#0d2747'; g.fillRect(10, 10, w - 70, h - 120);
    const cans = ['#2c5ea8', '#c41e3a', '#e8e8e8', '#f2b705', '#2b8a3e', '#1d1d1d'];
    for (let r = 0; r < 6; r++) for (let c = 0; c < 5; c++) {
      g.fillStyle = cans[(r + c * 2) % cans.length]; g.fillRect(20 + c * 34, 26 + r * 62, 24, 44);
      g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(22 + c * 34, 28 + r * 62, 5, 40);
    }
    g.fillStyle = CRIMSON; g.fillRect(w - 54, 10, 44, h - 120);
    g.fillStyle = '#fff'; g.font = 'bold 22px Arial'; g.save(); g.translate(w - 26, h / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText('COLD DRINKS', 0, 8); g.restore();
    g.fillStyle = '#333'; g.fillRect(20, h - 90, w - 40, 60);
  }, { repeat: false });
  T.seal = canvasTex(1024, 1024, (g, w) => {                 // the floor medallion in the Dome
    const c = w / 2;
    g.fillStyle = '#d8d4ca'; g.fillRect(0, 0, w, w);
    speckle(g, w, w, 20000, ['#3b3f49', '#8a8d93', '#f4f2ec', '#b9b4a8'], [1, 3]);
    g.fillStyle = NAVY; g.beginPath(); g.arc(c, c, 470, 0, 7); g.fill();
    g.fillStyle = '#e9e4d6'; g.beginPath(); g.arc(c, c, 440, 0, 7); g.fill();
    g.fillStyle = CRIMSON; g.beginPath(); g.arc(c, c, 330, 0, 7); g.fill();
    g.fillStyle = '#e9e4d6'; g.beginPath(); g.arc(c, c, 300, 0, 7); g.fill();
    g.fillStyle = NAVY; g.font = 'bold 54px Georgia'; g.textAlign = 'center';
    const txt = 'THOMAS JEFFERSON HIGH SCHOOL FOR SCIENCE AND TECHNOLOGY • ';
    for (let i = 0; i < txt.length; i++) {
      g.save(); g.translate(c, c); g.rotate((i / txt.length) * Math.PI * 2); g.fillText(txt[i], 0, -365); g.restore();
    }
    g.fillStyle = CRIMSON; g.font = 'bold 230px Georgia'; g.fillText('TJ', c, c + 80);
    g.fillStyle = NAVY; g.font = 'bold 48px Georgia'; g.fillText('EST. 1985', c, c + 170);
    for (let k = 0; k < 16; k++) { g.save(); g.translate(c, c); g.rotate(k / 16 * Math.PI * 2); g.fillStyle = NAVY; g.beginPath(); g.moveTo(0, -300); g.lineTo(10, -335); g.lineTo(-10, -335); g.fill(); g.restore(); }
  }, { repeat: false });
  T.flag = canvasTex(256, 136, (g, w, h) => {
    for (let i = 0; i < 13; i++) { g.fillStyle = i % 2 ? '#fff' : '#b22234'; g.fillRect(0, i * h / 13, w, h / 13 + 1); }
    g.fillStyle = '#3c3b6e'; g.fillRect(0, 0, w * 0.4, h * 7 / 13);
    g.fillStyle = '#fff';
    for (let r = 0; r < 9; r++) for (let c = 0; c < (r % 2 ? 5 : 6); c++) g.fillRect(6 + c * 17 + (r % 2) * 8, 4 + r * 7.6, 3, 3);
  }, { repeat: false });
  T.track = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#b24a35'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 6000, ['#bf543e', '#a6432f'], [1, 2]);
  });
  T.field = canvasTex(512, 1024, (g, w, h) => {              // football field with yard lines
    for (let i = 0; i < 20; i++) { g.fillStyle = i % 2 ? '#3f8a3a' : '#468f40'; g.fillRect(0, i * h / 20, w, h / 20); }
    g.strokeStyle = '#f4f4f0'; g.lineWidth = 4; g.strokeRect(20, 60, w - 40, h - 120);
    for (let k = 1; k < 10; k++) { const y = 60 + k * (h - 120) / 10; g.beginPath(); g.moveTo(20, y); g.lineTo(w - 20, y); g.stroke(); }
    g.fillStyle = NAVY; g.fillRect(22, 62, w - 44, 70); g.fillRect(22, h - 132, w - 44, 70);
    g.fillStyle = '#fff'; g.font = 'bold 44px Arial'; g.textAlign = 'center'; g.fillText('COLONIALS', w / 2, 112); g.fillText('T J', w / 2, h - 82);
  }, { repeat: false });
  return T;
}

// ---------------------------------------------------------------- whiteboard lessons
const BOARDS = 16;
const LESSONS = {
  physics: { titles: ['AP Physics C: Mechanics', 'Physics 1', 'AP Physics C: E&M', 'Honors Physics'], items: [
    { lines: ['Kinematics', 'v = v₀ + at', 'x = x₀ + v₀t + ½at²'], fig: 'projectile' },
    { lines: ["Newton's 2nd Law", 'ΣF = ma', 'friction: f = μN'], fig: 'fbd' },
    { lines: ["Snell's Law", 'n₁ sin θ₁ = n₂ sin θ₂'], fig: 'refraction' },
    { lines: ["Ohm's Law", 'V = IR    P = IV', 'series: R = R₁ + R₂'], fig: 'circuit' },
    { lines: ['Work - Energy', 'W = Fd cos θ', 'KE = ½mv²   PE = mgh'] },
    { lines: ['Momentum', 'p = mv', 'J = FΔt = Δp'] },
    { lines: ['Gravitation', 'F = Gm₁m₂ / r²', 'g = 9.8 m/s²'] },
    { lines: ['Waves', 'v = fλ', 'T = 1 / f'], fig: 'wave' },
    { lines: ['Circular motion', 'a = v² / r', 'F = mv² / r'] },
  ] },
  math: { titles: ['AP Calculus BC', 'Multivariable Calc', 'Precalculus', 'Linear Algebra'], items: [
    { lines: ['Quadratic Formula', 'x = (-b ± √(b² - 4ac)) / 2a'], fig: 'parabola' },
    { lines: ['Derivatives', 'd/dx sin x = cos x', "chain rule: f(g(x))' = f'(g(x))·g'(x)"] },
    { lines: ['Unit circle', 'sin²θ + cos²θ = 1', 'sin(π/6) = 1/2'], fig: 'circle' },
    { lines: ['Integrals', '∫₀¹ x² dx = 1/3', '∫ eˣ dx = eˣ + C'] },
    { lines: ['Law of Cosines', 'c² = a² + b² - 2ab cos C'], fig: 'triangle' },
    { lines: ['Determinant', 'det [a b; c d] = ad - bc'] },
    { lines: ['Geometric series', 'Σ (1/2)ⁿ = 1', 'S = a / (1 - r),  |r| < 1'] },
    { lines: ['Log rules', 'log(ab) = log a + log b', 'log(aⁿ) = n log a'] },
    { lines: ['Limits', 'lim x→0  sin x / x = 1'] },
  ] },
  english: { titles: ['English 11', 'AP Lit', 'AP Lang', 'English 9'], items: [
    { lines: ['Thesis = claim + reasons', 'Make it arguable!'] },
    { lines: ['Literary devices', 'metaphor · simile', 'alliteration · irony'] },
    { lines: ['The Great Gatsby', 'green light = hope / the dream', 'Ch. 5-6 for Monday'] },
    { lines: ['Vocabulary', 'ephemeral · ubiquitous', 'laconic · candid'] },
    { lines: ['MLA citation', 'Author. Title. Publisher, Year.'] },
    { lines: ['Hamlet, Act III', '"To be, or not to be"', 'soliloquy → inner conflict'] },
    { lines: ['Rhetorical appeals', 'ethos · pathos · logos'] },
    { lines: ['Essay structure', 'Intro → Body (x3) → Conclusion', 'topic sentence + evidence'] },
    { lines: ['Romeo and Juliet', 'foreshadowing in the Prologue'] },
  ] },
};
const HOMEWORK = ['HW: p. 214 #1-15', 'Quiz Thursday', 'Lab report due Fri', 'Essay draft due Mon', 'Test next week!', 'Read Ch. 4', 'Problem set 6 due'];

function drawBoard(g, x0, y0, i) {
  const w = 512, h = 256;
  g.save(); g.translate(x0, y0);
  g.fillStyle = '#9aa0a8'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#fbfcfd'; g.fillRect(8, 8, w - 16, h - 22);
  g.fillStyle = 'rgba(160,170,190,.05)'; for (let k = 0; k < 3; k++) g.fillRect(20 + rnd() * 400, 20 + rnd() * 180, 60 + rnd() * 80, 18);   // faint old smudges
  const subject = ['physics', 'math', 'english'][i % 3], L = LESSONS[subject];
  const item = L.items[(Math.floor(i / 3) * 4 + 1) % L.items.length];      // every board of a subject gets a different lesson
  const font = s => `${s}px "Comic Sans MS", "Chalkboard SE", "Marker Felt", cursive`;
  g.textBaseline = 'alphabetic';
  g.font = font(18); g.fillStyle = '#a3122a'; g.fillText(L.titles[(rnd() * L.titles.length) | 0], 22, 34);
  g.font = font(16); g.fillStyle = '#555'; g.fillText(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'][(rnd() * 5) | 0] + ' ' + (9 + ((rnd() * 4) | 0)) + '/' + (1 + ((rnd() * 28) | 0)), w - 100, 34);   // US month/day
  const textW = item.fig ? 300 : 470;
  item.lines.forEach((t, k) => {
    let s = k === 0 ? 30 : 26;
    g.font = font(s); while (g.measureText(t).width > textW && s > 14) g.font = font(--s);
    g.fillStyle = k === 0 ? '#1d3d8f' : k === 1 ? '#111' : '#1d7a3a';
    g.fillText(t, 22 + (k ? 10 : 0), 76 + k * 46);
    if (k === 0) { g.strokeStyle = '#1d3d8f'; g.lineWidth = 2; g.beginPath(); g.moveTo(22, 84); g.lineTo(22 + Math.min(textW, g.measureText(t).width), 84); g.stroke(); }
  });
  g.font = font(18); g.fillStyle = '#a3122a'; g.fillText(HOMEWORK[(rnd() * HOMEWORK.length) | 0], 22, h - 28);
  if (item.fig) drawFigure(g, item.fig, 345, 50, 150, 160);
  g.fillStyle = '#7d838b'; g.fillRect(8, h - 16, w - 16, 10);
  g.restore();
}
function drawFigure(g, kind, x, y, w, h) {
  g.save(); g.translate(x, y); g.strokeStyle = '#1d3d8f'; g.fillStyle = '#1d3d8f'; g.lineWidth = 2.5; g.font = '15px "Comic Sans MS", cursive';
  const arrow = (x0, y0, x1, y1, label) => {
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    const a = Math.atan2(y1 - y0, x1 - x0); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1 - 9 * Math.cos(a - 0.4), y1 - 9 * Math.sin(a - 0.4)); g.lineTo(x1 - 9 * Math.cos(a + 0.4), y1 - 9 * Math.sin(a + 0.4)); g.fill();
    if (label) g.fillText(label, x1 + 4, y1 + (y1 > y0 ? 14 : -4));
  };
  const axes = () => { arrow(10, h - 20, w, h - 20); arrow(10, h - 20, 10, 5); };
  if (kind === 'projectile') { axes(); g.setLineDash([5, 4]); g.beginPath(); for (let t = 0; t <= 1; t += 0.05) g.lineTo(10 + t * (w - 20), h - 20 - 4 * t * (1 - t) * (h - 40)); g.stroke(); g.setLineDash([]); arrow(10, h - 20, 50, h - 70, 'v₀'); }
  else if (kind === 'fbd') { g.strokeRect(w / 2 - 25, h / 2 - 25, 50, 50); arrow(w / 2, h / 2 - 25, w / 2, 5, 'N'); arrow(w / 2, h / 2 + 25, w / 2, h - 5, 'mg'); arrow(w / 2 + 25, h / 2, w - 5, h / 2, 'F'); arrow(w / 2 - 25, h / 2, 10, h / 2, 'f'); }
  else if (kind === 'refraction') { g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke(); g.setLineDash([4, 4]); g.beginPath(); g.moveTo(w / 2, 5); g.lineTo(w / 2, h - 5); g.stroke(); g.setLineDash([]); g.strokeStyle = '#a3122a'; arrow(15, 10, w / 2, h / 2); arrow(w / 2, h / 2, w / 2 + 40, h - 10); g.fillStyle = '#1d3d8f'; g.fillText('n₁', 5, h / 2 - 8); g.fillText('n₂', 5, h / 2 + 20); }
  else if (kind === 'circuit') { g.strokeRect(15, 20, w - 30, h - 50); g.fillStyle = '#fbfcfd'; g.fillRect(w / 2 - 30, 12, 60, 16); g.strokeStyle = '#1d3d8f'; g.beginPath(); for (let k = 0; k <= 6; k++) g.lineTo(w / 2 - 30 + k * 10, 20 + (k % 2 ? -8 : 8) * (k > 0 && k < 6 ? 1 : 0)); g.stroke(); g.fillStyle = '#fbfcfd'; g.fillRect(8, h / 2 - 20, 16, 30); g.fillStyle = '#1d3d8f'; g.fillRect(5, h / 2 - 12, 22, 3); g.fillRect(10, h / 2 - 2, 12, 3); g.fillText('R', w / 2 - 5, 50); g.fillText('V', 30, h / 2); }
  else if (kind === 'wave') { axes(); g.strokeStyle = '#a3122a'; g.beginPath(); for (let t = 0; t <= w - 20; t += 2) g.lineTo(10 + t, h / 2 - Math.sin(t / 18) * 40); g.stroke(); g.fillStyle = '#1d3d8f'; g.fillText('λ', 55, h / 2 - 50); }
  else if (kind === 'parabola') { axes(); g.strokeStyle = '#a3122a'; g.beginPath(); for (let t = -1; t <= 1.001; t += 0.05) g.lineTo(w / 2 + t * (w / 2 - 20), 25 + t * t * (h - 70)); g.stroke(); g.fillStyle = '#1d3d8f'; g.fillText('y = ax² + bx + c', 5, h - 2); }
  else if (kind === 'circle') { const r = Math.min(w, h) / 2 - 12, cx = w / 2, cy = h / 2; arrow(cx - r - 8, cy, cx + r + 10, cy); arrow(cx, cy + r + 8, cx, cy - r - 10); g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke(); g.strokeStyle = '#a3122a'; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + r * Math.cos(-0.6), cy + r * Math.sin(-0.6)); g.stroke(); g.fillText('θ', cx + 18, cy - 6); }
  else if (kind === 'triangle') { g.beginPath(); g.moveTo(10, h - 20); g.lineTo(w - 10, h - 20); g.lineTo(w * 0.35, 15); g.closePath(); g.stroke(); g.fillText('a', w * 0.12, h / 2); g.fillText('b', w * 0.68, h / 2); g.fillText('c', w / 2, h - 2); g.fillText('C', w * 0.35 - 5, 32); }
  g.restore();
}

/** A crimson plaque / banner atlas: draw every label once, hand back UV rectangles. */
export function makeLabelAtlas(labels, { cellW = 256, cellH = 64, cols = 8, style = 'plaque' } = {}) {
  const rows = Math.ceil(labels.length / cols);
  const c = document.createElement('canvas');
  c.width = cellW * cols; c.height = THREE.MathUtils.ceilPowerOfTwo(cellH * rows);
  const g = c.getContext('2d');
  const uv = new Map();
  labels.forEach((text, i) => {
    const x = (i % cols) * cellW, y = Math.floor(i / cols) * cellH;
    if (style === 'plaque') {
      g.fillStyle = CRIMSON; g.fillRect(x + 2, y + 2, cellW - 4, cellH - 4);
      g.strokeStyle = '#e9d9b0'; g.lineWidth = 3; g.strokeRect(x + 7, y + 7, cellW - 14, cellH - 14);
      g.fillStyle = '#fff';
    } else {
      g.fillStyle = CRIMSON; g.fillRect(x + 2, y + 2, cellW - 4, cellH - 4);
      g.fillStyle = NAVY; g.fillRect(x + 2, y + cellH - 18, cellW - 4, 16);
      g.fillStyle = '#fff';
    }
    let size = cellH * (style === 'plaque' ? 0.5 : 0.48);
    g.font = `bold ${size}px Georgia, serif`;
    while (g.measureText(text).width > cellW - 24 && size > 10) { size -= 2; g.font = `bold ${size}px Georgia, serif`; }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, x + cellW / 2, y + cellH / 2 - (style === 'plaque' ? 0 : 6));
    uv.set(text, [x / c.width, 1 - (y + cellH) / c.height, (x + cellW) / c.width, 1 - y / c.height]);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return { tex, uv };
}

/** Basketball court markings sized to a gym floor (w x d metres), drawn over the maple. endM: baseline to end wall (m). */
export function courtTexture(wood, w, d, endM = 1.2) {
  const PX = 24;
  return canvasTex(Math.min(2048, Math.ceil(w * PX)), Math.min(2048, Math.ceil(d * PX)), (g, cw, ch) => {
    const img = wood.image;
    for (let x = 0; x < cw; x += img.width / 3) for (let y = 0; y < ch; y += img.height / 3) g.drawImage(img, x, y, img.width / 3, img.height / 3);
    const s = cw / w, long = d > w;
    g.save();
    if (long) { g.translate(cw, 0); g.rotate(Math.PI / 2); }
    const L = (long ? d : w) * s, Wd = (long ? w : d) * s, m = 1.2 * s, me = endM * s;
    g.strokeStyle = '#f5f2ea'; g.lineWidth = 3;
    g.strokeRect(me, m, L - 2 * me, Wd - 2 * m);
    g.beginPath(); g.moveTo(L / 2, m); g.lineTo(L / 2, Wd - m); g.stroke();
    g.beginPath(); g.arc(L / 2, Wd / 2, 1.8 * s, 0, 7); g.stroke();
    g.fillStyle = 'rgba(155,27,48,.85)';
    for (const sx of [me, L - me - 5.8 * s]) { g.fillRect(sx, Wd / 2 - 2.45 * s, 5.8 * s, 4.9 * s); g.strokeRect(sx, Wd / 2 - 2.45 * s, 5.8 * s, 4.9 * s); }
    for (const [sx, dir] of [[me, 1], [L - me, -1]]) {
      g.beginPath(); g.arc(sx + dir * 1.6 * s, Wd / 2, 6.75 * s, -Math.PI / 2, Math.PI / 2, dir < 0); g.stroke();
      // the three-point line runs straight from the ends of the arc to the baseline (the corners)
      for (const k of [-1, 1]) { g.beginPath(); g.moveTo(sx, Wd / 2 + k * 6.75 * s); g.lineTo(sx + dir * 1.6 * s, Wd / 2 + k * 6.75 * s); g.stroke(); }
    }
    g.fillStyle = 'rgba(28,43,79,.9)'; g.beginPath(); g.arc(L / 2, Wd / 2, 1.7 * s, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.font = `bold ${1.4 * s}px Georgia`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('TJ', L / 2, Wd / 2);
    g.restore();
  }, { repeat: false });
}
