/**
 * Carrier War - client. A separate universe from the island sim: an open sea, two carriers (USN west, IJN east), four WWII carrier
 * aircraft (see CarrierPlanes.js). Only bombs can sink a carrier; guns and missiles are blocked inside a carrier's shield.
 *   - FlightPhysics (shared with the island sim) flies the aircraft; the carrier deck is a landable surface (CarrierWorld.deckAt)
 *   - catapult (full throttle on the deck) and arrestor wires (touch down in the wire zone) are small forces added to the physics
 *   - the server (carrier_war/server/CarrierServer.js) is authoritative for hit points, bombs, carrier damage and rounds
 */
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { PlaneController } from '../../flight_sim/client/PlaneController.js?v=3';
import { AudioSystem } from '../../flight_sim/client/AudioSystem.js?v=7';
import { animatePlane } from '../../flight_sim/client/PlaneModel.js?v=13';
import { createOcean } from '../../flight_sim/client/Ocean.js?v=1';
import { Effects } from '../../flight_sim/client/Effects.js?v=2';
import { Guns } from '../../flight_sim/client/Guns.js?v=1';
import { BombFleet } from '../../flight_sim/client/Bombing.js?v=1';
import { CarrierHud } from './CarrierHud.js?v=1';
import { buildCarrierPlane } from './CarrierModels.js?v=1';

const CW = window.CWWorld, CP = window.CWPlanes, FP = window.FSPhysics, BM = window.FSBombs;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KT = 1.94384, FT = 3.28084, STEP = 1 / 60;
const TEAM_COL = ['#4f8fe0', '#e05a52'];
const PLAY_R = 14000;                                    // leave this far from the middle and you have left the battle

// ---------- renderer, scene, sky, sea
let renderer;
const canvas = $('view');
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true }); }
catch (e) { $('webglError').style.display = 'block'; throw e; }
renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.55;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 80000);
const SUN = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 38), THREE.MathUtils.degToRad(210));
const sky = new Sky(); sky.scale.setScalar(450000);
Object.assign(sky.material.uniforms.turbidity, { value: 4 }); sky.material.uniforms.rayleigh.value = 1.3;
sky.material.uniforms.mieCoefficient.value = 0.004; sky.material.uniforms.mieDirectionalG.value = 0.8; sky.material.uniforms.sunPosition.value.copy(SUN);
scene.add(sky);
{
  const pm = new THREE.PMREMGenerator(renderer), envScene = new THREE.Scene(), s2 = new Sky();
  s2.scale.setScalar(1000); s2.material.uniforms.sunPosition.value.copy(SUN);
  for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) s2.material.uniforms[k].value = sky.material.uniforms[k].value;
  envScene.add(s2); scene.environment = pm.fromScene(envScene).texture; pm.dispose();
}
scene.fog = new THREE.FogExp2(0xa9c4dc, 0.00005);
scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x2a4a66, 0.9));
const sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 800 }); sun.shadow.bias = -0.0004;
scene.add(sun, sun.target);
function resize() {
  const r = canvas.getBoundingClientRect();
  renderer.setSize(Math.max(320, r.width | 0), Math.max(180, r.height | 0), false);
  camera.aspect = r.width / r.height; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

const ocean = createOcean({ sunDir: SUN });
scene.add(ocean.mesh);

// ---------- the carriers
function deckTexture(team) {
  const w = 256, h = 1440, c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), D = CW.DECK, X = z => (D.len / 2 + z) / D.len * h * 0 + (z + D.len / 2) / D.len * h, Y = x => (x + D.hw) / (2 * D.hw) * w, S = w / (2 * D.hw);
  const grd = g.createLinearGradient(0, 0, w, 0); grd.addColorStop(0, '#42474d'); grd.addColorStop(0.5, '#4d535a'); grd.addColorStop(1, '#42474d');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${i % 3 ? '0,0,0' : '255,255,255'},${0.02 + Math.random() * 0.03})`; g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 14, 1 + Math.random() * 3); }
  // elevators (the lift outlines), catapult tracks, edge lines, centre line, landing-area box, wires, numerals
  g.lineWidth = 3; g.strokeStyle = '#d9b43a';
  for (const [x0, x1, z0, z1] of [[-22, -6, -70, -42], [6, 22, 10, 38]]) { g.strokeRect(Y(x0), X(z0), (x1 - x0) * S, (z1 - z0) * (h / D.len)); g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(Y(x0), X(z0), (x1 - x0) * S, (z1 - z0) * (h / D.len)); }
  g.strokeStyle = '#2c3034'; g.lineWidth = 5;
  for (const x of [-4, 4]) { g.beginPath(); g.moveTo(Y(x), X(-122)); g.lineTo(Y(x), X(70)); g.stroke(); }
  g.strokeStyle = '#2c3034'; g.lineWidth = 2; for (const x of [-4, 4]) for (let z = -120; z < 70; z += 6) { g.beginPath(); g.moveTo(Y(x) - 3, X(z)); g.lineTo(Y(x) + 3, X(z)); g.stroke(); }
  g.strokeStyle = '#e9e9e1'; g.lineWidth = 4; g.beginPath(); g.moveTo(Y(-D.hw + 1.5), 0); g.lineTo(Y(-D.hw + 1.5), h); g.moveTo(Y(D.hw - 1.5), 0); g.lineTo(Y(D.hw - 1.5), h); g.stroke();
  g.setLineDash([34, 22]); g.lineWidth = 3; g.beginPath(); g.moveTo(Y(0), 0); g.lineTo(Y(0), h); g.stroke(); g.setLineDash([]);
  g.strokeRect(Y(-11), X(15), 22 * S, 100 * (h / D.len));                                    // the landing area
  g.strokeStyle = '#1c1f22'; g.lineWidth = 4;                                                // arrestor wires across the landing area, with their rollers
  for (const z of [25, 45, 65, 85]) { const y = X(D.len / 2 - z); g.beginPath(); g.moveTo(Y(-D.hw + 3), y); g.lineTo(Y(D.hw - 3), y); g.stroke(); g.fillStyle = '#7d848b'; g.fillRect(Y(-D.hw + 1), y - 4, 10, 8); g.fillRect(Y(D.hw - 1) - 10, y - 4, 10, 8); }
  for (let k = 0; k < 40; k++) { g.fillStyle = 'rgba(10,10,10,.22)'; g.fillRect(Y((Math.random() - 0.5) * 16), X(25 + Math.random() * 70), 3, 5 + Math.random() * 20); }   // tyre marks
  g.fillStyle = '#e9e9e1'; g.font = 'bold 130px Arial'; g.textAlign = 'center';
  g.save(); g.translate(Y(0), X(-62)); g.fillText(team ? '赤' : '27', 0, 0); g.restore();
  g.fillStyle = team ? '#c4161c' : '#1b3b84'; g.beginPath(); g.arc(Y(0), X(-108), 22, 0, 7); g.fill();
  g.fillStyle = '#e9e9e1'; g.beginPath(); g.moveTo(Y(-12), X(-96)); g.lineTo(Y(12), X(-96)); g.lineTo(Y(0), X(-80)); g.fill();
  const t = new THREE.CanvasTexture(g.canvas); t.anisotropy = 8; return t;
}
function sideTexture() {                                  // hull-side gallery: portholes and gun-sponson panels
  const c = document.createElement('canvas'); c.width = 128; c.height = 32; const g = c.getContext('2d');
  g.fillStyle = '#69737c'; g.fillRect(0, 0, 128, 32); g.fillStyle = '#10161c';
  for (let x = 6; x < 128; x += 16) g.fillRect(x, 10, 9, 8);
  g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(0, 0, 128, 3);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(14, 1); return t;
}
function flagTexture(team) {
  const c = document.createElement('canvas'); c.width = 96; c.height = 56; const g = c.getContext('2d');
  if (team === 0) { for (let i = 0; i < 7; i++) { g.fillStyle = i % 2 ? '#f2f2f2' : '#b22234'; g.fillRect(0, i * 8, 96, 8); } g.fillStyle = '#1b3b84'; g.fillRect(0, 0, 40, 32); g.fillStyle = '#fff'; for (let y = 4; y < 30; y += 7) for (let x = 5; x < 38; x += 8) g.fillRect(x, y, 2, 2); }
  else { g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, 96, 56); g.fillStyle = '#c4161c'; g.beginPath(); g.arc(40, 28, 17, 0, 7); g.fill(); for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; g.beginPath(); g.moveTo(40, 28); g.arc(40, 28, 56, a, a + 0.1); g.fill(); } }
  return new THREE.CanvasTexture(c);
}
function foamTexture() {                                  // the bow wave, hull foam and a long straight wake astern
  const c = document.createElement('canvas'); c.width = 128; c.height = 1024; const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 1024);
  for (let i = 0; i < 5000; i++) {
    const v = Math.random(), y = v * 1024, edge = y < 300 ? 0.5 + y / 300 * 0.5 : 1;                 // top = bow
    const wake = y > 330 ? Math.max(0, 1 - (y - 330) / 694) : 1, spread = y > 330 ? 0.18 + (y - 330) / 694 * 0.8 : 0.28 + Math.min(1, y / 300) * 0.1;
    const x = 64 + (Math.random() + Math.random() - 1) * 64 * spread * (y > 330 ? 1 : 1.2);
    g.fillStyle = `rgba(255,255,255,${(0.1 + Math.random() * 0.5) * wake * edge})`; g.fillRect(x, y, 1 + Math.random() * 5, 2 + Math.random() * 9);
  }
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
}
function buildCarrier(info) {
  const D = CW.DECK, g = new THREE.Group(), half = D.len / 2;
  const mat = (color, rough = 0.62, metal = 0.25, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
  const hullGrey = mat(0x5b6670, 0.6, 0.3), rust = mat(0x5e2a24, 0.85, 0.2), towerM = mat(0x9099a2, 0.7, 0.2), dark = mat(0x23272c, 0.7, 0.3), steel = mat(0x7d858d, 0.5, 0.6);
  const glassM = mat(0x0e2238, 0.2, 0.6, { emissive: 0x2a5078, emissiveIntensity: 0.55 });
  const outline = (hw, k = 1) => {                                                 // plan view; shape y = -z, so +y is the bow
    const s = new THREE.Shape(), L = half * k;
    s.moveTo(-hw, -L); s.lineTo(hw, -L); s.lineTo(hw + 0.5, L * 0.3); s.lineTo(hw - 3, L * 0.8); s.lineTo(hw * 0.35, L * 0.97); s.lineTo(0, L); s.lineTo(-hw * 0.35, L * 0.97); s.lineTo(-hw + 3, L * 0.8); s.lineTo(-hw - 0.5, L * 0.3); s.closePath(); return s;
  };
  const slab = (shape, y0, y1, m) => { const geo = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, curveSegments: 4 }); geo.rotateX(-Math.PI / 2); geo.translate(0, y0, 0); const mesh = new THREE.Mesh(geo, m); mesh.castShadow = mesh.receiveShadow = true; g.add(mesh); return mesh; };
  slab(outline(D.hullHw, 0.99), -9, 0.4, rust);                                    // below the waterline: red anti-fouling paint
  slab(outline(D.hullHw + 0.4, 0.99), 0.4, 13, hullGrey);                           // the hull
  slab(outline(D.hullHw + 3.6, 0.97), 13, D.y - 1.2, hullGrey);                      // the flared upper hull under the deck edge
  // the flight deck: tapered at the bow, with the deck texture mapped on by position
  const dshape = new THREE.Shape(), hw = D.hw;
  dshape.moveTo(-hw, -half); dshape.lineTo(hw, -half); dshape.lineTo(hw, half - 34); dshape.lineTo(hw - 10, half - 8); dshape.lineTo(hw - 16, half); dshape.lineTo(-hw + 16, half); dshape.lineTo(-hw + 10, half - 8); dshape.lineTo(-hw, half - 34); dshape.closePath();
  const dgeo = new THREE.ExtrudeGeometry(dshape, { depth: 1.2, bevelEnabled: false }); dgeo.rotateX(-Math.PI / 2); dgeo.translate(0, D.y - 1.2, 0);
  { const p = dgeo.attributes.position, uv = dgeo.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + hw) / (2 * hw), (half - p.getZ(i)) / D.len); }
  const deck = new THREE.Mesh(dgeo, [new THREE.MeshStandardMaterial({ map: deckTexture(info.team), roughness: 0.88, metalness: 0.05 }), hullGrey]); deck.receiveShadow = true; deck.castShadow = true; g.add(deck);
  // side galleries (catwalks) with portholes under the deck lip, and the team colour band on the hull
  const gal = new THREE.MeshStandardMaterial({ map: sideTexture(), roughness: 0.7, metalness: 0.2 });
  for (const s of [-1, 1]) { const m = new THREE.Mesh(new THREE.BoxGeometry(3.4, 4.2, 200), gal); m.position.set(s * 21.4, D.y - 3.4, 12); m.castShadow = true; g.add(m); }
  const band = slab(outline(D.hullHw + 0.55, 0.99), 8, 10.2, mat(info.color, 0.5, 0.2));
  // the island: stacked blocks, bridge windows, a raked funnel, a tripod mast with a rotating radar, yardarm and a flag
  const isl = new THREE.Group(); isl.position.set(22.5, D.y, -18); g.add(isl);
  const box = (w, h, d, x, y, z, m = towerM, parent = isl) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = b.receiveShadow = true; parent.add(b); return b; };
  box(17, 8, 31, 0, 4, 0); box(14, 4, 22, -1, 10, 2); box(10.5, 3.6, 14, -1.5, 13.8, 0);
  for (const z of [-7.05, 7.05]) box(10, 1.3, 0.2, -1.5, 13.9, z * (z < 0 ? 1 : 1) * 1.0, glassM);                  // bridge windows (fore and aft faces)
  box(0.2, 1.3, 13, 3.75, 13.9, 0, glassM); box(0.2, 1.3, 13, -6.75, 13.9, 0, glassM);
  box(3.6, 2.4, 5, 1.0, 16.6, 1, towerM);                                                                        // the flag bridge / radar room
  const funnel = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 3.5, 9, 18), dark); funnel.position.set(3.2, 8.5, 13.5); funnel.rotation.x = -0.14; funnel.castShadow = true; isl.add(funnel);
  const fcap = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 2.9, 0.5, 18), mat(0x0a0a0a)); fcap.position.set(3.2 + 0.35, 13.1, 13.5 + 0.65); fcap.rotation.x = -0.14; isl.add(fcap);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 12, 8), steel); mast.position.set(0.5, 24.5, 1); isl.add(mast);
  for (const [dx, dz] of [[-1.6, -1.2], [1.6, -1.2], [0, 2]]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 9.5, 6), steel); leg.position.set(0.5 + dx * 0.55, 21.2, 1 + dz * 0.55); leg.rotation.set(dz * 0.07, 0, -dx * 0.07); isl.add(leg); }
  const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 9, 6), steel); yard.rotation.z = Math.PI / 2; yard.position.set(0.5, 27.4, 1); isl.add(yard);
  const dish = new THREE.Group(); dish.position.set(0.5, 31, 1); isl.add(dish);
  { const bowl = new THREE.Mesh(new THREE.SphereGeometry(2.4, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), steel); bowl.rotation.x = Math.PI / 2.4; bowl.scale.set(1.5, 0.45, 1); bowl.position.y = 0.4; dish.add(bowl);
    const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 4), dark); feed.rotation.x = Math.PI / 2; feed.position.set(0, 0.5, -0.9); dish.add(feed);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 1.2, 8), steel); base.position.y = -0.5; dish.add(base); }
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(5, 3), new THREE.MeshBasicMaterial({ map: flagTexture(info.team), side: THREE.DoubleSide })); flag.position.set(0.5, 29, 4.5); flag.rotation.y = Math.PI / 2; isl.add(flag);
  // AA mounts on sponsons (twin barrels), two deck-edge crane stubs, and the navigation lights
  const sponsons = [[-26.5, -85], [-26.5, 25], [-26.5, 95], [27.5, 60], [27.5, 100], [27.5, -95]];
  for (const [x, z] of sponsons) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(6, 1.2, 8), hullGrey); sp.position.set(x, D.y - 3.2, z); sp.castShadow = true; g.add(sp);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.4, 1.2, 10), dark); base.position.set(x, D.y - 2.2, z); g.add(base);
    for (const dx of [-0.35, 0.35]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 3.4, 6), dark); b.rotation.x = Math.PI / 2 - 0.5; b.position.set(x + dx, D.y - 1.4, z - 1.1); g.add(b); }
  }
  // water: hull foam and a straight wake behind the stern (the carrier steams north: +z is astern)
  const foam = new THREE.Mesh(new THREE.PlaneGeometry(70, 640), new THREE.MeshBasicMaterial({ map: foamTexture(), transparent: true, depthWrite: false, opacity: 0.9 }));
  foam.rotation.x = -Math.PI / 2; foam.position.set(0, 0.25, 145); foam.renderOrder = 1; g.add(foam);
  const lbl = document.createElement('canvas'); lbl.width = 512; lbl.height = 64; const lg = lbl.getContext('2d');
  lg.fillStyle = 'rgba(0,0,0,.55)'; lg.fillRect(0, 0, 512, 64); lg.fillStyle = TEAM_COL[info.team]; lg.font = 'bold 40px Arial'; lg.textAlign = 'center'; lg.fillText(info.name.toUpperCase(), 256, 46);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(lbl), depthTest: false, transparent: true, fog: false })); sp.scale.set(120, 15, 1); sp.position.set(0, D.y + 70, 0); sp.renderOrder = 5; g.add(sp);
  g.position.set(info.x, 0, info.z); scene.add(g);
  return { label: sp, group: g, info, dish, flag, sink: 0, smokeT: 0 };
}
const carriers = CW.CARRIERS.map(buildCarrier);

const hp = [CW.HP, CW.HP];
const hud = new CarrierHud($('hudc'));
// the round clock (the carriers sail as a function of it): t0 and the server's now arrive with every 'round' / 'welcome'
const clock = { t0: Date.now(), off: 0, frozen: null };
const roundT = () => clock.frozen !== null ? clock.frozen : Math.max(0, (Date.now() + clock.off - clock.t0) / 1000);
const syncClock = m => { if (m.t0) { clock.t0 = m.t0; clock.off = m.now - Date.now(); } clock.frozen = m.phase === 'over' ? Math.max(0, (m.now - m.t0) / 1000) : null; if (m.max) net.round.max = m.max; };
let maxG = 1, radarIdx = 2, hookPos = 0, rackAnim = 0, aaFlash = 0;
const RADAR_RANGES = [2500, 5000, 10000, 20000, 0];

// ---------- game objects
const fx = new Effects(scene, () => -1);
const guns = new Guns(scene, fx, { ground: () => -1, obstacle: (x, y, z) => CW.solidAt(x, y, z) });
const bombs = new BombFleet(scene, CW.bombEnv, onBombImpact);
const audio = new AudioSystem();
const ctl = new PlaneController(canvas);
const ac = new FP.Aircraft({ type: 'hellcat', ground: () => -1, surface: () => 'water', obstacle: CW.solidAt, deck: CW.deckAt });
const net = { ws: null, open: false, id: 0, team: 0, plane: 'hellcat', round: { phase: 'play', hp: [CW.HP, CW.HP], wins: [0, 0] }, roster: new Map(), others: new Map(), name: '' };
const me = { hookDown: false, plane: 'hellcat', hp: 1, hpMax: 1, bombsLeft: 0, ammo: 0, killedByServer: false, hooked: false, catMsg: false, outT: 0 };
let state = 'menu', simTime = 0, camMode = 0, camPos = new THREE.Vector3(), plane = null, wreckPos = null, deadT = 0, gunAcc = 0, gunIdx = 0, bombSeq = 0, startT = 0, msgUntil = 0, aaWarn = 0;
const gun = { mouse: false, hits: new Map(), lastSend: 0 };
const planeQ = new THREE.Quaternion();
let pickedPlane = null;

const myTeam = () => net.team;
const myName = () => (window.OIID && OIID.name) || 'Pilot';
function say(text, secs = 2.5, color = '#fff') { const m = $('msg'); m.textContent = text; m.style.color = color; m.style.opacity = 1; msgUntil = performance.now() + secs * 1000; }

function newPlaneModel(id, team, cockpit) { return buildCarrierPlane(id, { cockpit }); }
function setPlane(id) {
  me.plane = id; ac.setType(id);
  if (plane) scene.remove(plane.root);
  plane = newPlaneModel(id, CP.PLANES[id].team, true); scene.add(plane.root);
  ctl.feel = ac.spec.feel;
}

// ---------- menu
function renderMenu() {
  const T = CP.TEAMS[myTeam()];
  $('teamLine').innerHTML = net.open ? `You fly for the <b class="t${T.id}">${esc(T.name)}</b>` : 'Offline practice - you fly for the <b class="t0">US Navy</b>';
  if (!pickedPlane || !T.planes.includes(pickedPlane)) pickedPlane = T.planes[0];
  $('cards').innerHTML = T.planes.map(id => {
    const P = CP.PLANES[id], S = FP.TYPES[id], bar = n => `<i style="width:${n * 14}px"></i>`;
    return `<div class="card ${id === pickedPlane ? 'sel' : ''}" data-p="${id}"><h3>${esc(P.name)}</h3><div class="role">${P.role.toUpperCase()}${P.bombs ? ` · ${P.bombs} × ${BM.BOMBS[P.bomb].name}` : ' · GUNS ONLY'}</div>
      <p>${esc(S.blurb)}</p><div class="bars">speed${bar(S.stats.speed)} turn${bar(S.stats.agility)} armour${bar(Math.round(P.hp / 4))}</div></div>`;
  }).join('');
  $('cards').querySelectorAll('.card').forEach(el => el.onclick = () => { pickedPlane = el.dataset.p; renderMenu(); });
  const wait = net.round.phase !== 'play';
  $('go').disabled = wait;
  $('go').textContent = wait ? 'NEXT ROUND SOON…' : 'DEPLOY';
  $('netState').textContent = net.open ? `${net.roster.size} pilot${net.roster.size === 1 ? '' : 's'} in the battle · rounds won ${net.round.wins[0]} : ${net.round.wins[1]}` : 'Not connected - flying alone (the server may be restarting)';
}
function showMenu() {
  state = 'menu'; $('menu').classList.remove('hidden'); $('hud').classList.add('hidden'); ctl.active = false; renderMenu();
}
$('go').onclick = () => { audio.unlock(); deploy(); };
addEventListener('keydown', e => { if (e.code === 'Enter' && state === 'menu' && !$('go').disabled) { audio.unlock(); deploy(); } });

function deploy() {
  if (!pickedPlane || net.round.phase !== 'play') return;
  if (net.open) net.ws.send(JSON.stringify({ t: 'respawn', plane: pickedPlane }));
  else startFlight(pickedPlane);
}

function startFlight(id) {
  me.plane = id; setPlane(id);
  CW.update(roundT());
  const P = CP.PLANES[id], team = CP.PLANES[id].team, slot = (net.id || 0) % 9, sp = CW.spawnPoint(team, slot);
  me.hp = me.hpMax = P.hp; me.bombsLeft = P.bombs; me.ammo = ac.spec.gun.ammo; me.killedByServer = false; me.hooked = false; me.catMsg = false; me.outT = 0;
  ac.reset({ x: sp.x, y: 0, z: sp.z, yaw: 0, onGround: true, flaps: 1, throttle: 0 });
  ac.pos[1] = CW.DECK.y + ac.spec.restHeight; ac.vel = [0, 0, -CW.SPEED]; ac.ctl.gear = 1; ac.gearPos = 1; me.hookDown = false; hookPos = 0; maxG = 1;
  ctl.sync(ac); ctl.active = true; ctl.look.yaw = ctl.look.pitch = 0;
  bombs.clear(); guns.clear(); fx.clear(); plane.root.visible = true;
  state = 'flying'; startT = simTime; camMode = 0; wreckPos = null;
  $('menu').classList.add('hidden'); $('hud').classList.remove('hidden'); $('result').classList.add('hidden');
  camPos.set(sp.x, CW.DECK.y + 8, sp.z + 30);
  $('planeName').textContent = P.name;
  say(`${P.name} on the deck - full throttle (R) for the catapult launch${P.bombs ? ' · Z = dive brakes · N = bomb' : ''}`, 6, '#ffd23a');
  if (document.activeElement) document.activeElement.blur();
}

// ---------- network
function wsUrl() { const q = new URLSearchParams(location.search).get('ws'); return q || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/game/carrier-ws`; }
function connect() {
  let ws; try { ws = new WebSocket(wsUrl()); } catch (e) { return; }
  net.ws = ws;
  ws.onopen = () => { net.open = true; ws.send(JSON.stringify({ t: 'hello', name: myName(), token: window.OIID && OIID.token, plane: pickedPlane || 'hellcat' })); };
  ws.onclose = () => {
    net.open = false; net.ws = null; net.others.forEach(o => scene.remove(o.model.root)); net.others.clear(); net.roster.clear();
    if (state === 'menu') renderMenu();
    setTimeout(connect, 4000);
  };
  ws.onerror = () => {};
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (err) { return; } onNet(m); };
}
function onNet(m) {
  switch (m.t) {
    case 'welcome': net.id = m.id; net.team = m.team; pickedPlane = m.plane; net.round = m.round; syncClock(m.round); setHp(m.round.hp); if (state === 'menu') renderMenu(); break;
    case 'roster': {
      net.roster = new Map(m.list.map(p => [p.id, p])); net.round.wins = m.wins;
      for (const [id, o] of net.others) if (!net.roster.has(id)) { scene.remove(o.model.root); net.others.delete(id); }
      if (state === 'menu') renderMenu();
      $('score').textContent = `${m.wins[0]} : ${m.wins[1]}`; break;
    }
    case 'spawned': if (state === 'menu' || state === 'dead') startFlight(m.plane); break;
    case 'snap': onSnap(m); break;
    case 'dmg': me.hp = m.hp; audio.hit(); flashDamage(); say(`Hit by ${m.by}!`, 1.5, '#ff6a4a'); break;
    case 'aa': aaWarn = 1.5; audio.mslWarn(); break;
    case 'down': if (state === 'flying') { me.killedByServer = true; killSelf(m.why === 'bomb blast' ? `caught in ${m.by || 'a'} bomb blast` : m.by ? `shot down by ${m.by}` : String(m.why)); } break;
    case 'kill': feed(`<span style="color:${TEAM_COL[(net.roster.get(m.by) || {}).team] || '#fff'}">${esc(m.bn || 'AA')}</span> ✕ <span style="color:${TEAM_COL[(net.roster.get(m.v) || {}).team] || '#fff'}">${esc(m.vn)}</span> <small>${esc(m.why)}</small>`);
      { const o = net.others.get(m.v); if (o) { explodeOther(o); } } break;
    case 'bomb': bombs.launch({ id: m.id, from: m.from, type: m.type, p: m.p, v: m.v, wind: m.wind, seed: m.seed, mine: false, name: m.name }); break;
    case 'boom': onBoom(m); break;
    case 'rearm': me.bombsLeft = CP.PLANES[me.plane].bombs; me.hp = me.hpMax; me.ammo = ac.spec.gun.ammo; say('Rearmed and repaired by the deck crew', 2.5, '#7cff9a'); break;
    case 'round': onRound(m); break;
    case 'error': $('netState').textContent = m.msg; break;
  }
}
function setHp(h) { hp[0] = h[0]; hp[1] = h[1]; carriers.forEach((c, i) => { const f = Math.max(0, hp[i] / CW.HP); $(`cb${i}`).querySelector('.fl').style.width = (f * 100) + '%'; $(`cb${i}`).querySelector('.v').textContent = Math.round(f * 100) + '%'; }); }
function onRound(m) {
  const was = net.round.phase;
  net.round = { phase: m.phase, winner: m.winner, hp: m.hp, wins: m.wins, max: m.max || net.round.max }; syncClock(m); setHp(m.hp);
  $('score').textContent = `${m.wins[0]} : ${m.wins[1]}`;
  if (m.phase === 'over') {
    const r = $('result'); r.classList.remove('hidden');
    r.innerHTML = m.winner < 0 ? `<span>DRAW</span><small>Time ran out with both carriers equally damaged · next round in ${Math.round(m.left / 1000)} s</small>`
      : `<span style="color:${TEAM_COL[m.winner]}">${esc(CP.TEAMS[m.winner].name.toUpperCase())} WIN</span><small>${hp[1 - m.winner] <= 0 ? esc(CW.CARRIERS[1 - m.winner].name) + ' has been sunk' : 'Time ran out - ' + esc(CW.CARRIERS[1 - m.winner].name) + ' was more damaged'} · next round in ${Math.round(m.left / 1000)} s</small>`;
    if (m.winner >= 0 && hp[1 - m.winner] <= 0) carriers[1 - m.winner].sink = Math.max(carriers[1 - m.winner].sink, 0.001);
    if (state === 'flying') { ctl.active = false; }
    setTimeout(() => { if (net.round.phase === 'over' && state !== 'menu') showMenu(); }, 6000);
  } else if (was === 'over') {
    carriers.forEach(c => { c.sink = 0; c.group.rotation.set(0, 0, 0); c.group.position.y = 0; });
    $('result').classList.add('hidden'); for (const [, o] of net.others) o.model.root.visible = false;
    if (state !== 'menu') showMenu(); else renderMenu();
  }
}
function feed(html) { const d = document.createElement('div'); d.innerHTML = html; $('feed').prepend(d); setTimeout(() => d.remove(), 8000); while ($('feed').children.length > 6) $('feed').lastChild.remove(); }
function flashDamage() { $('vig').style.boxShadow = 'inset 0 0 160px 40px rgba(255,0,0,.55)'; setTimeout(() => { $('vig').style.boxShadow = 'inset 0 0 160px 40px rgba(255,0,0,0)'; }, 250); }

// other pilots: 15 Hz snapshots, smoothed and extrapolated a little
function nameTag(name, team) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 48; const g = c.getContext('2d');
  g.font = 'bold 28px Arial'; g.textAlign = 'center'; g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(0, 4, 256, 40); g.fillStyle = TEAM_COL[team]; g.fillText(name, 128, 34);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true, fog: false })); s.scale.set(11, 2, 1); s.position.y = 3.4; s.renderOrder = 4; return s;
}
function onSnap(m) {
  setHp(m.hp);
  const now = performance.now();
  for (let i = 0; i < m.p.length; i += 10) {
    const id = m.p[i]; if (id === net.id) continue;
    const info = net.roster.get(id); if (!info) continue;
    let o = net.others.get(id);
    if (!o || o.plane !== info.plane) {
      if (o) scene.remove(o.model.root);
      const model = newPlaneModel(info.plane, info.team, false); model.root.add(nameTag(info.name, info.team)); scene.add(model.root);
      o = { model, plane: info.plane, team: info.team, name: info.name, target: new THREE.Vector3(), tq: new THREE.Quaternion(), vel: new THREE.Vector3(), t: now, e: 0, fresh: true };
      net.others.set(id, o);
    }
    const np = new THREE.Vector3(m.p[i + 1], m.p[i + 2], m.p[i + 3]);
    if (o.fresh || o.model.root.visible === false || np.distanceTo(o.target) > 500) { o.model.root.position.copy(np); o.model.root.visible = true; o.vel.set(0, 0, 0); o.fresh = false; }
    else { const dt = Math.max(0.03, (now - o.t) / 1000); o.vel.copy(np).sub(o.target).divideScalar(dt); }
    o.target.copy(np); o.tq.set(m.p[i + 4], m.p[i + 5], m.p[i + 6], m.p[i + 7]); o.e = m.p[i + 8]; o.fl = m.p[i + 9]; o.t = now;
    if (o.fresh === false && !o.init) { o.model.root.quaternion.copy(o.tq); o.init = true; }
  }
}
function updateOthers(dt) {
  const now = performance.now();
  for (const [id, o] of net.others) {
    if (now - o.t > 1500) { o.model.root.visible = false; continue; }
    const age = Math.min(0.2, (now - o.t) / 1000), k = 1 - Math.exp(-dt * 14);
    const want = o.target.clone().addScaledVector(o.vel, age);
    o.model.root.position.lerp(want, k); o.model.root.quaternion.slerp(o.tq, k);
    animatePlane(o.model, { aileronL: 0, aileronR: 0, elevator: 0, rudder: 0, flaps: 0 }, o.e, dt, false, o.fl & 64 ? 1 : 0, 0);
  }
}
function explodeOther(o) {
  const p = o.model.root.position; o.model.root.visible = false; o.t = 0;
  const water = p.y < 3 && !CW.deckAt(p.x, p.y, p.z);
  fx.explode([p.x, p.y, p.z], [o.vel.x, o.vel.y, o.vel.z], { violence: 0.8, fuel: 1, water });
  if (!water) fx.wreckFire([p.x, Math.max(0, p.y - 3), p.z], { scale: 0.5, secs: 20, light: false });
  audio.boom(Math.hypot(p.x - camera.position.x, p.y - camera.position.y, p.z - camera.position.z));
}

// ---------- weapons
const insideOwnShield = () => { const s = CW.shieldAt(ac.pos[0], ac.pos[1], ac.pos[2]); return !!s && s.team === myTeam(); };
const weaponsHold = () => insideOwnShield();
const boxes = new Map();
function airframe(spec) {
  if (!boxes.has(spec)) {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const p of [[0, 0, 0], ...spec.hardpoints, ...spec.wheels.map(w => w.r)]) for (let a = 0; a < 3; a++) { b[a] = Math.min(b[a], p[a] - 0.5); b[a + 3] = Math.max(b[a + 3], p[a] + 0.5); }
    boxes.set(spec, b);
  }
  return boxes.get(spec);
}
function fireGun() {
  const G = ac.spec.gun, trigger = !ac.crashed && !ac.onGround && (ctl.keys.Space || gun.mouse) && me.ammo > 0;
  if (trigger && weaponsHold()) { if (performance.now() > msgUntil) say('Weapons safe - inside the carrier shield', 1.2, '#7cff9a'); gunAcc = 0; return; }
  if (!trigger) { gunAcc = 0; return; }
  const fwd = ac.attitude.fwd;
  for (gunAcc += STEP * G.rate; gunAcc >= 1 && me.ammo > 0; gunAcc--, me.ammo--) {
    const m = ac.worldPoint(G.muzzles[gunIdx++ % G.muzzles.length]);
    let d = fwd;
    if (G.converge) { const t = [ac.pos[0] + fwd[0] * G.converge - m[0], ac.pos[1] + fwd[1] * G.converge - m[1], ac.pos[2] + fwd[2] * G.converge - m[2]], l = Math.hypot(...t); d = [t[0] / l, t[1] / l, t[2] / l]; }
    const r = () => (Math.random() - 0.5) * G.spread;
    guns.shoot(m, [ac.vel[0] + (d[0] + r()) * G.speed, ac.vel[1] + (d[1] + r()) * G.speed, ac.vel[2] + (d[2] + r()) * G.speed], true);
    audio.gun();
  }
}
function updateGuns(dt) {
  const targets = [];
  for (const [id, o] of net.others) {
    if (!o.model.root.visible || o.team === myTeam()) continue;
    const p = o.model.root.position;
    if (CW.shieldAt(p.x, p.y, p.z)) continue;                                      // rounds pass through anybody inside a shield
    targets.push({ id, pos: p, q: o.model.root.quaternion, box: airframe(FP.TYPES[o.plane]), o });
  }
  for (const h of guns.update(dt, targets)) {
    gun.hits.set(h.id, (gun.hits.get(h.id) || 0) + 1);
    const o = net.others.get(h.id); if (o) say(`Hit ${o.name}!`, 0.9, '#ffc83a');
  }
  if (gun.hits.size && net.open && performance.now() - gun.lastSend > 100) {
    gun.lastSend = performance.now();
    for (const [id, n] of gun.hits) net.ws.send(JSON.stringify({ t: 'hit', id, n: Math.min(24, n) }));
    gun.hits.clear();
  }
}
function dropBomb() {
  if (state !== 'flying' || ac.crashed || !me.bombsLeft) return me.bombsLeft === 0 && CP.PLANES[me.plane].bombs ? say('Bombs gone - land on your carrier to rearm', 2, '#ffc83a') : 0;
  if (ac.onGround) return say('Get airborne first', 1.5, '#ffc83a');
  if (weaponsHold()) return say('Bombs safe - inside the carrier shield', 2, '#7cff9a');
  const P = CP.PLANES[me.plane], down = FP.qrot(ac.q, [0, -1, 0]), p = ac.worldPoint(me.plane === 'dauntless' ? [0, -2.0, -1.6] : [0, -1.6, -1.2]);   // thrown clear of the propeller by the trapeze (SBD) / out of the crutch (Val)
  rackAnim = 0.0001;
  const rel = { id: ++bombSeq, type: P.bomb, p: p.map(v => Math.round(v * 10) / 10), v: ac.vel.map((v, i) => Math.round((v + down[i] * 1.2) * 100) / 100), wind: [0, 0], seed: (Math.random() * 2147483647) | 0 };
  bombs.launch({ ...rel, from: net.id || 0, mine: true, name: myName() });
  if (net.open) net.ws.send(JSON.stringify({ t: 'bomb', ...rel }));
  me.bombsLeft--; audio.burst(0.12, { freq: 500, to: 180, q: 1, vol: 0.35 });
  say(me.bombsLeft ? `Bomb away - ${me.bombsLeft} left` : 'Bomb away', 1.5, '#ffd23a');
}
function onBombImpact(b, ev) {
  if (net.open) net.ws.send(JSON.stringify({ t: 'impact', id: b.id, p: ev.p.map(v => Math.round(v * 10) / 10), kind: ev.kind }));
  else onBoom({ w: BM.BOMBS[b.type].w, p: ev.p, kind: ev.p[1] > 5 ? 'deck' : 'water', from: 0, id: b.id, hit: -1, dmg: 0, hp });
}
function onBoom(m) {
  bombs.settle(m.from, m.id);
  const p = m.p, deck = p[1] > 5, big = m.w === 'b1000' ? 1.3 : 1;
  const d = Math.hypot(p[0] - camera.position.x, p[1] - camera.position.y, p[2] - camera.position.z);
  if (deck) {
    fx.explode(p, [0, 0, 0], { violence: 1, fuel: 1.6 * big, water: false });
    fx.wreckFire([p[0], p[1], p[2]], { scale: 0.9 * big, secs: 40, light: false });
  } else fx.explode([p[0], 0, p[2]], [0, 0, 0], { violence: 1, fuel: 1.4 * big, water: true });
  audio.boom(d);
  if (m.hp) setHp(m.hp);
  if (m.hit >= 0 && m.dmg) { const pct = Math.round(m.dmg / CW.HP * 100); feed(`💥 ${esc(CW.CARRIERS[m.hit].name)} hit: -${pct}%`); if (m.from === net.id) say(`Direct hit on ${CW.CARRIERS[m.hit].name}! -${pct}%`, 3, '#7cff9a'); }
  else if (m.from === net.id) say(deck ? 'Bomb exploded on the deck' : 'Bomb missed - it landed in the sea', 2, '#ffc83a');
  if (d < 600 && !ac.crashed && state === 'flying') camShake = Math.max(camShake, 1 - d / 600);
}
let camShake = 0, camHold = null;

// ---------- the flight loop
function onCrash(e) {
  if (state !== 'flying') return;
  state = 'dead'; deadT = 0; ctl.active = false; wreckPos = new THREE.Vector3(...ac.pos);
  const water = ac.pos[1] < 6 && !CW.deckAt(ac.pos[0], ac.pos[1], ac.pos[2]);
  fx.explode(ac.pos.slice(), ac.vel.slice(), { violence: Math.min(1, ac.speed / 60), fuel: 1, water });
  if (!water) fx.wreckFire([ac.pos[0], Math.max(0, ac.pos[1] - 2), ac.pos[2]], { scale: 0.6, secs: 30, light: false });
  plane.root.visible = false; audio.crash();
  say(`Lost: ${e.reason || 'crashed'}`, 4, '#ff6a4a');
  if (net.open && !me.killedByServer) net.ws.send(JSON.stringify({ t: 'down', why: String(e.reason || 'crashed').slice(0, 60) }));
}
/** The speed (m/s, northward = -z)  of the carrier whose deck we are on or just above, else 0. */
function deckFrame() {
  if (ac.pos[1] > CW.DECK.y + 28 || ac.pos[1] < CW.DECK.y - 3) return 0;
  for (const c of CW.CARRIERS) if (CW.inDeck(c, ac.pos[0], ac.pos[2], 25)) return CW.SPEED;
  return 0;
}
function killSelf(reason) {                          // Aircraft.crash() queues its event for the next step; we are done flying, so handle it now
  ac.crash(reason); onCrash(ac.events[ac.events.length - 1]);
}
function deckStep() {
  const own = CW.CARRIERS[myTeam()], zloc = ac.pos[2] - own.z, onDeck = CW.inDeck(own, ac.pos[0], ac.pos[2]) && ac.pos[1] < CW.DECK.y + 8 && ac.pos[1] > CW.DECK.y - 3;
  const fwd = ac.attitude.fwd;
  const V = CW.SPEED;
  if (!ac.onGround) { me.hooked = false; me.catMsg = false; }
  // arrestor wires: only a touchdown in the wire zone hooks one
  if (me.hooked && ac.onGround) {
    const rx = ac.vel[0], rz = ac.vel[2] + V, sp = Math.hypot(rx, rz);                  // the wire stops us relative to the moving deck
    if (sp < 2.5) me.hooked = false;
    else { const k = Math.max(0, 1 - 24 * STEP / sp); ac.vel[0] = rx * k; ac.vel[2] = rz * k - V; }
  }
  // catapult: full throttle at the stern end, pointing up the deck
  if (onDeck && ac.onGround && !me.hooked && ctl.throttle >= 0.9 && ac.speed < 68 && zloc > -70 && fwd[2] < -0.8) {
    const a = CW.CAT.accel * STEP; ac.vel[0] += fwd[0] * a; ac.vel[2] += fwd[2] * a;
    if (!me.catMsg) { me.catMsg = true; say('CATAPULT!', 1.2, '#ffd23a'); }
  }
  // the deck crew
  if (onDeck && ac.onGround && ac.speed < V + 4 && (me.bombsLeft < CP.PLANES[me.plane].bombs || me.hp < me.hpMax || me.ammo < ac.spec.gun.ammo)) {
    me.bombsLeft = CP.PLANES[me.plane].bombs; me.hp = me.hpMax; me.ammo = ac.spec.gun.ammo;
    if (!net.open) say('Rearmed and repaired by the deck crew', 2.5, '#7cff9a');
  }
}
function gameStep() {
  Object.assign(ac.ctl, ctl.update(STEP));
  if (ctl.keys.Space && !ac.onGround) ac.ctl.brake = 0;
  CW.update(roundT());
  // The decks move. On (or just above) a deck the aircraft is flown in the carrier's frame of reference: take the ship's velocity off,
  // let the physics run (the air then moves past at -ship velocity: wind over the deck), put the velocity and the ship's travel back.
  const F = deckFrame();
  if (F) { ac.vel[2] += F; ac.wind[2] = F; }
  const events = ac.step(STEP); simTime += STEP;
  if (F) { ac.vel[2] -= F; ac.pos[2] -= F * STEP; ac.wind[2] = 0; }
  maxG = Math.max(maxG, ac.g);
  hookPos += ((me.hookDown ? 1 : 0) - hookPos) * Math.min(1, STEP * 3);
  for (const e of events) {
    if (e.type === 'touch') {
      audio.touchdown(e.vs);
      const own = CW.CARRIERS[myTeam()], zl = e.pos[2] - own.z, fromStern = CW.DECK.len / 2 - zl;
      if (CW.inDeck(own, e.pos[0], e.pos[2]) && e.pos[1] > CW.DECK.y - 3) {
        if (ac.speed > 25 && me.hookDown && fromStern >= CW.WIRES.from - 6 && fromStern <= CW.WIRES.to + 6) { me.hooked = true; say('WIRE! Arrested', 2, '#7cff9a'); }
        else if (ac.speed > 25) say(!me.hookDown ? 'Hook is UP (H) - no wire, go around!' : fromStern < CW.WIRES.from ? 'Too short - no wire, go around!' : 'Missed the wires - bolter!', 2, '#ffc83a');
      }
    } else if (e.type === 'warn') say(e.text, 2.5, '#ffc83a');
    else if (e.type === 'fail') { say(e.text, 5, '#ff4a3a'); audio.hit(); }
    else if (e.type === 'repair') say(e.text, 3, '#7cff9a');
    else if (e.type === 'crash') onCrash(e);
  }
  if (state !== 'flying') return;
  deckStep(); fireGun();
  if (Math.hypot(ac.pos[0], ac.pos[2]) > PLAY_R) {                                // flew out of the battle area
    me.outT += STEP; say(`Return to the battle! ${Math.max(0, 15 - Math.round(me.outT))} s`, 0.5, '#ff6a4a');
    if (me.outT > 15) { killSelf('ran out of fuel far from the fleet'); return; }
  } else me.outT = 0;
  if (net.open && performance.now() - net.lastSend > 66) {
    net.lastSend = performance.now();
    net.ws.send(JSON.stringify({ t: 'st', p: ac.pos.map(v => Math.round(v * 10) / 10), q: ac.q.map(v => Math.round(v * 1000) / 1000), e: Math.round(ac.engine * 100) / 100, fl: ac.onGround ? 64 : 0, s: Math.round(ac.speed * 10) / 10 }));
  }
}
net.lastSend = 0;

// ---------- camera
function updateCamera(dt) {
  if (state === 'flying') {
    const f = ac.attitude.fwd, fh = new THREE.Vector3(f[0], 0, f[2]).normalize(), S = ac.spec.cam;
    plane.cockpitGroup.visible = camMode === 1;
    if (camMode === 1) {
      const e = ac.worldPoint(ac.spec.eye); camPos.set(...e);
      camera.position.copy(camPos); planeQ.set(...ac.q);
      camera.quaternion.copy(planeQ); camera.rotateY(ctl.look.yaw); camera.rotateX(ctl.look.pitch); camera.fov = 70;
    } else {
      const back = new THREE.Vector3(f[0], f[1], f[2]).multiplyScalar(0.55).addScaledVector(fh, 0.45).normalize().multiplyScalar(S.dist * 1.1);
      back.applyAxisAngle(new THREE.Vector3(0, 1, 0), ctl.look.yaw);
      const want = new THREE.Vector3(ac.pos[0] - back.x, ac.pos[1] - back.y + S.height, ac.pos[2] - back.z);
      camPos.lerp(want, 1 - Math.exp(-dt * 7));
      camera.position.copy(camPos); camera.up.set(0, 1, 0);
      camera.lookAt(ac.pos[0] + f[0] * 18, ac.pos[1] + f[1] * 18 + 1.5 + ctl.look.pitch * 8, ac.pos[2] + f[2] * 18); camera.fov = 65;
    }
  } else if (state === 'dead' && wreckPos) {
    const t = performance.now() / 1000 * 0.25;
    camera.position.set(wreckPos.x + Math.sin(t) * 60, wreckPos.y + 22, wreckPos.z + Math.cos(t) * 60); camera.up.set(0, 1, 0); camera.lookAt(wreckPos); camera.fov = 60;
  } else {                                                                          // menu: orbit your carrier
    const c = CW.CARRIERS[myTeam()], t = performance.now() / 1000 * 0.08, R = 190;
    camera.position.set(c.x + Math.sin(t) * R, 55, c.z + Math.cos(t) * R); camera.up.set(0, 1, 0); camera.lookAt(c.x, 14, c.z); camera.fov = 55;
  }
  if (camShake > 0.01) { camera.position.x += (Math.random() - 0.5) * camShake * 2; camera.position.y += (Math.random() - 0.5) * camShake * 2; camShake *= Math.pow(0.05, dt); }
  camera.updateProjectionMatrix();
}

// ---------- HUD: the island sim's own Hud.js (tapes, horizon, gauges, radar, minimap) fed from this game's state; the carrier panels are DOM
const bearing = (dx, dz) => (Math.round(Math.atan2(dx, -dz) * 180 / Math.PI) + 360) % 360;
const v3 = new THREE.Vector3();
const headingOf = q => { const f = FP.qrot(q, [0, 0, -1]); return (Math.atan2(f[0], -f[2]) + Math.PI * 2) % (Math.PI * 2); };
function pullUp() {
  if (ac.onGround || ac.speed < 30) return false;
  for (let t = 1; t <= 6; t++) {
    const x = ac.pos[0] + ac.vel[0] * t, y = ac.pos[1] + ac.vel[1] * t, z = ac.pos[2] + ac.vel[2] * t;
    if (y < 14 && !CW.inDeck(CW.CARRIERS[myTeam()], x, z, 400)) return true;                 // heading for the sea (near your own deck is a landing)
  }
  return false;
}
function stallWarning() { const w = ac.spec.surfaces[0]; return ac.stall > 0.02 || (ac.alpha + w.inc > w.stall - 3 * Math.PI / 180 && ac.ias > 10); }
function hudState() {
  const att = ac.attitude, cockpit = camMode === 1, sh = CW.shieldAt(ac.pos[0], ac.pos[1], ac.pos[2]);
  const onDeck = ac.onGround && ac.pos[1] > CW.DECK.y - 3, base = onDeck ? CW.DECK.y : 0;
  let fpm = null;
  if (cockpit && ac.speed > 5) {
    const p = v3.set(ac.pos[0] + ac.vel[0] / ac.speed * 500, ac.pos[1] + ac.vel[1] / ac.speed * 500, ac.pos[2] + ac.vel[2] / ac.speed * 500).project(camera), r = canvas.getBoundingClientRect();
    if (p.z < 1) fpm = [(p.x * 0.5 + 0.5) * r.width, (-p.y * 0.5 + 0.5) * r.height];
  }
  const R = RADAR_RANGES[radarIdx], mine = myTeam();
  const s = {
    cockpit, pitch: att.pitch, bank: att.bank, heading: att.heading, ias: ac.ias, gs: Math.hypot(ac.vel[0], ac.vel[2]),
    alt: ac.pos[1], agl: Math.max(0, ac.pos[1] - base - ac.spec.restHeight), groundAlt: base, vs: ac.vel[1], throttle: ac.ctl.throttle, engine: ac.engine,
    flaps: ac.ctl.flaps, trim: ac.ctl.trim, brake: ac.onGround ? ac.ctl.brake : 0, wheels: ac.wheelLoad.map(l => l > 0), g: ac.g, maxG, alpha: ac.alpha, beta: ac.beta,
    onGround: ac.onGround, stallWarn: stallWarning(), pullUp: pullUp(), fpm, pos: ac.pos, spec: ac.spec, windSpeed: 0, windFrom: 0,
    teamName: CP.TEAMS[mine].short + ' · ' + CP.PLANES[me.plane].name, teamColor: TEAM_COL[mine], aa: aaWarn > 0,
    carriers: CW.CARRIERS.map(c => ({ x: c.x, z: c.z, color: TEAM_COL[c.team], short: c.team ? 'IJN' : 'USN' })),
    others: [...net.others.values()].filter(o => o.model.root.visible).map(o => ({ x: o.model.root.position.x, z: o.model.root.position.z, color: TEAM_COL[o.team] })),
    mapId: 'war', radarRange: R,
    radarFields: R ? CW.CARRIERS.map(c => ({ S: { x: c.x, z1: c.z - CW.DECK.len / 2, z0: c.z + CW.DECK.len / 2 }, box: [c.x - CW.SHIELD.r, c.z - CW.SHIELD.r, c.x + CW.SHIELD.r, c.z + CW.SHIELD.r] })) : [],
    shield: sh ? { name: sh.name, inside: true, grace: 0 } : null,
    radar: R ? [...net.others.values()].filter(o => o.model.root.visible).map(o => { const p = o.model.root.position; return { name: o.name, x: p.x, y: p.y, z: p.z, hdg: headingOf([o.model.root.quaternion.x, o.model.root.quaternion.y, o.model.root.quaternion.z, o.model.root.quaternion.w]), war: o.team !== mine, dead: false, shielded: !!CW.shieldAt(p.x, p.y, p.z) }; }) : [],
  };
  if (ac.spec.retract) s.gear = { pos: ac.gearPos, down: ac.ctl.gear !== 0, warn: ac.gearPos < 0.999 && !ac.onGround && s.agl < 150 && ac.ias < ac.spec.hud.vs0 / KT * 1.5 && ac.ctl.throttle < 0.35 };
  if (ac.spec.airbrake) s.airbrake = ac.airbrakePos;
  if (ac.spec.gun && !ac.crashed) {                              // where the rounds go, 600 m out (gravity drop included)
    const tof = 600 / ac.spec.gun.speed, fw = ac.attitude.fwd;
    const aim = v3.set(ac.pos[0] + (ac.vel[0] + fw[0] * ac.spec.gun.speed) * tof, ac.pos[1] + (ac.vel[1] + fw[1] * ac.spec.gun.speed) * tof - 4.9 * tof * tof, ac.pos[2] + (ac.vel[2] + fw[2] * ac.spec.gun.speed) * tof).project(camera), r = canvas.getBoundingClientRect();
    s.gun = { ammo: me.ammo, firing: !!(ctl.keys.Space || gun.mouse) && !ac.onGround && me.ammo > 0, pipper: aim.z < 1 ? [(aim.x * 0.5 + 0.5) * r.width, (-aim.y * 0.5 + 0.5) * r.height] : null };
  }
  if (me.hp < me.hpMax) s.damage = Math.round(me.hpMax - me.hp);
  const fl = Object.keys(ac.fail || {}).map(k => k.toUpperCase() + ' FAILED');
  if (fl.length) s.fails = { list: fl, heat: '' };
  return s;
}
function updateHud() {
  const P = CP.PLANES[me.plane];
  $('hpFill').style.width = Math.max(0, me.hp / me.hpMax * 100) + '%'; $('hpFill').style.background = me.hp / me.hpMax < 0.35 ? '#ff6a4a' : '#7cff9a';
  $('ammo').innerHTML = `rounds ${me.ammo}${P.bombs ? ` · bombs <b>${me.bombsLeft}</b>` : ''}<br>hook <b>${me.hookDown ? 'DOWN' : 'up'}</b>${ac.spec.airbrake ? ` · dive brakes <b>${ac.airbrakePos > 0.5 ? 'OUT' : 'in'}</b>` : ''}`;
  const own = CW.CARRIERS[myTeam()], en = CW.CARRIERS[1 - myTeam()];
  const dh = Math.hypot(own.x - ac.pos[0], own.z - ac.pos[2]), de = Math.hypot(en.x - ac.pos[0], en.z - ac.pos[2]);
  const left = Math.max(0, (net.round.max || CW.ROUND_MAX) - roundT()), mm = Math.floor(left / 60), ss = String(Math.floor(left % 60)).padStart(2, '0');
  $('nav').innerHTML = `HOME ${(dh / 1000).toFixed(1)} km · brg ${String(bearing(own.x - ac.pos[0], own.z - ac.pos[2])).padStart(3, '0')}<br>ENEMY ${(de / 1000).toFixed(1)} km · brg ${String(bearing(en.x - ac.pos[0], en.z - ac.pos[2])).padStart(3, '0')}<br>round ${mm}:${ss} · fleets steaming N at ${Math.round(CW.SPEED * 1.944)} kt`;
}

// ---------- carriers: smoke and fire when hurt, sinking when the round is lost
function updateCarriers(dt) {
  carriers.forEach((c, i) => {
    const f = hp[i] / CW.HP, I = CW.CARRIERS[i];
    c.group.position.set(I.x, c.group.position.y, I.z); c.dish.rotation.y += dt * 2.2; c.flag.rotation.y = Math.PI / 2 + Math.sin(performance.now() / 280 + i) * 0.12;
    c.label.visible = Math.hypot(camera.position.x - I.x, camera.position.z - I.z) > 700;
    if (net.round.phase === 'over' && net.round.winner === 1 - i && c.sink > 0) {
      c.sink = Math.min(1, c.sink + dt / 18); const s = c.sink * c.sink;
      c.group.position.y = -s * 30; c.group.rotation.z = (i ? 1 : -1) * s * 0.5; c.group.rotation.x = -s * 0.25;
    }
    if (f < 0.75 && (c.smokeT -= dt) <= 0) {
      c.smokeT = f < 0.25 ? 0.08 : f < 0.5 ? 0.16 : 0.3;
      const x = I.x + (Math.random() - 0.5) * 20, z = I.z + (Math.random() - 0.5) * 160, y = CW.DECK.y + 2 - c.sink * 30;
      fx.smoke.emit({ p: [x, y, z], v: [(Math.random() - 0.5) * 3, 9 + Math.random() * 5, (Math.random() - 0.5) * 3], life: 5 + Math.random() * 3, size: [3, 22], c0: [0.12, 0.12, 0.12], c1: [0.3, 0.3, 0.3], a: 0.85, fadeIn: 0.05, drag: 0.4, acc: 0.6 });
      if (f < 0.5) fx.fire.emit({ p: [x, y, z], v: [0, 4, 0], life: 0.8, size: [3, 6], c0: [3, 1.8, 0.6], c1: [1.5, 0.3, 0.05], a: 1, fadeIn: 0.05, drag: 1 });
    }
  });
}

// ---------- input
addEventListener('keydown', e => {
  if (state !== 'flying' || ac.crashed || e.repeat) return;
  if (e.code === 'KeyN') dropBomb();
  else if (e.code === 'KeyU') { ac.ctl.gear = ac.ctl.gear ? 0 : 1; audio.gear(); say(ac.ctl.gear ? 'Gear DOWN' : 'Gear UP', 1.2); }
  else if (e.code === 'KeyZ' && ac.spec.airbrake) { ac.ctl.airbrake = ac.ctl.airbrake ? 0 : 1; say(ac.ctl.airbrake ? 'Dive brakes OUT' : 'Dive brakes in', 1.2); }
  else if (e.code === 'KeyC') camMode = (camMode + 1) % 2;
  else if (e.code === 'KeyH') { me.hookDown = !me.hookDown; say(me.hookDown ? 'Tailhook DOWN' : 'Tailhook up', 1.2); audio.click(); }
  else if (e.code === 'KeyK') { radarIdx = (radarIdx + 1) % RADAR_RANGES.length; say(RADAR_RANGES[radarIdx] ? `Radar ${RADAR_RANGES[radarIdx] / 1000} km` : 'Radar off', 1.2); }
});
ctl.onAction = (a, v) => { if (a === 'flaps') { audio.flaps(); say(`Flaps ${['UP', '15°', '32°'][v]}`, 1.2); } };
canvas.addEventListener('mousedown', e => { if (e.button === 0) { gun.mouse = true; audio.unlock(); } });
addEventListener('mouseup', e => { if (e.button === 0) gun.mouse = false; });

// ---------- main loop
let last = performance.now(), acc = 0;
function loop(now) {
  const dt = Math.min(0.25, (now - last) / 1000); last = now;
  if (state === 'flying') {
    acc += dt; let n = 0;
    while (acc >= STEP && n < 15) { gameStep(); acc -= STEP; n++; if (state !== 'flying') break; }
    if (n === 15) acc = 0;
  } else acc = 0;
  if (state === 'dead') { deadT += dt; if (deadT > 3.5) showMenu(); }
  if (state === 'flying' || state === 'dead') {
    plane.root.position.set(...ac.pos); plane.root.quaternion.set(...ac.q);
    if (plane.rack) plane.rack.bomb.visible = me.bombsLeft > 0;
    animatePlane(plane, ac.defl, ac.crashed ? 0 : ac.engine, dt, false, ac.gearPos, ac.airbrakePos);
    if (plane.hook) plane.hook.rotation.x = hookPos * 0.8;
    if (rackAnim > 0) { rackAnim += dt; if (plane.rack) { plane.rack.group.rotation.x = Math.sin(Math.min(1, rackAnim / 0.9) * Math.PI) * 1.25; plane.rack.bomb.rotation.x = -plane.rack.group.rotation.x * 0.7; } if (rackAnim > 0.9) rackAnim = 0; }
  }
  ocean.update(now / 1000); if (state !== 'flying') CW.update(roundT());
  updateOthers(dt); updateGuns(dt); bombs.update(dt); updateCarriers(dt); fx.update(dt, [0, 0, 0]);
  if (aaWarn > 0) aaWarn -= dt;
  if (performance.now() > msgUntil) $('msg').style.opacity = 0;
  updateCamera(dt);
  if (camHold) { camera.position.set(camHold[0], camHold[1], camHold[2]); camera.up.set(0, 1, 0); camera.lookAt(camHold[3], camHold[4], camHold[5]); camera.fov = camHold[6] || 50; camera.updateProjectionMatrix(); }
  if (state === 'flying') updateHud();
  hud.draw(state === 'flying' ? hudState() : null);
  const fp = state === 'flying' || state === 'dead' ? ac.pos : [camera.position.x, camera.position.y, camera.position.z];
  sun.position.set(fp[0] + SUN.x * 300, fp[1] + SUN.y * 300, fp[2] + SUN.z * 300); sun.target.position.set(fp[0], fp[1], fp[2]);
  audio.update({ engine: state === 'flying' ? ac.engine : 0, ias: ac.ias, stall: ac.stall, warn: false, rolling: state === 'flying' && ac.onGround ? ac.speed : 0, crashed: state !== 'flying', alpha: ac.alpha, jet: false, fan: false, afterburner: false });
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

// ---------- start
(async function start() {
  try { if (window.OIID && !(await OIID.require())) { $('loading').textContent = 'A player name is needed to play.'; } else if (OIID.fresh) await OIID.fresh(); } catch (e) {}
  setPlane('hellcat'); plane.root.visible = false;
  $('loading').classList.add('hidden'); $('menu').classList.remove('hidden');
  renderMenu(); connect(); showMenu();
  requestAnimationFrame(loop);
})();

// test hooks (headless Chrome): FS-style access to the game
window.CWGame = { setCam: v => { camHold = v; }, models: buildCarrierPlane, scene, hud, hudState, roundT, ocean, bombs, ac, ctl, net, me, fx, tick: dt => { for (let t = 0; t < dt; t += STEP) { clock.t0 -= STEP * 1000; gameStep(); } }, startFlight, state: () => state, hp, carriers, onNet, setPlane };
