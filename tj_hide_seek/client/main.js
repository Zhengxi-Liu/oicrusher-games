/**
 * TJ Hide and Seek - client entry point.
 *   - builds TJHSST from the traced floor plans (SchoolBuilder), first / third person walking (Player)
 *   - one persistent online school (server/HideServer.js): every stash stays hidden until someone opens it
 *   - H: hide one of 8 items where you aim, with a note · E: inspect a stash (close-up + Post-it note)
 *   - live log, leaderboard, minimap with the floor navigator, full map (M), other students walking around
 *   - chess club in Room 23 (floor 1): E at a table plays that student bot; the server runs the game (server/Chess.js)
 *   - Shoot Around in Gym 1 / Gym 2: E at the ball under a hoop, threes only; the server replays every shot (shared/Hoops.js)
 *   - Enter: school-wide chat (a bubble over the speaker too) · I: write over the whiteboard you look at (kept by the server)
 * Works offline too (walk around, but hiding / finding needs the server).
 */
import * as THREE from 'three';
import { SchoolBuilder } from './SchoolBuilder.js?v=10';
import { Player } from './Player.js?v=1';
import { Minimap } from './Minimap.js?v=2';
import { ITEM_TYPES, buildItem, ghostOf } from './Items.js?v=1';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const params = new URLSearchParams(location.search);
const REACH = 2.5;

// ---------------------------------------------------------------- renderer, scene
const canvas = $('view');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); }
catch (e) { $('loading').textContent = 'WebGL is not available in this browser, so the 3D school cannot load.'; throw e; }
let pixelRatio = Math.min(1.5, window.devicePixelRatio || 1);
try { if (localStorage.getItem('tjhsLowRes') === '1') pixelRatio = 0.75; } catch (e) {}
renderer.setPixelRatio(pixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 1600);
camera.rotation.order = 'YXZ';
scene.background = new THREE.Color(0x9cc4ea);
scene.fog = new THREE.Fog(0xc4dbef, 160, 700);
{ // gradient sky dome
  const g = new THREE.SphereGeometry(1200, 32, 16);
  const m = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: {},
    vertexShader: 'varying vec3 v; void main(){ v = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: 'varying vec3 v; void main(){ float h = clamp(v.y, 0., 1.); vec3 c = mix(vec3(.80,.88,.95), vec3(.27,.50,.84), pow(h,.6)); gl_FragColor = vec4(c,1.); }' });
  scene.add(new THREE.Mesh(g, m));
}
scene.add(new THREE.HemisphereLight(0xeef4ff, 0x8a8170, 1.25));
scene.add(new THREE.AmbientLight(0xffffff, 0.35));
const sun = new THREE.DirectionalLight(0xfff2dc, 1.3); sun.position.set(-120, 200, 80); scene.add(sun);
const spot = new THREE.SpotLight(0xfff6e0, 0, 4, 0.5, 0.6, 1.2); scene.add(spot, spot.target);

function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

// ---------------------------------------------------------------- the school
$('loading').textContent = 'Building TJ from the floor plans…';
const map = window.TJMap.build();
const builder = new SchoolBuilder(map, renderer);
const { surfaces, boards } = builder.build(scene);
const player = new Player(canvas, map);
const minimap = new Minimap(map, $('minimap'));
// surfaces bucketed for the hide ray
const SURF = new Map();
surfaces.forEach(s => {
  const r = Math.hypot(s.hx, s.hz);
  for (let x = Math.floor((s.x - r) / 4); x <= Math.floor((s.x + r) / 4); x++) for (let z = Math.floor((s.z - r) / 4); z <= Math.floor((s.z + r) / 4); z++) {
    const k = x * 4096 + z; let l = SURF.get(k); if (!l) SURF.set(k, l = []); l.push(s);
  }
});
const at = params.get('at');
if (at) {                      // testing: ?at=x,z,floor&look=yaw,pitch
  const [x, z, f] = at.split(',').map(Number); player.teleport(x, f === 2 ? map.F2Y : 0, z);
  const lk = (params.get('look') || '').split(',').map(Number);
  if (Number.isFinite(lk[0])) player.yaw = lk[0];
  if (Number.isFinite(lk[1])) player.pitch = lk[1];
}
$('loading').style.display = 'none';

// ---------------------------------------------------------------- students (avatars)
const SHIRTS = [0x9b1b30, 0x1c2b4f, 0x4a90d9, 0x6d6f74, 0xf2f2ee, 0x7a1f2b, 0x2e7d5b, 0xe0a030, 0x58307a, 0x2b2b2b, 0x3f72af, 0xc0392b, 0x8e9aaf, 0x1f6f8b, 0xd4a5a5, 0x355c7d];
const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0xd9a066];
function makeStudent(look, name) {
  const g = new THREE.Group();
  const mat = c => new THREE.MeshLambertMaterial({ color: c });
  const shirt = mat(SHIRTS[look % SHIRTS.length]), pants = mat(look % 3 ? 0x2c3550 : 0x3b3b3b), skin = mat(SKIN[(look * 7) % SKIN.length]);
  const box = (w, h, d, m, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); return b; };
  const legL = new THREE.Group(), legR = new THREE.Group(); legL.position.set(-0.1, 0.85, 0); legR.position.set(0.1, 0.85, 0);
  legL.add(box(0.15, 0.85, 0.17, pants, 0, -0.425, 0)); legR.add(box(0.15, 0.85, 0.17, pants, 0, -0.425, 0));
  legL.add(box(0.16, 0.08, 0.26, mat(0xf4f4f4), 0, -0.82, 0.04)); legR.add(box(0.16, 0.08, 0.26, mat(0xf4f4f4), 0, -0.82, 0.04));
  const armL = new THREE.Group(), armR = new THREE.Group(); armL.position.set(-0.27, 1.42, 0); armR.position.set(0.27, 1.42, 0);
  armL.add(box(0.12, 0.6, 0.14, shirt, 0, -0.3, 0), box(0.1, 0.1, 0.1, skin, 0, -0.64, 0));
  armR.add(box(0.12, 0.6, 0.14, shirt, 0, -0.3, 0), box(0.1, 0.1, 0.1, skin, 0, -0.64, 0));
  const torso = box(0.42, 0.6, 0.24, shirt, 0, 1.15, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 10), skin); head.position.y = 1.62;
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.148, 14, 8, 0, Math.PI * 2, 0, Math.PI / 1.9), mat([0x2b1d14, 0x4a3020, 0x0f0f0f, 0x8a5a2b][look % 4]));
  hair.position.y = 1.64; hair.rotation.x = -0.25;
  const pack = box(0.34, 0.42, 0.16, mat([0x1c2b4f, 0x9b1b30, 0x222222, 0x3f72af][look % 4]), 0, 1.15, -0.2);
  g.add(legL, legR, armL, armR, torso, head, hair, pack);
  if (name) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 56; const x = c.getContext('2d');
    x.fillStyle = 'rgba(28,43,79,.78)'; x.beginPath(); x.roundRect(4, 6, 248, 44, 12); x.fill();
    x.font = 'bold 26px system-ui, sans-serif'; x.fillStyle = '#fff'; x.textAlign = 'center'; x.fillText(name.slice(0, 16), 128, 38);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: true, transparent: true }));
    label.scale.set(1.0, 0.22, 1); label.position.y = 2.05; g.add(label);
  }
  g.userData = { legL, legR, armL, armR, phase: 0 };
  return g;
}
function animateStudent(s, speed, dt) {
  const u = s.userData; u.phase += dt * speed * 2.6;
  const a = Math.sin(u.phase) * Math.min(0.7, speed * 0.17);
  u.legL.rotation.x = a; u.legR.rotation.x = -a; u.armL.rotation.x = -a * 0.8; u.armR.rotation.x = a * 0.8;
}
let myLook = 0;
try { myLook = Number(localStorage.getItem('tjhsLook')) || 0; } catch (e) {}
let selfModel = makeStudent(myLook); selfModel.visible = false; scene.add(selfModel);

// ---------------------------------------------------------------- whiteboards players wrote on, chat bubbles
const BOARDS = new Map(boards.map(b => [b.key, b]));
const written = new Map();      // key -> {b: {text, by, at}, mesh}
const MARKER = ['#1d3d8f', '#111', '#a3122a', '#1d7a3a'];
/** Wrap text to lines that fit maxW at the current font (CJK breaks anywhere, words elsewhere). */
function wrap(g, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const tok of para.match(/[\u2e80-\u9fff\uff00-\uffef]|\S+|\s+/g) || ['']) {
      const t = line + tok;
      if (g.measureText(t).width <= maxW || !line.trim()) { line = t; continue; }
      out.push(line.trimEnd()); line = tok.trimStart();
    }
    out.push(line.trimEnd());
  }
  return out;
}
function boardCanvas(b, rec) {
  const W = 1024, H = Math.round(W * (rec.y1 - rec.y0) / rec.w);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#9aa0a8'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#fbfcfd'; g.fillRect(12, 12, W - 24, H - 40);
  g.fillStyle = 'rgba(160,170,190,.035)'; for (let k = 0; k < 4; k++) g.fillRect(40 + Math.random() * 800, 30 + Math.random() * (H - 120), 120 + Math.random() * 160, 26);   // old smudges
  g.fillStyle = '#7d838b'; g.fillRect(12, H - 26, W - 24, 16);
  const font = s => `700 ${s}px Caveat, "Comic Sans MS", "Chalkboard SE", cursive`;
  // the biggest marker size that fits the board
  let size = 96, lines;
  for (; size > 22; size -= 4) {
    g.font = font(size); lines = wrap(g, b.text, W - 90);
    if (lines.length * size * 1.08 <= H - 110) break;
  }
  g.textBaseline = 'top';
  const top = 26 + Math.max(0, (H - 110 - lines.length * size * 1.08) / 2) * 0.4;
  lines.forEach((l, i) => { g.fillStyle = MARKER[i % MARKER.length]; g.fillText(l, 44, top + i * size * 1.08); });
  g.font = font(30); g.fillStyle = '#a3122a'; g.textAlign = 'right'; g.fillText(`- ${b.by}`, W - 40, H - 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function setBoard(key, b) {
  const rec = BOARDS.get(key); if (!rec) return;
  const old = written.get(key);
  if (old) { scene.remove(old.mesh); old.mesh.material.map.dispose(); old.mesh.material.dispose(); old.mesh.geometry.dispose(); written.delete(key); }
  if (!b) return;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(rec.w, rec.y1 - rec.y0), new THREE.MeshLambertMaterial({ map: boardCanvas(b, rec) }));
  mesh.position.set(rec.x + rec.n[0] * 0.004, (rec.y0 + rec.y1) / 2, rec.z + rec.n[1] * 0.004);
  mesh.rotation.y = Math.atan2(rec.n[0], rec.n[1]);
  scene.add(mesh);
  written.set(key, { b, mesh });
}
const fontsReady = (document.fonts && document.fonts.load ? document.fonts.load('700 40px Caveat') : Promise.resolve()).catch(() => {});
function setBoards(all) {
  for (const k of [...written.keys()]) if (!all[k]) setBoard(k, null);
  fontsReady.then(() => { for (const [k, b] of Object.entries(all)) { const w = written.get(k); if (!w || w.b.at !== b.at) setBoard(k, b); } });
}
/** The whiteboard under the crosshair, within 3.5 m and not behind a wall. */
function findBoard() {
  const cam = player.camera();
  fwd.set(0, 0, -1).applyEuler(new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ'));
  let best = null, bt = 3.5;
  for (const r of boards) {
    if (r.floor !== player.floor || Math.hypot(r.x - cam.x, r.z - cam.z) > 7) continue;
    const den = fwd.x * r.n[0] + fwd.z * r.n[1];
    if (den > -0.15) continue;                              // looking at it from the front only
    const t = ((r.x - cam.x) * r.n[0] + (r.z - cam.z) * r.n[1]) / den;
    if (t <= 0 || t > bt) continue;
    const hx = cam.x + fwd.x * t, hy = cam.y + fwd.y * t, hz = cam.z + fwd.z * t;
    if (hy < r.y0 - 0.25 || hy > r.y1 + 0.25 || Math.abs((hx - r.x) * r.d[0] + (hz - r.z) * r.d[1]) > r.w / 2 + 0.2) continue;
    if (player.rayBlocked(player.pos.x, player.pos.z, hx + r.n[0] * 0.25, hz + r.n[1] * 0.25, Math.min(hy, player.pos.y + 1.5)) !== null) continue;
    best = r; bt = t;
  }
  return best;
}
function bubble(o, text) {
  if (o.bubble) o.model.remove(o.bubble.sprite);
  const c = document.createElement('canvas'); c.width = 512; c.height = 160;
  const g = c.getContext('2d');
  g.font = '600 30px system-ui, sans-serif';
  const lines = wrap(g, text, 470).slice(0, 3);
  if (lines.length === 3 && wrap(g, text, 470).length > 3) lines[2] = lines[2].replace(/.{0,2}$/, '…');
  const w = Math.max(...lines.map(l => g.measureText(l).width)) + 36, h = lines.length * 38 + 22;
  g.fillStyle = 'rgba(255,255,255,.94)'; g.beginPath(); g.roundRect((512 - w) / 2, 160 - h - 14, w, h, 16); g.fill();
  g.beginPath(); g.moveTo(244, 146); g.lineTo(268, 146); g.lineTo(256, 160); g.fill();
  g.fillStyle = '#1c2b4f'; g.textAlign = 'center'; g.textBaseline = 'top';
  lines.forEach((l, i) => g.fillText(l, 256, 160 - h - 14 + 12 + i * 38));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: true }));
  sprite.scale.set(1.9, 0.594, 1); sprite.position.y = 2.5;
  o.model.add(sprite);
  o.bubble = { sprite, until: performance.now() + 7000 };
}

// ---------------------------------------------------------------- items in the world
const items = new Map();     // id -> {d, obj, ring}
const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.7, depthWrite: false });
function addItem(d) {
  if (items.has(d.id)) return;
  const obj = buildItem(d.type);
  obj.position.set(d.p[0], d.p[1], d.p[2]); obj.rotation.y = d.rot || 0;
  scene.add(obj);
  let ring = null;
  if (d.mine) { ring = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.27, 24).rotateX(-Math.PI / 2), ringMat); ring.position.set(d.p[0], d.p[1] + 0.01, d.p[2]); scene.add(ring); }
  items.set(d.id, { d, obj, ring });
}
function removeItem(id) {
  const it = items.get(id); if (!it) return;
  if (inspect && inspect.id === id) return;           // keep it on screen while we look at it
  scene.remove(it.obj); if (it.ring) scene.remove(it.ring);
  items.delete(id);
}

// ---------------------------------------------------------------- network
const net = { ws: null, open: false, id: 0, me: null, players: new Map(), others: new Map(), board: [], lastSend: 0, everConnected: false, retry: 0 };
function wsUrl() { return params.get('ws') || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/game/tjhs-ws`; }
function send(m) { if (net.open) net.ws.send(JSON.stringify(m)); }
let playing = false;
const canHello = () => !!OIID.token && OIID.registered;     // TJ is for registered players only (the server checks too)
// the name the school knows us by (the server may have renamed us)
const myName = () => (net.me && net.me.name) || OIID.name;
function hello() { send({ t: 'hello', name: OIID.name || 'Student', token: OIID.token, look: myLook, play: playing }); }
function connect() {
  if (net.ws) return;
  let ws; try { ws = new WebSocket(wsUrl()); } catch (e) { return; }
  net.ws = ws;
  ws.onopen = () => { net.open = true; net.everConnected = true; net.retry = 0; if (canHello()) hello(); setNet(); };
  ws.onclose = () => {
    net.open = false; net.ws = null;
    for (const o of net.others.values()) scene.remove(o.model);
    net.others.clear(); setNet();
    setTimeout(connect, Math.min(30000, 3000 * ++net.retry));
  };
  ws.onerror = () => {};
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (err) { return; } onMsg(m); };
}
function onMsg(m) {
  switch (m.t) {
    case 'welcome':
      net.id = m.id; net.me = m.me; net.board = m.board; net.admin = !!m.admin;
      $('modBtn').classList.toggle('show', net.admin); $('kwBtn').classList.toggle('show', net.admin);
      for (const id of [...items.keys()]) removeItem(id);
      m.items.forEach(addItem);
      feedReset('log', m.log);
      feedReset('chat', m.chat || []);
      setBoards(m.boards || {});
      renderBoard(); renderMe(); setNet();
      break;
    case 'peek': if (!net.me) { net.board = m.board; net.peekOnline = m.online; renderBoard(); setNet(); feedReset('log', m.log); } break;
    case 'players': net.players = new Map(m.list.map(p => [p.id, p])); setNet(); break;
    case 'pl': onPlayers(m.p); break;
    case 'item+': addItem(m.item); break;
    case 'item-': removeItem(m.id); break;
    case 'log': addLog(m.e); break;
    case 'hist': feedOlder(m.k, m.list, m.more); break;
    case 'board': net.board = m.board; renderBoard(); break;
    case 'me': net.me = m.me; renderMe(); if (m.note) toast(m.note); break;
    case 'hideResult':
      if (m.ok) { net.me = m.me; renderMe(); toast('Hidden! It stays there until someone finds it.'); sfx('hide'); }
      else toast(m.msg, true);
      break;
    case 'opened': onOpened(m); break;
    case 'chat': addChat(m.e); break;
    case 'chatMod': renderMod(m.list); break;
    case 'mod': renderKw(m); break;
    case 'modTest': showKwTest(m); break;
    case 'chatDel': onChatDel(m.cids); break;
    case 'chatEdit': onChatEdit(m.e); break;           // Gemini flagged it: the line now reads "I love TJ"
    case 'rename': onRename(m.from, m.to); break;      // Gemini flagged a username
    case 'chatErr': toast(m.msg, true); break;
    case 'chess': onChess(m); break;
    case 'hoopShot': onHoopShot(m); break;
    case 'hoopBoard':
      net.hoopBoard = m.list;
      if (m.me && shoot) { shoot.best = m.me.best; shoot.streak = m.me.streak; }
      renderHoopHud(); break;
    case 'chessErr': toast(m.msg, true); break;
    case 'wb': fontsReady.then(() => setBoard(m.key, m.b)); break;
    case 'wbResult':
      if (m.ok) { toast(m.wiped ? 'Board erased - the lesson is back.' : 'Written! Everyone in TJ can read it now.'); sfx('hide'); }
      else toast(m.msg, true);
      break;
    case 'error':
      if (m.needAccount) {                           // guests cannot play: back to the menu, ask them to log in
        playing = false;
        if (state !== 'menu') { state = 'menu'; player.active = false; player.unlock(); setPanel('menu'); }
      }
      if (m.blocked) {                               // the keyword filter rejected the player's name: back to the menu
        playing = false;
        if (state !== 'menu') { state = 'menu'; player.active = false; player.unlock(); setPanel('menu'); }
        alert(m.msg);
      }
      $('netState').textContent = m.msg; toast(m.msg, true); break;
  }
}
function setNet() {
  const n = net.players.size || net.peekOnline || 0;
  $('netState').innerHTML = net.open ? `<span class="dot on"></span>${n} student${n === 1 ? '' : 's'} in TJ` : `<span class="dot"></span>${net.everConnected ? 'reconnecting…' : 'offline - you can explore, but hiding and finding need the server'}`;
  $('online').textContent = net.open ? `${n} online` : 'offline';
}
function onPlayers(p) {
  const now = performance.now(), seen = new Set();
  for (let i = 0; i < p.length; i += 6) {
    const id = p[i]; if (id === net.id) continue;
    seen.add(id);
    let o = net.others.get(id);
    const info = net.players.get(id) || { name: '?', look: 0 };
    if (!o || o.name !== info.name || o.look !== info.look) {
      if (o) scene.remove(o.model);
      o = { model: makeStudent(info.look, info.name), name: info.name, look: info.look, buf: [], last: null };
      scene.add(o.model); net.others.set(id, o);
    }
    o.buf.push({ t: now, x: p[i + 1], y: p[i + 2], z: p[i + 3], yaw: p[i + 4] });
    if (o.buf.length > 12) o.buf.shift();
  }
  for (const [id, o] of net.others) if (!seen.has(id) && now - (o.buf.length ? o.buf[o.buf.length - 1].t : 0) > 3000) { scene.remove(o.model); net.others.delete(id); }
}
function updateOthers(dt) {
  const t = performance.now() - 150;
  for (const o of net.others.values()) {
    const b = o.buf; if (!b.length) continue;
    let i = b.length - 1; while (i > 0 && b[i - 1].t > t) i--;
    const s1 = b[i], s0 = b[Math.max(0, i - 1)];
    const f = s1.t === s0.t ? 1 : Math.max(0, Math.min(1.2, (t - s0.t) / (s1.t - s0.t)));
    const x = s0.x + (s1.x - s0.x) * f, y = s0.y + (s1.y - s0.y) * f, z = s0.z + (s1.z - s0.z) * f;
    let dy = s1.yaw - s0.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const prev = o.model.position.clone();
    o.model.position.set(x, y, z); o.model.rotation.y = s0.yaw + dy * f + Math.PI;
    animateStudent(o.model, prev.distanceTo(o.model.position) / Math.max(dt, 1e-3), dt);
  }
}
function sendState() {
  if (!net.open || performance.now() - net.lastSend < 100) return;
  net.lastSend = performance.now();
  send({ t: 'st', p: [player.pos.x, player.pos.y, player.pos.z].map(v => Math.round(v * 100) / 100), yaw: Math.round(player.yaw * 100) / 100, c: player.crouch > 0.5 ? 1 : 0 });
}

// ---------------------------------------------------------------- HUD: log, board, stats, toasts
const floorName = f => `Floor ${f}`;
const roomName = n => (/^\d/.test(n) ? `Room ${n}` : n);
function logLine(e) {
  const nm = n => `<b>${esc(n)}</b>`;
  const type = ITEM_TYPES[e.type] ? ITEM_TYPES[e.type].name : 'something';
  let h;
  if (e.k === 'found') h = `🔍 ${nm(e.by)} found ${nm(e.owner)}'s ${esc(type)} on ${floorName(e.floor)}${e.where ? ` <i>(${esc(e.where)})</i>` : ''}!`;
  else if (e.k === 'hid') h = `🤫 ${nm(e.by)} hid something somewhere on ${floorName(e.floor)}…`;
  else if (e.k === 'join') h = `👋 ${nm(e.by)} walked into TJ`;
  else if (e.k === 'hoops') h = `🏀 ${nm(e.by)} hit ${e.streak} threes in a row in ${esc(e.where)} - new school record!`;
  else if (e.k === 'chess') h = `♟️ ${nm(e.by)} beat ${nm(e.bot)} <i>(${esc(e.label)})</i> at chess in Room 23!`;
  else if (e.k === 'wb') h = `✏️ ${nm(e.by)} wrote on the whiteboard in ${esc(roomName(e.where))} <i>(${floorName(e.floor)})</i>`;
  else return null;
  const el = document.createElement('div'); el.className = 'logline'; el.innerHTML = stamp(e.at) + h;
  return el;
}
function chatLine(e) {
  const el = document.createElement('div'); el.className = 'chatline' + (e.by === myName() ? ' mine' : '');
  el.innerHTML = `${stamp(e.at)}<b>${esc(e.by)}</b>: ${esc(e.text)}`;
  if (e.cid) el.dataset.cid = e.cid;
  return el;
}
function stamp(at) {
  if (!at) return '';
  const d = new Date(at), p = n => String(n).padStart(2, '0'), today = d.toDateString() === new Date().toDateString();
  return `<time>${today ? '' : `${d.getMonth() + 1}/${d.getDate()} `}${p(d.getHours())}:${p(d.getMinutes())}</time>`;
}

// the two feeds: always on screen, newest at the bottom; scrolling to the top asks the server for the page before
const FEED_KEEP = 400, HIST_PAGE = 50;
const feeds = {
  log: { box: $('logBox'), list: $('logList'), line: logLine, glow: 14000 },
  chat: { box: $('chatBox'), list: $('chatList'), line: chatLine, glow: 5000 },
};
const atBottom = f => f.list.scrollHeight - f.list.scrollTop - f.list.clientHeight < 24;
function toBottom(f) { f.list.scrollTop = f.list.scrollHeight; f.box.classList.remove('unread'); }
function histMark(f) {
  if (f.more || f.list.querySelector('.hist')) return;
  const el = document.createElement('div'); el.className = 'hist'; el.textContent = '— start of history —';
  f.list.prepend(el);
}
function feedReset(k, list) {
  const f = feeds[k];
  f.list.innerHTML = ''; f.oldest = Infinity; f.more = list.length >= HIST_PAGE; f.asking = false;
  for (const e of list) { const el = f.line(e); if (el) { el._at = e.at; f.list.appendChild(el); } if (e.at < f.oldest) f.oldest = e.at; }
  histMark(f);
  toBottom(f);
}
function feedAdd(k, e) {
  const f = feeds[k], el = f.line(e);
  if (!el) return false;
  const stick = atBottom(f);
  el.classList.add('new'); setTimeout(() => el.classList.remove('new'), f.glow);
  f.list.appendChild(el);
  if (e.at && !(f.oldest <= e.at)) f.oldest = e.at;
  if (f.list.children.length > FEED_KEEP && stick) {          // trim only while reading the newest, never under the reader's eyes
    f.list.querySelector('.hist')?.remove();
    while (f.list.children.length > FEED_KEEP) f.list.firstChild.remove();
    f.more = true; f.oldest = Infinity;
    for (const c of f.list.children) if (c._at < f.oldest) f.oldest = c._at;
  }
  el._at = e.at;
  if (stick) toBottom(f); else f.box.classList.add('unread');
  return true;
}
function feedOlder(k, list, more) {
  const f = feeds[k];
  if (!f) return;
  f.asking = false; f.more = !!more;
  const h0 = f.list.scrollHeight, first = f.list.firstChild, frag = document.createDocumentFragment();
  for (const e of list) {
    if (!(e.at < f.oldest)) continue;
    const el = f.line(e); if (el) { el._at = e.at; frag.appendChild(el); }
  }
  for (const e of list) if (e.at < f.oldest) f.oldest = e.at;
  f.list.insertBefore(frag, first);
  f.list.scrollTop += f.list.scrollHeight - h0;              // keep what the reader was looking at in place
  histMark(f);
  if (f.more && f.list.scrollTop < 30) askOlder(k);           // that page was all hidden kinds: keep going
}
function askOlder(k) {
  const f = feeds[k];
  if (!f.more || f.asking || !net.open || (k === 'chat' && !net.me)) return;
  f.asking = true; setTimeout(() => (f.asking = false), 3000);
  send({ t: 'hist', k, before: f.oldest === Infinity ? Date.now() + 1 : f.oldest });
}
for (const [k, f] of Object.entries(feeds)) {
  f.oldest = Infinity; f.more = false;
  f.list.addEventListener('scroll', () => {
    if (atBottom(f)) f.box.classList.remove('unread');
    if (f.list.scrollTop < 30) askOlder(k);
  });
  f.box.querySelector('.newBtn').onclick = () => toBottom(f);
}
function scrollFeed(k, dy) { const f = feeds[k]; f.list.scrollTop += dy; }
// while the mouse is captured by the game the wheel scrolls the chat (Shift: the events); otherwise just scroll the box under the pointer
addEventListener('wheel', e => { if (player.locked && (state === 'play' || state === 'chat')) scrollFeed(e.shiftKey ? 'log' : 'chat', e.deltaY || e.deltaX); }, { passive: true });

function addLog(e) {
  if (feedAdd('log', e) && (e.k === 'found' || e.k === 'chess') && e.by !== myName()) sfx('ding');
  if (e.k === 'chess' && e.by !== myName()) toast(`♟️ ${e.by} just beat ${e.bot} (${e.label}) at chess!`);
  if (e.k === 'hoops' && e.by !== myName()) toast(`🏀 ${e.by} just hit ${e.streak} threes in a row - new school record!`);
}
function addChat(e) {
  feedAdd('chat', e);
  if (e.by !== myName()) sfx('chat');
  const o = net.others.get(e.id);
  if (o) bubble(o, e.text);
}
// ---------------------------------------------------------------- admin: chat moderation (the server checks the role)
function openMod() {
  if (!net.admin || !net.open) return;
  state = 'mod'; setPanel('modPanel');
  $('modList').innerHTML = '<div class="muted">loading…</div>';
  send({ t: 'chatMod' });
}
function closeMod() { if (state === 'mod') { state = 'menu'; setPanel('menu'); } }
function renderMod(list) {
  const box = $('modList');
  box.innerHTML = list.length ? '' : '<div class="muted">No chat yet.</div>';
  for (const e of list) {
    const el = document.createElement('div'); el.className = 'modline'; el.dataset.cid = e.cid;
    el.innerHTML = `<span class="txt">${stamp(e.at)}<b>${esc(e.by)}</b>: ${esc(e.text)}</span><button data-a="one">Delete</button><button data-a="by">All by ${esc(e.by)}</button>`;
    el.querySelector('[data-a=one]').onclick = () => send({ t: 'chatDel', cid: e.cid });
    el.querySelector('[data-a=by]').onclick = () => { if (confirm(`Delete everything ${e.by} said in the chat?`)) send({ t: 'chatDel', by: e.by }); };
    box.appendChild(el);
  }
  box.scrollTop = box.scrollHeight;
}
function onChatDel(cids) {
  for (const cid of cids) document.querySelectorAll(`[data-cid="${cid | 0}"]`).forEach(el => el.remove());
  if (state === 'mod' && !$('modList').children.length) $('modList').innerHTML = '<div class="muted">No chat yet.</div>';
}
function onChatEdit(e) {
  document.querySelectorAll(`.chatline[data-cid="${e.cid | 0}"]`).forEach(old => { const el = chatLine(e); el._at = old._at; old.replaceWith(el); });
  document.querySelectorAll(`.modline[data-cid="${e.cid | 0}"] .txt`).forEach(t => { t.innerHTML = `${stamp(e.at)}<b>${esc(e.by)}</b>: ${esc(e.text)}`; });
}
function onRename(from, to) {
  document.querySelectorAll('.chatline b, .logline b, .modline b').forEach(b => { if (b.textContent === from) b.textContent = to; });
  renderBoard();
}
$('modBtn').onclick = openMod;
$('modClose').onclick = closeMod;
$('modClear').onclick = () => { if (confirm('Delete ALL chat for everyone? This cannot be undone.')) send({ t: 'chatDel', all: true }); };

// ---------------------------------------------------------------- admin: keyword filter (the server checks the role)
let kw = null, kwTab = 'words';
const KW_CATS = ['profanity', 'vulgar', 'sexual', 'slur', 'hate', 'harassment', 'threat', 'other'];
function openKw() {
  if (!net.admin || !net.open) return;
  state = 'kw'; setPanel('kwPanel'); $('kwErr').textContent = '';
  send({ t: 'modGet' });
}
function closeKw() { if (state === 'kw') { state = 'menu'; setPanel('menu'); } }
function kwSend(m) { send(m); }
function renderKw(m) {
  kw = m; $('kwErr').textContent = m.err || '';
  if (m.err) return;
  for (const b of document.querySelectorAll('#kwTabs button')) b.classList.toggle('sel', b.dataset.tab === kwTab);
  $('kwWords').style.display = kwTab === 'words' ? '' : 'none';
  $('kwExc').style.display = kwTab === 'exc' ? '' : 'none';
  $('kwLog').style.display = kwTab === 'log' ? '' : 'none';
  $('kwTest').style.display = kwTab === 'test' ? '' : 'none';
  if (kwTab === 'words') renderKwWords();
  else if (kwTab === 'exc') renderKwExc();
  else if (kwTab === 'log') renderKwLog();
}
function renderKwWords() {
  const q = $('kwSearch').value.trim().toLowerCase(), lang = $('kwLangF').value, cat = $('kwCatF').value;
  const rows = kw.rules.filter(r => (!q || r.term.toLowerCase().includes(q)) && (!lang || r.lang === lang) && (!cat || r.cat === cat));
  $('kwCount').textContent = `${rows.length} of ${kw.rules.length} keywords` + (rows.length > 150 ? ' (showing 150 - search to narrow)' : '');
  const box = $('kwList'); box.innerHTML = '';
  for (const r of rows.slice(0, 150)) {
    const el = document.createElement('div'); el.className = 'kwrow' + (r.on === false ? ' off' : '');
    el.innerHTML = `<input type="text" class="kt" value="${esc(r.term)}" maxlength="40">
      <select class="kl">${['en', 'py', 'zh'].map(l => `<option ${l === r.lang ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select class="kc">${KW_CATS.map(c => `<option ${c === r.cat ? 'selected' : ''}>${c}</option>`).join('')}</select>
      <select class="km"><option value="word" ${r.mode !== 'sub' ? 'selected' : ''}>whole word</option><option value="sub" ${r.mode === 'sub' ? 'selected' : ''}>inside words</option></select>
      <input type="text" class="ku" value="${esc((r.unless || []).join(', '))}" placeholder="not when inside…" maxlength="200">
      <button data-a="save">Save</button><button data-a="tog">${r.on === false ? 'Turn on' : 'Turn off'}</button><button data-a="del">Delete</button>`;
    const get = () => ({ id: r.id, term: el.querySelector('.kt').value, lang: el.querySelector('.kl').value, cat: el.querySelector('.kc').value, mode: el.querySelector('.km').value, unless: el.querySelector('.ku').value, on: r.on !== false });
    el.querySelector('[data-a=save]').onclick = () => kwSend({ t: 'modRule', op: 'update', rule: get() });
    el.querySelector('[data-a=tog]').onclick = () => kwSend({ t: 'modRule', op: 'update', rule: Object.assign(get(), { on: r.on === false }) });
    el.querySelector('[data-a=del]').onclick = () => { if (confirm(`Delete "${r.term}"?`)) kwSend({ t: 'modRule', op: 'remove', rule: { id: r.id } }); };
    box.appendChild(el);
  }
}
function renderKwExc() {
  const box = $('kwExcList'); box.innerHTML = kw.exceptions.length ? '' : '<div class="muted">None.</div>';
  for (const x of kw.exceptions) {
    const el = document.createElement('div'); el.className = 'kwrow';
    el.innerHTML = `<span class="txt"><b>${esc(x.term)}</b> <span class="muted">${esc(x.note || '')}</span></span><button>Delete</button>`;
    el.querySelector('button').onclick = () => kwSend({ t: 'modExc', op: 'remove', exc: { id: x.id } });
    box.appendChild(el);
  }
}
function renderKwLog() {
  const box = $('kwLogList'); box.innerHTML = kw.log.length ? '' : '<div class="muted">Nothing has been blocked yet.</div>';
  for (const e of kw.log.slice().reverse()) {
    const el = document.createElement('div'); el.className = 'kwrow';
    const d = new Date(e.at);
    el.innerHTML = `<span class="txt"><time>${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
      <b>${esc(e.kind)}</b> by <b>${esc(e.user || '?')}</b> <span class="muted">${esc(e.ip || '')}</span><br>“${esc(e.text)}”<br>
      ${e.action ? `<span class="kwtag">${esc(e.action)}</span> ` : ''}<span class="muted">keywords:</span> ${e.hits.map(h => `<span class="kwtag">${esc(h.term)} <small>${esc(h.cat)}</small></span>`).join(' ')}</span>`;
    box.appendChild(el);
  }
}
function showKwTest(m) {
  $('kwTestOut').innerHTML = m.ok ? '✅ Allowed.' : '🚫 Blocked by: ' + m.hits.map(h => `<span class="kwtag">${esc(h.term)} <small>${esc(h.cat)}</small></span>`).join(' ');
}
$('kwBtn').onclick = openKw;
$('kwClose').onclick = closeKw;
for (const b of document.querySelectorAll('#kwTabs button')) b.onclick = () => { kwTab = b.dataset.tab; if (kw) renderKw(kw); };
for (const id of ['kwSearch', 'kwLangF', 'kwCatF']) $(id).oninput = () => kw && renderKwWords();
$('kwAdd').onclick = () => {
  kwSend({ t: 'modRule', op: 'add', rule: { term: $('kwNew').value, lang: $('kwNewLang').value, cat: $('kwNewCat').value, mode: $('kwNewMode').value, unless: $('kwNewUnless').value } });
  $('kwNew').value = ''; $('kwNewUnless').value = '';
};
$('kwExcAdd').onclick = () => { kwSend({ t: 'modExc', op: 'add', exc: { term: $('kwExcNew').value } }); $('kwExcNew').value = ''; };
$('kwTestBtn').onclick = () => kwSend({ t: 'modTest', text: $('kwTestIn').value });
$('kwTestIn').onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) $('kwTestBtn').click(); };

function renderBoard() {
  const rows = net.board.map((s, i) => `<tr class="${s.name === myName() ? 'me' : ''}"><td>${i + 1}</td><td>${esc(s.name)}</td><td>${s.pts}</td><td>${s.found}</td><td>${s.hidden}</td></tr>`).join('');
  const html = rows || '<tr><td colspan="5" class="muted">Nobody has scored yet - be the first!</td></tr>';
  $('boardBody').innerHTML = html; $('menuBoard').innerHTML = html;
}
function renderMe() {
  const m = net.me; if (!m) return;
  $('myPts').textContent = m.pts; $('myFound').textContent = m.found; $('myOut').textContent = `${m.out}/${m.max}`;
}
let toastT = 0;
function toast(text, bad) { const t = $('toast'); t.textContent = text; t.className = 'show' + (bad ? ' bad' : ''); clearTimeout(toastT); toastT = setTimeout(() => (t.className = ''), 3600); }

// ---------------------------------------------------------------- sound (tiny synth, no files)
let actx = null, muted = false;
try { muted = localStorage.getItem('tjhsMute') === '1'; } catch (e) {}
function sfx(kind) {
  if (muted) return;
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
  const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
  o.connect(g); g.connect(actx.destination);
  const env = (a, d, v) => { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
  if (kind === 'found') { o.type = 'triangle'; o.frequency.setValueAtTime(660, t); o.frequency.setValueAtTime(880, t + 0.12); o.frequency.setValueAtTime(1320, t + 0.24); env(0.01, 0.7, 0.18); }
  else if (kind === 'hide') { o.type = 'sine'; o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(260, t + 0.25); env(0.01, 0.3, 0.15); }
  else if (kind === 'ding') { o.type = 'sine'; o.frequency.setValueAtTime(1046, t); env(0.005, 0.5, 0.06); }
  else if (kind === 'chat') { o.type = 'sine'; o.frequency.setValueAtTime(880, t); o.frequency.setValueAtTime(1175, t + 0.06); env(0.005, 0.18, 0.05); }
  else if (kind === 'step') { o.type = 'square'; o.frequency.setValueAtTime(90 + Math.random() * 30, t); env(0.002, 0.05, 0.012); }
  o.start(t); o.stop(t + 1);
}

// ---------------------------------------------------------------- game state & panels
let state = 'menu';            // menu | play | hide | inspect | map | board | chat | wb
let inspect = null;            // {id, obj, t, from, ...}
let hide = null;               // {spot, type, ghost}
let target = null;             // the stash in reach
let wb = null;                 // the board being written on
const fwd = new THREE.Vector3();

function setPanel(name) {
  for (const id of ['menu', 'hidePanel', 'notePanel', 'mapPanel', 'boardPanel', 'wbPanel', 'modPanel', 'kwPanel', 'chessPanel']) $(id).classList.toggle('show', id === name);
  $('hud').classList.toggle('dim', !!name && name !== 'boardPanel');
}
function play() {
  state = 'play'; setPanel(null); player.active = true; player.lock();
}
function pause() {
  if (state === 'hide') return closeHide();
  if (state === 'inspect') return closeInspect();
  if (state === 'chat') return closeChat();
  if (state === 'wb') return closeWb();
  if (state === 'map' || state === 'board') { state = 'play'; setPanel(null); player.lock(); return; }
  state = 'menu'; player.active = false; player.unlock(); setPanel('menu');
  $('enterBtn').textContent = '▶ Back to TJ';
}
let chatClosedT = 0;           // Esc in the chat box also drops the pointer lock: that must not open the menu as well
player.onUnlock = () => { if (state === 'play' && performance.now() - chatClosedT > 500) pause(); else if (state === 'chat') closeChat(); };

const NEED_ACCOUNT = 'TJ Hide and Seek is for registered players: log in or register (free) to walk in.';
async function enter() {
  const id = await OIID.require({ registered: true, title: 'Log in to play TJ Hide and Seek', note: NEED_ACCOUNT });
  if (!id || !id.registered) return toast(NEED_ACCOUNT, true);
  await OIID.fresh();
  $('nameBox').value = OIID.name;
  playing = true;
  if (net.open) hello(); else connect();
  OIID.activity({ status: 'hiding stuff around TJ', join: 'tj_hide_seek.html' });
  play();
}
$('enterBtn').onclick = enter;
$('nameBox').onclick = () => OIID.open({ registered: true, title: 'Log in to play TJ Hide and Seek', note: NEED_ACCOUNT });
OIID.me().then(id => { if (id) $('nameBox').value = id.name; connect(); });
OIID.onChange(id => { $('nameBox').value = id ? id.name : ''; if (id && net.open && canHello()) hello(); });
$('muteBtn').onclick = () => { muted = !muted; $('muteBtn').textContent = muted ? '🔇' : '🔊'; try { localStorage.setItem('tjhsMute', muted ? '1' : '0'); } catch (e) {} };
$('muteBtn').textContent = muted ? '🔇' : '🔊';
$('sens').value = Math.round(player.sens * 10000);
$('sens').oninput = () => { player.sens = $('sens').value / 10000; try { localStorage.setItem('tjhsSens', player.sens); } catch (e) {} };
$('lowres').checked = pixelRatio < 1;
$('lowres').onchange = () => { pixelRatio = $('lowres').checked ? 0.75 : Math.min(1.5, window.devicePixelRatio || 1); renderer.setPixelRatio(pixelRatio); resize(); try { localStorage.setItem('tjhsLowRes', $('lowres').checked ? '1' : '0'); } catch (e) {} };
{ // shirt colour picker
  const box = $('looks');
  SHIRTS.forEach((c, i) => {
    const b = document.createElement('button'); b.className = 'look' + (i === myLook ? ' sel' : ''); b.style.background = '#' + c.toString(16).padStart(6, '0');
    b.title = 'Shirt colour';
    b.onclick = () => {
      myLook = i; try { localStorage.setItem('tjhsLook', i); } catch (e) {}
      box.querySelectorAll('.look').forEach((x, k) => x.classList.toggle('sel', k === i));
      scene.remove(selfModel); selfModel = makeStudent(myLook); scene.add(selfModel); hello();
    };
    box.appendChild(b);
  });
}

addEventListener('keydown', e => {
  if (e.target === $('chatIn')) {
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); if (!e.isComposing) sendChat(); }    // isComposing: an IME (Chinese input) is still picking characters
    else if (e.code === 'Escape') closeChat();
    else if (e.code === 'PageUp' || e.code === 'PageDown') { e.preventDefault(); pageFeed(e); }
    return;
  }
  if (e.target === $('wbText') && (e.code === 'Enter' || e.code === 'NumpadEnter') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('wbOk').onclick(); return; }
  if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) { if (e.code === 'Escape') { e.target.blur(); pause(); } return; }
  if (e.code === 'Tab') { e.preventDefault(); if (state === 'play') { state = 'board'; setPanel('boardPanel'); } return; }
  if (state === 'play') {
    if (e.code === 'KeyE' && shoot) endShoot();
    else if (e.code === 'KeyE' && target) openTarget();
    else if (e.code === 'KeyE' && chessTarget) openChess(chessTarget);
    else if (e.code === 'KeyE' && hoopTarget) startShoot(hoopTarget);
    else if (e.code === 'KeyX' && target && target.d.mine) send({ t: 'take', id: target.d.id });
    else if (e.code === 'KeyH') openHide();
    else if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); openChat(); }
    else if (e.code === 'KeyI') { e.preventDefault(); openWb(); }
    else if (e.code === 'KeyM') { state = 'map'; setPanel('mapPanel'); player.unlock(); drawFullMap(); }
    else if (e.code === 'KeyV') { player.third = !player.third; }
    else if (e.code === 'PageUp' || e.code === 'PageDown') { e.preventDefault(); pageFeed(e); }
    else if (e.code === 'Escape') pause();
  } else if (state === 'inspect' && (e.code === 'KeyE' || e.code === 'Escape' || e.code === 'Space')) { e.preventDefault(); closeInspect(); }
  else if (state === 'map' && (e.code === 'KeyM' || e.code === 'Escape')) { state = 'play'; setPanel(null); player.lock(); }
  else if (state === 'hide' && e.code === 'Escape') closeHide();
  else if (state === 'wb' && e.code === 'Escape') closeWb();
  else if (state === 'mod' && e.code === 'Escape') closeMod();
  else if (state === 'chess' && e.code === 'Escape') closeChess();
  else if (state === 'kw' && e.code === 'Escape' && document.activeElement === document.body) closeKw();
  else if (state === 'menu' && e.code === 'Enter') enter();
});
addEventListener('keyup', e => { if (e.code === 'Tab' && state === 'board') { state = 'play'; setPanel(null); } });
canvas.addEventListener('click', () => { if (state === 'play') player.lock(); });

// ---------------------------------------------------------------- hiding
/** March a ray from the eye: first surface top or floor within reach; null if a wall is in the way. */
function placement() {
  const cam = player.camera();
  const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ'));
  const o = player.third ? { x: player.pos.x, y: player.pos.y + player.eye, z: player.pos.z } : cam;
  let px = o.x, py = o.y, pz = o.z;
  for (let s = 0.03; s <= 3.4; s += 0.03) {
    const x = o.x + dir.x * s, y = o.y + dir.y * s, z = o.z + dir.z * s;
    if (player.rayBlocked(px, pz, x, z, y) !== null) return null;
    const list = SURF.get(Math.floor(x / 4) * 4096 + Math.floor(z / 4)) || [];
    for (const sf of list) {
      const c = Math.cos(sf.rot), sn = Math.sin(sf.rot), dx = x - sf.x, dz = z - sf.z;
      const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
      if (Math.abs(lx) > sf.hx || Math.abs(lz) > sf.hz || y > sf.y1 || y < sf.y0) continue;
      if (py >= sf.y1 - 0.001) return { x, y: sf.y1, z, on: sf.name };
      // hit the side: reach up and put it on top if the top is within arm's reach (lockers, shelves, vending machines)
      const base = map.ground(x, z, y + 0.4);
      if (sf.y1 - base > 2.3) return null;
      const k = Math.min(0.15, Math.max(sf.hx, sf.hz)) / Math.max(1e-3, Math.hypot(sf.x - x, sf.z - z));
      return { x: x + (sf.x - x) * k, y: sf.y1, z: z + (sf.z - z) * k, on: sf.name };
    }
    const g = map.ground(x, z, y + 0.4);
    if (y <= g) return { x, y: g + 0.005, z, on: 'floor' };
    px = x; py = y; pz = z;
  }
  return null;
}
function openHide() {
  if (!net.open) return toast('Hiding needs the online school - you are offline right now.', true);
  const spot = placement();
  if (!spot || !map.validSpot(spot.x, spot.y, spot.z)) return toast('Aim at a desk, shelf, locker top or the floor within reach, then press H.', true);
  state = 'hide'; player.active = false; player.unlock();
  hide = { spot, type: hide && hide.type || 'macbook', ghost: null, rot: player.yaw + Math.PI };
  const where = map.locate(spot.x, spot.y, spot.z);
  $('hideWhere').textContent = `${floorName(where.floor)} · ${where.name}${spot.on !== 'floor' ? ` · on the ${spot.on.replace(/\d/, '')}` : ''}`;
  renderTypes(); setGhost();
  $('hideMsg').value = ''; $('hideCount').textContent = '0/140';
  $('hideErr').textContent = net.me ? `Stashes out: ${net.me.out}/${net.me.max}` : '';
  setPanel('hidePanel');
  setTimeout(() => $('hideMsg').focus(), 50);
}
function renderTypes() {
  $('types').innerHTML = Object.entries(ITEM_TYPES).map(([k, t]) => `<button class="type${k === hide.type ? ' sel' : ''}" data-k="${k}"><span>${t.icon}</span><b>${esc(t.name)}</b><small>${esc(t.blurb)}</small></button>`).join('');
  $('types').querySelectorAll('.type').forEach(b => (b.onclick = () => { hide.type = b.dataset.k; renderTypes(); setGhost(); }));
}
function setGhost() {
  if (hide.ghost) scene.remove(hide.ghost);
  const g = ghostOf(buildItem(hide.type), true);
  g.position.set(hide.spot.x, hide.spot.y, hide.spot.z); g.rotation.y = hide.rot;
  scene.add(g); hide.ghost = g;
}
function closeHide() { if (hide && hide.ghost) scene.remove(hide.ghost); state = 'play'; setPanel(null); player.active = true; player.lock(); }
$('hideMsg').oninput = () => { $('hideCount').textContent = `${$('hideMsg').value.length}/140`; };
$('hideCancel').onclick = closeHide;
$('hideOk').onclick = () => {
  const msg = $('hideMsg').value.trim();
  if (!msg) { $('hideErr').textContent = 'Write a note for whoever finds it.'; return; }
  send({ t: 'hide', type: hide.type, p: [hide.spot.x, hide.spot.y, hide.spot.z].map(v => Math.round(v * 100) / 100), rot: hide.rot, msg });
  closeHide();
};

// ---------------------------------------------------------------- chat and whiteboards
function pageFeed(e) { const k = e.shiftKey ? 'log' : 'chat'; scrollFeed(k, (e.code === 'PageUp' ? -0.8 : 0.8) * feeds[k].list.clientHeight); }
function openChat() {
  if (!net.open || !net.me) return toast('Chat needs the online school - you are offline right now.', true);
  state = 'chat'; player.active = false; player.keys = Object.create(null);
  $('chatBox').classList.add('open'); $('chatIn').value = ''; toBottom(feeds.chat);
  setTimeout(() => $('chatIn').focus(), 0);           // after this keydown, so the Enter does not land in the box
}
function closeChat() {
  if (state !== 'chat') return;
  $('chatBox').classList.remove('open'); $('chatIn').blur();
  state = 'play'; player.active = true; player.lock(); chatClosedT = performance.now();
}
function sendChat() {
  const text = $('chatIn').value.trim();
  if (text) send({ t: 'chat', text });
  closeChat();
}
function openWb() {
  const r = findBoard();
  if (!r) return toast('Look at a classroom whiteboard up close, then press I.', true);
  if (!net.open || !net.me) return toast('Writing on boards needs the online school - you are offline right now.', true);
  wb = r; state = 'wb'; player.active = false; player.unlock();
  const cur = written.get(r.key);
  $('wbWhere').textContent = `${floorName(r.floor)} · ${roomName(r.room)}`;
  $('wbBy').textContent = cur ? `last written by ${cur.b.by}` : "the teacher's lesson";
  $('wbText').value = cur ? cur.b.text : '';
  $('wbCount').textContent = `${$('wbText').value.length}/160`;
  $('wbErr').textContent = '';
  $('wbWipe').style.display = cur ? '' : 'none';
  setPanel('wbPanel');
  setTimeout(() => $('wbText').focus(), 50);
}
function closeWb() { wb = null; state = 'play'; setPanel(null); player.active = true; player.lock(); }
$('wbText').oninput = () => {
  const t = $('wbText'), lines = t.value.split('\n');
  if (lines.length > 6) t.value = lines.slice(0, 6).join('\n');
  $('wbCount').textContent = `${t.value.length}/160`;
};
$('wbOk').onclick = () => {
  const text = $('wbText').value.trim();
  if (!text) { $('wbErr').textContent = 'Write something first (or use "Erase the board").'; return; }
  send({ t: 'wb', key: wb.key, text });
  closeWb();
};
$('wbWipe').onclick = () => { send({ t: 'wb', key: wb.key, text: '' }); closeWb(); };
$('wbCancel').onclick = closeWb;

// ---------------------------------------------------------------- finding: the close-up and the Post-it
function findTarget() {
  const cam = player.camera(), f = player.floor;
  fwd.set(0, 0, -1).applyEuler(new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ'));
  let best = null, bd = Infinity;
  for (const it of items.values()) {
    const [x, y, z] = it.d.p;
    const dx = x - player.pos.x, dz = z - player.pos.z, dh = Math.hypot(dx, dz);
    if (dh > REACH || Math.abs(y - player.pos.y) > 2.3 || (y > map.F2Y - 0.3 ? 2 : 1) !== f) continue;
    const vx = x - cam.x, vy = y + 0.05 - cam.y, vz = z - cam.z, vl = Math.hypot(vx, vy, vz) || 1;
    const facing = (vx * fwd.x + vy * fwd.y + vz * fwd.z) / vl;
    if (facing < 0.55 && dh > 0.8) continue;
    if (player.rayBlocked(player.pos.x, player.pos.z, x, z, Math.max(y, player.pos.y) + 0.2) !== null) continue;
    const score = dh * (1.6 - facing);
    if (score < bd) { bd = score; best = it; }
  }
  return best;
}
function openTarget() {
  if (!net.open) return toast('Opening stashes needs the online school.', true);
  const it = target;
  state = 'inspect'; player.active = false; player.unlock();
  const c = player.camera();
  inspect = { id: it.d.id, it, t: 0, from: new THREE.Vector3(c.x, c.y, c.z), fromQ: camera.quaternion.clone(), got: null };
  $('note').classList.remove('in'); $('noteWait').style.display = 'block'; $('noteBody').style.display = 'none';
  setPanel('notePanel');
  send({ t: 'open', id: it.d.id });
}
function onOpened(m) {
  if (!inspect) return;
  if (!m.ok) { toast(m.msg, true); const id = inspect.id; closeInspect(); removeItem(id); return; }
  inspect.got = m;
  const d = m.item, t = ITEM_TYPES[d.type] || { name: d.type };
  $('noteWait').style.display = 'none'; $('noteBody').style.display = 'block';
  $('noteItem').textContent = `${t.icon || ''} ${t.name}`;
  $('noteFrom').textContent = m.own ? 'Your stash' : `Hidden by ${d.creator}`;
  $('noteWhen').textContent = `${ago(d.createdAt)} · ${floorName(d.floor)}, ${d.where}`;
  $('noteMsg').textContent = d.message;
  $('notePts').textContent = m.own ? 'This one is yours - press X next to it to pick it back up.' : `+${m.gain} points · ${d.creator} gets points too`;
  setTimeout(() => $('note').classList.add('in'), 60);
  if (!m.own) { sfx('found'); net.me = m.me || net.me; renderMe(); }
}
function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 90) return 'Hidden just now';
  if (s < 5400) return `Hidden ${Math.round(s / 60)} minutes ago`;
  if (s < 172800) return `Hidden ${Math.round(s / 3600)} hours ago`;
  return `Hidden ${Math.round(s / 86400)} days ago (${new Date(ts).toLocaleDateString()})`;
}
function closeInspect() {
  if (!inspect) return;
  const { id, got } = inspect;
  inspect = null; spot.intensity = 0;
  const it = items.get(id);
  if (it) { it.obj.rotation.y = it.d.rot || 0; it.obj.position.set(...it.d.p); it.obj.scale.setScalar(1); }
  if (got && got.ok && !got.own) removeItem(id);
  state = 'play'; setPanel(null); player.active = true; player.lock();
}
$('noteClose').onclick = closeInspect;
$('mapClose').onclick = () => { state = 'play'; setPanel(null); player.lock(); };
function drawFullMap() {
  const c = $('fullmap'); c.width = Math.min(1500, innerWidth - 40); c.height = Math.min(760, innerHeight - 120);
  minimap.drawFull(c, player, othersList(), myStashes());
}
const othersList = () => [...net.others.values()].map(o => ({ x: o.model.position.x, z: o.model.position.z, floor: o.model.position.y > map.F2Y - 1 ? 2 : 1 }));
const myStashes = () => [...items.values()].filter(i => i.d.mine).map(i => ({ x: i.d.p[0], z: i.d.p[2], floor: i.d.p[1] > map.F2Y - 0.3 ? 2 : 1 }));

// ---------------------------------------------------------------- Shoot Around: three-point shooting in the gyms (shared/Hoops.js)
const HOOPS = window.TJHoops ? TJHoops.hoops(map) : [];
const ballMat = (() => {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#d9631e'; g.fillRect(0, 0, 256, 128);
  g.strokeStyle = '#1b1b1b'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, 64); g.lineTo(256, 64); g.stroke();
  for (const x of [64, 192]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 128); g.stroke(); }
  for (const x of [0, 128, 256]) { g.beginPath(); g.ellipse(x, 64, 34, 64, 0, 0, Math.PI * 2); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshLambertMaterial({ map: t });
})();
const ballGeo = new THREE.SphereGeometry(window.TJHoops ? TJHoops.BALL_R : 0.12, 20, 14);
const netGeo = new THREE.CylinderGeometry(0.22, 0.14, 0.42, 14, 3, true), netMat = new THREE.MeshBasicMaterial({ color: 0xf4f4f4, wireframe: true, transparent: true, opacity: 0.8 });
for (const h of HOOPS) {
  h.mesh = new THREE.Mesh(ballGeo, ballMat); h.mesh.position.set(h.ball.x, TJHoops.BALL_R, h.ball.z); scene.add(h.mesh);
  const net = new THREE.Mesh(netGeo, netMat); net.position.set(h.rim.x, TJHoops.RIM_Y - 0.22, h.rim.z); scene.add(net);
}
const myBall = new THREE.Mesh(ballGeo, ballMat); myBall.visible = false; scene.add(myBall);
// the arc a perfect release would fly (only the shape: it says nothing about the power)
const arcLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.2, gapSize: 0.15, transparent: true, opacity: 0.5, depthTest: false }));
arcLine.frustumCulled = false; arcLine.visible = false; scene.add(arcLine);
let hoopTarget = null;          // the ball in reach
let shoot = null;               // {h, charge: when the mouse went down, fly: the ball in the air, streak, best}
let shotId = 0;
const v3 = new THREE.Vector3();
function findBall() {
  if (player.floor !== 1) return null;
  return HOOPS.find(h => h.mesh.visible && Math.hypot(h.ball.x - player.pos.x, h.ball.z - player.pos.z) < 1.8) || null;
}
function startShoot(h) {
  if (!net.open || !net.me) return toast('Shooting needs the online school - you are offline right now.', true);
  shoot = { h, charge: 0, fly: null, streak: 0, best: 0 };
  h.mesh.visible = false; myBall.visible = true;
  $('hoopHud').classList.add('show'); renderHoopHud();
  send({ t: 'hoopBoard' });
  toast('Threes only - hold the mouse, let go in the green.');
}
function endShoot() {
  if (!shoot) return;
  shoot.h.mesh.visible = true; myBall.visible = false; arcLine.visible = false;
  $('hoopHud').classList.remove('show');
  shoot = null;
}
// looking up = a higher arc: 40 degrees looking a bit down, 70 looking well up
const shotAngle = () => Math.max(TJHoops.ANG[0], Math.min(TJHoops.ANG[1], 40 + (player.pitch + 0.15) * (30 / 0.85)));
const meterAt = ms => { const k = (ms / 1000) % 2; return k < 1 ? k : 2 - k; };     // fills in 1 s, then falls back
function releaseShot() {
  const s = shoot;
  if (!s || !s.charge) return;
  const pow = meterAt(performance.now() - s.charge); s.charge = 0;
  const shot = { hoop: s.h.id, x: player.pos.x, z: player.pos.z, ang: shotAngle(), pow };
  if (!TJHoops.isThree(s.h, shot.x, shot.z, 0.05)) return toast('Step behind the three-point line.', true);
  const r = TJHoops.simulate(s.h, shot);
  // the call comes when the ball is back down at the rim: the first point after the top of its flight at rim height
  let top = 0; r.path.forEach((p, i) => { if (p[1] > r.path[top][1]) top = i; });
  let hit = r.path.findIndex((p, i) => i > top && p[1] <= TJHoops.RIM_Y + 0.05); if (hit < 0) hit = r.path.length - 1;
  s.fly = { path: r.path, t0: performance.now(), res: null, hitAt: hit, shown: false, id: ++shotId };
  arcLine.visible = false;
  send({ t: 'hoopShoot', id: shotId, ...shot });
}
function onHoopShot(m) {
  if (!shoot) return;
  if (m.err) { toast(m.err, true); if (shoot.fly && shoot.fly.id === m.id) shoot.fly = null; return; }
  if (shoot.fly && shoot.fly.id === m.id) shoot.fly.res = m;     // shown when the ball gets there
  else showShot(m);
}
function showShot(m) {
  if (!shoot) return;
  shoot.streak = m.streak; shoot.best = m.best;
  const t = $('hoopCall');
  t.textContent = m.made ? (m.swish ? 'SWISH!' : 'BUCKET!') : 'Miss';
  t.className = m.made ? 'in' : 'out'; void t.offsetWidth; t.classList.add('pop');
  sfx(m.made ? (m.swish ? 'found' : 'ding') : 'step');
  if (m.pb && m.streak >= 2) toast(`New personal best: ${m.streak} in a row!`);
  renderHoopHud();
}
function renderHoopHud() {
  if (!shoot) return;
  $('hoopStreak').textContent = shoot.streak; $('hoopBest').textContent = shoot.best;
  const list = net.hoopBoard || [];
  $('hoopBoardList').innerHTML = list.length
    ? list.slice(0, 5).map((r, i) => `<li class="${r.name === myName() ? 'me' : ''}"><b>${i + 1}.</b> ${esc(r.name)}<span>${r.best} in a row</span></li>`).join('')
    : '<li class="muted">No streaks yet - be the first!</li>';
}
function updateShoot(dt) {
  const s = shoot, h = s.h, now = performance.now();
  if (player.floor !== 1 || Math.hypot(player.pos.x - h.rim.x, player.pos.z - h.rim.z) > TJHoops.MAX_D + 4) {
    endShoot(); return toast('You left the court - the ball is back under the hoop.');
  }
  if (state !== 'play') s.charge = 0;
  // threes only: ease the shooter back behind the arc (and in from too deep)
  const [cx, cz] = TJHoops.clampSpot(h, player.pos.x, player.pos.z), k = Math.min(1, dt * 10);
  player.pos.x += (cx - player.pos.x) * k; player.pos.z += (cz - player.pos.z) * k;
  const ang = shotAngle(), d = Math.hypot(h.rim.x - player.pos.x, h.rim.z - player.pos.z);
  if (s.fly) {
    const f = s.fly, P = f.path, q = (now - f.t0) / 1000 * 60, i = Math.min(P.length - 1, Math.floor(q)), u = Math.min(1, q - i), a = P[i], b = P[Math.min(P.length - 1, i + 1)];
    myBall.position.set(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u);
    myBall.rotation.x -= dt * 12;
    if (!f.shown && f.res && q >= f.hitAt) { f.shown = true; showShot(f.res); }
    if (q > P.length + 30) { if (!f.shown && f.res) showShot(f.res); s.fly = null; }     // the rebound comes back to you
  } else {
    // in your hands, low and to the right of the view; a bit lower while you load the shot
    myBall.position.copy(camera.position).add(v3.set(0.26, s.charge ? -0.4 : -0.34, -0.85).applyQuaternion(camera.quaternion));
    // the arc a perfect release would fly
    if (state === 'play') {
      const L = TJHoops.launch(h, { x: player.pos.x, z: player.pos.z, ang, pow: TJHoops.sweet(d) });
      const vh = Math.hypot(L.v[0], L.v[2]), tEnd = (d - 0.3) / (vh || 1), pts = [];
      for (let j = 0; j <= 40; j++) { const t = tEnd * j / 40; pts.push(new THREE.Vector3(L.p[0] + L.v[0] * t, L.p[1] + L.v[1] * t - 4.905 * t * t, L.p[2] + L.v[2] * t)); }
      arcLine.geometry.setFromPoints(pts); arcLine.computeLineDistances(); arcLine.visible = true;
    } else arcLine.visible = false;
  }
  // the meter: green where a perfect release is (moves up with distance), wider for a better arc
  const sw = TJHoops.sweet(d), zn = TJHoops.zone(ang);
  $('hoopZone').style.bottom = `${(sw - zn) * 100}%`; $('hoopZone').style.height = `${zn * 200}%`;
  $('hoopFill').style.height = `${(s.charge ? meterAt(now - s.charge) : 0) * 100}%`;
  $('hoopArc').textContent = `${Math.round(ang)}°`;
  $('hoopArc').className = Math.abs(ang - TJHoops.BEST_ANG) < 7 ? 'good' : '';
}
canvas.addEventListener('mousedown', e => { if (e.button === 0 && shoot && !shoot.fly && state === 'play' && player.locked) shoot.charge = performance.now(); });
addEventListener('mouseup', e => { if (e.button === 0 && shoot && shoot.charge && state === 'play') releaseShot(); });

// ---------------------------------------------------------------- chess club (Room 23): three student bots, the server plays them
const CLUB = window.TJChess ? TJChess.spots(map) : [];
for (const t of CLUB) {
  const m = makeStudent(t.bot.look, `${t.bot.name} · ${t.bot.label}`), u = m.userData;
  u.legL.rotation.x = u.legR.rotation.x = -Math.PI / 2;        // sitting: legs forward under the table, hands on it
  u.armL.rotation.x = u.armR.rotation.x = -1.0;
  m.position.set(t.npc.x, t.y - 0.36, t.npc.z); m.rotation.y = t.npc.rot;
  scene.add(m); t.model = m;
}
let chessTarget = null;         // the chess table in reach
let chess = null;               // {t: table, v: last view from the server, sel: selected square}
function findChess() {
  if (player.floor !== 1) return null;
  let best = null, bd = TJChess.REACH;
  for (const t of CLUB) {
    const d = Math.hypot(t.x - player.pos.x, t.z - player.pos.z);
    if (d < bd && player.rayBlocked(player.pos.x, player.pos.z, t.x, t.z, player.pos.y + 1.2) === null) { bd = d; best = t; }
  }
  return best;
}
function openChess(t) {
  if (!net.open || !net.me) return toast('Chess needs the online school - you are offline right now.', true);
  chess = { t, v: null, sel: null };
  state = 'chess'; player.active = false; player.unlock();
  $('chessTitle').textContent = `♟️ ${t.bot.name} · ${t.bot.label}`;
  $('chessSay').textContent = `“${t.bot.hello}”`;
  $('chessStatus').textContent = 'Setting up the board…';
  $('chessBoard').innerHTML = ''; $('chessPromo').innerHTML = '';
  setPanel('chessPanel');
  send({ t: 'chessStart', bot: t.bot.id });
}
function closeChess() { if (state !== 'chess') return; chess = null; state = 'play'; setPanel(null); player.active = true; player.lock(); }
function onChess(v) {
  if (!chess || v.bot !== chess.t.bot.id) return;
  const was = chess.v;
  chess.v = v; chess.sel = null; $('chessPromo').innerHTML = '';
  if (was && was.last !== v.last) sfx('step');
  if (v.over && !(was && was.over)) sfx(v.over === 'won' ? 'found' : 'chat');
  renderChess();
}
const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
function renderChess() {
  const v = chess.v, bot = chess.t.bot, rows = v.fen.split(' ')[0].split('/');
  const legal = v.legal, sel = chess.sel, targets = new Set(sel ? legal.filter(u => u.startsWith(sel)).map(u => u.slice(2, 4)) : []);
  const kingSq = v.check ? (() => { for (let r = 0; r < 8; r++) { let f = 0; for (const ch of rows[r]) { if (/\d/.test(ch)) f += +ch; else { if (ch === (v.fen.split(' ')[1] === 'w' ? 'K' : 'k')) return 'abcdefgh'[f] + (8 - r); f++; } } } return ''; })() : '';
  let h = '';
  rows.forEach((row, r) => {
    // expand "3p4" to one cell per file; a8 (file 0, row 0) is a light square
    const cells = [...row].flatMap(ch => (/\d/.test(ch) ? Array(+ch).fill('') : [ch]));
    cells.forEach((ch, f) => {
      const pc = ch ? `<span class="pc ${ch === ch.toUpperCase() ? 'w' : 'b'}">${GLYPH[ch.toLowerCase()]}\uFE0E</span>` : '';
      h += sqHtml('abcdefgh'[f] + (8 - r), pc, (f + r) % 2);
    });
  });
  function sqHtml(sq, inner, dark) {
    const cls = ['sq', dark ? 'dk' : 'lt'];
    if (v.last && (v.last.slice(0, 2) === sq || v.last.slice(2, 4) === sq)) cls.push('c-last');
    if (sq === sel) cls.push('c-sel');
    if (targets.has(sq)) cls.push(inner ? 'c-cap' : 'c-to');
    if (sq === kingSq) cls.push('c-chk');
    if (legal.some(u => u.startsWith(sq))) cls.push('c-mine');
    return `<button class="${cls.join(' ')}" data-sq="${sq}">${inner}</button>`;
  }
  $('chessBoard').innerHTML = h;
  const over = { won: `🏆 You beat ${bot.name}! Everyone in TJ just heard about it.`, lost: `${bot.name} wins this time. Try again?` }[v.over] || (v.over ? `Draw (${v.over.slice(6)}).` : '');
  $('chessStatus').textContent = over || (v.thinking ? `${bot.name} is thinking…` : v.check ? 'Check! Your move (White).' : 'Your move (White).');
  $('chessStatus').className = v.over === 'won' ? 'win' : '';
  $('chessResign').style.display = v.over ? 'none' : '';
  $('chessNew').style.display = v.over ? '' : 'none';
}
$('chessBoard').addEventListener('click', e => {
  const b = e.target.closest('[data-sq]');
  if (!b || !chess || !chess.v) return;
  const sq = b.dataset.sq, v = chess.v;
  if (chess.sel) {
    const moves = v.legal.filter(u => u.startsWith(chess.sel + sq));
    if (moves.length === 1) return chessMove(moves[0]);
    if (moves.length > 1) {                                   // a pawn reaching the last rank: pick the piece
      $('chessPromo').innerHTML = 'Promote to: ' + ['q', 'r', 'b', 'n'].map(p => `<button class="btn ghost" data-uci="${chess.sel + sq + p}"><span class="pc w">${GLYPH[p]}\uFE0E</span></button>`).join(' ');
      return;
    }
  }
  chess.sel = v.legal.some(u => u.startsWith(sq)) && chess.sel !== sq ? sq : null;
  $('chessPromo').innerHTML = '';
  renderChess();
});
$('chessPromo').addEventListener('click', e => { const b = e.target.closest('[data-uci]'); if (b) chessMove(b.dataset.uci); });
function chessMove(uci) { chess.v.legal = []; chess.sel = null; $('chessPromo').innerHTML = ''; renderChess(); send({ t: 'chessMove', uci }); }
$('chessResign').onclick = () => { if (chess && confirm(`Resign this game against ${chess.t.bot.name}?`)) send({ t: 'chessResign' }); };
$('chessNew').onclick = () => { if (chess) openChess(chess.t); };
$('chessClose').onclick = closeChess;

// ---------------------------------------------------------------- the frame
const clock = new THREE.Clock();
let fpsT = 0, fpsN = 0, stepT = 0, hudT = 0, actT = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  if (state === 'menu' && !player.active && !net.everPlayed) {
    // slow orbit around the Dome behind the title screen
    const t = performance.now() / 1000 * 0.05, d = map.dome;
    camera.position.set(d.x + Math.sin(t) * 46, 13 + Math.sin(t * 0.7) * 2, d.z - 20 - Math.cos(t) * 40);
    camera.lookAt(d.x, 6, d.z + 8);
  } else {
    net.everPlayed = true;
    player.update(dt);
    if (state === 'inspect' && inspect) {
      inspect.t = Math.min(1, inspect.t + dt * 2.2);
      const it = inspect.it, p = new THREE.Vector3(...it.d.p);
      const k = 1 - Math.pow(1 - inspect.t, 3);
      const dir = new THREE.Vector3(inspect.from.x - p.x, 0, inspect.from.z - p.z).normalize();
      const to = new THREE.Vector3(p.x + dir.x * 0.55, p.y + 0.42, p.z + dir.z * 0.55);
      camera.position.lerpVectors(inspect.from, to, k);
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(to, p.clone().add(new THREE.Vector3(0, 0.06, 0)), new THREE.Vector3(0, 1, 0)));
      camera.quaternion.copy(inspect.fromQ).slerp(q, k);
      it.obj.rotation.y += dt * 0.6;
      it.obj.position.y = it.d.p[1] + Math.sin(performance.now() / 500) * 0.01 * k + 0.04 * k;
      spot.position.set(to.x, to.y + 0.6, to.z); spot.target.position.copy(p); spot.intensity = 6 * k; spot.distance = 3;
    } else {
      const c = player.camera();
      camera.position.set(c.x, c.y, c.z); camera.rotation.set(c.pitch, c.yaw, 0);
    }
    if (shoot) updateShoot(dt);
    selfModel.visible = player.third && state !== 'inspect';
    if (selfModel.visible) { selfModel.position.set(player.pos.x, player.pos.y, player.pos.z); selfModel.rotation.y = player.yaw + Math.PI; animateStudent(selfModel, player.moving, dt); selfModel.scale.y = 1 - player.crouch * 0.3; }
    if (state === 'play') {
      target = shoot ? null : findTarget(); chessTarget = null; hoopTarget = null;
      if (shoot) $('prompt').classList.remove('show');            // the Shoot Around panel says what to do
      else if (target) {
        const t = ITEM_TYPES[target.d.type];
        $('prompt').innerHTML = target.d.mine ? `Your ${esc(t.name)} · <kbd>E</kbd> read your note · <kbd>X</kbd> pick it up` : `<kbd>E</kbd> Inspect ${esc(t.name)}`;
        $('prompt').classList.add('show');
      } else if ((hoopTarget = findBall())) {
        $('prompt').innerHTML = `<kbd>E</kbd> Pick up the basketball · 3-point Shoot Around`;
        $('prompt').classList.add('show');
      } else if ((chessTarget = findChess())) {
        $('prompt').innerHTML = `<kbd>E</kbd> Play chess with ${esc(chessTarget.bot.name)} <i>(${esc(chessTarget.bot.label)})</i>`;
        $('prompt').classList.add('show');
      } else if (findBoard()) {
        $('prompt').innerHTML = `<kbd>I</kbd> Write on the whiteboard`;
        $('prompt').classList.add('show');
      } else $('prompt').classList.remove('show');
      if (player.moving > 1 && player.onGround && (stepT += dt * player.moving) > 2.2) { stepT = 0; sfx('step'); }
    } else $('prompt').classList.remove('show');
    sendState();
  }
  updateOthers(dt);
  for (const o of net.others.values()) if (o.bubble && performance.now() > o.bubble.until) { o.model.remove(o.bubble.sprite); o.bubble.sprite.material.map.dispose(); o.bubble = null; }
  for (const it of items.values()) if (it.ring) it.ring.material.opacity = 0.45 + Math.sin(performance.now() / 300) * 0.25;
  if (builder.flag) { const p = builder.flag.geometry.attributes.position, t = performance.now() / 300; for (let i = 0; i < p.count; i++) { const x = p.getX(i) + 1.3; p.setZ(i, Math.sin(x * 2.2 - t) * 0.12 * x / 2.6); } p.needsUpdate = true; }
  // HUD at ~8 Hz
  if ((hudT += dt) > 0.12) {
    hudT = 0;
    const loc = map.locate(player.pos.x, player.pos.y, player.pos.z), f = player.floor;
    $('where').textContent = loc.name === 'outside' ? 'Outside · campus' : `${floorName(f)} · ${loc.name}`;
    $('f1').classList.toggle('on', f === 1); $('f2').classList.toggle('on', f === 2);
    let n1 = 0, n2 = 0; for (const it of items.values()) if (!it.d.mine) (it.d.p[1] > map.F2Y - 0.3 ? n2++ : n1++);
    $('n1').textContent = n1; $('n2').textContent = n2;
    minimap.draw(player, othersList(), myStashes());
    if (state === 'map') drawFullMap();
  }
  if ((actT += dt) > 30 && state !== 'menu') { actT = 0; OIID.activity({ status: `hiding stuff around TJ · ${net.players.size} online`, join: 'tj_hide_seek.html' }); }
  renderer.render(scene, camera);
  if ((fpsT += dt) > 1) { $('fps').textContent = `${Math.round(fpsN / fpsT)} fps`; fpsT = 0; fpsN = 0; }
  fpsN++;
}
setPanel(at && params.has('nomenu') ? null : 'menu');
if (at) net.everPlayed = true;
renderBoard();
frame();
window.__tjhs = { map, player, scene, camera, renderer, items, net, placement, surfaces, boards, written, findBoard };
