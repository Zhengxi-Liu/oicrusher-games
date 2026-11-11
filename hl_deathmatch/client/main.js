/**
 * Half-Life Web Deathmatch - client entry point.
 *   - WebSocket connection, room list / create / join
 *   - 60 Hz input loop: sample, predict with the shared Movement code, send (with sequence numbers)
 *   - snapshots: reconcile the local player (replay unacknowledged inputs), interpolate everyone
 *     else ~83 ms in the past (the same moment the server rewinds to for lag-compensated hitscan)
 *   - events -> effects, sounds, kill feed, hit markers; HUD; cameras (first person / death / intermission)
 */
import * as THREE from 'three';
import { Renderer3D } from './Renderer3D.js?v=5';
import { PlayerController } from './PlayerController.js?v=5';
import { AudioSystem } from './AudioSystem.js?v=5';

const K = window.HLConst, MAPDATA = window.HLMap, MV = window.HLMove;
const { C, WEAPONS, EV, COLORS, PROJ, SKINS, NUM_WEAPONS, SLOT, BTN, TEAMS, PRIMARIES } = K;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STEP = 1000 / 60;
const WEAPON_NAMES = { 0: 'world', 1: 'Crowbar', 2: 'Glock', 3: '.357', 4: 'MP5', 5: 'Shotgun', 6: 'Crossbow', 7: 'RPG', 8: 'AWP', 9: 'AK-47', 10: 'M4A1', 11: 'HE', 20: 'Barrel' };
const ZOOM_FOV = { 6: [80, 20], 8: [80, 40, 12] };

const canvas = $('view');
let renderer = null;
try { renderer = new Renderer3D(canvas); } catch (e) { console.error(e); $('webglError').style.display = 'block'; }
const ctl = new PlayerController(canvas);
const audio = new AudioSystem();
let mapDef = MAPDATA.MAPS[MAPDATA.DEFAULT];
let world = MV.makeWorld(mapDef.BOXES, mapDef.PROPS);   // prediction world (props follow the server)
let mySkin = 0;
try { mySkin = Math.max(0, Math.min(SKINS.length - 1, Number(localStorage.getItem('hldmSkin')) || 0)); } catch (e) {}

/** Switch every map-dependent piece: prediction world, renderer, snapshot buffer. */
function loadMap(id) {
  mapDef = MAPDATA.MAPS[id] || MAPDATA.MAPS[MAPDATA.DEFAULT];
  world = MV.makeWorld(mapDef.BOXES, mapDef.PROPS);
  if (renderer) renderer.setMap(mapDef);
  snaps = []; latest = null; resetPending = true;
}

// ---------- state
let net = null, inRoom = false, roomCode = '', myId = 0, roomMode = 'dm', myTeam = -1, specIdx = 0, buyOpen = false;
const roster = new Map(), scores = new Map();
let snaps = [], latest = null, clock = null;
let p = null, pending = [], seq = 0, offset = { x: 0, y: 0, z: 0 }, resetPending = true;
let punch = 0, killfeed = [], deathInfo = null, centerMsg = null, hitmark = 0, hurtFlash = 0, dmgDirs = [];
let scoreboardHeld = false, lastFootstep = 0, wasReloading = false, corrections = 0, fps = 60, frames = 0, fpsT = 0, eyeY = C.EYE;

// ---------- networking
function wsUrl() {
  const q = new URLSearchParams(location.search).get('ws');
  return q || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/game/hldm-ws`;
}
class Net {
  constructor() { this.h = {}; this.rtt = 0; }
  on(t, fn) { this.h[t] = fn; return this; }
  get open() { return this.ws && this.ws.readyState === 1; }
  connect() {
    return new Promise((resolve, reject) => {
      let opened = false;
      const ws = this.ws = new WebSocket(wsUrl());
      ws.onopen = () => { opened = true; const ping = () => this.send({ t: 'ping', c: performance.now() }); ping(); this.pinger = setInterval(ping, 1000); resolve(); };
      ws.onmessage = e => {
        let m; try { m = JSON.parse(e.data); } catch (err) { return; }
        if (m.t === 'pong') { const r = performance.now() - m.c; this.rtt = this.rtt ? this.rtt * 0.8 + r * 0.2 : r; }
        const fn = this.h[m.t]; if (fn) fn(m);
      };
      ws.onclose = () => { clearInterval(this.pinger); if (!opened) reject(new Error('Could not reach the game server.')); else if (this.h.close) this.h.close(); };
      ws.onerror = () => {};
    });
  }
  send(m) { if (this.open) this.ws.send(JSON.stringify(m)); }
  close() { clearInterval(this.pinger); if (this.ws) { this.ws.onclose = null; try { this.ws.close(); } catch (e) {} } this.ws = null; }
}

// ---------- panels
const PANELS = ['pMain', 'pLobby', 'pConn', 'pPause', 'pMsg'];
function show(id) {
  $('overlay').classList.remove('hidden');
  for (const x of PANELS) $(x).classList.toggle('show', x === id);
  ctl.active = false;
  ctl.unlock();
}
function hideOverlay() { $('overlay').classList.add('hidden'); ctl.active = inRoom; }
function current() { return $('overlay').classList.contains('hidden') ? null : PANELS.find(x => $(x).classList.contains('show')); }
let msgNext = 'pMain';
function message(title, text, next = 'pMain') { $('msgTitle').textContent = title; $('msgText').textContent = text; msgNext = next; show('pMsg'); }
function myName() { const v = $('nameInput').value.replace(/[\x00-\x1F<>]/g, '').trim().slice(0, 16); return v.length >= 2 ? v : ''; }

async function connect() {
  // one name for every game: the portal identity (identity.js); the token proves it to the server
  const id = await OIID.require();
  if (!id) return false;
  const fresh = await OIID.fresh();
  const name = id.name, token = fresh ? fresh.token : '';
  $('nameInput').value = name;
  audio.unlock();
  if (net && net.open) { net.send({ t: 'hello', name, token, skin: mySkin }); return true; }
  show('pConn');
  net = new Net();
  net.on('welcome', m => { $('lobbyName').textContent = m.name; if (deepJoin) { net.send({ t: 'join', code: deepJoin }); deepJoin = null; } })
    .on('rooms', renderRooms)
    .on('error', m => { if (inRoom) return; show('pLobby'); $('lobbyStatus').textContent = m.msg; })
    .on('joined', onJoined)
    .on('map', m => { loadMap(m.id); showCenter(`Next map: ${esc(mapDef.name)}`, 3); })
    .on('roster', m => {
      setTimeout(() => { if (inRoom && roster.size !== lastRosterN) { lastRosterN = roster.size; playing(); } }, 0);
      const ids = new Set(m.players.map(x => x.id));
      for (const id of [...roster.keys()]) if (!ids.has(id)) roster.delete(id);
      for (const x of m.players) roster.set(x.id, x);
      const meR = roster.get(myId); if (meR) myTeam = meR.team;
      $('pauseBots').textContent = `${[...roster.values()].filter(x => x.bot).length} bots · ${roster.size}/${C.MAX_PLAYERS} players`;
    })
    .on('s', onSnapshot)
    .on('close', () => { net = null; leaveRoomLocal(); message('Disconnected', 'Lost the connection to the game server.', 'pMain'); });
  try { await net.connect(); net.send({ t: 'hello', name, token, skin: mySkin }); return true; }
  catch (e) { net = null; message('Server unavailable', e.message, 'pMain'); return false; }
}

function renderRooms(m) {
  const list = $('roomList');
  list.innerHTML = m.rooms.length ? m.rooms.map(r =>
    `<div class="item"><span><b class="code">${esc(r.code)}</b> <span class="mode ${r.mode === 'team' ? 'team' : ''}">${r.mode === 'team' ? 'TEAM' : 'DM'}</span> &nbsp;${r.players}/${r.max} players <span class="muted">(${r.humans} human)${r.leader ? ' · lead: ' + esc(r.leader) : ''}</span></span>
     <span class="muted">${esc(r.map || '')}</span> <button data-code="${esc(r.code)}" ${r.players >= r.max && r.humans >= r.max ? 'disabled' : ''}>Join</button></div>`).join('')
    : '<div class="empty">No active rooms. Create one: bots will keep you busy until friends arrive.</div>';
  list.querySelectorAll('button[data-code]').forEach(b => { b.onclick = () => net.send({ t: 'join', code: b.dataset.code }); });
}

function onJoined(m) {
  loadMap(m.map);
  if (renderer) renderer.setViewSkin(mySkin);
  inRoom = true; roomCode = m.code; myId = m.you; roomMode = m.mode || 'dm'; myTeam = m.team == null ? -1 : m.team; buyOpen = false; $('buyMenu').classList.remove('show');
  snaps = []; latest = null; clock = null; p = null; pending = []; resetPending = true;
  killfeed = []; deathInfo = null; scores.clear();
  $('roomCode').textContent = m.code;
  playing();
  $('hud').classList.add('show');
  $('lobbyStatus').textContent = '';
  hideOverlay();
  ctl.active = true;
  ctl.lock();
  showCenter(`Room ${m.code} · click to fight`, 2.5);
}

function leaveRoomLocal() {
  if (inRoom) setTimeout(playing, 0);
  inRoom = false; myId = 0; latest = null; p = null; snaps = [];
  roster.clear(); scores.clear();
  $('hud').classList.remove('show');
  ctl.active = false; ctl.unlock();
}

// ---------- snapshots
function decode(m) {
  const players = new Map();
  for (let i = 0; i < m.p.length; i += 9) {
    players.set(m.p[i], { id: m.p[i], x: m.p[i + 1], y: m.p[i + 2], z: m.p[i + 3], yaw: m.p[i + 4], pitch: m.p[i + 5], cur: m.p[i + 6], alive: !!m.p[i + 7], flags: m.p[i + 8] });
  }
  const proj = [];
  for (let i = 0; i < m.pr.length; i += 8) proj.push({ id: m.pr[i], type: m.pr[i + 1], x: m.pr[i + 2], y: m.pr[i + 3], z: m.pr[i + 4], vx: m.pr[i + 5], vy: m.pr[i + 6], vz: m.pr[i + 7] });
  const items = [];
  for (let i = 0; i < (m.it || []).length; i += 6) items.push({ id: m.it[i], w: m.it[i + 1], x: m.it[i + 2], y: m.it[i + 3], z: m.it[i + 4], rest: !!m.it[i + 5] });
  const tm = m.tm ? { rphase: ['freeze', 'live', 'end'][m.tm[0]], round: m.tm[1], wins: [m.tm[2], m.tm[3]], alive: [m.tm[4], m.tm[5]], time: m.tm[6], last: m.tm[7], buy: !!m.tm[8] } : null;
  return { k: m.k, phase: m.ph ? 'intermission' : 'play', tl: m.tl, tm, players, proj, items, pk: m.pk, pp: m.pp, me: m.me, mg: m.mg, rs: m.rs, ack: m.a };
}

function fromServer(s) {
  const me = s.me, mag = {}, res = {};
  for (let w = 1; w <= NUM_WEAPONS; w++) { mag[w] = s.mg[w - 1]; res[w] = s.rs[w - 1]; }
  return { x: me[0], y: me[1], z: me[2], vx: me[3], vy: me[4], vz: me[5], onGround: !!me[6], hp: me[7], armor: me[8], alive: !!me[9],
           cur: me[10], owned: me[11], alt: me[12], cool: me[13], reloadT: me[14], switchT: me[15], respawnIn: me[16], crouch: !!me[17], spray: me[18] || 0, prev: me[19] || 1, mag, res,
           yaw: ctl.yaw, pitch: ctl.pitch };
}

function onSnapshot(m) {
  if (!inRoom) return;
  const s = decode(m);
  if (latest && s.k <= latest.k) return;
  snaps.push(s); if (snaps.length > 40) snaps.shift();
  clock = clock === null || Math.abs(s.k - clock) > 30 ? s.k : clock + (s.k - clock) * 0.06;
  world.props.forEach((b, i) => { b.alive = !!(s.pp & (2 ** i)); });
  if (m.sc) for (let i = 0; i < m.sc.length; i += 3) scores.set(m.sc[i], { k: m.sc[i + 1], d: m.sc[i + 2] });

  // reconcile the local player
  const srv = fromServer(s);
  if (!srv.alive || !p || !p.alive || resetPending || Math.hypot(srv.x - p.x, srv.y - p.y, srv.z - p.z) > 4) {
    const wasDead = !p || !p.alive;
    p = srv; pending = pending.filter(i => i.s > s.ack); offset = { x: 0, y: 0, z: 0 };
    if (srv.alive && (wasDead || resetPending)) { ctl.setLook(Math.atan2(srv.x, srv.z), 0); resetPending = false; }
  } else {
    const before = { x: p.x + offset.x, y: p.y + offset.y, z: p.z + offset.z }, px = p.x, py = p.y, pz = p.z;
    p = srv;
    pending = pending.filter(i => i.s > s.ack);
    if (s.phase === 'play') for (const inp of pending) { MV.stepMove(p, inp, world); MV.stepWeapon(p, inp); }
    if (Math.abs(px - p.x) + Math.abs(py - p.y) + Math.abs(pz - p.z) > 0.01) corrections++;
    offset = { x: before.x - p.x, y: before.y - p.y, z: before.z - p.z };
    if (Math.hypot(offset.x, offset.y, offset.z) > 1.5) offset = { x: 0, y: 0, z: 0 };
  }
  for (const e of m.ev) { try { onEvent(e, s); } catch (err) { console.error('event', e, err); } }
  latest = s;
}

// ---------- interpolation
function interpAt(t) {
  if (!snaps.length) return { players: [], proj: [] };
  let a = snaps[0], b = snaps[snaps.length - 1];
  if (t <= a.k) b = a;
  else if (t >= b.k) a = b;
  else for (let i = 0; i < snaps.length - 1; i++) if (snaps[i].k <= t && snaps[i + 1].k > t) { a = snaps[i]; b = snaps[i + 1]; break; }
  const f = b.k === a.k ? 0 : (t - a.k) / (b.k - a.k);
  const players = [];
  for (const [id, nb] of b.players) {
    if (id === myId) continue;
    const na = a.players.get(id) || nb;
    const teleport = Math.hypot(nb.x - na.x, nb.z - na.z) > 3 || na.alive !== nb.alive;
    const g = teleport ? 1 : f;
    const dyaw = Math.atan2(Math.sin(nb.yaw - na.yaw), Math.cos(nb.yaw - na.yaw));
    players.push({ ...nb, x: na.x + (nb.x - na.x) * g, y: na.y + (nb.y - na.y) * g, z: na.z + (nb.z - na.z) * g,
                   yaw: na.yaw + dyaw * g, pitch: na.pitch + (nb.pitch - na.pitch) * g, colorIdx: (roster.get(id) || {}).color | 0, skin: (roster.get(id) || {}).skin | 0 });
  }
  return { players };
}
const renderTick = () => (clock === null ? 0 : clock - C.INTERP);

// ---------- local firing effects (prediction; the server decides damage)
const tmpV = new THREE.Vector3();
function normalAt(x, y, z) {
  let best = null, bd = 0.05;
  MV.forEachSolid(world, b => {
    if (x < b.x0 - 0.05 || x > b.x1 + 0.05 || y < b.y0 - 0.05 || y > b.y1 + 0.05 || z < b.z0 - 0.05 || z > b.z1 + 0.05) return;
    for (const [d, n] of [[Math.abs(x - b.x0), [-1, 0, 0]], [Math.abs(x - b.x1), [1, 0, 0]], [Math.abs(y - b.y0), [0, -1, 0]], [Math.abs(y - b.y1), [0, 1, 0]], [Math.abs(z - b.z0), [0, 0, -1]], [Math.abs(z - b.z1), [0, 0, 1]]]) {
      if (d < bd) { bd = d; best = n; }
    }
  });
  return best;
}

function localTrace(o, d, maxT, remotes, pen = 0) {
  const wt = pen ? MV.wallTrace(world, o[0], o[1], o[2], d[0], d[1], d[2], maxT, pen) : null;
  const wall = wt ? { t: wt.tEnd } : MV.raycast(world, o[0], o[1], o[2], d[0], d[1], d[2], maxT);
  let t = wall.t, flesh = false;
  for (const q of remotes) {
    if (!q.alive) continue;
    const hb = MV.hitboxes(q.x, q.y, q.z, !!(q.flags & 8));
    const th = Math.min(MV.rayBox(o[0], o[1], o[2], d[0], d[1], d[2], hb.head, t), MV.rayBox(o[0], o[1], o[2], d[0], d[1], d[2], hb.body, t));
    if (th < t) { t = th; flesh = true; }
  }
  return { t, flesh, hit: t < maxT, walls: wt ? wt.walls.filter(w => w.tOut < t) : [] };
}

function muzzlePos() {
  const cam = renderer.camera;
  return cam.position.clone().add(tmpV.set(0.22, -0.18, -0.6).applyQuaternion(cam.quaternion)).toArray();
}

function localFire(shot) {
  if (shot.kind === 'empty') { audio.empty(); return; }
  if (shot.kind === 'drop') { audio.drop(null); showCenter(`Dropped ${WEAPONS[shot.w].name}`, 1); return; }
  const w = shot.w, def = WEAPONS[w];
  const code = w + (shot.kind === 'alt' ? (w === 4 ? 36 : 10) : 0);
  audio.gun(code);
  if (!renderer) return;
  renderer.vmFire(w);
  // recoil: the view climbs more the longer a rifle sprays
  punch += (def.kick || 0.02) * (shot.kind === 'alt' && w === 5 ? 1.8 : 1) * (1 + (shot.spray || 0) * 9);
  if (w === 1 || w === 6 || w === 7 || w === 11 || (w === 4 && shot.kind === 'alt')) return;
  renderer.ejectCasing(w, renderer.camera);
  const eye = [p.x + offset.x, p.y + offset.y + MV.eyeOf(p), p.z + offset.z];
  const base = MV.aimDir(ctl.yaw, ctl.pitch);
  const remotes = interpAt(renderTick()).players;
  const pellets = w === 5 ? (shot.kind === 'alt' ? def.altPellets : def.pellets) : 1;
  let spread = w === 5 ? def.spread : MV.spreadOf(p, w, shot.spray || 0);          // the same cone the server uses
  if (w === 2 && shot.kind === 'alt') spread += def.altSpread;
  if (w === 8) spread = ctl.zoom ? (Math.hypot(p.vx, p.vz) > 1.2 || !p.onGround ? def.movingSpread : 0) : def.spread;
  ctl.afterShot(w);
  const muz = muzzlePos();
  renderer.muzzleLight(...muz);
  for (let i = 0; i < pellets; i++) {
    const d = [base[0] + (Math.random() - 0.5) * spread * 1.6, base[1] + (Math.random() - 0.5) * spread * 1.6, base[2] + (Math.random() - 0.5) * spread * 1.6];
    const l = Math.hypot(...d); d[0] /= l; d[1] /= l; d[2] /= l;
    const h = localTrace(eye, d, 120, remotes, def.pen || 0);
    for (const wl of h.walls) for (const tt of [wl.tIn, wl.tOut]) { const pt = [eye[0] + d[0] * tt, eye[1] + d[1] * tt, eye[2] + d[2] * tt]; renderer.impact(pt[0], pt[1], pt[2], 0, normalAt(...pt)); }
    const end = [eye[0] + d[0] * h.t, eye[1] + d[1] * h.t, eye[2] + d[2] * h.t];
    if (w === 8) renderer.tracer(muz, end, 0xffffff, 0.25);
    else if (i < 6 || Math.random() < 0.4) renderer.tracer(muz, end);
    if (h.hit && !h.flesh) renderer.impact(end[0], end[1], end[2], 0, normalAt(...end));
  }
}

// ---------- server events
function nameOf(id) { const r = roster.get(id); return r ? r.name : id ? '?' : 'world'; }
function colorOf(id) { const r = roster.get(id); return r ? COLORS[r.color % COLORS.length] : '#ccc'; }
function remotePos(id) { const q = interpAt(renderTick()).players.find(x => x.id === id); return q ? [q.x, q.y + 1.4, q.z] : null; }

function onEvent(e, s) {
  const code = e[0];
  if (code === EV.SHOT) {
    const [, id, w] = e;
    if (id === myId) {                     // ours was drawn already; only show confirmed blood
      for (let i = 6; i + 3 < e.length; i += 4) if (e[i + 3] === 1 && renderer) renderer.impact(e[i], e[i + 1], e[i + 2], 1);
      return;
    }
    const from = remotePos(id) || [e[3], e[4], e[5]];
    audio.gun(w === 40 ? 40 : w, from);
    if (!renderer) return;
    const q = interpAt(renderTick()).players.find(x => x.id === id);
    const muz = q ? (() => { const d = MV.aimDir(q.yaw, q.pitch); return [q.x + d[0] * 0.7, q.y + 1.35 + d[1] * 0.7, q.z + d[2] * 0.7]; })() : [e[3], e[4], e[5]];
    renderer.muzzleLight(...muz);
    for (let i = 6; i + 3 < e.length; i += 4) {
      const end = [e[i], e[i + 1], e[i + 2]], surf = e[i + 3];
      if (surf === 3) { renderer.impact(end[0], end[1], end[2], 0, normalAt(...end)); continue; }      // a hole the bullet went through
      renderer.tracer(muz, end);
      if (surf !== 2) renderer.impact(end[0], end[1], end[2], surf, surf === 0 ? normalAt(...end) : null);
    }
  } else if (code === EV.MELEE) {
    const [, id, kind, x, y, z] = e;
    if (id !== myId) audio.gun(1, [x, y, z]);
    audio.melee(kind, [x, y, z]);
    if (renderer && kind) renderer.impact(x, y, z, kind === 2 ? 1 : 0, kind === 1 ? normalAt(x, y, z) : null);
  } else if (code === EV.BOOM) {
    const [, x, y, z, r] = e;
    audio.explosion([x, y, z]);
    if (renderer) renderer.explosion(x, y, z, r, renderer.camera.position);
  } else if (code === EV.KILL) {
    const [, k, v, w, head] = e;
    killfeed.push({ k, v, w, head, t: performance.now() });
    if (killfeed.length > 6) killfeed.shift();
    if (v === myId) {
      audio.death();
      deathInfo = { killer: k && k !== myId ? k : 0, w, at: performance.now(), pos: p ? [p.x, p.y, p.z] : [0, 0, 0] };
    } else if (k === myId) {
      audio.frag();
      showCenter(`<span style="color:${colorOf(v)}">${esc(nameOf(v))}</span> fragged${head ? ' · HEADSHOT' : ''}`, 1.6);
    }
  } else if (code === EV.HIT) {
    const [, a, v, amt, head] = e;
    if (a === myId && v !== myId) { hitmark = head ? 0.35 : 0.2; $('hitmark').classList.toggle('head', !!head); audio.hitmarker(head); }
    if (v === myId) {
      hurtFlash = Math.min(1, hurtFlash + amt / 40);
      audio.hurt();
      const src = a && a !== myId ? remotePos(a) : null;
      if (src && p) dmgDirs.push({ ang: Math.atan2(src[0] - p.x, src[2] - p.z), t: 1 });
    }
  } else if (code === EV.PROP) {
    if (renderer) renderer.propDestroyed(e[1]);
  } else if (code === EV.PICKUP) {
    if (e[1] === myId) {
      if (e[2] < 0) { audio.pickup('weapon'); showCenter(WEAPONS[-e[2]].name, 1.2); return; }      // a dropped gun
      const def = mapDef.PICKUPS[e[2]];
      audio.pickup(def.type);
      showCenter(def.type === 'weapon' ? WEAPONS[def.w].name : def.type === 'health' ? '+25 health' : def.type === 'battery' ? '+15 armor' : 'Ammo', 1.2);
    }
  } else if (code === EV.ROUND) {
    const [, w, reason] = e;
    const txt = w < 0 ? 'Round draw' : `<span style="color:${TEAMS[w].color}">${TEAMS[w].name} win</span>`;
    showCenter(`${txt}<br><small>${reason ? 'time ran out' : w < 0 ? 'everyone is down' : `${TEAMS[1 - w].short} eliminated`}</small>`, 4.5);
    if (w === myTeam) audio.frag(); else audio.death();
  } else if (code === EV.ROUND_START) {
    deathInfo = null; resetPending = true; specIdx = 0;
    showCenter(`Round ${e[1]} · ${myTeam >= 0 ? `<span style="color:${TEAMS[myTeam].color}">${TEAMS[myTeam].name}</span>` : ''}<br><small>B = loadout menu</small>`, 3);
  } else if (code === EV.BOUNCE) {
    audio.bounce([e[1], e[2], e[3]]);
  } else if (code === EV.DROP) {
    if (e[1] === myId) return;
    const q = e[1] === myId ? (p ? [p.x, p.y + 1, p.z] : null) : remotePos(e[1]);
    audio.drop(q);
  } else if (code === EV.SPAWN) {
    if (e[1] === myId) { resetPending = true; deathInfo = null; audio.spawn(); }
  } else if (code === EV.BOLT_HIT) {
    const [, x, y, z, surf] = e;
    audio.boltHit([x, y, z]);
    if (renderer) renderer.impact(x, y, z, surf, surf ? null : normalAt(x, y, z));
  }
}

// ---------- HUD
let centerTimer = 0;
function showCenter(html, secs) { $('center').innerHTML = html; $('center').classList.add('show'); centerTimer = secs; }
const cache = {};
function setText(id, v) { if (cache[id] !== v) { cache[id] = v; $(id).textContent = v; } }
function setHtml(id, v) { if (cache[id] !== v) { cache[id] = v; $(id).innerHTML = v; } }

function updateHud(dt) {
  if (!inRoom || !latest || !p) return;
  setText('hp', Math.max(0, Math.ceil(p.hp)));
  setText('ar', Math.ceil(p.armor));
  $('hpBox').classList.toggle('low', p.hp <= 25);
  const def = WEAPONS[p.cur];
  setText('ammoMag', def.melee ? '' : String(p.mag[p.cur] | 0));
  setText('ammoRes', def.melee || def.grenade ? '' : String(p.res[p.cur] | 0));
  setText('ammoAlt', p.cur === 4 ? `◉ ${p.alt}` : '');
  $('ammoSep').style.visibility = def.melee || def.grenade ? 'hidden' : '';
  // CS crosshair: the gap follows the real cone of fire (spray, running, jumping, crouching)
  const gap = Math.min(60, 3 + MV.spreadOf(p, p.cur) * 420 * (p.cur === 8 ? 0.4 : 1));
  if (cache.gap !== Math.round(gap)) { cache.gap = Math.round(gap); $('crosshair').style.setProperty('--gap', cache.gap + 'px'); }
  setText('wname', def.name + (p.reloadT > 0 ? ' · reloading' : ''));
  // Counter-Strike style slots: 1 primary · 2 pistol · 3 crowbar · 4 grenade
  let bar = '';
  for (const sl of [SLOT.PRIMARY, SLOT.PISTOL, SLOT.MELEE, SLOT.GRENADE]) {
    let w = 0;
    for (let x = 1; x <= NUM_WEAPONS; x++) if ((p.owned & (1 << x)) && WEAPONS[x].slot === sl) { w = x; break; }
    const d = w && WEAPONS[w], empty = d && !d.melee && !d.grenade && !(p.mag[w] | 0) && !(p.res[w] | 0);
    const label = !d ? ['', 'primary', 'pistol', 'melee', 'grenade'][sl] : d.grenade ? `${d.name} ×${p.mag[w] | 0}` : d.name;
    bar += `<div class="slot ${d ? 'own' : ''} ${w && w === p.cur ? 'cur' : ''} ${empty ? 'empty' : ''}"><b>${sl}</b>${label}</div>`;
  }
  setHtml('hotbar', bar);
  // kill feed
  const now = performance.now();
  killfeed = killfeed.filter(k => now - k.t < 7000);
  setHtml('killfeed', killfeed.map(k => `<div class="kf ${k.k === myId || k.v === myId ? 'mine' : ''}">${k.k && k.k !== k.v ? `<span style="color:${colorOf(k.k)}">${esc(nameOf(k.k))}</span>` : ''}
    <span class="kw">[${WEAPON_NAMES[k.w] || '?'}${k.head ? ' ✶' : ''}]</span> <span style="color:${colorOf(k.v)}">${esc(nameOf(k.v))}</span></div>`).join(''));
  // match info
  let leader = null;
  for (const [id, sc] of scores) if (roster.has(id) && (!leader || sc.k > leader.k)) leader = { id, k: sc.k };
  const tl = latest.tl;
  if (latest.tm) {
    const T = latest.tm, tt = T.time, dots = (n, total) => '●'.repeat(n) + '○'.repeat(Math.max(0, total - n));
    const size = t => [...roster.values()].filter(r => r.team === t).length;
    setHtml('matchInfo', latest.phase !== 'play' ? 'MATCH OVER' :
      `<span style="color:${TEAMS[0].color}">T ${T.wins[0]} ${dots(T.alive[0], size(0))}</span> · ${T.rphase === 'freeze' ? `freeze ${tt}` : `${Math.floor(tt / 60)}:${String(tt % 60).padStart(2, '0')}`} · round ${T.round} · <span style="color:${TEAMS[1].color}">${dots(T.alive[1], size(1))} ${T.wins[1]} CT</span>` +
      (T.buy && p.alive ? ' · <b>B</b> loadout' : ''));
  } else setText('matchInfo', `${latest.phase === 'play' ? `${Math.floor(tl / 60)}:${String(tl % 60).padStart(2, '0')}` : 'INTERMISSION'} · frag limit ${C.FRAG_LIMIT}${leader ? ' · leader ' + nameOf(leader.id) + ' ' + leader.k : ''}`);
  setText('netInfo', `${Math.round(net ? net.rtt : 0)} ms · ${fps} fps · ${corrections} corr`);
  // hit marker, hurt flash, damage direction
  hitmark = Math.max(0, hitmark - dt);
  $('hitmark').style.opacity = hitmark > 0 ? 1 : 0;
  hurtFlash = Math.max(0, hurtFlash - dt * 1.5);
  $('hurt').style.opacity = hurtFlash * 0.6;
  dmgDirs = dmgDirs.filter(d => (d.t -= dt) > 0).slice(-4);
  setHtml('dmgdirs', dmgDirs.map(d => `<div class="dd" style="transform:rotate(${(-(d.ang - ctl.yaw) + Math.PI) * 180 / Math.PI}deg);opacity:${d.t}"></div>`).join(''));
  // centre messages, death, scope, scoreboard
  if (centerTimer > 0 && (centerTimer -= dt) <= 0) $('center').classList.remove('show');
  if (!p.alive && roomMode === 'team') {
    const sp = spectateTarget();
    setHtml('deathMsg', `${deathInfo && deathInfo.killer ? `Killed by <span style="color:${colorOf(deathInfo.killer)}">${esc(nameOf(deathInfo.killer))}</span> [${WEAPON_NAMES[deathInfo.w]}]<br>` : ''}<small>${sp ? `spectating ${esc(nameOf(sp.id))} · click for the next teammate · ` : ''}you play again next round</small>`);
    $('deathMsg').classList.add('show');
  } else if (!p.alive && deathInfo) {
    setHtml('deathMsg', `${deathInfo.killer ? `Killed by <span style="color:${colorOf(deathInfo.killer)}">${esc(nameOf(deathInfo.killer))}</span> [${WEAPON_NAMES[deathInfo.w]}]` : 'You died'}<br><small>respawning in ${p.respawnIn}…</small>`);
    $('deathMsg').classList.add('show');
  } else $('deathMsg').classList.remove('show');
  if (buyOpen && !(latest.tm && latest.tm.buy && p.alive)) { buyOpen = false; $('buyMenu').classList.remove('show'); }
  $('scope').classList.toggle('show', !!ctl.zoom && p.alive);
  $('scope').classList.toggle('awp', p.cur === 8);
  $('crosshair').style.display = ctl.zoom ? 'none' : '';
  const sb = scoreboardHeld || latest.phase === 'intermission';
  $('scoreboard').classList.toggle('show', sb);
  if (sb) renderScoreboard();
}

function renderScoreboard() {
  const rows = [...roster.values()].map(r => ({ ...r, ...(scores.get(r.id) || { k: 0, d: 0 }) })).sort((a, b) => b.k - a.k || a.d - b.d);
  if (latest && latest.tm) {
    const T = latest.tm, over = latest.phase === 'intermission';
    const head = over ? `🏆 ${T.wins[0] > T.wins[1] ? TEAMS[0].name : TEAMS[1].name} win the match ${Math.max(...T.wins)}:${Math.min(...T.wins)} · next match in ${latest.tl}s` : `Room ${esc(roomCode)} · ${esc(mapDef.name)} · team elimination · first to ${C.ROUNDS_TO_WIN}`;
    const team = t => rows.filter(r => r.team === t).map(r => {
      const q = latest.players.get(r.id), dead = !q || !q.alive;
      return `<tr class="${r.id === myId ? 'me' : ''} ${dead ? 'dead' : ''}"><td></td><td><span class="dot" style="background:${TEAMS[t].color}"></span>${esc(r.name)}${r.bot ? ' <small>BOT</small>' : ''}${dead ? ' <small>†</small>' : ''}</td><td>${r.k}</td><td>${r.d}</td></tr>`;
    }).join('');
    setHtml('scoreboard', `<h3>${head}</h3><table><tr><th></th><th>Player</th><th>Kills</th><th>Deaths</th></tr>
      <tr class="tteam"><td></td><td colspan="3" style="color:${TEAMS[0].color}">${TEAMS[0].name} · ${T.wins[0]}</td></tr>${team(0)}
      <tr class="tteam"><td></td><td colspan="3" style="color:${TEAMS[1].color}">${TEAMS[1].name} · ${T.wins[1]}</td></tr>${team(1)}</table>`);
    return;
  }
  const title = latest && latest.phase === 'intermission' ? `🏆 ${esc(rows[0] ? rows[0].name : '')} wins the match · next round in ${latest.tl}s` : `Room ${esc(roomCode)} · ${esc(mapDef.name)}`;
  setHtml('scoreboard', `<h3>${title}</h3><table><tr><th></th><th>Player</th><th>Frags</th><th>Deaths</th></tr>${rows.map((r, i) =>
    `<tr class="${r.id === myId ? 'me' : ''}"><td>${i + 1}</td><td><span class="dot" style="background:${COLORS[r.color % COLORS.length]}"></span>${esc(r.name)}${r.bot ? ' <small>BOT</small>' : ''}</td><td>${r.k}</td><td>${r.d}</td></tr>`).join('')}</table>`);
}
ctl.onScoreboard = held => { scoreboardHeld = held; };

// ---------- main loop
let acc = 0, last = performance.now(), menuT = 0;
function tick() {
  if (!inRoom || !latest || !p || !net) return;
  if (!p.alive || latest.phase !== 'play') return;
  if (latest.tm && latest.tm.rphase === 'freeze') { ctl.sample(p); return; }
  const inp = ctl.sample(p);
  inp.s = ++seq;
  inp.rt = Math.round(renderTick() * 10) / 10;
  net.send({ t: 'i', s: inp.s, m: inp.m, y: Math.round(inp.yaw * 1000) / 1000, p: Math.round(inp.pitch * 1000) / 1000, b: inp.b, w: inp.w, rt: inp.rt });
  pending.push(inp);
  if (pending.length > 120) pending.shift();
  const prevCur = p.cur;
  MV.stepMove(p, inp, world);
  const shot = MV.stepWeapon(p, inp);
  if (shot) localFire(shot);
  if (p.cur !== prevCur) audio.switchWeapon();
  if (p.reloadT > 0 && !wasReloading) audio.reload(p.cur);
  wasReloading = p.reloadT > 0;
  const speed = Math.hypot(p.vx, p.vz);
  if (p.onGround && speed > 2 && performance.now() - lastFootstep > 330) {
    lastFootstep = performance.now();
    audio.footstep(null, p.y > 3 || p.y < -2);
  }
}

function loop(now) {
  const dt = Math.min(0.25, (now - last) / 1000);     // slow frames still produce every input tick
  last = now;
  frames++; fpsT += dt; if (fpsT > 0.5) { fps = Math.round(frames / fpsT); frames = 0; fpsT = 0; }
  acc += dt * 1000;
  let n = 0;
  while (acc >= STEP && n < 15) { tick(); acc -= STEP; n++; }
  if (n === 15) acc = 0;
  if (clock !== null) clock += dt * 60;
  const k = Math.pow(0.0008, dt);
  offset.x *= k; offset.y *= k; offset.z *= k;
  punch *= Math.pow(0.002, dt);

  if (renderer) {
    let cam, showVm = false, me = null, fov = 80;
    const remote = inRoom && latest ? interpAt(renderTick()).players : [];
    if (inRoom && latest && p) {
      if (p.alive && latest.phase === 'play') {
        eyeY += (MV.eyeOf(p) - eyeY) * Math.min(1, dt * 14);
        cam = { x: p.x + offset.x, y: p.y + offset.y + eyeY, z: p.z + offset.z, yaw: ctl.yaw, pitch: ctl.pitch };
        showVm = !ctl.zoom;
        me = { cur: p.cur, moving: Math.hypot(p.vx, p.vz) > 1, onGround: p.onGround, reloading: p.reloadT > 0 };
        fov = ctl.zoom && ZOOM_FOV[p.cur] ? ZOOM_FOV[p.cur][ctl.zoom] : 80;
      } else if (latest.phase === 'intermission') {
        menuT += dt * 0.15;
        cam = { x: Math.sin(menuT) * 14, y: 7, z: Math.cos(menuT) * 14, yaw: menuT, pitch: -0.35 };
      } else if (roomMode === 'team' && spectateTarget()) {
        const q = spectateTarget(), dir = MV.aimDir(q.yaw, 0);                                       // over a teammate's shoulder
        const cx = q.x - dir[0] * 3.2, cz = q.z - dir[2] * 3.2, cy = q.y + 2.3;
        const ok = MV.raycast(world, q.x, q.y + 1.8, q.z, -dir[0], 0, -dir[2], 3.2).t;
        const k = Math.min(1, (ok - 0.3) / 3.2);
        cam = { x: q.x - dir[0] * 3.2 * k, y: cy, z: q.z - dir[2] * 3.2 * k, yaw: q.yaw, pitch: q.pitch * 0.6 - 0.18 };
        void cx; void cz;
      } else {
        const d = deathInfo || { pos: [p.x, p.y, p.z] };
        const killer = deathInfo && deathInfo.killer ? remote.find(x => x.id === deathInfo.killer) : null;
        const cx = d.pos[0], cy = d.pos[1] + 2.4, cz = d.pos[2];
        const yaw = killer ? Math.atan2(-(killer.x - cx), -(killer.z - cz)) : ctl.yaw;
        const pitch = killer ? Math.atan2(killer.y + 1 - cy, Math.hypot(killer.x - cx, killer.z - cz)) : -0.6;
        cam = { x: cx, y: cy, z: cz, yaw, pitch };
      }
      audio.setListener(cam.x, cam.y, cam.z, cam.yaw);
    } else {
      // menu: look along the pit at the skin line-up (two rows either side of the menu card)
      menuT += dt;
      cam = { x: Math.sin(menuT * 0.15) * 0.5, y: -0.6, z: 7, yaw: Math.sin(menuT * 0.11) * 0.04, pitch: -0.05 };
    }
    // projectiles: extrapolate from the newest snapshot to "now"
    const proj = latest ? latest.proj.map(q => { const t = Math.max(0, (clock - latest.k) / 60); return { ...q, x: q.x + q.vx * t, y: q.y + q.vy * t, z: q.z + q.vz * t }; }) : [];
    if (!inRoom) remote.push(...showcase(dt));
    for (const q of remote) renderer.ensurePlayer(q.id, q.colorIdx, q.label || nameOf(q.id), q.skin | 0);
    renderer.render({ dt, cam, fov, punch, players: remote, projectiles: proj, items: latest ? latest.items : [],
                      pickups: latest ? latest.pk : 2 ** mapDef.PICKUPS.length - 1, props: latest ? latest.pp : 2 ** mapDef.PROPS.length - 1,
                      me, showViewmodel: showVm });
  }
  updateHud(dt);
  requestAnimationFrame(loop);
}

// ---------- wiring
// the name box shows the portal identity (identity.js); clicking it opens the account dialog
let deepJoin = (OIID.param('join') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) || null, lastRosterN = 0;
$('nameInput').readOnly = true;
$('nameInput').title = 'Your name in every game - click to change';
$('nameInput').placeholder = 'Pick a name';
$('nameInput').onclick = () => OIID.open();
OIID.me().then(id => { if (id) $('nameInput').value = id.name; });
OIID.onChange(id => { $('nameInput').value = id ? id.name : ''; if (id && net && net.open && !inRoom) net.send({ t: 'hello', name: id.name, token: id.token, skin: mySkin }); });
if (deepJoin) $('btnPlay').textContent = '▶ JOIN ROOM ' + deepJoin;
/** What the portal's "Playing now" list shows (and the link friends click to join this room). */
function playing() {
  if (inRoom) OIID.activity({ status: `${roomMode === 'team' ? 'team deathmatch' : 'deathmatch'} on ${mapDef.name} · ${Math.max(1, roster.size)}/${C.MAX_PLAYERS} players`, join: `hl_deathmatch.html?join=${roomCode}` });
  else OIID.activity({ status: 'in the lobby', join: 'hl_deathmatch.html' });
}
$('sens').value = ctl.sens * 1000;
$('sens').oninput = () => ctl.setSensitivity($('sens').value / 1000);
$('btnPlay').onclick = async () => { if (await connect()) { $('lobbyStatus').textContent = ''; show('pLobby'); } };
$('btnCreate').onclick = () => net && net.send({ t: 'create', bots: +$('botCount').value, level: $('botLevel').value, map: $('mapSelect').value, mode: $('modeSelect').value });

/** Team mode, while dead: the living teammate we are watching (click cycles). */
function spectateTarget() {
  if (!latest) return null;
  const mates = [...latest.players.values()].filter(q => q.alive && q.id !== myId && (roster.get(q.id) || {}).team === myTeam);
  if (!mates.length) return null;
  const q = mates[((specIdx % mates.length) + mates.length) % mates.length];
  return interpAt(renderTick()).players.find(x => x.id === q.id) || q;
}

// Free loadout menu (B, team mode during buy time): pick the primary handed out every round
function renderBuy() {
  $('buyMenu').innerHTML = `<h4>LOADOUT · free · press a number</h4>` + PRIMARIES.map((w, i) => `<div class="buy" data-w="${w}"><b>${i + 1}</b> ${WEAPONS[w].name}</div>`).join('') + '<small>+ HE grenade and armor every round · B / Esc closes</small>';
  $('buyMenu').querySelectorAll('.buy').forEach(b => b.onclick = () => pickBuy(+b.dataset.w));
}
function pickBuy(w) { if (net) net.send({ t: 'loadout', w }); buyOpen = false; $('buyMenu').classList.remove('show'); showCenter(`${WEAPONS[w].name}`, 1); }
addEventListener('keydown', e => {
  if (!inRoom || e.target.tagName === 'INPUT') return;
  if (e.code === 'KeyB' && roomMode === 'team' && latest && latest.tm && latest.tm.buy && p && p.alive) {
    buyOpen = !buyOpen; if (buyOpen) renderBuy(); $('buyMenu').classList.toggle('show', buyOpen);
  } else if (buyOpen && /^Digit[1-9]$/.test(e.code)) {
    const w = PRIMARIES[+e.code.slice(5) - 1]; if (w) pickBuy(w);
    e.stopImmediatePropagation();
  }
}, true);
canvas.addEventListener('mousedown', () => { if (inRoom && roomMode === 'team' && p && !p.alive) specIdx++; });

// skin picker (main menu) + the showcase the menu camera orbits
let showT = 0;
function showcase(dt) {
  showT += dt;
  return SKINS.map((sk, i) => {
    const side = i % 2 ? 1 : -1, j = i >> 1;
    const x = side * (4.2 + j * 1.25), z = 1.4 - j * 0.35;
    return { id: 'skin' + i, x, y: -2.5, z, yaw: Math.atan2(x, z - 7) + Math.sin(showT * 0.7 + i) * 0.35,
             pitch: Math.sin(showT + i) * 0.15, cur: [2, 3, 4, 5, 6, 7, 8, 1][i], alive: true, flags: 0, colorIdx: i, skin: i,
             label: (i === mySkin ? '▶ ' : '') + sk.name };
  });
}
function renderSkins() {
  $('skinPicker').innerHTML = SKINS.map((sk, i) =>
    `<button class="skin ${i === mySkin ? 'sel' : ''}" data-skin="${i}" title="${esc(sk.name)}" style="--suit:#${sk.suit.toString(16).padStart(6, '0')};--trim:#${sk.trim.toString(16).padStart(6, '0')}"></button>`).join('');
  $('skinName').textContent = SKINS[mySkin].name;
  $('skinPicker').querySelectorAll('button').forEach(b => { b.onclick = () => {
    mySkin = +b.dataset.skin;
    try { localStorage.setItem('hldmSkin', String(mySkin)); } catch (e) {}
    renderSkins();
    if (renderer) { renderer.removePlayer('skin' + mySkin); renderer.setViewSkin(mySkin); }
    if (net && net.open) net.send({ t: 'hello', name: OIID.name, token: OIID.token, skin: mySkin });
  }; });
}
renderSkins();
$('mapSelect').innerHTML = MAPDATA.IDS.map(id => `<option value="${id}">${esc(MAPDATA.MAPS[id].name)}</option>`).join('');
$('btnJoinCode').onclick = () => net && net.send({ t: 'join', code: $('codeInput').value.toUpperCase() });
$('codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnJoinCode').click(); });
$('codeInput').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
$('btnLobbyBack').onclick = () => { if (net) { net.close(); net = null; } show('pMain'); };
$('btnConnCancel').onclick = () => { if (net) { net.close(); net = null; } show('pMain'); };
$('btnResume').onclick = () => { hideOverlay(); ctl.lock(); };
$('btnAddBot').onclick = () => net && net.send({ t: 'addbot' });
$('btnKickBot').onclick = () => net && net.send({ t: 'kickbot' });
$('btnLeave').onclick = () => { if (net) net.send({ t: 'leave' }); leaveRoomLocal(); show('pLobby'); };
$('btnMsgOk').onclick = () => show(msgNext === 'pLobby' && !(net && net.open) ? 'pMain' : msgNext);
$('soundBtn').textContent = audio.on ? '🔊' : '🔇';
$('soundBtn').onclick = () => { $('soundBtn').textContent = audio.toggle() ? '🔊' : '🔇'; };
ctl.onEscape = () => { if (inRoom && current() === null) { $('pauseCode').textContent = roomCode; show('pPause'); } };
canvas.addEventListener('click', () => { audio.unlock(); if (inRoom && current() === null && !ctl.locked) ctl.lock(); });

// Ctrl is crouch, and Ctrl+W closes a browser tab: while in a room ask before leaving the page
addEventListener('beforeunload', e => { if (inRoom) { e.preventDefault(); e.returnValue = ''; } });

if (renderer) { renderer.setMap(mapDef); renderer.setViewSkin(mySkin); }
requestAnimationFrame(loop);
window.HLDM = {
  get state() {
    return { inRoom, roomCode, myId, phase: latest && latest.phase, tick: latest && latest.k, me: p && { x: p.x, y: p.y, z: p.z, hp: p.hp, armor: p.armor, alive: p.alive, cur: p.cur, owned: p.owned, mag: p.mag[p.cur], res: p.res[p.cur] },
             players: latest ? latest.players.size : 0, roster: [...roster.values()].map(r => r.name), scores: [...scores.entries()], killfeed: killfeed.length,
             corrections, pending: pending.length, rtt: net ? net.rtt : 0, fps, locked: ctl.locked, yaw: ctl.yaw, map: mapDef.id, zoom: ctl.zoom,
             mode: roomMode, team: myTeam, tm: latest && latest.tm };
  },
  // test hook: steer the local view without pointer lock (used by automated tests only)
  look(yaw, pitch) { ctl.setLook(yaw, pitch); },
};
