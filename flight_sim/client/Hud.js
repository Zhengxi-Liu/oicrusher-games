/**
 * Hud - the heads-up display, drawn on a 2D canvas over the 3D view.
 *   cockpit view: full HUD (pitch ladder rolled with the bank, flight path marker, bank scale)
 *   chase view:   a round artificial horizon instrument at the bottom
 *   always: airspeed tape (kt), altimeter tape (ft) + radar altitude, heading tape, VSI,
 *           throttle / flaps / trim / brakes / wheels, G meter, AoA with the stall band,
 *           warnings (STALL, PULL UP, OVERSPEED), approach guidance (glide slope + centreline),
 *           race panel and next-ring arrow, minimap with terrain, rings and other pilots, a radar on the left (heading up),
 *           the map (peace / war) and the airbase shield status,
 *           weapons: gun reticle and rounds, AIM-9 seeker circle / lock diamond / launch zone, flares,
 *           and the missile warning (MISSILE + where it is coming from).
 */
const KT = 1.94384, FT = 3.28084, DEG = 180 / Math.PI;
const HUD = '#8dffb0', DIM = 'rgba(141,255,176,.55)', WARN = '#ff4a3a', AMBER = '#ffc83a';

export class Hud {
  constructor(canvas, world, field) {
    this.c = canvas; this.g = canvas.getContext('2d');
    this.W = world;
    this.mapImg = this.buildMap(field);
  }

  /** Top-down terrain picture for the minimap (built once). */
  buildMap(field) {
    const S = 220, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d'), img = g.createImageData(S, S), half = this.W.SIZE / 2;
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const x = -half + (i + 0.5) / S * this.W.SIZE, z = -half + (j + 0.5) / S * this.W.SIZE, h = field.at(x, z);
      let r, gg, b;
      if (h < 0) { const d = Math.min(1, -h / 60); r = 30 - d * 15; gg = 80 - d * 30; b = 120 - d * 30; }
      else if (h < 8) { r = 200; gg = 190; b = 150; }
      else { const t = Math.min(1, h / 1300); r = 70 + t * 120; gg = 110 + t * 80; b = 60 + t * 130; if (h > 1080) { r = gg = b = 235; } }
      const k = (j * S + i) * 4; img.data[k] = r; img.data[k + 1] = gg; img.data[k + 2] = b; img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  resize() {
    const r = this.c.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const bw = Math.round(r.width * dpr), bh = Math.round(r.height * dpr);
    if (this.c.width !== bw || this.c.height !== bh) { this.c.width = bw; this.c.height = bh; }      // height alone changes too (fullscreen, vertical resize)
    this.dpr = dpr; this.w = r.width; this.h = r.height;
  }

  text(s, x, y, { size = 13, color = HUD, align = 'center', bold = false } = {}) {
    const g = this.g; g.font = `${bold ? 'bold ' : ''}${size}px "Trebuchet MS", Consolas, monospace`; g.textAlign = align; g.textBaseline = 'middle';
    g.fillStyle = color; g.fillText(s, x, y);
  }

  draw(s) {
    this.resize();
    const g = this.g, w = this.w, h = this.h;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (!s) return;
    g.lineWidth = 1.6; g.strokeStyle = HUD; g.shadowColor = 'rgba(0,0,0,.65)'; g.shadowBlur = 3;
    const sc = Math.min(1.25, Math.max(0.7, h / 720));
    if (s.cockpit) this.ladder(s, w / 2, h / 2, sc); else this.adi(s, w / 2, h - 92 * sc, 70 * sc);
    this.speedTape(s, w / 2 - 300 * sc, h / 2, sc);
    this.altTape(s, w / 2 + 300 * sc, h / 2, sc);
    this.headingTape(s, w / 2, 34 * sc, sc);
    // bottom left: the chat box sits there (always on), so the engine panel and the radar stack above it
    const cb = document.getElementById('chatBox'), cr = cb && cb.offsetParent ? cb.getBoundingClientRect() : null, r = this.c.getBoundingClientRect();
    const floor = cr ? Math.min(h, cr.top - r.top - 10) : h;
    const engY = cr ? floor - (s.msl ? 160 : s.damage || s.immune ? 140 : 122) * sc : h - (s.msl ? 188 : s.damage || s.immune ? 170 : 150) * sc;   // armed planes list more rows below the gear lights
    this.engine(s, 22 * sc, engY, sc);
    this.gauges(s, w - 22 * sc, h - 150 * sc, sc);
    this.minimap(s, w - 14 - 150 * sc, 14, 150 * sc);
    this.mapBadge(s, w / 2, 98 * sc, sc);
    if (s.radarRange) this.radar(s, 14 * sc + 74 * sc, Math.max(74 * sc + 64, Math.min(h * 0.5 + 6 * sc, engY - 52 * sc - 74 * sc)), 74 * sc, sc);   // above the engine panel, below the aerobatics badge
    if (s.approach) this.approach(s, w / 2, h / 2 + 150 * sc, sc);
    if (s.gun && s.gun.pipper) {                              // gun reticle: where the rounds will be 600 m out
      const [px, py] = s.gun.pipper, g = this.g;
      g.save(); g.strokeStyle = s.gun.firing ? AMBER : HUD; g.lineWidth = 1.5; g.shadowBlur = 0;
      g.beginPath(); g.arc(px, py, 14 * sc, 0, 7); g.stroke();
      g.beginPath(); g.arc(px, py, 1.8 * sc, 0, 7); g.fillStyle = g.strokeStyle; g.fill();
      for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; g.beginPath(); g.moveTo(px + Math.cos(a) * 18 * sc, py + Math.sin(a) * 18 * sc); g.lineTo(px + Math.cos(a) * 24 * sc, py + Math.sin(a) * 24 * sc); g.stroke(); }
      g.restore();
    }
    if (s.msl) this.seeker(s, sc);
    if (s.mws) this.mws(s, w, h, sc);
    if (s.fails) {                                                // failed parts (red) and parts running hot (amber)
      const g = this.g; let y = 150 * sc;
      for (const t of s.fails.list) { this.text(t, w / 2, y, { size: 15 * sc, color: '#ff4a3a', bold: true }); y += 20 * sc; }
      if (s.fails.heat) this.text('HEAT ' + s.fails.heat, w / 2, y, { size: 12 * sc, color: AMBER });
    }
    if (s.race) this.racePanel(s, 22 * sc, 64 * sc, sc);
    if (s.ringArrow) this.ringArrow(s, w, h);
    this.warnings(s, w / 2, h / 2 - 110 * sc, sc);
    g.shadowBlur = 0;
  }

  // ---------- map badge and shield status
  mapBadge(s, x, y, sc) {
    const war = s.mapId === 'war';
    this.text(war ? 'WAR MAP' : 'PEACE MAP', x, y, { size: 11 * sc, color: war ? '#ff8a7a' : '#8dd0ff', bold: true });
    const sh = s.shield;
    if (!sh) return;
    if (sh.inside) this.text(`${sh.name.toUpperCase()} SHIELD  ·  WEAPONS SAFE  ·  ONLY BOMBS GET THROUGH`, x, y + 16 * sc, { size: 11 * sc, color: '#7fd0ff', bold: true });
    else if (sh.grace) this.text(`PROTECTED ${sh.grace} s  ·  WEAPONS LIVE`, x, y + 16 * sc, { size: 11 * sc, color: AMBER, bold: true });
  }

  // ---------- radar: the other pilots on this map, heading up, centred on us
  radar(s, cx, cy, R, sc) {
    const g = this.g, range = s.radarRange, k = R / range, h = s.heading, ch = Math.cos(h), sh = Math.sin(h), t = performance.now() / 1000;
    // world offset -> radar pixels (heading up): forward is (sin h, -cos h) in x / z
    const P = (wx, wz) => { const dx = wx - s.pos[0], dz = wz - s.pos[2]; return [dx * ch + dz * sh, dx * sh - dz * ch].map((v, i) => (i ? -v : v) * k); };
    g.save(); g.shadowBlur = 0;
    g.fillStyle = 'rgba(4,16,10,.55)'; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fill();
    g.save(); g.beginPath(); g.arc(cx, cy, R, 0, 7); g.clip(); g.translate(cx, cy);
    // sweep
    const a = (t * 1.1) % (Math.PI * 2);
    const grad = g.createConicGradient ? g.createConicGradient(a - Math.PI / 2, 0, 0) : null;
    if (grad) { grad.addColorStop(0, 'rgba(141,255,176,.0)'); grad.addColorStop(0.9, 'rgba(141,255,176,0)'); grad.addColorStop(1, 'rgba(141,255,176,.22)'); g.fillStyle = grad; g.beginPath(); g.arc(0, 0, R, 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(141,255,176,.22)'; g.lineWidth = 1;
    for (const f of [1 / 3, 2 / 3]) { g.beginPath(); g.arc(0, 0, R * f, 0, 7); g.stroke(); }
    g.beginPath(); g.moveTo(-R, 0); g.lineTo(R, 0); g.moveTo(0, -R); g.lineTo(0, R); g.stroke();
    // airfields and their shields
    for (const f of s.radarFields || []) {
      const S = f.S;
      if (f.box) {
        const [x0, z0, x1, z1] = f.box, c = [P(x0, z0), P(x1, z0), P(x1, z1), P(x0, z1)];
        g.strokeStyle = 'rgba(102,204,255,.55)'; g.setLineDash([4, 3]); g.beginPath(); c.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.stroke(); g.setLineDash([]);
      }
      const [ax, ay] = S.a ? P(S.a[0], S.a[1]) : P(S.x, S.z1), [bx, by] = S.b ? P(S.b[0], S.b[1]) : P(S.x, S.z0);     // a: b: a runway / deck at any heading
      g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 2; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke(); g.lineWidth = 1;
    }
    // contacts
    let near = null;
    g.font = `${9 * sc}px "Trebuchet MS", Consolas, monospace`; g.textAlign = 'left'; g.textBaseline = 'middle';
    for (const o of s.radar || []) {
      if (o.dead) continue;
      const dx = o.x - s.pos[0], dz = o.z - s.pos[2], dist = Math.hypot(dx, dz), dy = o.y - s.pos[1];
      if (!near || dist < near.dist) near = { o, dist, dy };
      let [px, py] = P(o.x, o.z);
      const out = dist > range;
      if (out) { const l = Math.hypot(px, py) || 1; px = px / l * (R - 4); py = py / l * (R - 4); }
      const col = o.war ? '#ff6a5a' : '#7fe0ff';
      g.save(); g.translate(px, py);
      if (out) { g.fillStyle = col; g.globalAlpha = 0.5; g.beginPath(); g.arc(0, 0, 2, 0, 7); g.fill(); g.restore(); continue; }
      g.rotate((o.hdg || 0) - h);
      g.fillStyle = col; g.beginPath(); g.moveTo(0, -5.5 * sc); g.lineTo(4 * sc, 4.5 * sc); g.lineTo(0, 2 * sc); g.lineTo(-4 * sc, 4.5 * sc); g.closePath(); g.fill();
      g.rotate(-((o.hdg || 0) - h));
      if (o.shielded) { g.strokeStyle = 'rgba(102,204,255,.9)'; g.beginPath(); g.arc(0, 0, 7 * sc, 0, 7); g.stroke(); }
      if (Math.abs(dy) > 100) { g.fillStyle = col; g.fillText(`${dy > 0 ? '▲' : '▼'}${Math.round(Math.abs(dy) / 100)}`, 6 * sc, -6 * sc); }
      g.restore();
    }
    g.restore();                                          // end clip
    // frame, north mark, own aircraft
    g.strokeStyle = 'rgba(141,255,176,.7)'; g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke();
    g.save(); g.translate(cx, cy); g.rotate(-h); this.text('N', 0, -R - 7 * sc, { size: 10 * sc, color: HUD, bold: true }); g.restore();
    g.fillStyle = '#fff'; g.save(); g.translate(cx, cy); g.beginPath(); g.moveTo(0, -5 * sc); g.lineTo(4 * sc, 4 * sc); g.lineTo(0, 1.5 * sc); g.lineTo(-4 * sc, 4 * sc); g.closePath(); g.fill(); g.restore();
    this.text(`RADAR ${range / 1000} km  ·  K`, cx, cy + R + 11 * sc, { size: 10 * sc, color: DIM });
    const n = (s.radar || []).filter(o => !o.dead).length;
    if (near) {
      this.text(`${n} contact${n === 1 ? '' : 's'}`, cx, cy + R + 24 * sc, { size: 10 * sc, color: DIM });
      this.text(`${near.o.name.slice(0, 9)} ${(near.dist / 1000).toFixed(1)} km ${near.dy > 100 ? '▲' : near.dy < -100 ? '▼' : ''}`, cx, cy + R + 37 * sc, { size: 10 * sc, color: near.o.war ? '#ff8a7a' : '#9fe6ff' });
    } else this.text('no contacts', cx, cy + R + 24 * sc, { size: 10 * sc, color: DIM });
    g.restore();
  }

  // ---------- attitude
  ladder(s, cx, cy, sc) {
    const g = this.g, ppd = 11 * sc;                    // pixels per degree of pitch
    g.save(); g.translate(cx, cy); g.rotate(-s.bank);
    const p = s.pitch * DEG;
    g.beginPath(); g.rect(-230 * sc, -190 * sc, 460 * sc, 380 * sc); g.clip();
    for (let d = -90; d <= 90; d += 5) {
      const y = (p - d) * ppd;
      if (Math.abs(y) > 200 * sc) continue;
      const wdt = d === 0 ? 220 * sc : d % 10 === 0 ? 70 * sc : 40 * sc;
      g.setLineDash(d < 0 ? [8, 6] : []);
      g.beginPath();
      if (d === 0) { g.moveTo(-wdt, y); g.lineTo(-30 * sc, y); g.moveTo(30 * sc, y); g.lineTo(wdt, y); }
      else { g.moveTo(-wdt - 30 * sc, y); g.lineTo(-30 * sc, y); g.lineTo(-30 * sc, y + (d > 0 ? 8 : -8)); g.moveTo(30 * sc, y + (d > 0 ? 8 : -8)); g.lineTo(30 * sc, y); g.lineTo(wdt + 30 * sc, y); }
      g.stroke();
      if (d && d % 10 === 0) { this.text(String(Math.abs(d)), -wdt - 44 * sc, y, { size: 12 * sc }); this.text(String(Math.abs(d)), wdt + 44 * sc, y, { size: 12 * sc }); }
    }
    g.setLineDash([]);
    g.restore();
    // bank scale at the top
    g.save(); g.translate(cx, cy);
    const R = 170 * sc;
    for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const r = a * Math.PI / 180 - Math.PI / 2, l = a % 30 === 0 ? 12 : 7;
      g.beginPath(); g.moveTo(Math.cos(r) * R, Math.sin(r) * R); g.lineTo(Math.cos(r) * (R + l * sc), Math.sin(r) * (R + l * sc)); g.stroke();
    }
    g.rotate(-s.bank); g.beginPath(); g.moveTo(0, -R + 2); g.lineTo(-7 * sc, -R + 14 * sc); g.lineTo(7 * sc, -R + 14 * sc); g.closePath(); g.stroke();
    g.restore();
    // aircraft reference "W" and the flight path marker
    g.beginPath(); g.moveTo(cx - 34 * sc, cy); g.lineTo(cx - 16 * sc, cy); g.lineTo(cx - 8 * sc, cy + 10 * sc); g.lineTo(cx, cy); g.lineTo(cx + 8 * sc, cy + 10 * sc); g.lineTo(cx + 16 * sc, cy); g.lineTo(cx + 34 * sc, cy); g.stroke();
    if (s.fpm) {
      const x = s.fpm[0], y = s.fpm[1];
      g.beginPath(); g.arc(x, y, 7 * sc, 0, 7); g.moveTo(x - 7 * sc, y); g.lineTo(x - 18 * sc, y); g.moveTo(x + 7 * sc, y); g.lineTo(x + 18 * sc, y); g.moveTo(x, y - 7 * sc); g.lineTo(x, y - 14 * sc); g.stroke();
    }
  }

  adi(s, cx, cy, r) {
    const g = this.g;
    g.save(); g.shadowBlur = 0;
    g.beginPath(); g.arc(cx, cy, r, 0, 7); g.clip();
    g.translate(cx, cy); g.rotate(-s.bank);
    const ppd = r / 30, off = s.pitch * DEG * ppd;
    g.fillStyle = '#3a7bd5'; g.fillRect(-r * 2, -r * 3 + off, r * 4, r * 3);
    g.fillStyle = '#8a5a2b'; g.fillRect(-r * 2, off, r * 4, r * 3);
    g.strokeStyle = '#fff'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(-r * 2, off); g.lineTo(r * 2, off); g.stroke();
    for (let d = -40; d <= 40; d += 10) { if (!d) continue; const y = off - d * ppd; const wd = d % 20 === 0 ? r * 0.35 : r * 0.18; g.beginPath(); g.moveTo(-wd, y); g.lineTo(wd, y); g.stroke(); }
    g.restore();
    g.save(); g.lineWidth = 3; g.strokeStyle = '#222'; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke();
    g.strokeStyle = '#ffd23a'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(cx - r * 0.55, cy); g.lineTo(cx - r * 0.18, cy); g.lineTo(cx - r * 0.1, cy + r * 0.1); g.moveTo(cx + r * 0.55, cy); g.lineTo(cx + r * 0.18, cy); g.lineTo(cx + r * 0.1, cy + r * 0.1); g.stroke();
    g.beginPath(); g.arc(cx, cy, 3, 0, 7); g.fillStyle = '#ffd23a'; g.fill();
    // bank pointer
    g.translate(cx, cy); g.rotate(-s.bank); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -r + 3); g.lineTo(-6, -r + 13); g.lineTo(6, -r + 13); g.fill();
    g.restore();
  }

  // ---------- tapes
  speedTape(s, x, cy, sc) {
    const g = this.g, H = 260 * sc, v = s.ias * KT, span = s.spec.engine.kind === 'jet' ? 160 : 80, ppu = H / span;
    g.save(); g.beginPath(); g.rect(x - 70 * sc, cy - H / 2, 75 * sc, H); g.clip();
    for (let k = Math.floor((v - span / 2) / 10) * 10; k <= v + span / 2; k += span > 80 ? 10 : 5) {
      if (k < 0) continue;
      const y = cy + (v - k) * ppu;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x - (k % 10 ? 7 : 13) * sc, y); g.stroke();
      if (k % (span > 80 ? 40 : 20) === 0) this.text(String(k), x - 32 * sc, y, { size: 12 * sc, align: 'right' });
    }
    // speed bands: stall (red, below ~55 kt clean / 50 kt flaps), flap range (white), never exceed
    const band = (a, b, col) => { g.fillStyle = col; const y1 = cy + (v - a) * ppu, y2 = cy + (v - b) * ppu; g.fillRect(x + 2, Math.min(y1, y2), 5 * sc, Math.abs(y2 - y1)); };
    const SP = s.spec.hud;                                         // this aircraft's speeds
    band(0, s.flaps ? SP.vs1 : SP.vs0, 'rgba(255,74,58,.85)'); band(SP.vs1, SP.vfe, 'rgba(255,255,255,.55)'); band(SP.vne, SP.vne + 400, 'rgba(255,74,58,.85)');
    g.restore();
    this.box(x - 44 * sc, cy, 64 * sc, 24 * sc, String(Math.round(v)), s.ias * KT < (s.flaps ? s.spec.hud.vs1 : s.spec.hud.vs0) * 1.05 && !s.onGround ? WARN : HUD, sc);
    this.text('IAS kt', x - 30 * sc, cy - H / 2 - 12 * sc, { size: 11 * sc, color: DIM });
    this.text(`GS ${Math.round(s.gs * KT)}`, x - 30 * sc, cy + H / 2 + 12 * sc, { size: 11 * sc, color: DIM });
    // airspeed bar (air-relative, not ground speed) under the GS readout: red zone + white tick = stall speed, faint tick = ground speed
    const bw = 120 * sc, bx = x - bw + 5 * sc, ay = cy + H / 2 + 26 * sc, bh = 10 * sc;
    const vsK = (s.flaps ? SP.vs1 : SP.vs0) * KT, top = Math.max(SP.vne * 0.6, vsK * 2.2);
    const X = u => bx + bw * Math.max(0, Math.min(1, u / top));
    g.strokeRect(bx, ay, bw, bh);
    g.fillStyle = 'rgba(255,74,58,.35)'; g.fillRect(bx + 1, ay + 1, X(vsK) - bx - 1, bh - 2);
    g.fillStyle = v < vsK ? WARN : HUD; g.fillRect(bx + 1, ay + 2, Math.max(0, X(v) - bx - 2), bh - 4);
    g.fillStyle = '#fff'; g.fillRect(X(vsK) - 1, ay - 3 * sc, 2, bh + 6 * sc);
    g.fillStyle = DIM; g.fillRect(X(s.gs * KT) - 1, ay - 3 * sc, 1, bh + 6 * sc);
    this.text(`AIRSPEED ${Math.round(v)} kt`, bx, ay + bh + 12 * sc, { size: 11 * sc, align: 'left', color: v < vsK ? WARN : HUD });
    this.text(`GND ${Math.round(s.gs * KT)}`, bx + bw, ay + bh + 12 * sc, { size: 11 * sc, align: 'right', color: DIM });
  }

  altTape(s, x, cy, sc) {
    const g = this.g, H = 260 * sc, a = s.alt * FT, ppu = H / 800;
    g.save(); g.beginPath(); g.rect(x - 5 * sc, cy - H / 2, 90 * sc, H); g.clip();
    for (let k = Math.floor((a - 400) / 50) * 50; k <= a + 400; k += 50) {
      const y = cy + (a - k) * ppu;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (k % 100 ? 7 : 13) * sc, y); g.stroke();
      if (k % 200 === 0) this.text(String(k), x + 22 * sc, y, { size: 12 * sc, align: 'left' });
    }
    // ground level on the tape
    const gy = cy + (a - s.groundAlt * FT) * ppu;
    if (gy < cy + H / 2) { g.fillStyle = 'rgba(160,100,40,.5)'; g.fillRect(x, gy, 80 * sc, cy + H / 2 - gy); }
    g.restore();
    this.box(x + 44 * sc, cy, 74 * sc, 24 * sc, String(Math.round(a)), HUD, sc);
    this.text('ALT ft', x + 40 * sc, cy - H / 2 - 12 * sc, { size: 11 * sc, color: DIM });
    if (s.agl < 2500 / FT) this.text(`R ${Math.max(0, Math.round(s.agl * FT))}`, x + 40 * sc, cy + H / 2 + 12 * sc, { size: 12 * sc, color: s.agl < 60 ? AMBER : HUD, bold: true });
    // vertical speed (fpm) bar
    const vs = s.vs * FT * 60, vx = x + 98 * sc, k = Math.max(-1, Math.min(1, vs / 2000));
    g.beginPath(); g.moveTo(vx, cy - 90 * sc); g.lineTo(vx, cy + 90 * sc); g.strokeStyle = DIM; g.stroke(); g.strokeStyle = HUD;
    g.lineWidth = 4; g.beginPath(); g.moveTo(vx, cy); g.lineTo(vx, cy - k * 90 * sc); g.stroke(); g.lineWidth = 1.6;
    this.text(`${vs >= 0 ? '+' : ''}${Math.round(vs / 10) * 10}`, vx + 6 * sc, cy - k * 90 * sc, { size: 11 * sc, align: 'left' });
    this.text('VS fpm', vx, cy + 104 * sc, { size: 10 * sc, color: DIM });
  }

  headingTape(s, cx, y, sc) {
    const g = this.g, W = 360 * sc, hd = s.heading * DEG, ppd = W / 60;
    g.save(); g.beginPath(); g.rect(cx - W / 2, y - 20 * sc, W, 44 * sc); g.clip();
    for (let d = Math.floor((hd - 35) / 5) * 5; d <= hd + 35; d += 5) {
      const x = cx + (d - hd) * ppd, n = ((d % 360) + 360) % 360;
      g.beginPath(); g.moveTo(x, y + 10 * sc); g.lineTo(x, y + (n % 10 ? 4 : 0) * sc); g.stroke();
      if (n % 30 === 0) this.text({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[n] || String(n / 10).padStart(2, '0'), x, y - 8 * sc, { size: 12 * sc, bold: n % 90 === 0 });
    }
    // wind arrow relative to heading
    g.restore();
    this.box(cx, y + 24 * sc, 54 * sc, 20 * sc, String(Math.round(hd) % 360).padStart(3, '0'), HUD, sc);
    if (s.windSpeed > 0.5) {
      const rel = s.windFrom - s.heading;
      g.save(); g.translate(cx + W / 2 + 34 * sc, y + 8 * sc); g.rotate(rel + Math.PI);
      g.beginPath(); g.moveTo(0, -14 * sc); g.lineTo(0, 14 * sc); g.moveTo(-6 * sc, 6 * sc); g.lineTo(0, 14 * sc); g.lineTo(6 * sc, 6 * sc); g.stroke(); g.restore();
      this.text(`${Math.round(s.windSpeed * KT)} kt`, cx + W / 2 + 34 * sc, y + 32 * sc, { size: 11 * sc });
    }
  }

  box(x, y, w, h, label, color, sc) {
    const g = this.g;
    g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(x - w / 2, y - h / 2, w, h);
    g.strokeStyle = color; g.strokeRect(x - w / 2, y - h / 2, w, h); g.strokeStyle = HUD;
    this.text(label, x, y + 1, { size: 15 * sc, color, bold: true });
  }

  // ---------- engine & config (bottom left)
  engine(s, x, y, sc) {
    const g = this.g, H = 110 * sc;
    g.strokeRect(x, y, 16 * sc, H);
    g.fillStyle = HUD; g.fillRect(x + 2, y + H - 2 - (H - 4) * s.throttle, 16 * sc - 4, (H - 4) * s.throttle);
    g.fillStyle = AMBER; g.fillRect(x - 3, y + H - H * s.engine, 22 * sc, 2);
    this.text('THR', x + 8 * sc, y + H + 12 * sc, { size: 11 * sc });
    this.text(`${Math.round(s.throttle * 100)}%`, x + 8 * sc, y - 10 * sc, { size: 12 * sc, bold: true });
    const tx = x + 34 * sc;
    this.text(s.spec.engine.kind === 'jet' ? `N1 ${Math.round(60 + s.engine * 40)}%${s.engine > 0.9 && !s.spec.engine.noAB ? ' · A/B' : ''}` : `RPM ${Math.round(700 + s.engine * 2000)}`, tx, y + 8 * sc, { size: 12 * sc, align: 'left', color: s.engine > 0.9 && s.spec.engine.kind === 'jet' && !s.spec.engine.noAB ? AMBER : HUD });
    this.text(`FLAPS ${s.flaps ? Math.round(s.spec.flaps[s.flaps] * 180 / Math.PI) + '°' : 'UP'}`, tx, y + 28 * sc, { size: 12 * sc, align: 'left', color: s.flaps ? AMBER : HUD });
    this.text(`TRIM ${s.trim > 0 ? '▲' : s.trim < 0 ? '▼' : '·'} ${Math.round(Math.abs(s.trim) * 100)}`, tx, y + 48 * sc, { size: 12 * sc, align: 'left' });
    this.text(s.brake ? 'BRAKES' : '', tx, y + 68 * sc, { size: 12 * sc, align: 'left', color: AMBER, bold: true });
    // gear lights: green = weight on that wheel; retractable gear: DOWN / UP / moving (amber), warning if low and slow
    s.wheels.forEach((on, i) => { g.beginPath(); g.arc(tx + 6 * sc + i * 16 * sc, y + 92 * sc, 5 * sc, 0, 7); g.fillStyle = on ? '#3dff6a' : 'rgba(255,255,255,.18)'; g.fill(); });
    if (s.gear) {
      const st = s.gear.pos > 0.999 ? 'DOWN' : s.gear.pos < 0.001 ? 'UP' : 'TRANSIT';
      const warn = s.gear.warn && Math.floor(performance.now() / 400) % 2;
      this.text(warn ? 'GEAR!' : `GEAR ${st}`, tx + 62 * sc, y + 92 * sc, { size: 11 * sc, align: 'left', bold: true, color: warn ? '#ff4a3a' : st === 'DOWN' ? '#3dff6a' : st === 'UP' ? HUD : AMBER });
    } else this.text('GEAR', tx + 62 * sc, y + 92 * sc, { size: 10 * sc, align: 'left', color: DIM });
    if (s.airbrake > 0.01) this.text('SPD BRK', tx, y + 112 * sc, { size: 12 * sc, align: 'left', color: AMBER, bold: true });
    if (s.gun) this.text(`GUN ${s.gun.ammo}`, tx + 70 * sc, y + 112 * sc, { size: 12 * sc, align: 'left', color: s.gun.ammo ? (s.gun.firing ? AMBER : HUD) : '#ff4a3a', bold: s.gun.firing });
    if (s.damage) this.text(s.damage >= 8 ? 'DAMAGE · FIRE' : 'DAMAGE', tx, y + 132 * sc, { size: 12 * sc, align: 'left', color: '#ff4a3a', bold: true });
    else if (s.immune) this.text('IMMUNE · WPN SAFE', tx, y + 132 * sc, { size: 12 * sc, align: 'left', color: '#7cff9a', bold: true });
    if (s.msl) {
      this.text(`${s.msl.type} ${s.msl.tleft}/${s.msl.left}`, tx, y + 152 * sc, { size: 12 * sc, align: 'left', color: s.msl.left ? (s.msl.state === 'lock' ? AMBER : HUD) : '#ff4a3a', bold: s.msl.state === 'lock' });
      this.text(`FLR ${s.msl.flares}`, tx + 92 * sc, y + 152 * sc, { size: 12 * sc, align: 'left', color: s.msl.prog ? AMBER : s.msl.flares ? HUD : '#ff4a3a', bold: s.msl.prog });
    }
  }

  // ---------- AIM-9 seeker: dashed circle on the nose while searching, solid on a target it sees, diamond when locked
  seeker(s, sc) {
    const m = s.msl, p = m.seeker, g = this.g;
    if (m.state === 'empty' || !p.on) return;
    const r = 22 * sc;
    g.save(); g.lineWidth = 1.6; g.shadowBlur = 0;
    g.strokeStyle = m.state === 'lock' ? AMBER : m.state === 'track' ? HUD : DIM;
    if (m.state === 'search') g.setLineDash([5 * sc, 5 * sc]);
    g.beginPath(); g.arc(p.x, p.y, r, 0, 7); g.stroke(); g.setLineDash([]);
    if (m.state === 'lock') {
      g.beginPath(); g.moveTo(p.x, p.y - 10 * sc); g.lineTo(p.x + 10 * sc, p.y); g.lineTo(p.x, p.y + 10 * sc); g.lineTo(p.x - 10 * sc, p.y); g.closePath(); g.stroke();
      const inR = m.dlz === true, out = m.dlz === false;
      this.text(`LOCK ${(m.dist / 1000).toFixed(1)} km`, p.x, p.y + r + 16 * sc, { size: 12 * sc, color: AMBER, bold: true });
      if (inR || out) this.text(inR ? 'IN RNG - SHOOT' : 'OUT OF RNG', p.x, p.y + r + 32 * sc, { size: 12 * sc, color: inR ? '#3dff6a' : AMBER, bold: true });
    } else if (m.state === 'track') this.text(`${(m.dist / 1000).toFixed(1)} km`, p.x, p.y + r + 16 * sc, { size: 11 * sc });
    g.restore();
  }

  // ---------- missile warning: blinking MISSILE, a red diamond on each one we can see, an arrow to the others
  mws(s, w, h, sc) {
    const g = this.g, blink = Math.floor(performance.now() / 160) % 2;
    const near = Math.min(...s.mws.map(m => m.dist));
    this.text(`MISSILE ${(near / 1000).toFixed(1)} km`, w / 2, h / 2 - 160 * sc, { size: 26 * sc, color: blink ? WARN : '#ffffff', bold: true });
    g.save(); g.strokeStyle = WARN; g.fillStyle = WARN; g.lineWidth = 2.5; g.shadowBlur = 0;
    for (const m of s.mws) {
      if (m.on) {
        const d = 14 * sc;
        g.beginPath(); g.moveTo(m.x, m.y - d); g.lineTo(m.x + d, m.y); g.lineTo(m.x, m.y + d); g.lineTo(m.x - d, m.y); g.closePath(); g.stroke();
        this.text(`${(m.dist / 1000).toFixed(1)}`, m.x, m.y - d - 6 * sc, { size: 11 * sc, color: WARN, bold: true });
      } else {
        const cx = w / 2, cy = h / 2, ang = Math.atan2(m.y - cy, m.x - cx), r = Math.min(w, h) * 0.42;
        g.save(); g.translate(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r); g.rotate(ang);
        g.beginPath(); g.moveTo(26, 0); g.lineTo(-12, -16); g.lineTo(-5, 0); g.lineTo(-12, 16); g.closePath(); g.fill(); g.restore();
      }
    }
    g.restore();
  }

  // ---------- G meter + AoA (bottom right)
  gauges(s, x, y, sc) {
    const g = this.g;
    this.text(`G ${s.g.toFixed(1)}`, x - 160 * sc - 4, y - 14 * sc, { size: 15 * sc, align: 'left', bold: true, color: s.g > 5 || s.g < -2 ? AMBER : HUD });
    this.text(`max ${s.maxG.toFixed(1)}`, x - 160 * sc - 4, y + 4 * sc, { size: 11 * sc, align: 'left', color: DIM });
    // AoA bar
    const bx = x - 160 * sc, by = y + 22 * sc, bw = 150 * sc, a = s.alpha * DEG;
    g.strokeRect(bx, by, bw, 12 * sc);
    const w0 = s.spec.surfaces[0], crit = (w0.stall - w0.inc) * DEG, span = crit + 10;
    const k = Math.max(0, Math.min(1, (a + 4) / span));
    g.fillStyle = 'rgba(255,74,58,.6)'; g.fillRect(bx + bw * ((crit - 2 + 4) / span), by + 1, bw * (1 - (crit - 2 + 4) / span), 12 * sc - 2);
    g.fillStyle = s.stallWarn ? WARN : HUD; g.fillRect(bx + 1, by + 2, (bw - 2) * k, 12 * sc - 4);
    this.text(`AoA ${a.toFixed(1)}°`, bx, by + 24 * sc, { size: 11 * sc, align: 'left' });
    this.text(`slip ${(s.beta * DEG).toFixed(0)}°`, bx + bw, by + 24 * sc, { size: 11 * sc, align: 'right', color: DIM });
  }

  warnings(s, cx, y, sc) {
    const t = performance.now() / 1000, blink = Math.sin(t * 10) > -0.2;
    const lines = [];
    if (s.stallWarn && !s.onGround) lines.push(['STALL', WARN]);
    if (s.pullUp) lines.push(['PULL UP', WARN]);
    if (s.ias * KT > s.spec.hud.vne) lines.push(['OVERSPEED', AMBER]);
    if (s.message) lines.push([s.message, s.messageColor || HUD]);
    lines.forEach(([txt, col], i) => { if (col === WARN && !blink) return; this.text(txt, cx, y + i * 30 * sc, { size: 24 * sc, color: col, bold: true }); });
  }

  // ---------- approach guidance (glide slope + localizer, like an ILS)
  approach(s, cx, cy, sc) {
    const g = this.g, a = s.approach, R = 70 * sc;
    g.strokeStyle = DIM; g.strokeRect(cx - R, cy - R * 0.6, R * 2, R * 1.2); g.strokeStyle = HUD;
    for (let i = -2; i <= 2; i++) { if (!i) continue; g.beginPath(); g.arc(cx + i * R / 2.5, cy + R * 0.48, 2.5, 0, 7); g.stroke(); g.beginPath(); g.arc(cx + R * 0.9, cy - i * R * 0.2, 2.5, 0, 7); g.stroke(); }
    const loc = Math.max(-1, Math.min(1, a.loc)), gs = Math.max(-1, Math.min(1, a.gs));
    g.beginPath(); g.moveTo(cx + loc * R * 0.8, cy - R * 0.55); g.lineTo(cx + loc * R * 0.8, cy + R * 0.42); g.stroke();
    g.beginPath(); g.moveTo(cx - R * 0.95, cy - gs * R * 0.4); g.lineTo(cx + R * 0.82, cy - gs * R * 0.4); g.stroke();
    g.beginPath(); g.arc(cx, cy, 3, 0, 7); g.fillStyle = HUD; g.fill();
    this.text(`${s.spec.floats ? "SEA LANE" : "RWY 36"} · ${(a.dist / 1000).toFixed(1)} km · ${Math.round(a.offset)} m ${a.offset > 0 ? 'R' : 'L'}`, cx, cy - R * 0.6 - 12 * sc, { size: 12 * sc });
    this.text(a.gsText, cx, cy + R * 0.6 + 12 * sc, { size: 12 * sc, color: Math.abs(a.gs) < 0.3 ? HUD : AMBER });
  }

  racePanel(s, x, y, sc) {
    const r = s.race, g = this.g;
    g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(x - 8, y - 16 * sc, 210 * sc, 92 * sc);
    this.text(`RING RACE`, x, y - 4 * sc, { size: 12 * sc, align: 'left', color: DIM });
    this.text(fmtTime(r.time), x, y + 20 * sc, { size: 26 * sc, align: 'left', bold: true, color: r.done ? AMBER : HUD });
    this.text(`ring ${Math.min(r.next + 1, r.total)} / ${r.total}${r.dist != null ? ` · ${Math.round(r.dist)} m` : ''}`, x, y + 44 * sc, { size: 13 * sc, align: 'left' });
    if (r.delta != null) this.text(`${r.delta > 0 ? '+' : '−'}${Math.abs(r.delta).toFixed(2)} s vs best`, x, y + 62 * sc, { size: 13 * sc, align: 'left', color: r.delta > 0 ? WARN : '#5dff8a' });
  }

  /** Arrow at the screen edge pointing to the next ring when it is off screen. */
  ringArrow(s, w, h) {
    const a = s.ringArrow, g = this.g;
    if (a.onScreen) {
      g.save(); g.strokeStyle = '#ffe14d'; g.lineWidth = 2;
      g.beginPath(); g.arc(a.x, a.y, 18, 0, 7); g.stroke(); g.restore();
      return;
    }
    const cx = w / 2, cy = h / 2, ang = Math.atan2(a.y - cy, a.x - cx);
    const r = Math.min(w, h) * 0.38, x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r;
    g.save(); g.translate(x, y); g.rotate(ang); g.fillStyle = '#ffe14d';
    g.beginPath(); g.moveTo(22, 0); g.lineTo(-10, -14); g.lineTo(-4, 0); g.lineTo(-10, 14); g.closePath(); g.fill(); g.restore();
  }

  minimap(s, x, y, size) {
    const g = this.g, W = this.W, half = W.SIZE / 2;
    g.save(); g.shadowBlur = 0;
    g.globalAlpha = 0.85; g.drawImage(this.mapImg, x, y, size, size); g.globalAlpha = 1;
    g.strokeStyle = 'rgba(255,255,255,.5)'; g.strokeRect(x, y, size, size);
    const P = (wx, wz) => [x + (wx + half) / W.SIZE * size, y + (wz + half) / W.SIZE * size];
    // runway
    const [rx, rz0] = P(0, W.RUNWAY.z1), [, rz1] = P(0, W.RUNWAY.z0);
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(rx, rz0); g.lineTo(rx, rz1); g.stroke();
    { const A = W.AIRSTRIP, [ax, az0] = P(A.x, A.z1), [, az1] = P(A.x, A.z0); g.strokeStyle = '#e0a060'; g.lineWidth = 2; g.beginPath(); g.moveTo(ax, az0); g.lineTo(ax, az1); g.stroke();      // Cinder Cay's dirt strip
      if (size > 130) { g.font = '9px Arial'; g.textAlign = 'center'; g.fillStyle = 'rgba(255,255,255,.75)'; g.fillText('Cinder Cay', ax, az0 - 6); } }
    if (s.race) {
      g.strokeStyle = 'rgba(34,230,255,.6)'; g.lineWidth = 1; g.beginPath();
      W.COURSE.forEach((r, i) => { const [px, pz] = P(r.x, r.z); if (i) g.lineTo(px, pz); else g.moveTo(px, pz); }); g.stroke();
      const nr = W.COURSE[Math.min(s.race.next, W.COURSE.length - 1)]; const [nx, nz] = P(nr.x, nr.z);
      g.fillStyle = '#ffe14d'; g.beginPath(); g.arc(nx, nz, 3.5, 0, 7); g.fill();
    }
    for (const p of s.pois || []) {                         // playground spots
      const [qx, qz] = P(p.x, p.z); g.fillStyle = p.color; g.beginPath(); g.moveTo(qx, qz - 4); g.lineTo(qx + 3.5, qz); g.lineTo(qx, qz + 4); g.lineTo(qx - 3.5, qz); g.closePath(); g.fill();
      if (size > 130) { g.font = '9px Arial'; g.textAlign = 'center'; g.fillStyle = 'rgba(255,255,255,.75)'; g.fillText(p.label, qx, qz - 6); }
    }
    for (const o of s.others || []) { const [ox, oz] = P(o.x, o.z); g.fillStyle = o.color; g.beginPath(); g.arc(ox, oz, 3, 0, 7); g.fill(); }
    const [px, pz] = P(s.pos[0], s.pos[2]);
    g.translate(px, pz); g.rotate(s.heading); g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 5); g.lineTo(0, 2); g.lineTo(-5, 5); g.closePath(); g.fill();
    g.restore();
  }
}

export function fmtTime(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
}
