'use strict';
/**
 * Rooftop Tag - one authoritative capture-the-flag room (1v1 or 2v2, humans + bots).
 *
 * 60 Hz: each runner's queued inputs are applied exactly once and in order with the shared
 * movement code (PhysicsManager), so the browser's replay of its own unacknowledged inputs
 * reproduces the server. The tagger is a lag-compensated hitscan (targets rewound to the tick the
 * shooter was rendering, at most 250 ms). Flags, captures, drops, returns, the void, health
 * regeneration, respawns and the match flow live here. Snapshots go out at 30 Hz.
 */
const crypto = require('crypto');
const { C, BTN, PF, TEAMS, FLAG, EV } = require('../shared/Constants.js');
const M = require('../shared/Movement.js');
const { MAPS, IDS, DEFAULT } = require('../shared/MapData.js');
const { PhysicsManager } = require('./PhysicsManager.js');
const { Bot, graphFor } = require('./Bot.js');

const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;

function makeRng(seed = crypto.randomInt(1, 0x7fffffff)) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BOT_NAMES = ['Glitch', 'Vanta', 'Neon', 'Static', 'Pixel', 'Kairo', 'Ryo', 'Nova'];

class GameRoom {
  constructor(code, hooks, opts = {}) {
    this.code = code;
    this.hooks = hooks;              // { send(client, msg), lobbyChanged() }
    this.rng = makeRng();
    this.tick = 0;
    this.players = new Map();        // pid -> runner
    this.byClient = new Map();       // client -> runner
    this.nextPid = 1;
    this.events = [];
    this.map = MAPS[IDS.includes(opts.map) ? opts.map : DEFAULT];
    this.phys = new PhysicsManager(this.map);
    this.graph = graphFor(this.map);
    this.botLevel = opts.botLevel || 'normal';
    this.stats = { caps: 0, tags: 0, peakPlayers: 0 };
    this.resetFlags();
    this.caps = [0, 0];
    this.phase = 'play';
    this.matchEnd = C.TIME_LIMIT;
    this.phaseUntil = 0;
    this.winner = -1;
    this.scoreDirty = true;
    for (let i = 0; i < Math.min(C.MAX_PLAYERS, opts.bots | 0); i++) this.addBot();
  }

  resetFlags() {
    this.flags = this.map.FLAGS.map(f => ({ team: f.team, home: f.pos, state: FLAG.BASE, carrier: null,
                                            x: f.pos[0], y: f.pos[1], z: f.pos[2], returnAt: 0 }));
  }

  // ---------- lobby interface
  get humanCount() { let n = 0; for (const p of this.players.values()) if (!p.bot) n++; return n; }
  get size() { return this.players.size; }
  info() {
    const mode = this.players.size <= 2 ? '1v1' : '2v2';
    return { code: this.code, players: this.players.size, humans: this.humanCount, max: C.MAX_PLAYERS, map: this.map.name,
             leader: `${mode} · ${TEAMS[0].name} ${this.caps[0]} : ${this.caps[1]} ${TEAMS[1].name}` };
  }

  teamSize(t) { let n = 0; for (const p of this.players.values()) if (p.team === t) n++; return n; }
  smallerTeam() { return this.teamSize(1) < this.teamSize(0) ? 1 : 0; }

  /** client.prefTeam: 0 / 1 = the team the player picked in the lobby, anything else = auto. */
  addClient(client) {
    const half = C.MAX_PLAYERS / 2, botsOf = t => [...this.players.values()].filter(p => p.bot && (t < 0 || p.team === t));
    let team = client.prefTeam === 0 || client.prefTeam === 1 ? client.prefTeam : this.smallerTeam();
    // the picked side is full of humans: take the other side
    if (this.teamSize(team) >= half && !botsOf(team).length) team = 1 - team;
    if (this.teamSize(team) >= half && !botsOf(team).length) return false;
    if (this.teamSize(team) >= half) this.removePlayer(botsOf(team)[0]);          // take a bot's place on that side
    else if (this.players.size >= C.MAX_PLAYERS) {
      const bots = botsOf(-1);
      if (!bots.length) return false;
      bots.sort((a, b) => this.teamSize(b.team) - this.teamSize(a.team));
      this.removePlayer(bots[0]);
    }
    const p = this.createPlayer(client.name, client, false, team);
    this.balanceBots();
    this.byClient.set(client, p);
    this.hooks.send(client, { t: 'joined', code: this.code, you: p.id, team: p.team, tick: this.tick, map: this.map.id });
    this.broadcastRoster();
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
    const name = 'BOT ' + (BOT_NAMES.find(n => !used.has('BOT ' + n)) || 'Unit' + this.nextPid);
    const p = this.createPlayer(name, null, true, this.smallerTeam());
    p.brain = new Bot(this, p, level || this.botLevel);
    this.broadcastRoster();
    return true;
  }

  removeBot() {
    const bots = [...this.players.values()].filter(p => p.bot);
    if (bots.length) this.removePlayer(bots[bots.length - 1]);
  }

  removePlayer(p) {
    if (p.carry) this.dropFlag(p, false);
    this.players.delete(p.id);
    this.broadcastRoster();
    this.scoreDirty = true;
  }

  createPlayer(name, client, bot, team) {
    const p = { id: this.nextPid++, name, client, bot, team, tags: 0, deaths: 0, caps: 0, returns: 0,
                queue: [], lastSeq: 0, ack: 0, last: { m: 0, yaw: 0, pitch: 0, b: 0, rt: 0 }, hist: [],
                alive: false, respawnAt: 0, spawnTick: 0, firedAt: -99, hp: C.HP, hurtAt: -999, carry: false };
    this.players.set(p.id, p);
    this.spawn(p);
    this.stats.peakPlayers = Math.max(this.stats.peakPlayers, this.players.size);
    this.scoreDirty = true;
    return p;
  }

  spawn(p) {
    const spots = this.map.SPAWNS[p.team];
    const scored = spots.map(s => {
      let near = Infinity;
      for (const q of this.players.values()) if (q !== p && q.alive) near = Math.min(near, Math.hypot(q.x - s.x, q.z - s.z));
      return { s, score: Math.min(near, 6) + this.rng() * 3 };      // don't stack on a teammate, otherwise random
    }).sort((a, b) => b.score - a.score);
    const s = scored[0].s;
    Object.assign(p, { x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: 0, hp: C.HP, alive: true, spawnTick: this.tick, hurtAt: -999, lastAttacker: null });
    M.resetMove(p);
    p.carry = false;
    p.hist = [];
    this.ev(EV.SPAWN, p.id);
  }

  onMessage(client, m) {
    const p = this.byClient.get(client);
    if (!p) return;
    if (m.t === 'i') this.onInput(p, m);
    else if (m.t === 'addbot') { if (this.addBot(m.level)) this.hooks.lobbyChanged && this.hooks.lobbyChanged(); }
    else if (m.t === 'kickbot') { this.removeBot(); this.hooks.lobbyChanged && this.hooks.lobbyChanged(); }
    else if (m.t === 'team') this.switchTeam(p);
  }

  /** Move bots off a side that is two runners bigger (e.g. you picked the bot's side in a 1v1). */
  balanceBots() {
    for (let t = 0; t < 2; t++) {
      while (this.teamSize(t) - this.teamSize(1 - t) >= 2) {
        const bot = [...this.players.values()].find(q => q.bot && q.team === t);
        if (!bot) break;
        if (bot.carry) this.dropFlag(bot, false);
        bot.team = 1 - t; bot.alive = false; bot.respawnAt = this.tick + 60;
      }
    }
  }

  /** Swap sides (only when it keeps the teams even, or swaps with a bot). */
  switchTeam(p) {
    const other = 1 - p.team;
    if (this.teamSize(other) >= C.MAX_PLAYERS / 2) {
      const bot = [...this.players.values()].find(q => q.bot && q.team === other);
      if (!bot) return;
      if (bot.carry) this.dropFlag(bot, false);
      bot.team = p.team; bot.alive = false; bot.respawnAt = this.tick + 60;
    }
    if (p.carry) this.dropFlag(p, false);
    p.team = other; p.alive = false; p.respawnAt = this.tick + 60;
    if (p.client) this.hooks.send(p.client, { t: 'team', team: p.team });
    this.broadcastRoster();
    this.scoreDirty = true;
  }

  onInput(p, m) {
    const s = m.s | 0;
    if (s <= p.lastSeq) return;
    p.lastSeq = s;
    const yaw = Number(m.y), pitch = Number(m.p), rt = Number(m.rt);
    p.queue.push({ s, m: (m.m | 0) & 63, yaw: Number.isFinite(yaw) ? yaw : p.last.yaw, pitch: Number.isFinite(pitch) ? pitch : p.last.pitch,
                   b: (m.b | 0) & 3, rt: Number.isFinite(rt) ? rt : this.tick });
    if (p.queue.length > 90) p.queue.shift();
  }

  /** Inputs applied this tick: each exactly once, in order; a backlog drains faster but is never dropped (< 1 s). */
  takeInputs(p) {
    if (p.bot) return [p.brain.input()];
    const q = p.queue;
    if (q.length > 60) { const dropped = q.splice(0, q.length - 8); p.ack = dropped[dropped.length - 1].s; }
    const out = q.splice(0, q.length > 8 ? 4 : q.length > 2 ? 2 : q.length);
    if (out.length) { p.last = out[out.length - 1]; p.ack = p.last.s; }
    return out;
  }

  ev(...e) { this.events.push(e); }

  // ---------- main tick
  update() {
    this.tick++;
    if (this.phase === 'intermission' && this.tick >= this.phaseUntil) this.resetMatch();

    for (const p of this.players.values()) {
      const inputs = this.takeInputs(p);
      if (!p.alive) {
        if (this.phase === 'play' && this.tick >= p.respawnAt) this.spawn(p);
        continue;
      }
      if (this.phase !== 'play') continue;
      for (const inp of inputs) {
        const out = this.phys.step(p, inp);
        if (out.pad >= 0) this.ev(EV.PAD, p.id, out.pad);
        if (out.walljump) this.ev(EV.WALLJUMP, p.id);
        if (out.hook === 'hit') this.ev(EV.HOOK, p.id, r2(p.hx), r2(p.hy), r2(p.hz));
        if (M.stepWeapon(p, inp)) this.fire(p, inp);
        if (this.phys.fellIntoVoid(p)) { this.kill(p, p.lastAttacker && this.tick - p.hurtAt < 300 ? p.lastAttacker : null, 1); break; }
        this.touchFlags(p);
        if (!p.alive) break;
      }
      if (!p.alive) continue;
      this.phys.record(p, this.tick);
      if (this.tick - p.hurtAt > C.REGEN_DELAY && p.hp < C.HP) p.hp = Math.min(C.HP, p.hp + C.REGEN_PER_TICK);
    }

    for (const f of this.flags) {
      if (f.state === FLAG.CARRIED && f.carrier) { f.x = f.carrier.x; f.y = f.carrier.y; f.z = f.carrier.z; }
      if (f.state === FLAG.DROPPED && this.tick >= f.returnAt) this.returnFlag(f, null);
    }
    if (this.phase === 'play' && this.tick >= this.matchEnd) this.endMatch(this.caps[0] === this.caps[1] ? -1 : this.caps[0] > this.caps[1] ? 0 : 1);
    if (this.tick % C.SNAPSHOT_EVERY === 0) this.broadcast();
  }

  // ---------- tagger
  fire(p, inp) {
    p.firedAt = this.tick;
    const ey = p.y + M.eyeOf(p), d = M.aimDir(inp.yaw, inp.pitch);
    const o = [p.x, ey, p.z];
    const when = Math.max(this.tick - C.LAGCOMP_MAX, Math.min(this.tick, Number.isFinite(inp.rt) ? inp.rt : this.tick));
    const h = this.phys.trace(o, d, C.TAGGER_RANGE, when, this.players.values(), q => q !== p && q.alive && q.team !== p.team);
    this.ev(EV.SHOT, p.id, r2(o[0]), r2(o[1]), r2(o[2]), r2(o[0] + d[0] * h.t), r2(o[1] + d[1] * h.t), r2(o[2] + d[2] * h.t), h.player ? 1 : 0);
    if (h.player) this.damage(h.player, C.TAGGER_DMG, p);
  }

  damage(victim, amount, attacker) {
    if (!victim.alive || this.phase !== 'play') return;
    if (this.tick - victim.spawnTick < C.SPAWN_PROTECT) return;
    victim.hp -= amount;
    victim.hurtAt = this.tick;
    victim.lastAttacker = attacker;
    this.ev(EV.HIT, attacker ? attacker.id : 0, victim.id, amount);
    if (victim.hp <= 0) this.kill(victim, attacker, 0);
  }

  /** cause 0 = tagged, 1 = fell into the void (credited to whoever hit them last, if recent). */
  kill(victim, killer, cause) {
    if (!victim.alive) return;
    victim.alive = false;
    victim.hp = 0;
    victim.deaths++;
    victim.respawnAt = this.tick + C.RESPAWN_TICKS;
    victim.hook = false;
    if (killer && this.players.has(killer.id) && killer.team !== victim.team) killer.tags++; else killer = null;
    this.stats.tags++;
    this.ev(EV.KILL, killer ? killer.id : 0, victim.id, cause);
    if (victim.carry) this.dropFlag(victim, cause === 1);
    this.scoreDirty = true;
  }

  // ---------- flags
  enemyFlag(p) { return this.flags[1 - p.team]; }
  ownFlag(p) { return this.flags[p.team]; }

  touchFlags(p) {
    const near = (f, x, y, z, r) => Math.hypot(p.x - x, p.z - z) < r && p.y > y - 1.5 && p.y < y + 2;
    const enemy = this.enemyFlag(p), own = this.ownFlag(p);
    if ((enemy.state === FLAG.BASE || enemy.state === FLAG.DROPPED) && near(enemy, enemy.x, enemy.y, enemy.z, C.FLAG_RADIUS)) {
      enemy.state = FLAG.CARRIED; enemy.carrier = p; p.carry = true;
      this.ev(EV.FLAG_TAKE, p.id, enemy.team);
      this.scoreDirty = true;
    }
    if (own.state === FLAG.DROPPED && near(own, own.x, own.y, own.z, C.FLAG_RADIUS)) {
      p.returns++;
      this.returnFlag(own, p);
    }
    if (p.carry && own.state === FLAG.BASE && near(own, own.home[0], own.home[1], own.home[2], C.FLAG_RADIUS + 0.5)) this.capture(p);
  }

  dropFlag(p, overVoid) {
    const f = this.enemyFlag(p);
    p.carry = false;
    if (f.state !== FLAG.CARRIED || f.carrier !== p) return;
    const g = overVoid ? null : this.phys.groundBelow(p.x, p.y, p.z, 4);
    if (g === null) { this.returnFlag(f, null); return; }               // nothing under it: straight home
    Object.assign(f, { state: FLAG.DROPPED, carrier: null, x: p.x, y: g, z: p.z, returnAt: this.tick + C.FLAG_RETURN });
    this.ev(EV.FLAG_DROP, p.id, f.team, r2(f.x), r2(f.y), r2(f.z));
  }

  returnFlag(f, by) {
    if (f.carrier) f.carrier.carry = false;
    Object.assign(f, { state: FLAG.BASE, carrier: null, x: f.home[0], y: f.home[1], z: f.home[2], returnAt: 0 });
    this.ev(EV.FLAG_RETURN, f.team, by ? by.id : 0);
    this.scoreDirty = true;
  }

  capture(p) {
    const f = this.enemyFlag(p);
    p.carry = false;
    p.caps++;
    this.caps[p.team]++;
    this.stats.caps++;
    Object.assign(f, { state: FLAG.BASE, carrier: null, x: f.home[0], y: f.home[1], z: f.home[2], returnAt: 0 });
    this.ev(EV.CAPTURE, p.id, f.team);
    this.scoreDirty = true;
    this.hooks.lobbyChanged && this.hooks.lobbyChanged();
    if (this.caps[p.team] >= C.CAPTURE_LIMIT) this.endMatch(p.team);
  }

  endMatch(winner) {
    if (this.phase !== 'play') return;
    this.phase = 'intermission';
    this.winner = winner;
    this.phaseUntil = this.tick + C.INTERMISSION;
    this.ev(EV.WIN, winner);
    this.scoreDirty = true;
  }

  resetMatch() {
    this.phase = 'play';
    this.matchEnd = this.tick + C.TIME_LIMIT;
    this.caps = [0, 0];
    this.winner = -1;
    this.resetFlags();
    for (const p of this.players.values()) { p.tags = 0; p.deaths = 0; p.caps = 0; p.returns = 0; p.carry = false; p.alive = false; }
    for (const p of this.players.values()) this.spawn(p);
    this.hooks.lobbyChanged && this.hooks.lobbyChanged();
    this.scoreDirty = true;
  }

  // ---------- networking
  broadcastRoster() {
    const players = [...this.players.values()].map(p => ({ id: p.id, name: p.name, team: p.team, bot: p.bot ? 1 : 0 }));
    for (const p of this.players.values()) if (p.client) this.hooks.send(p.client, { t: 'roster', players, code: this.code });
  }

  broadcast() {
    const pl = [];
    for (const p of this.players.values()) {
      const bits = (this.tick - p.firedAt < 6 ? PF.FIRED : 0) | (p.crouch ? PF.CROUCH : 0) | (p.slide > 0 ? PF.SLIDE : 0) | (p.wrOn ? PF.WALLRUN : 0)
                 | (p.hook ? PF.HOOK : 0) | (p.carry ? PF.CARRY : 0) | (this.tick - p.spawnTick < C.SPAWN_PROTECT ? PF.PROTECT : 0);
      pl.push(p.id, r2(p.x), r2(p.y), r2(p.z), r3(p.yaw), r3(p.pitch), p.alive ? 1 : 0, bits,
              p.hook ? r2(p.hx) : 0, p.hook ? r2(p.hy) : 0, p.hook ? r2(p.hz) : 0, r2(Math.hypot(p.vx || 0, p.vz || 0)));
    }
    const fl = [];
    for (const f of this.flags) fl.push(f.state, f.carrier ? f.carrier.id : 0, r2(f.x), r2(f.y), r2(f.z), f.state === FLAG.DROPPED ? Math.ceil((f.returnAt - this.tick) / 60) : 0);
    const base = {
      t: 's', k: this.tick, ph: this.phase === 'play' ? 0 : 1, w: this.winner,
      tl: Math.max(0, Math.ceil(((this.phase === 'play' ? this.matchEnd : this.phaseUntil) - this.tick) / 60)),
      p: pl, f: fl, c: this.caps, ev: this.events,
    };
    if (this.scoreDirty || this.tick % 60 === 0) {
      base.sc = [];
      for (const p of this.players.values()) base.sc.push(p.id, p.tags, p.deaths, p.caps, p.returns);
      this.scoreDirty = false;
    }
    for (const p of this.players.values()) {
      if (!p.client) continue;
      const me = [...M.packState(p), Math.ceil(p.hp), p.alive ? 1 : 0, Math.max(0, Math.ceil((p.respawnAt - this.tick) / 60)), p.team];
      this.hooks.send(p.client, { ...base, a: p.ack, me });
    }
    this.events = [];
  }
}

module.exports = { GameRoom };
