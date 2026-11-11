/**
 * Rooftop Tag - client entry point.
 *   - WebSocket connection, room list / create / join (rooms live in the shared Node game server)
 *   - 60 Hz input loop: sample, predict with the shared Movement code, send with sequence numbers
 *   - snapshots: reconcile the local runner (replay unacknowledged inputs), interpolate the others
 *     ~67 ms in the past (the moment the server rewinds to for lag-compensated tags)
 *   - events -> effects, sounds, feed; HUD (speedometer, flag status, minimap, speed lines); cameras
 */
import * as THREE from 'three';
import { Renderer3D } from './Renderer3D.js?v=2';
import { PlayerController } from './PlayerController.js?v=1';
import { AudioSystem } from './AudioSystem.js?v=1';

const K = window.RTConst, MAPDATA = window.RTMap, MV = window.RTMove;
const { C, PF, TEAMS, FLAG, EV } = K;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STEP = 1000 / 60;

const canvas = $('view');
let renderer = null;
try { renderer = new Renderer3D(canvas); } catch (e) { console.error(e); $('webglError').style.display = 'block'; }
const ctl = new PlayerController(canvas);
const audio = new AudioSystem();
let mapDef = MAPDATA.MAPS[MAPDATA.DEFAULT];
let world = MV.makeWorld(mapDef);
function useMap(id) {
  const def = MAPDATA.MAPS[id] || MAPDATA.MAPS[MAPDATA.DEFAULT];
  if (def === mapDef) return;
  mapDef = def; world = MV.makeWorld(def);
  if (renderer) renderer.setMap(def);
}
let wantTeam = -1;                     // lobby choice: -1 auto, 0 Magenta, 1 Cyan

// ---------- state
let net = null, inRoom = false, roomCode = '', myId = 0, myTeam = 0;
const roster = new Map(), scores = new Map();
let snaps = [], latest = null, clock = null;
let p = null, pending = [], seq = 0, offset = { x: 0, y: 0, z: 0 }, resetPending = true;
let feed = [], deathInfo = null, hitmark = 0, hurtFlash = 0, banner = null;
let scoreboardHeld = false, corrections = 0, fps = 60, frames = 0, fpsT = 0, lastStep = 0;
let eyeY = C.EYE, camRoll = 0, landDip = 0, maxSpeed = 0;

// ---------- networking
function wsUrl() {
  const q = new URLSearchParams(location.search).get('ws');
  return q || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/game/rooftop-ws`;
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
  if (net && net.open) { net.send({ t: 'hello', name, token }); return true; }
  show('pConn');
  net = new Net();
  net.on('welcome', m => { $('lobbyName').textContent = m.name; if (deepJoin) { net.send({ t: 'join', code: deepJoin }); deepJoin = null; } })
    .on('rooms', renderRooms)
    .on('error', m => { if (inRoom) return; show('pLobby'); $('lobbyStatus').textContent = m.msg; })
    .on('joined', onJoined)
    .on('team', m => { myTeam = m.team; resetPending = true; })
    .on('roster', m => {
      setTimeout(() => { if (inRoom && roster.size !== lastRosterN) { lastRosterN = roster.size; playing(); } }, 0);
      const ids = new Set(m.players.map(x => x.id));
      for (const id of [...roster.keys()]) if (!ids.has(id)) roster.delete(id);
      for (const x of m.players) roster.set(x.id, x);
      const me = roster.get(myId); if (me) myTeam = me.team;
      $('pauseBots').textContent = `${[...roster.values()].filter(x => x.bot).length} bots · ${roster.size}/${C.MAX_PLAYERS} runners`;
    })
    .on('s', onSnapshot)
    .on('close', () => { net = null; leaveRoomLocal(); message('Disconnected', 'Lost the connection to the game server.', 'pMain'); });
  try { await net.connect(); net.send({ t: 'hello', name, token }); return true; }
  catch (e) { net = null; message('Server unavailable', e.message, 'pMain'); return false; }
}

function renderRooms(m) {
  const list = $('roomList');
  list.innerHTML = m.rooms.length ? m.rooms.map(r =>
    `<div class="item"><span><b class="code">${esc(r.code)}</b> &nbsp;${r.players}/${r.max} runners <span class="muted">(${r.humans} human)</span></span>
     <span class="muted">${esc(r.map || '')} · ${esc(r.leader || '')}</span> <button data-code="${esc(r.code)}" ${r.humans >= r.max ? 'disabled' : ''}>Join</button></div>`).join('')
    : '<div class="empty">No rooms yet. Create one - a bot will race you until a friend joins.</div>';
  list.querySelectorAll('button[data-code]').forEach(b => { b.onclick = () => net.send({ t: 'join', code: b.dataset.code, team: wantTeam }); });
}

function onJoined(m) {
  inRoom = true; roomCode = m.code; myId = m.you; myTeam = m.team;
  useMap(m.map);
  snaps = []; latest = null; clock = null; p = null; pending = []; resetPending = true;
  feed = []; deathInfo = null; banner = null; scores.clear(); maxSpeed = 0;
  $('roomCode').textContent = m.code;
  playing();
  $('hud').classList.add('show');
  $('lobbyStatus').textContent = '';
  hideOverlay();
  ctl.active = true;
  ctl.lock();
  pushFeed(`Joined room <b>${esc(m.code)}</b> · ${esc(mapDef.name)} · you are <span style="color:${TEAMS[myTeam].color}">${TEAMS[myTeam].name}</span>`);
  showBanner(`<span style="color:${TEAMS[myTeam].color}">TEAM ${TEAMS[myTeam].name.toUpperCase()}</span><small>Steal their flag · bring it home · first to ${C.CAPTURE_LIMIT}</small>`, 3);
}

function leaveRoomLocal() {
  if (inRoom) setTimeout(playing, 0);
  inRoom = false; myId = 0; latest = null; p = null; snaps = [];
  roster.clear(); scores.clear();
  $('hud').classList.remove('show');
  ctl.active = false; ctl.unlock();
}

// ---------- snapshots
const PSTRIDE = 12;
function decode(m) {
  const players = new Map();
  for (let i = 0; i < m.p.length; i += PSTRIDE) {
    const a = m.p;
    players.set(a[i], { id: a[i], x: a[i + 1], y: a[i + 2], z: a[i + 3], yaw: a[i + 4], pitch: a[i + 5], alive: !!a[i + 6], bits: a[i + 7],
                        hx: a[i + 8], hy: a[i + 9], hz: a[i + 10], speed: a[i + 11] });
  }
  const flags = [];
  for (let i = 0; i < m.f.length; i += 6) flags.push({ state: m.f[i], carrier: m.f[i + 1], x: m.f[i + 2], y: m.f[i + 3], z: m.f[i + 4], ret: m.f[i + 5] });
  return { k: m.k, phase: m.ph ? 'intermission' : 'play', winner: m.w, tl: m.tl, players, flags, caps: m.c, me: m.me, ack: m.a };
}

const NSTATE = 30;
function fromServer(s) {
  const st = MV.unpackState(s.me.slice(0, NSTATE), {});
  const x = s.me.slice(NSTATE);
  return Object.assign(st, { hp: x[0], alive: !!x[1], respawnIn: x[2], team: x[3], yaw: ctl.yaw, pitch: ctl.pitch });
}

function onSnapshot(m) {
  if (!inRoom) return;
  const s = decode(m);
  if (latest && s.k <= latest.k) return;
  snaps.push(s); if (snaps.length > 40) snaps.shift();
  clock = clock === null || Math.abs(s.k - clock) > 30 ? s.k : clock + (s.k - clock) * 0.06;
  if (m.sc) for (let i = 0; i < m.sc.length; i += 5) scores.set(m.sc[i], { tags: m.sc[i + 1], deaths: m.sc[i + 2], caps: m.sc[i + 3], returns: m.sc[i + 4] });
  myTeam = s.me[NSTATE + 3];

  // reconcile the local runner
  const srv = fromServer(s);
  if (!srv.alive || !p || !p.alive || resetPending || Math.hypot(srv.x - p.x, srv.y - p.y, srv.z - p.z) > 5) {
    const wasDead = !p || !p.alive;
    p = srv; pending = pending.filter(i => i.s > s.ack); offset = { x: 0, y: 0, z: 0 };
    if (srv.alive && (wasDead || resetPending)) { ctl.setLook(srv.z < 0 ? Math.PI : 0, 0); resetPending = false; }
  } else {
    const before = { x: p.x + offset.x, y: p.y + offset.y, z: p.z + offset.z }, px = p.x, py = p.y, pz = p.z;
    p = srv;
    pending = pending.filter(i => i.s > s.ack);
    if (s.phase === 'play') for (const inp of pending) { MV.stepMove(p, inp, world); MV.stepWeapon(p, inp); }
    if (Math.abs(px - p.x) + Math.abs(py - p.y) + Math.abs(pz - p.z) > 0.01) corrections++;
    offset = { x: before.x - p.x, y: before.y - p.y, z: before.z - p.z };
    if (Math.hypot(offset.x, offset.y, offset.z) > 2) offset = { x: 0, y: 0, z: 0 };
  }
  for (const e of m.ev) { try { onEvent(e, s); } catch (err) { console.error('event', e, err); } }
  latest = s;
}

// ---------- interpolation
function interpAt(t) {
  if (!snaps.length) return [];
  let a = snaps[0], b = snaps[snaps.length - 1];
  if (t <= a.k) b = a;
  else if (t >= b.k) a = b;
  else for (let i = 0; i < snaps.length - 1; i++) if (snaps[i].k <= t && snaps[i + 1].k > t) { a = snaps[i]; b = snaps[i + 1]; break; }
  const f = b.k === a.k ? 0 : (t - a.k) / (b.k - a.k);
  const out = [];
  for (const [id, nb] of b.players) {
    if (id === myId) continue;
    const na = a.players.get(id) || nb;
    const teleport = Math.hypot(nb.x - na.x, nb.z - na.z) > 4 || na.alive !== nb.alive;
    const g = teleport ? 1 : f;
    const dyaw = Math.atan2(Math.sin(nb.yaw - na.yaw), Math.cos(nb.yaw - na.yaw));
    const r = roster.get(id) || {};
    out.push({ ...nb, x: na.x + (nb.x - na.x) * g, y: na.y + (nb.y - na.y) * g, z: na.z + (nb.z - na.z) * g,
               yaw: na.yaw + dyaw * g, pitch: na.pitch + (nb.pitch - na.pitch) * g, team: r.team | 0, name: r.name || '?' });
  }
  return out;
}
const renderTick = () => (clock === null ? 0 : clock - C.INTERP);

// ---------- feed, banners, names
function nameOf(id) { const r = roster.get(id); return r ? r.name : '?'; }
function teamOf(id) { const r = roster.get(id); return r ? r.team : 0; }
function nameHtml(id) { return `<span style="color:${TEAMS[teamOf(id)].color}">${esc(nameOf(id))}</span>`; }
function pushFeed(html) { feed.push({ html, t: performance.now() }); if (feed.length > 7) feed.shift(); }
function showBanner(html, secs) { banner = { html, until: performance.now() + secs * 1000 }; }

// ---------- local tagger (prediction; the server decides hits)
function localTag() {
  audio.tag(null);
  if (!renderer) return;
  renderer.vmFire();
  const eye = [p.x + offset.x, p.y + offset.y + MV.eyeOf(p), p.z + offset.z];
  const d = MV.aimDir(ctl.yaw, ctl.pitch);
  let t = MV.raycast(world, eye[0], eye[1], eye[2], d[0], d[1], d[2], C.TAGGER_RANGE).t, hit = false;
  for (const q of interpAt(renderTick())) {
    if (!q.alive || q.team === myTeam) continue;
    const tt = MV.rayBox(eye[0], eye[1], eye[2], d[0], d[1], d[2], MV.hitbox(q.x, q.y, q.z, !!(q.bits & PF.CROUCH)), t);
    if (tt < t) { t = tt; hit = true; }
  }
  const cam = renderer.camera, muzzle = cam.position.clone().add(new THREE.Vector3(0.2, -0.16, -0.5).applyQuaternion(cam.quaternion));
  renderer.tagBeam(muzzle.toArray(), [eye[0] + d[0] * t, eye[1] + d[1] * t, eye[2] + d[2] * t], TEAMS[myTeam].hex, hit);
}

/** Sounds and effects for what our own predicted step did. */
function localMoveFx(out) {
  if (out.pad >= 0) { audio.pad(null); if (renderer) renderer.padBurst(out.pad); }
  if (out.walljump) { audio.wallJump(null); if (renderer) renderer.wallSparks(p.x, p.y + 1, p.z, TEAMS[myTeam].hex); }
  if (out.hook === 'hit') { audio.hookFire(); audio.hookLatch([p.hx, p.hy, p.hz]); }
  else if (out.hook === 'miss') { audio.hookFire(); audio.hookMiss(); }
  else if (out.hook === 'release') audio.hookRelease();
  if (out.slide) audio.slide();
  if (out.land > 4) { audio.land(out.land); landDip = Math.min(0.25, out.land / 60); if (renderer) renderer.vmLand(out.land); }
}

// ---------- server events
function remote(id) { return interpAt(renderTick()).find(x => x.id === id); }
function onEvent(e, s) {
  const code = e[0];
  if (code === EV.SHOT) {
    const [, id, ox, oy, oz, ex, ey, ez, hit] = e;
    if (id === myId) return;                                   // ours was drawn already
    const q = remote(id);
    const from = q ? (() => { const d = MV.aimDir(q.yaw, q.pitch); return [q.x + d[0] * 0.6, q.y + 1.35 + d[1] * 0.6, q.z + d[2] * 0.6]; })() : [ox, oy, oz];
    audio.tag(from);
    if (renderer) renderer.tagBeam(from, [ex, ey, ez], TEAMS[teamOf(id)].hex, !!hit);
  } else if (code === EV.HIT) {
    const [, a, v, amt] = e;
    if (a === myId && v !== myId) { hitmark = 0.25; audio.hitmarker(); }
    if (v === myId) { hurtFlash = Math.min(1, hurtFlash + amt / 35); audio.hurt(); }
  } else if (code === EV.KILL) {
    const [, k, v, cause] = e;
    const q = v === myId ? (p ? { x: p.x, y: p.y, z: p.z } : null) : remote(v);
    if (cause === 1) {
      pushFeed(`${nameHtml(v)} fell off the roof${k ? ` <span class="muted">(pushed by ${nameHtml(k)})</span>` : ''}`);
      if (v === myId) audio.fall();
    } else {
      pushFeed(`${nameHtml(k)} <span class="muted">⚡ tagged</span> ${nameHtml(v)}`);
      if (q && renderer) renderer.derez(q.x, q.y, q.z, teamOf(v));
      if (q) audio.derez([q.x, q.y + 1, q.z]);
    }
    if (v === myId) deathInfo = { killer: k, cause, at: performance.now(), pos: p ? [p.x, p.y, p.z] : [0, 0, 0] };
    else if (k === myId) { audio.frag(); showBanner(`TAGGED ${nameHtml(v)}`, 1.2); }
  } else if (code === EV.SPAWN) {
    if (e[1] === myId) { resetPending = true; deathInfo = null; audio.spawn(); }
  } else if (code === EV.FLAG_TAKE) {
    const [, id, ft] = e;
    const ours = ft === myTeam;
    pushFeed(`${nameHtml(id)} took the <span style="color:${TEAMS[ft].color}">${TEAMS[ft].name}</span> flag`);
    audio.flagAlert(!ours);
    if (id === myId) showBanner('YOU HAVE THEIR FLAG<small>run it home!</small>', 2);
    else if (ours) showBanner(`<span style="color:${TEAMS[ft].color}">OUR FLAG IS TAKEN</span><small>tag the carrier</small>`, 2);
  } else if (code === EV.FLAG_DROP) {
    const [, id, ft] = e;
    pushFeed(`${nameHtml(id)} dropped the <span style="color:${TEAMS[ft].color}">${TEAMS[ft].name}</span> flag`);
  } else if (code === EV.FLAG_RETURN) {
    const [, ft, by] = e;
    pushFeed(`<span style="color:${TEAMS[ft].color}">${TEAMS[ft].name}</span> flag returned${by ? ' by ' + nameHtml(by) : ''}`);
    audio.flagAlert(ft === myTeam);
  } else if (code === EV.CAPTURE) {
    const [, id] = e;
    const t = teamOf(id), good = t === myTeam;
    pushFeed(`<b>${nameHtml(id)} CAPTURED</b> for ${TEAMS[t].name}`);
    audio.capture(good);
    showBanner(`<span style="color:${TEAMS[t].color}">${TEAMS[t].name.toUpperCase()} SCORES</span><small>${esc(nameOf(id))} captured the flag</small>`, 2.5);
    if (renderer && p) renderer.shake = 0.5;
  } else if (code === EV.PAD) {
    if (e[1] !== myId) { if (renderer) renderer.padBurst(e[2]); const pd = world.pads[e[2]]; if (pd) audio.pad([(pd.x0 + pd.x1) / 2, pd.y, (pd.z0 + pd.z1) / 2]); }
  } else if (code === EV.HOOK) {
    if (e[1] !== myId) audio.hookLatch([e[2], e[3], e[4]]);
  } else if (code === EV.WALLJUMP) {
    if (e[1] !== myId) { const q = remote(e[1]); if (q) audio.wallJump([q.x, q.y, q.z]); }
  } else if (code === EV.WIN) {
    const w = e[1];
    if (w < 0) showBanner('DRAW<small>time is up</small>', 6);
    else showBanner(`<span style="color:${TEAMS[w].color}">${TEAMS[w].name.toUpperCase()} WINS</span><small>${w === myTeam ? 'nice running!' : 'next round in a few seconds'}</small>`, 7);
    audio.capture(w === myTeam);
  }
}

// ---------- HUD
const cache = {};
function setText(id, v) { if (cache[id] !== v) { cache[id] = v; $(id).textContent = v; } }
function setHtml(id, v) { if (cache[id] !== v) { cache[id] = v; $(id).innerHTML = v; } }
const FLAG_TXT = ['AT BASE', 'TAKEN', 'DROPPED'];

function updateHud(dt) {
  if (!inRoom || !latest || !p) return;
  const now = performance.now();
  const hp = Math.max(0, Math.ceil(p.hp));
  setText('hp', hp);
  $('hpBar').style.width = hp + '%';
  $('hpBox').classList.toggle('low', hp <= 30);
  const speed = Math.hypot(p.vx, p.vz);
  maxSpeed = Math.max(maxSpeed, speed);
  setText('speed', speed.toFixed(1));
  $('speedBar').style.width = Math.min(100, speed / C.MAX_HSPEED * 100) + '%';
  $('speedBar').classList.toggle('fast', speed > C.MAX_SPEED + 1);
  setText('moveState', p.hook ? 'HOOKED' : p.slide > 0 ? 'SLIDING' : p.wrOn ? 'WALL RUN' : !p.onGround ? 'AIR' : p.crouch ? 'CROUCH' : speed > 1 ? 'RUN' : '');
  // hook cooldown ring
  const hookReady = !p.hook && p.hookCool === 0;
  $('hookIcon').classList.toggle('ready', hookReady);
  $('hookIcon').classList.toggle('active', p.hook);
  $('hookFill').style.height = (p.hook ? 100 : 100 - Math.min(100, p.hookCool / C.HOOK_COOL * 100)) + '%';
  // team scores + flags
  const caps = latest.caps;
  const tl = latest.tl;
  setHtml('score', `<span class="t0">${TEAMS[0].name.toUpperCase()} <b>${caps[0]}</b></span><span class="clock">${latest.phase === 'play' ? `${Math.floor(tl / 60)}:${String(tl % 60).padStart(2, '0')}` : 'END'}</span><span class="t1"><b>${caps[1]}</b> ${TEAMS[1].name.toUpperCase()}</span>`);
  setHtml('flags', latest.flags.map((f, i) => {
    const txt = f.state === FLAG.CARRIED ? `TAKEN · ${esc(nameOf(f.carrier))}` : f.state === FLAG.DROPPED ? `DROPPED · ${f.ret}s` : FLAG_TXT[0];
    return `<div class="flag f${i} s${f.state} ${i === myTeam ? 'mine' : ''}"><span class="fi">⚑</span>${i === myTeam ? 'OUR' : 'THEIR'} FLAG<br><b>${txt}</b></div>`;
  }).join(''));
  $('carrying').classList.toggle('show', !!p.carry && p.alive);
  // feed
  feed = feed.filter(f => now - f.t < 8000);
  setHtml('feed', feed.map(f => `<div class="fd">${f.html}</div>`).join(''));
  setText('netInfo', `${Math.round(net ? net.rtt : 0)} ms · ${fps} fps · ${corrections} corr · best ${maxSpeed.toFixed(1)} m/s`);
  // hit marker, hurt flash, banner, death
  hitmark = Math.max(0, hitmark - dt);
  $('hitmark').style.opacity = hitmark > 0 ? 1 : 0;
  hurtFlash = Math.max(0, hurtFlash - dt * 1.5);
  $('hurt').style.opacity = hurtFlash * 0.6;
  if (banner && now < banner.until) { setHtml('banner', banner.html); $('banner').classList.add('show'); } else $('banner').classList.remove('show');
  if (!p.alive && deathInfo) {
    const why = deathInfo.cause === 1 ? 'You fell off the roof' : `Tagged by ${nameHtml(deathInfo.killer)}`;
    setHtml('deathMsg', `${why}<br><small>back in ${p.respawnIn}…</small>`);
    $('deathMsg').classList.add('show');
  } else $('deathMsg').classList.remove('show');
  const sb = scoreboardHeld || latest.phase === 'intermission';
  $('scoreboard').classList.toggle('show', sb);
  if (sb) renderScoreboard();
}

function renderScoreboard() {
  const rows = [...roster.values()].map(r => ({ ...r, ...(scores.get(r.id) || { tags: 0, deaths: 0, caps: 0, returns: 0 }) }));
  const end = latest && latest.phase === 'intermission';
  const title = end ? (latest.winner < 0 ? 'Draw' : `${TEAMS[latest.winner].name} wins · next round in ${latest.tl}s`) : `Room ${esc(roomCode)} · ${mapDef.name}`;
  const team = t => rows.filter(r => r.team === t).sort((a, b) => b.caps - a.caps || b.tags - a.tags).map(r =>
    `<tr class="${r.id === myId ? 'me' : ''}"><td><span class="dot" style="background:${TEAMS[t].color}"></span>${esc(r.name)}${r.bot ? ' <small>BOT</small>' : ''}</td><td>${r.caps}</td><td>${r.returns}</td><td>${r.tags}</td><td>${r.deaths}</td></tr>`).join('');
  setHtml('scoreboard', `<h3>${title}</h3><table><tr><th>Runner</th><th>Caps</th><th>Returns</th><th>Tags</th><th>Deaths</th></tr>
    <tr class="th0"><td colspan="5">${TEAMS[0].name} · ${latest.caps[0]}</td></tr>${team(0)}<tr class="th1"><td colspan="5">${TEAMS[1].name} · ${latest.caps[1]}</td></tr>${team(1)}</table>`);
}
ctl.onScoreboard = held => { scoreboardHeld = held; };

// ---------- minimap (top-down, north = Magenta base)
const mm = $('minimap'), mmx = mm.getContext('2d');
const MM = { x0: -24, x1: 24, z0: -54, z1: 54 };
function drawMinimap(others) {
  const W = mm.width, H = mm.height, sx = W / (MM.x1 - MM.x0), sz = H / (MM.z1 - MM.z0);
  const flip = myTeam === 1;                        // your base is always at the bottom
  const X = x => (flip ? MM.x1 - x : x - MM.x0) * sx, Z = z => (flip ? z - MM.z0 : MM.z1 - z) * sz;
  mmx.clearRect(0, 0, W, H);
  mmx.fillStyle = 'rgba(8,4,18,.75)'; mmx.fillRect(0, 0, W, H);
  for (const b of mapDef.BOXES) {
    const [x0, y0, z0, x1, y1, z1, mat] = b;
    if (x1 < MM.x0 || x0 > MM.x1 || mat === 'pylon') continue;
    mmx.fillStyle = mat === 'roof' ? '#262338' : mat === 'glass' ? 'rgba(106,216,255,.5)' : mat === 'beam' ? 'rgba(255,157,26,.7)' : y1 > 2 ? '#4a4560' : '#38344c';
    const a = X(x0), b2 = X(x1), c = Z(z0), d = Z(z1);
    mmx.fillRect(Math.min(a, b2), Math.min(c, d), Math.abs(b2 - a) || 1, Math.abs(d - c) || 1);
  }
  mmx.fillStyle = 'rgba(34,230,255,.6)';
  for (const pd of world.pads) { const a = X(pd.x0), b2 = X(pd.x1), c = Z(pd.z0), d = Z(pd.z1); mmx.fillRect(Math.min(a, b2), Math.min(c, d), Math.abs(b2 - a), Math.abs(d - c)); }
  if (latest) latest.flags.forEach((f, i) => {
    mmx.fillStyle = TEAMS[i].color;
    mmx.font = 'bold 13px sans-serif'; mmx.textAlign = 'center';
    mmx.fillText('⚑', X(f.x), Z(f.z) + 5);
  });
  for (const q of others) {
    if (!q.alive) continue;
    const enemy = q.team !== myTeam;
    if (enemy && !(q.bits & (PF.CARRY | PF.FIRED))) continue;     // enemies show when they shoot or carry
    mmx.fillStyle = TEAMS[q.team].color;
    mmx.beginPath(); mmx.arc(X(q.x), Z(q.z), q.bits & PF.CARRY ? 4.5 : 3, 0, 7); mmx.fill();
  }
  if (p && p.alive) {
    const a = flip ? Math.PI - ctl.yaw : -ctl.yaw;
    mmx.save(); mmx.translate(X(p.x), Z(p.z)); mmx.rotate(a);
    mmx.fillStyle = '#fff'; mmx.beginPath(); mmx.moveTo(0, -6); mmx.lineTo(4, 4); mmx.lineTo(-4, 4); mmx.fill(); mmx.restore();
  }
}

// ---------- speed lines (2D overlay)
const sl = $('speedlines'), slx = sl.getContext('2d');
const lines = Array.from({ length: 70 }, () => ({ a: Math.random() * Math.PI * 2, r: Math.random(), s: 0.6 + Math.random() }));
function drawSpeedLines(speed, dt) {
  const r = sl.getBoundingClientRect();
  if (sl.width !== (r.width | 0)) { sl.width = r.width | 0; sl.height = r.height | 0; }
  slx.clearRect(0, 0, sl.width, sl.height);
  const k = Math.max(0, Math.min(1, (speed - 10) / 12));
  if (k <= 0) return;
  const cx = sl.width / 2, cy = sl.height / 2, R = Math.hypot(cx, cy);
  slx.strokeStyle = `rgba(200,230,255,${0.35 * k})`;
  slx.lineWidth = 1.5;
  for (const L of lines) {
    L.r += dt * L.s * (1 + speed / 10);
    if (L.r > 1) { L.r = 0.35 + Math.random() * 0.2; L.a = Math.random() * Math.PI * 2; }
    const r0 = R * L.r, r1 = R * Math.min(1.1, L.r + 0.08 + k * 0.12);
    slx.beginPath(); slx.moveTo(cx + Math.cos(L.a) * r0, cy + Math.sin(L.a) * r0); slx.lineTo(cx + Math.cos(L.a) * r1, cy + Math.sin(L.a) * r1); slx.stroke();
  }
}

// ---------- main loop
let acc = 0, last = performance.now(), menuT = 0;
function tick() {
  if (!inRoom || !latest || !p || !net) return;
  if (!p.alive || latest.phase !== 'play') return;
  const inp = ctl.sample();
  inp.s = ++seq;
  inp.rt = Math.round(renderTick() * 10) / 10;
  net.send({ t: 'i', s: inp.s, m: inp.m, y: Math.round(inp.yaw * 1000) / 1000, p: Math.round(inp.pitch * 1000) / 1000, b: inp.b, rt: inp.rt });
  pending.push(inp);
  if (pending.length > 120) pending.shift();
  const wasGround = p.onGround;
  const out = MV.stepMove(p, inp, world);
  localMoveFx(out);
  if (wasGround && !p.onGround && p.vy > 6 && out.pad < 0 && !out.walljump) audio.jump();
  if (MV.stepWeapon(p, inp)) localTag();
  const speed = Math.hypot(p.vx, p.vz);
  if (p.onGround && p.slide === 0 && speed > 2 && performance.now() - lastStep > 2600 / (speed + 2)) { lastStep = performance.now(); audio.footstep(true); }
}

function loop(now) {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  frames++; fpsT += dt; if (fpsT > 0.5) { fps = Math.round(frames / fpsT); frames = 0; fpsT = 0; }
  acc += dt * 1000;
  let n = 0;
  while (acc >= STEP && n < 15) { tick(); acc -= STEP; n++; }
  if (n === 15) acc = 0;
  if (clock !== null) clock += dt * 60;
  const k = Math.pow(0.0008, dt);
  offset.x *= k; offset.y *= k; offset.z *= k;
  landDip *= Math.pow(0.004, dt);

  const others = inRoom && latest ? interpAt(renderTick()) : [];
  let speed = 0;
  if (renderer) {
    let cam, showVm = false, me = null, fov = 88;
    const cables = [];
    if (inRoom && latest && p) {
      if (p.alive && latest.phase === 'play') {
        eyeY += (MV.eyeOf(p) - eyeY) * Math.min(1, dt * 14);
        speed = Math.hypot(p.vx, p.vz);
        // lean away from the wall while wall running, a little roll into slides
        let roll = 0;
        if (p.wrOn) { const right = [Math.cos(ctl.yaw), -Math.sin(ctl.yaw)]; roll = (p.wrNx * right[0] + p.wrNz * right[1]) > 0 ? -0.14 : 0.14; }
        else if (p.slide > 0) roll = 0.04;
        camRoll += (roll - camRoll) * Math.min(1, dt * 8);
        cam = { x: p.x + offset.x, y: p.y + offset.y + eyeY - landDip, z: p.z + offset.z, yaw: ctl.yaw, pitch: ctl.pitch, roll: camRoll };
        showVm = true;
        fov = 88 + Math.max(0, Math.min(18, (speed - C.MAX_SPEED) * 1.3));
        me = { team: myTeam, speed, moving: speed > 1, onGround: p.onGround, hook: p.hook, sliding: p.slide > 0 };
        if (p.hook) {
          const c = renderer.camera, hand = c.position.clone().add(new THREE.Vector3(-0.3, -0.25, -0.5).applyQuaternion(c.quaternion));
          cables.push({ from: hand.toArray(), to: [p.hx, p.hy, p.hz] });
        }
        audio.motion(speed, p.slide > 0, p.wrOn);
      } else if (latest.phase === 'intermission') {
        menuT += dt * 0.12;
        const cx = Math.sin(menuT) * 12, cz = Math.cos(menuT) * 30;
        cam = { x: cx, y: 22, z: cz, yaw: Math.atan2(cx, cz), pitch: -0.62 };
        audio.motion(0, false, false);
      } else {
        const d = deathInfo || { pos: [p.x, p.y, p.z] };
        const killer = deathInfo && deathInfo.killer ? others.find(x => x.id === deathInfo.killer) : null;
        const t = (performance.now() - (deathInfo ? deathInfo.at : 0)) / 1000;
        const cx = d.pos[0] + Math.sin(t * 0.6) * 4, cy = Math.max(d.pos[1], -6) + 3.5, cz = d.pos[2] + Math.cos(t * 0.6) * 4;
        const tx = killer ? killer.x : d.pos[0], ty = killer ? killer.y + 1 : Math.max(d.pos[1], -6), tz = killer ? killer.z : d.pos[2];
        cam = { x: cx, y: cy, z: cz, yaw: Math.atan2(-(tx - cx), -(tz - cz)), pitch: Math.atan2(ty - cy, Math.hypot(tx - cx, tz - cz)) };
        audio.motion(0, false, false);
      }
      audio.setListener(cam.x, cam.y, cam.z, cam.yaw);
    } else {
      // menu: a slow flight over the rooftops
      menuT += dt * 0.05;
      const z = Math.sin(menuT) * 30;
      cam = { x: Math.sin(menuT * 1.7) * 5, y: 13.5 + Math.sin(menuT * 2.3) * 1.5, z, yaw: Math.PI * 0.5 + Math.sin(menuT * 0.9) * 0.8, pitch: -0.42 };
    }
    for (const q of others) {
      renderer.ensurePlayer(q.id, q.team, q.name);
      if (q.bits & PF.WALLRUN) {
        const n = MV.wallBeside({ x: q.x, y: q.y, z: q.z }, world);
        if (n) { const right = [Math.cos(q.yaw), -Math.sin(q.yaw)]; renderer.setWallSide(q.id, n[0] * right[0] + n[1] * right[1] > 0 ? 1 : -1); }
      }
      if ((q.bits & PF.HOOK) && q.alive) cables.push({ from: [q.x, q.y + 1.35, q.z], to: [q.hx, q.hy, q.hz] });
    }
    const flags = latest ? latest.flags.map(f => ({ ...f, local: f.state === FLAG.CARRIED && f.carrier === myId })) : mapDef.FLAGS.map(f => ({ state: FLAG.BASE, x: f.pos[0], y: f.pos[1], z: f.pos[2] }));
    // a carried flag follows the interpolated carrier, not the snapshot
    for (const f of flags) if (f.state === FLAG.CARRIED) { const q = others.find(x => x.id === f.carrier); if (q) { f.x = q.x; f.y = q.y; f.z = q.z; } }
    renderer.render({ dt, cam, fov, players: others, flags, me, showViewmodel: showVm, cables });
  }
  if (inRoom && latest) { drawMinimap(others); drawSpeedLines(p && p.alive ? speed : 0, dt); }
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
OIID.onChange(id => { $('nameInput').value = id ? id.name : ''; if (id && net && net.open && !inRoom) net.send({ t: 'hello', name: id.name, token: id.token }); });
if (deepJoin) $('btnPlay').textContent = '▶ JOIN ROOM ' + deepJoin;
/** What the portal's "Playing now" list shows (and the link friends click to join this room). */
function playing() {
  if (inRoom) OIID.activity({ status: `capture the flag on ${mapDef.name} · ${Math.max(1, roster.size)}/${C.MAX_PLAYERS} runners`, join: `rooftop_tag.html?join=${roomCode}` });
  else OIID.activity({ status: 'in the lobby', join: 'rooftop_tag.html' });
}
$('sens').value = ctl.sens * 1000;
$('sens').oninput = () => ctl.setSensitivity($('sens').value / 1000);
$('btnPlay').onclick = async () => { if (await connect()) { $('lobbyStatus').textContent = ''; show('pLobby'); } };
$('mapSelect').innerHTML = MAPDATA.IDS.map(id => `<option value="${id}">${esc(MAPDATA.MAPS[id].name)}</option>`).join('');
try { const v = localStorage.getItem('rtMap'); if (MAPDATA.MAPS[v]) $('mapSelect').value = v; } catch (e) {}
$('mapSelect').onchange = () => { try { localStorage.setItem('rtMap', $('mapSelect').value); } catch (e) {} };
function pickTeam(t) {
  wantTeam = t;
  document.querySelectorAll('#teamPick button').forEach(b => b.classList.toggle('on', +b.dataset.team === t));
  try { localStorage.setItem('rtTeam', t); } catch (e) {}
}
document.querySelectorAll('#teamPick button').forEach(b => { b.onclick = () => pickTeam(+b.dataset.team); });
let savedTeam = null;
try { savedTeam = localStorage.getItem('rtTeam'); } catch (e) {}
pickTeam(savedTeam === '0' ? 0 : savedTeam === '1' ? 1 : -1);
$('btnCreate').onclick = () => net && net.send({ t: 'create', bots: +$('modeSelect').value, level: $('botLevel').value, map: $('mapSelect').value, team: wantTeam });
$('btnJoinCode').onclick = () => net && net.send({ t: 'join', code: $('codeInput').value.toUpperCase(), team: wantTeam });
$('codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnJoinCode').click(); });
$('codeInput').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
$('btnLobbyBack').onclick = () => { if (net) { net.close(); net = null; } show('pMain'); };
$('btnConnCancel').onclick = () => { if (net) { net.close(); net = null; } show('pMain'); };
$('btnResume').onclick = () => { hideOverlay(); ctl.lock(); };
$('btnAddBot').onclick = () => net && net.send({ t: 'addbot' });
$('btnKickBot').onclick = () => net && net.send({ t: 'kickbot' });
$('btnSwitch').onclick = () => { if (net) net.send({ t: 'team' }); hideOverlay(); ctl.lock(); };
$('btnLeave').onclick = () => { if (net) net.send({ t: 'leave' }); leaveRoomLocal(); show('pLobby'); };
$('btnMsgOk').onclick = () => show(msgNext === 'pLobby' && !(net && net.open) ? 'pMain' : msgNext);
$('soundBtn').textContent = audio.on ? '🔊' : '🔇';
$('soundBtn').onclick = () => { $('soundBtn').textContent = audio.toggle() ? '🔊' : '🔇'; };
ctl.onEscape = () => { if (inRoom && current() === null) { $('pauseCode').textContent = roomCode; show('pPause'); } };
canvas.addEventListener('click', () => { audio.unlock(); if (inRoom && current() === null && !ctl.locked) ctl.lock(); });

if (renderer) renderer.setMap(mapDef);
requestAnimationFrame(loop);
window.RTAG = {
  get state() {
    return { inRoom, roomCode, myId, team: myTeam, phase: latest && latest.phase, tick: latest && latest.k,
             me: p && { x: p.x, y: p.y, z: p.z, vx: p.vx, vz: p.vz, hp: p.hp, alive: p.alive, carry: p.carry, hook: p.hook, slide: p.slide, wrOn: p.wrOn, onGround: p.onGround },
             caps: latest && latest.caps, flags: latest && latest.flags.map(f => f.state), players: latest ? latest.players.size : 0,
             roster: [...roster.values()].map(r => r.name + ':' + r.team), corrections, pending: pending.length, rtt: net ? net.rtt : 0, fps, feed: feed.length };
  },
  look(yaw, pitch) { ctl.setLook(yaw, pitch); },   // test hook: steer the view without pointer lock
};
