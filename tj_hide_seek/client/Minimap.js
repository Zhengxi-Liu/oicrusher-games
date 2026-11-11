/**
 * Minimap + full map. Each floor is drawn once into an offscreen canvas (rooms by kind, courtyards, stairs,
 * room numbers); the HUD corner shows a north-up window around you, M opens both floors side by side.
 */
const KIND = {
  class: '#dfe5f2', lab: '#f3e1c8', cs: '#d3eef3', office: '#e4e4e4', music: '#eadcf0', gym: '#f0d8d2', aud: '#e8d4dc', cafe: '#f6e7c9',
  library: '#ead9c3', store: '#dcdcdc', rest: '#e0e8ea', lounge: '#f2e2e6', mech: '#d6d6d6', plan: '#d9d6f0', lecture: '#dfe5f2', art: '#f1e0ef',
  kitchen: '#eaeae0', locker: '#e3e3ea', blackbox: '#cfcfd6',
};
const PXM = 3;     // px per metre in the offscreen maps

export class Minimap {
  constructor(map, canvas) {
    this.map = map;
    this.canvas = canvas; this.g = canvas.getContext('2d');
    const all = [...map.outline[1].poly, ...map.outline[2].poly];
    this.x0 = Math.min(...all.map(p => p[0])) - 6; this.z0 = Math.min(...all.map(p => p[1])) - 6;
    this.x1 = Math.max(...all.map(p => p[0])) + 6; this.z1 = Math.max(...all.map(p => p[1])) + 6;
    this.floors = { 1: this.render(1), 2: this.render(2) };
    this.zoom = 2.6;
  }
  toPx(x, z) { return [(x - this.x0) * PXM, (z - this.z0) * PXM]; }

  render(f) {
    const m = this.map, c = document.createElement('canvas');
    c.width = Math.ceil((this.x1 - this.x0) * PXM); c.height = Math.ceil((this.z1 - this.z0) * PXM);
    const g = c.getContext('2d');
    const path = poly => { g.beginPath(); poly.forEach(([x, z], i) => { const [a, b] = this.toPx(x, z); i ? g.lineTo(a, b) : g.moveTo(a, b); }); g.closePath(); };
    if (f === 2) { g.globalAlpha = 0.18; path(m.outline[1].poly); g.fillStyle = '#9aa3b5'; g.fill(); g.globalAlpha = 1; }
    path(m.outline[f].poly); g.fillStyle = '#f7f3ea'; g.fill(); g.strokeStyle = '#1c2b4f'; g.lineWidth = 3; g.stroke();
    if (f === 1) {
      for (const ct of m.courts) { path(ct.poly); g.fillStyle = '#9cc98a'; g.fill(); g.strokeStyle = '#5b8a4a'; g.lineWidth = 1.5; g.stroke(); }
      const [dx, dz] = this.toPx(m.dome.x, m.dome.z);
      g.beginPath(); g.arc(dx, dz, m.dome.r * PXM, 0, 7); g.fillStyle = '#f7f3ea'; g.fill(); g.strokeStyle = '#1c2b4f'; g.lineWidth = 2; g.stroke();
    } else for (const v of m.voids) { path(v.poly); g.fillStyle = '#c9d2e3'; g.fill(); g.setLineDash([4, 3]); g.strokeStyle = '#6a7690'; g.lineWidth = 1.5; g.stroke(); g.setLineDash([]); }
    for (const r of m.rooms) if (r.floor === f) {
      path(r.poly); g.fillStyle = KIND[r.kind] || '#e6e6e6'; g.fill(); g.strokeStyle = '#59627a'; g.lineWidth = 1.2; g.stroke();
      for (const d of r.doors) { const [a, b] = this.toPx(d.x, d.z); g.fillStyle = '#f7f3ea'; g.fillRect(a - 2, b - 2, 4, 4); }
    }
    for (const st of m.stairs) {
      path(st.box); g.fillStyle = '#c23b4e'; g.fill();
      const a = this.toPx(...m.toWorld(st, 0.4, st.w / 2)), b = this.toPx(...m.toWorld(st, st.l - 0.4, st.w / 2));
      g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke();
    }
    for (const fl of (m.fills || [])) if (fl.floor === f) { path(fl.poly); g.fillStyle = '#59627a'; g.fill(); }   // sealed slivers
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const r of m.rooms) if (r.floor === f) {
      const [cx, cz] = m.centroid(r.poly), [a, b] = this.toPx(cx, cz), bb = m.bbox(r.poly);
      const w = (bb.x1 - bb.x0) * PXM, label = r.name.length > 14 ? r.name.split(' ')[0] : r.name;
      let size = Math.min(13, Math.max(7, w / Math.max(3, label.length) * 1.5));
      g.font = `600 ${size}px system-ui, sans-serif`; g.fillStyle = '#2a3348'; g.fillText(label, a, b);
    }
    for (const l of m.labels) if (l.floor === f) { const [a, b] = this.toPx(...l.p); g.font = 'italic 700 12px Georgia, serif'; g.fillStyle = '#9b1b30'; g.fillText(l.name, a, b); }
    return c;
  }

  /** Corner minimap: north-up, centred on the player. */
  draw(player, others, stashes) {
    const g = this.g, W = this.canvas.width, H = this.canvas.height, f = player.floor, z = this.zoom;
    g.save();
    g.clearRect(0, 0, W, H);
    g.beginPath(); g.arc(W / 2, H / 2, W / 2 - 2, 0, 7); g.clip();
    g.fillStyle = '#2b3a5c'; g.fillRect(0, 0, W, H);
    const [px, pz] = this.toPx(player.pos.x, player.pos.z);
    g.translate(W / 2, H / 2); g.scale(z / PXM, z / PXM); g.translate(-px, -pz);
    g.drawImage(this.floors[f], 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    const toScreen = (x, zz) => { const [a, b] = this.toPx(x, zz); return [W / 2 + (a - px) * z / PXM, H / 2 + (b - pz) * z / PXM]; };
    for (const s of stashes) if (s.floor === f) { const [a, b] = toScreen(s.x, s.z); g.fillStyle = '#ffd23f'; g.strokeStyle = '#000'; g.lineWidth = 1; g.beginPath(); g.arc(a, b, 4, 0, 7); g.fill(); g.stroke(); }
    for (const o of others) if (o.floor === f) { const [a, b] = toScreen(o.x, o.z); g.fillStyle = '#4da3ff'; g.beginPath(); g.arc(a, b, 4, 0, 7); g.fill(); }
    // you: an arrow pointing where you look
    g.translate(W / 2, H / 2); g.rotate(-player.yaw);
    g.fillStyle = '#e8384f'; g.strokeStyle = '#fff'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 7); g.lineTo(0, 3); g.lineTo(-6, 7); g.closePath(); g.fill(); g.stroke();
    g.restore();
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 3; g.beginPath(); g.arc(W / 2, H / 2, W / 2 - 2, 0, 7); g.stroke();
    g.fillStyle = '#fff'; g.font = 'bold 11px system-ui'; g.textAlign = 'center'; g.fillText('N', W / 2, 13);
  }

  /** Full map overlay: both floors, you and your stashes. */
  drawFull(canvas, player, others, stashes) {
    const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
    g.clearRect(0, 0, W, H);
    const fw = this.floors[1].width, fh = this.floors[1].height;
    const s = Math.min((W / 2 - 30) / fw, (H - 60) / fh);
    [1, 2].forEach((f, i) => {
      const ox = 15 + i * (W / 2), oy = 40;
      g.fillStyle = f === player.floor ? '#9b1b30' : '#1c2b4f'; g.font = 'bold 18px Georgia'; g.textAlign = 'left';
      g.fillText(`FLOOR ${f}${f === player.floor ? '  · you are here' : ''}`, ox, 26);
      g.drawImage(this.floors[f], ox, oy, fw * s, fh * s);
      const P = (x, z) => { const [a, b] = this.toPx(x, z); return [ox + a * s, oy + b * s]; };
      for (const st of stashes) if (st.floor === f) { const [a, b] = P(st.x, st.z); g.fillStyle = '#ffd23f'; g.strokeStyle = '#000'; g.beginPath(); g.arc(a, b, 5, 0, 7); g.fill(); g.stroke(); }
      for (const o of others) if (o.floor === f) { const [a, b] = P(o.x, o.z); g.fillStyle = '#4da3ff'; g.beginPath(); g.arc(a, b, 5, 0, 7); g.fill(); }
      if (player.floor === f) {
        const [a, b] = P(player.pos.x, player.pos.z);
        g.save(); g.translate(a, b); g.rotate(-player.yaw); g.fillStyle = '#e8384f'; g.strokeStyle = '#fff'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(0, -12); g.lineTo(8, 9); g.lineTo(0, 4); g.lineTo(-8, 9); g.closePath(); g.fill(); g.stroke(); g.restore();
      }
    });
  }
}
