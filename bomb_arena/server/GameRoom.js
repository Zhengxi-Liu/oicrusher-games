'use strict';
/**
 * Bomb Arena 3D - one authoritative arena (up to 8 players, humans + bots), last one standing wins.
 *
 * 60 Hz: each player's queued inputs are applied exactly once and in order with the shared grid
 * movement (shared/Arena.js), so the browser's prediction of its own player matches. Everything else
 * lives here: bombs and fuses, cross-shaped blasts that stop at walls and break the first crate,
 * chain reactions, lingering flames, power-up drops (revealed when the flame on that tile dies down),
 * kicking, deaths and kill credit, sudden death (walls drop in a spiral after 2 minutes) and the
 * round / match flow (first to 3 round wins). Snapshots go out at 30 Hz.
 *
 * Plugs into game_server/RoomLobby.js (addClient / removeClient / onMessage / update / info).
 */
const crypto = require('crypto');
const { C, T, KEY, PU, PU_WEIGHTS, EV } = require('../shared/Constants.js');
const A = require('../shared/Arena.js');
const { Bot } = require('./Bot.js');

const W = A.W, H = A.H, idx = A.idx;
const r3 = v => Math.round(v * 1000) / 1000;
const BOT_NAMES = ['Boomer', 'Fuse', 'Sparky', 'Kaboom', 'Blaster', 'Dynamo', 'Pyro', 'Ember', 'Nitro'];

function makeRng(seed = crypto.randomInt(1, 0x7fffffff)) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

class GameRoom {
  constructor(code, hooks, opts = {}) {
    this.code = code;
    this.hooks = hooks;
    this.rng = makeRng();
    this.tick = 0;
    this.players = new Map();
    this.byClient = new Map();
    this.nextId = 1;
    this.nextBomb = 1;
    this.events = [];
    this.botLevel = opts.botLevel || 'normal';
    this.round = 0;
    this.stats = { rounds: 0, peak: 0 };
    this.tiles = A.generate(1);
    this.world = { tiles: this.tiles, bombs: new Set() };
    this.bombs = new Map();          // id -> bomb
    this.bombAt = new Map();         // tile -> bomb
    this.flames = new Map();         // tile -> { t: ticks left, owner }
    this.powerups = new Map();       // tile -> type
    this.pendingDrops = new Map();   // tile -> type (revealed when the flame there dies)
    this.gridVer = 1;
    this.phase = 'waiting';
    for (let i = 0; i < Math.min(C.MAX_PLAYERS, opts.bots | 0); i++) this.addBot();
  }

  // ---------- lobby interface
  get humanCount() { let n = 0; for (const p of this.players.values()) if (!p.bot) n++; return n; }
  get size() { return this.players.size; }
  info() {
    const alive = [...this.players.values()].filter(p => p.alive).length;
    const leader = this.phase === 'play' ? `round ${this.round} · ${alive} alive` : this.phase === 'countdown' ? `round ${this.round} starting` : 'between rounds';
    return { code: this.code, players: this.players.size, humans: this.humanCount, max: C.MAX_PLAYERS, map: 'Arena', leader };
  }

  freeColor(pref) {
    const used = new Set([...this.players.values()].map(p => p.color));
    if (pref >= 0 && pref < 8 && !used.has(pref)) return pref;
    for (let c = 0; c < 8; c++) if (!used.has(c)) return c;
    return 0;
  }

  addClient(client) {
    if (this.players.size >= C.MAX_PLAYERS) {
      const bots = [...this.players.values()].filter(p => p.bot);
      if (!bots.length) return false;
      bots.sort((a, b) => (a.alive ? 1 : 0) - (b.alive ? 1 : 0));    // prefer a bot that is already out
      this.removePlayer(bots[0]);
    }
    const p = this.createPlayer(client.name, client, false, client.skin);
    this.byClient.set(client, p);
    this.hooks.send(client, { t: 'joined', code: this.code, you: p.id, tick: this.tick, color: p.color });
    this.broadcastRoster();
    this.stats.peak = Math.max(this.stats.peak, this.humanCount);
    if (this.phase === 'waiting') this.startRound();
    else if (this.phase === 'countdown') this.joinRound(p);
    else this.checkRoundOver();                                     // walked in on a round only bots are still in
    return true;
  }

  removeClient(client) {
    const p = this.byClient.get(client);
    if (!p) return;
    this.byClient.delete(client);
    this.removePlayer(p);
  }

  addBot(level) {
    if (this.players.size >= C.MAX_PLAYERS) return false;
    const used = new Set([...this.players.values()].map(p => p.name));
    const name = BOT_NAMES.find(n => !used.has(n)) || 'Bot' + this.nextId;
    const p = this.createPlayer(name, null, true, -1);
    p.brain = new Bot(this, p, level || this.botLevel);
    this.broadcastRoster();
    return true;
  }

  removeBot() {
    const bots = [...this.players.values()].filter(p => p.bot);
    if (bots.length) this.removePlayer(bots[bots.length - 1]);
  }

  removePlayer(p) {
    this.players.delete(p.id);
    if (p.alive) { p.alive = false; this.checkRoundOver(); }
    this.broadcastRoster();
  }

  createPlayer(name, client, bot, colorPref) {
    const p = { id: this.nextId++, name, client, bot, color: this.freeColor(colorPref | 0), queue: [], ack: 0, lastSeq: 0,
                x: 1.5, z: 1.5, speed: 0, face: 2, axis: 'x', keys: 0, moving: false,
                alive: false, inRound: false, maxBombs: C.START_BOMBS, fire: C.START_FIRE, kick: false, active: 0,
                wins: 0, kills: 0, deaths: 0, diedAt: 0 };
    this.players.set(p.id, p);
    return p;
  }

  onMessage(client, m) {
    const p = this.byClient.get(client);
    if (!p) return;
    if (m.t === 'i') {
      const s = m.s | 0;
      if (s <= p.lastSeq) return;
      p.lastSeq = s;
      p.queue.push({ s, keys: (m.k | 0) & 31 });
      if (p.queue.length > 90) p.queue.shift();
    } else if (m.t === 'addbot') { if (this.addBot(m.level)) this.hooks.lobbyChanged && this.hooks.lobbyChanged(); }
    else if (m.t === 'kickbot') { this.removeBot(); this.hooks.lobbyChanged && this.hooks.lobbyChanged(); }
  }

  takeInputs(p) {
    if (p.bot) return [{ keys: p.brain.input() }];
    const q = p.queue;
    if (q.length > 60) { const dropped = q.splice(0, q.length - 8); p.ack = dropped[dropped.length - 1].s; }
    const out = q.splice(0, q.length > 8 ? 4 : q.length > 2 ? 2 : q.length);
    if (out.length) p.ack = out[out.length - 1].s;
    return out;
  }

  ev(...e) { this.events.push(e); }

  // ---------- rounds
  startRound() {
    this.round++;
    this.phase = 'countdown';
    this.phaseUntil = this.tick + C.COUNTDOWN;
    this.tiles = A.generate(crypto.randomInt(1, 0x7fffffff));
    this.world = { tiles: this.tiles, bombs: new Set() };
    this.bombs.clear(); this.bombAt.clear(); this.flames.clear(); this.powerups.clear(); this.pendingDrops.clear();
    this.spiralOrder = A.spiral(); this.spiralAt = 0;
    this.gridVer++;
    const list = [...this.players.values()];
    const spawns = A.SPAWNS.slice(0, Math.max(list.length, 2));
    for (let i = spawns.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [spawns[i], spawns[j]] = [spawns[j], spawns[i]]; }
    list.forEach((p, i) => {
      const [x, z] = spawns[i % spawns.length];
      Object.assign(p, { x: x + 0.5, z: z + 0.5, speed: 0, face: 2, axis: 'x', keys: 0, moving: false, alive: true, inRound: true,
                         maxBombs: C.START_BOMBS, fire: C.START_FIRE, kick: false, active: 0, queue: [] });
      if (p.brain) p.brain.reset();
    });
    this.ev(EV.ROUND, this.round);
    this.hooks.lobbyChanged && this.hooks.lobbyChanged();
  }

  /** Drop a newcomer into the round that is about to start, on a free spawn. */
  joinRound(p) {
    const taken = new Set([...this.players.values()].filter(q => q.inRound && q !== p).map(q => idx(Math.floor(q.x), Math.floor(q.z))));
    const spot = A.SPAWNS.find(([x, z]) => !taken.has(idx(x, z)));
    if (!spot) return;
    Object.assign(p, { x: spot[0] + 0.5, z: spot[1] + 0.5, alive: true, inRound: true, speed: 0, maxBombs: C.START_BOMBS, fire: C.START_FIRE, kick: false, active: 0 });
  }

  checkRoundOver() {
    if (this.phase !== 'play') return;
    const inRound = [...this.players.values()].filter(p => p.inRound);
    const alive = inRound.filter(p => p.alive);
    const solo = inRound.length <= 1;
    // every person is out (only bots left standing): nobody wants to watch bots finish it, start the next round
    const humans = [...this.players.values()].filter(p => !p.bot);
    const humansOut = humans.length > 0 && !humans.some(p => p.alive);
    if (!humansOut && (alive.length > 1 || (solo && alive.length === 1))) return;
    const winner = alive.length === 1 && !solo ? alive[0] : null;
    if (winner) winner.wins++;
    const matchOver = !!winner && winner.wins >= C.WIN_ROUNDS;
    this.phase = matchOver ? 'matchEnd' : 'roundEnd';
    this.phaseUntil = this.tick + (matchOver ? C.MATCH_END : C.ROUND_END);
    this.winner = winner ? winner.id : 0;
    this.stats.rounds++;
    this.ev(EV.WIN, winner ? winner.id : 0, matchOver ? 1 : 0, humansOut && alive.length ? 1 : 0);
    if (matchOver && this.hooks.log) this.hooks.log(`match ${this.code} won by ${winner.name}`);
    this.scoreDirty = true;
    this.hooks.lobbyChanged && this.hooks.lobbyChanged();
  }

  // ---------- main tick
  update() {
    this.tick++;
    if (this.phase === 'countdown' && this.tick >= this.phaseUntil) { this.phase = 'play'; this.roundStart = this.tick; this.ev(EV.GO); this.hooks.lobbyChanged && this.hooks.lobbyChanged(); }
    if ((this.phase === 'roundEnd' || this.phase === 'matchEnd') && this.tick >= this.phaseUntil) {
      if (this.phase === 'matchEnd') for (const p of this.players.values()) { p.wins = 0; p.kills = 0; }
      this.round = this.phase === 'matchEnd' ? 0 : this.round;
      if (this.players.size) this.startRound(); else this.phase = 'waiting';
    }

    for (const p of this.players.values()) {
      const inputs = this.takeInputs(p);
      if (!p.alive || this.phase !== 'play') { if (inputs.length) p.keys = inputs[inputs.length - 1].keys; continue; }
      for (const inp of inputs) {
        const bombPressed = (inp.keys & KEY.BOMB) && !(p.keys & KEY.BOMB);
        const r = A.step(p, inp.keys, this.world);
        p.keys = inp.keys;
        if (r.bump && p.kick) this.tryKick(p, r.bump, r.dir);
        if (bombPressed) this.placeBomb(p);
        this.pickup(p);
        if (!p.alive) break;
      }
    }
    if (this.phase === 'play' || this.phase === 'roundEnd' || this.phase === 'matchEnd') {
      this.updateBombs();
      this.updateFlames();
      if (this.phase === 'play') this.suddenDeath();
    }
    if (this.tick % C.SNAPSHOT_EVERY === 0) this.broadcast();
  }

  placeBomb(p) {
    const cx = Math.floor(p.x), cz = Math.floor(p.z), i = idx(cx, cz);
    if (p.active >= p.maxBombs || this.bombAt.has(i) || this.tiles[i] !== T.FLOOR) return;
    const b = { id: this.nextBomb++, owner: p, cx, cz, x: cx + 0.5, z: cz + 0.5, fuse: C.FUSE, range: p.fire, dx: 0, dz: 0 };
    this.bombs.set(b.id, b); this.bombAt.set(i, b); this.world.bombs.add(i);
    p.active++;
    this.ev(EV.BOMB, p.id, cx, cz);
  }

  tryKick(p, [cx, cz], dir) {
    const b = this.bombAt.get(idx(cx, cz));
    if (!b || b.dx || b.dz || !dir) return;
    if (this.solidFor(b, cx + dir[0], cz + dir[1])) return;
    b.dx = dir[0]; b.dz = dir[1];
    this.ev(EV.KICK, p.id);
  }

  /** Can a sliding bomb enter tile (cx, cz)? walls, crates, other bombs and players stop it. */
  solidFor(b, cx, cz) {
    if (cx < 0 || cz < 0 || cx >= W || cz >= H || this.tiles[idx(cx, cz)] !== T.FLOOR) return true;
    const o = this.bombAt.get(idx(cx, cz));
    if (o && o !== b) return true;
    for (const p of this.players.values()) if (p.alive && Math.floor(p.x) === cx && Math.floor(p.z) === cz) return true;
    return false;
  }

  pickup(p) {
    const i = idx(Math.floor(p.x), Math.floor(p.z));
    const t = this.powerups.get(i);
    if (t) {
      this.powerups.delete(i);
      if (t === PU.BOMB) p.maxBombs = Math.min(C.MAX_BOMBS, p.maxBombs + 1);
      else if (t === PU.FIRE) p.fire = Math.min(C.MAX_FIRE, p.fire + 1);
      else if (t === PU.SPEED) p.speed = Math.min(C.MAX_SPEED_LVL, p.speed + 1);
      else if (t === PU.KICK) p.kick = true;
      this.ev(EV.PICK, p.id, t);
    }
    const f = this.flames.get(i);
    if (f) this.kill(p, f.owner);
  }

  updateBombs() {
    const step = C.KICK_SPEED * C.DT;
    for (const b of [...this.bombs.values()]) {
      if (b.dx || b.dz) {
        // slide; stop centred on the last free tile
        const nx = b.x + b.dx * step, nz = b.z + b.dz * step;
        const aheadX = b.dx ? Math.floor(b.x + b.dx * 0.5 + b.dx * step) : b.cx, aheadZ = b.dz ? Math.floor(b.z + b.dz * 0.5 + b.dz * step) : b.cz;
        if ((aheadX !== b.cx || aheadZ !== b.cz) && this.solidFor(b, aheadX, aheadZ)) {
          b.x = b.cx + 0.5; b.z = b.cz + 0.5; b.dx = b.dz = 0;
        } else {
          b.x = nx; b.z = nz;
          const cx = Math.floor(b.x), cz = Math.floor(b.z);
          if (cx !== b.cx || cz !== b.cz) {
            this.bombAt.delete(idx(b.cx, b.cz)); this.world.bombs.delete(idx(b.cx, b.cz));
            b.cx = cx; b.cz = cz;
            this.bombAt.set(idx(cx, cz), b); this.world.bombs.add(idx(cx, cz));
            const pu = idx(cx, cz);
            if (this.powerups.has(pu)) this.powerups.delete(pu);          // a sliding bomb crushes power-ups
            if (this.flames.has(pu)) b.fuse = Math.min(b.fuse, C.CHAIN_FUSE);
          }
        }
      }
      if (--b.fuse <= 0) this.explode(b);
    }
  }

  explode(b) {
    if (!this.bombs.has(b.id)) return;
    this.bombs.delete(b.id);
    this.bombAt.delete(idx(b.cx, b.cz)); this.world.bombs.delete(idx(b.cx, b.cz));
    if (this.players.has(b.owner.id)) b.owner.active = Math.max(0, b.owner.active - 1);
    const tiles = [b.cx, b.cz];
    this.burn(b.cx, b.cz, b.owner);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let r = 1; r <= b.range; r++) {
        const cx = b.cx + dx * r, cz = b.cz + dz * r, i = idx(cx, cz);
        const t = this.tiles[i];
        if (t === T.WALL) break;
        tiles.push(cx, cz);
        if (t === T.CRATE) {
          this.tiles[i] = T.FLOOR; this.gridVer++;
          this.ev(EV.CRATE, cx, cz);
          if (this.rng() < C.DROP_CHANCE) this.pendingDrops.set(i, this.rollPowerup());
          this.burn(cx, cz, b.owner);
          break;
        }
        const other = this.bombAt.get(i);
        this.burn(cx, cz, b.owner);
        if (other) { other.fuse = Math.min(other.fuse, C.CHAIN_FUSE); break; }
        if (this.powerups.has(i)) { this.powerups.delete(i); break; }
      }
    }
    this.ev(EV.BOOM, b.cx, b.cz, ...tiles);
  }

  burn(cx, cz, owner) {
    const i = idx(cx, cz);
    this.flames.set(i, { t: C.FLAME_TICKS, owner });
    for (const p of this.players.values()) if (p.alive && Math.floor(p.x) === cx && Math.floor(p.z) === cz) this.kill(p, owner);
  }

  rollPowerup() {
    const total = PU_WEIGHTS.reduce((s, [, w]) => s + w, 0);
    let r = this.rng() * total;
    for (const [t, w] of PU_WEIGHTS) { r -= w; if (r < 0) return t; }
    return PU.BOMB;
  }

  updateFlames() {
    for (const [i, f] of this.flames) {
      if (--f.t <= 0) {
        this.flames.delete(i);
        const d = this.pendingDrops.get(i);
        if (d) { this.pendingDrops.delete(i); this.powerups.set(i, d); }
        continue;
      }
      const b = this.bombAt.get(i);
      if (b) b.fuse = Math.min(b.fuse, C.CHAIN_FUSE);
    }
    // anyone standing in fire (also covers walking into it)
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const f = this.flames.get(idx(Math.floor(p.x), Math.floor(p.z)));
      if (f) this.kill(p, f.owner);
    }
  }

  kill(p, by) {
    if (!p.alive || this.phase !== 'play') return;
    p.alive = false; p.deaths++; p.diedAt = this.tick;
    const killer = by && this.players.has(by.id) ? by : null;
    if (killer && killer !== p) killer.kills++;
    this.ev(EV.DIE, p.id, killer ? killer.id : 0);
    this.scoreDirty = true;
    this.checkRoundOver();
  }

  suddenDeath() {
    const t = this.tick - this.roundStart;
    if (t < C.ROUND_TIME) return;
    if (t === C.ROUND_TIME) this.ev(EV.SUDDEN);
    if ((t - C.ROUND_TIME) % C.SUDDEN_EVERY) return;
    while (this.spiralAt < this.spiralOrder.length) {
      const [cx, cz] = this.spiralOrder[this.spiralAt++], i = idx(cx, cz);
      if (this.tiles[i] === T.WALL) continue;
      this.tiles[i] = T.WALL; this.gridVer++;
      this.powerups.delete(i); this.pendingDrops.delete(i); this.flames.delete(i);
      const b = this.bombAt.get(i);
      if (b) { this.bombs.delete(b.id); this.bombAt.delete(i); this.world.bombs.delete(i); if (this.players.has(b.owner.id)) b.owner.active = Math.max(0, b.owner.active - 1); }
      this.ev(EV.DROP, cx, cz);
      for (const p of this.players.values()) if (p.alive && Math.floor(p.x) === cx && Math.floor(p.z) === cz) this.kill(p, null);
      break;
    }
  }

  // ---------- networking
  broadcastRoster() {
    const players = [...this.players.values()].map(p => ({ id: p.id, name: p.name, bot: p.bot ? 1 : 0, color: p.color }));
    for (const p of this.players.values()) if (p.client) this.hooks.send(p.client, { t: 'roster', players, code: this.code });
    this.scoreDirty = true;
  }

  phaseCode() { return { waiting: 0, countdown: 0, play: 1, roundEnd: 2, matchEnd: 3 }[this.phase]; }

  broadcast() {
    const pl = [];
    for (const p of this.players.values()) {
      pl.push(p.id, r3(p.x), r3(p.z), p.face, p.alive ? 1 : 0, p.moving ? 1 : 0, p.speed, p.kick ? 1 : 0);
    }
    const bo = [];
    for (const b of this.bombs.values()) bo.push(b.id, r3(b.x), r3(b.z), b.fuse, b.owner.id, b.range);
    const fl = [];
    for (const [i, f] of this.flames) fl.push(i, f.t);
    const pu = [];
    for (const [i, t] of this.powerups) pu.push(i, t);
    const left = this.phase === 'play' ? Math.max(0, C.ROUND_TIME - (this.tick - this.roundStart)) : Math.max(0, (this.phaseUntil || 0) - this.tick);
    const base = { t: 's', k: this.tick, ph: this.phaseCode(), rd: this.round, tl: left, w: this.winner || 0, gv: this.gridVer,
                   p: pl, b: bo, f: fl, u: pu, ev: this.events };
    if (this.gridVer !== this.sentGridVer || this.tick % 60 === 0) { base.g = Array.from(this.tiles).join(''); this.sentGridVer = this.gridVer; }
    if (this.scoreDirty || this.tick % 60 === 0) {
      base.sc = [];
      for (const p of this.players.values()) base.sc.push(p.id, p.wins, p.kills);
      this.scoreDirty = false;
    }
    for (const p of this.players.values()) {
      if (!p.client) continue;
      const me = [...A.packState(p), p.alive ? 1 : 0, p.maxBombs, p.active, p.fire, p.kick ? 1 : 0, p.inRound ? 1 : 0];
      this.hooks.send(p.client, { ...base, a: p.ack, me });
    }
    this.events = [];
  }
}

module.exports = { GameRoom };
