/**
 * CarrierHud - the island sim's own HUD (flight_sim/client/Hud.js: speed / altitude / heading tapes, horizon, engine and gear gauges,
 * radar, G meter, warnings, gun pipper) with the two parts that are about the island replaced: the minimap (open sea, two carriers)
 * and the map badge (the carrier shield status).
 */
import { Hud } from '../../flight_sim/client/Hud.js?v=18';

const WORLD = 16000;                                  // the minimap shows +-8 km around the middle of the battle
export class CarrierHud extends Hud {
  constructor(canvas) { super(canvas, { SIZE: WORLD }, { at: () => -60 }); }

  mapBadge(s, x, y, sc) {
    this.text(`CARRIER WAR  ·  ${s.teamName}`, x, y, { size: 11 * sc, color: s.teamColor, bold: true });
    const sh = s.shield;
    if (sh) this.text(`${sh.name.toUpperCase()} SHIELD  ·  WEAPONS SAFE  ·  ONLY BOMBS GET THROUGH`, x, y + 16 * sc, { size: 11 * sc, color: '#7fd0ff', bold: true });
    if (s.aa) this.text('ENEMY AA FIRE  ·  GET OUT OF THE SHIELD', x, y + 32 * sc, { size: 12 * sc, color: '#ff4a3a', bold: true });
  }

  minimap(s, x, y, size) {
    const g = this.g, half = WORLD / 2;
    g.save(); g.shadowBlur = 0;
    g.globalAlpha = 0.85; g.drawImage(this.mapImg, x, y, size, size); g.globalAlpha = 1;
    g.strokeStyle = 'rgba(255,255,255,.5)'; g.strokeRect(x, y, size, size);
    const P = (wx, wz) => [x + (wx + half) / WORLD * size, y + (wz + half) / WORLD * size];
    for (const c of s.carriers) {
      const [cx, cz] = P(c.x, c.z);
      g.fillStyle = c.color; g.save(); g.translate(cx, cz); g.rotate(-(c.yaw || 0)); g.fillRect(-3, -6, 6, 12); g.restore();      // the carrier's heading
      g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 1; g.beginPath(); g.arc(cx, cz, 420 / WORLD * size, 0, 7); g.stroke();
      if (size > 130) { g.font = '9px Arial'; g.textAlign = 'center'; g.fillStyle = 'rgba(255,255,255,.8)'; g.fillText(c.short, cx, cz - 9); }
    }
    for (const e of s.escorts || []) {                                       // the destroyer escort: a thin hull mark, no shield
      const [ex, ez] = P(e.x, e.z);
      g.fillStyle = e.color; g.save(); g.translate(ex, ez); g.rotate(-(e.yaw || 0)); g.fillRect(-1.5, -4, 3, 8); g.restore();
      if (size > 130) { g.font = '8px Arial'; g.textAlign = 'center'; g.fillStyle = 'rgba(255,255,255,.7)'; g.fillText(e.short, ex, ez - 6); }
    }
    for (const o of s.others || []) { const [ox, oz] = P(o.x, o.z); g.fillStyle = o.color; g.beginPath(); g.arc(ox, oz, 3, 0, 7); g.fill(); }
    const [px, pz] = P(s.pos[0], s.pos[2]);
    g.translate(px, pz); g.rotate(s.heading); g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 5); g.lineTo(0, 2); g.lineTo(-5, 5); g.closePath(); g.fill();
    g.restore();
  }
}
