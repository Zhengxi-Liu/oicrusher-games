'use strict';
/**
 * Skyward Dynamics - the shared sky, plugged into the unified game server (game_server/server.js).
 *
 * The flight model runs in each browser (smooth local 240 Hz physics); this module:
 *   - relays every pilot's position / attitude to everyone else at 10 Hz (a shared sky, up to 40 pilots)
 *   - keeps two leaderboards in DATA_DIR/flight-board.json: ring-race times and landing scores
 *   - sanity-checks race results against the shared course (every split must be physically possible)
 *   - relays mid-air collisions ('bump') and gun hits ('hit', Falcon Jet and Warbird) to the pilot who was hit
 *   - relays AIM-9 launches ('msl', Falcon Jet only, 4 a life) to everyone, and the verdict ('mslEnd') from the
 *     browser of the pilot it was fired at - that browser decides whether it hit (see client/Missiles.js)
 *
 *   - B-29 bombs and AIM-9 impacts: the browser that dropped / fired reports where it landed ('impact', 'mslImpact');
 *     the server re-flies the bomb (shared/Bombs.js) to check the report, makes the crater (shared/Damage.js), keeps the
 *     list in DATA_DIR/flight-damage.json, and tells everybody ('boom'); a joining pilot gets the whole list in 'welcome'.
 *     At 12:00 PM America/New_York every day the list is wiped and everyone is told ('reset') - also if the server was
 *     down at noon: the file remembers which noon it belongs to.
 *
 * Two skies, one per map: PEACE (civil aircraft only, no weapons, no craters) and WAR (everything; civil aircraft may join, war
 * aircraft may not fly in the peace sky). Pilots only ever see, hear and affect the pilots of their own map. On the war map every
 * airfield has a shield (shared/World.js shieldAt): inside it nobody can fire (weapons fired from outside still hit what is inside); for a few
 * seconds after leaving it a pilot cannot be shot, hit by a missile or ramming-killed. Craters on the runways are filled in by the ground crew one at a time.
 *
 * Interface expected by server.js: add(ws, ip) -> client, remove(client), handle(client, msg),
 * update() at 60 Hz, and `clients` / `rooms` maps for /health.
 */
const Identity = require('../../game_server/Identity.js');
const fs = require('fs');
const path = require('path');
const W = require('../shared/World.js');
const DM = require('../shared/Damage.js');
const BM = require('../shared/Bombs.js');
const CW = require('../../carrier_war/shared/CarrierWorld.js');       // the carrier map: its world, aircraft and battle (rounds, carrier hit points, AA)
const CP = require('../../carrier_war/shared/CarrierPlanes.js');
const { CarrierBattle } = require('../../carrier_war/server/CarrierBattle.js');
const Moderation = require('../../tj_hide_seek/server/Moderation.js');     // the same bilingual keyword filter (and blocked log) as TJ Hide and Seek

const MAX_PILOTS = 40;
const ADMINS = ['z_x_l'];                          // may clear the runway's bomb marks and delete chat messages (registered portal accounts only)
const CHAT_LEN = 120;
const CHAT_KEEP = 100;                             // per map, in memory only (a restart empties the chat)
const RUNWAY_CLEAR_MS = 10 * 60 * 1000;            // the runway's bomb marks are cleared this long after a landing
const BOARD_SIZE = 15;
const HITS_KEEP = 200;                       // carrier-hits totals kept (only the top BOARD_SIZE are sent)
const SEND_EVERY = 6;                        // 60 Hz / 6 = 10 Hz
const LIVERIES = 6;
const MODES = ['free', 'race', 'land'];
const PLANES = ['trainer', 'sport', 'warbird', 'jet', 'a10', 'seaplane', 'b29'];
const CARRIER_PLANES = CP.IDS;                               // only fly on the carrier map; no ring-race / landing leaderboards
const ALL_PLANES = PLANES.concat(CARRIER_PLANES);
// who may drop bombs and how much: the B-29's bay (a sortie's budget, refilled when the aircraft is back on the ground) or the Warbird's one 1,000 lb bomb
const BOMB_LOAD = { b29: { kg: 10000 }, warbird: { kg: 460, types: ['b1000'] }, a10: { kg: 1400, types: ['b500'] } };      // the A-10: six 500 lb bombs
for (const id of CARRIER_PLANES) if (CP.PLANES[id].bombs) BOMB_LOAD[id] = { kg: CP.PLANES[id].bombs * BM.BOMBS[CP.PLANES[id].bomb].mass + 5, types: [CP.PLANES[id].bomb] };   // Dauntless: one 1,000 lb; Val: two 250 kg
const ARMED = ['jet', 'a10', 'warbird', 'b29', ...CARRIER_PLANES];             // b29: the defensive turrets
const MISSILE_PLANES = ['jet', 'a10'];
const MISSILES = 4;
const MISSILE_MAX = { aim9: 4, aim9x: 2, aim120: 2 };   // per sortie, of the 4 rails (AIM-9M, AIM-9X, AIM-120)
const SPAWN_GRACE_MS = 6000;                 // protected for this long after a (re)start, until you fire
const SHIELD_GRACE_MS = W.SHIELD.grace * 1000;

class SkyServer {
  constructor({ name = 'flight', dataDir, log }) {
    this.name = name;
    this.clients = new Map();
    this.mod = Moderation.shared({ dataDir, log });
    this.chat = { peace: [], war: [], carrier: [] };      // each map has its own chat, like its own sky
    this.nextChat = 1;
    this.battle = new CarrierBattle({ clients: this.clients, log: (...a) => this.log(...a), toCarrier: (m, except) => this.toMap('carrier', m, except), send: (c, m) => this.send(c, m), bank: (c, n) => this.bankHits(c, n) });
    this.rooms = new Map();                  // unused (one shared sky); kept for /health
    this.nextId = 1;
    this.tick = 0;
    this.log = (...a) => (log || console.log)(`[${name}]`, ...a);
    this.file = path.join(dataDir || '.', 'flight-board.json');
    // race times are kept per aircraft type (a jet would win every race); landings in one list
    this.board = { race: Object.fromEntries(PLANES.map(p => [p, []])), landing: [], hits: [] };     // hits: carrier map, confirmed direct hits on the enemy carrier (running total per pilot)
    try {
      const b = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (b && Array.isArray(b.landing)) this.board.landing = b.landing;
      if (b && Array.isArray(b.hits)) this.board.hits = b.hits;
      if (b && Array.isArray(b.race)) this.board.race.sport = b.race;                 // old single-aircraft board
      else if (b && b.race) for (const p of PLANES) if (Array.isArray(b.race[p])) this.board.race[p] = b.race[p];
    } catch (e) {}
    this.dirty = false;
    setInterval(() => this.save(), 5000).unref();
    // the map damage
    this.dmgFile = path.join(dataDir || '.', 'flight-damage.json');
    this.damage = new DM.DamageStore();
    this.dmgDirty = false;
    this.mslLaunch = new Map();
    this.clearAt = [];                                  // when to clear the runway next (10 min after each landing)
    this.loadDamage();
    setInterval(() => { this.checkReset(); this.checkRunwayClear(); this.checkRepair(); this.saveDamage(); }, 5000).unref();
  }

  // ---------- persistent damage and the daily reset
  /** Read the saved craters. They only count if they belong to the current map (the last 12:00 PM Eastern); otherwise the map starts clean. */
  loadDamage() {
    const era = DM.lastNoonET(Date.now());
    try {
      const d = JSON.parse(fs.readFileSync(this.dmgFile, 'utf8'));
      if (d && d.era === era && Array.isArray(d.craters)) { this.damage.load(d); this.log(`loaded ${this.damage.list.length} craters (map of ${new Date(era).toISOString()})`); return; }
      this.log(`saved craters are from an older map (${d && d.era ? new Date(d.era).toISOString() : '?'}): reset`);
    } catch (e) {}
    this.damage.reset(era);
    this.dmgDirty = true;
  }
  saveDamage() {
    if (!this.dmgDirty) return;
    this.dmgDirty = false;
    fs.writeFile(this.dmgFile, JSON.stringify(this.damage.save()), () => {});
  }
  /** Called every few seconds: has 12:00 PM Eastern passed since this map began? Then restore everything and tell everyone. */
  checkReset(now = Date.now()) {
    const era = DM.lastNoonET(now);
    if (era <= this.damage.era) return false;
    this.log(`12:00 PM Eastern: map reset (${this.damage.list.length} craters cleared)`);
    this.damage.reset(era);
    this.dmgDirty = true; this.saveDamage();
    for (const c of this.clients.values()) { c.bombs = new Map(); c.bombKg = 0; if (c.name && c.map === 'war') this.send(c, { t: 'reset', era }); }
    this.mslLaunch.clear();
    return true;
  }

  /** Remove the craters that touch the runway and give everybody the new list. Returns how many went. */
  clearRunway(who) {
    const n = this.damage.removeWhere(c => DM.onRunway(c));
    if (!n) return 0;
    this.dmgDirty = true; this.saveDamage();
    this.log(`runway cleared of ${n} crater${n === 1 ? '' : 's'} (${who})`);
    const dmg = { era: this.damage.era, list: this.damage.save().craters };
    this.toMap('war', { t: 'dmgSync', dmg, why: who === 'timer' ? 'auto' : who === 'crew' ? 'repair' : 'admin' });
    return n;
  }
  /**
   * The ground crew: a runway crater that has been there SHIELD.repairMs is filled in, one every SHIELD.repairEveryMs (oldest first),
   * so a runway that has been carpet-bombed is usable again after a few minutes instead of staying closed until noon.
   */
  checkRepair(now = Date.now()) {
    if (now - (this.lastRepair || 0) < W.SHIELD.repairEveryMs) return 0;
    let old = null;
    for (const c of this.damage.list) if (DM.onRunway(c) && now - (c.t || 0) >= W.SHIELD.repairMs && (!old || (c.t || 0) < (old.t || 0))) old = c;
    if (!old) return 0;
    this.lastRepair = now;
    const n = this.damage.removeWhere(c => c.id === old.id);
    if (n) this.log(`ground crew filled in crater #${old.id}`);
    this.dmgDirty = true; this.saveDamage();
    this.toMap('war', { t: 'dmgSync', dmg: { era: this.damage.era, list: this.damage.save().craters }, why: 'repair' });
    return n;
  }
  /** A landing was 10 minutes ago: the ground crew has filled in the runway. */
  checkRunwayClear(now = Date.now()) {
    if (!this.clearAt.length || this.clearAt[0] > now) return;
    while (this.clearAt.length && this.clearAt[0] <= now) this.clearAt.shift();
    this.clearRunway('timer');
  }

  send(c, m) { if (c.ws && c.ws.readyState === 1 && c.ws.bufferedAmount < 256 * 1024) c.ws.send(JSON.stringify(m)); }

  save() {
    if (!this.dirty) return;
    this.dirty = false;
    fs.writeFile(this.file, JSON.stringify(this.board), () => {});
  }

  add(ws, ip) {
    const c = { id: this.nextId++, ws, ip, name: '', map: 'war', team: 0, shieldUntil: 0, livery: 0, plane: 'sport', st: null, lastSt: 0, bombs: new Map(), bombKg: 0, impacts: [] };
    this.clients.set(c.id, c);
    return c;
  }

  remove(c) {
    this.clients.delete(c.id);
    if (c.name) this.roster();
  }

  /** Everyone sees the pilots of their own map (and how many are on each). */
  roster() {
    const named = [...this.clients.values()].filter(c => c.name), counts = { peace: 0, war: 0, carrier: 0 };
    for (const c of named) counts[c.map]++;
    const lists = { peace: [], war: [], carrier: [] };
    for (const c of named) lists[c.map].push({ id: c.id, name: c.name, livery: c.livery, plane: c.plane });
    for (const c of named) this.send(c, { t: 'pilots', map: c.map, list: lists[c.map], counts });
  }

  /** Send m to every pilot on a map (except `except`). */
  toMap(map, m, except) { for (const x of this.clients.values()) if (x.name && x.map === map && x !== except) this.send(x, m); }

  /**
   * Is this pilot protected right now? War map only: a few seconds after leaving an airfield's shield, or just (re)started.
   * Firing a weapon ends the grace (see spend()).
   */
  shielded(c, now = Date.now()) {
    if (c.map === 'carrier') return this.inShield(c);          // carrier map: only inside a carrier's shield (no grace afterwards)
    if (c.map !== 'war' || !c.st) return false;
    return now < c.shieldUntil || this.inShield(c);      // the shield stops guns and missiles (bombs are the one thing that gets through)
  }
  /** Strictly inside a shield: weapons are safe. */
  inShield(c) { return !!c.st && (c.map === 'carrier' ? this.battle.inShield(c) : !!W.shieldAt(c.st.p[0], c.st.p[1], c.st.p[2])); }
  /** Is point p inside an airfield's (war) or a carrier's (carrier map) shield? */
  shieldPt(map, p) { return map === 'carrier' ? this.battle.inShield({ st: { p } }) : map === 'war' && !!W.shieldAt(p[0], p[1], p[2]); }
  /** Does the straight path a -> b pass through a shield? Guns and missiles cannot (only bombs do). */
  crossesShield(map, a, b) {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 20));
    for (let i = 0; i <= n; i++) { const f = i / n; if (this.shieldPt(map, [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f])) return true; }
    return false;
  }
  /** Whether this pilot may use a weapon at all (war map, not inside a shield); using one ends the leaving-the-shield grace. */
  mayFire(c) { return c.map === 'carrier' ? this.battle.phase === 'play' && !this.battle.inOwnShield(c) : c.map === 'war' && !this.inShield(c); }
  spend(c) { c.shieldUntil = 0; }

  handle(c, m) {
    switch (m.t) {
      case 'ping': return this.send(c, { t: 'pong', c: m.c });
      case 'hello': {
        const who = Identity.resolve(m);             // the portal identity (signed token), see game_server/Identity.js
        if (who.error) return this.send(c, { t: 'error', msg: who.error });
        const name = who.name;
        if (!c.name && [...this.clients.values()].filter(x => x.name).length >= MAX_PILOTS) return this.send(c, { t: 'error', msg: 'The sky is full right now - flying offline.' });
        const first = !c.name;
        c.name = name;
        c.admin = ADMINS.includes(name) && (!Identity.STRICT || !!who.registered);
        c.livery = Math.max(0, Math.min(LIVERIES - 1, m.livery | 0));
        c.plane = ALL_PLANES.includes(m.plane) ? m.plane : 'sport';
        c.team = this.battle.teamOf(c.plane);
        const want = W.MAPS.includes(m.map) ? m.map : 'war';                    // an old page that doesn't say: the one shared sky was the war sky
        const map = W.mapAllows(want, c.plane) ? want : W.isCarrierPlane(c.plane) ? 'carrier' : 'war';     // war aircraft cannot fly in the peace sky, carrier aircraft only fly on the carrier map
        if (map !== c.map) { c.st = null; c.shieldUntil = 0; }
        c.map = map;
        this.send(c, { t: 'welcome', id: c.id, admin: c.admin, map, forced: map !== want, board: this.boardMsg(), chat: this.chat[map],
                       dmg: { era: this.damage.era, list: map === 'war' ? this.damage.save().craters : [] }, round: map === 'carrier' ? this.battle.roundMsg() : undefined });
        if (first) this.log(`${name} took off (${[...this.clients.values()].filter(x => x.name).length} in the sky)`);
        return this.roster();
      }
      case 'st': return this.onState(c, m);
      case 'race': return this.onRace(c, m);
      case 'landing': return this.onLanding(c, m);
      case 'clearRunway': if (!c.admin) return this.send(c, { t: 'error', msg: 'Only an admin can clear the runway.' }); this.clearRunway(c.name); return this.send(c, { t: 'runwayCleared' });
      case 'chat': return this.onChat(c, m);
      case 'delChat': return this.onDelChat(c, m);
      case 'bump': return this.onBump(c, m);
      case 'hit': return this.onHit(c, m);
      case 'msl': return this.onMissile(c, m);
      case 'mslEnd': return this.onMissileEnd(c, m);
      case 'bomb': return this.onBomb(c, m);
      case 'impact': return this.onImpact(c, m);
      case 'crashhit': return void (c.map === 'carrier' && c.name && this.battle.onCrash(c, m));
      case 'ddhit': return void (c.map === 'carrier' && c.name && this.mayFire(c) && this.battle.onStrafe(c, m));
      case 'mslImpact': return this.onMslImpact(c, m);
    }
  }

  /** {text}: say something to the pilots of this map (rejected when it hits the keyword filter, <= 120 chars, 5 per 10 s, no repeats). */
  onChat(c, m) {
    if (!c.name) return;
    const now = Date.now();
    c.chatT = (c.chatT || []).filter(t => now - t < 10000);
    if (c.chatT.length >= 5 || now - (c.chatT[c.chatT.length - 1] || 0) < 700) return this.send(c, { t: 'chatErr', msg: 'Slow down a little!' });
    const text = String(m.text || '').replace(/[\x00-\x1F\x7F<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CHAT_LEN);
    if (!text) return;
    if (!this.mod.allow(text, { kind: 'chat', game: 'flight', user: c.name, ip: c.ip })) return this.send(c, { t: 'chatErr', msg: 'Blocked: that contains language that is not allowed here. Inappropriate content can get your IP address banned. 已拦截：内容含有不允许的词语，违规可能导致 IP 被封禁。' });
    if (text === c.lastChat && now - c.chatT[c.chatT.length - 1] < 5000) return;
    c.chatT.push(now); c.lastChat = text;
    const e = { id: this.nextChat++, by: c.name, text, at: now }, list = this.chat[c.map];
    list.push(e);
    if (list.length > CHAT_KEEP) list.splice(0, list.length - CHAT_KEEP);
    this.toMap(c.map, { t: 'chat', e });
  }

  /** {id}: an admin takes a message off the chat for everybody. */
  onDelChat(c, m) {
    if (!c.admin) return this.send(c, { t: 'chatErr', msg: 'Only an admin can delete messages.' });
    const list = this.chat[c.map], i = list.findIndex(e => e.id === (m.id | 0));
    if (i < 0) return;
    const [e] = list.splice(i, 1);
    this.log(`${c.name} deleted ${e.by}'s chat message: ${e.text}`);
    this.toMap(c.map, { t: 'chatDel', id: e.id });
  }

  onState(c, m) {
    if (!c.name) return;
    const now = Date.now();
    if (now - c.lastSt < 60) return;                       // at most ~16 Hz
    c.lastSt = now;
    const p = m.p, q = m.q;
    if (!Array.isArray(p) || !Array.isArray(q) || p.length !== 3 || q.length !== 4) return;
    const nums = [...p, ...q, m.e];
    if (!nums.every(Number.isFinite)) return;
    if (Math.abs(p[0]) > 30000 || Math.abs(p[2]) > 30000 || p[1] < -100 || p[1] > 12000) return;
    c.st = { p: p.map(v => Math.round(v * 10) / 10), q: q.map(v => Math.round(v * 1000) / 1000), e: Math.max(0, Math.min(1, m.e)),
             m: MODES.includes(m.m) && !(m.m === 'race' && c.plane === 'b29') ? MODES.indexOf(m.m) : 0, x: m.x ? 1 : 0, fl: ((m.fl | 0) & (m.m === 'land' ? 31 : 15)) | ((m.fl | 0) & 64), s: Number.isFinite(m.s) ? m.s : 99, at: now };   // fl: 1 gear up, 2 firing, 4 speed brake, 8 flares, 16 immune (landing only), 64 on the ground (32, protected, is added by us)
    if (c.prevX && !c.st.x) { c.mslLeft = MISSILES; c.mslUsed = {}; c.bombKg = 0; c.shieldUntil = now + SPAWN_GRACE_MS; }       // back from a crash: the rails and the bay are full again
    const moved = Math.hypot(p[0] - (c.lastP || p)[0], p[2] - (c.lastP || p)[2]);
    if (moved > 2000 || (c.lastP && moved < 1.5)) { c.mslLeft = MISSILES; c.mslUsed = {}; c.bombKg = 0; }   // a new flight somewhere else, or parked / taxiing (rearmed)
    if (moved > 2000 || !c.lastP) c.shieldUntil = now + SPAWN_GRACE_MS;
    const inS = c.map === 'war' && !!W.shieldAt(p[0], p[1], p[2]);
    if (c.wasIn && !inS) c.shieldUntil = Math.max(c.shieldUntil, now + SHIELD_GRACE_MS);     // just left it: 8 s to get clear
    c.wasIn = inS;
    c.prevX = c.st.x; c.lastP = p;
    if (c.map === 'carrier') this.battle.onState(c);
  }

  /**
   * {id}: this pilot flew into pilot `id` - tell them, so both aircraft go down. Only if the two were
   * really close by the positions we have (10 Hz and a little old, so allow ~0.25 s of a fast closure).
   */
  onBump(c, m) {
    if (!c.name || !c.st) return;
    const o = this.clients.get(m.id | 0);
    if (!o || o === c || o.map !== c.map || !o.name || !o.st || o.st.x || (c.st.fl | o.st.fl) & 16) return;    // immune pilots don't collide
    const a = c.st.p, b = o.st.p;
    if ((c.map === 'war' || c.map === 'carrier') && ((c.st.fl | o.st.fl) & 64) && this.inShield(c) && this.inShield(o)) return;     // on an airfield with someone on the ground: no ramming
    if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 150) return;
    this.log(`${c.name} and ${o.name} collided`);
    this.send(o, { t: 'bumped', id: c.id, name: c.name });
  }

  /**
   * {id, n}: our guns hit pilot `id` n times (any mode). Only the Falcon Jet and the Warbird are armed;
   * only within gun range, at most ~10 relays a second.
   */
  onHit(c, m) {
    const now = Date.now();
    if (!c.name || !c.st || !ARMED.includes(c.plane) || c.st.x || c.st.fl & 16 || now - (c.lastHit || 0) < 80 || !this.mayFire(c)) return;
    const o = this.clients.get(m.id | 0), n = Math.max(1, Math.min(24, m.n | 0));
    if (!o || o === c || o.map !== c.map || !o.name || !o.st || o.st.x || o.st.fl & 16 || this.shielded(o, now) || (c.map === 'carrier' && o.team === c.team)) return;     // carrier map: no friendly fire
    const a = c.st.p, b = o.st.p;
    if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 2500 || this.crossesShield(c.map, a, b)) return;      // a shield in between stops the rounds
    c.lastHit = now; this.spend(c);
    this.send(o, { t: 'hit', id: c.id, name: c.name, n });
  }

  /**
   * {mid, tg, p, v, d, rail}: an AIM-9 off the rail (Falcon only, at most 4 a life, one per 0.7 s), fired from
   * where the pilot is. Relayed to everyone; the missile is flown in every browser from this state.
   */
  onMissile(c, m) {
    const now = Date.now();
    if (!c.name || !c.st || c.st.x || c.st.fl & 16 || !MISSILE_PLANES.includes(c.plane) || now - (c.lastMsl || 0) < 700 || !this.mayFire(c)) return;
    if (c.mslLeft === undefined) c.mslLeft = MISSILES;
    const mk = MISSILE_MAX[m.k] ? m.k : 'aim9';
    c.mslUsed = c.mslUsed || {};
    if (c.mslLeft <= 0 || (c.mslUsed[mk] || 0) >= MISSILE_MAX[mk]) return;
    const vec = a => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);
    if (!vec(m.p) || !vec(m.v) || !vec(m.d) || !Number.isInteger(m.mid) || m.mid <= 0) return;
    const a = c.st.p;
    if (Math.hypot(m.p[0] - a[0], m.p[1] - a[1], m.p[2] - a[2]) > 120 || Math.hypot(...m.v) > 800 || Math.abs(Math.hypot(...m.d) - 1) > 0.05) return;
    const tg = m.tg | 0, o = tg ? this.clients.get(tg) : null;
    if (tg && (!o || o === c || o.map !== c.map || this.shielded(o, now) || !o.name || !o.st || o.st.x || o.st.fl & 16 || Math.hypot(o.st.p[0] - a[0], o.st.p[1] - a[1], o.st.p[2] - a[2]) > 15000)) return;
    c.lastMsl = now; c.mslLeft--; c.mslUsed[mk] = (c.mslUsed[mk] || 0) + 1; this.spend(c);
    this.missiles = this.missiles || new Map();
    for (const [k, x] of this.missiles) if (now - x.at > 40000) this.missiles.delete(k);
    this.missiles.set(`${c.id}:${m.mid}`, { tg, at: now, from: m.p.slice() });
    for (const [k, x] of this.mslLaunch) if (now - x.at > 90000) this.mslLaunch.delete(k);
    this.mslLaunch.set(`${c.id}:${m.mid}`, { at: now });
    this.log(`${c.name} fired an ${mk}${o ? ' at ' + o.name : ''}`);
    const msg = { t: 'msl', k: mk, from: c.id, name: c.name, mid: m.mid, tg, p: m.p, v: m.v, d: m.d, rail: Math.max(0, Math.min(3, m.rail | 0)) };
    this.toMap(c.map, msg, c);
  }

  /** {from, mid, kind, miss, p}: how it ended - only the pilot it was fired at may say so. */
  onMissileEnd(c, m) {
    const k = `${m.from | 0}:${m.mid | 0}`, x = this.missiles && this.missiles.get(k);
    if (!x || x.tg !== c.id || !Array.isArray(m.p) || m.p.length !== 3 || !m.p.every(Number.isFinite)) return;
    this.missiles.delete(k);
    let kind = ['prox', 'ground', 'sd'].includes(m.kind) ? m.kind : 'sd';
    if (kind === 'prox' && (this.shielded(c) || this.crossesShield(c.map, x.from, m.p))) kind = 'sd';      // the shield swallowed it (or it flew through one)
    const miss = Number.isFinite(m.miss) ? Math.max(-1, Math.min(99, m.miss)) : -1;
    if (kind === 'prox') this.log(`missile from #${m.from | 0} hit ${c.name} (${miss} m)`);
    const msg = { t: 'mslEnd', from: m.from | 0, mid: m.mid | 0, tg: c.id, kind, miss, p: m.p, water: !!m.water };
    this.toMap(c.map, msg, c);
  }

  /**
   * {id, type, p, v, wind, seed}: a bomb leaves the bay (B-29 only, from where the pilot is, at most 10 t per sortie).
   * Relayed to everybody: every browser flies it from this state. Remembered so the impact report can be checked.
   */
  onBomb(c, m) {
    const now = Date.now(), B = BM.BOMBS[m.type];
    const vec = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);
    if (!c.name || !c.st || c.st.x || !BOMB_LOAD[c.plane] || (BOMB_LOAD[c.plane].types && !BOMB_LOAD[c.plane].types.includes(m.type)) || !this.mayFire(c) || !B || !vec(m.p, 3) || !vec(m.v, 3) || !vec(m.wind, 2) || !Number.isInteger(m.seed) || !Number.isInteger(m.id) || m.id <= 0) return;
    if (now - (c.lastBomb || 0) < 70 || c.bombs.has(m.id) || c.bombKg + B.mass > BOMB_LOAD[c.plane].kg) return;
    const a = c.st.p;
    if (Math.hypot(m.p[0] - a[0], m.p[1] - a[1], m.p[2] - a[2]) > 200 || Math.hypot(...m.v) > 280 || Math.hypot(...m.wind) > 20 || m.p[1] < -2 || m.p[1] > 12000) return;     // bombs may leave the rack on the ground too (runway, deck)
    c.lastBomb = now; c.bombKg += B.mass; this.spend(c);
    for (const [k, x] of c.bombs) if (now - x.at > 240000) c.bombs.delete(k);
    const rec = { type: m.type, p: m.p, v: m.v, wind: m.wind, seed: m.seed, at: now };
    if (c.map === 'carrier') this.battle.stamp(rec, c, m.id);
    c.bombs.set(m.id, rec);
    const msg = { t: 'bomb', from: c.id, name: c.name, id: m.id, type: m.type, p: m.p, v: m.v, wind: m.wind, seed: m.seed };
    this.toMap(c.map, msg, c);
  }

  /** {id, p, kind, armed}: the bomb we released landed at p. Re-fly it over the shared terrain; accept if p is on its path. */
  onImpact(c, m) {
    const rel = c.bombs.get(m.id | 0);
    if (!c.name || (c.map !== 'war' && c.map !== 'carrier') || !rel || !Array.isArray(m.p) || m.p.length !== 3 || !m.p.every(Number.isFinite)) return;
    c.bombs.delete(m.id | 0);
    if (!this.impactRate(c)) return;
    if (c.map === 'carrier') return void this.battle.onImpact(c, rel, m);
    const env = { ground: (x, z) => W.heightAt(x, z), obstacle: null, floorMax: 1760 };
    if (!BM.plausible(rel, m.p, env)) return this.log(`${c.name}: bomb ${m.id} impact rejected (not on its flight path)`);
    this.boom(c, BM.BOMBS[rel.type].w, m.p, !!m.armed, rel.seed, m.id | 0);
  }

  /** {mid, p, water}: one of the AIM-9s this pilot fired hit the ground. */
  onMslImpact(c, m) {
    const k = `${c.id}:${m.mid | 0}`, x = this.mslLaunch.get(k);
    if (!c.name || !x || !Array.isArray(m.p) || m.p.length !== 3 || !m.p.every(Number.isFinite) || !c.st || !MISSILE_PLANES.includes(c.plane) || c.map !== 'war') return;
    this.mslLaunch.delete(k);
    if (!this.impactRate(c) || Math.hypot(m.p[0] - c.st.p[0], m.p[2] - c.st.p[2]) > 25000) return;
    this.boom(c, 'msl', m.p, true, (c.id * 7919 + (m.mid | 0)) | 0, m.mid | 0);
  }

  /** At most 40 impacts every 10 s from one pilot. */
  impactRate(c) {
    const now = Date.now();
    c.impacts = c.impacts.filter(t => now - t < 10000);
    if (c.impacts.length >= 40) return false;
    c.impacts.push(now);
    return true;
  }

  /** An explosion at p: decide what the ground is, dig the crater (merged with an earlier one on the same spot), tell everybody. */
  boom(c, w, p, armed, seed, id) {
    const x = p[0], z = p[2];
    if (!DM.WEAPONS[w] || Math.abs(x) > 9500 || Math.abs(z) > 9500) return;
    const mat = DM.classify(x, z), msg = { t: 'boom', w, p: [Math.round(x * 10) / 10, Math.round(p[1] * 10) / 10, Math.round(z * 10) / 10], water: mat === 'water', from: c.id, id, rec: null, dud: !armed };
    if (armed && mat !== 'water') {
      const res = this.damage.add(w, x, z, mat, (seed + c.id * 31) | 0);
      if (res) { msg.rec = res.rec; this.dmgDirty = true; }                 // null: the map is full of craters - the blast still happens
    }
    this.log(`${c.name}: ${DM.WEAPONS[w].name} ${msg.water ? 'in the sea' : armed ? `on ${mat}${msg.rec ? ` (crater #${msg.rec.id}, R ${msg.rec.R} m)` : ' (no more room for craters)'}` : 'dud'}`);
    this.toMap('war', msg);
  }

  /** {time, splits[]}: splits[i] = seconds from the start to ring i. */
  onRace(c, m) {
    if (!c.name) return;
    if (m.plane === 'b29') return this.send(c, { t: 'raceResult', ok: false, why: 'no ring race for the bomber' });
    const splits = m.splits;
    const n = W.COURSE.length;
    if (!Array.isArray(splits) || splits.length !== n || !splits.every(Number.isFinite)) return this.send(c, { t: 'raceResult', ok: false, why: 'bad result' });
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const dt = splits[i] - prev;
      if (dt < W.minSplit(i) * 0.97 || dt > 600) return this.send(c, { t: 'raceResult', ok: false, why: 'implausible split' });
      prev = splits[i];
    }
    const time = Math.round(splits[n - 1] * 100) / 100;
    const plane = PLANES.includes(m.plane) ? m.plane : 'sport';
    const rank = this.insert(this.board.race[plane], { name: c.name, time, plane, splits: splits.map(v => Math.round(v * 100) / 100), date: Date.now() }, (a, b) => a.time - b.time);
    this.log(`${c.name} finished the ring race in ${time.toFixed(2)} s with the ${plane}${rank ? ' (#' + rank + ')' : ''}`);
    this.send(c, { t: 'raceResult', ok: true, time, rank });
    this.broadcastBoard();
  }

  /** {score 0-100, grade, vs (fpm), off (m), dist (m), wind (kt)} - graded in the browser, clamped here. */
  onLanding(c, m) {
    if (!c.name) return;
    const score = Math.round(Math.max(0, Math.min(100, Number(m.score) || 0)));
    const grade = ['S', 'A', 'B', 'C', 'D', 'F'].includes(m.grade) ? m.grade : 'F';
    const e = { name: c.name, plane: PLANES.includes(m.plane) ? m.plane : 'sport', score, grade, vs: Math.round(Math.max(0, Math.min(5000, Number(m.vs) || 0))), off: Math.round(Math.abs(Number(m.off) || 0) * 10) / 10,
                dist: Math.round(Number(m.dist) || 0), wind: Math.round(Math.max(0, Math.min(60, Number(m.wind) || 0))), date: Date.now() };
    const rank = score > 0 ? this.insert(this.board.landing, e, (a, b) => b.score - a.score || a.vs - b.vs) : 0;
    this.clearAt.push(Date.now() + RUNWAY_CLEAR_MS);
    this.log(`${c.name} landed: ${grade} ${score}${rank ? ' (#' + rank + ')' : ''}`);
    this.send(c, { t: 'landingResult', ok: true, rank });
    if (rank) this.broadcastBoard();
  }

  /** Carrier map: one more direct hit by this pilot (sortieHits = its direct hits this sortie so far, for the best). A running total per name (HITS_KEEP kept, the top BOARD_SIZE shown). Returns the new total. */
  bankHits(c, sortieHits) {
    const L = this.board.hits, now = Date.now();
    let e = L.find(x => x.name === c.name);
    if (!e) { e = { name: c.name, hits: 0, best: 0 }; L.push(e); }
    e.hits++; e.best = Math.max(e.best, sortieHits | 0); e.plane = c.plane; e.date = now;
    L.sort((a, b) => b.hits - a.hits || b.best - a.best || a.date - b.date);
    L.length = Math.min(L.length, HITS_KEEP);
    this.dirty = true;
    this.broadcastBoard();
    return e.hits;
  }

  /** Keep one (best) entry per name, sorted, BOARD_SIZE long. Returns the 1-based rank or 0. */
  insert(list, e, cmp) {
    const i = list.findIndex(x => x.name === e.name);
    if (i >= 0) { if (cmp(e, list[i]) >= 0) return 0; list.splice(i, 1); }
    list.push(e);
    list.sort(cmp);
    list.length = Math.min(list.length, BOARD_SIZE);
    const rank = list.indexOf(e) + 1;
    if (rank) this.dirty = true;
    return rank;
  }

  boardMsg() { return { ...this.board, hits: this.board.hits.slice(0, BOARD_SIZE) }; }
  broadcastBoard() { const board = this.boardMsg(); for (const c of this.clients.values()) if (c.name) this.send(c, { t: 'board', board }); }

  update() {
    this.tick++;
    this.battle.update(this.tick);
    if (this.tick % SEND_EVERY) return;
    const now = Date.now(), skies = { peace: { list: [], flags: [] }, war: { list: [], flags: [] }, carrier: { list: [], flags: [] } };
    for (const c of this.clients.values()) {
      if (!c.name || !c.st || now - c.st.at > 5000) continue;
      const s = c.st, k = skies[c.map];
      k.list.push(c.id, s.p[0], s.p[1], s.p[2], s.q[0], s.q[1], s.q[2], s.q[3], Math.round(s.e * 100) / 100, s.m, s.x);
      k.flags.push(c.id, (s.fl || 0) | (this.shielded(c, now) ? 32 : 0));      // 32: protected (shield / just started)
    }
    for (const map in skies) {
      if (!skies[map].list.length) continue;
      this.toMap(map, { t: 'sky', k: this.tick, p: skies[map].list, fl: skies[map].flags });     // fl kept apart so older pages still parse p
    }
  }
}

module.exports = { SkyServer };
