/**
 * Skyward Dynamics - client entry point.
 *   - Three.js scene: physical sky + sun (shadows follow the aircraft), haze, terrain, sea, airfield
 *   - 60 Hz fixed-step loop driving FlightPhysics (4 sub-steps each), PlaneController, AudioSystem
 *   - modes: Free Flight (13 aerobatic manoeuvres are recognised by Aerobatics.js, with a checklist), Precision Landing (graded), Ring Race (timed)
 *   - cameras: chase, cockpit (with HUD ladder), fly-by; right-drag to look around
 *   - effects: exhaust vapour, wingtip vortices under load, tyre smoke, dust; crashes (Effects.js): flash,
 *     fireball turning into black smoke, embers, dust ring / splash, cannon-es debris, a burning wreck
 *   - the playground (Playground.js): the REX statue, a barn, a sea arch, the canyon bridge, hoops, balloons
 *   - the shared sky: other pilots (10 Hz, interpolated), mid-air collisions (both aircraft crash),
 *     leaderboards (optional - works offline)
 *   - weapons: cannon (Falcon, Warbird); AIM-9 heat-seekers + flares on the Falcon (Missiles.js / MissileSim.js):
 *     seeker tone and lock, launch zone cue, missile warning for the pilot it was fired at
 */
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import * as CANNON from 'cannon-es';
import { TerrainGenerator, HeightField } from './TerrainGenerator.js?v=13';
import { PlaneController } from './PlaneController.js?v=3';
import { AudioSystem } from './AudioSystem.js?v=7';
import { Hud, fmtTime } from './Hud.js?v=18';
import { buildPlane, animatePlane, LIVERIES, liveryOf } from './PlaneModel.js?v=19';
import { mergeStatic, referenced, fixDoubleSided } from './MergeStatic.js?v=2';
import { Effects } from './Effects.js?v=2';
import { Playground, STUNTS } from './Playground.js?v=3';
import { Guns } from './Guns.js?v=3';
import { Missiles } from './Missiles.js?v=7';
import { Birds } from './Birds.js?v=3';
import { Craters } from './Craters.js?v=1';
import { BombFleet, Bombsight } from './Bombing.js?v=4';
import { AIM9, MISSILE_TYPES, MISSILE_IDS, signature, detectRange, predict } from './MissileSim.js?v=3';
// the carrier map (carrier_war/): another sea, two carriers, WWII carrier aircraft; main.js calls into it where the map matters (mapId === 'carrier')
import '../../carrier_war/client/CarrierPlanes.js?v=8';
import { buildCarrierPlane } from '../../carrier_war/client/CarrierModels.js?v=19';
import { CarrierMap } from '../../carrier_war/client/CarrierMap.js?v=15';
import { CarrierHud } from '../../carrier_war/client/CarrierHud.js?v=5';

const W = window.FSWorld, FP = window.FSPhysics, AR = window.FSAerobatics, CW = window.CWWorld, CP = window.CWPlanes;
// the carrier aircraft have their own models and fixed paint. Every model's static parts are merged per material (MergeStatic.js: ~200 parts =
// ~200 draw calls otherwise); the crash break-up puts the real parts back first (merged.undo)
const makePlane = (id, liv, o) => { const m = CP.PLANES[id] ? buildCarrierPlane(id, o) : buildPlane(id, liv, o); m.merged = mergeStatic(m.root, { keep: referenced(m) }); fixDoubleSided(m.root); return m; };
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KT = 1.94384, FT = 3.28084, DEG = Math.PI / 180;
const STEP = 1 / 60;

// ---------- renderer, scene, sky
const canvas = $('view');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
} catch (e) { $('webglError').style.display = 'block'; throw e; }
renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.55;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 60000);
const SUN = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 32), THREE.MathUtils.degToRad(150));
const sky = new Sky(); sky.scale.setScalar(450000);
Object.assign(sky.material.uniforms, {});
sky.material.uniforms.turbidity.value = 5; sky.material.uniforms.rayleigh.value = 1.4;
sky.material.uniforms.mieCoefficient.value = 0.004; sky.material.uniforms.mieDirectionalG.value = 0.8;
sky.material.uniforms.sunPosition.value.copy(SUN);
// the sky's scattering shader is the costliest per-pixel thing on screen and sits at the far plane: draw it after every other opaque object, so the
// GPU's depth test throws away the sky pixels the terrain, sea and aircraft already cover (with the log depth buffer the other shaders write their
// own depth and lose that early rejection - the sky does not, so it keeps it). Same picture.
sky.renderOrder = 100;
scene.add(sky);
{ // reflections / ambient from the sky
  const pm = new THREE.PMREMGenerator(renderer), envScene = new THREE.Scene(), s2 = new Sky();
  s2.scale.setScalar(1000); s2.material.uniforms.sunPosition.value.copy(SUN);
  for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) s2.material.uniforms[k].value = sky.material.uniforms[k].value;
  envScene.add(s2);
  scene.environment = pm.fromScene(envScene).texture;
  pm.dispose();
}
scene.fog = new THREE.FogExp2(0xa9c4dc, 0.000055);
const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x5a6a40, 0.9); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 600 });
sun.shadow.bias = -0.0004;
scene.add(sun, sun.target);

function resize() {
  const r = canvas.getBoundingClientRect();
  renderer.setSize(Math.max(320, r.width | 0), Math.max(180, r.height | 0), false);
  camera.aspect = r.width / r.height; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// ---------- world
$('loading').textContent = 'Generating terrain…';
const field = new HeightField();
const world = new TerrainGenerator(scene, field); world.camera = camera;       // the cloud puffs are sorted along its view
const play = new Playground(scene, field);
// the island's airfields, buildings and playground are hundreds of small static meshes: merge them per (identical) material - same picture, far fewer draw calls
const mergedWorld = [mergeStatic(world.group, { keep: referenced(world), byLook: true }), mergeStatic(play.group, { keep: referenced(play), byLook: true })];
let planeType = 'sport';
try { const t = localStorage.getItem('fsPlane'); if (FP.TYPES[t]) planeType = t; } catch (e) {}
// immune mode (menu option, Precision Landing only, any aircraft): guns, missiles and other pilots can't hurt
// you - and your own weapons are safe. In free flight and the ring race everyone is fair game.
let immuneOpt = false, immune = false;              // off unless the pilot ticks it
try { immuneOpt = localStorage.getItem('fsImmune') === '1'; } catch (e) {}
// the two maps: PEACE (civil aircraft only, no weapons, no craters) and WAR (everything). War aircraft can only fly on the war map;
// civil aircraft may join it, unarmed. On the war map every airfield has a shield (see shared/World.js): protected + weapons safe inside.
let mapId = 'war';
try { const t = localStorage.getItem('fsMap'); if (W.MAPS.includes(t)) mapId = t; } catch (e) {}
{ const q = new URLSearchParams(location.search).get('map'); if (W.MAPS.includes(q)) { mapId = q; if (!W.mapAllows(q, planeType)) planeType = q === 'carrier' ? 'hellcat' : 'sport'; } }      // ?map=carrier opens the carrier map
if (!W.mapAllows(mapId, planeType)) mapId = W.isCarrierPlane(planeType) ? 'carrier' : 'war';
const shield = { field: null, grace: 0 };          // field: the airfield whose shield we are inside; grace: simTime until which we are still protected
const RADAR_RANGES = [2500, 5000, 10000, 20000, 0];   // m; 0 = off
let radarIdx = 1;
try { const t = +localStorage.getItem('fsRadar'); if (t >= 0 && t < RADAR_RANGES.length) radarIdx = t; } catch (e) {}
// physics: terrain, runway / grass / sea, and every tree and airfield building as an obstacle
const solidAt = (x, y, z) => mapId === 'carrier' ? CW.solidAt(x, y, z) : (world.obstacleAt(x, y, z) || play.obstacleAt(x, y, z));
/**
 * Any flat top is a landing spot (hangar roof, the top of a REX letter...): if the point is just inside something
 * (top within 1 m above it) and the top is level for 0.7 m all round, return its height. Slopes, edges, tree
 * crowns -> null (still an obstacle). Hard landings there break the gear like anywhere else.
 */
function deckAt(x, y, z) {
  if (mapId === 'carrier') return CW.deckAt(x, y, z);         // the flight decks (they move: CW.update is called every frame)
  const top = (x, z) => {
    if (!solidAt(x, y, z) || solidAt(x, y + 1, z)) return null;
    let a = y, b = y + 1;
    for (let k = 0; k < 7; k++) { const m = (a + b) / 2; if (solidAt(x, m, z)) a = m; else b = m; }
    return b;
  };
  const t = top(x, z);
  if (t === null) return null;
  for (const [dx, dz] of [[0.7, 0], [-0.7, 0], [0, 0.7], [0, -0.7]]) { const n = top(x + dx, z + dz); if (n === null || Math.abs(n - t) > 0.15) return null; }
  return t;
}
const ac = new FP.Aircraft({ type: planeType, ground: (x, z) => field.at(x, z), surface: (x, z) => field.surface(x, z), obstacle: solidAt, deck: deckAt, deckNormal: (x, y, z) => mapId === 'carrier' ? CW.deckNormalAt(x, y, z) : null });
const ctl = new PlaneController(canvas);
ctl.feel = ac.spec.feel;
const audio = new AudioSystem();
const hud = new Hud($('hud'), W, field);
const carrierHud = new CarrierHud($('hud'));                              // the same HUD with the carrier minimap and map badge
let livery = 0;
try { livery = Math.max(0, Math.min(LIVERIES.length - 1, Number(localStorage.getItem('fsLivery')) || 0)); } catch (e) {}
let plane = makePlane(planeType, livery);
scene.add(plane.root);

// ---------- particles
function softTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); return t;
}
const SOFT = softTex();
function particles(n, size, blending, opacity = 1) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3).fill(-1e5), col = new Float32Array(n * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size, map: SOFT, vertexColors: true, transparent: true, opacity, depthWrite: false, blending, sizeAttenuation: true }));
  pts.frustumCulled = false; scene.add(pts);
  return { pts, pos, col, n, vel: new Float32Array(n * 3), life: new Float32Array(n), max: new Float32Array(n), base: new Float32Array(n * 3), grow: new Float32Array(n), next: 0 };
}
const smoke = particles(1400, 4, THREE.NormalBlending, 0.55);
const fx = new Effects(scene, (x, z) => field.at(x, z));                 // crashes, wreck fires, splashes, balloon pops
const birds = new Birds(scene, field, fx);                                  // geese, gulls, hawks, pigeons - a bird strike brings the aircraft down
const birdPl = { pos: null, vel: null, wind: null };                       // what the birds see of the aircraft
// cannon rounds: hit trees / buildings / the playground / the ground / the sea / balloons (free flight) / other pilots
/** Inside an airfield's (war) or a carrier's shield: guns and missiles die there, only bombs go through. */
const inAnyShield = (x, y, z) => mapId === 'war' ? !!W.shieldAt(x, y, z) : mapId === 'carrier' ? !!CW.shieldAt(x, y, z) : false;
const guns = new Guns(scene, fx, { ground: (x, z) => field.at(x, z), obstacle: solidAt, shield: inAnyShield,
  onStrike: (kind, p, mine) => { if (mapId === 'carrier' && /destroyer/.test(kind)) carrier.strafed(p, mine, myTeam()); },      // strafing the destroyer escort
  balloons: (p0, p1) => { if (mode !== 'free') return false; const ev = play.popAlong(p0, p1, 5.5, []); ev.forEach(onPlay); return ev.length > 0; } });
const missiles = new Missiles(scene, fx, { ground: (x, z) => field.at(x, z), shield: inAnyShield, audio, camera, onImpact: onMslImpact });

// ---------- bombs and persistent damage: shared/Damage.js + shared/Bombs.js, Craters.js (the craters) + Bombing.js (bombs, bombsight)
const DM = window.FSDamage, BM = window.FSBombs;
const craters = new Craters(scene, world, field, fx, {});
const localStore = new DM.DamageStore();                       // offline copy of the damage; once connected the server's list replaces it
let bombType = 'b500', bombsLeft = 0, bombRun = null, bombReady = false, bayPos = 0, rackPos = 0, rackRun = null, bombSeq = 0, damageEra = 0, sightOpen = false;
try { const t = localStorage.getItem('fsBomb'); if (BM.BOMBS[t]) bombType = t; } catch (e) {}
const bombEnv = { hull: (x, z) => mapId === 'carrier' && CW.bombEnv.hull(x, z), ground: (x, z) => mapId === 'carrier' ? CW.bombEnv.ground(x, z) : field.at(x, z), obstacle: (x, y, z) => solidAt(x, y, z), floorMax: 1760 };   // carrier map: a bomb bursts on a deck     // the highest peak is 1.7 km
const bombs = new BombFleet(scene, bombEnv, onBombImpact);
const myTeam = () => CP.PLANES[planeType] ? CP.PLANES[planeType].team : 0;
const carrier = new CarrierMap(scene, SUN, { say: (t, secs, c) => say(t, secs, c), audio: { click: () => audio.click(), boom: d => audio.boom(d), gun: () => audio.gun() }, camera, fx,
  targets: () => carrierTargets(), hurt: (n, by, how) => onAA({ n, by, how }), onDeck: p => CW.CARRIERS.some(c => CW.inDeck(c, p[0], p[2], 6)) && p[1] < CW.DECK.y + 12 });
function emit(sys, p, v, life, r, g, b) {
  const i = sys.next; sys.next = (i + 1) % sys.n;
  sys.pos.set(p, i * 3); sys.vel.set(v, i * 3); sys.life[i] = life; sys.max[i] = life; sys.base[i * 3] = r; sys.base[i * 3 + 1] = g; sys.base[i * 3 + 2] = b;
}
function stepParticles(sys, dt, rise) {
  for (let i = 0; i < sys.n; i++) {
    if (sys.life[i] <= 0) continue;
    sys.life[i] -= dt;
    if (sys.life[i] <= 0) { sys.pos[i * 3 + 1] = -1e5; continue; }
    sys.vel[i * 3 + 1] += rise * dt;
    const k = Math.pow(0.4, dt);
    for (let a = 0; a < 3; a++) { sys.vel[i * 3 + a] *= k; sys.pos[i * 3 + a] += sys.vel[i * 3 + a] * dt; }
    const f = sys.life[i] / sys.max[i];
    for (let a = 0; a < 3; a++) sys.col[i * 3 + a] = sys.base[i * 3 + a] * (0.4 + 0.6 * f);
  }
  sys.pts.geometry.attributes.position.needsUpdate = true; sys.pts.geometry.attributes.color.needsUpdate = true;
}
// wingtip vortex trails
const TRAIL = 90;
const trails = [-1, 1].map(() => {
  const pos = new Float32Array(TRAIL * 3), col = new Float32Array(TRAIL * 3);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  line.frustumCulled = false; scene.add(line);
  return { pos, col, line, pts: [] };
});
// crash debris (cannon-es)
const phys = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
let debris = [], groundBody = null;

// ---------- network: the shared sky (optional)
const net = { ws: null, open: false, id: 0, board: null, pilots: new Map(), others: new Map(), lastSend: 0, rtt: 0, admin: false, counts: null };
function wsUrl() { const q = new URLSearchParams(location.search).get('ws'); return q || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/game/flight-ws`; }
function connect() {
  if (net.ws) return;
  let ws;
  try { ws = new WebSocket(wsUrl()); } catch (e) { return; }
  net.ws = ws;
  ws.onopen = () => { net.open = true; ws.send(JSON.stringify({ t: 'hello', name: myName(), token: OIID.token, livery, plane: planeType, map: mapId })); };
  ws.onclose = () => { net.open = false; net.admin = false; updateAdmin(); updateChatBox(); net.ws = null; net.others.forEach(o => scene.remove(o.model.root)); net.others.clear(); setOnline(); setTimeout(() => { if (state !== 'menu' || true) connect(); }, 8000); };
  ws.onerror = () => {};
  ws.onmessage = e => {
    let m; try { m = JSON.parse(e.data); } catch (err) { return; }
    if (m.t === 'welcome') {
      net.id = m.id; net.board = m.board; renderBoard(); net.admin = !!m.admin; updateAdmin(); chatReset(m.chat || []);
      if (m.map && m.map !== mapId) { setMap(m.map, true); say(m.map === 'carrier' ? 'Carrier aircraft can only fly on the carrier map' : 'War aircraft can only fly on the war map', 4, '#ffc83a'); }
      if (m.round) { carrier.syncClock(m.round); carrier.onRound(m.round); }
      net.others.forEach(o => scene.remove(o.model.root)); net.others.clear();              // a new hello can mean a different sky
      if (m.dmg) loadDamage(m.dmg);
      setOnline();
    }
    else if (m.t === 'board') { net.board = m.board; renderBoard(); }
    else if (m.t === 'pilots') { net.pilots = new Map(m.list.map(p => [p.id, p])); net.counts = m.counts || null; setOnline(); }
    else if (m.t === 'sky') onSky(m);
    else if (m.t === 'raceResult' && m.ok && m.rank) $('resRank').textContent = `Leaderboard: #${m.rank}`;
    else if (m.t === 'landingResult' && m.rank) $('resRank').textContent = `Leaderboard: #${m.rank}`;
    else if (m.t === 'bumped' && !immune) forceCrash(`mid-air collision with ${m.name || 'another pilot'}`);
    else if (m.t === 'hit') onShot(m);
    else if (m.t === 'msl') onRemoteMissile(m);
    else if (m.t === 'mslEnd') onMissileVerdict(m);
    else if (m.t === 'boom') onBoom(m);
    else if (m.t === 'cdmg' && mapId === 'carrier') carrier.onCrashDmg(m, t => say(t, 2.5, '#ffd23a'), net.id || 0);
    else if (m.t === 'ddmg' && mapId === 'carrier') carrier.onEscortDmg(m, t => say(t, 2.5, '#ffd23a'), net.id || 0);
    else if (m.t === 'bomb') onRemoteBomb(m);
    else if (m.t === 'round') onCarrierRound(m);
    else if (m.t === 'fleet' && mapId === 'carrier') carrier.onFleet(m);
    else if (m.t === 'aa') onAA(m);
    else if (m.t === 'rearm') { rearm(); say('Rearmed and repaired by the deck crew', 2.5, '#7cff9a'); }
    else if (m.t === 'sortie') onSortie(m);
    else if (m.t === 'reset') onMapReset(m);
    else if (m.t === 'dmgSync') { loadDamage(m.dmg); say(m.why === 'auto' ? 'Ground crew has cleared the bomb marks off the runway' : m.why === 'repair' ? 'Ground crew filled in a runway crater' : 'Runway cleared of bomb marks by an admin', 5, '#7fd0ff'); }
    else if (m.t === 'chat') chatAdd(m.e);
    else if (m.t === 'chatDel') chatRemove(m.id);
    else if (m.t === 'chatErr') say(m.msg, 2, '#ffc83a');
    else if (m.t === 'error') $('netState').textContent = m.msg;
  };
}
/** The battle on the carrier map: a round is over (the loser sinks, results are shown) or a new one starts (everybody goes back to the menu to pick an aircraft). */
/** Carrier map, VETERAN: every safe landing on our own deck after hurting the enemy = +10 % bomb / torpedo damage (max +30 %), lost with the aircraft. */
const sortie = { vet: 0 };
function onSortie(m) {
  sortie.vet = Math.max(0, m.vet | 0);
  if (m.why === 'hit') later(() => say(`Direct hit on the board - ${m.total} in all${sortie.vet ? '' : ' · land back on your carrier to become a veteran (+10% bomb damage)'}`, 4, '#ffd23a'), 3200);
  else if (m.why === 'home' && m.vetUp) say(`Welcome home - VETERAN +${sortie.vet * 10}% bomb and torpedo damage${sortie.vet < 3 ? ' (next safe return: more)' : ' (maximum)'}`, 5, '#7cff9a');
  else if (m.why === 'lost') say(`${m.how === 'respawned' ? 'Left the aircraft' : m.how === 'changed sides' ? 'Changed sides' : 'Aircraft lost'} - veteran +${m.lostVet * 10}% gone. Land back on your carrier to earn it again`, 5, '#ff7a5a');
}
function onCarrierRound(m) {
  if (mapId !== 'carrier') return;
  const r = carrier.onRound(m);
  if (r === 'over' && state === 'flying') say('Round over', 3, '#ffd23a');
  if (r === 'start' && state !== 'menu') { state = 'menu'; showPanel('pMenu'); carrier.place(ac, myTeam(), (net.id || 0) % 9); }
}
function setOnline() {
  const n = [...net.pilots.keys()].length;
  $('netState').innerHTML = net.open ? `<span class="dot on"></span>${n} pilot${n === 1 ? '' : 's'} on the ${mapId} map` : '<span class="dot"></span>offline - flying solo';
  if (document.querySelector('[data-map]')) document.querySelectorAll('[data-map] .cnt').forEach(e => { const k = net.counts && net.counts[e.parentNode.parentNode.dataset.map]; e.textContent = net.open && k !== undefined && k !== null ? `${k} flying` : ''; });
}
function onSky(m) {
  const now = performance.now();
  const seen = new Set(), flags = new Map();
  for (let i = 0; m.fl && i < m.fl.length; i += 2) flags.set(m.fl[i], m.fl[i + 1]);
  for (let i = 0; i < m.p.length; i += 11) {
    const id = m.p[i];
    if (id === net.id) continue;
    seen.add(id);
    let o = net.others.get(id);
    const info = net.pilots.get(id) || { name: '?', livery: 0, plane: 'sport' };
    if (!o || o.livery !== info.livery || o.plane !== info.plane) {
      if (o) scene.remove(o.model.root);
      const model = makePlane(FP.TYPES[info.plane] ? info.plane : 'sport', info.livery, { cockpit: false });
      const c = document.createElement('canvas'); c.width = 256; c.height = 48; const g = c.getContext('2d');
      g.font = 'bold 28px Arial'; g.textAlign = 'center'; g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(0, 4, 256, 40); g.fillStyle = '#fff'; g.fillText(info.name, 128, 34);
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true, fog: false }));
      label.scale.set(10, 1.9, 1); label.position.y = 3.2; model.root.add(label);
      scene.add(model.root);
      o = { model, label, livery: info.livery, plane: info.plane, buf: [], name: info.name, dead: !!m.p[i + 10], prev: new THREE.Vector3(m.p[i + 1], m.p[i + 2], m.p[i + 3]),
            spawnT: now, gearPos: 1, brakePos: 0, gunAcc: 0 };
      net.others.set(id, o);
    }
    // a respawn (back from a crash, or a jump across the map): no collisions with it for a few seconds
    const last = o.buf[o.buf.length - 1];
    if (last && ((last.x && !m.p[i + 10]) || Math.hypot(m.p[i + 1] - last.p[0], m.p[i + 2] - last.p[1], m.p[i + 3] - last.p[2]) > 400)) { o.spawnT = now; o.model.missiles.forEach(x => (x.visible = true)); }
    o.mode = m.p[i + 9]; o.flags = flags.get(id) || 0;
    o.buf.push({ t: now, p: [m.p[i + 1], m.p[i + 2], m.p[i + 3]], q: [m.p[i + 4], m.p[i + 5], m.p[i + 6], m.p[i + 7]], e: m.p[i + 8], x: m.p[i + 10] });
    if (o.buf.length > 20) o.buf.shift();
  }
  for (const [id, o] of net.others) if (!seen.has(id) && now - (o.buf.length ? o.buf[o.buf.length - 1].t : 0) > 3000) { scene.remove(o.model.root); net.others.delete(id); }
}
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
function updateOthers(dt) {
  const t = performance.now() - 160;
  for (const o of net.others.values()) {
    const b = o.buf;
    if (!b.length) continue;
    let i = b.length - 1;
    while (i > 0 && b[i - 1].t > t) i--;
    const s1 = b[i], s0 = b[Math.max(0, i - 1)];
    const f = s1.t === s0.t ? 1 : Math.max(0, Math.min(1.5, (t - s0.t) / (s1.t - s0.t)));
    o.prev.copy(o.model.root.position);
    if (s1.x && !o.dead) remoteCrash(o, s0, s1);
    o.dead = !!s1.x;
    o.model.root.position.set(s0.p[0] + (s1.p[0] - s0.p[0]) * f, s0.p[1] + (s1.p[1] - s0.p[1]) * f, s0.p[2] + (s1.p[2] - s0.p[2]) * f);
    qa.set(...s0.q); qb.set(...s1.q); o.model.root.quaternion.copy(qa).slerp(qb, Math.min(1, f));
    o.model.root.visible = !s1.x;
    const vdt = Math.max(0.05, (s1.t - s0.t) / 1000);
    o.vel = s1 === s0 ? [0, 0, 0] : [(s1.p[0] - s0.p[0]) / vdt, (s1.p[1] - s0.p[1]) / vdt, (s1.p[2] - s0.p[2]) / vdt];
    if (Math.hypot(o.vel[0], o.vel[2]) > 3) o.hdg = Math.atan2(o.vel[0], -o.vel[2]);        // for the radar: the bearing it is flying (0 = north, clockwise)
    if (o.flags & 8 && !s1.x && (o.flareT = (o.flareT || 0) - dt) <= 0) {      // their flare dispensers (for show, and for our copy of missiles at them)
      o.flareT = 0.25;
      const q = o.model.root.quaternion, dn = new THREE.Vector3(0, -1, 0).applyQuaternion(q), rt = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      for (const sd of [-1, 1]) {
        const p = new THREE.Vector3(sd * 0.6, -0.9, 3.5).applyQuaternion(q).add(o.model.root.position).toArray();
        missiles.flare(p, [o.vel[0] + dn.x * 28 + rt.x * sd * 5, o.vel[1] + dn.y * 28 + rt.y * sd * 5, o.vel[2] + dn.z * 28 + rt.z * sd * 5], false);
      }
    } else if (!(o.flags & 8)) o.flareT = 0;
    o.gearPos = Math.max(0, Math.min(1, o.gearPos + (o.flags & 1 ? -dt : dt) / 4));
    o.brakePos = Math.max(0, Math.min(1, o.brakePos + (o.flags & 4 ? dt : -dt)));
    animatePlane(o.model, { aileronL: 0, aileronR: 0, elevator: 0, rudder: 0, flaps: 0 }, s1.e, dt, false, o.gearPos, o.brakePos);
    // their cannon: tracers from their gun port (only our own rounds can hit anyone - theirs are for show)
    const gun = (FP.TYPES[o.plane] || {}).gun;
    if (gun && o.flags & 2 && !s1.x) {
      const sdt = Math.max(0.05, (s1.t - s0.t) / 1000), vel = [(s1.p[0] - s0.p[0]) / sdt, (s1.p[1] - s0.p[1]) / sdt, (s1.p[2] - s0.p[2]) / sdt];
      const muzzles = gun.muzzles || [gun.muzzle], rp = o.model.root.position, fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(o.model.root.quaternion).toArray();
      for (o.gunAcc += dt * gun.rate; o.gunAcc >= 1; o.gunAcc--) {
        const mz = new THREE.Vector3(...muzzles[(o.gunIdx = (o.gunIdx || 0) + 1) % muzzles.length]).applyQuaternion(o.model.root.quaternion).add(rp).toArray();
        const d = gunDir(mz, rp.toArray(), fwd, gun);
        guns.shoot(mz, [vel[0] + d[0] * gun.speed, vel[1] + d[1] * gun.speed, vel[2] + d[2] * gun.speed], false);
      }
    } else o.gunAcc = 0;
    const tur = (FP.TYPES[o.plane] || {}).turrets;       // a B-29's turrets: tracers toward us when it is shooting and we are in range (our own rounds are the only ones that hurt)
    if (tur && o.flags & 2 && !s1.x && !ac.crashed && o.model.root.position.distanceTo(new THREE.Vector3(...ac.pos)) < tur.range) {
      const sdt = Math.max(0.05, (s1.t - s0.t) / 1000), vel = [(s1.p[0] - s0.p[0]) / sdt, (s1.p[1] - s0.p[1]) / sdt, (s1.p[2] - s0.p[2]) / sdt];
      for (o.turAcc = (o.turAcc || 0) + dt * tur.rate * 2; o.turAcc >= 1; o.turAcc--) {
        const mt = tur.mounts[(o.turIdx = (o.turIdx || 0) + 1) % tur.mounts.length], mz = new THREE.Vector3(...mt.r).applyQuaternion(o.model.root.quaternion).add(o.model.root.position).toArray();
        const d = leadDir(mz, vel, tur.speed, ac.pos, ac.vel);
        guns.shoot(mz, [vel[0] + (d[0] + (Math.random() - 0.5) * tur.spread) * tur.speed, vel[1] + (d[1] + (Math.random() - 0.5) * tur.spread) * tur.speed, vel[2] + (d[2] + (Math.random() - 0.5) * tur.spread) * tur.speed], false);
      }
    } else o.turAcc = 0;
    const d = o.model.root.position.distanceTo(camera.position);
    o.label.scale.set(Math.max(10, d * 0.035), Math.max(1.9, d * 0.0066), 1);
  }
}
/** Another pilot crashed (their browser says so): the same explosion here, and their wreck burns. */
const FUEL = { trainer: 0.5, sport: 0.7, warbird: 1.1, jet: 1.6, a10: 1.4, seaplane: 0.8, b29: 3.2 };
function remoteCrash(o, s0, s1) {
  const p = o.model.root.position, dt = Math.max(0.05, (s1.t - s0.t) / 1000);
  const v = [(s1.p[0] - s0.p[0]) / dt, (s1.p[1] - s0.p[1]) / dt, (s1.p[2] - s0.p[2]) / dt];
  const gh = mapId === 'carrier' && CW.deckAt(p.x, p.y, p.z) !== null ? CW.DECK.y : field.at(p.x, p.z), water = gh < 0.2 && p.y < 4;
  if (p.distanceTo(camera.position) > 6000) return;
  if (simTime - lastSplashT > 4) {                          // did our bomb or cannon do it?
    const b = lastBoom, bomb = b && simTime - b.t < 4 && Math.hypot(p.x - b.p[0], p.y - b.p[1], p.z - b.p[2]) < b.rk * 1.5;
    if (bomb) say(`${o.name} killed by your bomb!`, 3, '#7cff9a');
    else if (simTime - lastFireT < 2.5 && p.distanceTo(camera.position) < 1500) say(`You shot down ${o.name}!`, 3, '#7cff9a');
  }
  fx.explode([p.x, p.y, p.z], v, { violence: Math.min(1, Math.hypot(...v) / 60), fuel: FUEL[o.plane] || 1, water });
  if (!water) fx.wreckFire([p.x, Math.max(0, gh), p.z], { scale: 0.6, secs: 30, light: false });
}
function sendState() {
  if (!net.open || performance.now() - net.lastSend < 100) return;
  net.lastSend = performance.now();
  net.ws.send(JSON.stringify({ t: 'st', p: ac.pos.map(v => Math.round(v * 10) / 10), q: ac.q.map(v => Math.round(v * 1000) / 1000), e: Math.round(ac.engine * 100) / 100, m: mode, x: ac.crashed ? 1 : 0,
    fl: (ac.ctl.gear === 0 ? 1 : 0) | (gun.firing || turret.firing ? 2 : 0) | (ac.ctl.airbrake ? 4 : 0) | (msl.prog > 0 ? 8 : 0) | (immune ? 16 : 0) | (ac.onGround ? 64 : 0), s: Math.round(ac.speed * 10) / 10 }));
}

// ---------- game state
let state = 'menu', mode = 'free', camMode = 0, paused = false;
const CAMS = ['chase', 'cockpit', 'fly-by'];
let race = null, landing = null, aero = null, message = null, maxG = 1, crashT = 0, flyby = null;
let simTime = 0, startT = 0, flightId = 0;
/** Run fn after ms - unless a new flight has started meanwhile (a crash's result screen must not pop up over the next flight). */
function later(fn, ms) { const id = flightId; setTimeout(() => { if (id === flightId) fn(); }, ms); }

// one name for every game: the portal identity (identity.js); the token proves it to the server
function myName() { return OIID.name || 'Pilot'; }
function say(text, secs = 2.5, color) { message = { text, until: simTime + secs, color }; }

function start(m) {
  if (mapId === 'carrier') m = 'free';                                          // the carrier map is free flight: no landing practice or ring race out there
  if (m === 'race' && ac.spec.noRace) { m = 'free'; menuMode = 'free'; }       // a heavy bomber is not built for the ring race
  mode = m; state = 'flying'; paused = false; maxG = 1; crashT = 0; flyby = null; startT = simTime; flightId++;
  immune = immuneOpt && m === 'land';
  ac.heatScale = m === 'race' ? 1 / 8 : 1;                 // the ring race can be flown at full throttle (or afterburner) start to finish
  shield.field = null; shield.grace = simTime + 6;         // a few seconds of protection after every (re)start
  clearCrash();
  bombs.clear(); bombRun = null; bombReady = false; bayPos = 0; rackPos = 0; rackRun = null; sightOpen = false; sight.close();
  bombsLeft = hasBombs() ? (rackCount() || BM.BOMBS[curBomb()].count) : 0; ac.setPayload(bombsLeft * (BM.BOMBS[curBomb()] || { mass: 0 }).mass);
  guns.clear(); damage = { n: 0, by: '' }; gun.heat = 0; gun.jam = false; gun.warned = false; gun.ammo = ac.spec.gun ? ac.spec.gun.ammo : 0; gun.acc = 0; gun.firing = false;
  turret.ammo = ac.spec.turrets ? ac.spec.turrets.ammo : 0; turret.acc = []; turret.firing = false; turret.target = null;
  Object.assign(msl, { sel: 'aim9', used: {}, left: (ac.spec.missiles || []).length, flares: ac.spec.flares || 0, lock: null, dlz: null, prog: 0, progT: 0, lastLaunch: -9 });
  play.reset(m === 'free');
  if (plane.broken) { scene.remove(plane.root); plane = makePlane(planeType, livery); scene.add(plane.root); }
  plane.root.visible = true;
  plane.missiles.forEach(x => (x.visible = true));
  ac.wind = [0, 0, 0]; ac.gust = 0.3;
  race = null; landing = null; aero = { rec: new AR.Recognizer(), count: 0 };
  if (m === 'free' && mapId === 'carrier') {
    carrier.place(ac, myTeam(), (net.id || 0) % 9);                                  // on the deck, behind the catapult mark
    carrier.clearAA(); $('cwResult').classList.remove('on');
    say(`${ac.spec.name} on the deck - full throttle (R) for the catapult launch${ac.spec.bombRack ? ' · N = bomb' : ''}${ac.spec.airbrake ? ' · Z = dive brakes' : ''} · land with gear, flaps and hook (H)`, 6, '#ffd23a');
  } else if (m === 'free') {
    ac.reset({ ...freeSpot(), yaw: 0, onGround: true, throttle: 0, flaps: ac.spec.floats ? 1 : 0 });   // floatplanes take off with flaps
    const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 3; ac.wind = [-Math.sin(a) * s, 0, Math.cos(a) * s];
    say(ac.spec.floats ? 'Free flight from the sea lane · flaps 20° · R = full throttle · at ~55 kt ease back (S), let go once airborne'
        : `Free flight · R = throttle up · S = pull to take off${ac.spec.retract ? ' · U = gear up' : ''}${ac.spec.tailwheel ? ' · W lifts the tail first' : ''}${ac.spec.gun && !ac.spec.bomber ? ' · Space = guns' : ''}${ac.spec.bombRack ? (ac.spec.bombRack.pylon ? ' · N = drop a bomb' : ' · N = drop the bomb (dive!)') : ''}${ac.spec.missiles ? ' · H = missile · Y = missile type · J = flares' : ''}${ac.spec.bomber ? ' · Space = nose guns · N = bombsight · V = flaps · weapons cannot hurt you for 30 s' : ''}`, 6);
    { const r = runwayInfo(); if (r.craters) say(`Runway damaged: ${r.clear} m clear of ${r.length} m (${r.pct}%)${ac.spec.bomber ? ' - this load needs about ' + Math.round(takeoffRoll(ac.spec, ac.payload)) + ' m' : ''}`, 7, '#ffc83a'); }
  } else if (m === 'land') {
    const D = 2600 + Math.random() * 600, off = (Math.random() - 0.5) * 120;
    const windFrom = Math.random() * Math.PI * 2, ws = 2 + Math.random() * 7;
    ac.wind = [-Math.sin(windFrom) * ws, 0, Math.cos(windFrom) * ws]; ac.gust = 0.4 + Math.random() * 1.6;
    const sp = ac.spec.spawn.land;
    ac.reset({ x: strip().x + off, y: strip().elev + ac.spec.restHeight + (D + 300) * Math.tan(3 * DEG) + (Math.random() - 0.5) * 30, z: strip().z0 + D, yaw: (Math.random() - 0.5) * 0.1,
               pitch: 0.02, speed: sp.speed, throttle: sp.throttle, flaps: sp.flaps });
    landing = { touch: null, bounces: 0, airAfter: 0, offRunway: false, done: false, windFrom, windSpeed: ws };
    say(`Precision landing · ${ac.spec.floats ? 'sea lane (land between the buoys)' : airfield === 'isle' ? 'Cinder Cay dirt strip' : 'runway 36'} · wind ${String(Math.round(((windFrom / DEG) % 360 + 360) % 360)).padStart(3, '0')}° at ${Math.round(ws * KT)} kt`, 5);
  } else if (m === 'race') {
    const s = W.COURSE_START;
    const lane = raceSlot();                                  // racers who start together line up side by side, 25 m apart
    ac.reset({ x: s.x + Math.cos(s.yaw) * lane, y: s.y, z: s.z - Math.sin(s.yaw) * lane, yaw: s.yaw, speed: ac.spec.spawn.race.speed, throttle: ac.spec.spawn.race.throttle, flaps: 0, gear: 0 });
    race = { next: 0, time: 0, splits: [], done: false, best: bestSplits() };
    say(`Ring race · fly through the yellow ring · ${W.COURSE.length} gates`, 4);
  }
  ctl.sync(ac);
  birds.reset(birdView());
  world.setRace(m === 'race', 0);
  hideOverlay();
  ctl.active = true;
  audio.unlock();
  renderAeroList();
}

/**
 * A parking spot at the threshold that no other pilot is on. Pilots who start at the same moment cannot
 * see each other yet, so each begins its search at a different slot (from its connection id).
 */
function freeSpot() {
  const R = strip(), big = ac.spec.bomber, lanes = big ? [0] : ac.spec.floats ? [-21, 21] : [-7, 7], rad = big ? 55 : 35, slots = [];
  for (let dz = big ? -50 : -30; dz > -R.length + 60; dz -= big ? 90 : 45) for (const dx of lanes) slots.push({ x: R.x + dx, z: R.z0 + dz });
  for (let dz = 70; dz <= 450; dz += 70) slots.push({ x: R.x, z: R.z0 + dz });          // craters everywhere on the strip: the flat ground beyond the threshold
  // never spawn in (or next to) a crater: a bomb hole under the wheels would break the gear or flip the aircraft
  const dist = sl => craters.dmg.list.reduce((m, c) => Math.min(m, Math.hypot(c.x - sl.x, c.z - sl.z) - c.Ri), 1e9);
  let ok = slots.filter(sl => dist(sl) > rad - 10 && !craters.dmg.nearCrater(sl.x, sl.z, rad));
  if (!ok.length) ok = [slots.reduce((b, sl) => (dist(sl) > dist(b) ? sl : b), slots[0])];     // the least bad place
  ok = ok.slice(0, 6);                                                                     // the ones nearest the threshold
  const k0 = (net.id * 5) % ok.length;
  for (let k = 0; k < ok.length; k++) {
    const sl = ok[(k0 + k) % ok.length];
    const taken = [...net.others.values()].some(o => { if (o.dead || !o.buf.length) return false; const b = o.buf[o.buf.length - 1].p; return Math.hypot(b[0] - sl.x, b[2] - sl.z) < 30; });
    if (!taken) return sl;
  }
  return ok[k0];
}
/** Sideways offset (m) for the ring-race start so racers who start together are not drawn inside each other. */
function raceSlot() { return (((net.id || 0) % 7) - 3) * 25; }
/** Where this aircraft takes off and lands: the runway, or the buoyed sea lane for the floatplane. */
function strip() { return ac.spec.floats ? W.SEALANE : airfield === 'isle' ? W.AIRSTRIP : W.RUNWAY; }
/** Which airfield the menu has picked: the paved runway on the main island, or Cinder Cay's dirt strip (the floatplane always uses the sea lane). */
let airfield = 'main';
try { if (localStorage.getItem('fsField') === 'isle') airfield = 'isle'; } catch (e) {}
const rwName = () => airfield === 'isle' ? 'Cinder Cay dirt strip' : 'Runway 36';
function renderFieldPick() {
  const row = $('fieldRow'); if (!row) return;
  row.querySelectorAll('button').forEach(b => { b.classList.toggle('sel', b.dataset.f === airfield); b.onclick = () => { airfield = b.dataset.f; try { localStorage.setItem('fsField', airfield); } catch (e) {} renderFieldPick(); updateMenuInfo(); }; });
}
renderFieldPick();
/** A point (a wheel's contact patch) resting on top of one of the REX letters - not the pedestal. */
const onRex = p => play.obstacleAt(p[0], p[1] - 0.15, p[2]) === 'the REX statue';
function onStrip(x, z) { const R = strip(); return Math.abs(x - R.x) <= R.width / 2 && z <= R.z0 && z >= R.z1; }
function bestSplits() { try { return JSON.parse(localStorage.getItem('fsBestSplits_' + planeType) || 'null'); } catch (e) { return null; } }

// ---------- per-step game logic
const prevPos = new THREE.Vector3();
function birdView() { birdPl.pos = ac.pos; birdPl.vel = ac.vel; birdPl.wind = ac.wind; return birdPl; }
function gameStep() {
  const c = ctl.update(STEP);
  Object.assign(ac.ctl, c);
  prevPos.set(...ac.pos);
  const car = mapId === 'carrier', F = car ? carrier.before(ac) : 0;
  const events = ac.step(STEP);
  if (car) carrier.after(ac, F);
  simTime += STEP;
  shieldStep();
  fireGun();
  turretStep();
  seekerStep();
  flareStep();
  if (!ac.crashed && net.others.size) {
    const hit = midairHit();
    if (hit) {                                  // we both go down: the other pilot's browser is told to crash too
      ac.crash(`mid-air collision with ${hit.o.name}`);
      if (net.open) net.ws.send(JSON.stringify({ t: 'bump', id: hit.id }));
    }
  }
  if (!ac.crashed && hasBombs()) bombStep(); else if (ac.crashed) { bombRun = null; rackRun = null; }
  if (!ac.crashed && !car) {
    birds.update(STEP, birdView());
    // every bird is solid, in every mode - not in the first seconds of a flight, and not while taxiing
    if (!immune && simTime - startT >= 5 && !(ac.onGround && ac.speed < 15)) {
      const why = birds.strike([prevPos.x, prevPos.y, prevPos.z], ac.pos, ac.q, ac.spec);
      if (why) { ac.crash(why); audio.burst(0.15, { freq: 900, to: 200, q: 1, vol: 0.5 }); }
    }
  }
  for (const e of events) {
    if (e.type === 'touch') {
      audio.touchdown(e.vs);
      if (e.surface === 'water') for (let k = 0; k < Math.min(70, 20 + e.vs * 15); k++)
        fx.smoke.emit({ p: [e.pos[0], 0.2, e.pos[2]], v: [(Math.random() - 0.5) * 7 + ac.vel[0] * 0.35, 2 + Math.random() * 3 * (1 + e.vs), (Math.random() - 0.5) * 7 + ac.vel[2] * 0.35], life: 1 + Math.random(),
                        size: [1, 3 + e.vs], c0: [0.96, 0.98, 1], c1: [0.9, 0.93, 0.96], a: 0.8, fadeIn: 0.02, drag: 0.5, acc: -9.8, land: true, spin: 1 });
      else for (let k = 0; k < Math.min(26, 6 + e.vs * 10); k++) emit(smoke, e.pos, [(Math.random() - 0.5) * 3, 0.5 + Math.random(), (Math.random() - 0.5) * 3 + ac.vel[2] * 0.2], 1.6 + Math.random(), 0.85, 0.85, 0.85);
      if (car) carrier.onTouch(ac, e, myTeam()); else onTouchdown(e);
    } else if (e.type === 'scrape') {
      for (let k = 0; k < 18; k++) fx.spark.emit({ p: e.pos, v: [(Math.random() - 0.5) * 6 + ac.vel[0] * 0.6, Math.random() * 3, (Math.random() - 0.5) * 6 + ac.vel[2] * 0.6], life: 0.4 + Math.random() * 0.5, size: [0.35, 0.15], c0: [3, 2.2, 1], c1: [1.5, 0.5, 0.05], a: 1, fadeIn: 0.01, drag: 1, acc: -9.8, land: true });
      audio.burst(0.3, { freq: 3000, to: 1200, q: 3, vol: 0.25 });
      say('Tail strike! Less flare', 1.5, '#ffc83a');
    } else if (e.type === 'warn') { say(e.text, 2.5, '#ffc83a'); audio.burst(0.12, { freq: 1500, to: 1500, q: 8, vol: 0.2 }); }
    else if (e.type === 'fail') { say(e.text, 5, '#ff4a3a'); audio.hit(); }
    else if (e.type === 'repair') { say(e.text, 3, '#7cff9a'); gun.heat = 0; gun.jam = false; }
    else if (e.type === 'crash') onCrash(e);
  }
  if (ac.crashed) return;
  maxG = Math.max(maxG, ac.g);
  if (car) {
    if (carrier.deckStep(ac, myTeam(), () => bombsLeft < (rackCount() || (hasBombs() ? BM.BOMBS[curBomb()].count : 0)) || damage.n > 0 || (ac.spec.gun && gun.ammo < ac.spec.gun.ammo))) { rearm(); say('Rearmed and repaired by the deck crew', 2.5, '#7cff9a'); }
    if (carrier.boundsStep(ac)) forceCrash('ran out of fuel far from the fleet');
    return;
  }
  if (race && !race.done) raceStep();
  if (landing && !landing.done) landingStep();
  if (mode === 'free') { aerobatics(); for (const e of play.step([prevPos.x, prevPos.y, prevPos.z], ac.pos, Math.abs(ac.spec.hardpoints[0][0]))) onPlay(e); }
}

/**
 * Mid-air collision with another pilot (as drawn here): over this frame's motion, is any of our extreme
 * points (wingtips, mid-wings, nose, tail, belly, fin, CG) inside their airframe's box, or theirs in ours?
 */
const boxes = new Map(), qOther = new THREE.Quaternion(), qOtherInv = new THREE.Quaternion(), qMeInv = new THREE.Quaternion(), tv = new THREE.Vector3(), tc = new THREE.Vector3(), to = new THREE.Vector3();
function airframe(spec) {
  if (!boxes.has(spec)) {
    const pts = [[0, 0, 0], ...spec.hardpoints, ...spec.hardpoints.slice(0, 2).map(h => [h[0] / 2, h[1], h[2]])];
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const p of [...pts, ...spec.wheels.map(w => w.r)]) for (let a = 0; a < 3; a++) { b[a] = Math.min(b[a], p[a] - 0.4); b[a + 3] = Math.max(b[a + 3], p[a] + 0.4); }
    boxes.set(spec, { pts, b });
  }
  return boxes.get(spec);
}
const inBox = (b, v) => v.x > b[0] && v.x < b[3] && v.y > b[1] && v.y < b[4] && v.z > b[2] && v.z < b[5];
function midairHit() {
  // every pilot is solid, in every mode - but never in the first seconds after either of us appears,
  // and not while we sit on the ground
  if (immune || simTime - startT < 5 || (ac.onGround && ac.speed < 15)) return null;
  const now = performance.now();
  const me = airframe(ac.spec);
  planeQ.set(...ac.q); qMeInv.copy(planeQ).invert();
  for (const [id, o] of net.others) {
    if (o.dead || !o.model.root.visible || !o.buf.length || now - o.spawnT < 5000 || o.flags & 16) continue;
    const op = o.model.root.position;
    if (shield.field && (ac.onGround || o.flags & 64) && W.shieldAt(op.x, op.y, op.z)) continue;      // on an airfield with someone parked or taxiing: nobody rams anybody
    if (Math.hypot(op.x - ac.pos[0], op.y - ac.pos[1], op.z - ac.pos[2]) > 60) continue;
    const them = airframe(FP.TYPES[o.plane] || FP.TYPES.sport);
    qOther.copy(o.model.root.quaternion); qOtherInv.copy(qOther).invert();
    for (let k = 1; k <= 4; k++) {
      tc.copy(prevPos).lerp(tv.set(...ac.pos), k / 4);         // our CG and theirs, swept over the frame
      to.copy(o.prev).lerp(op, k / 4);
      for (const h of me.pts) { tv.set(...h).applyQuaternion(planeQ).add(tc).sub(to).applyQuaternion(qOtherInv); if (inBox(them.b, tv)) return { id, o }; }
      for (const h of them.pts) { tv.set(...h).applyQuaternion(qOther).add(to).sub(tc).applyQuaternion(qMeInv); if (inBox(me.b, tv)) return { id, o }; }
    }
  }
  return null;
}
// ---------- guns (Falcon cannon, Warbird six .50 cal): Space or the left mouse button; hit any other pilot, in any mode
const turret = { ammo: 0, acc: [], firing: false, target: null, msgT: -9, dir: new THREE.Vector3(), q: new THREE.Quaternion(), tp: new THREE.Vector3() };
const gun = { ammo: 0, acc: 0, idx: 0, firing: false, mouse: false, hits: new Map(), lastSend: 0 };
let damage = { n: 0, by: '' };
canvas.addEventListener('mousedown', e => { if (e.button === 0) gun.mouse = true; });
addEventListener('mouseup', e => { if (e.button === 0) gun.mouse = false; });
/** Where to aim a round (muzzle speed `speed` on top of our own velocity) to meet a target at tp moving at tv: lead + gravity drop. */
function leadDir(m, ownV, speed, tp, tv) {
  let t = Math.hypot(tp[0] - m[0], tp[1] - m[1], tp[2] - m[2]) / speed, a = tp;
  for (let k = 0; k < 3; k++) {
    a = [tp[0] + (tv[0] - ownV[0]) * t, tp[1] + (tv[1] - ownV[1]) * t + 4.9 * t * t, tp[2] + (tv[2] - ownV[2]) * t];
    t = Math.hypot(a[0] - m[0], a[1] - m[1], a[2] - m[2]) / speed;
  }
  const l = Math.hypot(a[0] - m[0], a[1] - m[1], a[2] - m[2]) || 1;
  return [(a[0] - m[0]) / l, (a[1] - m[1]) / l, (a[2] - m[2]) / l];
}
const armedType = id => { const T = FP.TYPES[id]; return !!(T && (T.gun || T.missiles || T.turrets)); };
/**
 * The B-29's defensive turrets (no pilot input): every mount that has an armed aircraft - one with guns, missiles or
 * turrets of its own - inside its range and firing arc (top / belly / tail) opens fire on the nearest one, with
 * lead. They use the same rounds and hit reports as the other guns. Silent in immune mode, on the ground, or when empty.
 */
function turretStep() {
  const T = ac.spec.turrets;
  if (!T) return;
  turret.firing = false;
  if (ac.crashed || ac.onGround || weaponsHold() || turret.ammo <= 0) { turret.target = null; return; }
  const cands = [];
  for (const o of net.others.values()) if (!o.dead && o.model.root.visible && o.buf.length && !(o.flags & 48) && armedType(o.plane)) cands.push(o);
  turret.q.set(...ac.q).invert();
  let engaged = null;
  T.mounts.forEach((mt, i) => {
    let best = null, bd = T.range;
    const m = ac.worldPoint(mt.r);
    for (const o of cands) {
      const p = o.model.root.position, d = Math.hypot(p.x - m[0], p.y - m[1], p.z - m[2]);
      if (d >= bd) continue;
      turret.dir.set(p.x - m[0], p.y - m[1], p.z - m[2]).normalize().applyQuaternion(turret.q);       // the bearing in body axes
      const u = turret.dir, ok = mt.arc === 'top' ? u.y > 0.05 : mt.arc === 'bottom' ? u.y < -0.05 : u.z > 0.5;
      if (ok) { best = o; bd = d; }
    }
    if (!best) { turret.acc[i] = 0; return; }
    engaged = engaged || best;
    const p = best.model.root.position, tv = best.vel || [0, 0, 0];
    for (turret.acc[i] = (turret.acc[i] || 0) + STEP * T.rate; turret.acc[i] >= 1 && turret.ammo > 0; turret.acc[i]--, turret.ammo--) {
      const d = leadDir(m, ac.vel, T.speed, [p.x, p.y, p.z], tv);
      guns.shoot(m, [ac.vel[0] + (d[0] + (Math.random() - 0.5) * T.spread) * T.speed, ac.vel[1] + (d[1] + (Math.random() - 0.5) * T.spread) * T.speed, ac.vel[2] + (d[2] + (Math.random() - 0.5) * T.spread) * T.speed], true);
      turret.firing = true; shield.grace = 0;
      if (turret.ammo % 5 === 0) audio.gun();
    }
  });
  if (engaged !== turret.target) { turret.target = engaged; if (engaged && simTime - turret.msgT > 4) { turret.msgT = simTime; say(`Turrets engaging ${engaged.name}`, 1.6, '#ffc83a'); } }
}
let lastFireT = -99, lastBoom = null, lastSplashT = -99;
function fireGun() {
  const G = ac.spec.gun;
  const trigger = G && !ac.crashed && !ac.onGround && (ctl.keys.Space || gun.mouse);
  if (trigger && weaponsHold() && !(message && simTime < message.until)) say(`Weapons safe - ${holdWhy()}`, 1.5, '#7cff9a');
  if (gun.jam && trigger && !weaponsHold() && gun.ammo > 0 && simTime - (gun.jamSaid || -9) > 2) { gun.jamSaid = simTime; say('GUN JAMMED - overheated', 1.5, '#ff4a3a'); }
  gun.firing = !!(trigger && !weaponsHold() && gun.ammo > 0 && !gun.jam);
  if (!gun.firing) gun.heat = Math.max(0, (gun.heat || 0) - STEP / 12);                // a cooling barrel
  if (gun.firing) lastFireT = simTime;
  if (!gun.firing) { gun.acc = 0; return; }
  shield.grace = 0;                                            // shooting ends the protection you had for leaving the shield
  const fwd = ac.attitude.fwd, muzzles = G.muzzles || [G.muzzle];
  for (gun.acc += STEP * G.rate; gun.acc >= 1 && gun.ammo > 0; gun.acc--, gun.ammo--) {
    gun.heat = (gun.heat || 0) + 1 / (G.rate * 16);                                       // about 16 s of continuous fire
    if (gun.heat > 0.75 && !gun.warned) { gun.warned = true; say('GUN OVERHEATING - release the trigger', 2, '#ffc83a'); } else if (gun.heat < 0.4) gun.warned = false;
    if (gun.heat >= 1) { gun.jam = true; say('GUN FAILURE - jammed, overheated', 4, '#ff4a3a'); audio.hit(); gun.firing = false; break; }
    const m = ac.worldPoint(muzzles[gun.idx++ % muzzles.length]);
    const d = gunDir(m, ac.pos, fwd, G);
    guns.shoot(m, [ac.vel[0] + d[0] * G.speed, ac.vel[1] + d[1] * G.speed, ac.vel[2] + d[2] * G.speed], true);
    audio.gun();
  }
}
/** Where a round leaves a muzzle: along the nose, or - wing guns - toward the convergence point ahead; plus dispersion. */
function gunDir(m, cg, fwd, G) {
  let d = fwd;
  if (G.converge) { const t = [cg[0] + fwd[0] * G.converge - m[0], cg[1] + fwd[1] * G.converge - m[1], cg[2] + fwd[2] * G.converge - m[2]], l = Math.hypot(...t); d = [t[0] / l, t[1] / l, t[2] / l]; }
  return [d[0] + (Math.random() - 0.5) * G.spread, d[1] + (Math.random() - 0.5) * G.spread, d[2] + (Math.random() - 0.5) * G.spread];
}
/** Rounds in flight; our hits on other pilots (any mode) are reported to the server (their browser takes the damage). */
function updateGuns(dt) {
  const targets = [];
  for (const [id, o] of net.others) {
    if (o.dead || !o.model.root.visible || o.flags & 48) continue;     // immune or shielded pilots: rounds pass through
    targets.push({ id, pos: o.model.root.position, q: o.model.root.quaternion, box: airframe(FP.TYPES[o.plane] || FP.TYPES.sport).b, o });
  }
  for (const h of guns.update(dt, targets)) {
    gun.hits.set(h.id, (gun.hits.get(h.id) || 0) + ((ac.spec.gun && ac.spec.gun.dmg) || 1));
    const o = net.others.get(h.id);
    if (o && !o.hitSaid) { o.hitSaid = true; say(`Hit ${o.name}!`, 1.2, '#ffc83a'); setTimeout(() => { o.hitSaid = false; }, 1200); }
  }
  if (gun.hits.size && net.open && performance.now() - gun.lastSend > 100) {
    gun.lastSend = performance.now();
    for (const [id, n] of gun.hits) net.ws.send(JSON.stringify({ t: 'hit', id, n: Math.min(24, n) }));
    gun.hits.clear();
  }
}
/** The B-29 cannot be hurt by weapons (guns, AIM-9s, bomb blasts) for its first 30 s of flight. */
const PROTECT_S = 30;
const spawnProt = () => !!ac.spec.bomber && state !== 'menu' && simTime - startT < PROTECT_S;
const protectedNow = () => state !== 'menu' && (spawnProt() || (mapId === 'war' && (!!shield.field || simTime < shield.grace)) || (mapId === 'carrier' && !!shield.field));
/** Weapons are safe: immune mode, or inside an airfield's shield (nobody fires from the airfield). */
const weaponsHold = () => immune || mapId === 'peace' || (mapId === 'war' && !!shield.field) || (mapId === 'carrier' && carrier.inOwnShield(ac, myTeam()));
const holdWhy = () => immune ? 'immune mode' : mapId === 'peace' ? 'peace map' : mapId === 'carrier' ? 'carrier shield' : 'airbase shield';
/** Which airfield's shield are we in? Enter / leave messages; the protection outlasts the shield by W.SHIELD.grace seconds. */
function shieldStep() {
  if (mapId === 'carrier') {                                       // any carrier's shield covers whoever is inside (guns do nothing, bombs go through)
    shield.field = ac.crashed || state === 'menu' ? null : carrier.shieldAt(ac);
    return;
  }
  if (mapId !== 'war' || ac.crashed || state === 'menu') { shield.field = null; return; }
  const f = W.shieldAt(ac.pos[0], ac.pos[1], ac.pos[2]);
  if (!f && shield.field) shield.grace = simTime + W.SHIELD.grace;      // protection only after leaving; fire from outside goes through the shield
  if (simTime - startT > 2) {
    if (f && !shield.field) say(`${f.name} shield - weapons safe, only bombs get through`, 3, '#7fd0ff');
    else if (!f && shield.field) say(`Left the shield - protected for ${W.SHIELD.grace} s, weapons live`, 3, '#ffc83a');
  }
  shield.field = f;
}
/** Someone's cannon hit us: smoke at 4 hits, fire at 8, and at 12 we are shot down. */
function onShot(m) {
  if (immune || protectedNow() || ac.crashed || (state !== 'flying' && state !== 'paused')) return;
  damage.n += m.n * (ac.spec.hitScale || 1); damage.by = m.name || 'another pilot';       // the carrier aircraft differ in toughness (Zero 9 hits, Hellcat 16)
  audio.hit();
  say(damage.n >= 8 ? `On fire! Hit by ${damage.by}` : `Hit by ${damage.by}!`, 1.5, '#ff6a4a');
  if (damage.n >= 12) forceCrash(`shot down by ${damage.by}`);
}

/** The enemy carrier's AA (the server counts the seconds we spend inside its shield): it ignores the shield protection. */
function onAA(m) {
  if (ac.crashed || state !== 'flying' || immune) return;
  carrier.aaWarn = 1.5;
  damage.n += (m.n || 1) * (ac.spec.flakScale || ac.spec.hitScale || 1); damage.by = m.by || 'carrier AA';      // flak toughness (CWPlanes flak), not the gun hp
  audio.hit(); say(m.how === 'close' ? 'Flak burst right on top of you!' : m.how === 'hit' ? 'Hit by AA shells!' : 'Flak!', 1.2, '#ff4a3a');
  if (damage.n >= 12) forceCrash(`shot down by ${damage.by}`);
}
/** Who the carriers' AA can shoot at: me (when flying) and every other pilot in the sky. */
function carrierTargets() {
  const out = [];
  if (state === 'flying' && !ac.crashed) out.push({ key: 'me', team: myTeam(), pos: ac.pos, mine: true });
  for (const [id, o] of net.others) if (!o.dead && o.model.root.visible && o.buf.length && !(o.flags & 64)) { const p = o.model.root.position; out.push({ key: id, team: (CP.PLANES[o.plane] || { team: 0 }).team, pos: [p.x, p.y, p.z], mine: false }); }
  return out;
}
/** The deck crew refilled the bombs, rounds and airframe (landed and stopped on the own deck). */
function rearm() {
  damage.n = 0; damage.by = ''; gun.ammo = ac.spec.gun ? ac.spec.gun.ammo : 0; gun.heat = 0; gun.jam = false;
  bombsLeft = hasBombs() ? (rackCount() || BM.BOMBS[curBomb()].count) : 0; ac.setPayload(bombsLeft * (BM.BOMBS[curBomb()] || { mass: 0 }).mass);
  if (plane.pylonBombs) plane.pylonBombs.forEach(b => (b.visible = true));
}
/** The other pilot hit us (their browser saw it first). */
function forceCrash(reason) {
  if (ac.crashed || (state !== 'flying' && state !== 'paused')) return;
  ac.crash(reason);
  onCrash(ac.events[ac.events.length - 1]);
}

// ---------- bombs, bombsight, craters
/** Bombs: the B-29's bay (bombsight, many bombs) or the Warbird's single bomb on a swing-arm rack (N releases it, no map). */
const hasBombs = () => !!(ac.spec.bomber || ac.spec.bombRack);
const curBomb = () => ac.spec.bombRack ? ac.spec.bombRack.type : bombType;
const rackCount = () => ac.spec.bombRack && ac.spec.bombRack.count || 0;           // the A-10 hangs several bombs on pylons, dropped one per press
/** Where the bomb leaves the aircraft: the bay, or the end of the swing arm at full swing (the rack throws it clear of the propeller arc). */
const bombOrigin = () => { const R = ac.spec.bombRack; if (R && R.pylon) return ac.worldPoint(R.pylons[(R.count - Math.max(1, bombsLeft)) % R.pylons.length]); return ac.worldPoint(R ? [0, R.pivot[1] - R.arm * Math.cos(R.swing), R.pivot[2] - R.arm * Math.sin(R.swing)] : ac.spec.bay.at); };
/** How the flight is changing (smoothed): turn rate of the ground track and the climb-rate change, to carry the aircraft on to the moment the bay doors are open. */
const trk = { hdg: null, rate: 0, vy: 0, ay: 0, gs: 0, ag: 0 };
function trackFlight(dt) {
  if (dt <= 0 || dt > 0.2 || ac.crashed) { trk.hdg = null; return; }
  const hdg = Math.atan2(ac.vel[0], -ac.vel[2]), k = 1 - Math.exp(-dt / 0.4);
  if (trk.hdg !== null) {
    let d = hdg - trk.hdg; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
    trk.rate += (d / dt - trk.rate) * k; trk.ay += ((ac.vel[1] - trk.vy) / dt - trk.ay) * k; trk.ag += ((Math.hypot(ac.vel[0], ac.vel[2]) - trk.gs) / dt - trk.ag) * k;
  }
  trk.hdg = hdg; trk.vy = ac.vel[1]; trk.gs = Math.hypot(ac.vel[0], ac.vel[2]);
}
/**
 * What the next bomb will leave with if the pilot presses DROP now: the doors take (0.98 - bayPos) of their travel before the first
 * release (as in bombStep), so the aircraft is carried on that long - along the present turn and climb - and the bay with it.
 * Returns {delay, pos, vel, bay} at the moment of release (the release also pushes the bomb down at 1.2 m/s).
 */
function releaseState() {
  const bay = bombOrigin(), vel = ac.vel.slice(), pos = ac.pos.slice();
  const delay = ac.spec.bay && !ac.spec.bombRack && !bombRun ? Math.max(0, (0.98 - bayPos) * ac.spec.bay.doorTime) : 0;
  let off = [bay[0] - pos[0], bay[1] - pos[1], bay[2] - pos[2]], t = 0;
  while (t < delay - 1e-9) {
    const h = Math.min(0.05, delay - t), a = trk.rate * h, c = Math.cos(a), sn = Math.sin(a);
    const rot = v => [v[0] * c - v[2] * sn, v[1], v[0] * sn + v[2] * c];           // a turn of the ground track by a (heading grows clockwise seen from above, x east, z south)
    const vh = rot(vel), g0 = Math.hypot(vh[0], vh[2]) || 1, g1 = Math.max(0, g0 + trk.ag * h); vel[0] = vh[0] * g1 / g0; vel[2] = vh[2] * g1 / g0; vel[1] += trk.ay * h;
    off = rot(off); for (let i = 0; i < 3; i++) pos[i] += vel[i] * h; t += h;
  }
  const down = FP.qrot(ac.q, [0, -1, 0]);
  return { delay, pos, vel: vel.map((v, i) => v + down[i] * 1.2), bay: pos.map((v, i) => v + off[i]) };
}
const sightState = () => { const R = releaseState(); return { pos: ac.pos.slice(), vel: ac.vel.slice(), wind: [ac.wind[0], ac.wind[2]], heading: ac.attitude.heading, bay: R.bay, relVel: R.vel, relPos: R.pos, delay: R.delay, type: bombType, left: bombsLeft, mass: bombsLeft * BM.BOMBS[bombType].mass }; };
const sight = new Bombsight({ field, world, craters, env: bombEnv, state: sightState,
  onDrop: n => startBombRun(n), onClose: () => { sightOpen = false; } });
/** N on the Warbird: swing the bomb out and let it go - no map, you aim with the impact marker (dive at the target and release). */
function dropRack() {
  if (state !== 'flying' || ac.crashed || rackRun) return;
  if (!bombsLeft) return say('Bomb already dropped', 1.6, '#ffc83a');
  if (weaponsHold()) return say(`Bombs safe - ${holdWhy()}`, 2, '#7cff9a');
  const R = ac.spec.bombRack;
  if (R.pylon) { if (simTime - R.last < 0.2) return; R.last = simTime; return releaseBomb(); }        // pylon: just let one go
  if (bombReady && rackPos >= 1) { rackRun = { dropped: true, back: simTime + 0.8 }; releaseBomb(); return; }      // the arm is already out: let go at once
  rackRun = { dropped: false, back: 0 };
}
/** O: get the bomb ready so that DROP (N) releases it at once - B-29: bay doors open; Warbird: swing arm out; A-10: pylons armed (they never had a delay). */
function toggleBombReady() {
  if (state !== 'flying' || ac.crashed || !hasBombs() || rackRun || bombRun) return;
  if (!bombsLeft) return say(ac.spec.bomber ? 'Bomb bay empty' : 'No bombs left', 1.6, '#ffc83a');
  bombReady = !bombReady;
  const R = ac.spec.bombRack;
  say(ac.spec.bomber ? (bombReady ? 'Bomb doors opening - DROP releases at once' : 'Bomb doors closing') : R.pylon ? (bombReady ? 'Bombs armed' : 'Bombs safe') : (bombReady ? 'Bomb swung out - N drops it at once' : 'Bomb rack retracting'), 2, bombReady ? '#ffd23a' : '#7cff9a');
}
function rackStep() {
  const R = ac.spec.bombRack;
  if (R.pylon) return;
  if (rackRun) {
    rackPos = Math.min(1, rackPos + STEP / R.time);
    if (rackPos >= 1 && !rackRun.dropped) { rackRun.dropped = true; rackRun.back = simTime + 0.8; if (bombsLeft && !weaponsHold()) releaseBomb(); }
    if (rackRun.dropped && simTime >= rackRun.back) rackRun = null;
  } else if (bombReady && bombsLeft) rackPos = Math.min(1, rackPos + STEP / R.time);
  else rackPos = Math.max(0, rackPos - STEP / (R.time * 2));
}
function openSight() {
  if (ac.spec.bombRack) return dropRack();
  if (!ac.spec.bomber || state !== 'flying' || ac.crashed || sightOpen) return;
  if (!bombsLeft) return say('Bomb bay empty', 1.6, '#ffc83a');
  if (weaponsHold()) return say(`Bombs safe - ${holdWhy()}`, 2, '#7cff9a');
  sightOpen = true; sight.open();       // the game keeps running: the map follows the aircraft and the predicted impact moves with it
}
/** The pilot pressed DROP in the sight: open the doors, then release n bombs one after the other (the stick), from wherever the aircraft is by then. */
function startBombRun(n) {
  n = Math.min(n | 0, bombsLeft);
  if (n <= 0 || bombRun || ac.crashed) return;
  bombRun = { left: n, next: 0, closeAt: Infinity };
  say(`Bomb doors opening - ${n} × ${BM.BOMBS[bombType].name}`, 2.5, '#ffd23a');
}
function bombStep() {
  if (ac.spec.bombRack) return rackStep();
  const door = ac.spec.bay.doorTime;
  if (bombRun) {
    bayPos = Math.min(1, bayPos + STEP / door);
    if (bayPos >= 0.98 && bombRun.left > 0 && simTime >= bombRun.next && !weaponsHold()) {
      releaseBomb(); bombRun.left--; bombRun.next = simTime + BM.BOMBS[bombType].spacing;
      if (!bombRun.left) bombRun.closeAt = simTime + 1.2;
    }
    if (bombRun.left <= 0 && simTime >= bombRun.closeAt) bombRun = null;
  } else if (bombReady) bayPos = Math.min(1, bayPos + STEP / door);
  else bayPos = Math.max(0, bayPos - STEP / door);
}
function releaseBomb() {
  const S = BM.BOMBS[curBomb()], down = FP.qrot(ac.q, [0, -1, 0]), fwd = ac.attitude.fwd, bay = bombOrigin(), k = ac.spec.bombRack && !ac.spec.bombRack.pylon ? 2.2 : 0;     // the swing arm also throws it forward
  const rel = { id: ++bombSeq, type: curBomb(), p: bay.map(v => Math.round(v * 10) / 10), v: ac.vel.map((v, i) => Math.round((v + down[i] * 1.2 + fwd[i] * k) * 100) / 100), wind: [ac.wind[0], ac.wind[2]].map(v => Math.round(v * 100) / 100), seed: (Math.random() * 2147483647) | 0 };
  bombs.launch({ ...rel, from: net.id || 0, mine: true, name: myName(), look: planeType });
  if (net.open) net.ws.send(JSON.stringify({ t: 'bomb', ...rel }));
  else if (mapId === 'carrier') carrier.offlineRelease(rel, myTeam());          // offline practice: the ships' lookouts here see it go
  bombsLeft--; ac.setPayload(bombsLeft * S.mass); shield.grace = 0;
  if (!bombsLeft) bombReady = false;
  audio.burst(0.12, { freq: 500, to: 180, q: 1, vol: 0.35 });
}
/** Our bomb reached the ground / the sea / a tree: tell the server, which makes the crater and tells everybody (offline: do it here). */
function onBombImpact(b, ev) {
  const p = ev.p.map(v => Math.round(v * 10) / 10);
  if (BM.BOMBS[b.type].torp && ev.kind !== 'hull') { say(ev.broke ? 'Torpedo broke up on entry - drop it lower (under ~100 m) and slower, wings level' : 'Torpedo missed - it has to run into the hull from the water', 2.5, '#ffc83a'); return; }
  if (net.open) net.ws.send(JSON.stringify({ t: 'impact', id: b.id, p, kind: ev.kind, armed: !!ev.armed }));
  else localBoom({ w: BM.BOMBS[b.type].w, p, kind: ev.kind, armed: ev.armed, seed: b.sim.seed, id: b.id });
}
/** One of our AIM-9s hit the ground (the Missiles module calls this once, for the pilot who fired it). */
function onMslImpact(e, ev) {
  const p = ev.p.map(v => Math.round(v * 10) / 10);
  if (net.open) net.ws.send(JSON.stringify({ t: 'mslImpact', mid: e.sim.mid, p, water: !!ev.water }));
  else localBoom({ w: 'msl', p, kind: ev.water ? 'water' : 'ground', armed: true, seed: (Math.random() * 2147483647) | 0, id: 0 });
}
/** No server: the same decision the server would make, on this machine only. */
function localBoom(r) {
  if (mapId === 'carrier') return onBoom({ t: 'boom', w: r.w, p: r.p, water: r.p[1] <= 5, from: 0, id: r.id, rec: null, dud: false, hit: -1, dmg: 0 });     // offline practice: no carrier damage
  const mat = r.kind === 'water' ? 'water' : DM.classify(r.p[0], r.p[2]), m = { t: 'boom', w: r.w, p: r.p, water: mat === 'water', from: 0, id: r.id, rec: null, dud: !r.armed };
  if (!m.water && r.armed) { const res = localStore.add(r.w, r.p[0], r.p[2], mat, r.seed); if (res) m.rec = res.rec; }
  onBoom(m);
}
/** An explosion (from the server, or localBoom): the blast, the crater, what it destroys, what it does to anyone close. */
/** How far a bomb's blast kills: the fireball the pilot sees (Craters.landBlast scale x ~8 m) - never farther than the flames and dust cloud reach. */
const blastRadius = ex => 8 * Math.min(6.5, 0.9 + 0.32 * Math.cbrt(ex));
function onBoom(m) {
  const wp = DM.WEAPONS[m.w];
  if (!wp || !Array.isArray(m.p)) return;
  const p = m.p, d = Math.hypot(p[0] - camera.position.x, p[1] - camera.position.y, p[2] - camera.position.z), mat = m.rec ? m.rec.mat : m.water ? 'water' : 'soil';
  bombs.settle(m.from, m.id);
  if (mapId === 'carrier') {                                       // the carrier map: no craters - the carrier is hit (or the sea), the blast still kills what is close
    carrier.onBoom(m, camera, fx, { boom: x => audio.boom(x) }, t => say(t, 2.5, '#ffd23a'), net.id || 0);
    if (m.from === (net.id || 0)) lastBoom = { t: simTime, p, rk: blastRadius(wp.ex) };
    if (!immune && !spawnProt() && !ac.crashed && (state === 'flying' || state === 'paused') && Math.hypot(ac.pos[0] - p[0], ac.pos[1] - p[1], ac.pos[2] - p[2]) < blastRadius(wp.ex)) forceCrash(`caught in the blast of a ${wp.name}`);
    return;
  }
  if (m.dud) { craters.missileBlast(p, 'soil'); audio.burst(0.3, { freq: 160, type: 'lowpass', vol: 0.4 }); return; }
  if (m.water) { if (m.w !== 'msl') craters.waterBlast(p, wp.ex); }                 // a missile's own splash is drawn by Missiles
  else if (m.w === 'msl') craters.missileBlast(p, mat);
  else craters.landBlast(p, wp.ex, mat);
  if (m.rec) craters.apply(m.rec, { fresh: true });
  if (m.w !== 'msl') audio.boom(d);
  if (m.from === (net.id || 0) && m.w !== 'msl') lastBoom = { t: simTime, p, rk: blastRadius(wp.ex) };
  if (m.w !== 'msl' && !immune && !spawnProt() && !ac.crashed && (state === 'flying' || state === 'paused')) {      // a bomb is not something to be close to - the shield stops guns and missiles only, bombs go through
    const rk = blastRadius(wp.ex);
    if (Math.hypot(ac.pos[0] - p[0], ac.pos[1] - p[1], ac.pos[2] - p[2]) < rk) forceCrash(`caught in the blast of a ${wp.name}`);
  }
  if (m.from === (net.id || 0) && m.w !== 'msl' && sight.target && !ac.crashed) {
    const miss = Math.round(Math.hypot(p[0] - sight.target.x, p[2] - sight.target.z));
    say(m.water ? `Splash ${miss} m from the target` : `Impact ${miss} m from the target`, 3, miss < 60 ? '#7cff9a' : '#ffc83a');
  }
}
function onRemoteBomb(m) {
  if (!BM.BOMBS[m.type] || [m.p, m.v].some(a => !Array.isArray(a) || a.length !== 3) || !Array.isArray(m.wind)) return;
  bombs.launch({ id: m.id, from: m.from, type: m.type, p: m.p, v: m.v, wind: m.wind, seed: m.seed, mine: false, name: m.name, look: (net.pilots.get(m.from) || {}).plane });
}
/** The admin's button (z_x_l): clear the runway's bomb marks for everybody. */
function updateAdmin() { const b = $('clearRunway'); if (b) b.style.display = net.open && net.admin ? '' : 'none'; $('chatBox').classList.toggle('admin', net.open && net.admin); }
if ($('clearRunway')) $('clearRunway').onclick = () => { if (net.open && net.admin) net.ws.send(JSON.stringify({ t: 'clearRunway' })); };
/** The server's list of craters (a new connection) replaces whatever we had. */
function loadDamage(dmg) { craters.loadAll(dmg.list); damageEra = dmg.era; localStore.reset(dmg.era); bombs.clear(); updateMenuInfo(); }
/** 12:00 PM Eastern: the whole map is restored. */
function onMapReset(m) {
  craters.clear(); bombs.clear(); localStore.reset(m.era); damageEra = m.era;
  say('Daily map reset (12:00 PM Eastern) - craters, trees, buildings and runway restored', 6, '#7fd0ff'); updateMenuInfo();
}
/** Usable runway for this aircraft's gear track, cached until the craters change. */
let rwCache = { key: '', info: null };
function runwayInfo() {
  const track = Math.abs(ac.spec.wheels[1].r[0]) * 2, key = craters.dmg.version + ':' + track + ':' + airfield;
  if (rwCache.key !== key) rwCache = { key, info: DM.runwayStatus(craters.dmg.list, track, airfield === 'isle' ? W.AIRSTRIP : W.RUNWAY) };
  return rwCache.info;
}
/** Rough ground roll to lift off (m), from the physics at this load, with a pilot's margin. */
const takeoffRoll = (spec, payload) => (690 + 0.0214 * payload) * 1.15 * (airfield === 'isle' && !spec.floats ? 1.25 : 1);      // soft dirt: a longer roll
function renderBombLoad() {
  if (!ac.spec.bomber) return;
  $('bombLoad').innerHTML = BM.BOMB_IDS.map(id => { const B = BM.BOMBS[id]; return `<button class="chip ${id === bombType ? 'sel' : ''}" data-b="${id}">${B.count} × ${B.name} <small>${Math.round(B.count * B.mass)} kg</small></button>`; }).join('');
  $('bombLoad').querySelectorAll('button').forEach(b => b.onclick = () => { bombType = b.dataset.b; try { localStorage.setItem('fsBomb', bombType); } catch (e) {} renderBombLoad(); updateMenuInfo(); });
}
const fmtLeft = ms => { const m = Math.max(0, Math.round(ms / 60000)); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`; };
function updateMenuInfo() {
  if (!$('rwStatus')) return;
  if (mapId === 'carrier') { $('rwStatus').innerHTML = `<span class="muted">Carrier map: the round ends when a carrier is sunk (${CW.HP} hit points) or after ${Math.round(CW.ROUND_MAX / 60)} minutes. Rounds won ${carrier.round.wins[0]} : ${carrier.round.wins[1]}.</span>`; return; }
  const r = runwayInfo(), T = ac.spec;
  let t = r.craters ? `<b>${rwName()}: ${r.pct}% usable</b> - longest clear stretch ${r.clear} m of ${r.length} m, ${craters.dmg.list.length} crater${craters.dmg.list.length === 1 ? '' : 's'} on the island`
                    : `${rwName()}: undamaged (${r.length} m)${craters.dmg.list.length ? ` · ${craters.dmg.list.length} crater${craters.dmg.list.length === 1 ? '' : 's'} elsewhere` : ''}`;
  if (T.bomber) { const need = takeoffRoll(T, BM.BOMBS[bombType].count * BM.BOMBS[bombType].mass); t += ` · this load needs about ${Math.round(need)} m to take off${r.clear < need ? ' - <span class="bad">NOT ENOUGH RUNWAY</span>' : ''}`; }
  if (mapId === 'peace') t = `${rwName()}: always in perfect condition on the peace map`;
  $('rwStatus').innerHTML = `${t}<br><span class="muted">The map resets every day at 12:00 PM Eastern - next in ${fmtLeft(DM.nextNoonET(Date.now()) - Date.now())}.</span>`;
}
damageEra = DM.lastNoonET(Date.now());
setInterval(() => {                                              // offline: the same noon reset, from this machine's clock (online it comes from the server)
  const era = DM.lastNoonET(Date.now());
  if (!net.open && era > damageEra) onMapReset({ era });
  if (state === 'menu') updateMenuInfo();
}, 5000);
/** The bomb status line and the impact pipper (about 4 times a second: the prediction flies a whole bomb). */
let bombHudT = 0;
function updateBombHud(dt) {
  const box = $('bombHud'), pip = $('bombPip'), tgt = $('bombTgt');
  if (!hasBombs() || state === 'menu') { box.style.display = pip.style.display = tgt.style.display = 'none'; return; }
  box.style.display = '';
  if ((bombHudT -= dt) > 0 && !bombRun && !rackRun) return;
  bombHudT = 0.25;
  const B = BM.BOMBS[curBomb()], air = !ac.crashed;
  const prot = spawnProt() ? Math.ceil(PROTECT_S - (simTime - startT)) : 0;
  let line = ac.spec.bombRack ? (ac.spec.bombRack.pylon ? (bombsLeft ? `<b>${bombsLeft} × ${B.name}</b> · pylons ${bombReady ? 'armed' : 'safe'}` : 'bombs gone - pylons empty') : bombsLeft ? `<b>1 × ${B.name}</b> · swing-arm rack ${rackRun ? '<span class="bad">RELEASING</span>' : bombReady ? (rackPos >= 1 ? '<span class="bad">OUT - READY</span>' : 'swinging out') : 'stowed'}` : 'bomb away - rack empty') : (prot ? `<span style="color:#7cff9a">PROTECTED ${prot} s</span> · ` : '') + `${turret.target ? `<span class="bad">GUNS: ${esc(turret.target.name)}</span> · ` : ''}turrets ${turret.ammo} · nose guns ${gun.ammo} · ` + (!bombsLeft && !bombRun ? 'bomb bay empty' : `<b>${bombsLeft} × ${B.name}</b>`) + ` · bay ${bombReady && bayPos > 0.95 ? '<span class="bad">OPEN - READY</span>' : bayPos > 0.95 ? '<span class="bad">OPEN</span>' : bayPos > 0 ? 'moving' : 'closed'}${bombRun ? ` · releasing (${bombRun.left} to go)` : ''}`;
  pip.style.display = tgt.style.display = 'none';
  if (air && bombsLeft) {
    const R = releaseState(), pr = BM.predict(curBomb(), R.bay, R.vel, [ac.wind[0], ac.wind[2]], sight.o.env);
    if (pr) {
      line += ` · impact in ${(pr.t + R.delay).toFixed(0)} s`;
      const sp = screenOf(pr.p); if (sp.on) { pip.style.display = ''; pip.style.left = sp.x + 'px'; pip.style.top = sp.y + 'px'; }
      if (sight.target && ac.spec.bomber) {
        const T = sight.target, dist = Math.hypot(T.x - ac.pos[0], T.z - ac.pos[2]), miss = Math.hypot(pr.p[0] - T.x, pr.p[2] - T.z), hd = (Math.atan2(-(T.x - ac.pos[0]), -(T.z - ac.pos[2])) * 180 / Math.PI + 360) % 360;
        line += ` · target ${(dist / 1000).toFixed(1)} km @ ${String(Math.round(hd)).padStart(3, '0')}° · miss ${Math.round(miss)} m`;
        const st = screenOf([T.x, Math.max(0, field.at(T.x, T.z)), T.z]); if (st.on) { tgt.style.display = ''; tgt.style.left = st.x + 'px'; tgt.style.top = st.y + 'px'; }
      }
    }
  }
  if (mapId === 'carrier' && net.open && sortie.vet) line += ` · <span style="color:#7cff9a">veteran +${sortie.vet * 10}%</span>`;
  box.innerHTML = line + (air && bombsLeft ? (ac.spec.bombRack ? ' · <kbd>N</kbd> release' : ' · <kbd>N</kbd> bombsight') + (air && bombsLeft ? ` · <kbd>O</kbd> ${bombReady ? 'stow' : 'ready bomb'}` : '') : '');
}

// ---------- AIM-9 heat-seekers (Falcon): H fires, J flares; the seeker locks what it can see near the nose
const msl = { sel: 'aim9', used: {}, left: 0, flares: 0, mid: 0, lock: null, dlz: null, dlzT: 0, prog: 0, progT: 0, lastLaunch: -9, warnT: 0 };
const v3dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** What a missile (or our seeker) needs to know about pilot id: {p, v, fwd, type, engine} - null if gone / down. */
function tgtInfo(id) {
  if (id && id === net.id) return immune || protectedNow() || ac.crashed || (state !== 'flying' && state !== 'paused') ? null : { p: ac.pos.slice(), v: ac.vel.slice(), fwd: ac.attitude.fwd, type: planeType, engine: ac.engine };
  const o = net.others.get(id);
  if (!o || o.dead || !o.buf.length || !o.model.root.visible || o.flags & 48) return null;     // immune or shielded: no heat to lock
  return { p: o.model.root.position.toArray(), v: o.vel || [0, 0, 0], fwd: new THREE.Vector3(0, 0, -1).applyQuaternion(o.model.root.quaternion).toArray(), type: o.plane, engine: o.buf[o.buf.length - 1].e };
}
function terrainClear(a, b) {
  for (let k = 1; k < 16; k++) { const f = k / 16, x = a[0] + (b[0] - a[0]) * f, z = a[2] + (b[2] - a[2]) * f; if (a[1] + (b[1] - a[1]) * f < field.at(x, z) + 3) return false; }
  return true;
}
/** The seeker before launch: uncaged within 20° of the nose, keeps a target out to its 40° gimbal; lock after 0.8 s of tone. */
/** Missiles of type id still on the rails (each type has a per-sortie limit: the AIM-120 and AIM-9X are scarce). */
const typeLeft = id => Math.max(0, Math.min(msl.left, MISSILE_TYPES[id].max - (msl.used[id] || 0)));
function pickMissile() {
  if (!ac.spec.missiles || ac.crashed || state !== 'flying') return;
  for (let k = 1; k <= MISSILE_IDS.length; k++) {
    const id = MISSILE_IDS[(MISSILE_IDS.indexOf(msl.sel) + k) % MISSILE_IDS.length];
    if (typeLeft(id)) { msl.sel = id; msl.lock = null; return say(`${MISSILE_TYPES[id].name} selected · ${typeLeft(id)} left${id === 'aim120' ? ' · radar, long range' : id === 'aim9x' ? ' · wide-angle IR' : ''}`, 1.8, '#ffc83a'); }
  }
}
function seekerStep() {
  if (msl.left && !typeLeft(msl.sel)) msl.sel = MISSILE_IDS.find(typeLeft) || msl.sel;
  const MT = MISSILE_TYPES[msl.sel];
  if (!ac.spec.missiles || !msl.left || weaponsHold() || ac.crashed || ac.onGround) { msl.lock = null; return; }
  const fwd = ac.attitude.fwd;
  let best = null;
  for (const id of net.others.keys()) {
    const t = tgtInfo(id); if (!t) continue;
    const d = [t.p[0] - ac.pos[0], t.p[1] - ac.pos[1], t.p[2] - ac.pos[2]], dist = Math.hypot(...d), u = d.map(x => x / dist);
    const cur = msl.lock && msl.lock.id === id, off = Math.acos(Math.max(-1, Math.min(1, v3dot(u, fwd))));
    if (off > (cur ? MT.gimbal : MT.lockCone) || dist < 120) continue;
    if (dist > detectRange(signature(t.type, t.engine, t.fwd, u.map(x => -x))) * MT.rangeMul * (cur ? 1.1 : 1)) continue;
    if (!terrainClear(ac.pos, t.p)) continue;
    const score = cur ? -1 : off;
    if (!best || score < best.score) best = { id, score, u, dist, t };
  }
  if (!best) { msl.lock = null; return; }
  if (!msl.lock || msl.lock.id !== best.id) { msl.lock = { id: best.id, t: 0 }; msl.dlz = null; }
  Object.assign(msl.lock, { u: best.u, dist: best.dist });
  msl.lock.t += STEP; msl.lock.locked = msl.lock.t > 0.8;
  if (msl.lock.locked && (msl.dlzT -= STEP) <= 0) {            // launch zone: would it hit them if they hold their course?
    msl.dlzT = 0.3;
    msl.dlz = predict({ p: ac.pos, v: ac.vel, d: best.u, k: msl.sel }, best.t, (x, z) => field.at(x, z)).hit;
  }
}
function fireMissile() {
  const M = ac.spec.missiles;
  if (!M || ac.crashed || state !== 'flying') return;
  if (weaponsHold()) return say(`Weapons safe - ${holdWhy()}`, 1.5, '#7cff9a');
  if (!msl.left) return say('Winchester - no missiles left', 1.5, '#ffc83a');
  if (!typeLeft(msl.sel)) return say(`No ${MISSILE_TYPES[msl.sel].name} left - Y to change`, 1.5, '#ffc83a');
  if (ac.onGround) return say('Master arm is safe on the ground', 1.5, '#ffc83a');
  if (simTime - msl.lastLaunch < 0.8) return;
  const rail = M.length - msl.left, L = msl.lock && msl.lock.locked ? msl.lock : null;
  const r1 = v => Math.round(v * 10) / 10, r3 = v => Math.round(v * 1000) / 1000;
  const A = MISSILE_TYPES[msl.sel], m = { k: msl.sel, mid: ++msl.mid, from: net.id || -1, tg: L ? L.id : 0, p: ac.worldPoint(M[rail]).map(r1), v: ac.vel.map(r1), d: (L ? L.u : ac.attitude.fwd).map(r3), name: myName() };
  missiles.launch(m, { mine: true });
  msl.left--; msl.used[msl.sel] = (msl.used[msl.sel] || 0) + 1; msl.lastLaunch = simTime; shield.grace = 0;
  if (plane.missiles[rail]) plane.missiles[rail].visible = false;
  const o = L && net.others.get(L.id);
  say(L ? `${A.fox} · ${A.name} · ${o ? o.name : ''}` : `${A.fox} - ${A.name}, no lock, boresight`, 1.6, '#ffc83a');
  if (net.open) net.ws.send(JSON.stringify({ t: 'msl', k: m.k, mid: m.mid, tg: m.tg, p: m.p, v: m.v, d: m.d, rail }));
}
function dispenseFlares() {
  if (!ac.spec.flares || ac.crashed || state !== 'flying') return;
  if (msl.flares <= 0) return say('Flares empty', 1.2, '#ffc83a');
  if (!msl.prog) { msl.prog = 2; msl.progT = 0; }             // one program: two pairs, 0.25 s apart
}
function flareStep() {
  if (!msl.prog || (msl.progT -= STEP) > 0) return;
  if (msl.flares <= 0 || ac.crashed) { msl.prog = 0; return; }
  const at = ac.attitude;
  for (const sd of [-1, 1]) {                                   // fired downward out of the dispensers under the tail
    const p = ac.worldPoint([sd * 0.6, -0.9, 3.5]);
    missiles.flare(p, [0, 1, 2].map(a => ac.vel[a] - at.up[a] * 28 + at.right[a] * sd * 5), true);
  }
  msl.flares -= 2; msl.prog--; msl.progT = 0.25;
}
function onRemoteMissile(m) {
  const o = net.others.get(m.from);
  if (o && o.model.missiles[m.rail]) o.model.missiles[m.rail].visible = false;
  const auth = !!m.tg && m.tg === net.id;
  missiles.launch({ k: MISSILE_TYPES[m.k] ? m.k : 'aim9', mid: m.mid, from: m.from, tg: m.tg, p: m.p, v: m.v, d: m.d, name: m.name }, { auth });
  if (auth && state === 'flying' && !ac.crashed) say(`MISSILE LAUNCH - ${m.name} (${MISSILE_TYPES[m.k] ? MISSILE_TYPES[m.k].name : 'AIM-9M'})`, 2.5, '#ff4a3a');
}
/** A missile ended in this browser. If it was fired at us, ours is the verdict everyone gets. */
function onMissileEnd(e, ev) {
  const s = e.sim;
  if (!e.auth) return;
  const miss = Number.isFinite(ev.miss) ? Math.round(ev.miss * 10) / 10 : -1;
  if (net.open) net.ws.send(JSON.stringify({ t: 'mslEnd', from: s.from, mid: s.mid, kind: ev.kind, miss, p: ev.p.map(v => Math.round(v * 10) / 10), water: !!ev.water }));
  if (ev.kind === 'prox') hitByMissile(e.name, ev.miss, s.A);
  else if (state === 'flying' && !ac.crashed) say(ev.kind === 'ground' ? 'Missile hit the ground - defeated!' : 'Missile defeated!', 2, '#7cff9a');
}
function hitByMissile(name, miss, A = AIM9) {
  if (immune || protectedNow() || ac.crashed || (state !== 'flying' && state !== 'paused')) return;
  audio.hit();
  damage.by = name || 'another pilot';
  if (miss < A.kill) return forceCrash(`shot down by ${damage.by}'s ${A.name}`);
  damage.n += miss < 7 ? 10 : 8;
  if (damage.n >= 12) return forceCrash(`shot down by ${damage.by}'s ${A.name}`);
  say(`Missile hit (${miss.toFixed(0)} m) - on fire!`, 2.5, '#ff6a4a');
}
/** The target's browser decided how a missile ended. */
function onMissileVerdict(m) {
  if (!Array.isArray(m.p) || m.p.length !== 3) return;
  const ext = missiles.external(m.from, m.mid, { kind: m.kind, p: m.p, miss: m.miss < 0 ? Infinity : m.miss, water: !!m.water });
  if (m.from !== net.id) return;
  const o = net.others.get(m.tg), who = o ? o.name : 'the target', kill = (ext ? ext.sim.A : AIM9).kill;
  if (m.kind === 'prox' && m.miss >= 0 && m.miss < kill) lastSplashT = simTime;
  if (m.kind === 'prox' && m.miss >= 0 && m.miss < kill) say(`SPLASH! ${who} shot down`, 2.5, '#ffc83a');
  else if (m.kind === 'prox') say(`Hit ${who} - ${Math.round(m.miss)} m`, 2, '#ffc83a');
  else say(`${who} defeated your missile`, 2, '#ffc83a');
}
/** Every frame: fly every missile and flare; warn if one is coming for us. */
function updateMissiles(dt) {
  for (const { e, ev } of missiles.update(dt, tgtInfo)) onMissileEnd(e, ev);
  const inc = net.id && state === 'flying' && !ac.crashed ? missiles.incoming(net.id) : [];
  if (inc.length && (msl.warnT -= dt) <= 0) { msl.warnT = 0.32; audio.mslWarn(); }
  let tone = 0;
  if (state === 'flying' && !paused && ac.spec.missiles && msl.left && !immune && !ac.crashed && !ac.onGround) tone = msl.lock ? (msl.lock.locked ? 3 : 2) : 1;
  audio.growl(tone);
}
function screenOf(p) {
  const v = new THREE.Vector3(...p).project(camera), r = canvas.getBoundingClientRect();
  const behind = v.z > 1;
  let x = (v.x * 0.5 + 0.5) * r.width, y = (-v.y * 0.5 + 0.5) * r.height;
  if (behind) { x = r.width - x; y = r.height - y; }
  return { x, y, on: !behind && x > 0 && x < r.width && y > 0 && y < r.height };
}

// ---------- playground: stunts (fly-throughs), the hoop loop, balloons
let stuntsDone = {};
try { stuntsDone = JSON.parse(localStorage.getItem('fsStuntsDone') || '{}') || {}; } catch (e) {}
function onPlay(e) {
  if (e.type === 'stunt') {
    const fresh = !stuntsDone[e.id];
    stuntsDone[e.id] = (stuntsDone[e.id] || 0) + 1;
    try { localStorage.setItem('fsStuntsDone', JSON.stringify(stuntsDone)); } catch (err) {}
    audio.aerobatic(fresh);
    const n = STUNTS.filter(x => stuntsDone[x.id]).length;
    showAero(e.name, fresh ? `NEW · ${n} / ${STUNTS.length} playground stunts` : '');
    renderAeroList();
  } else if (e.type === 'hoop') {
    audio.hoop(e.i, e.n);
    if (e.i < e.n) say(`Hoop ${e.i} / ${e.n}`, 1.6, '#ff8ae6');
  } else if (e.type === 'pop') {
    audio.pop();
    const c = new THREE.Color(e.color);
    for (let k = 0; k < 70; k++) {                              // rubber shreds and confetti
      const d = [Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5], sp = 6 + Math.random() * 14, cc = Math.random() < 0.6 ? c : new THREE.Color().setHSL(Math.random(), 0.9, 0.6);
      fx.spark.emit({ p: e.pos, v: [d[0] * sp + ac.vel[0] * 0.3, d[1] * sp + ac.vel[1] * 0.3, d[2] * sp + ac.vel[2] * 0.3], life: 1.5 + Math.random() * 1.5, size: [0.9, 0.6], c0: [cc.r * 1.6, cc.g * 1.6, cc.b * 1.6], c1: [cc.r, cc.g, cc.b], a: 1, fadeIn: 0.01, drag: 1.6, acc: -3, land: true });
    }
    say(e.left ? `Pop! ${e.total - e.left} / ${e.total} balloons` : `All ${e.total} balloons popped!`, 1.6, '#ffd23a');
  }
}

function onTouchdown(e) {
  const fpm = Math.round(e.vs * 196.85);
  if (landing && !landing.done) {
    if (landing.touch && !landing.touch.mains && e.wheel > 0) landing.touch.mains = true;
    if (!landing.touch) {
      const att = ac.attitude;
      landing.touch = { vs: e.vs, fpm, x: e.pos[0] - strip().x, z: e.pos[2], heading: att.heading, bank: att.bank, crab: att.heading > Math.PI ? att.heading - 2 * Math.PI : att.heading, onRunway: onStrip(e.pos[0], e.pos[2]), rex: onRex(e.pos), noseFirst: e.wheel === 0 && !ac.spec.tailwheel, mains: e.wheel > 0 };
      say(`Touchdown ${fpm} fpm`, 2.5);
    } else if (landing.airAfter > 0.4) { landing.bounces++; say('Bounce!', 1.5, '#ffc83a'); }
  } else if (mode !== 'race' && e.wheel > 0 && !ac.wheelLoad[e.wheel === 1 ? 2 : 1]) say(`Touchdown ${fpm} fpm ${fpm < 200 ? '· butter!' : fpm < 450 ? '' : '· firm'}`, 2.5);
}

/**
 * Crash: the real aircraft breaks apart. Every part of the model (wings with their ailerons, tail,
 * fuselage, propeller, wheels) becomes a tumbling rigid body (cannon-es) that keeps part of the
 * aircraft's momentum, its paint scorched. On land: a fireball, a burning wreck with a smoke column
 * that stands for a long time, and a scorch mark. In the sea: a splash and the wreckage sinks.
 */
let wreck = null, mainPiece = null, scorch = null, scorchAt = 0, standing = [];
const focus = new THREE.Vector3();
function clearCrash() {
  for (const d of debris) { scene.remove(d.mesh); if (!d.rest) phys.removeBody(d.body); }
  for (const b of standing) phys.removeBody(b);
  standing = [];
  if (scorch) { scene.remove(scorch); scorch.geometry.dispose(); scorch = null; }
  debris = []; wreck = null; mainPiece = null; scorchAt = 0;
  fx.clear();
}
const BURNT = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64); gr.addColorStop(0, 'rgba(8,6,4,.95)'); gr.addColorStop(0.45, 'rgba(25,18,12,.75)'); gr.addColorStop(1, 'rgba(40,30,20,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128); for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.4})`; g.fillRect(Math.random() * 128, Math.random() * 128, 3, 3); } return new THREE.CanvasTexture(c); })();
/** The scorch mark, draped over the terrain (a flat disc would float off a mountainside or sink into it). */
function placeScorch(x, z, size) {
  const geo = new THREE.PlaneGeometry(size, size, 24, 24); geo.rotateX(-Math.PI / 2);
  const pa = geo.attributes.position;
  for (let i = 0; i < pa.count; i++) { const wx = x + pa.getX(i), wz = z + pa.getZ(i); pa.setXYZ(i, wx, Math.max(0, field.at(wx, wz)) + 0.3, wz); }
  scorch = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: BURNT, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
  scorch.renderOrder = 1; scene.add(scorch);
}
function onCrash(e) {
  audio.crash();
  crashT = simTime;
  if (mapId === 'carrier' && net.ws && net.ws.readyState === 1 && CW.shipAt(e.pos[0], e.pos[1], e.pos[2])) net.ws.send(JSON.stringify({ t: 'crashhit', p: e.pos.map(v => Math.round(v * 10) / 10) }));      // the server decides the damage
  const p = e.pos, gh = mapId === 'carrier' && CW.deckAt(p[0], p[1], p[2]) !== null ? CW.DECK.y : field.at(p[0], p[2]), water = gh < 0.2 && p[1] < 4, agl = p[1] - Math.max(0, gh);
  if (/(hit|struck) the ground$|^flipped over$|^belly landing|^the gear was not/.test(e.reason)) {          // say where we fell, not which part touched
    const V = W.VOLCANO, nearRunway = W.onRunway && W.onRunway(p[0], p[2]);
    const where = Math.hypot(p[0] - V.x, p[2] - V.z) < 75 ? 'ditched into the lava' : gh > 120 ? 'fell onto the mountain' : 'fell to the ground';
    if (!nearRunway) { e.reason = where; if (ac.crashed) ac.crashed.reason = where; }
  }
  const floor = water ? -8 : gh;
  // hit something standing (the statue, a bridge, a building): the wreckage drops off it instead of flying on
  const wall = /^flew into (?!a tree)/.test(e.reason);
  focus.set(...p);
  if (groundBody) phys.removeBody(groundBody);
  if (water) {
    groundBody = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() }); groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0); groundBody.position.set(0, floor, 0);
  } else {
    // the real terrain around the crash so the wreckage settles on the slope; wider (coarser) when it falls from high up
    const n = 61, cell = Math.min(12, 3 + Math.max(0, agl) / 25), half = (n - 1) * cell / 2, x0 = p[0] - half, zTop = p[2] + half, data = [];
    for (let i = 0; i < n; i++) { const row = []; for (let j = 0; j < n; j++) row.push(Math.max(0, field.at(x0 + i * cell, zTop - j * cell))); data.push(row); }
    groundBody = new CANNON.Body({ mass: 0, shape: new CANNON.Heightfield(data, { elementSize: cell }) });
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0); groundBody.position.set(x0, 0, zTop);
  }
  phys.addBody(groundBody);
  // box-shaped things standing nearby (pedestal steps, bridge deck, barn walls, airfield buildings) catch the wreckage too
  for (const b of standing) phys.removeBody(b);
  standing = [];
  const near = a => a[0] < p[0] + 400 && a[3] > p[0] - 400 && a[2] < p[2] + 400 && a[5] > p[2] - 400;
  for (const s of play.solids) if (!s.test && near(s.aabb)) {
    const [u0, v0, w0, u1, v1, w1] = s.box, c = [(u0 + u1) / 2, (v0 + v1) / 2, (w0 + w1) / 2];
    const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3((u1 - u0) / 2, (v1 - v0) / 2, (w1 - w0) / 2)) });
    body.position.set(s.f.x + c[0] * s.f.c + c[2] * s.f.s, s.f.y + c[1], s.f.z - c[0] * s.f.s + c[2] * s.f.c);
    body.quaternion.setFromEuler(0, s.f.yaw, 0);
    phys.addBody(body); standing.push(body);
  }
  for (const b of world.buildings) if (!b.dead && near([b.x0, b.y0, b.z0, b.x1, b.y1, b.z1])) {
    const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3((b.x1 - b.x0) / 2, (b.y1 - b.y0) / 2, (b.z1 - b.z0) / 2)) });
    body.position.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
    phys.addBody(body); standing.push(body);
  }
  const v = ac.vel, sp = Math.hypot(...v), violence = Math.min(1, sp / 60), fuel = FUEL[planeType] || 1;
  // the engine dies with the airframe: no afterburner flame or prop disc on the wreck
  if (plane.flame) plane.flame.visible = false;
  if (plane.disc) plane.disc.visible = false;
  // break the aircraft apart into its real parts
  if (plane.merged) plane.merged.undo();
  plane.root.updateMatrixWorld(true);
  const parts = plane.root.children.filter(o => o !== plane.cockpitGroup && o !== plane.disc && o !== plane.flame);
  const box = new THREE.Box3(), size = new THREE.Vector3(), centre = new THREE.Vector3();
  let biggest = 0;
  for (const part of parts) {
    box.setFromObject(part);
    if (box.isEmpty()) continue;
    box.getSize(size); box.getCenter(centre);
    scene.attach(part);                                         // keep its world transform
    part.traverse(o => { if (o.material && !o.material.transparent) { o.material = o.material.clone(); o.material.color.lerp(new THREE.Color(0x1c1a18), water ? 0.15 : 0.45 + Math.random() * 0.3); o.material.roughness = 0.9; if (o.material.emissive) o.material.emissive.setHex(0); } });
    const half = new CANNON.Vec3(Math.max(0.08, size.x / 2), Math.max(0.08, size.y / 2), Math.max(0.08, size.z / 2));
    const vol = size.x * size.y * size.z;
    const body = new CANNON.Body({ mass: Math.max(2, vol * 25), shape: new CANNON.Box(half), linearDamping: water ? 0.6 : 0.05, angularDamping: 0.1 });
    body.position.set(centre.x, Math.max(centre.y, floor + half.y), centre.z);
    const spread = 4 + violence * 14;
    if (wall) body.velocity.set(-v[0] * Math.random() * 0.12 + (Math.random() - 0.5) * spread * 0.6, Math.random() * spread * 0.4, -v[2] * Math.random() * 0.12 + (Math.random() - 0.5) * spread * 0.6);
    else body.velocity.set(v[0] * (0.3 + Math.random() * 0.4) + (Math.random() - 0.5) * spread, (agl > 10 ? v[1] * 0.5 : Math.abs(v[1]) * 0.2) + Math.random() * spread * 0.6, v[2] * (0.3 + Math.random() * 0.4) + (Math.random() - 0.5) * spread);
    body.angularVelocity.set((Math.random() - 0.5) * 10 * violence, (Math.random() - 0.5) * 10 * violence, (Math.random() - 0.5) * 10 * violence);
    phys.addBody(body);
    const d = { mesh: part, body, vol, half: half.y, off: part.position.clone().sub(centre), q0: part.quaternion.clone(), burn: false, burnFor: 5 + Math.random() * 12 };
    debris.push(d);
    if (vol > biggest) { biggest = vol; mainPiece = d; }
  }
  if (!water) debris.filter(d => d !== mainPiece).sort((a, b) => b.vol - a.vol).slice(0, 3).forEach(d => { d.burn = true; });   // the wings / big parts burn a while
  crashYaw = Math.atan2(-v[0], -v[2]) + (Math.random() - 0.5) * 0.8;    // look at it from where the aircraft came from
  plane.broken = true;
  fx.explode(p, v, { violence, fuel, water });
  if (!water) {
    wreck = fx.wreckFire([p[0], Math.max(0, gh), p[2]], { scale: 0.6 + fuel * 0.35, secs: 45 });
    if (agl < 10) placeScorch(p[0], p[2], 16 + violence * 14 + fuel * 6);
    else scorchAt = 16 + violence * 14 + fuel * 6;               // placed where the wreck comes down
  }
  if (landing) landing.done = true;
  later(() => showResult('crash', e), 3000);
}

// ---------- ring race
function raceStep() {
  race.time += STEP;
  const r = W.COURSE[race.next];
  const n = new THREE.Vector3(-Math.sin(r.yaw), 0, -Math.cos(r.yaw)), c = new THREE.Vector3(r.x, r.y, r.z);
  const cur = new THREE.Vector3(...ac.pos);
  const d0 = prevPos.clone().sub(c).dot(n), d1 = cur.clone().sub(c).dot(n);
  if (d0 < 0 && d1 >= 0) {
    const hit = prevPos.clone().lerp(cur, -d0 / (d1 - d0));
    if (hit.distanceTo(c) <= r.r) {
      race.splits.push(race.time);
      const best = race.best;
      race.delta = best ? race.time - best[race.next] : null;
      race.next++;
      if (race.next >= W.COURSE.length) {
        race.done = true; audio.finish(); world.setRace(true, race.next);
        const prev = race.best;
        if (!prev || race.time < prev[prev.length - 1]) { try { localStorage.setItem('fsBestSplits_' + planeType, JSON.stringify(race.splits)); } catch (e) {} }
        if (net.open) net.ws.send(JSON.stringify({ t: 'race', time: race.time, splits: race.splits, plane: planeType }));
        say(`FINISH ${fmtTime(race.time)}`, 6, '#ffe14d');
        later(() => showResult('race'), 2500);
      } else { audio.ring(); world.setRace(true, race.next); }
    } else if (hit.distanceTo(c) < r.r * 3) { audio.miss(); say('Missed the ring - turn back!', 2, '#ffc83a'); }
  }
}

// ---------- precision landing
function approachInfo() {
  const R = strip(), aimZ = R.z0 - 300;
  const dist = ac.pos[2] - aimZ, off = ac.pos[0] - R.x;
  if (dist < 0 || dist > 9000) return null;
  const angle = Math.atan2(ac.pos[1] - R.elev - 1.3, dist) / DEG;
  const gs = (angle - 3) / 0.7;
  const loc = Math.atan2(off, dist + R.length) / DEG / 2.5;
  return { dist, offset: off, gs, loc, gsText: gs > 0.3 ? 'HIGH - reduce power' : gs < -0.3 ? 'LOW - add power' : 'ON GLIDE SLOPE' };
}
function landingStep() {
  const L = landing;
  if (!L.touch) {
    if (ac.pos[2] < strip().z1 - 100 && !ac.onGround) { L.done = true; say('Missed approach', 3, '#ffc83a'); later(() => showResult('land'), 2000); }
    return;
  }
  L.airAfter = ac.onGround ? 0 : L.airAfter + STEP;
  if (ac.onGround && !onStrip(ac.pos[0], ac.pos[2])) L.offRunway = true;
  // touched down on REX: the bonus holds only if every wheel stays on the letters until we stop
  if (L.touch.rex && ac.spec.wheels.some((wh, i) => ac.wheelLoad[i] > 0 && !onRex(ac.worldPoint(wh.r)))) L.offRex = true;
  if ((ac.onGround && ac.speed < 2) || simTime - (L.touchT || (L.touchT = simTime)) > 40) { L.done = true; later(() => showResult('land'), 800); }
}
function gradeLanding() {
  const L = landing, t = L.touch;
  if (!t) return { score: 0, grade: 'F', rows: [['No touchdown', '', 0]] };
  const rows = [];
  const R = strip(), fpm = t.fpm, aimZ = R.z0 - 300, along = aimZ - t.z, crab = Math.abs(t.crab / DEG), bank = Math.abs(t.bank / DEG);
  const pick = (v, table) => { for (const [lim, p] of table) if (v <= lim) return p; return 0; };
  const pv = pick(fpm, [[120, 40], [240, 34], [360, 26], [500, 16], [700, 6]]);
  const po = t.onRunway ? pick(Math.abs(t.x), [[1.5, 25], [3, 20], [6, 12], [10, 6], [15, 2]]) : 0;
  const pd = t.z > R.z0 ? 0 : pick(Math.abs(along), [[50, 20], [120, 14], [250, 8], [R.length, 3]]);
  const pa = pick(crab, [[2, 10], [5, 6], [9, 3]]);
  const pb = pick(bank, [[2, 5], [5, 3]]);
  rows.push(['Sink rate', `${fpm} fpm`, pv], ['Centreline', `${Math.abs(t.x).toFixed(1)} m ${t.x > 0 ? 'right' : 'left'}`, po],
            ['Touchdown point', t.z > R.z0 ? `short of the ${ac.spec.floats ? 'sea lane' : 'runway'}!` : `${Math.round(Math.abs(along))} m ${along > 0 ? 'past' : 'before'} the aiming point`, pd],
            ['Alignment (crab)', `${crab.toFixed(1)}°`, pa], ['Wings level', `${bank.toFixed(1)}°`, pb]);
  let score = pv + po + pd + pa + pb;
  if (t.noseFirst) { rows.push(['Nose wheel first', 'flare more', -10]); score -= 10; }
  if (L.bounces) { rows.push(['Bounces', String(L.bounces), -12 * L.bounces]); score -= 12 * L.bounces; }
  const rex = t.rex && !L.offRex;
  if (rex) { rows.push(['Landed on REX!', 'on top of the statue', 40]); score += 40; }
  if (L.offRunway && !rex) { rows.push(ac.spec.floats ? ['Left the sea lane', 'outside the buoys', -20] : ['Runway excursion', 'left the pavement', -20]); score -= 20; }
  score = Math.max(0, Math.min(100, score));
  const grade = score >= 95 ? 'S' : score >= 85 ? 'A' : score >= 72 ? 'B' : score >= 58 ? 'C' : score >= 40 ? 'D' : 'F';
  return { score, grade, rows, fpm, off: t.x, along };
}

// ---------- aerobatics (free flight): Aerobatics.js recognises the manoeuvre, we announce it and tick the checklist
let aeroDone = {};
try { aeroDone = JSON.parse(localStorage.getItem('fsAeroDone') || '{}') || {}; } catch (e) {}
let aeroListOn = false;
try { aeroListOn = localStorage.getItem('fsAeroList') === '1'; } catch (e) {}
function aerobatics() {
  const at = ac.attitude;
  const got = aero.rec.update({ w: ac.w, pitch: at.pitch, bank: at.bank, heading: at.heading, alt: ac.pos[1], vs: ac.vs, hspeed: Math.hypot(ac.vel[0], ac.vel[2]),
                                ias: ac.ias, alpha: ac.alpha, stall: ac.stall, agl: ac.agl, onGround: ac.onGround, vStall: ac.spec.hud.vs1 / KT }, STEP);
  for (const m of got) {
    aero.count++;
    const listed = AR.MANEUVERS.some(x => x.id === m.id), fresh = listed && !aeroDone[m.id];
    if (listed) { aeroDone[m.id] = (aeroDone[m.id] || 0) + 1; try { localStorage.setItem('fsAeroDone', JSON.stringify(aeroDone)); } catch (e) {} }
    audio.aerobatic(fresh);
    const n = AR.MANEUVERS.filter(x => aeroDone[x.id]).length;
    showAero(m.name, fresh ? `NEW · ${n} / ${AR.MANEUVERS.length} manoeuvres` : '');
    renderAeroList();
  }
}
let aeroTimer = 0;
function showAero(name, sub) {
  const b = $('aeroBanner');
  b.innerHTML = `<b></b>${sub ? '<small></small>' : ''}`;
  b.querySelector('b').textContent = name;
  if (sub) b.querySelector('small').textContent = sub;
  b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
  clearTimeout(aeroTimer); aeroTimer = setTimeout(() => b.classList.remove('pop'), 3200);
}
function renderAeroList() {
  const el = $('aeroList');
  el.style.display = state === 'flying' && mode === 'free' ? 'block' : 'none';
  const n = AR.MANEUVERS.filter(x => aeroDone[x.id]).length;
  el.classList.toggle('open', aeroListOn);
  const next = AR.MANEUVERS.find(m => !aeroDone[m.id]);          // only the next one to try gets its how-to line
  const ns = STUNTS.filter(x => stuntsDone[x.id]).length, nextS = STUNTS.find(x => !stuntsDone[x.id]);
  el.innerHTML = `<div class="ah">AEROBATICS ${n}/${AR.MANEUVERS.length} <kbd>L</kbd></div>` + (aeroListOn ? AR.MANEUVERS.map(m =>
    `<div class="ai ${aeroDone[m.id] ? 'ok' : ''}"><span>${aeroDone[m.id] ? '✔' : '○'}</span>${m.name}${m === next ? `<small>${m.how}</small>` : ''}</div>`).join('') : '') +
    (mapId === 'carrier' ? '' : `<div class="ah pg">PLAYGROUND ${ns}/${STUNTS.length}</div>`) + (aeroListOn && mapId !== 'carrier' ? STUNTS.map(m =>
    `<div class="ai ${stuntsDone[m.id] ? 'ok' : ''}"><span>${stuntsDone[m.id] ? '✔' : '○'}</span>${m.name}${m === nextS ? `<small>${m.how}</small>` : ''}</div>`).join('') : '');
}

// ---------- terrain warning
function pullUp() {
  if (ac.onGround || ac.speed < 30 || ac.agl < 25) return false;
  if (mode === 'land' && ac.pos[2] < strip().z0 + 3000 && Math.abs(ac.pos[0] - strip().x) < 300) return false;
  for (let t = 1; t <= 6; t += 1) {
    const x = ac.pos[0] + ac.vel[0] * t, y = ac.pos[1] + ac.vel[1] * t, z = ac.pos[2] + ac.vel[2] * t;
    if (y < Math.max(0, field.at(x, z)) + 15) return true;
  }
  return false;
}

// ---------- cameras
const tmp = new THREE.Vector3(), camPos = new THREE.Vector3(), camUp = new THREE.Vector3(0, 1, 0);
const planeQ = new THREE.Quaternion(), lookQ = new THREE.Quaternion(), eul = new THREE.Euler();
let camInit = false, crashCamY = null, crashYaw = 0;
function updateCamera(dt) {
  planeQ.set(...ac.q);
  const P = new THREE.Vector3(...ac.pos);
  const cm = CAMS[camMode];
  plane.cockpitGroup.visible = cm === 'cockpit' && !ac.crashed;
  plane.canopy.visible = cm !== 'cockpit';                  // no milky glass in front of the pilot's eyes
  audio.cockpit = cm === 'cockpit';
  if (ac.crashed && state !== 'menu') {
    // orbit the wreck (following the main piece down), always above the ground and with a clear view of it
    const t = simTime - crashT;
    if (mainPiece) { const b = mainPiece.mesh.position; focus.lerp(tmp.set(b.x, b.y, b.z), 1 - Math.exp(-dt * 2.5)); }
    const shake = Math.max(0, 1.2 - t) * 1.5, R = 70 + t * 0.8, a = crashYaw + Math.sin(t * 0.18) * 0.7;
    const cx = focus.x + Math.sin(a) * R, cz = focus.z + Math.cos(a) * R;
    let cy = Math.max(Math.max(0, field.at(cx, cz)) + 8, focus.y + 14 + t * 1.2);
    for (let k = 1; k <= 8; k++) {                              // raise the camera until the slope between it and the wreck is out of the way
      const f = k / 8, x = focus.x + (cx - focus.x) * f, z = focus.z + (cz - focus.z) * f;
      cy = Math.max(cy, focus.y + (Math.max(0, field.at(x, z)) + 4 - focus.y) / f);
    }
    for (let k = 0; k < 40 && (play.obstacleAt(cx, cy, cz) || world.obstacleAt(cx, cy, cz)); k++) cy += 8;   // never inside the statue / a building
    crashCamY = crashCamY === null || t < 0.05 ? cy : crashCamY + (cy - crashCamY) * (1 - Math.exp(-dt * 3));
    camera.position.set(cx + (Math.random() - 0.5) * shake, Math.max(crashCamY, cy - 30) + (Math.random() - 0.5) * shake, cz);
    camera.up.set(0, 1, 0); camera.lookAt(focus); camera.fov = 60; camera.updateProjectionMatrix();
    return;
  }
  if (cm === 'cockpit') {
    camera.position.copy(new THREE.Vector3(...ac.spec.eye).applyQuaternion(planeQ).add(P));
    eul.set(ctl.look.pitch, ctl.look.yaw, 0, 'YXZ'); lookQ.setFromEuler(eul);
    camera.quaternion.copy(planeQ).multiply(lookQ);
    camera.fov = 72;
  } else if (cm === 'chase') {
    eul.set(-0.12 + ctl.look.pitch * 0.8, ctl.look.yaw, 0, 'YXZ'); lookQ.setFromEuler(eul);
    const off = new THREE.Vector3(0, 0, ac.spec.cam.dist).applyQuaternion(lookQ).add(new THREE.Vector3(0, ac.spec.cam.height, 0)).applyQuaternion(planeQ);
    const want = P.clone().add(off);
    const gmin = Math.max(0, field.at(want.x, want.z)) + 1.5;
    if (want.y < gmin) want.y = gmin;
    if (!camInit) { camPos.copy(want); camInit = true; }
    camPos.lerp(want, 1 - Math.exp(-dt * 7));
    camera.position.copy(camPos);
    tmp.set(0, 1, 0).applyQuaternion(planeQ);
    camUp.lerp(tmp.multiplyScalar(0.55).add(new THREE.Vector3(0, 0.45, 0)).normalize(), 1 - Math.exp(-dt * 4));
    camera.up.copy(camUp);
    camera.lookAt(P.clone().add(new THREE.Vector3(0, 0, -8).applyQuaternion(planeQ)));
    camera.fov = 62 + Math.min(14, Math.max(0, (ac.speed - 50) * 0.08));
  } else {
    if (!flyby || P.distanceTo(flyby) > 450 || tmp.copy(flyby).sub(P).dot(new THREE.Vector3(...ac.vel)) < -60 * ac.speed) {
      const v = new THREE.Vector3(...ac.vel).normalize();
      flyby = P.clone().add(v.multiplyScalar(260)).add(new THREE.Vector3(...ac.attitude.right).multiplyScalar(35)).add(new THREE.Vector3(0, 8, 0));
      flyby.y = Math.max(flyby.y, Math.max(0, field.at(flyby.x, flyby.z)) + 3);
    }
    camera.position.copy(flyby); camera.up.set(0, 1, 0); camera.lookAt(P);
    camera.fov = THREE.MathUtils.clamp(2400 / Math.max(10, P.distanceTo(flyby)), 18, 70);
  }
  camera.updateProjectionMatrix();
}

// ---------- the volcano (Cinder Cay) erupts now and then: one 40 s eruption in every 8 minutes, at the same moment for everybody
const ERUPT = { cycle: 480, len: 40 };
function eruption(now = Date.now() / 1000) {
  const c = Math.floor(now / ERUPT.cycle), r = Math.abs(Math.sin(c * 12.9898 + 4.1) * 43758.5453) % 1;
  const t = now - c * ERUPT.cycle - (10 + r * (ERUPT.cycle - ERUPT.len - 20));
  return t >= 0 && t < ERUPT.len ? { t, k: Math.min(1, t / 4) * Math.min(1, (ERUPT.len - t) / 8) } : null;
}
let eruptId = -1, eruptBoomT = 0;
function volcanoStep(dt) {
  const er = eruption(); if (!er) { eruptId = -1; return; }
  const V = W.VOLCANO, cy = field.at(V.x, V.z), dist = Math.hypot(V.x - camera.position.x, V.z - camera.position.z);
  if (dist > 12000) return;
  if (eruptId < 0) { eruptId = 1; eruptBoomT = 0; if (state === 'flying' && dist < 9000) say('The volcano is erupting!', 4, '#ff8a3a'); }
  if ((eruptBoomT -= dt) <= 0) { eruptBoomT = 2.5 + Math.random() * 2; audio.boom(dist); }
  const R = (a, b) => a + Math.random() * (b - a), n = Math.ceil(er.k * 4);
  for (let i = 0; i < n; i++) {
    fx.smoke.emit({ p: [V.x + R(-35, 35), cy + 10, V.z + R(-35, 35)], v: [R(-8, 8) + 6, R(70, 120), R(-8, 8)], life: R(14, 22), size: [20, R(110, 170)], c0: [0.1, 0.09, 0.08], c1: [0.42, 0.4, 0.38], a: 0.75, fadeIn: 0.25, drag: 0.35, acc: 0.6, wind: 0.9, spin: 0.2 });
    for (let k = 0; k < 2; k++) fx.spark.emit({ p: [V.x + R(-25, 25), cy + 5, V.z + R(-25, 25)], v: [R(-35, 35), R(90, 200), R(-35, 35)], life: R(4, 8), size: [5, 3], c0: [3, 1.5, 0.35], c1: [1.2, 0.2, 0.02], a: 1, fadeIn: 0.01, drag: 0.04, acc: -9.8 });
    fx.fire.emit({ p: [V.x + R(-30, 30), cy + 8, V.z + R(-30, 30)], v: [R(-6, 6), R(20, 55), R(-6, 6)], life: R(1.5, 3), size: [R(20, 30), R(40, 60)], c0: [2.6, 1.3, 0.3], c1: [0.7, 0.1, 0.01], a: 0.8, fadeIn: 0.1, drag: 0.5, acc: 2, wind: 0.2, spin: 1 });
  }
  // lava bombs over the crater: nothing flies through that
  if (er.k > 0.3 && !ac.crashed && !immune && !protectedNow() && Math.hypot(ac.pos[0] - V.x, ac.pos[2] - V.z) < 110 && ac.pos[1] < cy + 450) forceCrash('hit by erupting lava bombs');
}
// ---------- effects per frame
function updateEffects(dt) {
  volcanoStep(dt);
  if (!ac.crashed && damage.n >= 4) {                          // battle damage: a smoke trail, then fire
    const p = ac.worldPoint([0, 0.3, 1]);
    if (Math.random() < 0.3) fx.smoke.emit({ p, v: [ac.vel[0] * 0.2, ac.vel[1] * 0.2 + 1, ac.vel[2] * 0.2], life: 2 + Math.random() * 1.5, size: [1, 3.5], c0: damage.n >= 8 ? [0.08, 0.07, 0.06] : [0.35, 0.34, 0.33], c1: [0.4, 0.4, 0.4], a: 0.4, fadeIn: 0.05, drag: 1, acc: 0.5, wind: 0.8, spin: 0.5 });
    if (damage.n >= 8) fx.burn(p, 1, 0.8);
  }
  if (!ac.crashed && plane.root.visible) {
    // exhaust vapour
    const E = ac.spec.engine, jet = E.kind === 'jet';
    const pts = E.exhaust || [-1, 1].map(s => [s * (jet ? 0.2 : 0.6), jet ? 7.6 : (E.propZ || -2) + 0.6, -0.2]);        // [x, z, y] of each exhaust
    for (const q of pts) if (Math.random() < 0.025 + ac.engine * 0.03) {          // a faint wisp: smoke must never hide the view
      const p = ac.worldPoint([q[0], q[2], q[1]]);
      const sooty = ac.spec.engine.noAB;                       // the TF34s burn dirty: a thin dark trail (more at high power)
      emit(smoke, p, [ac.vel[0] * 0.3 + (Math.random() - 0.5), ac.vel[1] * 0.3 + 0.3, ac.vel[2] * 0.3 + (Math.random() - 0.5)], 0.6 + ac.engine * 0.6, sooty ? 0.2 : 0.55, sooty ? 0.2 : 0.55, sooty ? 0.21 : 0.58);
    }
    // floats on the water: spray off the bows and a white wake behind the steps
    if (ac.onWater && ac.speed > 2) {
      const k = Math.min(1, ac.speed / 25);
      const side = ac.attitude.right;
      for (const i of [1, 2]) if (ac.wheelLoad[i] > 0) {
        const w = ac.spec.wheels[i].r, out = Math.sign(w[0]);
        for (let n = 0; n < 1 + k * 3; n++) {                  // spray sheets thrown out sideways from the bows, falling back
          const p = ac.worldPoint([w[0] + out * 0.3, w[1], w[2] - 1.5 + Math.random()]); p[1] = 0.2;
          const up = 1.5 + k * (2 + Math.random() * 4), sw = out * k * (2 + Math.random() * 4);
          fx.smoke.emit({ p, v: [ac.vel[0] * 0.3 + side[0] * sw, up, ac.vel[2] * 0.3 + side[2] * sw], life: 0.8 + Math.random() * 0.8, size: [0.6 + k, 1.5 + k * 3.5],
                          c0: [0.96, 0.98, 1], c1: [0.9, 0.93, 0.96], a: 0.55 + k * 0.3, fadeIn: 0.03, drag: 0.6, acc: -9.8, land: true, spin: 1 });
        }
        if (Math.random() < 0.5 + k * 0.5) {                     // the white wake spreading behind the steps
          const b = ac.worldPoint([w[0], w[1], 2.5 + Math.random()]); b[1] = 0.12;
          fx.smoke.emit({ p: b, v: [side[0] * out * 0.8, 0, side[2] * out * 0.8], life: 3 + k * 3, size: [1.2, 4 + k * 4], c0: [0.92, 0.95, 0.97], c1: [0.85, 0.9, 0.93], a: 0.45, fadeIn: 0.1, drag: 0.8, spin: 0.2 });
        }
      }
    }
    // dust when rolling fast on grass
    if (ac.onGround && ac.speed > 8 && ['grass', 'dirt'].includes(field.surface(ac.pos[0], ac.pos[2])) && Math.random() < 0.6) {
      const mw = ac.spec.wheels[1].r, p = ac.worldPoint([(Math.random() - 0.5) * 2 * Math.abs(mw[0]), mw[1], mw[2]]);
      emit(smoke, p, [(Math.random() - 0.5) * 2, 1 + Math.random(), (Math.random() - 0.5) * 2], 1.5, 0.62, 0.55, 0.42);
    }
  }
  // wingtip vortices under load (or at high alpha with moisture)
  const active = !ac.crashed && !ac.onGround && ac.speed > 30 && (ac.g > 2.6 || ac.alpha > ac.spec.surfaces[0].stall * 0.7);
  trails.forEach((tr, i) => {
    const tip = ac.spec.hardpoints[i];
    tr.pts.unshift(active ? ac.worldPoint(tip) : null);
    if (tr.pts.length > TRAIL) tr.pts.pop();
    let last = null;
    for (let k = 0; k < TRAIL; k++) {
      const p = tr.pts[k] || last;
      if (p) { tr.pos[k * 3] = p[0]; tr.pos[k * 3 + 1] = p[1]; tr.pos[k * 3 + 2] = p[2]; last = p; }
      const a = tr.pts[k] ? Math.pow(1 - k / TRAIL, 1.5) * 0.85 : 0;
      tr.col[k * 3] = a; tr.col[k * 3 + 1] = a; tr.col[k * 3 + 2] = a;
    }
    tr.line.geometry.attributes.position.needsUpdate = true; tr.line.geometry.attributes.color.needsUpdate = true;
  });
  // debris: tumbling parts; small fires on the bigger ones; anything that leaves the physics ground lies on the terrain
  if (debris.length) {
    phys.step(1 / 60, dt, 3);
    const t = simTime - crashT;
    for (const d of debris) {
      const b = d.body;
      if (!d.rest) {
        const g = Math.max(0, field.at(b.position.x, b.position.z));
        if (g > 0.2 && b.position.y < g - 1) { b.position.y = g + d.half; d.rest = true; phys.removeBody(b); }
        const bq = new THREE.Quaternion(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
        d.mesh.position.copy(d.off).applyQuaternion(bq).add(new THREE.Vector3(b.position.x, b.position.y, b.position.z));
        d.mesh.quaternion.copy(bq).multiply(d.q0);
      }
      if (d.burn && d !== mainPiece && t < d.burnFor && (d.rest || b.velocity.length() < 8)) fx.burn([b.position.x, b.position.y, b.position.z], Math.min(1, (d.burnFor - t) / 4), 0.7);
    }
    if (wreck && mainPiece) {                                   // the wreck fire stays with the main piece of wreckage
      const b = mainPiece.body.position;
      wreck.pos[0] = b.x; wreck.pos[1] = b.y - mainPiece.half * 0.5; wreck.pos[2] = b.z;
      wreck.moving = !mainPiece.rest && mainPiece.body.velocity.length() > 8;      // flames catch once it stops tumbling / falling
      if (scorchAt && (t > 6 || (mainPiece.rest || mainPiece.body.velocity.length() < 1.2) && t > 1)) { placeScorch(b.x, b.z, scorchAt); scorchAt = 0; }
    }
  }
  fx.update(dt, ac.wind);
  stepParticles(smoke, dt, 0.4);
}

/** Stall warning: the wing is within ~3 degrees of its critical angle for this aircraft type. */
function stallWarning() {
  const w = ac.spec.surfaces[0];
  return ac.stall > 0.02 || (ac.alpha + w.inc > w.stall - 3 * DEG && ac.ias > 10);
}

// ---------- HUD
function hudState() {
  const att = ac.attitude;
  const v = new THREE.Vector3(...ac.vel);
  let fpm = null;
  if (CAMS[camMode] === 'cockpit' && v.length() > 5) {
    const p = new THREE.Vector3(...ac.pos).add(v.normalize().multiplyScalar(500)).project(camera);
    const r = canvas.getBoundingClientRect();
    if (p.z < 1) fpm = [(p.x * 0.5 + 0.5) * r.width, (-p.y * 0.5 + 0.5) * r.height];
  }
  const windSpeed = Math.hypot(ac.wind[0], ac.wind[2]);
  const s = {
    cockpit: CAMS[camMode] === 'cockpit', pitch: att.pitch, bank: att.bank, heading: att.heading, ias: ac.ias, gs: Math.hypot(ac.vel[0], ac.vel[2]),
    alt: ac.pos[1], agl: ac.agl, groundAlt: mapId === 'carrier' && ac.pos[1] < CW.DECK.y + 40 && carrier.deckFrame(ac) ? CW.DECK.y : Math.max(0, field.at(ac.pos[0], ac.pos[2])), vs: ac.vel[1], throttle: ac.ctl.throttle, engine: ac.engine,
    flaps: ac.ctl.flaps, trim: ac.ctl.trim, brake: ac.onGround ? ac.ctl.brake : 0, wheels: ac.wheelLoad.map(l => l > 0), g: ac.g, maxG, alpha: ac.alpha, beta: ac.beta,
    onGround: ac.onGround, stallWarn: stallWarning(), pullUp: pullUp(), fpm, pos: ac.pos, spec: ac.spec,
    windSpeed, windFrom: Math.atan2(-ac.wind[0], ac.wind[2]),
    others: [...net.others.values()].map(o => ({ x: o.model.root.position.x, z: o.model.root.position.z, color: '#' + liveryOf(o.plane, o.livery).accent.toString(16).padStart(6, '0') })),
    mapId, radarRange: RADAR_RANGES[radarIdx], radarFields: mapId === 'war' ? W.FIELDS.map(f => ({ S: f.S, box: W.shieldBox(f) })) : W.FIELDS.map(f => ({ S: f.S })),
    shield: mapId === 'war' ? { name: shield.field ? shield.field.name : '', inside: !!shield.field, grace: !shield.field && simTime < shield.grace ? Math.ceil(shield.grace - simTime) : 0 } : null,
    radar: RADAR_RANGES[radarIdx] ? [...net.others.values()].filter(o => o.model.root.visible && o.buf.length).map(o => {
      const p = o.model.root.position;
      return { name: o.name, x: p.x, y: p.y, z: p.z, hdg: o.hdg || 0, war: !W.isCivil(o.plane), dead: !!(o.buf[o.buf.length - 1].x), shielded: !!(o.flags & 48), armed: armedType(o.plane) };
    }) : [],
  };
  if (mapId === 'carrier') {                                    // the carrier map: its own minimap, badge and radar fields; heights are above the deck over a deck
    Object.assign(s, carrier.hudExtras(myTeam(), planeType), { mapId: 'war', shield: carrier.shieldAt(ac) ? { name: carrier.shieldAt(ac).name, inside: true, grace: 0 } : null,
      others: [...net.others.values()].filter(o => o.model.root.visible).map(o => ({ x: o.model.root.position.x, z: o.model.root.position.z, color: ['#4f8fe0', '#e05a52'][(CP.PLANES[o.plane] || { team: 0 }).team] })) });
    if (s.groundAlt) s.agl = Math.max(0, ac.pos[1] - CW.DECK.y - ac.spec.restHeight);
    for (const o of s.radar) o.war = true;
  } else if (mode === 'free') s.pois = play.pois;
  if (ac.spec.retract) s.gear = { pos: ac.gearPos, down: ac.ctl.gear !== 0, warn: ac.gearPos < 0.999 && !ac.onGround && ac.agl < 150 && ac.ias < ac.spec.hud.vs0 / KT * 1.5 && ac.ctl.throttle < 0.35 };
  if (ac.spec.airbrake) s.airbrake = ac.airbrakePos;
  if (ac.spec.gun) {                                            // where the rounds go, 600 m out (gravity drop included)
    const tof = 600 / ac.spec.gun.speed, fw = ac.attitude.fwd;
    const aim = new THREE.Vector3(ac.pos[0] + (ac.vel[0] + fw[0] * ac.spec.gun.speed) * tof, ac.pos[1] + (ac.vel[1] + fw[1] * ac.spec.gun.speed) * tof - 4.9 * tof * tof, ac.pos[2] + (ac.vel[2] + fw[2] * ac.spec.gun.speed) * tof).project(camera);
    const r = canvas.getBoundingClientRect();
    s.gun = { ammo: gun.ammo, firing: gun.firing, pipper: aim.z < 1 ? [(aim.x * 0.5 + 0.5) * r.width, (-aim.y * 0.5 + 0.5) * r.height] : null };
  }
  if (ac.spec.missiles) {
    const L = msl.lock, t = L && tgtInfo(L.id);
    const look = t ? t.p : [0, 1, 2].map(a => ac.pos[a] + ac.attitude.fwd[a] * 1000);
    s.msl = { type: MISSILE_TYPES[msl.sel].name, tleft: typeLeft(msl.sel), left: msl.left, total: ac.spec.missiles.length, flares: msl.flares, state: !msl.left ? 'empty' : L ? (L.locked ? 'lock' : 'track') : 'search',
              seeker: screenOf(look), dist: L ? L.dist : null, dlz: L && L.locked ? msl.dlz : null, prog: msl.prog > 0 };
  }
  if (net.id && !ac.crashed) {
    const inc = missiles.incoming(net.id);
    if (inc.length) s.mws = inc.map(e => ({ ...screenOf(e.sim.p), dist: Math.hypot(e.sim.p[0] - ac.pos[0], e.sim.p[1] - ac.pos[1], e.sim.p[2] - ac.pos[2]) }));
  }
  if (damage.n) s.damage = damage.n;
  const FN = { engine: 'ENGINE', aileron: 'AILERONS', elevator: 'ELEVATOR', rudder: 'RUDDER', gear: 'GEAR', flaps: 'FLAPS', brake: 'BRAKES' };
  const fl = Object.keys(ac.fail || {}).map(k => FN[k] + ' FAILED'); if (gun.jam) fl.push('GUN JAMMED');
  const hot = ac.spec.gun && gun.heat > 0.5 ? ' · gun ' + Math.round(gun.heat * 100) + '%' : '';
  const eh = ac.heat && !ac.fail.engine && ac.heat.engine > 0.4 ? 'engine ' + Math.round(ac.heat.engine * 100) + '%' + hot : hot.slice(3);
  if (fl.length || eh) s.fails = { list: fl, heat: eh };
  if (immune) { s.immune = true; delete s.gun; delete s.msl; }        // weapons safe: no pipper, no seeker
  if (message && simTime < message.until) { s.message = message.text; s.messageColor = message.color; }
  const ap = approachInfo();
  if (ap && (mode === 'land' || (ap.dist < 7000 && Math.abs(ap.offset) < 1500 && ac.ias < 60 && !ac.onGround))) s.approach = ap;
  if (race) {
    const r = W.COURSE[Math.min(race.next, W.COURSE.length - 1)];
    s.race = { time: race.time, next: race.next, total: W.COURSE.length, done: race.done, delta: race.delta, dist: race.done ? null : Math.hypot(r.x - ac.pos[0], r.y - ac.pos[1], r.z - ac.pos[2]) };
    if (!race.done) {
      const p = new THREE.Vector3(r.x, r.y, r.z).project(camera);
      const rect = canvas.getBoundingClientRect();
      let x = (p.x * 0.5 + 0.5) * rect.width, y = (-p.y * 0.5 + 0.5) * rect.height;
      const behind = p.z > 1;
      if (behind) { x = rect.width - x; y = rect.height - y; }
      s.ringArrow = { x, y, onScreen: !behind && x > 0 && x < rect.width && y > 0 && y < rect.height };
      if (!s.ringArrow.onScreen) { const dx = x - rect.width / 2, dy = y - rect.height / 2, k = 1e5 / Math.max(1e-3, Math.hypot(dx, dy)); if (behind && Math.hypot(dx, dy) < 1) { s.ringArrow.x = rect.width / 2; s.ringArrow.y = rect.height; } else { s.ringArrow.x = rect.width / 2 + dx * k; s.ringArrow.y = rect.height / 2 + dy * k; } }
    }
  }
  return s;
}

// ---------- menus & results
const PANELS = ['pMenu', 'pPause', 'pResult'];
function showPanel(id) { $('aeroList').style.display = 'none'; $('overlay').classList.remove('hidden'); for (const p of PANELS) $(p).classList.toggle('show', p === id); ctl.active = false; }
function hideOverlay() { $('overlay').classList.add('hidden'); }
function showResult(kind, e) {
  if (state === 'menu') return;
  state = 'result';
  $('resRank').textContent = '';
  let html = '';
  if (kind === 'crash') {
    $('resTitle').textContent = 'CRASHED';
    html = `<p class="big bad">${esc(e.reason)}</p><p>Impact speed ${Math.round(e.speed * KT)} kt.</p>`;
    if (mode === 'land') html += ac.spec.floats ? '<p class="muted">Tip: hold ~60 kt with flaps, aim at the yellow buoys 300 m into the lane, flare to a slightly nose-up attitude and settle gently - floats dig in above ~650 fpm.</p>'
                                               : '<p class="muted">Tip: hold ~70 kt with flaps, aim at the white bars 300 m past the threshold, flare gently a few metres up.</p>';
  } else if (kind === 'race') {
    $('resTitle').textContent = 'RING RACE · FINISH';
    html = `<p class="big">${fmtTime(race.time)}</p>` + (race.best ? `<p>Personal best ${fmtTime(race.best[race.best.length - 1])}</p>` : '<p>First finish - new personal best!</p>');
  } else {
    const gr = gradeLanding();
    $('resTitle').textContent = 'LANDING REPORT';
    html = `<p class="grade g${gr.grade}">${gr.grade}</p><p class="big">${gr.score} / 100</p><table>${gr.rows.map(([a, b, p]) => `<tr><td>${a}</td><td>${esc(b)}</td><td class="${p < 0 ? 'bad' : ''}">${p > 0 ? '+' : ''}${p}</td></tr>`).join('')}</table>
            <p class="muted">Wind ${String(Math.round(((landing.windFrom / DEG) % 360 + 360) % 360)).padStart(3, '0')}° at ${Math.round(landing.windSpeed * KT)} kt, gusts.</p>`;
    if (net.open && landing.touch) net.ws.send(JSON.stringify({ t: 'landing', plane: planeType, score: gr.score, grade: gr.grade, vs: gr.fpm, off: gr.off, dist: gr.along, wind: landing.windSpeed * KT }));
  }
  $('resBody').innerHTML = html;
  showPanel('pResult');
}
function renderBoard() {
  const b = net.board;
  if (!b) return;
  const fmtDate = t => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const race = Array.isArray(b.race) ? b.race : (b.race[planeType] || []);       // race times are kept per aircraft type
  $('boardRaceTitle').textContent = `Ring race · ${FP.TYPES[planeType].name}`;
  $('boardRace').innerHTML = race.length ? race.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td>${fmtTime(r.time)}</td><td class="muted">${fmtDate(r.date)}</td></tr>`).join('') : '<tr><td colspan="4" class="muted">No times yet - be the first!</td></tr>';
  const hits = b.hits || [];
  $('boardHits').innerHTML = hits.length ? hits.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td><b>${r.hits}</b></td><td class="muted">best ${r.best} · ${(FP.TYPES[r.plane] || { name: '' }).name}</td></tr>`).join('') : '<tr><td colspan="4" class="muted">No hits yet - hit the enemy carrier\'s deck, or its hull with a torpedo.</td></tr>';
  $('boardLand').innerHTML = b.landing.length ? b.landing.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td><b class="g${r.grade}">${r.grade}</b> ${r.score}</td><td class="muted">${(FP.TYPES[r.plane] || FP.TYPES.sport).name} · ${r.vs} fpm</td></tr>`).join('') : '<tr><td colspan="4" class="muted">No landings yet.</td></tr>';
}
/** Aircraft picker (menu): two groups - civil (either map) and war (war map only) - each with name, short description and three bars. */
function renderPlanes() {
  const bar = (n, lab) => `<span class="bar"><i style="width:${n * 20}%"></i></span><small>${lab}</small>`;
  const top = { trainer: 85, sport: 165, warbird: 290, jet: 590, a10: 380, seaplane: 125, b29: 205 };
  const card = id => { const T = FP.TYPES[id], off = !W.mapAllows(mapId, id), carrierPlane = W.isCarrierPlane(id);
    return `<button class="plane ${id === planeType ? 'sel' : ''} ${off ? 'off' : ''}" data-p="${id}" ${off ? `disabled title="${carrierPlane ? 'Carrier aircraft can only fly on the carrier map' : 'War aircraft can only fly on the war map'}"` : ''}><b>${T.name}</b><small class="blurb">${T.blurb}</small>
      <div class="bars">${bar(T.stats.speed, 'speed')}${bar(T.stats.agility, 'agility')}${bar(T.stats.stall, 'slow flight')}</div>
      <small class="spd">stall ${T.hud.vs0} kt · top ${top[id] || T.topKt} kt</small></button>`; };
  const group = (cls, title, note, ids) => `<div class="pgroup ${cls}"><h3>${title} <span class="muted">${note}</span></h3><div class="planes">${ids.map(card).join('')}</div></div>`;
  $('planes').innerHTML = group('civil', '🕊 Civil aircraft', '- both maps, unarmed', FP.TYPE_IDS.filter(W.isCivil))
                        + group('war', '⚔ War aircraft', '- war map only, armed', FP.TYPE_IDS.filter(id => !W.isCivil(id) && !W.isCarrierPlane(id)))
                        + group('carrier', '⚓ Carrier aircraft', '- carrier map only: US Navy (Hellcat, Dauntless, Avenger) · Japanese Navy (Zero, Val, Kate)', FP.TYPE_IDS.filter(W.isCarrierPlane));
  $('planes').querySelectorAll('button').forEach(b => b.onclick = () => setPlane(b.dataset.p));
}
/** Peace / war map (menu). War aircraft are not allowed in the peace sky: picking it switches to a civil aircraft. */
function setMap(id, fromServer) {
  if (!W.MAPS.includes(id)) return;
  mapId = id; try { localStorage.setItem('fsMap', id); } catch (e) {}
  shield.field = null;
  if (id === 'peace' || id === 'carrier') { craters.clear(); bombs.clear(); }       // the peace map has no damage; the carrier map has no ground to crater
  applyWorld();
  const swap = !W.mapAllows(id, planeType);
  if (swap) setPlane(id === 'carrier' ? (W.isCarrierPlane(lastCarrier) ? lastCarrier : 'hellcat') : ['sport', 'trainer', 'seaplane'].includes(lastCivil) ? lastCivil : 'sport');
  else if (!fromServer && net.open) net.ws.send(JSON.stringify({ t: 'hello', name: myName(), token: OIID.token, livery, plane: planeType, map: mapId }));
  renderMaps(); renderPlanes(); updateMenuInfo(); setOnline();
  if ($('flyWhat')) renderMenuMode();
}
let lastCivil = 'sport', lastCarrier = 'hellcat';
/** The carrier map is another place: the island, its airfields, the playground and the birds are hidden and the ground is the sea; the carriers and their sea are shown. */
function applyWorld() {
  const car = mapId === 'carrier';
  field.sea = car; world.group.visible = !car; play.group.visible = !car; birds.setVisible(!car);
  carrier.show(car);
  shield.field = null;
  if (state === 'menu') { if (car) carrier.place(ac, myTeam(), (net.id || 0) % 9); else ac.reset({ ...freeSpot(), yaw: 0, onGround: true }); }
}
/** The shield of every airfield, drawn as a faint blue box (its edges, and its walls seen from outside) - war map only. */
const shieldViz = new THREE.Group();
for (const f of W.FIELDS) {
  const [x0, z0, x1, z1] = W.shieldBox(f), y0 = f.S.elev - 5, h = W.SHIELD.ceil + 5, geo = new THREE.BoxGeometry(x1 - x0, h, z1 - z0);
  const wall = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x3aa8ff, transparent: true, opacity: 0.05, depthWrite: false, fog: false }));
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.6, fog: false }));
  wall.position.set((x0 + x1) / 2, y0 + h / 2, (z0 + z1) / 2); edges.position.copy(wall.position);
  shieldViz.add(wall, edges);
}
scene.add(shieldViz);
function renderMaps() {
  shieldViz.visible = mapId === 'war';
  $('cwHud').classList.toggle('on', mapId === 'carrier');
  document.querySelectorAll('[data-map]').forEach(b => b.classList.toggle('sel', b.dataset.map === mapId));
  const civil = W.isCivil(planeType);
  $('mapNote').innerHTML = mapId === 'carrier' ? `<b style="color:${['#4f8fe0', '#e05a52'][myTeam()]}">${CP.TEAMS[myTeam()].name}</b> - the aircraft you pick decides your side. <b>Only bombs and torpedoes hurt a carrier</b> (a direct hit on the deck most - more still from a steep dive). The IJN carrier has a destroyer escort off her port side: her AA shoots too, and she can be bombed, torpedoed, strafed and sunk. Inside a carrier's shield nobody can fire or be shot - bombs go through it - and the enemy's AA shoots at you in the enemy shield. Launch: full throttle (R) on the deck. Land: gear (U), flaps (V), hook (H), touch down on the wires.<br><b>Veteran:</b> every safe landing back on your own carrier after damaging an enemy ship gives +10% bomb and torpedo damage, up to +30%, until you lose an aircraft. Direct hits on a carrier go on the <i>Carrier hits</i> leaderboard.`
    : mapId === 'peace' ? 'Nobody can shoot anybody and the ground is never cratered. Collisions still count.'
    : civil ? '<span class="bad">You are unarmed on the war map</span> - war aircraft can shoot you down. Airfield shields stop you firing, but not fire from outside; stay close to one anyway.'
    : 'Armed: guns, missiles' + (ac.spec.bomber ? ', bombs and turrets' : ac.spec.bombRack ? (ac.spec.bombRack.pylon ? `, ${ac.spec.bombRack.count} bombs` : ', one 1,000 lb bomb') : '') + '. Over every airfield there is a shield - inside it nobody can be hurt and nobody can fire.';
}
function setPlane(id) {
  if (!FP.TYPES[id] || !W.mapAllows(mapId, id)) return;
  if (W.isCivil(id)) lastCivil = id; else if (W.isCarrierPlane(id)) lastCarrier = id;
  planeType = id; try { localStorage.setItem('fsPlane', id); } catch (e) {}
  ac.setType(id); ctl.feel = ac.spec.feel;
  if (mapId === 'carrier') carrier.place(ac, myTeam(), (net.id || 0) % 9); else ac.reset({ ...freeSpot(), yaw: 0, onGround: true });
  clearCrash();
  scene.remove(plane.root); plane = makePlane(planeType, livery); scene.add(plane.root);
  renderPlanes(); renderMaps(); renderBoard(); renderLiveries(); if ($('flyWhat')) renderMenuMode();
  if (net.open) net.ws.send(JSON.stringify({ t: 'hello', name: myName(), token: OIID.token, livery, plane: planeType, map: mapId }));
}
function renderLiveries() {
  for (const el of [$('liveries'), $('livName'), $('liveries').previousElementSibling]) el.style.display = W.isCarrierPlane(planeType) ? 'none' : '';      // the carrier aircraft have their own fixed paint
  if (W.isCarrierPlane(planeType)) return;
  $('liveries').innerHTML = LIVERIES.map((l0, i) => { const l = liveryOf(planeType, i); return `<button class="liv ${i === livery ? 'sel' : ''}" data-i="${i}" title="${l.name}" style="--a:#${l.main.toString(16).padStart(6, '0')};--b:#${l.accent.toString(16).padStart(6, '0')}"></button>`; }).join('');
  $('livName').textContent = liveryOf(planeType, livery).name;
  $('liveries').querySelectorAll('button').forEach(b => b.onclick = () => {
    livery = +b.dataset.i; try { localStorage.setItem('fsLivery', String(livery)); } catch (e) {}
    scene.remove(plane.root); plane = makePlane(planeType, livery); scene.add(plane.root); renderLiveries();
    if (net.open) net.ws.send(JSON.stringify({ t: 'hello', name: myName(), token: OIID.token, livery, plane: planeType, map: mapId }));
  });
}

ctl.onCamera = () => { camMode = (camMode + 1) % CAMS.length; ctl.look.yaw = 0; ctl.look.pitch = 0; flyby = null; say(`Camera: ${CAMS[camMode]}`, 1.2); };
ctl.onAction = (a, v) => {
  if (a === 'flaps') { audio.flaps(); say(`Flaps ${['UP', '15°', '32°'][v]}`, 1.2); }
  else if (a === 'mouse') say(v ? 'Mouse stick ON (cursor = stick)' : 'Mouse stick OFF', 2);
  else if (a === 'KeyP') { paused = !paused; say(paused ? 'PAUSED' : '', paused ? 1e9 : 0.1); }
};

// ---------------------------------------------------------------- chat: always on screen; Enter (while flying) or a click to talk, admins can delete any line
function updateChatBox() {
  const i = $('chatIn'); i.disabled = !net.open;
  i.placeholder = net.open ? 'Say something to the pilots on this map…' : 'Chat needs the online sky - flying solo right now';
  $('chatHint').style.display = net.open ? '' : 'none';
  if (!net.open) { closeChat(); if (!$('chatList').children.length) $('chatList').append(Object.assign(document.createElement('div'), { className: 'chatline note', textContent: 'Chat - connecting to the online sky…' })); }
}
function chatLine(e) {
  const el = document.createElement('div'); el.className = 'chatline' + (e.by === OIID.name ? ' mine' : ''); el.dataset.id = e.id; el.dataset.at = e.at;
  const b = document.createElement('b'); b.textContent = e.by;
  const del = document.createElement('button'); del.className = 'del'; del.textContent = '✕'; del.title = 'Delete this message (admin)';
  del.onclick = () => { if (net.open && net.admin) net.ws.send(JSON.stringify({ t: 'delChat', id: e.id })); };
  el.append(del, b, ': ' + e.text);
  return el;
}
function chatReset(list) { $('chatList').replaceChildren(...(list.length ? list.map(chatLine) : [Object.assign(document.createElement('div'), { className: 'chatline note', textContent: 'No messages yet - press Enter to talk' })])); chatToBottom(); updateChatBox(); }
function chatAdd(e) {
  const l = $('chatList'), stick = l.scrollHeight - l.scrollTop - l.clientHeight < 30;
  for (const n of l.querySelectorAll('.note')) n.remove();
  l.append(chatLine(e));
  while (l.children.length > 100) l.firstChild.remove();
  if (stick) chatToBottom();
}
function chatRemove(id) { for (const el of $('chatList').children) if (el.dataset.id === String(id)) { el.remove(); break; } }
function chatToBottom() { const l = $('chatList'); l.scrollTop = l.scrollHeight; }
let chatOpen = false;               // the simulation keeps running while you type
function openChat() {
  if (!net.open) return say('Chat needs the online sky - you are flying solo right now.', 2, '#ffc83a');
  setTimeout(() => $('chatIn').focus(), 0);                // after this keydown, so the Enter does not land in the box
}
function closeChat() { $('chatIn').blur(); }
$('chatIn').addEventListener('focus', () => { chatOpen = true; $('chatBox').classList.add('open'); chatToBottom(); });
updateChatBox();
$('chatIn').addEventListener('blur', () => { chatOpen = false; $('chatBox').classList.remove('open'); });
function sendChat() {
  const text = $('chatIn').value.trim();
  if (text && net.open) net.ws.send(JSON.stringify({ t: 'chat', text }));
  $('chatIn').value = ''; closeChat();
}
$('chatIn').addEventListener('keydown', e => {
  if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); if (!e.isComposing) sendChat(); }    // isComposing: an IME (Chinese input) is still picking characters
  else if (e.code === 'Escape') closeChat();
});
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (state === 'flying' && (e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat) { e.preventDefault(); return openChat(); }
  if (state === 'result' && (e.code === 'Enter' || e.code === 'KeyR')) start(mode);
  else if (state === 'menu' && e.code === 'Enter') { e.preventDefault(); fly(); }      // not a click on the focused card
  else if (state === 'flying' && e.code === 'Tab') { e.preventDefault(); state = 'paused'; showPanel('pPause'); }     // Esc is the lab sheet (LabSheet.js)
  else if (state === 'paused' && e.code === 'Tab') { e.preventDefault(); state = 'flying'; hideOverlay(); ctl.active = true; }
  else if (state === 'flying' && e.code === 'Backspace') { if (!missileBlock()) start(mode); }
  else if (state === 'flying' && e.code === 'KeyU' && ac.spec.retract && !ac.crashed) {
    if (ac.ctl.gear && ac.onGround) say('Gear stays down on the ground (squat switch)', 1.5, '#ffc83a');
    else { ac.ctl.gear = ac.ctl.gear ? 0 : 1; audio.gear(); say(ac.ctl.gear ? 'Gear DOWN' : 'Gear UP', 1.2); }
  }
  else if (state === 'flying' && e.code === 'KeyK') { radarIdx = (radarIdx + 1) % RADAR_RANGES.length; try { localStorage.setItem('fsRadar', String(radarIdx)); } catch (err) {} say(RADAR_RANGES[radarIdx] ? `Radar range ${RADAR_RANGES[radarIdx] / 1000} km` : 'Radar off', 1.2); }
  else if (state === 'flying' && e.code === 'KeyN') openSight();
  else if (state === 'flying' && e.code === 'KeyO' && !e.repeat) toggleBombReady();
  else if (state === 'flying' && e.code === 'KeyH') { if (mapId === 'carrier') carrier.toggleHook(); else fireMissile(); }
  else if (state === 'flying' && e.code === 'KeyJ') dispenseFlares();
  else if (state === 'flying' && e.code === 'KeyY') pickMissile();
  else if (state === 'flying' && e.code === 'KeyZ' && ac.spec.airbrake && !ac.crashed) { ac.ctl.airbrake = ac.ctl.airbrake ? 0 : 1; say(ac.ctl.airbrake ? 'Speed brake OUT' : 'Speed brake in', 1.2); }
  else if (state === 'flying' && e.code === 'KeyL') { aeroListOn = !aeroListOn; try { localStorage.setItem('fsAeroList', aeroListOn ? '1' : '0'); } catch (err) {} renderAeroList(); }
});
// menu: pick the aircraft and the mode, then FLY (or Enter)
const MODE_NAMES = { free: 'Free Flight', land: 'Precision Landing', race: 'Ring Race' };
let menuMode = 'free';
try { const t = localStorage.getItem('fsMode'); if (MODE_NAMES[t]) menuMode = t; } catch (e) {}
function renderMenuMode() {
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('sel', b.dataset.mode === menuMode));
  $('flyWhat').textContent = `${FP.TYPES[planeType].name} · ${MODE_NAMES[menuMode]}`;
  const T = FP.TYPES[planeType];
  document.querySelectorAll('[data-mode]').forEach(b => { if (b.dataset.mode === 'race') { b.disabled = !!T.noRace; b.classList.toggle('off', !!T.noRace); } });
  if (T.noRace && menuMode === 'race') { menuMode = 'free'; try { localStorage.setItem('fsMode', menuMode); } catch (e) {} }
  const car = mapId === 'carrier', shown = car ? 'free' : menuMode;               // the carrier map is free flight only
  document.querySelectorAll('[data-mode]').forEach(b => { if (b.dataset.mode !== 'free') { b.disabled = car || (b.dataset.mode === 'race' && !!T.noRace); b.classList.toggle('off', b.disabled); } });
  $('fieldRow').style.display = car ? 'none' : '';
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('sel', b.dataset.mode === shown));
  $('flyWhat').textContent = `${T.name} · ${MODE_NAMES[shown]} · ${mapId} map`;
  $('bombLoadRow').style.display = T.bomber ? '' : 'none'; renderBombLoad(); updateMenuInfo();
  const ok = menuMode === 'land' && !car;                       // immune mode is for landing practice only
  $('immune').disabled = !ok; $('immuneLabel').classList.toggle('off', !ok);
}
document.querySelectorAll('[data-map]').forEach(b => b.onclick = () => setMap(b.dataset.map));
document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
  menuMode = b.dataset.mode; try { localStorage.setItem('fsMode', menuMode); } catch (e) {}
  renderMenuMode();
});
async function fly() {
  if (state !== 'menu' || !(await OIID.require())) return;
  await OIID.fresh();
  $('nameInput').value = OIID.name;
  OIID.activity({ status: ({ free: 'free flight', land: 'landing practice', race: 'ring race' }[menuMode] || 'flying') + ` (${mapId} map)`, join: 'flight_sim.html' });
  connect(); if (net.open) net.ws.send(JSON.stringify({ t: 'hello', name: myName(), token: OIID.token, livery, plane: planeType, map: mapId })); start(menuMode);
}
$('btnFly').onclick = fly;
renderMenuMode();
// the whole window already; this goes browser full screen (Esc leaves it)
$('fullBtn').onclick = () => { if (window.LabSheet) LabSheet.noteFullBtn(); if (document.fullscreenElement) document.exitFullscreen(); else (document.documentElement.requestFullscreen || (() => {})).call(document.documentElement); };
document.addEventListener('fullscreenchange', resize);
// Esc: the lab sheet (LabSheet.js) - the flight stops and goes quiet under it; ` flies on where you were
if (window.LabSheet) {
  let sheetFrom = null;
  LabSheet.onShow = () => {
    sheetFrom = state === 'flying' ? 'flying' : null;
    if (sheetFrom) { state = 'paused'; ctl.active = false; }
    for (const k in ctl.keys) ctl.keys[k] = false;
    if (chatOpen) closeChat();
    if (audio.ac) audio.ac.suspend();
  };
  LabSheet.onHide = () => {
    for (const k in ctl.keys) ctl.keys[k] = false;
    if (sheetFrom && state === 'paused') { state = 'flying'; ctl.active = true; }
    sheetFrom = null;
    if (audio.on && audio.ac) audio.ac.resume();
  };
}
$('btnResume').onclick = () => { state = 'flying'; hideOverlay(); ctl.active = true; };
/** A missile is tracking us: no restarting or quitting to the menu to dodge it - fly it out (or flare it). */
function missileBlock() {
  if (!net.id || ac.crashed || (state !== 'flying' && state !== 'paused') || !missiles.incoming(net.id).length) return false;
  say('MISSILE LOCK - no restart while a missile is tracking you', 2, '#ff4a3a'); return true;
}
$('btnRestart').onclick = () => { if (missileBlock()) { state = 'flying'; hideOverlay(); ctl.active = true; } else start(mode); };
$('btnMenu').onclick = () => { if (missileBlock()) { state = 'flying'; hideOverlay(); ctl.active = true; } else { state = 'menu'; showPanel('pMenu'); } };
$('btnRetry').onclick = () => start(mode);
$('btnResMenu').onclick = () => { state = 'menu'; showPanel('pMenu'); };
$('btnNext').onclick = () => start(mode);
$('invert').checked = ctl.invert; $('invert').onchange = () => ctl.setInvert($('invert').checked);
$('immune').checked = immuneOpt; $('immune').onchange = () => { immuneOpt = $('immune').checked; try { localStorage.setItem('fsImmune', immuneOpt ? '1' : '0'); } catch (e) {} };
$('mouseStick').checked = ctl.mouseStick; $('mouseStick').onchange = () => { ctl.mouseStick = $('mouseStick').checked; try { localStorage.setItem('fsMouse', ctl.mouseStick ? '1' : '0'); } catch (e) {} };
$('soundBtn').textContent = audio.on ? '🔊' : '🔇';
$('soundBtn').onclick = () => { $('soundBtn').textContent = audio.toggle() ? '🔊' : '🔇'; };
// the name box shows the portal identity; clicking it opens the account dialog
$('nameInput').readOnly = true;
$('nameInput').title = 'Your name in every game - click to change';
$('nameInput').onclick = () => OIID.open();
OIID.me().then(id => { if (id) $('nameInput').value = id.name; });
OIID.onChange(id => { $('nameInput').value = id ? id.name : ''; if (id && net.open) net.ws.send(JSON.stringify({ t: 'hello', name: id.name, token: id.token, livery, plane: planeType, map: mapId })); });
document.querySelectorAll('.tab').forEach(t => t.onclick = () => { document.querySelectorAll('.tab').forEach(x => x.classList.toggle('sel', x === t)); $('boardRaceT').style.display = t.dataset.t === 'race' ? '' : 'none'; $('boardLandT').style.display = t.dataset.t === 'land' ? '' : 'none'; $('boardHitsT').style.display = t.dataset.t === 'hits' ? '' : 'none'; });
renderLiveries();
if (W.isCivil(planeType)) lastCivil = planeType;
if (mapId === 'peace') craters.clear();
applyWorld();
renderPlanes(); renderMaps();
setOnline();
connect();

// menu backdrop: the aircraft parked at the threshold, camera orbiting slowly
ac.reset({ ...freeSpot(), yaw: 0, onGround: true });

// ---------- main loop
let last = performance.now(), acc = 0, frames = 0, fpsT = 0, fps = 60;
let camHold = null;                                   // tests: pin the camera
// ---------- bomb cam: a pop-up on the right side that rides behind our own bomb while it falls, then holds on the blast
const bombCam = { cam: new THREE.PerspectiveCamera(48, 4 / 3, 0.3, 60000), b: null, landing: false, hold: 0, pos: new THREE.Vector3(), look: new THREE.Vector3(), want: new THREE.Vector3(), fresh: true, on: false, box: null, txt: '', el: document.createElement('div') };
bombCam.el.style.cssText = 'position:absolute;display:none;box-sizing:border-box;border:2px solid #ffc83a;border-radius:8px;box-shadow:0 4px 22px rgba(0,0,0,.55);pointer-events:none;z-index:6;overflow:hidden';
bombCam.el.innerHTML = '<div style="position:absolute;left:0;right:0;top:0;padding:3px 8px;font:700 11px/1.3 Arial,sans-serif;letter-spacing:.08em;color:#ffc83a;background:linear-gradient(#000a,#0000);text-shadow:0 1px 2px #000">BOMB CAM</div><div style="position:absolute;left:0;right:0;bottom:0;padding:10px 8px 3px;font:700 12px/1.3 Arial,sans-serif;color:#fff;background:linear-gradient(#0000,#000b);text-shadow:0 1px 2px #000"></div>';
document.querySelector('.stage').appendChild(bombCam.el);
bombCam.info = bombCam.el.lastChild;
/** Which bomb to watch: the oldest of ours still falling; when it lands, hold the view on the impact for a moment, then the next one or nothing. */
function updateBombCam(dt) {
  const B = bombCam;
  if (state !== 'flying' && state !== 'paused') { B.b = null; B.landing = false; B.hold = 0; B.on = false; return; }
  if (B.b && !B.b.ended) {
    B.last = B.b.sim.p.slice(); B.vel = B.b.sim.v.slice();
  } else {
    if (B.b && !B.landing) { B.landing = true; B.hold = 3; }
    const next = bombs.list.find(b => b.mine && !b.ended);
    if (next) { B.b = next; B.hdir = null; B.up = null; B.landing = false; B.hold = 0; B.fresh = B.fresh || !B.on; B.last = next.sim.p.slice(); B.vel = next.sim.v.slice(); { const r = new THREE.Vector3(1, 0, 0).applyQuaternion(plane.root.quaternion); r.y = 0; B.side = r.lengthSq() > 1e-4 ? r.normalize().toArray() : [1, 0, 0]; } }
    else if (B.landing && B.hold > 0) B.hold -= dt;
    else { B.b = null; B.landing = false; }
  }
  B.on = !!B.b;
  if (!B.on) { B.fresh = true; return; }
  if (!B.landing) {                                              // ride straight behind the falling bomb, on its tail, looking down its flight path at where it is going
    const v = B.vel, l = Math.hypot(...v) || 1, p = B.last;
    B.want.set(p[0] - v[0] / l * 5.5, p[1] - v[1] / l * 5.5 + 0.7, p[2] - v[2] / l * 5.5);
    B.pos.copy(B.want);                                            // a rigid chase: smoothing would trail a bomb falling at 130 m/s
  }
  const g = field.at(B.pos.x, B.pos.z); if (B.pos.y < g + 1.5) B.pos.y = g + 1.5;
  if (B.landing) B.look.set(B.last[0], B.last[1], B.last[2]);
  else {
    const v = B.vel, l = Math.hypot(...v) || 1, hl = Math.hypot(v[0], v[2]), dy = Math.abs(v[1]) / l;
    if (hl > 0.5) B.hdir = [v[0] / hl, v[2] / hl];
    const hd = B.hdir || [0, 1];                                   // steep fall: the top of the picture tips toward where the bomb is heading (world up alone would spin the view)
    B.up = [hd[0] * dy, 1 - dy, hd[1] * dy];
    B.look.set(B.last[0] + v[0] / l * 40, B.last[1] + v[1] / l * 40, B.last[2] + v[2] / l * 40); }   // the bomb sits just below the centre, its target ahead
}
function renderBombCam() {
  const B = bombCam;
  B.el.style.display = B.on ? 'block' : 'none';
  if (!B.on) { B.box = null; return; }
  const r = canvas.getBoundingClientRect(), sz = renderer.getSize(new THREE.Vector2());
  const w = Math.round(Math.min(380, r.width * 0.3)), h = Math.round(w * 0.75), left = Math.round(r.width - w - 14), top = Math.round(r.height * 0.3);
  Object.assign(B.el.style, { left: left + 'px', top: top + 'px', width: w + 'px', height: h + 'px' });
  const k = sz.x / r.width, vx = left * k, vy = (r.height - top - h) * k, vw = w * k, vh = h * k;
  B.cam.aspect = w / h; B.cam.position.copy(B.pos); if (B.up) B.cam.up.set(...B.up).normalize(); else B.cam.up.set(0, 1, 0); B.cam.lookAt(B.look); B.cam.updateProjectionMatrix();
  renderer.setScissorTest(true); renderer.setViewport(vx, vy, vw, vh); renderer.setScissor(vx, vy, vw, vh);
  renderer.render(scene, B.cam);
  renderer.setScissorTest(false); renderer.setViewport(0, 0, sz.x, sz.y);
  B.box = { left, top, w, h, rw: r.width };
  const alt = Math.max(0, Math.round(B.look.y - Math.max(0, field.at(B.look.x, B.look.z)))), txt = B.landing ? 'IMPACT' : `${alt} m above ground · ${Math.round(Math.hypot(...B.vel))} m/s`;
  if (txt !== B.txt) { B.txt = txt; B.info.textContent = txt; }
}

function loop(now) {
  const dt = Math.min(0.25, (now - last) / 1000); last = now;            // slow frames still fly in real time
  frames++; fpsT += dt; if (fpsT > 0.5) { fps = Math.round(frames / fpsT); frames = 0; fpsT = 0; }
  if (state === 'flying' && !paused) {
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 15) { gameStep(); acc -= STEP; n++; }
    if (n === 15) acc = 0;
  } else if (state === 'result' && ac.crashed) { simTime += dt; birds.update(dt, birdView()); }
  else acc = 0;

  if (mapId === 'carrier') { if (state === 'menu') carrier.park(ac, myTeam(), (net.id || 0) % 9); carrier.update(dt, now / 1000, camera, fx); if (!net.open) carrier.offlineHelm(state === 'flying' && !ac.crashed ? { team: myTeam(), p: ac.pos, v: ac.vel, bomb: hasBombs() && bombsLeft > 0 ? curBomb() : null } : null); if (net.ws && net.ws.readyState === 1) carrier.flushStrafe(m => net.ws.send(JSON.stringify(m))); }      // the menu's aircraft rides its carrier
  // the model follows the physics
  plane.root.position.set(...ac.pos);
  plane.root.quaternion.set(...ac.q);
  if (plane.hook) plane.hook.rotation.x = carrier.hookPos * 0.8;
  if (plane.rack) plane.rack.bomb.visible = bombsLeft > 0;
  if (plane.pylonBombs) plane.pylonBombs.forEach((b, i) => { b.visible = i >= rackCount() - bombsLeft; });
  if (!plane.broken) animatePlane(plane, ac.defl, ac.crashed ? 0 : ac.engine, dt, !!ac.afterburner && !ac.crashed, ac.gearPos, ac.airbrakePos, bayPos, rackPos);
  if (state === 'flying' && !paused || state === 'result') updateGuns(dt);
  updateMissiles(dt);
  if (!paused) bombs.update(dt);
  if (sightOpen && (ac.crashed || state !== 'flying')) sight.close();
  trackFlight(state === 'flying' && !paused ? dt : 0);
  sight.tick(dt);
  craters.update(dt, camera.position);
  updateBombHud(dt);
  updateBombCam(dt);
  birds.render();
  if (state === 'menu' && mapId === 'carrier') { carrier.menuCamera(camera, myTeam(), now); plane.cockpitGroup.visible = false; }
  else if (state === 'menu') {
    const t = now / 1000 * 0.12;
    const R = ac.spec.cam.dist * 1.15;
    camera.position.set(ac.pos[0] + Math.sin(t) * R, ac.pos[1] + ac.spec.cam.height * 1.2 + Math.sin(t * 0.7), ac.pos[2] + Math.cos(t) * R);
    camera.up.set(0, 1, 0); camera.lookAt(ac.pos[0], ac.pos[1] + 0.5, ac.pos[2]); camera.fov = 55; camera.updateProjectionMatrix();
    plane.cockpitGroup.visible = false;
  } else updateCamera(dt);
  if (camHold) { camera.position.set(camHold[0], camHold[1], camHold[2]); camera.lookAt(camHold[3], camHold[4], camHold[5]); camera.fov = camHold[6] || 60; camera.updateProjectionMatrix(); plane.cockpitGroup.visible = false; }
  // the sun's shadow box follows the aircraft
  sun.position.set(ac.pos[0] + SUN.x * 300, ac.pos[1] + SUN.y * 300, ac.pos[2] + SUN.z * 300);
  sun.target.position.set(...ac.pos);
  world.update(dt, now / 1000, camera.position, ac.wind, ac.pos);
  world.updateWind(ac.wind);
  play.update(dt, now / 1000);
  updateEffects(dt);
  updateOthers(dt);
  if (mapId === 'carrier' && state === 'flying') { carrier.updateNav(ac, myTeam()); }
  sendState();
  audio.update({ engine: state === 'menu' ? 0 : ac.engine, ias: ac.ias, stall: ac.stall, warn: state === 'flying' && !ac.onGround && stallWarning(), rolling: ac.onGround ? ac.speed : 0, crashed: !!ac.crashed || state === 'menu', alpha: ac.alpha, jet: ac.spec.engine.kind === 'jet', fan: !!ac.spec.engine.noAB, afterburner: !!ac.afterburner });
  renderer.render(scene, camera);
  renderBombCam();
  (mapId === 'carrier' ? carrierHud : hud).draw(state === 'flying' || state === 'paused' ? hudState() : null);
  if (bombCam.box) { const b = bombCam.box, k = hud.c.width / b.rw; (mapId === 'carrier' ? carrierHud : hud).g.clearRect((b.left - 3) * k, (b.top - 3) * k, (b.w + 6) * k, (b.h + 6) * k); }      // the HUD leaves the pop-up clear
  $('fps').textContent = `${fps} fps`;
  requestAnimationFrame(loop);
}
fixDoubleSided(scene);                                              // every transparent two-sided surface built so far (see MergeStatic.js)
resize();
$('loading').style.display = 'none';
showPanel('pMenu');
requestAnimationFrame(loop);

// test hook (automated tests only): read-only state + a way to start a mode
window.FS = {
  get state() { const a = ac.attitude; return { state, mode, pos: ac.pos.map(v => +v.toFixed(1)), speed: +ac.speed.toFixed(1), alt: +ac.pos[1].toFixed(1), agl: +ac.agl.toFixed(1), heading: +(a.heading / DEG).toFixed(1), pitch: +(a.pitch / DEG).toFixed(1), bank: +(a.bank / DEG).toFixed(1), crashed: ac.crashed && ac.crashed.reason, race: race && { next: race.next, time: +race.time.toFixed(2), done: race.done }, landing: landing && { touched: !!landing.touch, done: landing.done }, online: net.open, others: net.others.size, fps, cam: CAMS[camMode], g: +ac.g.toFixed(2) }; },
  bombCam, start, ac, ctl, world, play, guns, fx, birds, craters, bombs, sight, DM, BM, onBoom, localBoom, openSight, startBombRun, get bombsLeft() { return bombsLeft; },
  onShot, THREE, scene, net, turret, guns2: () => ({ hits: [...gun.hits] }),
  camera, setCam: (...a) => { camHold = a; },
    tick: dt => { for (let i = 0; i < Math.round(dt / STEP); i++) gameStep(); bombs.update(dt); craters.update(dt, camera.position); updateEffects(dt); updateGuns(dt); },      // run the simulation by hand (tests) THREE, qFromEuler: FP.qFromEuler, qrot: FP.qrot,
  others: () => [...net.others.values()].map(o => ({ pos: o.model.root.position, mode: o.mode, flags: o.flags })), gun: () => ({ ammo: gun.ammo, firing: gun.firing }), damage: () => damage.n,
  dist: () => { const o = [...net.others.values()][0]; return o ? o.model.root.position.distanceTo(new THREE.Vector3(...ac.pos)) : -1; },
  setPlane: t => setPlane(t), get planeType() { return planeType; },
  setMap, get mapId() { return mapId; }, carrier, carrierHud, shield, weaponsHold, protectedNow, onSky, hudState: () => hudState(), setRadar: i => { radarIdx = i; },
  trackFlight, eruption, missiles, msl, fireMissile, dispenseFlares, get netId() { return net.id; }, renderer, hud,
};
