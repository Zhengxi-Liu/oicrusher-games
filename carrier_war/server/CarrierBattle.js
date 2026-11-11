'use strict';
/**
 * The battle of the flight sim's CARRIER map (flight_sim/server/SkyServer.js keeps one of these): two carriers, two navies, rounds.
 * Everything else (positions, guns, chat, bombs in flight) is the sky server's own; this adds only what the map is about:
 *   - the carriers' hit points: ONLY BOMBS hurt a carrier (a bomb on the deck does full damage, a near miss in the water some)
 *   - rounds: a carrier at 0 hit points (or the clock running out) ends the round, 20 s of results, then everything starts again
 *   (the carriers' AA guns are simulated in the browsers: carrier_war/client/CarrierAA.js)
 *   - the deck crew: landed and stopped on your own deck = bombs refilled (the sky server's per-sortie bomb budget is reset)
 *   - the IJN destroyer escort (W.ESCORTS): its own hit points; bombs, torpedoes, crashes and (a little) strafing hurt it; sunk = gone for the round
 *   - dive bombing: a bomb released in a steep dive does more damage (W.diveFactor)
 *   - BALANCE, the rally: a team that keeps losing rounds, or flies outnumbered, hits harder (rally(): its bombs, torpedoes and crashes do up to
 *     +50 % to ships). It self-corrects whatever the static numbers (planes, AA) still get wrong, and resets when that team wins a round.
 *
 *   - VETERAN (sorties): each safe return - landed and stopped on the own deck - from a sortie that damaged an enemy ship adds +10 % ordnance
 *     damage (at most +30 %); crashing, being shot down, respawning (a jump) or changing sides loses it. Every direct hit on the enemy carrier
 *     (bomb on the deck, torpedo into the hull) goes on the carrier-hits leaderboard at once (host.bank).
 *
 *   client -> server  ddhit {i, n}: n of my gun rounds hit escort i (strafing; checked against where I am and how fast I can shoot)
 *   server -> client  round {phase, winner, hp, wins, dd, t0, now, max, left} | boom {w, p, kind, hit, dmg, hp, dd, ddHit, direct, vet, ...} | ddmg {i, dmg, dd, from, by} | rearm {}
 *                     sortie {why: 'hit' | 'home' | 'lost', vet, total, vetUp, lostVet, how} - this pilot's direct hits (board total) and veteran bonus
 */
const W = require('../shared/CarrierWorld.js');
const P = require('../shared/CarrierPlanes.js');
const BM = require('../../flight_sim/shared/Bombs.js');

const OVER_MS = 20000;                      // the result screen before the next round
const STRAFE_FLOOR = 0.4;                   // machine guns and 20 mm wreck the topside (and the AA crews) but cannot sink a destroyer: strafing stops at 40 %
const STRAFE_DMG = 0.3;                     // hit points per .50 cal round that hits (x the aircraft's gun weight, CarrierPlanes gun)
const DT = BM.DT;
const RALLY_STEP = 0.15;                    // +15 % ordnance damage per round lost in a row ...
const RALLY_STREAK = 3;                     // ... counting at most three
const RALLY_CROWD = 1.3;                    // outnumbered: x sqrt(enemy pilots / own pilots), at most this much
const RALLY_MAX = 1.5;
const VET_STEP = 0.1;                       // +10 % ordnance damage per safe return from a sortie that hurt an enemy ship ...
const VET_MAX = 3;                          // ... at most three in a row
const BONUS_MAX = 1.8;                      // rally x veteran never more than this

class CarrierBattle {
  /** host: { clients: Map, log(...), toCarrier(msg, except), send(client, msg) } */
  constructor(host) {
    this.host = host;
    this.phase = 'play'; this.winner = -1; this.overAt = 0; this.startedAt = Date.now(); this.endedAt = 0;
    this.hp = [W.HP, W.HP];
    this.dd = W.ESCORTS.map(() => W.DD_HP); W.ESCORTS.forEach(e => (e.sunk = false));
    this.wins = [0, 0];
    this.streak = [0, 0];                    // rounds lost in a row, per team (the rally)
    this.lastAA = Date.now(); this.lastSteer = 0; this.lastFleet = 0;
    W.resetFleet(); W.update(0);
  }
  teamOf(plane) { return P.PLANES[plane] ? P.PLANES[plane].team : 0; }
  /** Seconds into the round (frozen once the round is over: the carriers stop where the battle ended). */
  clock(now = Date.now()) { return ((this.phase === 'over' ? this.endedAt : now) - this.startedAt) / 1000; }
  /** The rally factor of a team: how much harder its ordnance hits ships, for losing rounds in a row and for flying outnumbered. */
  rally(team) {
    const n = [0, 0]; for (const c of this.pilots()) n[c.team === 1 ? 1 : 0]++;
    const crowd = n[team] > 0 ? Math.min(RALLY_CROWD, Math.max(1, Math.sqrt(n[1 - team] / n[team]))) : 1;
    return Math.round(Math.min(RALLY_MAX, (1 + RALLY_STEP * Math.min(RALLY_STREAK, this.streak[team])) * crowd) * 100) / 100;
  }
  /** The fleet's state for the browsers (they integrate the same ship model from it: CarrierWorld.applySnap). */
  fleetMsg() { return { t: 'fleet', ...W.snap() }; }
  roundMsg() { return { t: 'round', fleet: W.snap(), phase: this.phase, winner: this.winner, hp: this.hp, wins: this.wins, dd: this.dd, rally: [this.rally(0), this.rally(1)], t0: this.startedAt, now: Date.now(), max: W.ROUND_MAX, left: this.phase === 'over' ? Math.max(0, this.overAt - Date.now()) : 0 }; }
  pilots() { return [...this.host.clients.values()].filter(c => c.name && c.map === 'carrier'); }

  /** Where this pilot is, relative to the carriers. */
  inShield(c) { return !!c.st && !!W.shieldAt(c.st.p[0], c.st.p[1], c.st.p[2]); }
  inOwnShield(c) { const s = c.st && W.shieldAt(c.st.p[0], c.st.p[1], c.st.p[2]); return !!s && s.team === c.team; }

  /** The pilot's sortie: n = sortie number (a bomb earns the veteran step only for the sortie it left in), hits = direct hits this sortie, dmg = hurt an enemy ship, vet = safe returns in a row. */
  sortie(c) { return c.cw || (c.cw = { n: 1, hits: 0, dmg: false, vet: 0, team: c.team, x: 0 }); }
  sortieMsg(c, why, extra) { const S = this.sortie(c); this.host.send(c, { t: 'sortie', why, vet: S.vet, ...extra }); }
  /** Landed home after hurting the enemy: one veteran step more. */
  homeSortie(c) {
    const S = this.sortie(c);
    if (S.vet < VET_MAX) { S.vet++; this.host.log(`${c.name} came home: veteran ${S.vet}`); this.sortieMsg(c, 'home', { vetUp: true }); }
    S.n++; S.hits = 0; S.dmg = false;
  }
  /** Crashed / shot down / respawned / changed sides: the veteran bonus is gone. */
  loseSortie(c, why) {
    const S = this.sortie(c), hadVet = S.vet;
    S.n++; S.hits = 0; S.dmg = false; S.vet = 0;
    if (hadVet) { this.host.log(`${c.name} lost veteran ${hadVet} (${why})`); this.sortieMsg(c, 'lost', { lostVet: hadVet, how: why }); }
  }
  vetOf(c) { return 1 + VET_STEP * this.sortie(c).vet; }

  /** A position report: landed and stopped on the own deck refills the bomb budget and tells the pilot's browser. */
  onState(c) {
    const s = c.st, own = W.CARRIERS[c.team];
    W.update(this.clock());
    // its velocity (for the ships' lookouts: a bomber diving at them, a torpedo plane coming in low)
    const now = Date.now(), pv = c.cwPrev;
    if (pv && now - pv.at > 30 && now - pv.at < 1500) { const dt = (now - pv.at) / 1000, v = [0, 1, 2].map(i => (s.p[i] - pv.p[i]) / dt); c.cwVel = c.cwVel ? c.cwVel.map((x, i) => x * 0.5 + v[i] * 0.5) : v; }
    // the sortie: a crash, a jump (respawn / back to the menu deck) or a change of side loses it; stopped on the own deck brings it home
    const S = this.sortie(c), jump = pv && Math.hypot(s.p[0] - pv.p[0], s.p[1] - pv.p[1], s.p[2] - pv.p[2]) > 120 + 320 * (now - pv.at) / 1000;
    if (S.team !== c.team) { this.loseSortie(c, 'changed sides'); S.team = c.team; }
    else if (s.x && !S.x) this.loseSortie(c, 'crashed');
    else if (jump && !s.x && !S.home) this.loseSortie(c, 'respawned');            // a jump from the own deck (to the menu, another plane) is no loss
    S.x = s.x;
    c.cwPrev = { p: s.p.slice(), at: now };
    const home = !s.x && s.fl & 64 && s.s < W.SPEED + 4 && W.inDeck(own, s.p[0], s.p[2]) && Math.abs(s.p[1] - W.DECK.y) < 6;
    if (home && S.dmg) this.homeSortie(c);
    S.home = home;
    if (home && c.bombKg) { c.bombKg = 0; this.host.send(c, { t: 'rearm' }); }
  }

  /** The bomb leaves with the time into the round, so it can be re-flown over the decks where they were. */
  stamp(rel, c, id) {
    rel.tRel = this.clock();
    if (c) rel.sortie = this.sortie(c).n;
    if (c && this.phase === 'play') { W.update(rel.tRel); W.addThreat(rel, c.team, BM, `${c.id}:${id | 0}`); }       // the ships' lookouts see it go
  }

  /** {id, p, kind}: the bomb landed at m.p. Re-fly it; if that is on its path, blow it up for the whole map. Returns false when rejected. */
  onImpact(c, rel, m) {
    W.dropThreat(`${c.id}:${m.id | 0}`);
    const rep = this.replay(rel);
    if (!rep || Math.hypot(rep.p[0] - m.p[0], rep.p[1] - m.p[1], rep.p[2] - m.p[2]) > 45) { this.host.log(`${c.name}: bomb ${m.id} impact rejected (not on its flight path)`); return false; }
    W.update(this.clock());
    if (BM.BOMBS[rel.type].torp && rep.kind !== 'hull') return true;                    // a torpedo that broke up, ran out of steam or fell on a deck: no explosion
    this.boom(c, BM.BOMBS[rel.type].w, rep.p, rep.kind === 'hull' ? 'hull' : rep.p[1] > 5 ? 'deck' : 'water', m.id | 0, BM.BOMBS[rel.type].torp ? 1 : W.diveFactor(rel.v), rel.sortie === this.sortie(c).n);
    return true;
  }

  /** Re-fly a released bomb with the carriers where they were at every moment of its fall (the decks move under it). */
  replay(rel) {
    const b = new BM.Bomb({ type: rel.type, p: rel.p, v: rel.v, wind: rel.wind, seed: rel.seed });
    let ev = null, n = 0;
    while (!ev && n++ < 6000) { W.update((rel.tRel || 0) + b.t); ev = b.advance(DT, W.bombEnv); }
    W.update(this.clock());
    return ev;
  }

  /** live: the bomb left on the pilot's present sortie (one from a sortie already lost still explodes, but earns nothing). */
  boom(c, w, p, kind, id, dive = 1, live = false) {
    const vet = live ? this.vetOf(c) : 1, rally = Math.round(Math.min(BONUS_MAX, this.rally(c.team) * vet) * 100) / 100;
    const out = { t: 'boom', w, p: p.map(v => Math.round(v * 10) / 10), kind, water: kind === 'water', from: c.id, id, rec: null, dud: false, hit: -1, dmg: 0, ddHit: -1, dive: Math.round(dive * 100) / 100, rally, vet: Math.round(vet * 100) / 100, direct: false };
    const esc = this.phase === 'play' && W.ESCORTS.find(e => !e.sunk && e.team !== c.team && (kind === 'hull' ? W.ddIn(e, p[0], p[2], 3) : W.distToDD(e, p[0], p[2]) < 25));
    if (esc) {
      // the destroyer: thin plating, no armour - a direct hit does full (dive) damage, a near miss in the water springs the hull plates
      const d = W.distToDD(esc, p[0], p[2]);
      let dmg = 0;
      if (w === 'tp') { if (kind === 'hull') dmg = W.BOMB_DMG.tp; }
      else if (kind === 'deck' && d < 2) dmg = Math.round((W.BOMB_DMG[w] || 0) * dive);
      else dmg = Math.round((W.BOMB_DMG[w] || 0) * 0.6 * (1 - d / 25));
      dmg = Math.round(dmg * rally);
      if (dmg > 0) { out.ddHit = esc.idx; out.dmg = dmg; this.hurtEscort(esc, dmg, c, w); if (live) this.sortie(c).dmg = true; }
    } else if (this.phase === 'play') {
      // the carrier: a bomb on the deck does full damage, a near miss in the water does some (underwater blast on the hull)
      const enemy = W.CARRIERS[1 - c.team], d = W.distToDeck(enemy, p[0], p[2]);
      let dmg = 0, direct = false;
      if (w === 'tp') { if (kind === 'hull') { dmg = W.BOMB_DMG.tp; direct = true; } }      // a torpedo only counts when it runs into the hull
      else if (kind === 'deck' && d < 3) { dmg = Math.round((W.BOMB_DMG[w] || 0) * dive); direct = true; }    // a dive-bombed hit goes through the flight deck into the hangar
      else if (d < 30) dmg = Math.round((W.BOMB_DMG[w] || 0) * 0.45 * (1 - d / 30));
      dmg = Math.round(dmg * rally);
      if (dmg > 0) {
        this.hp[enemy.team] = Math.max(0, this.hp[enemy.team] - dmg); out.hit = enemy.team; out.dmg = dmg; out.direct = direct;
        const S = this.sortie(c);
        if (live) S.dmg = true;
        if (direct) { S.hits++; this.sortieMsg(c, 'hit', { total: this.host.bank(c, S.hits) }); }
        this.host.log(`${c.name}'s ${w} hit ${enemy.name} for ${dmg}${dive > 1 ? ` (dive x${dive.toFixed(2)})` : ''}${rally > 1 ? ` (rally x${rally})` : ''} (${this.hp[enemy.team]} left)`);
      }
    }
    out.hp = this.hp; out.dd = this.dd;
    this.host.toCarrier(out);
    if (this.phase === 'play' && (this.hp[0] <= 0 || this.hp[1] <= 0)) this.endRound(this.hp[0] <= 0 ? 1 : 0);
  }

  /** {p}: this pilot's aircraft crashed at p. If that is on a carrier (either one), the carrier takes damage by the aircraft's weight and speed.
   *  Checked against the last position report so a browser cannot claim a crash far from where it flew. */
  onCrash(c, m) {
    const now = Date.now();
    if (this.phase !== 'play' || !c.st || !Array.isArray(m.p) || m.p.length !== 3 || !m.p.every(Number.isFinite) || now - (c.lastCrashHit || 0) < 4000) return;
    W.update(this.clock(now));
    const p = m.p;
    if (Math.hypot(p[0] - c.st.p[0], p[1] - c.st.p[1], p[2] - c.st.p[2]) > 150) return;
    const ship = W.shipAt(p[0], p[1], p[2]); if (!ship) return;
    const speed = Math.min(150, Math.max(0, Number.isFinite(c.st.s) ? c.st.s : 0)), dmg = Math.round((W.CRASH_DMG[c.plane] || 100) * Math.max(0.3, Math.min(1.6, speed / 70)) * (ship.team !== c.team ? this.rally(c.team) : 1));
    c.lastCrashHit = now;
    if (ship.dd) { if (ship.team !== c.team) this.hurtEscort(ship, dmg, c, 'crash'); return; }
    this.hp[ship.team] = Math.max(0, this.hp[ship.team] - dmg);
    this.host.log(`${c.name}'s ${c.plane} crashed into ${ship.name} for ${dmg} (${this.hp[ship.team]} left)`);
    this.host.toCarrier({ t: 'cdmg', hit: ship.team, dmg, hp: this.hp, from: c.id });
    if (this.hp[0] <= 0 || this.hp[1] <= 0) this.endRound(this.hp[0] <= 0 ? 1 : 0);
  }

  /** Damage to an escort; at 0 it is sunk (for the rest of the round: it does not end the round). Tells the map. */
  hurtEscort(e, dmg, c, by) {
    const i = e.idx;
    this.dd[i] = Math.max(0, this.dd[i] - dmg);
    if (this.dd[i] <= 0) e.sunk = true;
    if (by !== 'guns' || e.sunk) this.host.log(`${c.name}'s ${by} hit ${e.name} for ${dmg} (${this.dd[i]} left${e.sunk ? ', SUNK' : ''})`);
    if (by === 'crash' || by === 'guns') this.host.toCarrier({ t: 'ddmg', i, dmg, dd: this.dd, from: c.id, by });
  }

  /** {i, n}: n of this pilot's gun rounds hit escort i. Checked: the round is on, the pilot is an enemy, close enough to shoot it, and no faster than the guns fire. */
  onStrafe(c, m) {
    const now = Date.now(), e = W.ESCORTS[m.i | 0], n = Number(m.n);
    if (this.phase !== 'play' || !e || e.sunk || e.team === c.team || !c.st || !Number.isFinite(n) || n <= 0) return;
    W.update(this.clock(now));
    const dt = Math.min(2, (now - (c.lastStrafe || 0)) / 1000); c.lastStrafe = now;
    if (Math.hypot(c.st.p[0] - e.x, c.st.p[1], c.st.p[2] - e.z) > 1500) return;
    const k = Math.min(n, 90 * dt + 4), pl = P.PLANES[c.plane];                  // six .50s fire ~80 rounds a second between them
    const floor = W.DD_HP * STRAFE_FLOOR, dmg = Math.min(Math.max(0, this.dd[e.idx] - floor), Math.round(k * STRAFE_DMG * (pl ? pl.gun : 1) * 10) / 10);
    if (dmg > 0) this.hurtEscort(e, dmg, c, 'guns');
  }

  endRound(winner) {                           // winner 0 / 1, or -1 for a draw (time ran out with both carriers equally damaged)
    this.endedAt = Date.now(); this.phase = 'over'; this.winner = winner; this.overAt = this.endedAt + OVER_MS;
    if (winner >= 0) { this.wins[winner]++; this.streak[winner] = 0; this.streak[1 - winner]++; }
    this.host.log(winner >= 0 ? `${P.TEAMS[winner].name} won the round (${this.wins.join(' - ')})` : 'the round was drawn (time ran out)');
    this.host.toCarrier(this.roundMsg());
  }
  newRound() {
    this.phase = 'play'; this.winner = -1; this.hp = [W.HP, W.HP]; this.startedAt = Date.now();
    this.dd = W.ESCORTS.map(() => W.DD_HP); W.ESCORTS.forEach(e => (e.sunk = false));
    W.resetFleet(); W.update(0);
    for (const c of this.pilots()) { c.bombs.clear(); c.bombKg = 0; c.st = null; c.cwPrev = null; }      // everybody is put back on the deck: not a respawn
    this.host.toCarrier(this.roundMsg());
  }

  /** Every server tick (60 Hz): the round clock, and the AA a few times a second. */
  update(tick) {
    const now = Date.now();
    if (this.phase === 'over' && now >= this.overAt) return this.newRound();
    if (this.phase === 'play') {
      W.update(this.clock(now));
      // the helms: every ship dodges what is coming at her (CarrierWorld.steer); a rudder change goes out at once, the state every second anyway
      if (now - this.lastSteer >= 250) {
        this.lastSteer = now;
        const air = this.pilots().filter(c => c.st && !c.st.x && c.cwVel && now - c.st.at < 2000).map(c => { const pl = P.PLANES[c.plane]; return { team: c.team, p: c.st.p, v: c.cwVel, bomb: pl && pl.bombs ? pl.bomb : null }; });
        if (W.steer(air) || now - this.lastFleet > 1000) { this.lastFleet = now; this.host.toCarrier(this.fleetMsg()); }
      }
      if (now - this.startedAt > W.ROUND_MAX * 1000) this.endRound(this.hp[0] === this.hp[1] ? -1 : this.hp[0] > this.hp[1] ? 0 : 1);
    }
  }
}

module.exports = { CarrierBattle };
