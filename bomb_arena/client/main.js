/**
 * Bomb Arena 3D - client entry point.
 *   - WebSocket connection to the shared Node game server (/game/bomb-ws): arena list / create / join,
 *     names from the portal identity (identity.js), "Playing now" presence with ?join=CODE links
 *   - 60 Hz input loop: sample keys, predict the local bomber with the shared grid movement against the
 *     last known grid and bombs, send with sequence numbers; replay unacknowledged inputs on each snapshot
 *   - other bombers are interpolated ~67 ms in the past
 *   - events -> explosions, crate splinters, pickups, knock-outs, sounds, kill feed; HUD and banners
 */
import { Renderer3D } from './Renderer3D.js?v=1';
import { PlayerController } from './PlayerController.js?v=1';
import { AudioSystem } from './AudioSystem.js?v=1';

const K = window.BAConst, AR = window.BAArena;
const { C, KEY, PU, PU_NAMES, EV, COLORS, COLOR_NAMES } = K;
const W = AR.W, H = AR.H;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hexCss = h => '#' + h.toString(16).padStart(6, '0');
const STEP = 1000 / 60;

let renderer = null;
try { renderer = new Renderer3D($('view')); } catch (e) { console.error(e); $('webglError').style.display = 'flex'; }
const ctl = new PlayerController();
ctl.bindTouch($('touch'));
if (matchMedia('(pointer: coarse)').matches) $('touch').classList.add('show');
const audio = new AudioSystem();

// ---------- state
let net = null, inRoom = false, roomCode = '', myId = 0, myColor = 0;
const roster = new Map(), scores = new Map();
let snaps = [], latest = null, clock = null;
let me = null, pending = [], seq = 0, offset = [0, 0], resetPending = true;
let mine = { alive: false, maxBombs: 1, active: 0, fire: 2, kick: 0, inRound: false };
let tiles = AR.generate(7), gridVer = -1, world = { tiles, bombs: new Set() };
let feed = [], banner = null, scoreboardHeld = false, corrections = 0, fps = 60, frames = 0, fpsT = 0, lastBeep = -1, lastRosterN = 0;
let deepJoin = (OIID.param('join') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) || null;

// ---------- networking
function wsUrl() {
  const q = new URLSearchParams(location.search).get('ws');
  return q || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/game/bomb-ws`;
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
function show(id) { $('overlay').classList.remove('hidden'); for (const x of PANELS) $(x).classList.toggle('show', x === id); ctl.enabled = false; }
function hideOverlay() { $('overlay').classList.add('hidden'); ctl.enabled = inRoom; }
function current() { return $('overlay').classList.contains('hidden') ? null : PANELS.find(x => $(x).classList.contains('show')); }
let msgNext = 'pMain';
function message(title, text, next = 'pMain') { $('msgTitle').textContent = title; $('msgText').textContent = text; msgNext = next; show('pMsg'); }

async function connect() {
  audio.unlock();
  // one name for every game: the portal identity (identity.js); the token proves it to the server
  const id = await OIID.require();
  if (!id) return false;
  const fresh = await OIID.fresh();
  const name = id.name, token = fresh ? fresh.token : '';
  $('nameInput').value = name;
  try { localStorage.setItem('baColor', myColor); } catch (e) {}
  if (net && net.open) { net.send({ t: 'hello', name, token, skin: myColor }); return true; }
  show('pConn');
  net = new Net();
  net.on('welcome', m => { $('lobbyName').textContent = m.name; if (deepJoin) { net.send({ t: 'join', code: deepJoin }); deepJoin = null; } })
    .on('rooms', renderRooms)
    .on('error', m => { if (inRoom) return; show('pLobby'); $('lobbyStatus').textContent = m.msg; })
    .on('joined', onJoined)
    .on('roster', m => {
      const ids = new Set(m.players.map(x => x.id));
      for (const id2 of [...roster.keys()]) if (!ids.has(id2)) roster.delete(id2);
      for (const x of m.players) roster.set(x.id, x);
      if (renderer) renderer.dropPlayersExcept(ids);
      if (inRoom && roster.size !== lastRosterN) { lastRosterN = roster.size; playing(); }
      $('pauseInfo').textContent = `Arena ${roomCode} · ${[...roster.values()].filter(x => x.bot).length} bots · ${roster.size}/${C.MAX_PLAYERS} bombers`;
    })
    .on('s', onSnapshot)
    .on('close', () => { net = null; leaveRoomLocal(); message('Disconnected', 'Lost the connection to the game server.', 'pMain'); });
  try { await net.connect(); net.send({ t: 'hello', name, token, skin: myColor }); return true; }
  catch (e) { net = null; message('Server unavailable', e.message, 'pMain'); return false; }
}

function renderRooms(m) {
  const list = $('roomList');
  list.innerHTML = m.rooms.length ? m.rooms.map(r =>
    `<div class="item"><span><b>Arena ${esc(r.code)}</b><br><span class="muted">${r.players}/${r.max} bombers · ${r.humans} player${r.humans === 1 ? '' : 's'} · ${esc(r.leader || '')}</span></span>
     <button class="btn small" data-code="${esc(r.code)}" ${r.humans >= r.max ? 'disabled' : ''}>JOIN</button></div>`).join('')
    : '<div class="empty">No arenas yet. Create one - bots will fight you until friends join.</div>';
  list.querySelectorAll('button[data-code]').forEach(b => { b.onclick = () => net.send({ t: 'join', code: b.dataset.code }); });
}

function onJoined(m) {
  inRoom = true; roomCode = m.code; myId = m.you;
  snaps = []; latest = null; clock = null; me = null; pending = []; resetPending = true; feed = []; banner = null; gridVer = -1;
  $('hud').classList.add('show');
  $('lobbyStatus').textContent = '';
  hideOverlay();
  pushFeed(`Joined arena <b>${esc(m.code)}</b>`);
  playing();
}

/** What the portal's "Playing now" list shows (and the link friends click to join this arena). */
function playing() {
  if (inRoom) OIID.activity({ status: `bombing in arena ${roomCode} · ${Math.max(1, roster.size)}/${C.MAX_PLAYERS}`, join: `bomb_arena.html?join=${roomCode}` });
  else OIID.activity({ status: 'in the lobby', join: 'bomb_arena.html' });
}

function leaveRoomLocal() {
  const was = inRoom;
  inRoom = false; myId = 0; latest = null; me = null; snaps = [];
  roster.clear(); scores.clear();
  if (renderer) renderer.dropPlayersExcept(new Set());
  $('hud').classList.remove('show');
  ctl.enabled = false;
  if (was) playing();
}

// ---------- snapshots
const PSTRIDE = 8;
function decode(m) {
  const players = new Map();
  for (let i = 0; i < m.p.length; i += PSTRIDE) {
    const a = m.p;
    players.set(a[i], { id: a[i], x: a[i + 1], z: a[i + 2], face: a[i + 3], alive: !!a[i + 4], moving: !!a[i + 5], speed: a[i + 6], kick: !!a[i + 7] });
  }
  const bombs = [];
  for (let i = 0; i < m.b.length; i += 6) bombs.push({ id: m.b[i], x: m.b[i + 1], z: m.b[i + 2], fuse: m.b[i + 3], owner: m.b[i + 4], range: m.b[i + 5] });
  const flames = []; for (let i = 0; i < m.f.length; i += 2) flames.push([m.f[i], m.f[i + 1]]);
  const powerups = []; for (let i = 0; i < m.u.length; i += 2) powerups.push([m.u[i], m.u[i + 1]]);
  return { k: m.k, ph: m.ph, rd: m.rd, tl: m.tl, w: m.w, players, bombs, flames, powerups, me: m.me, ack: m.a };
}

function onSnapshot(m) {
  if (!inRoom) return;
  const s = decode(m);
  if (latest && s.k <= latest.k) return;
  if (m.g) {
    tiles = Uint8Array.from(m.g, ch => ch.charCodeAt(0) - 48);
    world.tiles = tiles;
    if (m.gv !== gridVer && renderer) renderer.setGrid(tiles);
    gridVer = m.gv;
  }
  world.bombs = new Set(s.bombs.map(b => Math.floor(b.z) * W + Math.floor(b.x)));
  if (m.sc) for (let i = 0; i < m.sc.length; i += 3) scores.set(m.sc[i], { wins: m.sc[i + 1], kills: m.sc[i + 2] });
  snaps.push(s); if (snaps.length > 40) snaps.shift();
  clock = clock === null || Math.abs(s.k - clock) > 30 ? s.k : clock + (s.k - clock) * 0.06;
  const NS = AR.NSTATE, x = s.me.slice(NS);
  mine = { alive: !!x[0], maxBombs: x[1], active: x[2], fire: x[3], kick: x[4], inRound: !!x[5] };

  // reconcile the local bomber
  const srv = AR.unpackState(s.me.slice(0, NS), {});
  if (!me || resetPending || !mine.alive || s.ph !== 1 || Math.hypot(srv.x - me.x, srv.z - me.z) > 1.5) {
    me = srv; pending = pending.filter(i => i.s > s.ack); offset = [0, 0]; resetPending = false;
  } else {
    const bx = me.x + offset[0], bz = me.z + offset[1], px = me.x, pz = me.z;
    me = srv;
    pending = pending.filter(i => i.s > s.ack);
    for (const inp of pending) AR.step(me, inp.k, world);
    if (Math.abs(px - me.x) + Math.abs(pz - me.z) > 0.02) corrections++;
    offset = [bx - me.x, bz - me.z];
    if (Math.hypot(offset[0], offset[1]) > 1) offset = [0, 0];
  }
  for (const e of m.ev) { try { onEvent(e, s); } catch (err) { console.error('event', e, err); } }
  latest = s;
}

function interpAt(t) {
  if (!snaps.length) return [];
  let a = snaps[0], b = snaps[snaps.length - 1];
  if (t <= a.k) b = a;
  else if (t >= b.k) a = b;
  else for (let i = 0; i < snaps.length - 1; i++) if (snaps[i].k <= t && snaps[i + 1].k > t) { a = snaps[i]; b = snaps[i + 1]; break; }
  const f = b.k === a.k ? 0 : (t - a.k) / (b.k - a.k);
  const out = [];
  for (const [id, nb] of b.players) {
    const na = a.players.get(id) || nb;
    const g = Math.hypot(nb.x - na.x, nb.z - na.z) > 2 ? 1 : f;
    out.push({ ...nb, x: na.x + (nb.x - na.x) * g, z: na.z + (nb.z - na.z) * g });
  }
  return out;
}
function interpBombs(t) {
  if (!snaps.length) return [];
  let a = snaps[0], b = snaps[snaps.length - 1];
  for (let i = 0; i < snaps.length - 1; i++) if (snaps[i].k <= t && snaps[i + 1].k > t) { a = snaps[i]; b = snaps[i + 1]; break; }
  const f = b.k === a.k ? 0 : Math.max(0, Math.min(1, (t - a.k) / (b.k - a.k)));
  const prev = new Map(a.bombs.map(x => [x.id, x]));
  return b.bombs.map(x => { const p = prev.get(x.id) || x; return { ...x, x: p.x + (x.x - p.x) * f, z: p.z + (x.z - p.z) * f, color: colorOf(x.owner) }; });
}
const renderTick = () => (clock === null ? 0 : clock - C.INTERP);

// ---------- feed, banners
const nameOf = id => (roster.get(id) || {}).name || '?';
const colorOf = id => (roster.get(id) || {}).color | 0;
const nameHtml = id => `<b style="color:${hexCss(COLORS[colorOf(id)] === 0x2b2b2b ? 0x9aa3c0 : COLORS[colorOf(id)])}">${esc(nameOf(id))}</b>`;
function pushFeed(html) { feed.push({ html, t: performance.now() }); if (feed.length > 6) feed.shift(); }
function showBanner(html, secs) { banner = { html, until: performance.now() + secs * 1000 }; }
function posOf(id) {
  if (id === myId && me) return [me.x, me.z];
  const q = latest && latest.players.get(id);
  return q ? [q.x, q.z] : null;
}

function onEvent(e) {
  const myPos = me ? [me.x, me.z] : [W / 2, H / 2];
  switch (e[0]) {
    case EV.BOMB: if (e[1] === myId) audio.drop(); break;
    case EV.BOOM: {
      const near = Math.hypot(e[1] + 0.5 - myPos[0], e[2] + 0.5 - myPos[1]) < 5;
      if (renderer) renderer.explosion(e[1], e[2], e.slice(3), near);
      audio.boom(near);
      break;
    }
    case EV.CRATE: if (renderer) renderer.crateBreak(e[1], e[2]); audio.crate(); break;
    case EV.PICK: {
      const p = posOf(e[1]);
      if (p && renderer) renderer.pickupFx(p[0], p[1], e[2]);
      if (e[1] === myId) { audio.pickup(); showBanner(`<span class="pu pu${e[2]}">${PU_NAMES[e[2]].toUpperCase()}!</span>`, 1.2); }
      break;
    }
    case EV.DIE: {
      const [, victim, killer] = e;
      const p = posOf(victim);
      if (p && renderer) renderer.deathFx(p[0], p[1], colorOf(victim));
      audio.die();
      pushFeed(killer === 0 ? `${nameHtml(victim)} was crushed` : killer === victim ? `${nameHtml(victim)} blew themselves up` : `💥 ${nameHtml(killer)} got ${nameHtml(victim)}`);
      if (victim === myId) showBanner('<span style="color:#ff6b6b">YOU\'RE OUT!</span><small>watch the rest of the round</small>', 2.5);
      break;
    }
    case EV.KICK: audio.kick(); break;
    case EV.ROUND: showBanner(`ROUND ${e[1]}`, 1.5); break;
    case EV.GO: audio.beep(true); showBanner('<span class="go">GO!</span>', 0.9); break;
    case EV.WIN: {
      const [, w, match, botsOnly] = e;
      if (!w) showBanner(botsOnly ? 'ALL PLAYERS OUT!<small>the bots win this one · next round coming</small>' : 'DRAW!<small>nobody survived</small>', 3);
      else if (match) showBanner(`🏆 ${nameHtml(w)}<small>wins the match!</small>`, 6);
      else showBanner(`${nameHtml(w)}<small>wins the round</small>`, 3);
      if (w === myId) audio.win(); else audio.lose();
      break;
    }
    case EV.SUDDEN: audio.siren(); showBanner('<span style="color:#ff6b6b">SUDDEN DEATH!</span><small>the walls are closing in</small>', 2.5); break;
    case EV.DROP: if (renderer) renderer.dropBlock(e[1], e[2]); audio.thud(); break;
  }
}

// ---------- HUD
function setHtml(id, html) { const el = $(id); if (el.__h !== html) { el.innerHTML = html; el.__h = html; } }
function updateHud() {
  if (!inRoom || !latest) return;
  const now = performance.now();
  // player strip: colour, name, round wins, alive / out
  const list = [...roster.values()].sort((a, b) => (scores.get(b.id) || {}).wins - (scores.get(a.id) || {}).wins || a.id - b.id);
  setHtml('strip', list.map(r => {
    const q = latest.players.get(r.id), sc = scores.get(r.id) || { wins: 0, kills: 0 };
    return `<div class="chip ${r.id === myId ? 'me' : ''} ${q && q.alive ? '' : 'out'}"><i style="background:${hexCss(COLORS[r.color])}"></i>
      <span>${esc(r.name.slice(0, 10))}</span><b>${'🏆'.repeat(sc.wins) || ''}</b>${q && q.alive ? '' : ' 💀'}</div>`;
  }).join(''));
  // timer / round
  const secs = Math.ceil(latest.tl / 60);
  const t = latest.ph === 1 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : '';
  const sudden = latest.ph === 1 && latest.tl === 0;
  setHtml('timer', `<small>ROUND ${latest.rd}</small>${sudden ? '<span class="sd">SUDDEN DEATH</span>' : t}`);
  // my stats
  setHtml('stats', `<div title="Bombs"><span>💣</span>${Math.max(0, mine.maxBombs - mine.active)}/${mine.maxBombs}</div><div title="Fire range"><span>🔥</span>${mine.fire}</div>
    <div title="Speed"><span>👟</span>${(me && me.speed | 0) + 1}</div><div title="Kick" class="${mine.kick ? '' : 'off'}"><span>🦶</span>${mine.kick ? 'KICK' : '-'}</div>`);
  // centre banner: countdown first
  let c = '';
  if (latest.ph === 0) {
    const n3 = Math.ceil(latest.tl / 60);
    c = `<span class="cd">${Math.max(1, n3)}</span><small>${mine.inRound ? 'get ready' : 'you join next round'}</small>`;
    if (n3 !== lastBeep && n3 >= 1 && n3 <= 3) { lastBeep = n3; audio.beep(false); }
  } else if (banner && now < banner.until) c = banner.html;
  else if (latest.ph === 1 && !mine.inRound) c = '<small>waiting for the next round…</small>';
  if (latest.ph === 1) lastBeep = -1;
  setHtml('center', c);
  setHtml('feed', feed.filter(f => now - f.t < 7000).map(f => `<div>${f.html}</div>`).join(''));
  // scoreboard (Tab)
  $('scoreboard').classList.toggle('show', scoreboardHeld);
  if (scoreboardHeld) {
    setHtml('scoreboard', `<h3>Arena ${esc(roomCode)} · first to ${C.WIN_ROUNDS} round wins</h3><table><tr><th>Bomber</th><th>Wins</th><th>KOs</th></tr>${
      list.map(r => { const sc = scores.get(r.id) || { wins: 0, kills: 0 }; return `<tr class="${r.id === myId ? 'me' : ''}"><td><i style="background:${hexCss(COLORS[r.color])}"></i>${esc(r.name)}${r.bot ? ' <small>BOT</small>' : ''}</td><td>${sc.wins}</td><td>${sc.kills}</td></tr>`; }).join('')}</table>`);
  }
  setHtml('netInfo', `${Math.round(net ? net.rtt : 0)} ms · ${fps} fps · ${corrections} corr`);
}

// ---------- main loop
let acc = 0, last = performance.now();
function tick() {
  if (!inRoom || !latest || !me || !net || !mine.alive) return;
  if (latest.ph !== 1) return;
  const k = ctl.sample();
  const inp = { s: ++seq, k };
  net.send({ t: 'i', s: inp.s, k });
  pending.push(inp);
  if (pending.length > 120) pending.shift();
  AR.step(me, k, world);
  me.keys = k;
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
  const kk = Math.pow(0.001, dt);
  offset = offset.map(v => v * kk);

  if (renderer) {
    const players = [];
    let focus = null;
    if (inRoom && latest) {
      for (const q of interpAt(renderTick())) {
        if (q.id === myId && me && mine.alive) continue;
        players.push({ ...q, color: colorOf(q.id), name: nameOf(q.id), me: q.id === myId });
      }
      if (me && mine.alive && mine.inRound) {
        const moving = !!(me.keys & (KEY.UP | KEY.DOWN | KEY.LEFT | KEY.RIGHT)) && latest.ph === 1;
        players.push({ id: myId, x: me.x + offset[0], z: me.z + offset[1], face: me.face, alive: true, moving, speed: me.speed, color: colorOf(myId), name: nameOf(myId), me: true });
        focus = { x: me.x, z: me.z };
      }
    }
    renderer.render({ dt, players, bombs: inRoom && latest ? interpBombs(renderTick()) : [], flames: latest ? latest.flames : [], powerups: latest ? latest.powerups : [], focus });
  }
  updateHud();
  requestAnimationFrame(loop);
}

// ---------- wiring
try { myColor = Math.max(0, Math.min(7, +localStorage.getItem('baColor') || 2)); } catch (e) { myColor = 2; }
function buildColorPicker() {
  $('colors').innerHTML = COLORS.map((c, i) => `<button data-c="${i}" title="${COLOR_NAMES[i]}" style="background:${hexCss(c)}" class="${i === myColor ? 'on' : ''}"></button>`).join('');
  $('colors').querySelectorAll('button').forEach(b => { b.onclick = () => { myColor = +b.dataset.c; buildColorPicker(); }; });
}
buildColorPicker();
// the name box shows the portal identity; clicking it opens the account dialog
$('nameInput').readOnly = true;
$('nameInput').title = 'Your name in every game - click to change';
$('nameInput').onclick = () => OIID.open();
OIID.me().then(id => { if (id) $('nameInput').value = id.name; });
OIID.onChange(id => { $('nameInput').value = id ? id.name : ''; if (id && net && net.open && !inRoom) net.send({ t: 'hello', name: id.name, token: id.token, skin: myColor }); });
if (deepJoin) $('btnPlay').textContent = '▶ JOIN ARENA ' + deepJoin;
$('btnPlay').onclick = async () => { if (await connect()) { $('lobbyStatus').textContent = ''; show('pLobby'); } };
$('btnCreate').onclick = () => net && net.send({ t: 'create', bots: +$('botsSelect').value, level: $('botLevel').value });
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
ctl.onTab = held => { scoreboardHeld = held && inRoom; };
$('stage').addEventListener('pointerdown', () => audio.unlock());

if (renderer) renderer.setGrid(tiles);
requestAnimationFrame(loop);
window.BOMB = {
  get state() {
    return { inRoom, roomCode, myId, phase: latest && latest.ph, round: latest && latest.rd, me: me && { x: me.x, z: me.z, speed: me.speed }, mine,
             players: latest ? latest.players.size : 0, bombs: latest ? latest.bombs.length : 0, corrections, pending: pending.length, fps };
  },
};
