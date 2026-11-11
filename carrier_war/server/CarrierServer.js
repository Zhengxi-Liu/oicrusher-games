'use strict';
/**
 * Carrier War - one persistent battle (its own universe, nothing shared with the island sim). Two carriers, two teams.
 * A round ends when a carrier's hit points reach zero - and ONLY BOMBS hurt a carrier (and guns / missiles cannot hurt anybody
 * inside a carrier's shield; bombs go through it). Planes inside the ENEMY shield are shot at by that carrier's AA.
 *
 *   client -> server  hello {name, token, team, plane} | st {p, q, e, x, fl, s} | hit {id, n} | bomb {id, type, p, v, wind, seed}
 *                     impact {id, p, kind} | respawn {plane} | down {why} (we crashed ourselves) | chat {text}
 *   server -> client  welcome | roster | snap {p: [id,x,y,z,qx,qy,qz,qw,e,fl ...], hp: [h0, h1]} | dmg | down | kill | boom
 *                     bomb | round {phase, winner, hp} | aa | chat | error
 */
const W = require('../shared/CarrierWorld.js');
const P = require('../shared/CarrierPlanes.js');
const BM = require('../../flight_sim/shared/Bombs.js');
const Identity = require('../../game_server/Identity.js');

const MAX_PLAYERS = 16;
const SEND_EVERY = 4;                       // 60 Hz / 4 = 15 Hz snapshots
const OVER_MS = 20000;                      // the result screen before the next round
const AA_HITS_PER_S = 1.3;                  // a carrier's AA against an enemy inside its shield
const FIRE_GAP_MS = 45;
const DT = BM.DT;

class CarrierServer {
  constructor({ name, log }) {
    this.name = name;
    this.logf = log || console.log;
    this.clients = new Map();
    this.rooms = new Map();                  // health check expects .size
    this.nextId = 1; this.tick = 0;
    this.phase = 'play'; this.winner = -1; this.overAt = 0; this.startedAt = Date.now();
    this.hp = [W.HP, W.HP];
    this.wins = [0, 0];
    this.lastAA = Date.now();
    W.update(0);
  }
  /** Seconds into the round (frozen once the round is over: the carriers stop where the battle ended). */
  clock(now = Date.now()) { return ((this.phase === 'over' ? this.endedAt : now) - this.startedAt) / 1000; }
  log(...a) { this.logf(`[${this.name}]`, ...a); }
  send(c, m) { if (c.ws && c.ws.readyState === 1 && c.ws.bufferedAmount < 256 * 1024) c.ws.send(JSON.stringify(m)); }
  all(m, except) { for (const c of this.clients.values()) if (c.name && c !== except) this.send(c, m); }

  add(ws, ip) {
    const c = { id: this.nextId++, ws, ip, name: '', team: 0, plane: 'hellcat', st: null, lastSt: 0, hp: 0, alive: false, k: 0, d: 0,
                bombs: new Map(), bombsUsed: 0, impacts: [], lastHit: 0, lastBomb: 0, aaAcc: 0, chatT: [] };
    this.clients.set(c.id, c);
    return c;
  }
  remove(c) { this.clients.delete(c.id); if (c.name) this.roster(); }

  teamCounts() { const n = [0, 0]; for (const c of this.clients.values()) if (c.name) n[c.team]++; return n; }
  roster() {
    const list = [...this.clients.values()].filter(c => c.name).map(c => ({ id: c.id, name: c.name, team: c.team, plane: c.plane, k: c.k, d: c.d, alive: c.alive }));
    this.all({ t: 'roster', list, wins: this.wins });
  }
  roundMsg() { return { t: 'round', phase: this.phase, winner: this.winner, hp: this.hp, wins: this.wins, t0: this.startedAt, now: Date.now(), max: W.ROUND_MAX, left: this.phase === 'over' ? Math.max(0, this.overAt - Date.now()) : 0 }; }

  handle(c, m) {
    switch (m.t) {
      case 'ping': return this.send(c, { t: 'pong', c: m.c });
      case 'hello': return this.onHello(c, m);
      case 'st': return this.onState(c, m);
      case 'hit': return this.onHit(c, m);
      case 'bomb': return this.onBomb(c, m);
      case 'impact': return this.onImpact(c, m);
      case 'respawn': return this.onRespawn(c, m);
      case 'down': return this.onDown(c, m);
    }
  }

  onHello(c, m) {
    const who = Identity.resolve(m);
    if (who.error) return this.send(c, { t: 'error', msg: who.error });
    if (!c.name && [...this.clients.values()].filter(x => x.name).length >= MAX_PLAYERS) return this.send(c, { t: 'error', msg: 'The battle is full right now.' });
    const first = !c.name;
    const n = this.teamCounts();                      // before this pilot is counted
    c.name = who.name;
    if (first) {
      const want = m.team === 0 || m.team === 1 ? m.team : (n[0] <= n[1] ? 0 : 1);
      c.team = Math.abs(n[want] - n[1 - want]) >= 2 && n[want] > n[1 - want] ? 1 - want : want;      // never more than one player ahead
    }
    c.plane = P.TEAMS[c.team].planes.includes(m.plane) ? m.plane : P.TEAMS[c.team].planes[0];
    c.alive = false; c.st = null;
    this.send(c, { t: 'welcome', id: c.id, team: c.team, plane: c.plane, round: this.roundMsg() });
    if (first) this.log(`${c.name} joined ${P.TEAMS[c.team].short} (${[...this.clients.values()].filter(x => x.name).length} in the battle)`);
    this.roster();
  }

  onRespawn(c, m) {
    if (!c.name || c.alive) return;
    const T = P.TEAMS[c.team];
    c.plane = T.planes.includes(m.plane) ? m.plane : c.plane;
    c.hp = P.PLANES[c.plane].hp; c.alive = true; c.bombsUsed = 0; c.bombs.clear(); c.st = null; c.aaAcc = 0;
    this.send(c, { t: 'spawned', plane: c.plane, hp: c.hp });
    this.roster();
  }

  onDown(c, m) {
    if (!c.alive) return;
    this.kill(c, null, String(m.why || 'crashed').slice(0, 60));
  }

  onState(c, m) {
    if (!c.name || !c.alive) return;
    const now = Date.now();
    if (now - c.lastSt < 40) return;
    c.lastSt = now;
    const p = m.p, q = m.q;
    if (!Array.isArray(p) || !Array.isArray(q) || p.length !== 3 || q.length !== 4 || ![...p, ...q, m.e, m.s].every(Number.isFinite)) return;
    if (Math.abs(p[0]) > 40000 || Math.abs(p[2]) > 40000 || p[1] < -50 || p[1] > 12000) return;
    c.st = { p: p.map(v => Math.round(v * 10) / 10), q: q.map(v => Math.round(v * 1000) / 1000), e: Math.max(0, Math.min(1, m.e)), fl: (m.fl | 0) & 64, s: m.s, at: now };
    // landed and stopped on your own deck: the deck crew refills the bombs and patches the airframe
    const own = W.CARRIERS[c.team];
    if (c.st.fl & 64 && c.st.s < W.SPEED + 4 && W.inDeck(own, p[0], p[2]) && Math.abs(p[1] - W.DECK.y) < 6) {
      if (c.bombsUsed || c.hp < P.PLANES[c.plane].hp) { c.bombsUsed = 0; c.hp = P.PLANES[c.plane].hp; this.send(c, { t: 'rearm', hp: c.hp }); }
    }
  }

  inShield(c) { return !!c.st && !!W.shieldAt(c.st.p[0], c.st.p[1], c.st.p[2]); }
  inOwnShield(c) { const s = c.st && W.shieldAt(c.st.p[0], c.st.p[1], c.st.p[2]); return !!s && s.team === c.team; }

  /** {id, n}: our guns hit pilot `id` n times. Not inside own shield (weapons safe), not on a shielded victim, enemies only, in range. */
  onHit(c, m) {
    const now = Date.now();
    if (this.phase !== 'play' || !c.alive || !c.st || now - c.lastHit < FIRE_GAP_MS || this.inOwnShield(c)) return;
    const o = this.clients.get(m.id | 0), n = Math.max(1, Math.min(24, m.n | 0));
    if (!o || o === c || !o.alive || !o.st || o.team === c.team || this.inShield(o)) return;
    const a = c.st.p, b = o.st.p;
    if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 2500) return;
    c.lastHit = now;
    this.damage(o, n * P.PLANES[c.plane].gun, c, 'guns');
  }

  damage(o, hits, by, why) {
    if (!o.alive) return;
    o.hp -= hits;
    if (o.hp <= 0) return this.kill(o, by, why);
    this.send(o, { t: 'dmg', hp: o.hp, by: by ? by.name : 'AA fire', why });
  }

  kill(o, by, why) {
    o.alive = false; o.hp = 0; o.d++;
    if (by && by !== o) by.k++;
    this.send(o, { t: 'down', by: by ? by.name : null, why });
    this.all({ t: 'kill', v: o.id, vn: o.name, by: by ? by.id : 0, bn: by ? by.name : '', why });
    this.roster();
  }

  /** {id, type, p, v, wind, seed}: a bomb leaves the plane (from where the pilot is, no more than the plane carries, never inside the own shield). */
  onBomb(c, m) {
    const now = Date.now(), B = BM.BOMBS[m.type], pl = P.PLANES[c.plane];
    const vec = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);
    if (this.phase !== 'play' || !c.alive || !c.st || !pl.bombs || m.type !== pl.bomb || !B || this.inOwnShield(c) || !vec(m.p, 3) || !vec(m.v, 3) || !vec(m.wind, 2) || !Number.isInteger(m.id) || !Number.isInteger(m.seed)) return;
    if (now - c.lastBomb < 120 || c.bombs.has(m.id) || c.bombsUsed >= pl.bombs) return;
    const a = c.st.p;
    if (Math.hypot(m.p[0] - a[0], m.p[1] - a[1], m.p[2] - a[2]) > 150 || Math.hypot(...m.v) > 320 || Math.hypot(...m.wind) > 20 || m.p[1] < 10) return;
    c.lastBomb = now; c.bombsUsed++;
    for (const [k, x] of c.bombs) if (now - x.at > 240000) c.bombs.delete(k);
    c.bombs.set(m.id, { type: m.type, p: m.p, v: m.v, wind: m.wind, seed: m.seed, at: now, tRel: this.clock(now) });
    this.all({ t: 'bomb', from: c.id, name: c.name, id: m.id, type: m.type, p: m.p, v: m.v, wind: m.wind, seed: m.seed }, c);
  }

  /** {id, p, kind}: the bomb landed. Re-fly it; if the impact is on its path, blow it up for everybody. */
  onImpact(c, m) {
    const rel = c.bombs.get(m.id | 0);
    if (!c.name || !rel || !Array.isArray(m.p) || m.p.length !== 3 || !m.p.every(Number.isFinite)) return;
    c.bombs.delete(m.id | 0);
    const now = Date.now();
    c.impacts = c.impacts.filter(t => now - t < 10000);
    if (c.impacts.length >= 20) return;
    c.impacts.push(now);
    const rep = this.replay(rel);
    if (!rep || Math.hypot(rep.p[0] - m.p[0], rep.p[1] - m.p[1], rep.p[2] - m.p[2]) > 45) return this.log(`${c.name}: bomb ${m.id} impact rejected (not on its flight path)`);
    W.update(this.clock());
    this.boom(c, BM.BOMBS[rel.type].w, rep.p, rep.p[1] > 5 ? 'deck' : 'water', m.id | 0);
  }

  /** Re-fly a released bomb with the carriers where they were at every moment of its fall (the decks move under it). */
  replay(rel) {
    const b = new BM.Bomb({ type: rel.type, p: rel.p, v: rel.v, wind: rel.wind, seed: rel.seed });
    let ev = null, n = 0;
    while (!ev && n++ < 6000) { W.update(rel.tRel + b.t); ev = b.advance(DT, W.bombEnv); }
    W.update(this.clock());
    return ev;
  }

  boom(c, w, p, kind, id) {
    const out = { t: 'boom', w, p: p.map(v => Math.round(v * 10) / 10), kind, from: c.id, id, hit: -1, dmg: 0 };
    if (this.phase === 'play') {
      // the carrier: a bomb on the deck does full damage, a near miss in the water does some (underwater blast on the hull)
      const enemy = W.CARRIERS[1 - c.team], d = W.distToDeck(enemy, p[0], p[2]);
      let dmg = 0;
      if (kind === 'deck' && d < 3) dmg = W.BOMB_DMG[w] || 0;
      else if (d < 30) dmg = Math.round((W.BOMB_DMG[w] || 0) * 0.45 * (1 - d / 30));
      if (dmg > 0) {
        this.hp[enemy.team] = Math.max(0, this.hp[enemy.team] - dmg); out.hit = enemy.team; out.dmg = dmg;
        this.log(`${c.name}'s ${w} hit ${enemy.name} for ${dmg} (${this.hp[enemy.team]} left)`);
      }
      // aircraft near the blast (the shield does not stop a bomb); enemies only
      const R = W.BLAST[w] || 50;
      for (const o of this.clients.values()) {
        if (!o.alive || !o.st || o.team === c.team) continue;
        const dd = Math.hypot(o.st.p[0] - p[0], o.st.p[1] - p[1], o.st.p[2] - p[2]);
        if (dd < R) this.kill(o, c, 'bomb blast');
      }
    }
    out.hp = this.hp;
    this.all(out);
    if (this.phase === 'play' && (this.hp[0] <= 0 || this.hp[1] <= 0)) this.endRound(this.hp[0] <= 0 ? 1 : 0);
  }

  endRound(winner) {                           // winner 0 / 1, or -1 for a draw (time ran out with both carriers equally damaged)
    this.endedAt = Date.now(); this.phase = 'over'; this.winner = winner; this.overAt = this.endedAt + OVER_MS;
    if (winner >= 0) this.wins[winner]++;
    this.log(winner >= 0 ? `${P.TEAMS[winner].name} won the round (${this.wins.join(' - ')})` : 'the round was drawn (time ran out)');
    for (const c of this.clients.values()) if (c.alive) { c.alive = false; }
    this.all(this.roundMsg());
    this.roster();
  }
  newRound() {
    this.phase = 'play'; this.winner = -1; this.hp = [W.HP, W.HP]; this.startedAt = Date.now(); W.update(0);
    for (const c of this.clients.values()) { c.alive = false; c.k = 0; c.d = 0; c.bombs.clear(); c.bombsUsed = 0; c.st = null; }
    this.all(this.roundMsg());
    this.roster();
  }

  update() {
    const now = Date.now();
    if (this.phase === 'over' && now >= this.overAt) return this.newRound();
    if (this.phase === 'play') {
      W.update(this.clock(now));
      if (now - this.startedAt > W.ROUND_MAX * 1000) this.endRound(this.hp[0] === this.hp[1] ? -1 : this.hp[0] > this.hp[1] ? 0 : 1);
    }
    if (++this.tick % SEND_EVERY) return;
    // each carrier's AA works on enemies inside its shield
    const dt = Math.min(0.5, (now - this.lastAA) / 1000); this.lastAA = now;
    if (this.phase === 'play') for (const o of this.clients.values()) {
      if (!o.alive || !o.st) continue;
      const s = W.shieldAt(o.st.p[0], o.st.p[1], o.st.p[2]);
      if (s && s.team !== o.team && !(o.st.fl & 64)) {
        o.aaAcc += dt * AA_HITS_PER_S;
        if (o.aaAcc >= 1) { const n = Math.floor(o.aaAcc); o.aaAcc -= n; this.send(o, { t: 'aa' }); this.damage(o, n, null, 'AA fire'); }
      } else o.aaAcc = 0;
    }
    const list = [];
    for (const c of this.clients.values()) {
      if (!c.name || !c.alive || !c.st || now - c.st.at > 5000) continue;
      const s = c.st;
      list.push(c.id, s.p[0], s.p[1], s.p[2], s.q[0], s.q[1], s.q[2], s.q[3], Math.round(s.e * 100) / 100, s.fl);
    }
    if (list.length) this.all({ t: 'snap', k: this.tick, p: list, hp: this.hp });
  }
}

module.exports = { CarrierServer };
