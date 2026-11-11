'use strict';
/**
 * Half-Life Web Deathmatch - one authoritative room (up to 10 players, humans + bots).
 *
 * 60 Hz: every tick each player's queued inputs are applied exactly once and in order (one per
 * tick, two when catching up) with the shared Movement code, so the browser's replay of its own
 * unacknowledged inputs reproduces the server. Hitscan is lag-compensated: targets are rewound to
 * the tick the shooter was rendering (`rt` in the input, clamped to 250 ms). Projectiles,
 * explosions, damage, armor, pickups, props, respawns and the scoreboard all live here.
 * Snapshots go out at 30 Hz.
 */
const crypto = require('crypto');
const { C, TEAMS, PRIMARIES, BTN, WEAPONS, NUM_WEAPONS, KILL_BARREL, SKINS, GRENADE, HEG, BARREL, PICKUP_RESPAWN, PROP_HP, PROP_RESPAWN, PROJ, EV, COLORS, SLOT } = require('../shared/Constants.js');
const M = require('../shared/Movement.js');
const { MAPS, IDS, DEFAULT } = require('../shared/MapData.js');
const Weapons = require('./WeaponRegistry.js');
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

/** Outward normal of the face of box b nearest to (x, y, z). */
function boxNormal(b, x, y, z) {
  const c = [[Math.abs(x - b.x0), [-1, 0, 0]], [Math.abs(x - b.x1), [1, 0, 0]], [Math.abs(y - b.y0), [0, -1, 0]],
             [Math.abs(y - b.y1), [0, 1, 0]], [Math.abs(z - b.z0), [0, 0, -1]], [Math.abs(z - b.z1), [0, 0, 1]]];
  c.sort((a, b2) => a[0] - b2[0]);
  return c[0][1];
}

const BOT_NAMES = ['Barney', 'Gordon', 'Gina', 'Colette', 'Otis', 'Eli', 'Kleiner', 'Magnusson', 'Shephard', 'Rosenberg', 'Calhoun', 'Keller'];

class GameRoom {
  constructor(code, hooks, opts = {}) {
    this.code = code;
    this.hooks = hooks;              // { send(client, msg) }
    this.rng = makeRng();
    this.tick = 0;
    this.players = new Map();        // pid -> player
    this.byClient = new Map();       // client -> player
    this.nextPid = 1;
    this.projectiles = [];
    this.nextProj = 1;
    this.items = [];                 // dropped weapons lying in the world
    this.nextItem = 1;
    this.events = [];
    this.setMap(IDS.includes(opts.map) ? opts.map : DEFAULT);
    this.phase = 'play';
    this.matchEnd = C.TIME_LIMIT;
    this.phaseUntil = 0;
    this.scoreDirty = true;
    this.createdAt = Date.now();
    this.stats = { kills: 0, peakPlayers: 0 };
    this.botLevel = opts.botLevel || 'normal';
    // 'dm' = free-for-all deathmatch, 'team' = CS-style team elimination in rounds
    this.mode = opts.mode === 'team' ? 'team' : 'dm';
    this.round = 0; this.rphase = 'live'; this.rphaseUntil = 0; this.roundEnd = 0; this.teamWins = [0, 0]; this.lastWinner = -1;
    for (let i = 0; i < (opts.bots | 0); i++) this.addBot();
    if (this.mode === 'team') this.startRound(true);
  }

  /** Load a map: collision world, pickups, props and the bots' navigation graph. */
  setMap(id) {
    this.map = MAPS[id];
    this.world = M.makeWorld(this.map.BOXES, this.map.PROPS);
    this.staticWorld = M.makeWorld(this.map.BOXES, []);
    this.graph = graphFor(this.map);
    this.pickups = this.map.PICKUPS.map((def, i) => ({ i, def, available: true, at: 0 }));
    this.props = this.world.props.map((b, i) => ({ i, b, hp: PROP_HP[b.type], at: 0 }));
    this.projectiles = [];
    this.items = [];
    for (const p of this.players.values()) if (p.brain) p.brain.route = [];
  }

  // ---------- lobby interface
  get humanCount() { let n = 0; for (const p of this.players.values()) if (!p.bot) n++; return n; }
  get size() { return this.players.size; }
  info() {
    let leader = null;
    for (const p of this.players.values()) if (!leader || p.kills > leader.kills) leader = p;
    if (this.mode === 'team') return { code: this.code, players: this.players.size, humans: this.humanCount, max: C.MAX_PLAYERS, map: this.map.name, mode: 'team',
                                       leader: `T ${this.teamWins[0]} : ${this.teamWins[1]} CT` };
    return { code: this.code, players: this.players.size, humans: this.humanCount, max: C.MAX_PLAYERS, map: this.map.name, mode: 'dm',
             leader: leader ? `${leader.name} ${leader.kills}` : '' };
  }

  addClient(client) {
    if (this.players.size >= C.MAX_PLAYERS) {
      const bots = [...this.players.values()].filter(p => p.bot);
      if (!bots.length) return false;
      if (this.mode === 'team') bots.sort((a, b) => this.teamSize(b.team) - this.teamSize(a.team));
      this.removePlayer(bots[0]);                     // humans bump bots (from the bigger team)
    }
    const p = this.createPlayer(client.name, client, false);
    this.byClient.set(client, p);
    this.hooks.send(client, { t: 'joined', code: this.code, you: p.id, tick: this.tick, map: this.map.id, mode: this.mode, team: p.team });
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
    const name = 'BOT ' + (BOT_NAMES.find(n => !used.has('BOT ' + n)) || 'Drone' + this.nextPid);
    const p = this.createPlayer(name, null, true);
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
    this.projectiles = this.projectiles.filter(pr => pr.owner !== p);
    this.broadcastRoster();
    this.scoreDirty = true;
  }

  createPlayer(name, client, bot) {
    const used = new Set([...this.players.values()].map(q => q.color));
    const color = [...Array(COLORS.length).keys()].find(i => !used.has(i)) ?? 0;
    const wanted = client ? client.skin | 0 : -1;
    const skin = wanted >= 0 && wanted < SKINS.length ? wanted : Math.floor(this.rng() * SKINS.length);
    const p = { id: this.nextPid++, name, client, bot, color, skin, kills: 0, deaths: 0, team: -1, loadout: 0,
                queue: [], lastSeq: 0, ack: 0, last: { m: 0, yaw: 0, pitch: 0, b: 0, w: 0, rt: 0 }, hist: [],
                alive: false, respawnAt: 0, spawnTick: 0, firedAt: -99 };
    if (this.mode === 'team') this.setTeam(p, this.teamSize(1) < this.teamSize(0) ? 1 : 0);
    this.players.set(p.id, p);
    if (this.mode === 'team') {
      M.giveDefaultLoadout(p);
      if (this.rphase === 'freeze') this.spawn(p);
      else { Object.assign(p, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: true, crouch: false, yaw: 0, pitch: 0, hp: 0, armor: 0, alive: false, respawnAt: Infinity }); }
    } else this.spawn(p);
    this.stats.peakPlayers = Math.max(this.stats.peakPlayers, this.players.size);
    this.scoreDirty = true;
    return p;
  }

  teamSize(t) { let n = 0; for (const q of this.players.values()) if (q.team === t) n++; return n; }
  setTeam(p, t) {
    p.team = t;
    const T = TEAMS[t], n = [...this.players.values()].filter(q => q.team === t && q !== p).length;
    p.color = t;                                   // COLORS[0] orange / COLORS[1] blue
    p.skin = T.skins[n % T.skins.length];
  }

  spawn(p, keepGear = false) {
    // deathmatch: the spawn point farthest from living enemies; teams: a free spot in the team's base
    const list = this.mode === 'team' ? this.map.TEAM_SPAWNS[p.team] : this.map.SPAWNS;
    const scored = list.map(s => {
      let near = Infinity;
      for (const q of this.players.values()) {
        if (q === p || !q.alive) continue;
        const d = Math.hypot(q.x - s.x, q.y - s.y, q.z - s.z);
        near = Math.min(near, this.mode === 'team' ? (d < 1.2 ? -10 : 5) : d);
      }
      return { s, score: near + this.rng() * 4 };
    }).sort((a, b) => b.score - a.score);
    const s = scored[0].s;
    Object.assign(p, { x: s.x, y: s.y, z: s.z, vx: 0, vy: 0, vz: 0, onGround: true, crouch: false, yaw: s.yaw, pitch: 0, hp: C.HP, armor: 0, alive: true,
                       spawnTick: this.tick, lastAttacker: null });
    if (!keepGear) M.giveDefaultLoadout(p);
    p.reloadT = 0; p.switchT = 0; p.cool = 0; p.spray = 0;
    p.hist = [];
    this.ev(EV.SPAWN, p.id);
  }

  onMessage(client, m) {
    const p = this.byClient.get(client);
    if (!p) return;
    if (m.t === 'i') this.onInput(p, m);
    else if (m.t === 'addbot') { if (this.addBot(m.level)) this.hooks.lobbyChanged && this.hooks.lobbyChanged(); }
    else if (m.t === 'kickbot') { this.removeBot(); this.hooks.lobbyChanged && this.hooks.lobbyChanged(); }
    else if (m.t === 'loadout') this.chooseLoadout(p, m.w | 0);
    else if (m.t === 'team' && this.mode === 'team') this.switchTeam(p);
  }

  /** Free "buy" menu (team mode): the chosen primary is handed out now (during buy time) and every round. */
  chooseLoadout(p, w) {
    if (!PRIMARIES.includes(w)) return;
    p.loadout = w;
    if (this.mode !== 'team' || !p.alive) return;
    const buyTime = this.rphase === 'freeze' || (this.rphase === 'live' && this.tick - this.roundStartTick < C.BUY_TICKS);
    if (buyTime) this.giveLoadout(p, true);
  }

  giveLoadout(p, replace) {
    const want = p.loadout || (p.team === 0 ? 9 : 10);
    const cur = M.inSlot(p, SLOT.PRIMARY);
    if (cur && (!replace || cur === want)) { if (cur === want) { const d = WEAPONS[cur]; p.res[cur] = d.maxReserve; } }
    else {
      if (cur) { p.owned &= ~(1 << cur); p.mag[cur] = 0; p.res[cur] = 0; }
      const d = WEAPONS[want];
      p.owned |= 1 << want; p.mag[want] = d.mag; p.res[want] = d.maxReserve;
      p.prev = p.cur; p.cur = want; p.switchT = C.SWITCH_TICKS; p.reloadT = 0; p.spray = 0;
    }
    if (!M.owns(p, 11)) { p.owned |= 1 << 11; p.mag[11] = 1; }
    p.armor = Math.max(p.armor, 100);
  }

  switchTeam(p) {
    const other = 1 - p.team;
    if (this.teamSize(other) > this.teamSize(p.team)) return;                 // keep the teams even
    const bot = [...this.players.values()].find(q => q.bot && q.team === other);
    if (this.teamSize(other) >= this.teamSize(p.team) && bot) this.setTeam(bot, p.team);
    this.setTeam(p, other);
    if (p.alive) { p.alive = false; p.respawnAt = Infinity; this.ev(EV.KILL, 0, p.id, 0, 0); this.checkElimination(); }
    this.broadcastRoster();
    this.scoreDirty = true;
  }

  // ---------- team elimination rounds
  /** New round: everyone back to their base; survivors keep their guns, the dead start over. */
  startRound(fresh) {
    this.round = fresh ? 1 : this.round + 1;
    this.rphase = 'freeze';
    this.rphaseUntil = this.tick + C.FREEZE_TICKS;
    this.roundStartTick = this.rphaseUntil;
    this.projectiles = []; this.items = [];
    for (const k of this.pickups) k.available = true;
    for (const pr of this.props) { pr.b.alive = true; pr.hp = PROP_HP[pr.b.type]; }
    for (const p of this.players.values()) {
      const keep = !fresh && p.alive;
      this.spawn(p, keep);
      this.giveLoadout(p, false);
      if (p.brain) p.brain.route = [];
    }
    this.ev(EV.ROUND_START, this.round);
    this.scoreDirty = true;
    this.hooks.lobbyChanged && this.hooks.lobbyChanged();
  }

  aliveCount(t) { let n = 0; for (const q of this.players.values()) if (q.team === t && q.alive) n++; return n; }

  checkElimination() {
    if (this.mode !== 'team' || this.rphase !== 'live') return;
    const a0 = this.aliveCount(0), a1 = this.aliveCount(1);
    if (a0 && a1) return;
    if (!this.teamSize(0) || !this.teamSize(1)) return;                     // nobody to fight: play on until time runs out
    this.endRound(a0 === a1 ? -1 : a0 ? 0 : 1, 0);
  }

  endRound(winner, reason) {
    this.rphase = 'end';
    this.rphaseUntil = this.tick + C.ROUND_END_TICKS;
    this.lastWinner = winner;
    if (winner >= 0) this.teamWins[winner]++;
    this.ev(EV.ROUND, winner, reason);
    this.scoreDirty = true;
    this.hooks.lobbyChanged && this.hooks.lobbyChanged();
  }

  updateRound() {
    if (this.mode !== 'team' || this.phase !== 'play') return;
    if (this.rphase === 'freeze' && this.tick >= this.rphaseUntil) { this.rphase = 'live'; this.roundEnd = this.tick + C.ROUND_TICKS; }
    else if (this.rphase === 'live') {
      this.checkElimination();
      if (this.rphase === 'live' && this.tick >= this.roundEnd) {                // time: more survivors wins
        const a0 = this.aliveCount(0), a1 = this.aliveCount(1);
        this.endRound(a0 === a1 ? -1 : a0 > a1 ? 0 : 1, 1);
      }
    } else if (this.rphase === 'end' && this.tick >= this.rphaseUntil) {
      if (Math.max(...this.teamWins) >= C.ROUNDS_TO_WIN) this.endMatch();
      else this.startRound(false);
    }
  }

  onInput(p, m) {
    const s = m.s | 0;
    if (s <= p.lastSeq) return;
    p.lastSeq = s;
    const yaw = Number(m.y), pitch = Number(m.p), rt = Number(m.rt);
    p.queue.push({ s, m: (m.m | 0) & 63, yaw: Number.isFinite(yaw) ? yaw : p.last.yaw, pitch: Number.isFinite(pitch) ? pitch : p.last.pitch,
                   b: (m.b | 0) & 31, w: (m.w | 0) >= 1 && (m.w | 0) <= NUM_WEAPONS ? m.w | 0 : 0, rt: Number.isFinite(rt) ? rt : this.tick });
    if (p.queue.length > 90) p.queue.shift();
  }

  /**
   * Inputs applied this tick: each exactly once, in order. A backlog (a slow frame on the client
   * sends a burst) is drained faster instead of dropped, so no click is ever lost; only more than
   * a second of backlog is discarded.
   */
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
        if (this.phase === 'play' && this.mode === 'dm' && this.tick >= p.respawnAt) this.spawn(p);
        continue;
      }
      if (this.phase !== 'play' || (this.mode === 'team' && this.rphase === 'freeze')) continue;
      for (const inp of inputs) {
        M.stepMove(p, inp, this.world);
        const shot = M.stepWeapon(p, inp);
        if (shot && shot.kind === 'drop') this.throwItem(p, shot);
        else if (shot) Weapons.fire(this, p, shot, inp);
        if (!p.alive) break;
      }
      p.hist.push([this.tick, p.x, p.y, p.z, p.crouch ? 1 : 0]);
      if (p.hist.length > 40) p.hist.shift();
      this.touchPickups(p);
      this.touchItems(p);
    }

    this.updateProjectiles();
    this.updateItems();
    this.updateRespawns();
    this.updateRound();
    if (this.phase === 'play' && this.mode === 'dm' && this.tick >= this.matchEnd) this.endMatch();
    if (this.tick % C.SNAPSHOT_EVERY === 0) this.broadcast();
  }

  // ---------- traces & damage
  /** Where was player q at (fractional) server tick t? -> [x, y, z, crouched] */
  posAt(q, t) {
    const h = q.hist;
    if (!h.length || t >= h[h.length - 1][0]) return [q.x, q.y, q.z, q.crouch ? 1 : 0];
    for (let i = h.length - 1; i > 0; i--) {
      if (h[i - 1][0] <= t) {
        const a = h[i - 1], b = h[i], f = (t - a[0]) / (b[0] - a[0] || 1);
        return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f, b[4]];
      }
    }
    return [h[0][1], h[0][2], h[0][3], h[0][4]];
  }

  /** Hitscan from `o` along unit `d`. Players are rewound to `rt`. Returns {t, player?, head?, prop?}. */
  /**
   * Hitscan from `o` along unit `d`, players rewound to `rt`. With `pen` > 0 (AK / M4 / AWP) the bullet
   * goes through walls thinner than its penetration budget: `walls` lists those passed before the hit.
   */
  trace(shooter, o, d, maxT, rt, pen = 0) {
    const when = Math.max(this.tick - C.LAGCOMP_MAX, Math.min(this.tick, Number.isFinite(rt) ? rt : this.tick));
    const wt = pen ? M.wallTrace(this.world, o[0], o[1], o[2], d[0], d[1], d[2], maxT, pen) : null;
    const wall = wt ? { t: wt.tEnd, box: wt.stopped } : M.raycast(this.world, o[0], o[1], o[2], d[0], d[1], d[2], maxT);
    let best = { t: wall.t, prop: wall.box && wall.box.type ? this.props[this.world.props.indexOf(wall.box)] : null, walls: [] };
    for (const q of this.players.values()) {
      if (q === shooter || !q.alive) continue;
      const [x, y, z, cr] = this.posAt(q, when);
      const hb = M.hitboxes(x, y, z, cr);
      const th = M.rayBox(o[0], o[1], o[2], d[0], d[1], d[2], hb.head, best.t);
      const tb = M.rayBox(o[0], o[1], o[2], d[0], d[1], d[2], hb.body, best.t);
      if (th < best.t && th <= tb) best = { t: th, player: q, head: true };
      else if (tb < best.t) best = { t: tb, player: q, head: false };
    }
    best.walls = wt ? wt.walls.filter(w => w.tOut < best.t) : [];
    return best;
  }

  damage(victim, amount, attacker, weapon, head) {
    if (!victim.alive || this.phase !== 'play' || amount <= 0) return;
    if (attacker && attacker !== victim && this.mode === 'dm' && this.tick - victim.spawnTick < C.SPAWN_PROTECT) return;
    if (this.mode === 'team' && attacker && attacker !== victim && attacker.team === victim.team) return;     // no friendly fire
    const absorb = Math.min(victim.armor, amount * C.ARMOR_ABSORB);
    victim.armor -= absorb;
    victim.hp -= amount - absorb;
    if (attacker && attacker !== victim) victim.lastAttacker = attacker;
    this.ev(EV.HIT, attacker ? attacker.id : 0, victim.id, Math.round(amount), head ? 1 : 0);
    if (victim.hp <= 0) this.kill(victim, attacker, weapon, head);
  }

  kill(victim, attacker, weapon, head) {
    victim.alive = false;
    victim.hp = 0;
    victim.deaths++;
    victim.respawnAt = this.mode === 'team' ? Infinity : this.tick + C.RESPAWN_TICKS;
    if (attacker && attacker !== victim) attacker.kills++;
    else victim.kills--;                                   // suicide costs a frag, as in HLDM
    this.dropOnDeath(victim);
    this.stats.kills++;
    this.ev(EV.KILL, attacker ? attacker.id : 0, victim.id, weapon || 0, head ? 1 : 0);
    this.scoreDirty = true;
    if (this.mode === 'team') this.checkElimination();
    else if (attacker && attacker.kills >= C.FRAG_LIMIT) this.endMatch();
  }

  damageProp(prop, amount, attacker) {
    if (!prop || !prop.b.alive) return;
    prop.hp -= amount;
    if (prop.hp > 0) return;
    prop.b.alive = false;
    prop.at = this.tick + PROP_RESPAWN;
    const b = prop.b, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, cz = (b.z0 + b.z1) / 2;
    this.ev(EV.PROP, prop.i, r2(cx), r2(cy), r2(cz));
    if (b.type === 'barrel') this.explode(cx, cy, cz, BARREL.dmg, BARREL.radius, attacker, KILL_BARREL);
  }

  explode(x, y, z, dmg, radius, owner, weapon) {
    this.ev(EV.BOOM, r2(x), r2(y), r2(z), radius);
    for (const q of this.players.values()) {
      if (!q.alive) continue;
      const cx = q.x - x, cy = q.y + 0.9 - y, cz = q.z - z, d = Math.hypot(cx, cy, cz);
      if (d >= radius) continue;
      if (d > 0.3 && M.raycast(this.world, x, y, z, cx / d, cy / d, cz / d, d).t < d - 0.4) continue;   // behind cover
      const full = dmg * (1 - d / radius);
      const amount = q === owner ? full * 0.6 : full;            // self damage is reduced, the push is not
      const k = full * 0.15, nx = d > 0.1 ? cx / d : 0, ny = d > 0.1 ? cy / d : 1, nz = d > 0.1 ? cz / d : 0;
      q.vx += nx * k; q.vz += nz * k; q.vy += Math.max(ny, 0.35) * k;
      q.onGround = false;
      this.damage(q, amount, owner, weapon, false);
    }
    for (const pr of this.props) {
      if (!pr.b.alive) continue;
      const b = pr.b, d = Math.hypot((b.x0 + b.x1) / 2 - x, (b.y0 + b.y1) / 2 - y, (b.z0 + b.z1) / 2 - z);
      if (d < radius) this.damageProp(pr, dmg * (1 - d / radius), owner);
    }
  }

  // ---------- projectiles
  spawnProjectile(type, owner, pos, dir, speed) {
    const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    this.projectiles.push({ id: this.nextProj++, type, owner, x: pos[0], y: pos[1], z: pos[2],
                            vx: dir[0] / l * speed, vy: dir[1] / l * speed, vz: dir[2] / l * speed, life: 60 * 8, fuse: HEG.fuse });
  }

  updateProjectiles() {
    const dt = C.DT, keep = [];
    for (const pr of this.projectiles) {
      if (pr.type === PROJ.HE) { if (this.stepHE(pr)) keep.push(pr); continue; }
      if (pr.type === PROJ.BOLT) pr.vy -= WEAPONS[6].boltGravity * dt;
      else if (pr.type === PROJ.GRENADE) pr.vy -= GRENADE.gravity * dt;
      const sp = Math.hypot(pr.vx, pr.vy, pr.vz), step = sp * dt;
      const d = [pr.vx / sp, pr.vy / sp, pr.vz / sp];
      const wall = M.raycast(this.world, pr.x, pr.y, pr.z, d[0], d[1], d[2], step);
      let hitT = wall.t, victim = null, head = false;
      for (const q of this.players.values()) {
        if (!q.alive || (q === pr.owner && pr.life > 60 * 8 - 10)) continue;   // don't hit the shooter on launch
        const hb = M.hitboxes(q.x, q.y, q.z, q.crouch);
        const th = M.rayBox(pr.x, pr.y, pr.z, d[0], d[1], d[2], hb.head, hitT), tb = M.rayBox(pr.x, pr.y, pr.z, d[0], d[1], d[2], hb.body, hitT);
        if (th < hitT && th <= tb) { hitT = th; victim = q; head = true; } else if (tb < hitT) { hitT = tb; victim = q; head = false; }
      }
      const hx = pr.x + d[0] * hitT, hy = pr.y + d[1] * hitT, hz = pr.z + d[2] * hitT;
      if (victim || hitT < step) {
        const owner = this.players.get(pr.owner.id) ? pr.owner : null;
        if (pr.type === PROJ.BOLT) {
          if (victim) this.damage(victim, WEAPONS[6].dmg * (head ? WEAPONS[6].head : 1), owner, 6, head);
          else if (wall.box && wall.box.type) this.damageProp(this.props[this.world.props.indexOf(wall.box)], WEAPONS[6].dmg, owner);
          this.ev(EV.BOLT_HIT, r2(hx), r2(hy), r2(hz), victim ? 1 : 0);
        } else if (pr.type === PROJ.ROCKET) {
          this.explode(hx - d[0] * 0.2, hy - d[1] * 0.2, hz - d[2] * 0.2, WEAPONS[7].dmg, WEAPONS[7].radius, owner, 7);
        } else {
          this.explode(hx - d[0] * 0.2, hy - d[1] * 0.2, hz - d[2] * 0.2, GRENADE.dmg, GRENADE.radius, owner, 4);
        }
        continue;
      }
      pr.x = hx; pr.y = hy; pr.z = hz;
      if (--pr.life > 0) keep.push(pr);
    }
    this.projectiles = keep;
  }

  /** HE grenade: ballistic, bounces off walls and floors, goes off when the fuse runs out. */
  stepHE(pr) {
    const dt = C.DT;
    if (--pr.fuse <= 0) {
      const owner = pr.owner && this.players.get(pr.owner.id) ? pr.owner : null;
      this.explode(pr.x, pr.y + 0.1, pr.z, HEG.dmg, HEG.radius, owner, 11);
      return false;
    }
    if (pr.rest) return true;
    pr.vy -= HEG.gravity * dt;
    const sp = Math.hypot(pr.vx, pr.vy, pr.vz), step = sp * dt;
    if (sp < 0.05) { pr.rest = true; return true; }
    const d = [pr.vx / sp, pr.vy / sp, pr.vz / sp];
    const h = M.raycast(this.world, pr.x, pr.y, pr.z, d[0], d[1], d[2], step + 0.08);
    if (h.box && h.t <= step + 0.08) {
      const t = Math.max(0, h.t - 0.08);
      pr.x += d[0] * t; pr.y += d[1] * t; pr.z += d[2] * t;
      const n = boxNormal(h.box, pr.x + d[0] * 0.08, pr.y + d[1] * 0.08, pr.z + d[2] * 0.08);
      const vn = pr.vx * n[0] + pr.vy * n[1] + pr.vz * n[2];
      pr.vx = (pr.vx - 2 * vn * n[0]) * HEG.bounce; pr.vy = (pr.vy - 2 * vn * n[1]) * HEG.bounce; pr.vz = (pr.vz - 2 * vn * n[2]) * HEG.bounce;
      if (Math.abs(vn) > 2) this.ev(EV.BOUNCE, Math.round(pr.x * 100) / 100, Math.round(pr.y * 100) / 100, Math.round(pr.z * 100) / 100);
      if (n[1] > 0.7 && Math.hypot(pr.vx, pr.vy, pr.vz) < 1) { pr.rest = true; pr.vx = pr.vy = pr.vz = 0; }
    } else { pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.z += pr.vz * dt; }
    if (pr.y < -30) return false;
    return true;
  }

  // ---------- pickups, props, match flow
  touchPickups(p) {
    for (const k of this.pickups) {
      if (!k.available) continue;
      const [x, y, z] = k.def.pos;
      if (Math.abs(p.x - x) > 0.9 || Math.abs(p.z - z) > 0.9 || p.y > y + 1 || p.y + M.heightOf(p) < y) continue;
      if (this.applyPickup(p, k.def)) {
        k.available = false;
        k.at = this.tick + PICKUP_RESPAWN[k.def.type];
        this.ev(EV.PICKUP, p.id, k.i);
      }
    }
  }

  applyPickup(p, def) {
    if (def.type === 'health') { if (p.hp >= C.MAX_HP) return false; p.hp = Math.min(C.MAX_HP, p.hp + def.amt); return true; }
    if (def.type === 'battery') { if (p.armor >= C.MAX_ARMOR) return false; p.armor = Math.min(C.MAX_ARMOR, p.armor + def.amt); return true; }
    if (def.type === 'ammo') {
      let took = false;
      for (let w = 2; w <= NUM_WEAPONS; w++) {
        if (!M.owns(p, w) || WEAPONS[w].grenade) continue;
        const d = WEAPONS[w], before = p.res[w] | 0;
        p.res[w] = Math.min(d.maxReserve, before + d.pickup);
        if (p.res[w] > before) took = true;
      }
      if (M.owns(p, 4) && p.alt < WEAPONS[4].altMax) { p.alt = Math.min(WEAPONS[4].altMax, p.alt + 1); took = true; }
      return took;
    }
    const w = def.w, d = WEAPONS[w];
    return this.giveWeapon(p, w, d.grenade ? 1 : d.mag, d.grenade ? 0 : d.pickup, true);
  }

  /**
   * Counter-Strike rules: one long gun, one pistol. A weapon whose slot is taken is not picked up
   * (press G to drop yours first) - unless it is the same gun, then its ammo is taken.
   * Bots swap automatically when the new gun is better than the one they carry.
   */
  giveWeapon(p, w, mag, res, fromMap) {
    const d = WEAPONS[w];
    let how = M.canTake(p, w);
    if (!how && p.bot && d.slot === SLOT.PRIMARY) {
      const cur = M.inSlot(p, SLOT.PRIMARY);
      if (p.brain && p.brain.rank(w) < p.brain.rank(cur)) { this.dropWeapon(p, cur, 4); how = 'new'; }
    }
    if (!how) return false;
    if (d.grenade) {
      p.owned |= 1 << w;
      p.mag[w] = Math.min(HEG.max, (p.mag[w] | 0) + Math.max(1, mag));
      return true;
    }
    if (how === 'new') {
      p.owned |= 1 << w;
      p.mag[w] = Math.min(d.mag, mag);
      p.res[w] = Math.min(d.maxReserve, res);
      if (w === 4 && fromMap) p.alt = Math.min(d.altMax, p.alt + d.altPickup);
      if (p.bot || (d.slot === SLOT.PRIMARY && M.slotOf(p.cur) !== SLOT.PRIMARY && p.switchT === 0 && p.reloadT === 0)) {
        p.prev = p.cur; p.cur = w; p.switchT = C.SWITCH_TICKS; p.spray = 0;          // pick up a rifle -> hold it
      }
      return true;
    }
    const before = p.res[w] | 0;
    p.res[w] = Math.min(d.maxReserve, before + mag + res);
    if (w === 4 && fromMap && p.alt < d.altMax) { p.alt = Math.min(d.altMax, p.alt + d.altPickup); return true; }
    return p.res[w] > before;
  }

  // ---------- dropped weapons (G, or on death)
  /** Throw weapon w out of p's hands (it keeps its ammo). Used for G (via stepWeapon) and bot swaps. */
  dropWeapon(p, w, speed = 6) {
    if (!M.owns(p, w)) return;
    const shot = { w, mag: p.mag[w] | 0, res: p.res[w] | 0 };
    p.owned &= ~(1 << w); p.mag[w] = 0; p.res[w] = 0;
    if (p.cur === w) { p.cur = M.bestWeapon(p); p.switchT = C.SWITCH_TICKS; p.reloadT = 0; p.spray = 0; }
    this.throwItem(p, shot, speed);
  }

  throwItem(p, shot, speed = 6) {
    const d = M.aimDir(p.yaw, Math.min(0.3, p.pitch) + 0.2), ey = p.y + M.eyeOf(p) - 0.3;
    this.spawnItem(shot.w, shot.mag, shot.res, p.x + d[0] * 0.5, ey, p.z + d[2] * 0.5,
                   p.vx * 0.5 + d[0] * speed, d[1] * speed + 1.5, p.vz * 0.5 + d[2] * speed, p);
    this.ev(EV.DROP, p.id, shot.w);
  }

  spawnItem(w, mag, res, x, y, z, vx, vy, vz, owner) {
    if (this.items.length >= C.MAX_ITEMS) this.items.shift();
    this.items.push({ id: this.nextItem++, w, mag, res, x, y, z, vx, vy, vz, rest: false, born: this.tick, owner: owner ? owner.id : 0 });
  }

  /** On death: drop the long gun (or the pistol if there is none), as in CS. */
  dropOnDeath(p) {
    const w = M.inSlot(p, SLOT.PRIMARY) || (M.inSlot(p, SLOT.PISTOL) !== 2 ? M.inSlot(p, SLOT.PISTOL) : 0);
    if (!w || (p.mag[w] | 0) + (p.res[w] | 0) <= 0) return;
    const a = this.rng() * Math.PI * 2;
    this.spawnItem(w, p.mag[w] | 0, p.res[w] | 0, p.x, p.y + 1, p.z, Math.sin(a) * 2 + p.vx * 0.3, 2.5, Math.cos(a) * 2 + p.vz * 0.3, null);
    p.owned &= ~(1 << w); p.mag[w] = 0; p.res[w] = 0;
  }

  /** Items fly, bounce once or twice, settle on the floor; they vanish after a minute. */
  updateItems() {
    const dt = C.DT;
    this.items = this.items.filter(it => this.tick - it.born < C.ITEM_LIFE);
    for (const it of this.items) {
      if (it.rest) continue;
      it.vy -= 20 * dt;
      const sp = Math.hypot(it.vx, it.vy, it.vz), step = sp * dt;
      if (sp < 1e-3) { it.rest = true; continue; }
      const d = [it.vx / sp, it.vy / sp, it.vz / sp];
      const h = M.raycast(this.world, it.x, it.y, it.z, d[0], d[1], d[2], step + 0.12);
      if (h.box && h.t <= step + 0.12) {
        const t = Math.max(0, h.t - 0.12);
        it.x += d[0] * t; it.y += d[1] * t; it.z += d[2] * t;
        const n = boxNormal(h.box, it.x + d[0] * 0.12, it.y + d[1] * 0.12, it.z + d[2] * 0.12);
        const vn = it.vx * n[0] + it.vy * n[1] + it.vz * n[2];
        it.vx = (it.vx - 1.6 * vn * n[0]) * 0.45; it.vy = (it.vy - 1.6 * vn * n[1]) * 0.45; it.vz = (it.vz - 1.6 * vn * n[2]) * 0.45;
        if (n[1] > 0.7 && Math.abs(it.vy) < 1.5) { it.rest = true; it.vx = it.vy = it.vz = 0; it.y = h.box.y1 + 0.08; }
      } else { it.x += it.vx * dt; it.y += it.vy * dt; it.z += it.vz * dt; }
      if (it.y < -30) it.born = -1e9;
    }
  }

  touchItems(p) {
    if (!this.items.length) return;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (it.owner === p.id && this.tick - it.born < 45) continue;     // don't grab what you just threw
      if (Math.abs(p.x - it.x) > 0.9 || Math.abs(p.z - it.z) > 0.9 || it.y > p.y + 1.4 || it.y < p.y - 0.4) continue;
      if (this.giveWeapon(p, it.w, it.mag, it.res, false)) {
        this.ev(EV.PICKUP, p.id, -it.w);
        this.items.splice(i, 1); i--;
      }
    }
  }

  updateRespawns() {
    if (this.mode === 'dm') for (const k of this.pickups) if (!k.available && this.tick >= k.at) k.available = true;
    for (const pr of this.props) {
      if (pr.b.alive || this.tick < pr.at) continue;
      let occupied = false;
      for (const q of this.players.values()) if (q.alive && M.overlaps(q, pr.b)) occupied = true;
      if (!occupied) { pr.b.alive = true; pr.hp = PROP_HP[pr.b.type]; }
    }
  }

  endMatch() {
    if (this.phase !== 'play') return;
    this.phase = 'intermission';
    this.phaseUntil = this.tick + C.INTERMISSION;
    this.scoreDirty = true;
  }

  /** Next match: rotate to the next map, tell every browser, respawn everyone. */
  resetMatch() {
    this.phase = 'play';
    this.matchEnd = this.tick + C.TIME_LIMIT;
    this.setMap(IDS[(IDS.indexOf(this.map.id) + 1) % IDS.length]);
    for (const p of this.players.values()) if (p.client) this.hooks.send(p.client, { t: 'map', id: this.map.id, tick: this.tick });
    this.hooks.lobbyChanged && this.hooks.lobbyChanged();
    for (const p of this.players.values()) { p.kills = 0; p.deaths = 0; p.alive = false; }
    if (this.mode === 'team') { this.teamWins = [0, 0]; this.startRound(true); }
    else for (const p of this.players.values()) this.spawn(p);
    this.scoreDirty = true;
  }

  // ---------- networking
  broadcastRoster() {
    const players = [...this.players.values()].map(p => ({ id: p.id, name: p.name, color: p.color, skin: p.skin, bot: p.bot ? 1 : 0, team: p.team }));
    for (const p of this.players.values()) if (p.client) this.hooks.send(p.client, { t: 'roster', players, code: this.code });
  }

  bits(arr) { let m = 0; arr.forEach((on, i) => { if (on) m += 2 ** i; }); return m; }

  broadcast() {
    const pl = [];
    for (const p of this.players.values()) {
      const flags = (this.tick - p.firedAt < 6 ? 1 : 0) | (p.reloadT > 0 ? 2 : 0) | (this.tick - p.spawnTick < C.SPAWN_PROTECT ? 4 : 0) | (p.crouch ? 8 : 0);
      pl.push(p.id, r2(p.x), r2(p.y), r2(p.z), r3(p.yaw), r3(p.pitch), p.cur, p.alive ? 1 : 0, flags);
    }
    const pr = [];
    for (const q of this.projectiles) pr.push(q.id, q.type, r2(q.x), r2(q.y), r2(q.z), r2(q.vx), r2(q.vy), r2(q.vz));
    const base = {
      t: 's', k: this.tick, ph: this.phase === 'play' ? 0 : 1,
      tl: Math.max(0, Math.ceil(((this.phase === 'play' ? this.matchEnd : this.phaseUntil) - this.tick) / 60)),
      tm: this.mode === 'team' ? [['freeze', 'live', 'end'].indexOf(this.rphase), this.round, this.teamWins[0], this.teamWins[1], this.aliveCount(0), this.aliveCount(1),
                                   Math.max(0, Math.ceil(((this.rphase === 'live' ? this.roundEnd : this.rphaseUntil) - this.tick) / 60)), this.lastWinner,
                                   this.rphase === 'freeze' || (this.rphase === 'live' && this.tick - this.roundStartTick < C.BUY_TICKS) ? 1 : 0] : null,
      p: pl, pr, it: this.items.flatMap(it => [it.id, it.w, r2(it.x), r2(it.y), r2(it.z), it.rest ? 1 : 0]), pk: this.bits(this.pickups.map(k => k.available)), pp: this.bits(this.props.map(x => x.b.alive)), ev: this.events,
    };
    if (this.scoreDirty || this.tick % 60 === 0) {
      base.sc = [];
      for (const p of this.players.values()) base.sc.push(p.id, p.kills, p.deaths);
      this.scoreDirty = false;
    }
    for (const p of this.players.values()) {
      if (!p.client) continue;
      const me = [r3(p.x), r3(p.y), r3(p.z), r3(p.vx), r3(p.vy), r3(p.vz), p.onGround ? 1 : 0, Math.ceil(p.hp), Math.ceil(p.armor),
                  p.alive ? 1 : 0, p.cur, p.owned, p.alt, p.cool, p.reloadT, p.switchT,
                  Math.max(0, Math.ceil((p.respawnAt - this.tick) / 60)), p.crouch ? 1 : 0, r3(p.spray || 0), p.prev || 1];
      const mags = [], res = [];
      for (let w = 1; w <= NUM_WEAPONS; w++) { mags.push(p.mag[w] | 0); res.push(p.res[w] | 0); }
      this.hooks.send(p.client, { ...base, a: p.ack, me, mg: mags, rs: res });
    }
    this.events = [];
  }
}

module.exports = { GameRoom };
