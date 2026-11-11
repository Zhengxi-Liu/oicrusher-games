'use strict';
/**
 * Voxel Kart Racing - one authoritative race room (up to 8 karts, humans + bots).
 *
 * 60 Hz: each kart's queued inputs are applied exactly once and in order with the shared
 * physics (shared/KartPhysics.js), so a browser replaying its own unacknowledged inputs lands
 * where the server does. Everything the browser cannot predict lives here: item boxes and the
 * item roll (rubber-banded by position), shells / bananas / lightning, fireballs, kart-to-kart
 * bumps, rescues after falling off, progress / laps / ranking and the race flow
 * (countdown -> race -> results -> next race). Snapshots go out at 30 Hz.
 *
 * Plugs into game_server/RoomLobby.js (addClient / removeClient / onMessage / update / info).
 */
const crypto = require('crypto');
const { C, KEY, ITEM, ODDS, SURF, KF, EV } = require('../shared/Constants.js');
const TR = require('../shared/Tracks.js');
const P = require('../shared/KartPhysics.js');
const { AIController } = require('./AIController.js');

const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
const BOT_NAMES = ['Creeper', 'Pixel', 'Blocky', 'Cobble', 'Redstone', 'Emerald', 'Obsidian', 'Slime', 'Ender'];

function makeRng(seed = crypto.randomInt(1, 0x7fffffff)) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

class GameRoom {
  constructor(code, hooks, opts = {}) {
    this.code = code;
    this.hooks = hooks;                    // { send(client, msg), lobbyChanged() }
    this.rng = makeRng();
    this.tick = 0;
    this.track = TR.get(TR.IDS.includes(opts.map) ? opts.map : TR.IDS[0]);
    this.botLevel = opts.botLevel || 'normal';
    this.karts = new Map();                // id -> kart
    this.byClient = new Map();
    this.nextId = 1;
    this.events = [];
    this.shots = [];                       // shells and bananas
    this.boxes = this.track.boxes.map(b => ({ ...b, respawnAt: 0 }));
    this.stats = { races: 0, peak: 0 };
    this.results = null;
    for (let i = 0; i < Math.min(C.MAX_RACERS, opts.bots | 0); i++) this.addBot();
    this.startCountdown();
  }

  // ---------- lobby interface
  get humanCount() { let n = 0; for (const k of this.karts.values()) if (!k.bot) n++; return n; }
  get size() { return this.karts.size; }
  info() {
    const phase = this.phase === 'race' ? `racing · lap ${Math.max(1, Math.min(C.LAPS, Math.max(...[...this.karts.values()].map(k => k.lap), 1)))}/${C.LAPS}`
      : this.phase === 'countdown' ? 'starting' : 'results';
    return { code: this.code, players: this.karts.size, humans: this.humanCount, max: C.MAX_RACERS, map: this.track.name, leader: phase };
  }

  usedColors() { return new Set([...this.karts.values()].map(k => k.color)); }
  freeColor(pref) {
    const used = this.usedColors();
    if (pref >= 0 && pref < 8 && !used.has(pref)) return pref;
    for (let c = 0; c < 8; c++) if (!used.has(c)) return c;
    return 0;
  }

  addClient(client) {
    let replaced = null;
    if (this.karts.size >= C.MAX_RACERS) {
      const bots = [...this.karts.values()].filter(k => k.bot);
      if (!bots.length) return false;
      bots.sort((a, b) => b.rank - a.rank);            // the last-placed bot steps aside
      replaced = bots[0];
      this.removeKart(replaced);
    }
    const k = this.createKart(client.name, client, false, client.skin);
    if (replaced && this.phase === 'race') {
      // take over the bot's race: same spot, same progress
      for (const f of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'yaw', 'prog', 'lap', 'lastGood', 'ground']) k[f] = replaced[f];
    }
    this.byClient.set(client, k);
    this.hooks.send(client, { t: 'joined', code: this.code, you: k.id, track: this.track.id, tick: this.tick, color: k.color });
    this.broadcastRoster();
    this.stats.peak = Math.max(this.stats.peak, this.humanCount);
    return true;
  }

  removeClient(client) {
    const k = this.byClient.get(client);
    if (!k) return;
    this.byClient.delete(client);
    this.removeKart(k);
  }

  addBot(level) {
    if (this.karts.size >= C.MAX_RACERS) return false;
    const used = new Set([...this.karts.values()].map(k => k.name));
    const name = BOT_NAMES.find(n => !used.has(n)) || 'Bot' + this.nextId;
    const k = this.createKart(name, null, true, -1);
    k.brain = new AIController(this, k, level || this.botLevel);
    k.cap = k.brain.cfg.cap;
    this.broadcastRoster();
    return true;
  }

  removeBot() {
    const bots = [...this.karts.values()].filter(k => k.bot);
    if (bots.length) this.removeKart(bots[bots.length - 1]);
  }

  removeKart(k) {
    this.karts.delete(k.id);
    for (const s of this.shots) if (s.target === k) s.target = null;
    this.broadcastRoster();
  }

  createKart(name, client, bot, colorPref) {
    const k = { id: this.nextId++, name, client, bot, color: this.freeColor(colorPref | 0),
                queue: [], ack: 0, lastSeq: 0, item: ITEM.NONE, itemReady: 0, triple: 0,
                prog: 0, lap: 0, maxLap: 0, lastGood: 0, rank: this.karts.size + 1, finished: false, place: 0, finishTick: 0,
                lapStart: 0, bestLap: 0, hitBy: 0, bumpT: 0, cap: 1 };
    this.karts.set(k.id, k);
    this.placeOnGrid(k, this.karts.size - 1);
    return k;
  }

  placeOnGrid(k, slot) {
    const st = this.track.starts[Math.min(7, slot)];
    P.reset(k, st);
    const g = TR.groundAt(this.track, st.x, st.z);
    k.y = g.h;
    const si = g.seg >= 0 ? g.seg : this.track.nMain - 1;
    k.prog = this.track.S[si].prog - this.track.nMain;   // behind the line: lap 0 until it is crossed
    k.lap = 0; k.maxLap = 0; k.lastGood = si;
    k.item = ITEM.NONE; k.triple = 0; k.finished = false; k.place = 0; k.finishTick = 0; k.bestLap = 0;
  }

  onMessage(client, m) {
    const k = this.byClient.get(client);
    if (!k) return;
    if (m.t === 'i') {
      const s = m.s | 0;
      if (s <= k.lastSeq) return;
      k.lastSeq = s;
      k.queue.push({ s, keys: (m.k | 0) & 127 });
      if (k.queue.length > 90) k.queue.shift();
    } else if (m.t === 'addbot') { if (this.addBot(m.level)) this.hooks.lobbyChanged && this.hooks.lobbyChanged(); }
    else if (m.t === 'kickbot') { this.removeBot(); this.hooks.lobbyChanged && this.hooks.lobbyChanged(); }
  }

  /** Inputs applied this tick: each exactly once, in order; a backlog drains faster but is never dropped (< 1 s). */
  takeInputs(k) {
    if (k.bot || k.finished) {
      const brain = k.brain || (k.auto = k.auto || new AIController(this, k, 'normal', true));
      const inputs = k.bot ? [{ keys: brain.input() }] : [];
      if (!k.bot) {                                       // a finished human: drop their inputs, autopilot drives
        const q = k.queue.splice(0);
        if (q.length) k.ack = q[q.length - 1].s;
        inputs.push({ keys: brain.input() });
      }
      return inputs;
    }
    const q = k.queue;
    if (q.length > 60) { const dropped = q.splice(0, q.length - 8); k.ack = dropped[dropped.length - 1].s; }
    const out = q.splice(0, q.length > 8 ? 4 : q.length > 2 ? 2 : q.length);
    if (out.length) k.ack = out[out.length - 1].s;
    return out;
  }

  ev(...e) { this.events.push(e); }

  // ---------- race flow
  startCountdown() {
    this.phase = 'countdown';
    this.goTick = this.tick + C.COUNTDOWN;
    this.raceStart = this.goTick;
    this.firstFinish = 0;
    this.shots = [];
    for (const b of this.boxes) b.respawnAt = 0;
    // grid order: last race's results, otherwise join order
    const order = [...this.karts.values()].sort((a, b) => (a.place || 99) - (b.place || 99) || a.id - b.id);
    order.forEach((k, i) => { this.placeOnGrid(k, i); k.rank = i + 1; k.lapStart = this.goTick; });
    for (const k of this.karts.values()) { k.queue = []; }
    this.results = null;
    this.hooks.lobbyChanged && this.hooks.lobbyChanged();
  }

  endRace() {
    if (this.phase !== 'race') return;
    this.phase = 'results';
    this.resultsUntil = this.tick + C.RESULTS;
    this.updateRanks();
    let place = [...this.karts.values()].filter(k => k.finished).length;
    for (const k of [...this.karts.values()].sort((a, b) => a.rank - b.rank)) if (!k.finished) k.place = ++place;
    this.results = [...this.karts.values()].sort((a, b) => a.place - b.place)
      .map(k => [k.id, k.place, k.finished ? k.finishTick - this.raceStart : -1, k.bestLap]);
    this.stats.races++;
    const human = [...this.karts.values()].filter(k => !k.bot).map(k => `${k.name}#${k.place}`).join(' ');
    if (this.hooks.log) this.hooks.log(`race ${this.code} ${this.track.id} done: ${human}`);
    this.hooks.lobbyChanged && this.hooks.lobbyChanged();
  }

  // ---------- main tick
  update() {
    this.tick++;
    if (this.phase === 'countdown' && this.tick >= this.goTick) { this.phase = 'race'; this.ev(EV.GO); this.hooks.lobbyChanged && this.hooks.lobbyChanged(); }
    if (this.phase === 'results' && this.tick >= this.resultsUntil) this.startCountdown();

    const T = this.track;
    for (const k of this.karts.values()) {
      const inputs = this.takeInputs(k);
      if (this.phase === 'countdown') continue;          // frozen on the grid (inputs are consumed and acknowledged)
      for (const inp of inputs) {
        const keys = inp.keys;
        const itemPressed = (keys & KEY.ITEM) && !(k.keys & KEY.ITEM);
        const out = P.step(k, keys, T);
        if (out.turbo) this.ev(EV.TURBO, k.id, out.turbo);
        if (itemPressed && !k.finished && this.phase === 'race') this.useItem(k, keys);
        if (out.rescue) this.rescue(k);
        this.trackProgress(k);
      }
    }
    if (this.phase !== 'countdown') {
      this.collideKarts();
      this.updateShots();
      this.updateHazards();
      this.pickBoxes();
      this.updateRanks();
      if (this.phase === 'race') {
        const humans = [...this.karts.values()].filter(k => !k.bot);
        const allHumansDone = humans.length > 0 && humans.every(k => k.finished);
        const allDone = [...this.karts.values()].every(k => k.finished);
        if (allDone || allHumansDone && this.tick > this.firstFinish + 4 * 60 ||
            (this.firstFinish && this.tick > this.firstFinish + C.FINISH_GRACE) || this.tick > this.raceStart + C.RACE_LIMIT) this.endRace();
      }
    }
    if (this.tick % C.SNAPSHOT_EVERY === 0) this.broadcast();
  }

  /** Progress along the main loop (continuous: lap * samples + sample), laps and the finish. */
  trackProgress(k) {
    const T = this.track, N = T.nMain;
    const g = TR.groundAt(T, k.x, k.z);
    if (g.seg < 0 || k.rescue > 0) return;
    const s = T.S[g.seg];
    if (Math.abs(k.y - g.h) > 4) return;               // flying over another part of the track
    if (k.ground && g.surf !== SURF.JUMP) k.lastGood = g.seg;
    const cur = ((k.prog % N) + N) % N;
    let d = s.prog - cur;
    if (d > N / 2) d -= N; else if (d < -N / 2) d += N;
    if (Math.abs(d) > 80) return;
    k.prog += d;
    const lap = Math.floor(k.prog / N) + 1;
    k.lap = lap;
    if (lap > k.maxLap && lap >= 1) {
      if (k.maxLap >= 1 && this.phase === 'race') {
        const t = this.tick - k.lapStart;
        if (!k.bestLap || t < k.bestLap) k.bestLap = t;
        k.lapStart = this.tick;
        if (lap > C.LAPS && !k.finished) this.finish(k);
        else if (!k.finished) this.ev(EV.LAP, k.id, lap);
      }
      k.maxLap = lap;
    }
  }

  finish(k) {
    k.finished = true;
    k.place = [...this.karts.values()].filter(o => o.finished).length;
    k.finishTick = this.tick;
    k.item = ITEM.NONE; k.triple = 0;
    if (!this.firstFinish) this.firstFinish = this.tick;
    this.ev(EV.FINISH, k.id, k.place, this.tick - this.raceStart);
  }

  updateRanks() {
    const list = [...this.karts.values()].sort((a, b) =>
      (a.finished ? a.place : 99) - (b.finished ? b.place : 99) || b.prog - a.prog);
    list.forEach((k, i) => { k.rank = i + 1; });
  }

  rescue(k) {
    const T = this.track;
    const si = TR.rescueSample(T, k.lastGood);
    const s = T.S[si];
    k.x = s.x; k.z = s.z; k.y = s.y + 3.5; k.vx = k.vy = k.vz = 0; k.yaw = Math.atan2(s.tx, s.tz);
    k.ground = false; k.drift = 0; k.charge = 0; k.boost = 0; k.spin = 0;
    k.rescue = C.RESCUE_TICKS;
    this.ev(EV.RESCUE, k.id);
  }

  hit(k, by, cause, spin = C.SPIN_TICKS) {
    if (k.spin > 0 || k.rescue > 0 || k.finished) return false;
    k.spin = spin; k.drift = 0; k.charge = 0; k.boost = 0;
    this.ev(EV.HIT, k.id, by ? by.id : 0, cause);
    return true;
  }

  // ---------- items
  rollItem(k) {
    const n = this.karts.size;
    const frac = n > 1 ? (k.rank - 1) / (n - 1) : 0;
    const row = ODDS[Math.min(3, Math.floor(frac * 4))];
    const total = row.reduce((a, b) => a + b, 0);
    let r = this.rng() * total;
    for (let i = 0; i < row.length; i++) { r -= row[i]; if (r < 0) return i + 1; }
    return ITEM.GREEN;
  }

  pickBoxes() {
    this.boxes.forEach((b, i) => {
      if (b.respawnAt > this.tick) return;
      for (const k of this.karts.values()) {
        if (k.rescue > 0 || Math.hypot(k.x - b.x, k.z - b.z) > C.BOX_R + C.KART_R || Math.abs(k.y + 0.6 - b.y) > 2.4) continue;
        b.respawnAt = this.tick + C.BOX_RESPAWN;
        if (!k.item && !k.finished) {
          k.item = this.rollItem(k);
          k.triple = k.item === ITEM.TRIPLE ? 3 : 0;
          k.itemReady = this.tick + C.ITEM_ROULETTE;
        }
        this.ev(EV.BOX, k.id, i);
        break;
      }
    });
  }

  useItem(k, keys) {
    if (!k.item || this.tick < k.itemReady || k.rescue > 0) return;
    const it = k.item, fx = Math.sin(k.yaw), fz = Math.cos(k.yaw);
    const back = keys & KEY.DOWN;                      // hold brake to throw shells backwards
    this.ev(EV.USE, k.id, it);
    switch (it) {
      case ITEM.SHROOM: k.boost = Math.max(k.boost, C.SHROOM_TICKS); k.item = 0; break;
      case ITEM.TRIPLE: k.boost = Math.max(k.boost, C.SHROOM_TICKS); if (--k.triple <= 0) k.item = 0; break;
      case ITEM.BANANA: this.spawnShot(k, 'banana', -fx, -fz); k.item = 0; break;
      case ITEM.GREEN: this.spawnShot(k, 'green', back ? -fx : fx, back ? -fz : fz); k.item = 0; break;
      case ITEM.RED: {
        const target = back ? null : [...this.karts.values()].find(o => o.rank === k.rank - 1 && !o.finished);
        const s = this.spawnShot(k, target ? 'red' : 'green', back ? -fx : fx, back ? -fz : fz);
        if (s) s.target = target || null;
        k.item = 0; break;
      }
      case ITEM.LIGHTNING:
        for (const o of this.karts.values()) {
          if (o === k || o.finished || o.rank > k.rank) continue;
          o.shrink = C.LIGHTNING_TICKS; o.item = ITEM.NONE; o.triple = 0;
          this.hit(o, k, ITEM.LIGHTNING, 36);
        }
        this.ev(EV.LIGHTNING, k.id);
        k.item = 0; break;
    }
  }

  spawnShot(k, type, dx, dz) {
    if (this.shots.length >= C.MAX_HAZARDS) this.shots.shift();
    const off = type === 'banana' ? 2.3 : 2.1;
    const s = { id: this.tick * 16 + this.shots.length, type, owner: k, x: k.x + dx * off, y: k.y + 0.5, z: k.z + dz * off,
                vx: 0, vy: 0, vz: 0, born: this.tick, bounces: 0, target: null, si: k.lastGood, ground: true };
    if (type !== 'banana') {
      const sp = type === 'red' ? C.RED_SPEED : C.SHELL_SPEED;
      s.vx = dx * sp; s.vz = dz * sp;
    } else {
      const g = TR.groundAt(this.track, s.x, s.z);
      if (g.h < k.y - 3) return null;                     // nothing to land on behind us
      s.y = Math.max(g.h, k.y - 1);
    }
    this.shots.push(s);
    return s;
  }

  updateShots() {
    const T = this.track, dt = C.DT;
    const dead = new Set();
    for (const s of this.shots) {
      if (s.type === 'banana') {
        if (this.tick - s.born > 60 * 60) dead.add(s);
        continue;
      }
      if (this.tick - s.born > C.SHELL_LIFE) { dead.add(s); continue; }
      // red shells: follow the road until close, then home in
      if (s.type === 'red' && s.target && this.karts.has(s.target.id)) {
        const t = s.target, dist = Math.hypot(t.x - s.x, t.z - s.z);
        let ax = t.x, az = t.z;
        if (dist > 22) {
          for (let n = 0; n < 8; n++) { const p = T.S[s.si]; if ((s.x - p.x) * p.tx + (s.z - p.z) * p.tz < -4) break; s.si = p.next; }
          const p = T.S[s.si]; ax = p.x + p.tx * 6; az = p.z + p.tz * 6;
        }
        const want = Math.atan2(ax - s.x, az - s.z), cur = Math.atan2(s.vx, s.vz);
        const d = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
        const turn = Math.max(-5 * dt, Math.min(5 * dt, d)), a = cur + turn, sp = Math.hypot(s.vx, s.vz);
        s.vx = Math.sin(a) * sp; s.vz = Math.cos(a) * sp;
      }
      // move in two halves, bouncing off walls one axis at a time
      for (let sub = 0; sub < 2; sub++) {
        const nx = s.x + s.vx * dt / 2, nz = s.z + s.vz * dt / 2;
        const wall = (x, z) => { const g = TR.groundAt(T, x, z); return g.surf === SURF.WALL ? s.y < g.h : g.h > s.y + 0.8; };
        if (wall(nx, s.z)) { s.vx = -s.vx; s.bounces++; } else s.x = nx;
        if (wall(s.x, nz)) { s.vz = -s.vz; s.bounces++; } else s.z = nz;
      }
      if (s.bounces > C.SHELL_BOUNCES) { dead.add(s); continue; }
      const g = TR.groundAt(T, s.x, s.z);
      if (g.h > s.y - 1.2 && g.h <= s.y + 0.8) { s.y = g.h + 0.45; s.vy = 0; }        // hugging the road
      else { s.vy -= C.GRAVITY * dt; s.y += s.vy * dt; }
      if (s.y < C.VOID_Y || (g.surf === SURF.LAVA && s.y < g.h + 0.5)) dead.add(s);
    }
    // shots against karts and each other
    for (const s of this.shots) {
      if (dead.has(s)) continue;
      const r = s.type === 'banana' ? C.BANANA_R : C.SHELL_R;
      for (const k of this.karts.values()) {
        if (k.rescue > 0 || (k === s.owner && this.tick - s.born < 30 && s.bounces === 0)) continue;
        if (Math.hypot(k.x - s.x, k.z - s.z) > C.KART_R + r || Math.abs(k.y + 0.5 - s.y) > 1.6) continue;
        this.hit(k, s.owner, s.type === 'banana' ? ITEM.BANANA : s.type === 'red' ? ITEM.RED : ITEM.GREEN, s.type === 'banana' ? 50 : C.SPIN_TICKS);
        dead.add(s);                                       // the shot breaks even on a kart that is already spinning
        break;
      }
      if (dead.has(s)) continue;
      for (const o of this.shots) {
        if (o === s || dead.has(o)) continue;
        if (Math.hypot(o.x - s.x, o.z - s.z) < 1.3 && Math.abs(o.y - s.y) < 1.2) { dead.add(s); dead.add(o); break; }
      }
    }
    if (dead.size) this.shots = this.shots.filter(s => !dead.has(s));
  }

  updateHazards() {
    const T = this.track;
    for (const hz of T.hazards) {
      const p = TR.hazardPos(T, hz, this.tick);
      for (const k of this.karts.values()) {
        if (Math.hypot(k.x - p.x, k.z - p.z) < 1.7 && Math.abs(k.y + 0.6 - p.y) < 1.8) this.hit(k, null, 99, 50);
      }
    }
  }

  /** Karts push each other apart; a full-size kart flattens a shrunken one. */
  collideKarts() {
    const list = [...this.karts.values()].filter(k => k.rescue <= 0);
    const T = this.track;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const ra = a.shrink > 0 ? C.KART_R * 0.55 : C.KART_R, rb = b.shrink > 0 ? C.KART_R * 0.55 : C.KART_R;
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
      if (d >= ra + rb || d < 1e-4 || Math.abs(a.y - b.y) > 1.2) continue;
      if (a.shrink > 0 && !(b.shrink > 0)) { this.hit(a, b, 98, 40); continue; }
      if (b.shrink > 0 && !(a.shrink > 0)) { this.hit(b, a, 98, 40); continue; }
      const nx = dx / d, nz = dz / d, push = (ra + rb - d) / 2 + 0.01;
      if (!P.blocked(T, a.x - nx * push, a.z - nz * push, a.y)) { a.x -= nx * push; a.z -= nz * push; }
      if (!P.blocked(T, b.x + nx * push, b.z + nz * push, b.y)) { b.x += nx * push; b.z += nz * push; }
      const rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
      if (rel < 0) {
        const imp = -rel * 0.75;
        a.vx -= nx * imp; a.vz -= nz * imp; b.vx += nx * imp; b.vz += nz * imp;
        if (this.tick - a.bumpT > 20 && imp > 3) { a.bumpT = b.bumpT = this.tick; this.ev(EV.BUMP, a.id, b.id); }
      }
    }
  }

  // ---------- networking
  broadcastRoster() {
    const players = [...this.karts.values()].map(k => ({ id: k.id, name: k.name, bot: k.bot ? 1 : 0, color: k.color }));
    for (const k of this.karts.values()) if (k.client) this.hooks.send(k.client, { t: 'roster', players, code: this.code, track: this.track.id });
  }

  broadcast() {
    const pl = [];
    for (const k of this.karts.values()) {
      const bits = (k.drift ? KF.DRIFT : 0) | (k.boost > 0 ? KF.BOOST : 0) | (k.spin > 0 ? KF.SPIN : 0) | (k.shrink > 0 ? KF.SHRINK : 0)
                 | (!k.ground ? KF.AIR : 0) | (k.rescue > 0 ? KF.RESCUE : 0) | (k.finished ? KF.FINISHED : 0) | ((k.keys & KEY.DOWN) ? KF.BRAKE : 0);
      const steer = ((k.keys & KEY.RIGHT) ? 1 : 0) - ((k.keys & KEY.LEFT) ? 1 : 0);
      pl.push(k.id, r2(k.x), r2(k.y), r2(k.z), r3(k.yaw), r2(Math.hypot(k.vx, k.vz)), bits,
              k.drift ? k.drift * P.driftTier(k.charge) : 0, steer, Math.max(1, Math.min(C.LAPS, k.lap)), k.rank, k.item ? 1 : 0);
    }
    const sh = [];
    for (const s of this.shots) sh.push(s.id, s.type === 'banana' ? 0 : s.type === 'green' ? 1 : 2, r2(s.x), r2(s.y), r2(s.z));
    const off = [];
    this.boxes.forEach((b, i) => { if (b.respawnAt > this.tick) off.push(i); });
    const ph = this.phase === 'countdown' ? 0 : this.phase === 'race' ? 1 : 2;
    const base = { t: 's', k: this.tick, ph, go: this.goTick, rs: this.raceStart, p: pl, o: sh, bx: off, ev: this.events,
                   ff: this.firstFinish ? Math.max(0, Math.ceil((this.firstFinish + C.FINISH_GRACE - this.tick) / 60)) : -1 };
    if (this.phase === 'results') { base.res = this.results; base.tl = Math.max(0, Math.ceil((this.resultsUntil - this.tick) / 60)); }
    for (const k of this.karts.values()) {
      if (!k.client) continue;
      const me = [...P.packState(k), k.item, Math.max(0, k.itemReady - this.tick), k.triple, k.finished ? k.place : 0,
                  Math.round((k.prog / this.track.nMain) * 1000) / 1000, k.bestLap, this.tick - k.lapStart];
      this.hooks.send(k.client, { ...base, a: k.ack, me });
    }
    this.events = [];
  }
}

module.exports = { GameRoom };
