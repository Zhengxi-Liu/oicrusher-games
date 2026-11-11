'use strict';
/**
 * oicrusher.me game server: ONE Node.js process for every real-time game (the VPS is small).
 *
 * Apache serves all static pages and reverse-proxies each game's WebSocket here:
 *   wss://oicrusher.me/game/fencing-ws  ->  ws://127.0.0.1:8090/fencing   (Photonic Fencing)
 *   wss://oicrusher.me/game/element-ws  ->  ws://127.0.0.1:8090/element   (Element Core)
 *   wss://oicrusher.me/game/cannon-ws   ->  ws://127.0.0.1:8090/cannon    (Cannon Duel, event relay)
 *   wss://oicrusher.me/game/hldm-ws     ->  ws://127.0.0.1:8090/hldm      (Half-Life Web Deathmatch, rooms of up to 10)
 *   wss://oicrusher.me/game/rooftop-ws  ->  ws://127.0.0.1:8090/rooftop   (Rooftop Tag, 1v1 / 2v2 capture the flag)
 *   wss://oicrusher.me/game/flight-ws   ->  ws://127.0.0.1:8090/flight    (Skyward Dynamics: shared sky + leaderboards)
 *   wss://oicrusher.me/game/kart-ws     ->  ws://127.0.0.1:8090/kart      (Voxel Kart Racing, races of up to 8)
 *   wss://oicrusher.me/game/bomb-ws     ->  ws://127.0.0.1:8090/bomb      (Bomb Arena 3D, arenas of up to 8)
 *   wss://oicrusher.me/game/tjhs-ws     ->  ws://127.0.0.1:8090/tjhs      (TJ Hide and Seek: one persistent school)
 * All rooms of all games advance on a single fixed 60 Hz clock.
 *
 *   PORT=8090 HOST=127.0.0.1 DATA_DIR=./data node server.js
 */
const http = require('http');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const { Lobby } = require('./Lobby.js');
const { RoomLobby } = require('./RoomLobby.js');
const FencingRoom = require('../photonic_fencing/Server/room.js').Room;
const ElementRoom = require('../element_core/server/GameRoom.js').GameRoom;
const CannonRoom = require('../cannon_duel/Server/room.js').Room;
const HLRoom = require('../hl_deathmatch/server/GameRoom.js').GameRoom;
const RooftopRoom = require('../rooftop_tag/server/GameRoom.js').GameRoom;
const { SkyServer } = require('../flight_sim/server/SkyServer.js');
const KartRoom = require('../voxel_kart/server/GameRoom.js').GameRoom;
const BombRoom = require('../bomb_arena/server/GameRoom.js').GameRoom;
const { HideServer } = require('../tj_hide_seek/server/HideServer.js');
const Identity = require('./Identity.js');
const Moderation = require('../tj_hide_seek/server/Moderation.js');

const PORT = Number(process.env.PORT || 8090);
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = process.env.DATA_DIR || `${__dirname}/data`;
const ORIGINS = (process.env.ORIGINS || 'https://oicrusher.me,https://www.oicrusher.me,http://localhost,http://127.0.0.1').split(',');
const MAX_PER_IP = 8;
const STEP_MS = 1000 / 60;

const log = (...a) => console.log(new Date().toISOString(), ...a);
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}

const games = {
  fencing: new Lobby({ name: 'fencing', RoomClass: FencingRoom, dataDir: DATA_DIR, log }),
  element: new Lobby({ name: 'element', RoomClass: ElementRoom, dataDir: DATA_DIR, log, bots: true }),
  cannon: new Lobby({ name: 'cannon', RoomClass: CannonRoom, dataDir: DATA_DIR, log }),
  hldm: new RoomLobby({ name: 'hldm', RoomClass: HLRoom, log }),
  rooftop: new RoomLobby({ name: 'rooftop', RoomClass: RooftopRoom, log, maxRooms: 16 }),
  flight: new SkyServer({ name: 'flight', dataDir: DATA_DIR, log }),
  kart: new RoomLobby({ name: 'kart', RoomClass: KartRoom, log, maxRooms: 12 }),
  bomb: new RoomLobby({ name: 'bomb', RoomClass: BombRoom, log, maxRooms: 12 }),
  tjhs: new HideServer({ name: 'tjhs', dataDir: DATA_DIR, log }),
};

// one keyword filter for every game: names are checked in Identity.resolve (every 'hello'), chat by the games that have one
const mod = Moderation.shared({ dataDir: DATA_DIR, log });
Identity.setNameFilter((name, m) => mod.allow(name, { kind: 'username', game: m && m._game, user: name, ip: m && m._ip }));

const server = http.createServer((req, res) => {
  // POST /moderate {text, kind, game, user, ip} -> {ok, hits}: lets the PHP side (portal sign-up, score names) use the same filter.
  // Loopback only; Apache only proxies the /game/*-ws paths, and anything it proxies carries X-Forwarded-For, which is refused here.
  if (req.url === '/moderate' && req.method === 'POST') {
    const local = req.socket.remoteAddress === '127.0.0.1' || req.socket.remoteAddress === '::1' || req.socket.remoteAddress === '::ffff:127.0.0.1';
    if (!local || req.headers['x-forwarded-for'] || req.headers['forwarded']) { res.writeHead(403); res.end(); return; }
    let body = '';
    req.on('data', d => { body += d; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      let q; try { q = JSON.parse(body); } catch (e) { res.writeHead(400); res.end(); return; }
      const text = String((q && q.text) || '');
      const r = mod.check(text);
      if (!r.ok) mod.allow(text, { kind: String(q.kind || 'text').slice(0, 20), game: String(q.game || 'portal').slice(0, 20), user: String(q.user || '').slice(0, 40), ip: String(q.ip || '').slice(0, 45) });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: r.ok }));
    });
    return;
  }
  if (req.url === '/health') {
    const out = { ok: true, uptime: Math.round(process.uptime()), rssMB: Math.round(process.memoryUsage().rss / 1048576) };
    for (const [name, lobby] of Object.entries(games)) out[name] = { clients: lobby.clients.size, rooms: lobby.rooms.size };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(out));
    return;
  }
  res.writeHead(404); res.end();
});

const originOk = o => !o || ORIGINS.some(allowed => o === allowed || o.startsWith(allowed + ':'));
const perIp = new Map();
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });

server.on('upgrade', (req, socket, head) => {
  const name = (req.url || '/').split('?')[0].replace(/^\/+|\/+$/g, '') || 'fencing';
  const lobby = games[name];
  if (!lobby || !originOk(req.headers.origin)) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => connect(ws, req, lobby));
});

function connect(ws, req, lobby) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if ((perIp.get(ip) || 0) >= MAX_PER_IP) { ws.close(1008, 'too many connections'); return; }
  perIp.set(ip, (perIp.get(ip) || 0) + 1);

  const c = lobby.add(ws, ip);
  ws.isAlive = true;
  let tokens = 240, last = Date.now();                // ~120 msg/s sustained, burst 240
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (data, isBinary) => {
    const now = Date.now();
    tokens = Math.min(240, tokens + (now - last) * 0.12); last = now;
    if (--tokens < 0) { ws.close(1008, 'rate'); return; }
    if (isBinary) return;
    let m; try { m = JSON.parse(data); } catch (e) { return; }
    if (m && typeof m.t === 'string') { m._ip = ip; m._game = lobby.name; lobby.handle(c, m); }
  });
  ws.on('close', () => {
    lobby.remove(c);
    const n = (perIp.get(ip) || 1) - 1;
    if (n > 0) perIp.set(ip, n); else perIp.delete(ip);
  });
  ws.on('error', () => {});
}

// Drop connections that stopped answering pings.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000).unref();

// One fixed 60 Hz clock for every room of every game, with catch-up.
let next = performance.now();
(function loop() {
  const now = performance.now();
  let n = 0;
  while (now >= next && n < 5) {
    for (const lobby of Object.values(games)) lobby.update();
    next += STEP_MS; n++;
  }
  if (now - next > 250) next = now;
  setTimeout(loop, Math.max(1, next - performance.now()));
})();

server.listen(PORT, HOST, () => log(`oicrusher game server on ${HOST}:${PORT} (${Object.keys(games).join(', ')})`));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    log('shutting down');
    for (const ws of wss.clients) ws.close(1001, 'server restart');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
