/** Neon vector renderer: background, fencers, blades, trails, sparks, shake, bullet time, HUD. */
(function () {
  'use strict';
  const S = window.FencingSim, { C } = S;
  const W = 960, H = 540, FLOOR = 410;
  const COLORS = [
    { main: '#00f0ff', glow: 'rgba(0,240,255,', name: 'CYAN' },
    { main: '#ff2bd6', glow: 'rgba(255,43,214,', name: 'MAGENTA' },
  ];
  const lerp = (a, b, t) => a + (b - a) * t;
  const P = (x, y) => ({ x, y });
  const mix = (a, b, t) => P(lerp(a.x, b.x, t), lerp(a.y, b.y, t));
  const noise = i => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

  // ---------- poses (world coordinates, x = body centre, feet on FLOOR)
  function basePose(x, d, stride) {
    return {
      hip: P(x - d * 2, FLOOR - 62), neck: P(x + d * 2, FLOOR - 108), head: P(x + d * 4, FLOOR - 123),
      fFoot: P(x + d * (26 + stride), FLOOR), bFoot: P(x - d * (24 - stride), FLOOR),
      fKnee: P(x + d * (18 + stride * 0.6), FLOOR - 32), bKnee: P(x - d * (16 - stride * 0.6), FLOOR - 30),
      elbow: P(x + d * 2, FLOOR - 84), hand: P(x + d * 14, FLOOR - 82), tip: P(x + d * C.REACH, FLOOR - 100),
      rElbow: P(x - d * 14, FLOOR - 98), rHand: P(x - d * 22, FLOOR - 114),
    };
  }
  function lungePose(x, d) {
    return {
      hip: P(x + d * 4, FLOOR - 52), neck: P(x + d * 16, FLOOR - 96), head: P(x + d * 21, FLOOR - 110),
      fFoot: P(x + d * 52, FLOOR), bFoot: P(x - d * 36, FLOOR),
      fKnee: P(x + d * 42, FLOOR - 34), bKnee: P(x - d * 16, FLOOR - 20),
      elbow: P(x + d * 28, FLOOR - 88), hand: P(x + d * 42, FLOOR - 88), tip: P(x + d * (C.REACH + C.LUNGE_EXT), FLOOR - 90),
      rElbow: P(x - d * 18, FLOOR - 92), rHand: P(x - d * 36, FLOOR - 96),
    };
  }
  function blend(a, b, t) { const o = {}; for (const k in a) o[k] = mix(a[k], b[k], t); return o; }
  function rotate(pose, cx, cy, ang) {
    const cs = Math.cos(ang), sn = Math.sin(ang), o = {};
    for (const k in pose) { const dx = pose[k].x - cx, dy = pose[k].y - cy; o[k] = P(cx + dx * cs - dy * sn, cy + dx * sn + dy * cs); }
    return o;
  }

  function poseFor(f, x, time) {
    const d = f.dir, t = f.t;
    const stride = f.st === 'walk' ? Math.sin(x * 0.18) * 6 : 0;
    const idle = basePose(x, d, stride);
    switch (f.st) {
      case 'lunge': {
        if (t < C.LUNGE_STARTUP) {
          const k = t / C.LUNGE_STARTUP;
          const wind = basePose(x, d, 0);
          wind.hip.x -= d * 4 * k; wind.neck.x -= d * 8 * k; wind.head.x -= d * 8 * k;
          wind.hand = P(x + d * (14 - 18 * k), FLOOR - 82 - 10 * k);
          wind.elbow = P(x - d * 6 * k, FLOOR - 86);
          wind.tip = P(x + d * (C.REACH - 22 * k), FLOOR - 100 - 22 * k);
          return wind;
        }
        const ext = lungePose(x, d);
        const r = t - C.LUNGE_STARTUP - C.LUNGE_ACTIVE;
        return r < 0 ? ext : blend(ext, idle, Math.min(1, r / C.LUNGE_RECOVERY));
      }
      case 'parry': {
        const p = basePose(x, d, 0);
        p.hand = P(x + d * 22, FLOOR - 88); p.elbow = P(x + d * 8, FLOOR - 92);
        p.tip = P(x + d * 30, FLOOR - 140);
        return p;
      }
      case 'dodge': {
        const k = Math.min(1, t / 4) * (t < 14 ? 1 : Math.max(0, (C.DODGE_TOTAL - t) / 6));
        const back = basePose(x, d, 0);
        back.neck = mix(back.neck, P(x - d * 16, FLOOR - 100), k); back.head = mix(back.head, P(x - d * 19, FLOOR - 114), k);
        back.hip = mix(back.hip, P(x - d * 6, FLOOR - 56), k);
        back.bFoot = mix(back.bFoot, P(x - d * 34, FLOOR - 8), k);
        back.tip = mix(back.tip, P(x + d * 30, FLOOR - 120), k);
        return back;
      }
      case 'stagger': case 'recoil': {
        const k = f.st === 'stagger' ? 1 : Math.max(0, 1 - t / C.RECOIL);
        const w = Math.sin(time * 30) * 3 * k;
        const p = basePose(x, d, 0);
        p.neck = mix(p.neck, P(x - d * 14 + w, FLOOR - 98), k); p.head = mix(p.head, P(x - d * 18 + w, FLOOR - 110), k);
        p.hand = mix(p.hand, P(x + d * 8, FLOOR - 66), k); p.tip = mix(p.tip, P(x + d * 26, FLOOR - 30), k);
        p.rHand = mix(p.rHand, P(x - d * 34, FLOOR - 126), k);
        return p;
      }
      case 'hit': {
        const c = Math.min(1, t / 22);
        const p = basePose(x, d, 0);
        p.tip = P(x + d * 30, FLOOR - 40);
        return rotate(p, x, FLOOR, -d * c * 1.25);
      }
      default: return idle;
    }
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.bg = document.createElement('canvas');
      this.time = 0;
      this.shake = 0;
      this.flash = 0;
      this.parryFx = 0;
      this.sparks = [];
      this.trails = [[], []];
      this.ghosts = [[], []];
      this.banner = null;
      this.resize();
      addEventListener('resize', () => this.resize());
    }

    resize() {
      const scale = Math.min(2, window.devicePixelRatio || 1);
      if (this.scale === scale) return;
      this.scale = scale;
      this.canvas.width = W * scale; this.canvas.height = H * scale;
      this.buildBackground();
    }

    buildBackground() {
      const s = this.scale, bg = this.bg;
      bg.width = W * s; bg.height = H * s;
      const g = bg.getContext('2d');
      g.setTransform(s, 0, 0, s, 0, 0);
      const sky = g.createLinearGradient(0, 0, 0, FLOOR);
      sky.addColorStop(0, '#04010d'); sky.addColorStop(0.6, '#12062c'); sky.addColorStop(1, '#2b0b3f');
      g.fillStyle = sky; g.fillRect(0, 0, W, H);
      // skyline, two layers, with lit windows
      for (const [layer, base, col] of [[0, 330, '#0b0420'], [1, 360, '#070214']]) {
        let x = 0, i = layer * 100;
        g.fillStyle = col;
        while (x < W) {
          const w = 30 + noise(i) * 50, h = 60 + noise(i + 7) * (layer ? 90 : 170);
          g.fillRect(x, base - h, w, h + 60);
          for (let wy = base - h + 8; wy < base - 6; wy += 9) {
            for (let wx = x + 5; wx < x + w - 5; wx += 8) {
              if (noise(wx * 3.1 + wy * 7.3) > 0.82) {
                g.fillStyle = noise(wx + wy) > 0.5 ? 'rgba(0,240,255,.35)' : 'rgba(255,43,214,.3)';
                g.fillRect(wx, wy, 3, 4);
                g.fillStyle = col;
              }
            }
          }
          x += w + 2; i++;
        }
      }
      const haze = g.createLinearGradient(0, 300, 0, FLOOR);
      haze.addColorStop(0, 'rgba(255,43,214,0)'); haze.addColorStop(1, 'rgba(255,43,214,.22)');
      g.fillStyle = haze; g.fillRect(0, 300, W, FLOOR - 300);
      // floor with a perspective grid
      const floor = g.createLinearGradient(0, FLOOR, 0, H);
      floor.addColorStop(0, '#1a0630'); floor.addColorStop(1, '#05010c');
      g.fillStyle = floor; g.fillRect(0, FLOOR, W, H - FLOOR);
      g.strokeStyle = 'rgba(0,240,255,.18)'; g.lineWidth = 1;
      for (let i = -14; i <= 14; i++) { g.beginPath(); g.moveTo(W / 2 + i * 22, FLOOR); g.lineTo(W / 2 + i * 120, H); g.stroke(); }
      for (let k = 0; k < 8; k++) { const y = FLOOR + Math.pow(k / 7, 1.8) * (H - FLOOR); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
      g.strokeStyle = 'rgba(255,43,214,.7)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, FLOOR); g.lineTo(W, FLOOR); g.stroke();
    }

    /** One-shot effects for simulation events (driven by main.js, de-duplicated there). */
    event(e, s) {
      const y = FLOOR - 90;
      switch (S.EVENTS[e.k]) {
        case 'lunge': break;
        case 'parry':
          this.parryFx = 1; this.flash = 1; this.shake = 14;
          this.burst(e.x, y, 46, '#ffffff', 9); this.burst(e.x, y, 30, COLORS[e.p].main, 7);
          this.banner = { text: 'PARRY!', color: COLORS[e.p].main, life: 1.2 };
          break;
        case 'clash':
          this.shake = 10; this.flash = 0.5;
          this.burst(e.x, y, 40, '#ffe680', 8);
          this.banner = { text: 'CLASH', color: '#ffe680', life: 0.8 };
          break;
        case 'hit':
          this.shake = 22; this.flash = 0.8;
          this.burst(e.x, y + 10, 60, COLORS[e.p].main, 10); this.burst(e.x, y + 10, 30, '#ffffff', 6);
          break;
        case 'time': this.banner = { text: 'TIME', color: '#ffe680', life: 1.3 }; break;
      }
    }

    burst(x, y, n, color, speed) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random());
        this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1, life: 1, decay: 0.02 + Math.random() * 0.03, color });
      }
      if (this.sparks.length > 500) this.sparks.splice(0, this.sparks.length - 500);
    }

    drawWalls(s) {
      const g = this.ctx, [L, R] = S.walls(s);
      const closing = s.phase === 'fight' && s.rt > C.WALL_CLOSE_AT;
      g.save(); g.globalCompositeOperation = 'lighter';
      for (const x of [L, R]) {
        const a = closing ? 0.55 + 0.35 * Math.sin(this.time * 18) : 0.35;
        const grd = g.createLinearGradient(x - 10, 0, x + 10, 0);
        grd.addColorStop(0, 'rgba(255,60,120,0)'); grd.addColorStop(0.5, `rgba(255,80,140,${a})`); grd.addColorStop(1, 'rgba(255,60,120,0)');
        g.fillStyle = grd; g.fillRect(x - 10, FLOOR - 170, 20, 172);
        g.fillStyle = `rgba(255,220,240,${a})`; g.fillRect(x - 1, FLOOR - 170, 2, 172);
      }
      // the piste
      g.fillStyle = 'rgba(0,240,255,.10)'; g.fillRect(L, FLOOR - 3, R - L, 6);
      g.restore();
    }

    drawFencer(f, x, p, alpha, label) {
      const g = this.ctx, col = COLORS[p];
      const pose = poseFor(f, x, this.time);
      const hurt = f.st === 'stagger' && Math.sin(this.time * 40) > 0;
      const main = hurt ? '#ff5050' : col.main;
      g.save();
      g.globalAlpha = alpha * (f.st === 'hit' ? Math.max(0.25, 1 - f.t / 60) : 1);
      g.lineCap = 'round'; g.lineJoin = 'round';
      g.shadowColor = main; g.shadowBlur = 14;
      g.strokeStyle = main; g.lineWidth = 4;
      const line = (...pts) => { g.beginPath(); g.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y); g.stroke(); };
      line(pose.bFoot, pose.bKnee, pose.hip, pose.fKnee, pose.fFoot);
      line(pose.hip, pose.neck);
      line(pose.neck, pose.rElbow, pose.rHand);
      line(pose.neck, pose.elbow, pose.hand);
      // fencing mask
      g.fillStyle = '#05010c';
      g.beginPath(); g.ellipse(pose.head.x, pose.head.y, 10, 12, 0, 0, Math.PI * 2); g.fill(); g.stroke();
      g.lineWidth = 1; g.globalAlpha *= 0.6;
      for (let k = -6; k <= 6; k += 4) line(P(pose.head.x + k, pose.head.y - 10), P(pose.head.x + k, pose.head.y + 10));
      g.globalAlpha = alpha;
      // photonic blade: white core, coloured glow, wind-up charge at the tip
      const charging = f.st === 'lunge' && f.t < C.LUNGE_STARTUP;
      g.shadowBlur = 22; g.strokeStyle = main; g.lineWidth = 6; line(pose.hand, pose.tip);
      g.shadowBlur = 8; g.strokeStyle = '#ffffff'; g.lineWidth = 2; line(pose.hand, pose.tip);
      if (charging) {
        const k = f.t / C.LUNGE_STARTUP;
        g.fillStyle = col.glow + (0.4 + 0.6 * k) + ')';
        g.shadowBlur = 30;
        g.beginPath(); g.arc(pose.tip.x, pose.tip.y, 3 + 7 * k, 0, Math.PI * 2); g.fill();
      }
      // parry shield
      if (f.st === 'parry') {
        const live = f.t < C.PARRY_WINDOW;
        g.shadowBlur = live ? 30 : 6;
        g.strokeStyle = live ? '#ffffff' : 'rgba(255,90,90,.6)';
        g.lineWidth = live ? 4 : 2;
        const cx = x + f.dir * 18, cy = FLOOR - 92, a0 = f.dir > 0 ? -0.9 : Math.PI - 0.9;
        g.beginPath(); g.arc(cx, cy, 44, a0, a0 + 1.8); g.stroke();
        if (live) { g.strokeStyle = main; g.lineWidth = 8; g.globalAlpha = alpha * 0.4; g.stroke(); }
      }
      g.restore();
      if (label) {
        g.save(); g.font = 'bold 12px "Segoe UI", sans-serif'; g.textAlign = 'center';
        g.fillStyle = col.main; g.globalAlpha = 0.85; g.fillText(label, x, FLOOR - 150); g.restore();
      }
      if (f.st === 'stagger') {
        g.save(); g.font = 'bold 13px "Segoe UI", sans-serif'; g.textAlign = 'center';
        g.fillStyle = '#ff6060'; g.fillText('STAGGERED', x, FLOOR - 166); g.restore();
      }
      return pose;
    }

    draw(s, opts, dt) {
      this.time += dt;
      const g = this.ctx, k = dt * 60;
      g.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      g.save();
      if (this.shake > 0.4) g.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      this.shake *= Math.pow(0.86, k);
      g.drawImage(this.bg, 0, 0, W, H);
      this.drawWalls(s);

      const xs = [s.f[0].x + (opts.smooth ? opts.smooth[0] : 0), s.f[1].x + (opts.smooth ? opts.smooth[1] : 0)];
      // dodge afterimages and lunge trails (render-side history)
      for (let p = 0; p < 2; p++) {
        const f = s.f[p];
        const gh = this.ghosts[p];
        if (f.st === 'dodge' && f.t < 14) { if (!gh.length || Math.abs(gh[gh.length - 1].x - xs[p]) > 6) gh.push({ x: xs[p], f: { ...f }, life: 1 }); }
        for (const o of gh) o.life -= 0.06 * k;
        this.ghosts[p] = gh.filter(o => o.life > 0);
        for (const o of this.ghosts[p]) this.drawFencer(o.f, o.x, p, o.life * 0.35, '');
      }
      const poses = [0, 1].map(p => this.drawFencer(s.f[p], xs[p], p, 1, opts.labels ? opts.labels[p] : ''));
      g.save(); g.globalCompositeOperation = 'lighter';
      for (let p = 0; p < 2; p++) {
        const tr = this.trails[p], f = s.f[p];
        if (f.st === 'lunge' && f.t >= C.LUNGE_STARTUP - 1 && f.t < C.LUNGE_STARTUP + C.LUNGE_ACTIVE + 3) tr.push({ x: poses[p].tip.x, y: poses[p].tip.y, life: 1 });
        for (const q of tr) q.life -= 0.09 * k;
        this.trails[p] = tr.filter(q => q.life > 0);
        for (let i = 1; i < this.trails[p].length; i++) {
          const a = this.trails[p][i - 1], b = this.trails[p][i];
          g.strokeStyle = COLORS[p].glow + (b.life * 0.8) + ')'; g.lineWidth = 10 * b.life;
          g.beginPath(); g.moveTo(a.x, a.y - 4); g.lineTo(b.x, b.y); g.stroke();
        }
      }
      for (const sp of this.sparks) {
        sp.x += sp.vx * k; sp.y += sp.vy * k; sp.vy += 0.18 * k; sp.vx *= Math.pow(0.97, k); sp.life -= sp.decay * k;
        g.strokeStyle = sp.color; g.globalAlpha = Math.max(0, sp.life); g.lineWidth = 2;
        g.beginPath(); g.moveTo(sp.x, sp.y); g.lineTo(sp.x - sp.vx * 2.2, sp.y - sp.vy * 2.2); g.stroke();
      }
      g.globalAlpha = 1;
      this.sparks = this.sparks.filter(sp => sp.life > 0 && sp.y < H + 20);
      g.restore();
      g.restore();

      // bullet time: while the parry hit-stop holds, dim the world and frame the moment
      if (s.freeze > 0 && this.parryFx > 0) {
        const v = g.createRadialGradient(W / 2, H / 2, 120, W / 2, H / 2, 560);
        v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.75)');
        g.fillStyle = v; g.fillRect(0, 0, W, H);
        g.fillStyle = 'rgba(120,200,255,.06)';
        for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
      } else if (s.freeze === 0) this.parryFx = 0;
      if (this.flash > 0.01) {
        g.fillStyle = `rgba(255,255,255,${this.flash * 0.7})`; g.fillRect(0, 0, W, H);
        this.flash *= Math.pow(0.8, k);
      }
      this.drawHud(s, opts, k);
    }

    drawHud(s, opts, k) {
      const g = this.ctx;
      g.save();
      g.textBaseline = 'middle';
      // names + round pips (first to 3)
      g.font = 'bold 18px "Segoe UI", sans-serif';
      for (let p = 0; p < 2; p++) {
        const col = COLORS[p];
        g.textAlign = p ? 'right' : 'left';
        g.fillStyle = col.main; g.shadowColor = col.main; g.shadowBlur = 10;
        g.fillText(opts.names[p], p ? W - 24 : 24, 30);
        g.shadowBlur = 0;
        for (let i = 0; i < C.WIN_ROUNDS; i++) {
          const cx = p ? W - 30 - i * 22 : 30 + i * 22;
          g.beginPath(); g.arc(cx, 58, 7, 0, Math.PI * 2);
          if (i < s.score[p]) { g.fillStyle = col.main; g.shadowColor = col.main; g.shadowBlur = 12; g.fill(); g.shadowBlur = 0; }
          else { g.strokeStyle = col.glow + '.45)'; g.lineWidth = 2; g.stroke(); }
        }
      }
      // clock
      g.textAlign = 'center';
      const left = s.phase === 'fight' ? Math.max(0, Math.ceil((C.ROUND_TICKS - s.rt) / 60)) : s.phase === 'intro' ? 30 : Math.max(0, Math.ceil((C.ROUND_TICKS - s.rt) / 60));
      g.font = 'bold 30px "Segoe UI", sans-serif';
      g.fillStyle = left <= 10 && s.phase === 'fight' ? '#ff5a8a' : '#e8e8ff';
      g.fillText(left, W / 2, 34);
      g.font = '12px "Segoe UI", sans-serif'; g.fillStyle = 'rgba(232,232,255,.6)';
      g.fillText(`ROUND ${s.round} · FIRST TO ${C.WIN_ROUNDS}`, W / 2, 60);
      if (opts.status) { g.textAlign = 'left'; g.fillText(opts.status, 14, H - 14); g.textAlign = 'center'; }

      // centre banners
      let text = null, color = '#ffffff', size = 64;
      if (s.phase === 'intro') { text = s.pt > 45 ? `ROUND ${s.round}` : 'EN GARDE'; size = 56; }
      else if (s.phase === 'fight' && s.rt < 32) { text = 'ALLEZ!'; color = '#ffe680'; size = 72 - s.rt; }
      else if (s.phase === 'ko' && s.roundWinner >= 0) { text = 'TOUCHÉ!'; color = COLORS[s.roundWinner].main; size = 76; }
      else if (s.phase === 'over') { text = `${opts.names[s.winner].toUpperCase()} WINS`; color = COLORS[s.winner].main; size = 60; }
      if (this.banner) {
        this.banner.life -= 0.016 * k;
        if (this.banner.life <= 0) this.banner = null;
        else if (!text || s.phase === 'fight') { text = this.banner.text; color = this.banner.color; size = 58 + 20 * Math.max(0, this.banner.life - 0.8); }
      }
      if (text) {
        g.font = `900 ${size}px "Segoe UI", sans-serif`;
        g.shadowColor = color; g.shadowBlur = 24; g.fillStyle = color;
        g.fillText(text, W / 2, 190);
        g.shadowBlur = 0;
      }
      g.restore();
    }
  }

  window.FencingRender = { Renderer, COLORS, W, H };
})();
