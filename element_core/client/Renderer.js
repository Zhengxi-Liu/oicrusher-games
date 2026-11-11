/**
 * Element Core renderer: neon arena, glowing mages, elemental bolts with trails, crumbling cover,
 * fire, lightning, floating numbers, screen shake and lethal-hit hit-stop.
 * draw(view) takes a fully resolved frame (positions already predicted / interpolated by main.js).
 */
(function () {
  'use strict';
  const { C, CARD } = window.ElementConst;
  const W = 1280, H = 720, OX = 20, OY = 20;
  const COL = [
    { main: '#00f0ff', rgb: '0,240,255', name: 'CYAN' },
    { main: '#ff2bd6', rgb: '255,43,214', name: 'MAGENTA' },
  ];
  const FLAG = { FROST: 1, HOMING: 2, BOUNCE: 4, PIERCE: 8, CHAIN: 16, HEAVY: 32, VAMP: 64 };
  const noise = i => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.bg = document.createElement('canvas');
      this.time = 0;
      this.shake = 0;
      this.flash = 0;
      this.zoom = null;             // { x, y, t } slow push-in on a lethal hit
      this.parts = [];
      this.debris = [];
      this.texts = [];
      this.zaps = [];
      this.trails = new Map();      // bolt key -> recent points
      this.ghosts = [[], []];
      this.coverHit = new Map();
      this.resize();
      addEventListener('resize', () => this.resize());
    }

    resize() {
      const s = this.lowRes ? 1 : Math.min(2, window.devicePixelRatio || 1);
      if (this.scale === s) return;
      this.scale = s;
      this.canvas.width = W * s; this.canvas.height = H * s;
      this.buildBackground();
    }

    /** Canvas pixel (client coords) -> arena coordinates. */
    toWorld(clientX, clientY) {
      const r = this.canvas.getBoundingClientRect();
      return { x: (clientX - r.left) * (W / r.width) - OX, y: (clientY - r.top) * (H / r.height) - OY };
    }

    buildBackground() {
      const s = this.scale, g = this.bg.getContext('2d');
      this.bg.width = W * s; this.bg.height = H * s;
      g.setTransform(s, 0, 0, s, 0, 0);
      const grd = g.createRadialGradient(W / 2, H / 2, 80, W / 2, H / 2, 760);
      grd.addColorStop(0, '#110a26'); grd.addColorStop(1, '#030108');
      g.fillStyle = grd; g.fillRect(0, 0, W, H);
      // hex grid
      g.strokeStyle = 'rgba(120,90,255,.10)'; g.lineWidth = 1;
      const R = 26, hw = R * Math.sqrt(3);
      for (let row = -1; row < H / (R * 1.5) + 1; row++) {
        for (let col = -1; col < W / hw + 1; col++) {
          const cx = col * hw + (row % 2 ? hw / 2 : 0), cy = row * R * 1.5;
          g.beginPath();
          for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; g[k ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * R, cy + Math.sin(a) * R); }
          g.closePath(); g.stroke();
        }
      }
      // spawn sigils
      C.SPAWNS.forEach(([x, y], i) => {
        g.strokeStyle = `rgba(${COL[i].rgb},.25)`; g.lineWidth = 2;
        for (const r of [34, 48]) { g.beginPath(); g.arc(OX + x, OY + y, r, 0, Math.PI * 2); g.stroke(); }
        for (let k = 0; k < 6; k++) {
          const a = k * Math.PI / 3;
          g.beginPath(); g.moveTo(OX + x + Math.cos(a) * 34, OY + y + Math.sin(a) * 34); g.lineTo(OX + x + Math.cos(a + 2) * 34, OY + y + Math.sin(a + 2) * 34); g.stroke();
        }
      });
      // arena border
      const bord = g.createLinearGradient(OX, 0, OX + C.ARENA_W, 0);
      bord.addColorStop(0, 'rgba(0,240,255,.9)'); bord.addColorStop(1, 'rgba(255,43,214,.9)');
      g.strokeStyle = bord; g.lineWidth = 3; g.shadowColor = '#8a5cff'; g.shadowBlur = 18;
      g.strokeRect(OX, OY, C.ARENA_W, C.ARENA_H);
      g.shadowBlur = 0;
    }

    // ---------- one-shot effects
    burst(x, y, n, color, speed = 4, life = 1) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random());
        this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, decay: 0.025 + Math.random() * 0.03, color, size: 1.5 + Math.random() * 2 });
      }
      if (this.parts.length > 700) this.parts.splice(0, this.parts.length - 700);
    }
    number(x, y, text, color) { this.texts.push({ x: x + (Math.random() - 0.5) * 16, y: y - 26, text, color, life: 1 }); }

    event(e, me) {
      const [code] = e;
      switch (code) {
        case 0: { const [, , x, y, v, p, zap] = e; this.burst(x, y, 10, zap ? '#fff35c' : COL[1 - p].main, 4); this.number(x, y, Math.round(v), zap ? '#fff35c' : (p === me ? '#ff6b8a' : '#ffffff')); if (p === me) this.shake = Math.max(this.shake, 4 + v * 0.4); break; }
        case 1: { const [, , x, y, o] = e; this.burst(x, y, 4, COL[o].main, 2.5, 0.6); break; }
        case 2: {
          const c = C.COVERS[e[2]];
          for (let i = 0; i < 18; i++) {
            this.debris.push({ x: c.x + (Math.random() - 0.5) * c.w, y: c.y + (Math.random() - 0.5) * c.h, vx: (Math.random() - 0.5) * 7, vy: (Math.random() - 0.5) * 7,
                               a: Math.random() * 6, va: (Math.random() - 0.5) * 0.3, s: 5 + Math.random() * 9, life: 1 });
          }
          this.burst(c.x, c.y, 30, '#b9a7ff', 5); this.shake = Math.max(this.shake, 8);
          break;
        }
        case 3: { const [, , x1, y1, x2, y2] = e; this.zaps.push({ x1, y1, x2, y2, life: 1, seed: Math.random() * 100 }); this.burst(x2, y2, 12, '#fff35c', 5); break; }
        case 4: { const [, , x, y, p] = e; this.burst(x, y, 70, COL[p].main, 9, 1.4); this.burst(x, y, 40, '#ffffff', 6, 1.2); this.flash = 1; this.shake = 24; this.zoom = { x, y, t: 0 }; break; }
        case 5: { const [, , x, y, v] = e; this.number(x, y, '+' + Math.round(v), '#5cff7a'); break; }
        case 6: { const [, , x, y] = e; this.burst(x, y, 3, '#7cffb2', 2, 0.5); break; }
        case 7: { const [, , x, y, v, p] = e; this.number(x, y, Math.round(v), '#ff8a3d'); if (p === me) this.shake = Math.max(this.shake, 3); break; }
      }
    }

    // ---------- frame
    draw(v, dt) {
      const t0 = performance.now();
      this.drawFrame(v, dt);
      // dynamic resolution: if a bullet-hell frame keeps costing >11 ms, drop to 1x pixels for good
      const cost = performance.now() - t0;
      this.slow = cost > 11 ? (this.slow || 0) + 1 : 0;
      if (this.slow > 20 && this.scale > 1) { this.lowRes = true; this.resize(); }
    }

    drawFrame(v, dt) {
      this.time += dt;
      const g = this.ctx, k = dt * 60;
      g.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      g.save();
      if (this.zoom) {
        this.zoom.t += dt;
        const z = 1 + 0.08 * Math.sin(Math.min(1, this.zoom.t / 0.9) * Math.PI);
        g.translate(OX + this.zoom.x, OY + this.zoom.y); g.scale(z, z); g.translate(-OX - this.zoom.x, -OY - this.zoom.y);
        if (this.zoom.t > 0.9) this.zoom = null;
      }
      if (this.shake > 0.3) g.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      this.shake *= Math.pow(0.86, k);
      g.drawImage(this.bg, 0, 0, W, H);
      g.translate(OX, OY);

      this.drawFires(v.fires);
      this.drawCovers(v.covers);
      this.drawDebris(k);
      this.drawBolts(v, k);
      v.players.forEach((p, i) => this.drawMage(p, i, v, k));
      this.drawZaps(k);
      this.drawParticles(k);
      this.drawTexts(k);
      if (v.cursor && v.showCursor) this.drawCursor(v.cursor, COL[v.me].main);
      g.restore();

      if (this.flash > 0.01) { g.fillStyle = `rgba(255,255,255,${this.flash * 0.65})`; g.fillRect(0, 0, W, H); this.flash *= Math.pow(0.82, k); }
      if (v.hud) this.drawHud(v);
    }

    drawFires(fires) {
      const g = this.ctx, spr = this.sprite('#ff7a28');
      g.save(); g.globalCompositeOperation = 'lighter';
      for (const f of fires) {
        const r = 26 + Math.sin(this.time * 14 + f.id) * 3;
        g.globalAlpha = 0.55 * Math.min(1, f.life / 40);
        g.drawImage(spr, f.x - r, f.y - r, r * 2, r * 2);
        if (Math.random() < 0.08) this.parts.push({ x: f.x + (Math.random() - 0.5) * 20, y: f.y, vx: 0, vy: -1 - Math.random(), life: 0.7, decay: 0.03, color: '#ffb05c', size: 2 });
      }
      g.restore();
    }

    drawCovers(covers) {
      const g = this.ctx;
      covers.forEach((hp, i) => {
        if (hp <= 0) return;
        const c = C.COVERS[i], f = hp / c.hp;
        const x = c.x - c.w / 2, y = c.y - c.h / 2;
        g.fillStyle = '#1a1630'; g.fillRect(x, y, c.w, c.h);
        g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(x + 3, y + 3, c.w - 6, c.h / 3);
        const edge = f > 0.6 ? '140,120,255' : f > 0.3 ? '255,170,80' : '255,80,90';
        g.strokeStyle = `rgba(${edge},.9)`; g.lineWidth = 2; g.shadowColor = `rgb(${edge})`; g.shadowBlur = 10;
        g.strokeRect(x + 1, y + 1, c.w - 2, c.h - 2); g.shadowBlur = 0;
        // cracks grow with damage
        const cracks = Math.floor((1 - f) * 7);
        g.strokeStyle = `rgba(${edge},.7)`; g.lineWidth = 1.2;
        for (let n = 0; n < cracks; n++) {
          let px = x + noise(i * 13 + n) * c.w, py = y + noise(i * 7 + n * 3) * c.h;
          g.beginPath(); g.moveTo(px, py);
          for (let s = 0; s < 3; s++) { px += (noise(i + n * 5 + s) - 0.5) * 18; py += (noise(i * 3 + n + s * 11) - 0.5) * 18; g.lineTo(Math.max(x, Math.min(x + c.w, px)), Math.max(y, Math.min(y + c.h, py))); }
          g.stroke();
        }
      });
    }

    drawDebris(k) {
      const g = this.ctx;
      for (const d of this.debris) {
        d.x += d.vx * k; d.y += d.vy * k; d.vx *= Math.pow(0.92, k); d.vy *= Math.pow(0.92, k); d.a += d.va * k; d.life -= 0.012 * k;
        g.save(); g.translate(d.x, d.y); g.rotate(d.a); g.globalAlpha = Math.max(0, d.life);
        g.fillStyle = '#2a2448'; g.fillRect(-d.s / 2, -d.s / 2, d.s, d.s);
        g.strokeStyle = 'rgba(160,140,255,.6)'; g.strokeRect(-d.s / 2, -d.s / 2, d.s, d.s);
        g.restore();
      }
      this.debris = this.debris.filter(d => d.life > 0);
    }

    boltColor(b) {
      if (b.flags & FLAG.FROST) return '#bff4ff';
      if (b.flags & FLAG.CHAIN) return '#fff35c';
      if (b.flags & FLAG.HOMING) return '#c49bff';
      return COL[b.owner].main;
    }

    /** Glow sprite per colour, rendered once and reused (radial gradients per bolt per frame are too slow). */
    sprite(color) {
      this.sprites = this.sprites || new Map();
      let c = this.sprites.get(color);
      if (!c) {
        c = document.createElement('canvas'); c.width = c.height = 64;
        const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.3, color); grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
        this.sprites.set(color, c);
      }
      return c;
    }

    drawBolts(v, k) {
      const g = this.ctx, live = new Set();
      g.save(); g.lineCap = 'round';
      for (const b of v.bolts) {
        live.add(b.key);
        let tr = this.trails.get(b.key);
        if (!tr) { tr = []; this.trails.set(b.key, tr); }
        tr.push(b.x, b.y); if (tr.length > 12) tr.splice(0, 2);
        const col = this.boltColor(b);
        if (tr.length >= 4) {
          g.strokeStyle = col; g.globalAlpha = 0.35; g.lineWidth = b.r * 1.2;
          g.beginPath(); g.moveTo(tr[0], tr[1]);
          for (let i = 2; i < tr.length; i += 2) g.lineTo(tr[i], tr[i + 1]);
          g.stroke();
          g.globalAlpha = 1;
        }
        const d = b.r * 5.2;
        g.drawImage(this.sprite(col), b.x - d / 2, b.y - d / 2, d, d);
        if ((b.flags & FLAG.CHAIN) && Math.random() < 0.3) this.parts.push({ x: b.x, y: b.y, vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 3, life: 0.4, decay: 0.06, color: '#fff35c', size: 1.5 });
      }
      g.restore();
      for (const key of this.trails.keys()) if (!live.has(key)) this.trails.delete(key);
    }

    drawMage(p, i, v, k) {
      if (!p) return;
      const g = this.ctx, col = COL[i], R = C.PLAYER_R;
      // dash afterimages
      const gh = this.ghosts[i];
      if (p.dashT > 0 && p.alive) gh.push({ x: p.x, y: p.y, life: 1 });
      for (const o of gh) o.life -= 0.08 * k;
      this.ghosts[i] = gh.filter(o => o.life > 0);
      for (const o of this.ghosts[i]) { g.fillStyle = `rgba(${col.rgb},${0.25 * o.life})`; g.beginPath(); g.arc(o.x, o.y, R, 0, Math.PI * 2); g.fill(); }
      if (!p.alive) {
        g.strokeStyle = `rgba(${col.rgb},.35)`; g.lineWidth = 2;
        g.beginPath(); g.arc(p.x, p.y, R + 6, 0, Math.PI * 2); g.stroke();
        return;
      }
      g.save();
      const glow = g.createRadialGradient(p.x, p.y, 4, p.x, p.y, R * 2.4);
      glow.addColorStop(0, `rgba(${col.rgb},.55)`); glow.addColorStop(1, `rgba(${col.rgb},0)`);
      g.fillStyle = glow; g.beginPath(); g.arc(p.x, p.y, R * 2.4, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#0a0618'; g.strokeStyle = col.main; g.lineWidth = 3; g.shadowColor = col.main; g.shadowBlur = 16;
      g.beginPath(); g.arc(p.x, p.y, R, 0, Math.PI * 2); g.fill(); g.stroke();
      // rotating rune ring
      g.shadowBlur = 0; g.lineWidth = 1.5; g.setLineDash([5, 7]);
      g.lineDashOffset = -this.time * 40 * (i ? -1 : 1);
      g.beginPath(); g.arc(p.x, p.y, R + 7, 0, Math.PI * 2); g.stroke();
      g.setLineDash([]);
      // focus orb in the aim direction
      const ax = p.x + Math.cos(p.aim) * (R + 11), ay = p.y + Math.sin(p.aim) * (R + 11);
      g.strokeStyle = col.main; g.lineWidth = 2;
      g.beginPath(); g.moveTo(p.x + Math.cos(p.aim) * 8, p.y + Math.sin(p.aim) * 8); g.lineTo(ax, ay); g.stroke();
      g.fillStyle = '#ffffff'; g.shadowColor = col.main; g.shadowBlur = 14;
      g.beginPath(); g.arc(ax, ay, 4.5, 0, Math.PI * 2); g.fill();
      g.shadowBlur = 0;
      if (p.shield > 0.5) {
        g.strokeStyle = `rgba(110,168,255,${0.35 + 0.35 * Math.min(1, p.shield / 20)})`; g.lineWidth = 3;
        g.beginPath();
        for (let s = 0; s < 6; s++) { const a = s * Math.PI / 3 + this.time; g[s ? 'lineTo' : 'moveTo'](p.x + Math.cos(a) * (R + 13), p.y + Math.sin(a) * (R + 13)); }
        g.closePath(); g.stroke();
      }
      if (p.slowT > 0) {
        g.strokeStyle = 'rgba(190,240,255,.8)'; g.lineWidth = 2;
        g.beginPath(); g.arc(p.x, p.y, R + 3, 0, Math.PI * 2); g.stroke();
        if (Math.random() < 0.3) this.parts.push({ x: p.x + (Math.random() - 0.5) * 30, y: p.y + (Math.random() - 0.5) * 30, vx: 0, vy: 0.4, life: 0.6, decay: 0.03, color: '#d8f8ff', size: 1.6 });
      }
      // own dash readiness ring
      if (i === v.me && p.dashCd > 0) {
        g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 2;
        g.beginPath(); g.arc(p.x, p.y, R + 18, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - p.dashCd / v.stats[i].dashCd)); g.stroke();
      }
      // health bar
      const maxHp = v.stats[i].maxHp, w = 54;
      g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(p.x - w / 2, p.y - R - 26, w, 6);
      g.fillStyle = p.hp / maxHp > 0.35 ? col.main : '#ff5a6e'; g.fillRect(p.x - w / 2, p.y - R - 26, w * Math.max(0, p.hp / maxHp), 6);
      if (p.shield > 0) { g.fillStyle = '#6ea8ff'; g.fillRect(p.x - w / 2, p.y - R - 30, w * Math.min(1, p.shield / Math.max(1, v.stats[i].maxShield)), 3); }
      if (v.labels[i]) { g.font = 'bold 11px "Segoe UI", sans-serif'; g.textAlign = 'center'; g.fillStyle = col.main; g.fillText(v.labels[i], p.x, p.y - R - 34); }
      g.restore();
    }

    drawZaps(k) {
      const g = this.ctx;
      g.save(); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
      for (const z of this.zaps) {
        z.life -= 0.07 * k;
        const n = 9;
        g.strokeStyle = `rgba(255,243,92,${Math.max(0, z.life)})`; g.lineWidth = 3; g.shadowColor = '#fff35c'; g.shadowBlur = 14;
        g.beginPath(); g.moveTo(z.x1, z.y1);
        for (let s = 1; s < n; s++) {
          const t = s / n, j = (noise(z.seed + s + Math.floor(this.time * 30)) - 0.5) * 26;
          const nx = -(z.y2 - z.y1), ny = z.x2 - z.x1, l = Math.hypot(nx, ny) || 1;
          g.lineTo(z.x1 + (z.x2 - z.x1) * t + nx / l * j, z.y1 + (z.y2 - z.y1) * t + ny / l * j);
        }
        g.lineTo(z.x2, z.y2); g.stroke();
      }
      g.restore();
      this.zaps = this.zaps.filter(z => z.life > 0);
    }

    drawParticles(k) {
      const g = this.ctx;
      g.save(); g.globalCompositeOperation = 'lighter';
      for (const p of this.parts) {
        p.x += p.vx * k; p.y += p.vy * k; p.vx *= Math.pow(0.95, k); p.vy *= Math.pow(0.95, k); p.life -= p.decay * k;
        g.globalAlpha = Math.max(0, p.life); g.fillStyle = p.color;
        g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
      g.restore();
      this.parts = this.parts.filter(p => p.life > 0);
    }

    drawTexts(k) {
      const g = this.ctx;
      g.save(); g.textAlign = 'center'; g.font = 'bold 16px "Segoe UI", sans-serif';
      for (const t of this.texts) {
        t.y -= 0.6 * k; t.life -= 0.02 * k;
        g.globalAlpha = Math.max(0, t.life); g.fillStyle = '#000'; g.fillText(t.text, t.x + 1, t.y + 1);
        g.fillStyle = t.color; g.fillText(t.text, t.x, t.y);
      }
      g.restore();
      this.texts = this.texts.filter(t => t.life > 0);
    }

    drawCursor(c, color) {
      const g = this.ctx;
      g.save(); g.strokeStyle = color; g.lineWidth = 2;
      g.beginPath(); g.arc(c.x, c.y, 9, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(c.x - 15, c.y); g.lineTo(c.x - 5, c.y); g.moveTo(c.x + 5, c.y); g.lineTo(c.x + 15, c.y);
      g.moveTo(c.x, c.y - 15); g.lineTo(c.x, c.y - 5); g.moveTo(c.x, c.y + 5); g.lineTo(c.x, c.y + 15); g.stroke();
      g.restore();
    }

    drawHud(v) {
      const g = this.ctx;
      g.save(); g.textBaseline = 'middle';
      for (let i = 0; i < 2; i++) {
        const col = COL[i], right = i === 1, x0 = right ? W - 30 : 30, dir = right ? -1 : 1;
        const p = v.players[i], st = v.stats[i];
        g.textAlign = right ? 'right' : 'left';
        g.font = 'bold 16px "Segoe UI", sans-serif'; g.fillStyle = col.main; g.shadowColor = col.main; g.shadowBlur = 8;
        g.fillText(v.names[i] + (i === v.me ? '  (you)' : ''), x0, 40);
        g.shadowBlur = 0;
        // hp bar
        const bw = 240, bx = right ? x0 - bw : x0;
        g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(bx, 54, bw, 10);
        if (p) {
          g.fillStyle = col.main; const hw = bw * Math.max(0, p.hp / st.maxHp); g.fillRect(right ? bx + bw - hw : bx, 54, hw, 10);
          if (st.maxShield) { g.fillStyle = '#6ea8ff'; const sw = bw * p.shield / st.maxShield; g.fillRect(right ? bx + bw - sw : bx, 66, sw, 3); }
          g.font = '11px "Segoe UI", sans-serif'; g.fillStyle = 'rgba(255,255,255,.8)';
          g.fillText(`${Math.ceil(p.hp)} / ${st.maxHp}`, right ? bx + bw - 4 : bx + 4, 80);
        }
        // round pips
        for (let r = 0; r < C.ROUND_WINS; r++) {
          const cx = x0 + dir * (bw + 18 + r * 18);
          g.beginPath(); g.arc(cx, 59, 6, 0, Math.PI * 2);
          if (r < v.score[i]) { g.fillStyle = col.main; g.fill(); } else { g.strokeStyle = `rgba(${col.rgb},.5)`; g.lineWidth = 2; g.stroke(); }
        }
        // build
        let n = 0;
        g.font = '15px "Segoe UI", sans-serif';
        for (const [id, cnt] of Object.entries(v.stacks[i] || {})) {
          const card = CARD[id]; if (!card || !cnt) continue;
          const cx = x0 + dir * (n * 30 + 13), cy = 102;
          g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(cx - 13, cy - 13, 26, 26);
          g.strokeStyle = card.color; g.lineWidth = 1.5; g.strokeRect(cx - 13, cy - 13, 26, 26);
          g.textAlign = 'center'; g.fillStyle = card.color; g.fillText(card.icon, cx, cy + 1);
          if (cnt > 1) { g.font = 'bold 10px "Segoe UI", sans-serif'; g.fillStyle = '#fff'; g.fillText(cnt, cx + 9, cy + 9); g.font = '15px "Segoe UI", sans-serif'; }
          n++;
        }
      }
      // centre: round, draft clock, ping
      g.textAlign = 'center';
      g.font = 'bold 15px "Segoe UI", sans-serif'; g.fillStyle = 'rgba(232,232,255,.85)';
      g.fillText(`ROUND ${v.round} · BEST OF 3`, W / 2, 38);
      if (v.phase === 'combat') {
        const left = Math.max(0, Math.ceil((C.DRAFT_EVERY - v.ct) / 60));
        g.font = '12px "Segoe UI", sans-serif'; g.fillStyle = left <= 5 ? '#ffd166' : 'rgba(232,232,255,.6)';
        g.fillText(`next draft in ${left}s`, W / 2, 58);
      }
      if (v.status) { g.textAlign = 'left'; g.font = '11px "Segoe UI", sans-serif'; g.fillStyle = 'rgba(232,232,255,.5)'; g.fillText(v.status, 26, H - 10); }
      // banners
      g.textAlign = 'center';
      let text = null, color = '#ffffff', size = 72;
      if (v.phase === 'countdown') { const n = Math.ceil(v.pt / 50); text = n > 0 ? String(n) : null; size = 110; color = '#e8e8ff'; }
      else if (v.phase === 'combat' && v.sinceFight < 40) { text = 'FIGHT!'; color = '#ffd166'; size = 84 - v.sinceFight / 2; }
      else if (v.phase === 'ko') { text = 'K.O.'; color = v.koBy >= 0 ? COL[v.koBy].main : '#fff'; size = 96; }
      else if (v.phase === 'over') { text = v.winner === v.me ? 'VICTORY' : 'DEFEAT'; color = v.winner >= 0 ? COL[v.winner].main : '#fff'; }
      if (text) {
        g.font = `900 ${size}px "Segoe UI", sans-serif`; g.shadowColor = color; g.shadowBlur = 26; g.fillStyle = color;
        g.fillText(text, W / 2, H / 2 - 20); g.shadowBlur = 0;
      }
      g.restore();
    }
  }

  window.ElementRenderer = { Renderer, COL, OX, OY, W, H };
})();
