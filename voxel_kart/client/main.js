/**
 * Voxel Kart Racing - client entry point.
 *   - WebSocket connection to the shared Node game server (/game/kart-ws), race list / create / join
 *   - 60 Hz input loop: sample keys, predict the local kart with the shared physics, send with
 *     sequence numbers; on each snapshot take the server's state and replay unacknowledged inputs
 *   - other karts are interpolated ~67 ms in the past
 *   - events -> particles, sounds, banners; HUD (position, lap, item roulette, speedometer,
 *     drift meter, standings, minimap, results); chase camera that tilts in turns and pulls back on boosts
 */
import { Renderer } from './Renderer.js?v=1';
import { KartController } from './KartController.js?v=1';
import { AudioSystem } from './AudioSystem.js?v=1';

const K = window.VKConst, TR = window.VKTracks, P = window.VKPhys;
const { C, KEY, ITEM, ITEM_NAMES, KF, EV, COLORS } = K;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STEP = 1000 / 60;
const hexCss = h => '#' + h.toString(16).padStart(6, '0');
const ordinal = n => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');
const fmtTime = t => { const s = t / 60; return `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`; };

let renderer = null;
try { renderer = new Renderer($('view')); } catch (e) { console.error(e); $('webglError').style.display = 'flex'; }
const ctl = new KartController();
ctl.bindTouch($('touch'));
if (matchMedia('(pointer: coarse)').matches) $('touch').classList.add('show');
const audio = new AudioSystem();

// ---------- state
let net = null, inRoom = false, roomCode = '', myId = 0, T = TR.get('circuit');
const roster = new Map();
let snaps = [], latest = null, clock = null;
let me = null, pending = [], seq = 0, offset = [0, 0, 0], resetPending = true;
let myItem = 0, myItemIn = 0, myTriple = 0, myPlace = 0, myProg = 0, myBest = 0, myLapT = 0;
let feed = [], center = null, flash = 0, hurt = 0, shake = 0, corrections = 0, fps = 60, frames = 0, fpsT = 0;
let standingsHeld = false, lastRoulette = 0, lastItemShown = -1, lastCount = -1;
let camPos = null, camYaw = 0, camRoll = 0, camFov = 72, menuT = 0, wasReady = false;
let myColor = 0, previewTrack = 'circuit';

// ---------- networking
function wsUrl() {
  const q = new URLSearchParams(location.search).get('ws');
  return q || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/game/kart-ws`;
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
  ctl.enabled = false;
}
function hideOverlay() { $('overlay').classList.add('hidden'); ctl.enabled = inRoom; }
function current() { return $('overlay').classList.contains('hidden') ? null : PANELS.find(x => $(x).classList.contains('show')); }
let msgNext = 'pMain';
function message(title, text, next = 'pMain') { $('msgTitle').textContent = title; $('msgText').textContent = text; msgNext = next; show('pMsg'); }
function myName() { const v = $('nameInput').value.replace(/[\x00-\x1F<>]/g, '').trim().slice(0, 16); return v.length >= 2 ? v : ''; }

async function connect() {
  audio.unlock();
  // one name for every game: the portal identity (identity.js); the token proves it to the server
  const id = await OIID.require();
  if (!id) return false;
  const fresh = await OIID.fresh();
  const name = id.name, token = fresh ? fresh.token : '';
  $('nameInput').value = name;
  try { localStorage.setItem('vkColor', myColor); } catch (e) {}
  if (net && net.open) { net.send({ t: 'hello', name, token, skin: myColor }); return true; }
  show('pConn');
  net = new Net();
  net.on('welcome', m => { $('lobbyName').textContent = m.name; if (deepJoin) { net.send({ t: 'join', code: deepJoin }); deepJoin = null; } })
    .on('rooms', renderRooms)
    .on('error', m => { if (inRoom) return; show('pLobby'); $('lobbyStatus').textContent = m.msg; })
    .on('joined', onJoined)
    .on('roster', m => {
      const ids = new Set(m.players.map(x => x.id));
      for (const id of [...roster.keys()]) if (!ids.has(id)) roster.delete(id);
      for (const x of m.players) roster.set(x.id, x);
      if (renderer) renderer.dropKartsExcept(ids);
      if (inRoom && roster.size !== lastRosterN) { lastRosterN = roster.size; playing(); }
      $('pauseInfo').textContent = `Race ${roomCode} · ${T.name} · ${[...roster.values()].filter(x => x.bot).length} bots · ${roster.size}/${C.MAX_RACERS} karts`;
    })
    .on('s', onSnapshot)
    .on('close', () => { net = null; leaveRoomLocal(); message('Disconnected', 'Lost the connection to the game server.', 'pMain'); });
  try { await net.connect(); net.send({ t: 'hello', name, token, skin: myColor }); return true; }
  catch (e) { net = null; message('Server unavailable', e.message, 'pMain'); return false; }
}

function renderRooms(m) {
  const list = $('roomList');
  list.innerHTML = m.rooms.length ? m.rooms.map(r =>
    `<div class="item"><span><b>${esc(r.map)}</b><br><span class="muted">${r.players}/${r.max} karts · ${r.humans} player${r.humans === 1 ? '' : 's'} · ${esc(r.leader || '')}</span></span>
     <button class="mc small" data-code="${esc(r.code)}" ${r.humans >= r.max ? 'disabled' : ''}>JOIN</button></div>`).join('')
    : '<div class="empty">No races yet. Create one - bots will race you until friends join.</div>';
  list.querySelectorAll('button[data-code]').forEach(b => { b.onclick = () => net.send({ t: 'join', code: b.dataset.code }); });
}

function onJoined(m) {
  inRoom = true; roomCode = m.code; myId = m.you;
  T = TR.get(m.track);
  if (renderer) renderer.setTrack(T);
  snaps = []; latest = null; clock = null; me = null; pending = []; resetPending = true; camPos = null;
  feed = []; center = null; myItem = 0; myPlace = 0; lastItemShown = -1;
  $('hud').classList.add('show');
  $('lobbyStatus').textContent = '';
  hideOverlay();
  pushFeed(`Joined <b>${esc(T.name)}</b>`);
  drawMinimapBase();
  playing();
}

/** What the portal's "Playing now" list shows (and the link friends click to join this race). */
function playing() {
  if (inRoom) OIID.activity({ status: `racing on ${T.name} · ${Math.max(1, roster.size)}/${C.MAX_RACERS} karts`, join: `voxel_kart.html?join=${roomCode}` });
  else OIID.activity({ status: 'in the lobby', join: 'voxel_kart.html' });
}

function leaveRoomLocal() {
  const was = inRoom;
  inRoom = false; myId = 0; latest = null; me = null; snaps = [];
  if (was) playing();
  roster.clear();
  if (renderer) renderer.dropKartsExcept(new Set());
  $('hud').classList.remove('show');
  ctl.enabled = false;
  if (renderer) renderer.setTrack(TR.get(previewTrack));
}

// ---------- snapshots
const PSTRIDE = 12;
function decode(m) {
  const karts = new Map();
  for (let i = 0; i < m.p.length; i += PSTRIDE) {
    const a = m.p;
    karts.set(a[i], { id: a[i], x: a[i + 1], y: a[i + 2], z: a[i + 3], yaw: a[i + 4], speed: a[i + 5], bits: a[i + 6], tier: a[i + 7], steer: a[i + 8],
                      lap: a[i + 9], rank: a[i + 10], item: a[i + 11] });
  }
  const shots = [];
  for (let i = 0; i < m.o.length; i += 5) shots.push({ id: m.o[i], type: m.o[i + 1], x: m.o[i + 2], y: m.o[i + 3], z: m.o[i + 4] });
  return { k: m.k, ph: m.ph, go: m.go, rs: m.rs, karts, shots, boxesOff: new Set(m.bx), me: m.me, ack: m.a, res: m.res, tl: m.tl, ff: m.ff };
}

function onSnapshot(m) {
  if (!inRoom) return;
  const s = decode(m);
  if (latest && s.k <= latest.k) return;
  snaps.push(s); if (snaps.length > 40) snaps.shift();
  clock = clock === null || Math.abs(s.k - clock) > 30 ? s.k : clock + (s.k - clock) * 0.06;
  const NS = P.NSTATE, x = s.me.slice(NS);
  myItem = x[0]; myItemIn = x[1]; myTriple = x[2]; myPlace = x[3]; myProg = x[4]; myBest = x[5]; myLapT = x[6];

  // reconcile the local kart: take the server's state, replay what it has not seen yet
  const srv = P.unpackState(s.me.slice(0, NS), {});
  srv.cap = 1;
  if (!me || resetPending || myPlace || s.ph !== 1 || Math.hypot(srv.x - me.x, srv.y - me.y, srv.z - me.z) > 6) {
    me = srv; pending = pending.filter(i => i.s > s.ack); offset = [0, 0, 0]; resetPending = false;
  } else {
    const before = [me.x + offset[0], me.y + offset[1], me.z + offset[2]], px = me.x, pz = me.z;
    me = srv;
    pending = pending.filter(i => i.s > s.ack);
    for (const inp of pending) P.step(me, inp.k, T);
    if (Math.abs(px - me.x) + Math.abs(pz - me.z) > 0.02) corrections++;
    offset = [before[0] - me.x, before[1] - me.y, before[2] - me.z];
    if (Math.hypot(...offset) > 3) offset = [0, 0, 0];
  }
  for (const e of m.ev) { try { onEvent(e, s); } catch (err) { console.error('event', e, err); } }
  latest = s;
}

// ---------- interpolation of the other karts
function interpAt(t) {
  if (!snaps.length) return [];
  let a = snaps[0], b = snaps[snaps.length - 1];
  if (t <= a.k) b = a;
  else if (t >= b.k) a = b;
  else for (let i = 0; i < snaps.length - 1; i++) if (snaps[i].k <= t && snaps[i + 1].k > t) { a = snaps[i]; b = snaps[i + 1]; break; }
  const f = b.k === a.k ? 0 : (t - a.k) / (b.k - a.k);
  const out = [];
  for (const [id, nb] of b.karts) {
    const na = a.karts.get(id) || nb;
    const g = Math.hypot(nb.x - na.x, nb.z - na.z) > 8 ? 1 : f;
    const dyaw = Math.atan2(Math.sin(nb.yaw - na.yaw), Math.cos(nb.yaw - na.yaw));
    out.push({ ...nb, x: na.x + (nb.x - na.x) * g, y: na.y + (nb.y - na.y) * g, z: na.z + (nb.z - na.z) * g, yaw: na.yaw + dyaw * g });
  }
  return out;
}
function interpShots(t) {
  if (!snaps.length) return [];
  let a = snaps[0], b = snaps[snaps.length - 1];
  for (let i = 0; i < snaps.length - 1; i++) if (snaps[i].k <= t && snaps[i + 1].k > t) { a = snaps[i]; b = snaps[i + 1]; break; }
  const f = b.k === a.k ? 0 : Math.max(0, Math.min(1, (t - a.k) / (b.k - a.k)));
  const prev = new Map(a.shots.map(s => [s.id, s]));
  return b.shots.map(s => { const p = prev.get(s.id) || s; return { ...s, x: p.x + (s.x - p.x) * f, y: p.y + (s.y - p.y) * f, z: p.z + (s.z - p.z) * f }; });
}
const renderTick = () => (clock === null ? 0 : clock - C.INTERP);

// ---------- feed, banners
const nameOf = id => (roster.get(id) || {}).name || '?';
const colorOf = id => (roster.get(id) || {}).color | 0;
const nameHtml = id => `<span style="color:${hexCss(COLORS[colorOf(id)])}">${esc(nameOf(id))}</span>`;
function pushFeed(html) { feed.push({ html, t: performance.now() }); if (feed.length > 6) feed.shift(); }
function showCenter(html, secs, cls = '') { center = { html, until: performance.now() + secs * 1000 }; }
function kartPos(id) {
  if (id === myId && me) return [me.x, me.y, me.z];
  const q = latest && latest.karts.get(id);
  return q ? [q.x, q.y, q.z] : null;
}

function onEvent(e) {
  const [code] = e;
  switch (code) {
    case EV.BOX: {
      const b = T.boxes[e[2]];
      if (renderer && b) renderer.boxBurst(b.x, b.y, b.z);
      if (e[1] === myId) { audio.box(); lastRoulette = performance.now(); }
      break;
    }
    case EV.USE: {
      const it = e[2];
      if (it === ITEM.SHROOM || it === ITEM.TRIPLE) { if (e[1] === myId) { audio.boost(); camKick = 1; } }
      else if (it === ITEM.BANANA) { if (e[1] === myId) audio.banana(); }
      else if (it === ITEM.GREEN || it === ITEM.RED) audio.shell();
      if (it === ITEM.RED || it === ITEM.GREEN) pushFeed(`${nameHtml(e[1])} threw a ${it === ITEM.RED ? '<span style="color:#ff6a6a">red shell</span>' : '<span style="color:#6aff6a">green shell</span>'}`);
      break;
    }
    case EV.HIT: {
      const [, victim, by, cause] = e;
      const p = kartPos(victim);
      if (p && renderer) renderer.hitFx(...p);
      if (victim === myId) { audio[cause === ITEM.BANANA ? 'slip' : 'hit'](); hurt = 1; shake = 0.6; }
      const what = cause === ITEM.BANANA ? 'slipped on a banana' : cause === 99 ? 'got toasted by a fireball' : cause === 98 ? 'got squashed' :
        cause === ITEM.LIGHTNING ? 'was struck by lightning' : 'got shelled';
      if (cause !== ITEM.LIGHTNING) pushFeed(`${nameHtml(victim)} ${what}${by && by !== victim && cause !== 98 ? ' by ' + nameHtml(by) : ''}`);
      break;
    }
    case EV.LIGHTNING:
      flash = 1; audio.lightning();
      pushFeed(`⚡ ${nameHtml(e[1])} called down lightning!`);
      if (e[1] !== myId && myPlace === 0 && latest && (latest.karts.get(myId) || {}).rank < (latest.karts.get(e[1]) || {}).rank) audio.shrink();
      break;
    case EV.LAP:
      if (e[1] === myId) {
        const fin = e[2] === C.LAPS;
        audio.lap(fin);
        showCenter(fin ? '<span style="color:#ffd23a">FINAL LAP</span>' : `LAP ${e[2]}/${C.LAPS}`, 2);
      }
      break;
    case EV.FINISH:
      if (e[1] === myId) {
        audio.finish(e[2]);
        showCenter(`<span style="color:${e[2] <= 3 ? '#ffd23a' : '#fff'}">${ordinal(e[2]).toUpperCase()}!</span><small>${fmtTime(e[3])}</small>`, 5);
      }
      pushFeed(`🏁 ${nameHtml(e[1])} finished ${ordinal(e[2])} · ${fmtTime(e[3])}`);
      break;
    case EV.RESCUE: if (e[1] === myId) audio.rescue(); break;
    case EV.TURBO: break;
    case EV.BUMP: if (e[1] === myId || e[2] === myId) { audio.bump(); shake = Math.max(shake, 0.25); } break;
    case EV.GO: break;
  }
}

// ---------- HUD
const ICONS = {};
function icon(rows, pal) {
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const g = c.getContext('2d');
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (pal[ch]) { g.fillStyle = pal[ch]; g.fillRect(x, y, 1, 1); } }));
  return c.toDataURL();
}
function makeIcons() {
  const shell = ['................', '......kkkk......', '....kkggggkk....', '...kgglggglgk...', '..kggggllggggk..', '..kglggggggglk..', '.kggggllgggggggk',
    '.kgggggggllgggk.', '.kwwwwwwwwwwwwk.', '.kwkwkwkwkwkwwk.', '..kwwwwwwwwwwk..', '...kkkkkkkkkk...', '................', '................', '................', '................'];
  ICONS[ITEM.GREEN] = icon(shell, { k: '#111', g: '#2fb02f', l: '#7ae07a', w: '#f4f0e0' });
  ICONS[ITEM.RED] = icon(shell, { k: '#111', g: '#d82a2a', l: '#ff8a8a', w: '#f4f0e0' });
  ICONS[ITEM.BANANA] = icon(['...........kk...', '...........kb...', '..........kyk...', '.........kyyk...', '........kyyyk...', '.......kyyyk....', '......kyyyyk....',
    '....kkyyyyk.....', '..kkyyyyyk......', '.kyyyyyykk......', '.kyyyykk........', '..kkkk..........', '................', '................', '................', '................'],
    { k: '#111', y: '#ffd83a', b: '#6a4a1a' });
  const shroom = ['................', '.....kkkkkk.....', '...kkrrwwrrkk...', '..krrrwwwwrrrk..', '.krwwrrwwrrwwrk.', '.krwwrrrrrrwwrk.', 'krrrrrrrrrrrrrrk',
    'krrwwrrrrrrwwrrk', '.kkkkkkkkkkkkkk.', '...kssskksssk...', '...kssekkessk...', '...ksssssssssk..', '...kssssssssk...', '....kkkkkkkk....', '................', '................'];
  ICONS[ITEM.SHROOM] = icon(shroom, { k: '#111', r: '#e83a3a', w: '#fff', s: '#f4e0c0', e: '#111' });
  ICONS[ITEM.TRIPLE] = ICONS[ITEM.SHROOM];
  ICONS[ITEM.LIGHTNING] = icon(['................', '.........kkkk...', '........kyyyk...', '.......kyyyk....', '......kyyyk.....', '.....kyyyykkkk..', '....kyyyyyyyyk..',
    '...kkkkyyyyyk...', '......kyyyyk....', '.....kyyyyk.....', '....kyyyk.......', '....kyyk........', '...kyk..........', '...kk...........', '................', '................'],
    { k: '#111', y: '#ffe14a' });
}
makeIcons();

function setHtml(id, html) { const el = $(id); if (el.__h !== html) { el.innerHTML = html; el.__h = html; } }

function updateHud(dt, others) {
  if (!inRoom || !latest) return;
  const now = performance.now();
  const mine = latest.karts.get(myId);
  const rank = mine ? mine.rank : 1, n = latest.karts.size;
  setHtml('pos', `${rank}<small>${ordinal(rank).slice(-2)}</small>${n > 1 ? `<small style="opacity:.6">/${n}</small>` : ''}`);
  $('pos').style.color = rank === 1 ? '#ffd23a' : rank <= 3 ? '#fff' : '#ddd';
  const raceT = latest.ph === 1 && !myPlace ? Math.max(0, renderTick() - latest.rs) : 0;
  const lapN = mine ? mine.lap : 1;
  setHtml('lap', `LAP <b>${Math.min(C.LAPS, lapN)}</b>/${C.LAPS}<br><span class="t">${latest.ph === 1 && !myPlace ? fmtTime(raceT) : myPlace ? 'FINISHED' : ''}${myBest ? '<br>best ' + fmtTime(myBest) : ''}</span>`);

  // item slot: the roulette spins until the item is ready
  const spinning = myItem && myItemIn > 0 && latest.ph === 1;
  let shown = myItem;
  if (spinning) {
    const k = Math.floor(now / 70) % 5 + 1;
    shown = k;
    if (now - lastRoulette > 70) { lastRoulette = now; audio.roulette(); }
    wasReady = false;
  } else if (myItem && !wasReady) { wasReady = true; audio.itemReady(); }
  if (!myItem) wasReady = false;
  if (shown !== lastItemShown) { $('itemImg').src = shown ? ICONS[shown] : ''; $('itemImg').style.visibility = shown ? 'visible' : 'hidden'; lastItemShown = shown; }
  const cnt = myItem === ITEM.TRIPLE && !spinning ? myTriple : 0;
  if (cnt !== lastCount) { $('itemCount').textContent = cnt > 1 ? '×' + cnt : ''; lastCount = cnt; }
  setHtml('itemName', myItem && !spinning ? ITEM_NAMES[myItem].toUpperCase() : '');

  // speed + drift charge
  const sp = me ? Math.hypot(me.vx, me.vz) : 0;
  setHtml('speed', String(Math.round(sp * 5)));
  $('speedFill').style.width = Math.min(100, sp / (C.MAX_SPEED * C.BOOST_SPEED) * 100) + '%';
  $('speedFill').style.background = me && me.boost > 0 ? '#ff7a1a' : '#ffd23a';
  if (me && me.drift) {
    $('driftMeter').style.visibility = 'visible';
    const tier = P.driftTier(me.charge), next = C.DRIFT_TIERS[Math.min(2, tier)];
    $('driftFill').style.width = (tier >= 3 ? 100 : Math.min(100, me.charge / next * 100)) + '%';
    $('driftFill').style.background = ['#ffffff', '#3aa0ff', '#ff9a1a', '#d040ff'][tier];
  } else $('driftMeter').style.visibility = 'hidden';

  // standings
  const order = [...latest.karts.values()].sort((a, b) => a.rank - b.rank);
  setHtml('standings', order.map(q => `<div class="${q.id === myId ? 'me' : ''}">${q.rank}. <i style="background:${hexCss(COLORS[colorOf(q.id)])}"></i>${esc(nameOf(q.id).slice(0, 10))}${q.bits & KF.FINISHED ? ' 🏁' : ''}</div>`).join(''));

  // countdown / banners
  let c = '';
  if (latest.ph === 0) {
    const left = (latest.go - (clock || 0)) / 60;
    const n3 = Math.ceil(left);
    if (left > 3) c = `<span style="font-size:.4em">${esc(T.name.toUpperCase())}</span><small>get ready</small>`;
    else c = `<span style="color:${['#5fff5f', '#ffd23a', '#ff9a1a', '#ff4a4a'][Math.max(0, Math.min(3, n3))]}">${Math.max(1, n3)}</span>`;
    if (n3 !== lastBeep && n3 <= 3 && n3 >= 1) { lastBeep = n3; audio.beep(false); }
  } else if (latest.ph === 1 && (clock || 0) - latest.go < 60) {
    c = '<span style="color:#5fff5f">GO!</span>';
    if (lastBeep !== 0) { lastBeep = 0; audio.beep(true); }
  } else if (latest.ph === 2) c = '';                        // the results table has the floor
  else if (center && now < center.until) c = center.html;
  else if (latest.ph === 1 && latest.ff >= 0 && !myPlace && latest.ff <= 15) c = `<span style="font-size:.3em;color:#ff9a9a">${latest.ff}s left</span>`;
  setHtml('center', c);

  setHtml('feed', feed.filter(f => now - f.t < 7000).map(f => `<div>${f.html}</div>`).join(''));

  // results
  const showRes = latest.ph === 2 && latest.res || standingsHeld;
  $('results').classList.toggle('show', !!showRes);
  if (showRes) {
    const rows = latest.ph === 2 && latest.res
      ? latest.res.map(([id, place, t, best]) => ({ id, place, t, best }))
      : order.map(q => ({ id: q.id, place: q.rank, t: -2, best: 0 }));
    const title = latest.ph === 2 ? 'RACE RESULTS' : 'STANDINGS';
    setHtml('results', `<h3>${title}</h3><table>${rows.map(r => `<tr class="${r.id === myId ? 'me' : ''}"><td>${ordinal(r.place)}</td>
      <td><span style="color:${hexCss(COLORS[colorOf(r.id)])}">■</span> ${esc(nameOf(r.id))}${(roster.get(r.id) || {}).bot ? ' <span class="muted">BOT</span>' : ''}</td>
      <td style="text-align:right">${r.t >= 0 ? fmtTime(r.t) : r.t === -1 ? 'DNF' : ''}</td><td class="muted" style="text-align:right">${r.best ? 'best ' + fmtTime(r.best) : ''}</td></tr>`).join('')}</table>
      ${latest.ph === 2 ? `<div class="sub">Next race in ${latest.tl}s · Esc for the menu</div>` : ''}`);
  }

  flash = Math.max(0, flash - dt * 2.5); $('flash').style.opacity = flash * 0.85;
  hurt = Math.max(0, hurt - dt * 1.5); $('hurt').style.opacity = hurt;
  setHtml('netInfo', `${Math.round(net ? net.rtt : 0)} ms · ${fps} fps · ${corrections} corr`);
  drawMinimap(others);
}
let lastBeep = -1, camKick = 0;

// ---------- minimap
let mmBase = null, mmT = null;
function mmXform() {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const s of T.S) { x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); z0 = Math.min(z0, s.z); z1 = Math.max(z1, s.z); }
  const W = 200, pad = 14, sc = Math.min((W - pad * 2) / (x1 - x0), (W - pad * 2) / (z1 - z0));
  const ox = (W - (x1 - x0) * sc) / 2, oz = (W - (z1 - z0) * sc) / 2;
  return { X: x => ox + (x - x0) * sc, Z: z => oz + (z - z0) * sc, sc };
}
function drawMinimapBase() {
  const c = document.createElement('canvas'); c.width = c.height = 200;
  const g = c.getContext('2d'), M = mmXform();
  g.lineCap = g.lineJoin = 'round';
  const strokePath = (from, to, width, color) => {
    g.strokeStyle = color; g.lineWidth = width; g.beginPath();
    let pen = false;
    for (let i = from; i < to; i++) {
      const s = T.S[i];
      if (s.flags & TR.F.GAP) { pen = false; continue; }
      if (!pen) { g.moveTo(M.X(s.x), M.Z(s.z)); pen = true; } else g.lineTo(M.X(s.x), M.Z(s.z));
    }
    g.stroke();
  };
  for (const [w, col] of [[7, '#222'], [4, '#ddd']]) {
    strokePath(0, T.nMain, w, col);
    g.beginPath(); const a = T.S[T.nMain - 1], b = T.S[0]; g.moveTo(M.X(a.x), M.Z(a.z)); g.lineTo(M.X(b.x), M.Z(b.z)); g.stroke();
    for (const br of T.branches) strokePath(br.first, br.first + br.count, w - 1, col);
  }
  const s0 = T.S[0];
  g.fillStyle = '#fff'; g.fillRect(M.X(s0.x) - 3, M.Z(s0.z) - 3, 6, 6);
  mmBase = c; mmT = M;
}
function drawMinimap(others) {
  const mm = $('minimap'), g = mm.getContext('2d');
  g.clearRect(0, 0, 200, 200);
  if (!mmBase) return;
  g.drawImage(mmBase, 0, 0);
  const M = mmT;
  for (const q of others) {
    if (q.id === myId) continue;
    g.fillStyle = hexCss(COLORS[colorOf(q.id)]); g.strokeStyle = '#000'; g.lineWidth = 1;
    g.fillRect(M.X(q.x) - 3, M.Z(q.z) - 3, 6, 6); g.strokeRect(M.X(q.x) - 3, M.Z(q.z) - 3, 6, 6);
  }
  if (me) {
    g.save(); g.translate(M.X(me.x), M.Z(me.z)); g.rotate(-me.yaw + Math.PI);
    g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 5); g.lineTo(-5, 5); g.closePath(); g.fill(); g.stroke(); g.restore();
  }
}

// ---------- main loop
let acc = 0, last = performance.now();
function tick() {
  if (!inRoom || !latest || !me || !net) return;
  const racing = latest.ph === 1 || (latest.ph === 0 && (clock || 0) >= latest.go);
  if (!racing || myPlace) return;
  const k = ctl.sample();
  const inp = { s: ++seq, k };
  net.send({ t: 'i', s: inp.s, k });
  pending.push(inp);
  if (pending.length > 120) pending.shift();
  const out = P.step(me, k, T);
  if (out.turbo) { audio.turbo(out.turbo); camKick = 0.6 + out.turbo * 0.2; if (renderer) renderer.burst(me.x, me.y + 0.5, me.z, 10 + out.turbo * 6, 4, [[0x3aa0ff, 0xff9a1a, 0xd040ff][out.turbo - 1]], 0.5, 6); }
  if (out.hop) audio.hop();
  if (out.bonk > 6) { audio.bonk(); shake = Math.max(shake, 0.3); }
  if (out.pad) { audio.boost(); camKick = 0.8; }
  if (out.land > 9) shake = Math.max(shake, 0.15);
}

function loop(now) {
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
  last = now;
  frames++; fpsT += dt; if (fpsT > 0.5) { fps = Math.round(frames / fpsT); frames = 0; fpsT = 0; }
  acc += dt * 1000;
  let n = 0;
  while (acc >= STEP && n < 10) { tick(); acc -= STEP; n++; }
  if (n === 10) acc = 0;
  if (clock !== null) clock += dt * 60;
  const kk = Math.pow(0.002, dt);
  offset = offset.map(v => v * kk);

  const others = inRoom && latest ? interpAt(renderTick()) : [];
  if (renderer) {
    let cam;
    const karts = [];
    if (inRoom && latest) {
      // my kart: predicted (or the server's if finished / not racing)
      const mineSnap = others.find(q => q.id === myId);
      let mk = null;
      if (me && !myPlace) {
        const steer = ((me.keys & KEY.RIGHT) ? 1 : 0) - ((me.keys & KEY.LEFT) ? 1 : 0);
        const bits = (me.drift ? KF.DRIFT : 0) | (me.boost > 0 ? KF.BOOST : 0) | (me.spin > 0 ? KF.SPIN : 0) | (me.shrink > 0 ? KF.SHRINK : 0)
                   | (!me.ground ? KF.AIR : 0) | (me.rescue > 0 ? KF.RESCUE : 0);
        mk = { id: myId, x: me.x + offset[0], y: me.y + offset[1], z: me.z + offset[2], yaw: me.yaw, speed: Math.hypot(me.vx, me.vz), bits,
               tier: me.drift ? me.drift * P.driftTier(me.charge) : 0, steer, color: colorOf(myId), name: nameOf(myId), me: true };
      } else if (mineSnap) mk = { ...mineSnap, color: colorOf(myId), name: nameOf(myId), me: true };
      for (const q of others) if (q.id !== myId) karts.push({ ...q, color: colorOf(q.id), name: nameOf(q.id) });
      if (mk) karts.push(mk);
      if (mk) {
        // chase camera: trails the kart's heading, tilts into turns, pulls back and widens on boosts
        const boost = (mk.bits & KF.BOOST) ? 1 : 0;
        camKick = Math.max(0, camKick - dt * 1.2);
        const dyaw = Math.atan2(Math.sin(mk.yaw - camYaw), Math.cos(mk.yaw - camYaw));
        camYaw += dyaw * Math.min(1, dt * ((mk.bits & KF.SPIN) ? 1.5 : 6));
        const back = ctl.down.has('KeyB') ? -1 : 1;
        const dist = (6.4 + boost * 1.4 + camKick * 1.2) * ((mk.bits & KF.SHRINK) ? 0.75 : 1);
        const fx = Math.sin(camYaw) * back, fz = Math.cos(camYaw) * back;
        const want = [mk.x - fx * dist, mk.y + 2.6, mk.z - fz * dist];
        // stay above the ground behind the kart
        const g = TR.groundAt(T, want[0], want[2]);
        if (g.h > -1e8) want[1] = Math.max(want[1], g.h + 1.2);
        if (!camPos || Math.hypot(want[0] - camPos[0], want[2] - camPos[2]) > 30) camPos = want.slice();
        const kp = Math.min(1, dt * 10);
        camPos = camPos.map((v, i) => v + (want[i] - v) * (i === 1 ? kp * 0.6 : kp));
        const rollWant = -(mk.steer || 0) * 0.035 - Math.sign(mk.tier || 0) * 0.05 - ((mk.bits & KF.DRIFT) && !mk.tier ? (mk.steer || 0) * 0.03 : 0);
        camRoll += (rollWant - camRoll) * Math.min(1, dt * 5);
        camFov += (72 + boost * 12 + camKick * 6 + Math.min(6, mk.speed * 0.15) - camFov) * Math.min(1, dt * 4);
        shake = Math.max(0, shake - dt * 1.6);
        const sx = (Math.random() - 0.5) * shake * 0.5, sy = (Math.random() - 0.5) * shake * 0.5;
        cam = { pos: [camPos[0] + sx, camPos[1] + sy, camPos[2]], look: [mk.x + fx * 3, mk.y + 1.2, mk.z + fz * 3], roll: camRoll * back, fov: camFov };
        audio.motion(mk.speed, (mk.bits & KF.DRIFT) && !(mk.bits & KF.AIR) ? Math.abs(mk.tier || 0) : -1, !!boost, true);
      }
    }
    if (!cam) {
      // menu: a slow flight around the selected track
      menuT += dt * 0.04;
      const S = T.S, i = ((Math.floor(menuT * 60) % T.nMain) + T.nMain) % T.nMain, s = S[i], j = S[(i + 25) % T.nMain];
      cam = { pos: [s.x - s.tx * 10 + s.tz * 8, s.y + 9, s.z - s.tz * 10 - s.tx * 8], look: [j.x, j.y + 1, j.z], roll: 0, fov: 70 };
      audio.motion(0, -1, false, false);
    }
    renderer.render({ dt, cam, karts, shots: inRoom && latest ? interpShots(renderTick()) : [], boxesOff: latest ? latest.boxesOff : null,
                      hazardTick: inRoom && clock !== null ? renderTick() : performance.now() / STEP });
  }
  updateHud(dt, others);
  requestAnimationFrame(loop);
}

// ---------- lobby widgets
function buildColorPicker() {
  $('colors').innerHTML = COLORS.map((c, i) => `<button data-c="${i}" style="background:${hexCss(c)}" class="${i === myColor ? 'on' : ''}" title="Kart colour"></button>`).join('');
  $('colors').querySelectorAll('button').forEach(b => { b.onclick = () => { myColor = +b.dataset.c; buildColorPicker(); }; });
}
function buildTrackCards() {
  $('trackCards').innerHTML = TR.IDS.map(id => {
    const d = TR.DEFS[id];
    return `<div class="track ${id === previewTrack ? 'on' : ''}" data-id="${id}"><canvas width="160" height="100"></canvas><b>${esc(d.name)}</b>${esc(d.sub)}<br>
      <span class="stars">${'★'.repeat(d.difficulty)}${'☆'.repeat(3 - d.difficulty)}</span></div>`;
  }).join('');
  $('trackCards').querySelectorAll('.track').forEach(el => {
    drawTrackThumb(el.querySelector('canvas'), TR.get(el.dataset.id));
    el.onclick = () => { previewTrack = el.dataset.id; buildTrackCards(); if (!inRoom && renderer) { T = TR.get(previewTrack); renderer.setTrack(T); } };
  });
}
function drawTrackThumb(c, tr) {
  const g = c.getContext('2d');
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const s of tr.S) { x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); z0 = Math.min(z0, s.z); z1 = Math.max(z1, s.z); }
  const sc = Math.min(140 / (x1 - x0), 84 / (z1 - z0)), ox = (160 - (x1 - x0) * sc) / 2, oz = (100 - (z1 - z0) * sc) / 2;
  g.lineWidth = 4; g.lineJoin = g.lineCap = 'round';
  g.strokeStyle = tr.def.theme.lava ? '#ff8a3a' : tr.def.theme.islands ? '#bfe6ff' : '#fff';
  g.beginPath();
  tr.S.forEach((s, i) => { if (s.branch >= 0) return; const X = ox + (s.x - x0) * sc, Z = oz + (s.z - z0) * sc; if (i === 0) g.moveTo(X, Z); else g.lineTo(X, Z); });
  g.closePath(); g.stroke();
  g.lineWidth = 2; g.setLineDash([3, 3]);
  for (const br of tr.branches) { g.beginPath(); for (let i = br.first; i < br.first + br.count; i++) { const s = tr.S[i]; const X = ox + (s.x - x0) * sc, Z = oz + (s.z - z0) * sc; if (i === br.first) g.moveTo(X, Z); else g.lineTo(X, Z); } g.stroke(); }
}

// ---------- wiring
try { myColor = Math.max(0, Math.min(7, +localStorage.getItem('vkColor') || 0)); } catch (e) {}
// the name box shows the portal identity; clicking it opens the account dialog
let deepJoin = (OIID.param('join') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) || null, lastRosterN = 0;
$('nameInput').readOnly = true;
$('nameInput').title = 'Your name in every game - click to change';
$('nameInput').placeholder = 'Pick a name';
$('nameInput').onclick = () => OIID.open();
OIID.me().then(id => { if (id) $('nameInput').value = id.name; });
OIID.onChange(id => { $('nameInput').value = id ? id.name : ''; if (id && net && net.open && !inRoom) net.send({ t: 'hello', name: id.name, token: id.token, skin: myColor }); });
if (deepJoin) $('btnPlay').textContent = '▶ JOIN ' + deepJoin;
buildColorPicker();
buildTrackCards();
$('btnPlay').onclick = async () => { if (await connect()) { $('lobbyStatus').textContent = ''; show('pLobby'); } };
$('btnCreate').onclick = () => net && net.send({ t: 'create', bots: +$('botsSelect').value, level: $('botLevel').value, map: previewTrack });
$('btnLobbyBack').onclick = () => { if (net) { net.close(); net = null; } show('pMain'); };
$('btnConnCancel').onclick = () => { if (net) { net.close(); net = null; } show('pMain'); };
$('btnResume').onclick = () => hideOverlay();
$('btnAddBot').onclick = () => net && net.send({ t: 'addbot' });
$('btnKickBot').onclick = () => net && net.send({ t: 'kickbot' });
$('btnLeave').onclick = () => { if (net) net.send({ t: 'leave' }); leaveRoomLocal(); show('pLobby'); };
$('btnMsgOk').onclick = () => show(msgNext === 'pLobby' && !(net && net.open) ? 'pMain' : msgNext);
$('soundBtn').textContent = audio.on ? '🔊' : '🔇';
$('soundBtn').onclick = () => { audio.unlock(); $('soundBtn').textContent = audio.toggle() ? '🔊' : '🔇'; };
ctl.onEscape = () => { if (!inRoom) return; if (current() === null) show('pPause'); else if (current() === 'pPause') hideOverlay(); };
ctl.onTab = held => { standingsHeld = held && inRoom; };
$('stage').addEventListener('pointerdown', () => audio.unlock());

if (renderer) renderer.setTrack(T);
requestAnimationFrame(loop);
window.VKART = {
  get state() {
    return { inRoom, roomCode, myId, track: T.id, phase: latest && latest.ph, tick: latest && latest.k, clock,
             me: me && { x: me.x, y: me.y, z: me.z, speed: Math.hypot(me.vx, me.vz), drift: me.drift, charge: me.charge, boost: me.boost, ground: me.ground },
             item: myItem, place: myPlace, rank: latest && latest.karts.get(myId) ? latest.karts.get(myId).rank : 0, lap: latest && latest.karts.get(myId) ? latest.karts.get(myId).lap : 0,
             karts: latest ? latest.karts.size : 0, corrections, pending: pending.length, rtt: net ? net.rtt : 0, fps };
  },
  press(code, down) { if (down) ctl.down.add(code); else ctl.down.delete(code); },   // test hooks
  yaw() { return me ? me.yaw : 0; },
};
