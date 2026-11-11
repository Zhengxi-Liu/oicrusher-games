/**
 * CarrierCockpit - what the pilot sees from the seat of a carrier aircraft (cockpit camera): a real instrument panel with a dozen round
 * dials (drawn on a canvas), the padded anti-glare coaming, a reflector gunsight, the armoured windscreen frame and canopy rails,
 * the throttle quadrant on the left, switch and trim panel on the right, the control stick, the seat with its armour plate and harness.
 * Same frame as the aircraft: nose -z, up +y; `eye` is the pilot's eye (from the physics type). USN cockpits are zinc-chromate green with a
 * black panel; IJN ones are the grey-green / blue-grey of Japanese naval aircraft with a dark grey-green panel.
 */
import * as THREE from 'three';

function dial(g, cx, cy, r, { label, max, ticks = 10, needle = 0.3, red = null, arc = [0.75, 2.25], units = '' }) {
  const bez = g.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.2, cx, cy, r * 1.12);
  bez.addColorStop(0, '#8d9298'); bez.addColorStop(1, '#2c2f33');
  g.fillStyle = bez; g.beginPath(); g.arc(cx, cy, r * 1.1, 0, 7); g.fill();
  g.fillStyle = '#0b0c0d'; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill();
  const a0 = arc[0] * Math.PI, a1 = arc[1] * Math.PI;
  if (red) { g.strokeStyle = '#c0281e'; g.lineWidth = r * 0.07; g.beginPath(); g.arc(cx, cy, r * 0.9, a0 + (a1 - a0) * red[0], a0 + (a1 - a0) * red[1]); g.stroke(); }
  g.strokeStyle = '#e9e6d8'; g.fillStyle = '#e9e6d8'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${Math.round(r * 0.26)}px Arial`;
  for (let i = 0; i <= ticks; i++) {
    const a = a0 + (a1 - a0) * i / ticks, big = i % 2 === 0;
    g.lineWidth = big ? r * 0.05 : r * 0.03;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * r * 0.86, cy + Math.sin(a) * r * 0.86); g.lineTo(cx + Math.cos(a) * r * (big ? 0.68 : 0.76), cy + Math.sin(a) * r * (big ? 0.68 : 0.76)); g.stroke();
    if (big && max) g.fillText(String(Math.round(max * i / ticks)), cx + Math.cos(a) * r * 0.5, cy + Math.sin(a) * r * 0.5);
  }
  g.font = `${Math.round(r * 0.2)}px Arial`; g.fillText(label, cx, cy + r * 0.28); if (units) g.fillText(units, cx, cy + r * 0.52);
  const an = a0 + (a1 - a0) * needle; g.strokeStyle = '#f4f1e6'; g.lineWidth = r * 0.07; g.lineCap = 'round';
  g.beginPath(); g.moveTo(cx - Math.cos(an) * r * 0.15, cy - Math.sin(an) * r * 0.15); g.lineTo(cx + Math.cos(an) * r * 0.8, cy + Math.sin(an) * r * 0.8); g.stroke();
  g.fillStyle = '#16181a'; g.beginPath(); g.arc(cx, cy, r * 0.1, 0, 7); g.fill();
}
function horizon(g, cx, cy, r) {                                   // the artificial horizon: sky over earth with a little aeroplane
  g.fillStyle = '#6a7580'; g.beginPath(); g.arc(cx, cy, r * 1.1, 0, 7); g.fill();
  g.save(); g.beginPath(); g.arc(cx, cy, r, 0, 7); g.clip();
  g.fillStyle = '#3c6fa8'; g.fillRect(cx - r, cy - r, r * 2, r); g.fillStyle = '#5b3d22'; g.fillRect(cx - r, cy, r * 2, r);
  g.strokeStyle = '#fff'; g.lineWidth = r * 0.04; g.beginPath(); g.moveTo(cx - r, cy); g.lineTo(cx + r, cy);
  for (const k of [-0.5, -0.25, 0.25, 0.5]) { g.moveTo(cx - r * (Math.abs(k) > 0.3 ? 0.3 : 0.18), cy + k * r); g.lineTo(cx + r * (Math.abs(k) > 0.3 ? 0.3 : 0.18), cy + k * r); } g.stroke();
  g.restore();
  g.strokeStyle = '#f2b21c'; g.lineWidth = r * 0.09; g.beginPath(); g.moveTo(cx - r * 0.6, cy); g.lineTo(cx - r * 0.2, cy); g.lineTo(cx, cy + r * 0.15); g.lineTo(cx + r * 0.2, cy); g.lineTo(cx + r * 0.6, cy); g.stroke();
}
function panelTexture(team, style) {
  const W = 1024, H = 512, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = style === 'civil' ? '#2b2d30' : style === 'jet' ? '#101214' : team ? '#252b27' : '#17191a'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.03})`; g.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 9, 1); }   // crinkle finish
  const R = 82, jet = style === 'jet', civil = style === 'civil';
  dial(g, 205, 135, R, { label: 'AIRSPEED', max: civil ? 200 : 500, ticks: 10, needle: 0.12, units: 'KNOTS', red: [0.92, 1] });
  horizon(g, 512, 135, R * 1.12);
  dial(g, 819, 135, R, { label: 'ALT', max: 10, ticks: 10, needle: 0.0, units: '1000 FT', arc: [-0.5, 1.5] });
  dial(g, 108, 335, 62, { label: 'COMPASS', ticks: 12, needle: 0.0, arc: [-0.5, 1.5] });
  dial(g, 268, 335, 62, jet ? { label: 'N1 RPM', max: 100, ticks: 10, needle: 0.62, units: '%', red: [0.97, 1] } : { label: 'RPM', max: 30, ticks: 10, needle: 0.28, units: 'x100', red: [0.9, 1] });
  dial(g, 428, 335, 62, jet ? { label: 'EGT', max: 900, ticks: 9, needle: 0.45, units: '°C', red: [0.85, 1] } : civil ? { label: 'MANIFOLD', max: 30, ticks: 6, needle: 0.35, units: 'IN HG' } : { label: 'MANIFOLD', max: 60, ticks: 12, needle: 0.3, units: 'IN HG' });
  dial(g, 588, 335, 62, { label: 'CLIMB', max: 4, ticks: 8, needle: 0.5, arc: [0.6, 2.4], units: '1000' });
  dial(g, 748, 335, 62, { label: 'OIL TEMP', ticks: 6, needle: 0.35, red: [0.8, 1] });
  dial(g, 908, 335, 62, { label: 'FUEL', max: 4, ticks: 4, needle: 0.7, red: [0, 0.1], units: '/4' });
  dial(g, 108, 470, 34, { label: 'CLOCK', ticks: 12, needle: 0.6 }); dial(g, 428, 470, 34, { label: 'OIL PR', ticks: 6, needle: 0.55 }); dial(g, 588, 470, 34, { label: jet ? 'FUEL FLOW' : 'CYL T', ticks: 6, needle: 0.4 });
  for (const [x, col] of [[690, '#31c24a'], [730, '#e0a818'], [770, '#c0281e']]) { g.fillStyle = '#0b0c0d'; g.beginPath(); g.arc(x, 470, 15, 0, 7); g.fill(); g.fillStyle = col; g.globalAlpha = 0.55; g.beginPath(); g.arc(x, 470, 10, 0, 7); g.fill(); g.globalAlpha = 1; }   // gear / flap / warning lamps
  g.fillStyle = '#d8d4c4'; g.font = 'bold 20px Arial'; g.textAlign = 'center'; g.fillText(team ? 'GEAR   FLAP   WARN' : 'GEAR   FLAP   WARN', 730, 500);
  for (const [x, y] of [[20, 20], [1004, 20], [20, 492], [1004, 492]]) { g.fillStyle = '#7d8288'; g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); }              // panel screws
  const t = new THREE.CanvasTexture(c); t.anisotropy = 8; return t;
}

export function buildCockpit(eye, team, style = 'ww2') {
  const grp = new THREE.Group(), [ex, ey, ez] = eye; grp.position.x = ex;                       // seats off the centreline (the B-29's left seat)
  const interior = new THREE.MeshStandardMaterial({ color: style === 'civil' ? 0xa9a597 : style === 'jet' ? 0x3b3f43 : team ? 0x7f9488 : 0x98a45c, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide });   // zinc chromate / grey-green
  const black = new THREE.MeshStandardMaterial({ color: 0x151617, roughness: 0.9, metalness: 0.1 }), pad = new THREE.MeshStandardMaterial({ color: 0x1d1f1c, roughness: 1 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.35, metalness: 0.8 }), leather = new THREE.MeshStandardMaterial({ color: 0x5b4330, roughness: 0.9 });
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = grp) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); parent.add(m); return m; };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d), cyl = (r0, r1, h, n = 10) => new THREE.CylinderGeometry(r0, r1, h, n);

  // instrument panel: slightly dished toward the pilot, with a thick bezel
  const pm = new THREE.MeshStandardMaterial({ map: panelTexture(team, style), roughness: 0.55, metalness: 0.1, emissive: 0xffffff, emissiveMap: null, emissiveIntensity: 0 });
  pm.emissive.set(0x222222); pm.emissiveMap = pm.map;
  add(box(1.0, 0.5, 0.05), black, 0, ey - 0.4, ez - 0.74, -0.42);
  { const n = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(1, 0, 0), -0.42).multiplyScalar(0.028); add(new THREE.PlaneGeometry(0.96, 0.48), pm, n.x, ey - 0.4 + n.y, ez - 0.74 + n.z, -0.42); }
  add(box(0.9, 0.04, 0.05), black, 0, ey - 0.66, ez - 0.62, -0.42);                      // lower rail
  // coaming: a padded anti-glare hood over the panel, with a gap for the gunsight
  add(box(1.06, 0.04, 0.14), pad, 0, ey - 0.15, ez - 0.86, 0.1);
  for (const s of [-1, 1]) { add(box(0.05, 0.4, 0.4), interior, s * 0.55, ey - 0.42, ez - 0.66, 0, 0, s * -0.1); }       // the panel's side brackets and the fuselage sides at the front
  // reflector gunsight: base, hood and a faint glass combiner at 45 degrees
  if (style !== 'civil') {
    add(box(0.12, 0.05, 0.14), black, 0, ey - 0.17, ez - 0.76);
    add(cyl(0.04, 0.04, 0.1, 14), black, 0, ey - 0.11, ez - 0.82, Math.PI / 2);
    add(new THREE.PlaneGeometry(0.1, 0.09), new THREE.MeshBasicMaterial({ color: 0x9fe6b8, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }), 0, ey - 0.06, ez - 0.79, -0.75);
  }
  // armoured windscreen frame: a centre post and angled side posts, with a bow across the top; canopy rails along both sides
  const frame = team ? 0x6e7d73 : 0x242622, fm = new THREE.MeshStandardMaterial({ color: frame, roughness: 0.6, metalness: 0.5 });
  add(box(0.025, 0.6, 0.025), fm, 0, ey + 0.2, ez - 1.0, -0.62);
  for (const s of [-1, 1]) {
    add(box(0.028, 0.66, 0.028), fm, s * 0.5, ey + 0.16, ez - 0.95, -0.62, 0, s * -0.2);
    add(box(0.04, 0.04, 2.1), fm, s * 0.58, ey - 0.26, ez + 0.35, 0.0, 0, 0);                                             // canopy sill rail
    add(box(0.03, 0.03, 2.0), fm, s * 0.34, ey + 0.52, ez + 0.2, 0, 0, 0);                                             // upper rail
    add(box(0.03, 0.78, 0.03), fm, s * 0.46, ey + 0.13, ez + 0.55);
    add(box(0.03, 0.78, 0.03), fm, s * 0.46, ey + 0.13, ez - 0.2);
  }
  add(box(0.8, 0.03, 0.03), fm, 0, ey + 0.5, ez - 0.52, -0.5);
  // side walls of the cockpit: zinc-chromate (or grey-green) panels, a floor, the rear bulkhead
  for (const s of [-1, 1]) add(box(0.04, 0.78, 1.8), interior, s * 0.64, ey - 0.45, ez + 0.3);
  add(box(1.28, 0.04, 1.6), interior, 0, ey - 0.92, ez + 0.1);
  add(box(1.2, 0.8, 0.04), interior, 0, ey - 0.4, ez + 1.15);
  // left console: throttle quadrant - throttle (black knob), propeller pitch (blue), mixture (red), a trim-wheel row below
  add(box(0.16, 0.2, 0.62), interior, -0.52, ey - 0.72, ez - 0.05, 0, 0, 0.0);
  add(box(0.12, 0.02, 0.5), black, -0.52, ey - 0.61, ez - 0.05);
  const lever = (x, col, len, knob, z = ez - 0.05, tilt = 0.4) => { const grpL = new THREE.Group(); grpL.position.set(x, ey - 0.6, z); grpL.rotation.x = tilt; grp.add(grpL);
    add(cyl(0.008, 0.008, len, 6), steel, 0, len / 2, 0, 0, 0, 0, grpL); add(new THREE.SphereGeometry(knob, 10, 8), new THREE.MeshStandardMaterial({ color: col, roughness: 0.5 }), 0, len, 0, 0, 0, 0, grpL); };
  lever(-0.56, 0x15161a, 0.2, 0.035, ez - 0.16, 0.35); lever(-0.52, 0x2a5fb0, 0.19, 0.03, ez - 0.05, 0.1); lever(-0.48, 0xb02a22, 0.18, 0.03, ez + 0.06, -0.15);
  add(cyl(0.06, 0.06, 0.02, 14), black, -0.56, ey - 0.67, ez + 0.28, 0, 0, Math.PI / 2);                                // elevator trim wheel
  // right console: switch panel with toggles, a circuit-breaker strip, the flap and gear handles
  add(box(0.16, 0.2, 0.7), interior, 0.52, ey - 0.72, ez + 0.0);
  add(box(0.12, 0.02, 0.6), black, 0.52, ey - 0.61, ez + 0.0);
  for (let i = 0; i < 6; i++) add(cyl(0.007, 0.007, 0.06, 6), steel, 0.5 + (i % 2) * 0.04, ey - 0.6, ez - 0.22 + i * 0.09, 0, 0, 0.3 * (i % 3 - 1));
  lever(0.56, 0xd8d4c4, 0.17, 0.028, ez + 0.28, 0.2);                                                                   // flap handle
  lever(0.49, 0x1d6a2c, 0.19, 0.03, ez + 0.3, -0.2);                                                                    // gear handle (green wheel-shaped knob in real life)
  // control stick: a tube from the floor with a pistol grip, trigger and a rubber boot
  if (style === 'civil') {                                                                    // a control column with a yoke wheel
    add(cyl(0.025, 0.03, 0.5, 10), steel, 0, ey - 0.62, ez - 0.5, 0.35);
    add(new THREE.TorusGeometry(0.12, 0.014, 8, 20), black, 0, ey - 0.4, ez - 0.4, 0.3);
    add(box(0.28, 0.025, 0.025), black, 0, ey - 0.4, ez - 0.4, 0.3);
    add(cyl(0.035, 0.035, 0.03, 10), black, 0, ey - 0.4, ez - 0.4, Math.PI / 2 + 0.3);
  } else {
    add(cyl(0.02, 0.026, 0.62, 10), steel, 0, ey - 0.64, ez - 0.45, 0.12);
    add(cyl(0.04, 0.05, 0.1, 10), black, 0, ey - 0.9, ez - 0.52, 0.12);
    add(box(0.035, 0.12, 0.05), black, 0, ey - 0.31, ez - 0.43, 0.12);
    add(box(0.012, 0.03, 0.02), steel, 0, ey - 0.28, ez - 0.47, 0.12);
  }
  // the seat: pan, back, armour plate with a headrest, shoulder harness and lap belt
  add(box(0.5, 0.06, 0.5), leather, 0, ey - 0.75, ez + 0.3, 0.05);
  add(box(0.5, 0.62, 0.07), leather, 0, ey - 0.4, ez + 0.58, -0.12);
  add(box(0.46, 0.5, 0.025), new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.6, metalness: 0.6 }), 0, ey - 0.02, ez + 0.66, -0.12);
  add(box(0.3, 0.16, 0.07), pad, 0, ey + 0.18, ez + 0.62, -0.12);
  const strap = new THREE.MeshStandardMaterial({ color: team ? 0x6a6f4a : 0x7c7a5a, roughness: 0.95 });
  for (const s of [-1, 1]) { add(box(0.05, 0.62, 0.012), strap, s * 0.14, ey - 0.28, ez + 0.52, -0.4, 0, s * 0.12); add(box(0.2, 0.04, 0.01), strap, s * 0.17, ey - 0.62, ez + 0.2, 0.1, s * -0.3, 0); }
  add(box(0.05, 0.03, 0.04), steel, 0, ey - 0.64, ez + 0.2);
  // rudder pedals down in the footwell
  for (const s of [-1, 1]) add(box(0.14, 0.2, 0.03), steel, s * 0.17, ey - 0.88, ez - 0.55, -0.6);
  // a magnetic compass on the coaming's edge and a small clock-style mirror stub (no mirror glass: it would hide the view)
  add(cyl(0.05, 0.05, 0.07, 14), black, 0.37, ey - 0.12, ez - 0.7);
  grp.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return grp;
}
