/**
 * The CARRIER map of the flight sim (client side). The flight sim's main.js stays the game - same page, menu, HUD, physics, guns, bombs,
 * chat, damage, other pilots; this module is only what makes the map a different place:
 *   - the world: an open sea (the island is hidden), two carriers and an escort steaming north at 15 kt. The server's helms dodge bombs and
 *     torpedoes (CarrierWorld.steer); this browser integrates the same ship model from the server's 'fleet' snapshots (CarrierWorld.applySnap),
 *     so the ships turn, and heel outward in the turn (the flight deck slants), exactly where the server has them
 *   - the carrier mechanics: flying in the moving deck's frame, the catapult, the tailhook and the arrestor wires, the deck crew (rearm)
 *   - the battle: carrier hit points, rounds and their result screen, enemy AA, the sinking
 *   - the IJN destroyer escort (DestroyerScene.js): sails with the fleet off the IJN carrier's port side, fires its AA, takes bombs / torpedoes /
 *     crashes / strafing (the server keeps its hit points: 'boom'.dd, 'ddmg', 'round'.dd) and sinks
 * main.js calls into it where the map matters (guarded by mapId === 'carrier').
 */
import * as THREE from 'three';
import { createOcean } from '../../flight_sim/client/Ocean.js?v=7';
import { buildCarrier } from './CarrierScene.js?v=20';
import { buildDestroyer } from './DestroyerScene.js?v=3';
import { CarrierAA } from './CarrierAA.js?v=6';
import { mergeStatic, referenced } from '../../flight_sim/client/MergeStatic.js?v=2';

const CW = window.CWWorld, CP = window.CWPlanes, FP = window.FSPhysics;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STEP = 1 / 60;
export const TEAM_COL = ['#4f8fe0', '#e05a52'];
export const PLAY_R = 14000;                               // leave this far from the middle of the battle and you have left it

/** A ship's wake as she really steered: a ribbon of foam along her stern's track (it curves when she turns, and fades with age). */
const TRAIL_N = 90, TRAIL_DT = 1.5;
class Wake {
  constructor(parent, w0, w1, stern, alpha) {
    this.w0 = w0; this.w1 = w1; this.stern = stern; this.alpha = alpha; this.pts = []; this.t = 0;
    const g = new THREE.BufferGeometry(), n = TRAIL_N + 1;
    this.pos = new Float32Array(n * 2 * 3); this.col = new Float32Array(n * 2 * 4);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    const idx = []; for (let i = 0; i < TRAIL_N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, fog: true }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 1; parent.add(this.mesh); this.geo = g;
  }
  clear() { this.pts.length = 0; this.mesh.visible = false; }
  update(dt, I, live) {
    const st = CW.toWorld(I, 0, 0, this.stern);
    if (!live) { this.clear(); return; }
    if (this.pts.length && Math.hypot(st[0] - this.pts[0][0], st[2] - this.pts[0][1]) > 60) this.pts.length = 0;      // the ship jumped (a new round, the first snapshot)
    this.t -= dt;
    if (this.t <= 0 || !this.pts.length) { this.t = TRAIL_DT; this.pts.unshift([st[0], st[2], 0]); if (this.pts.length > TRAIL_N) this.pts.pop(); }
    for (const p of this.pts) p[2] += dt;
    const P = [[st[0], st[2], 0], ...this.pts], n = Math.min(P.length, TRAIL_N + 1);
    if (n < 3) { this.mesh.visible = false; return; }
    this.mesh.visible = true;
    for (let i = 0; i < TRAIL_N + 1; i++) {
      const k = Math.min(i, n - 1), a = P[k], b = P[Math.min(n - 1, k + 1)], c = P[Math.max(0, k - 1)];
      let dx = b[0] - c[0], dz = b[1] - c[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const age = a[2], f = Math.min(1, age / (TRAIL_N * TRAIL_DT)), w = (this.w0 + (this.w1 - this.w0) * Math.sqrt(f)) / 2;
      const al = i >= n - 1 ? 0 : this.alpha * (1 - f) * Math.min(1, age / 4 + 0.15);
      for (let sd = 0; sd < 2; sd++) {
        const sg = sd ? 1 : -1, o = (i * 2 + sd) * 3, q = (i * 2 + sd) * 4;
        this.pos[o] = a[0] - dz * w * sg; this.pos[o + 1] = 0.18; this.pos[o + 2] = a[1] + dx * w * sg;
        this.col[q] = 0.93; this.col[q + 1] = 0.96; this.col[q + 2] = 1; this.col[q + 3] = al;
      }
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true;
  }
}

export class CarrierMap {
  /** host: { say(text, secs, color), audio, fx, camera, onRoundStart() } */
  constructor(scene, sunDir, host) {
    this.host = host;
    this.group = new THREE.Group(); this.group.visible = false; scene.add(this.group);
    this.ocean = createOcean({ sunDir }); this.ocean.mesh.visible = false; scene.add(this.ocean.mesh);
    this.carriers = CW.CARRIERS.map(info => buildCarrier(info, this.group));
    this.escorts = CW.ESCORTS.map(info => buildDestroyer(info, this.group));
    this.ships = [...this.carriers, ...this.escorts];
    for (const sh of this.ships) mergeStatic(sh.group, { keep: referenced(sh), byLook: true });      // hundreds of static fittings per ship: one draw call per material
    for (const sh of this.ships) sh.group.rotation.order = 'YXZ';                  // heading, then the heel (CarrierWorld.toWorld)
    this.wakes = this.ships.map(sh => sh.info.dd ? new Wake(this.group, 14, 70, 60, 0.32) : new Wake(this.group, 40, 140, 150, 0.36));
    this.aa = new CarrierAA(scene, host.fx, this.ships, host);
    this.hp = [CW.HP, CW.HP];
    this.dd = CW.ESCORTS.map(() => CW.DD_HP);
    this.strafe = CW.ESCORTS.map(() => 0); this.strafeAt = 0;
    this.round = { phase: 'play', winner: -1, hp: this.hp, wins: [0, 0], max: CW.ROUND_MAX };
    this.prevPose = null; this.deckVel = null;
    this.clock = { t0: Date.now(), off: 0, frozen: null };
    this.hookDown = false; this.hookPos = 0; this.hooked = false; this.catMsg = false; this.outT = 0; this.aaWarn = 0;
    this.shown = false;
  }
  clearAA() { this.aaWarn = 0; this.aa.clear(); }
  show(on) { this.shown = on; this.group.visible = on; this.ocean.mesh.visible = on; if (on) this.setHp(this.hp); $('cwHud').classList.toggle('on', on); if (!on) $('cwResult').classList.remove('on'); }

  // ---------- the round clock: the carriers sail as a function of it; t0 and the server's `now` arrive with every 'round' / 'welcome'
  roundT() { return this.clock.frozen !== null ? this.clock.frozen : Math.max(0, (Date.now() + this.clock.off - this.clock.t0) / 1000); }
  /** Offline practice (no server): this browser runs the helms itself - the ships dodge my bombs and torpedoes, and anticipate my runs. */
  offlineRelease(rel, team) { CW.update(this.roundT()); CW.addThreat({ ...rel, tRel: this.roundT() }, team, window.FSBombs, '0:' + rel.id); }
  offlineHelm(me) {
    const now = performance.now(); if (now - (this.helmAt || 0) < 250) return;
    this.helmAt = now; CW.update(this.roundT());
    const bomb = me && me.bomb ? (me.bomb === 'tp' ? 'tp' : 'b500') : null;
    CW.steer(me && bomb ? [{ team: me.team, p: me.p.slice(), v: me.v.slice(), bomb }] : []);
  }
  /** The server's fleet snapshot ('fleet', and 'round'.fleet). */
  onFleet(m) { CW.applySnap(m); }
  syncClock(m) { if (m.t0) { this.clock.t0 = m.t0; this.clock.off = m.now - Date.now(); } this.clock.frozen = m.phase === 'over' ? Math.max(0, (m.now - m.t0) / 1000) : null; if (m.max) this.round.max = m.max; }
  setHp(h) {
    this.hp[0] = h[0]; this.hp[1] = h[1];
    this.carriers.forEach((c, i) => { const f = Math.max(0, this.hp[i] / CW.HP); $(`cwb${i}`).querySelector('.fl').style.width = (f * 100) + '%'; $(`cwb${i}`).querySelector('.v').textContent = Math.round(f * 100) + '%'; });
  }
  /** The escorts' hit points (from the server). A destroyer at 0 starts going down where she is; back at full strength (a new round) she is afloat again. */
  setDD(h, fx) {
    if (!Array.isArray(h)) return;
    this.escorts.forEach((e, i) => {
      const v = Number.isFinite(h[i]) ? h[i] : CW.DD_HP, I = CW.ESCORTS[i]; this.dd[i] = v;
      if (v <= 0 && !I.sunk) {
        I.sunk = true; e.sink = 0.001; e.sinkAt = [I.x, I.z];
        if (fx && this.shown) { fx.explode([I.x, 6, I.z - 5], [0, 0, 0], { violence: 1, fuel: 2.4, water: false }); fx.wreckFire([I.x, 6, I.z + 4], { scale: 1.2, secs: 30, light: false }); }
      } else if (v > 0 && (I.sunk || e.sink > 0)) { I.sunk = false; e.sink = 0; e.sinkAt = null; e.group.visible = true; e.group.rotation.set(0, 0, 0); e.group.position.y = 0; e.wake.visible = true; }
    });
  }
  /** Rounds struck the destroyer at p (any pilot's: the AA crews there take cover; mine are counted and reported to the server). */
  strafed(p, mine, team) {
    const i = this.escorts.findIndex(e => !e.info.sunk && CW.distToDD(e.info, p[0], p[2]) < 3); if (i < 0) return;
    this.aa.suppress(p);
    if (mine && this.round.phase === 'play' && this.escorts[i].info.team !== team) this.strafe[i]++;
  }
  /** Every frame: send my strafing hits (batched, twice a second). */
  flushStrafe(send) {
    const now = performance.now(); if (now - this.strafeAt < 500) return;
    this.strafeAt = now;
    this.strafe.forEach((n, i) => { if (n > 0) { send({ t: 'ddhit', i, n }); this.strafe[i] = 0; } });
  }
  /** 'ddmg' from the server: the destroyer was damaged by a crash or by strafing. */
  onEscortDmg(m, feed, myId) {
    const was = this.dd[m.i]; this.setDD(m.dd, this.host.fx);
    const I = CW.ESCORTS[m.i]; if (!I) return;
    if (m.by === 'crash') feed(`💥 ${esc(I.name)} damaged by a crash: -${Math.round(m.dmg / CW.DD_HP * 100)}%`);
    if (was > 0 && this.dd[m.i] <= 0) { feed(`🔥 ${esc(I.name)} has been sunk!`); if (m.from === myId) this.host.say(`You sank ${I.name}!`, 4, '#7cff9a'); }
  }

  /** 'round' from the server (and `welcome.round`). Returns 'over' / 'start' on a change of phase, so the host can end the flight. */
  onRound(m) {
    const was = this.round.phase;
    this.round = { phase: m.phase, winner: m.winner, hp: m.hp, wins: m.wins, max: m.max || this.round.max }; this.syncClock(m); this.setHp(m.hp); if (m.dd) this.setDD(m.dd);
    if (m.fleet) CW.applySnap(m.fleet); else if (was === 'over' && m.phase === 'play') CW.resetFleet();
    $('cwScore').textContent = `${m.wins[0]} : ${m.wins[1]}`;
    const r = $('cwResult');
    // the rally (server CarrierBattle.rally): a team that keeps losing or flies outnumbered hits harder
    const rally = (m.rally || [1, 1]).map((k, i) => k > 1.001 ? `${CP.TEAMS[i].short} rallies: bombs & torpedoes +${Math.round((k - 1) * 100)}%` : '').filter(Boolean).join(' · ');
    if (m.phase === 'over') {
      r.classList.add('on');
      r.innerHTML = m.winner < 0 ? `<span>DRAW</span><small>Time ran out with both carriers equally damaged · next round in ${Math.round(m.left / 1000)} s</small>`
        : `<span style="color:${TEAM_COL[m.winner]}">${esc(CP.TEAMS[m.winner].name.toUpperCase())} WIN</span><small>${this.hp[1 - m.winner] <= 0 ? esc(CW.CARRIERS[1 - m.winner].name) + ' has been sunk' : 'Time ran out - ' + esc(CW.CARRIERS[1 - m.winner].name) + ' was more damaged'} · next round in ${Math.round(m.left / 1000)} s${rally ? '<br>' + esc(rally) : ''}</small>`;
      if (m.winner >= 0 && this.hp[1 - m.winner] <= 0) this.carriers[1 - m.winner].sink = Math.max(this.carriers[1 - m.winner].sink, 0.001);
      return was === 'over' ? null : 'over';
    }
    r.classList.remove('on');
    if (was === 'over') { this.carriers.forEach(c => { c.sink = 0; c.group.position.y = 0; }); if (rally) this.host.say(rally, 5, '#ffd27a'); return 'start'; }
    return null;
  }

  // ---------- placement
  /** Where a team's aircraft begins: on its deck, behind the catapult mark, pointing up the deck (slot = 0..8, so pilots starting together do not overlap). */
  spawn(team, slot) { CW.update(this.roundT()); return CW.spawnPoint(team, slot); }
  /** Put the aircraft on the deck, engine idling, hook up - used by the menu (parked) and at the start of a flight. */
  place(ac, team, slot) {
    const sp = this.spawn(team, slot), c = CW.CARRIERS[team]; this.prevPose = null;
    ac.reset({ x: sp.x, y: 0, z: sp.z, yaw: sp.yaw, roll: c.heel, onGround: true, flaps: 1, throttle: 0 });
    ac.pos[1] = sp.y + ac.spec.restHeight; ac.vel = this.deckVelAt(c, sp.x, sp.z); ac.ctl.gear = 1; ac.gearPos = 1; ac.gust = 0; ac.wind = [0, 0, 0];
    this.hookDown = false; this.hookPos = 0; this.hooked = false; this.catMsg = false; this.outT = 0;
    return sp;
  }
  /** The menu: the parked aircraft rides its carrier. */
  park(ac, team, slot) {
    const sp = this.spawn(team, slot), c = CW.CARRIERS[team]; ac.pos[0] = sp.x; ac.pos[2] = sp.z; ac.pos[1] = sp.y + ac.spec.restHeight;
    ac.q = FP.qFromEuler(sp.yaw, ac.spec.restPitch || 0, c.heel); this.prevPose = null;
  }
  /** The velocity of the deck at (x, z): the ship's speed ahead plus her turn (yaw rate x lever arm). */
  deckVelAt(c, x, z) { const dx = x - c.x, dz = z - c.z; return [-c._sy * CW.SPEED + c.r * dz, 0, -c._cy * CW.SPEED - c.r * dx]; }
  /** The carrier whose deck frame the aircraft is in (on, or just above / around its deck), or null. */
  deckShip(ac) {
    for (const c of CW.CARRIERS) {
      const L = CW.loc(c, ac.pos[0], ac.pos[2], CW.DECK.y), h = CW.deckY(c, L[0]);
      if (ac.pos[1] <= h + 28 && ac.pos[1] >= h - 3 && Math.abs(L[0]) <= CW.DECK.hw + 25 && Math.abs(L[1]) <= CW.DECK.len / 2 + 25) return c;
    }
    return null;
  }

  // ---------- one physics step: the decks move and turn, so on (or just above) a deck the aircraft is flown in the carrier's frame of reference:
  // carry it with the deck's real motion since the last step (displacement AND the turn: position, heading, velocity), take the deck's velocity
  // under it off, let the physics run (the air then moves past at -deck velocity: wind over the deck), and put the velocity back.
  // The deck rides the wall-clock round time while the physics runs in fixed steps, and the server's snapshots can nudge the ships: carrying by the
  // real pose change (not speed x step) keeps a parked aircraft exactly where it sits on the deck.
  deckFrame(ac) { return this.deckShip(ac) ? 1 : 0; }
  before(ac) {
    CW.update(this.roundT());
    const c = this.deckShip(ac), P = this.prevPose;
    if (c && P && P.c === c) {
      const d = c.yaw - P.yaw, L = (() => { const dx = ac.pos[0] - P.x, dz = ac.pos[2] - P.z, cy = Math.cos(P.yaw), sy = Math.sin(P.yaw); return [dx * cy - dz * sy, dx * sy + dz * cy]; })();
      ac.pos[0] = c.x + L[0] * c._cy + L[1] * c._sy; ac.pos[2] = c.z - L[0] * c._sy + L[1] * c._cy;
      if (d) {
        const cd = Math.cos(d), sd = Math.sin(d), vx = ac.vel[0], vz = ac.vel[2];
        ac.vel[0] = vx * cd + vz * sd; ac.vel[2] = -vx * sd + vz * cd;
        ac.q = FP.qmul([0, Math.sin(d / 2), 0, Math.cos(d / 2)], ac.q);
      }
    }
    this.prevPose = c ? { c, x: c.x, z: c.z, yaw: c.yaw } : null;
    if (!c) return 0;
    const v = this.deckVel = this.deckVelAt(c, ac.pos[0], ac.pos[2]);
    ac.vel[0] -= v[0]; ac.vel[2] -= v[2]; ac.wind[0] = -v[0]; ac.wind[2] = -v[2];
    return 1;
  }
  after(ac, F) { if (F) { const v = this.deckVel; ac.vel[0] += v[0]; ac.vel[2] += v[2]; ac.wind[0] = 0; ac.wind[2] = 0; } this.hookPos += ((this.hookDown ? 1 : 0) - this.hookPos) * Math.min(1, STEP * 3); }
  toggleHook() { this.hookDown = !this.hookDown; this.host.say(this.hookDown ? 'Tailhook DOWN' : 'Tailhook up', 1.2); this.host.audio.click(); }
  /** A wheel touched down: only a touchdown in the wire zone, hook down, hooks a wire. */
  onTouch(ac, e, team) {
    const own = CW.CARRIERS[team], zl = CW.loc(own, e.pos[0], e.pos[2], CW.DECK.y)[1], fromStern = CW.DECK.len / 2 - zl;
    if (!CW.inDeck(own, e.pos[0], e.pos[2]) || e.pos[1] < CW.DECK.y - 5) return;
    if (ac.speed > 25 && this.hookDown && fromStern >= CW.WIRES.from - 6 && fromStern <= CW.WIRES.to + 6) { this.hooked = true; this.host.say('WIRE! Arrested', 2, '#7cff9a'); }
    else if (ac.speed > 25) this.host.say(!this.hookDown ? 'Hook is UP (H) - no wire, go around!' : fromStern < CW.WIRES.from ? 'Too short - no wire, go around!' : 'Missed the wires - bolter!', 2, '#ffc83a');
  }
  /** Arrestor wire, catapult and deck crew. Returns true when the deck crew rearmed the aircraft (host refills bombs / rounds / airframe). */
  deckStep(ac, team, needsRearm) {
    const own = CW.CARRIERS[team], L = CW.loc(own, ac.pos[0], ac.pos[2], CW.DECK.y), zloc = L[1], V = CW.SPEED, af = ac.attitude.fwd;
    const fwd = [af[0] * own._cy - af[2] * own._sy, af[1], af[0] * own._sy + af[2] * own._cy];       // the aircraft's nose in the ship's frame (-z = up the deck)
    const dv = this.deckVelAt(own, ac.pos[0], ac.pos[2]), h = CW.deckY(own, L[0]);
    const onDeck = Math.abs(L[0]) <= CW.DECK.hw && Math.abs(L[1]) <= CW.DECK.len / 2 && ac.pos[1] < h + 8 && ac.pos[1] > h - 3;
    if (!ac.onGround) { this.hooked = false; this.catMsg = false; }
    if (this.hooked && ac.onGround) {                                        // the wire stops us relative to the moving deck
      const rx = ac.vel[0] - dv[0], rz = ac.vel[2] - dv[2], sp = Math.hypot(rx, rz);
      if (sp < 2.5) this.hooked = false;
      else { const k = Math.max(0, 1 - 24 * STEP / sp); ac.vel[0] = rx * k + dv[0]; ac.vel[2] = rz * k + dv[2]; }
    }
    if (onDeck && ac.onGround && !this.hooked && ac.ctl.throttle >= 0.9 && ac.speed < 68 && zloc > -70 && fwd[2] < -0.8) {      // catapult: full throttle at the stern end, pointing up the deck
      // the shuttle tows the aircraft straight up the deck: its nose is held on the deck's axis and any sideways drift is taken off
      const he = Math.atan2(-fwd[0], -fwd[2]), k = Math.min(1, STEP * 6);
      if (Math.abs(he) > 1e-4) ac.q = FP.qmul([0, Math.sin(-he * k / 2), 0, Math.cos(-he * k / 2)], ac.q);
      this.slideOff(ac, own, dv, 1);
      const ux = -own._sy, uz = -own._cy, a = CW.CAT.accel * STEP; ac.vel[0] += ux * a; ac.vel[2] += uz * a;
      if (!this.catMsg) { this.catMsg = true; this.host.say('CATAPULT!', 1.2, '#ffd23a'); }
    }
    // stopped on the deck with the engine at idle: the deck crew's chocks and the brakes hold it - the deck slants when the ship heels in a turn,
    // and without them a tail-dragger would weathervane and roll downhill
    const rel = Math.hypot(ac.vel[0] - dv[0], ac.vel[2] - dv[2]);
    if (onDeck && ac.onGround && !this.hooked && rel < 3 && ac.ctl.throttle < 0.35 && Math.abs(ac.ctl.yaw) < 0.1) {
      this.slideOff(ac, own, dv, 0.15); ac.w[1] *= 0.8;
      const he = Math.atan2(-fwd[0], -fwd[2]);                                     // hold the heading it was chocked at, relative to the deck
      if (this.chock == null) this.chock = he;
      else { const e = Math.atan2(Math.sin(this.chock - he), Math.cos(this.chock - he)); if (Math.abs(e) > 1e-5) ac.q = FP.qmul([0, Math.sin(e / 2), 0, Math.cos(e / 2)], ac.q); }
    } else this.chock = null;
    return onDeck && ac.onGround && ac.speed < V + 4 && needsRearm();
  }
  /** Take a fraction k of the aircraft's sideways motion across the deck off (k = 1: all of it). */
  slideOff(ac, c, dv, k) {
    const rx = ac.vel[0] - dv[0], rz = ac.vel[2] - dv[2], sx = c._cy, sz = -c._sy, side = rx * sx + rz * sz;     // the ship's starboard axis
    ac.vel[0] -= sx * side * k; ac.vel[2] -= sz * side * k;
  }
  /** Flown out of the battle area: a countdown, then out of fuel. Returns true when it is time to go down. */
  boundsStep(ac) {
    if (Math.hypot(ac.pos[0], ac.pos[2]) <= PLAY_R) { this.outT = 0; return false; }
    this.outT += STEP; this.host.say(`Return to the battle! ${Math.max(0, 15 - Math.round(this.outT))} s`, 0.5, '#ff6a4a');
    return this.outT > 15;
  }

  // ---------- shields: who is covering the point, and is it ours
  shieldAt(ac) { return CW.shieldAt(ac.pos[0], ac.pos[1], ac.pos[2]); }
  inOwnShield(ac, team) { const s = this.shieldAt(ac); return !!s && s.team === team; }
  /** Carrier hits and the bomb's own blast, from the server's 'boom'. */
  onBoom(m, cam, fx, audio, feed, myId) {
    const p = m.p, deck = p[1] > 5, big = m.w === 'b1000' ? 1.3 : m.w === 'tp' ? 1.7 : 1;
    const d = Math.hypot(p[0] - cam.position.x, p[1] - cam.position.y, p[2] - cam.position.z);
    if (deck) { fx.explode(p, [0, 0, 0], { violence: 1, fuel: 1.6 * big, water: false }); fx.wreckFire([p[0], p[1], p[2]], { scale: 0.9 * big, secs: 40, light: false }); }
    else fx.explode([p[0], 0, p[2]], [0, 0, 0], { violence: 1, fuel: 1.4 * big, water: true });
    audio.boom(d);
    if (m.hp) this.setHp(m.hp);
    const wasDD = this.dd.slice(); if (m.dd) this.setDD(m.dd, fx);
    const vet = m.vet > 1.001 ? m.vet : 1, rally = m.rally / vet;
    const dive = (m.dive > 1.05 ? ' (dive bomb)' : '') + (rally > 1.001 ? ` (rally +${Math.round((rally - 1) * 100)}%)` : '') + (vet > 1 ? ` (veteran +${Math.round((vet - 1) * 100)}%)` : '');
    if (m.ddHit >= 0 && m.dmg) {
      const I = CW.ESCORTS[m.ddHit], pct = Math.round(m.dmg / CW.DD_HP * 100), sunk = wasDD[m.ddHit] > 0 && this.dd[m.ddHit] <= 0;
      feed(sunk ? `🔥 ${esc(I.name)} has been sunk!` : `💥 ${esc(I.name)} hit: -${pct}%`);
      if (m.from === myId) this.host.say(sunk ? `You sank ${I.name}!` : `${deck ? 'Direct hit' : m.w === 'tp' ? 'Torpedo hit' : 'Near miss'} on ${I.name}${dive}! -${pct}%`, 3, '#7cff9a');
    }
    else if (m.hit >= 0 && m.dmg) { const pct = Math.round(m.dmg / CW.HP * 100); feed(`💥 ${esc(CW.CARRIERS[m.hit].name)} hit: -${pct}%`); if (m.from === myId) this.host.say(`Direct hit on ${CW.CARRIERS[m.hit].name}${dive}! -${pct}%`, 3, '#7cff9a'); }
    else if (m.from === myId) this.host.say(m.w === 'tp' ? 'Torpedo hit the hull' : deck ? 'Bomb exploded on the deck' : 'Bomb missed - it landed in the sea', 2, '#ffc83a');
    return d;
  }

  /** A crashed aircraft hurt a carrier (the server's 'cdmg'). */
  onCrashDmg(m, feed, myId) {
    if (m.hp) this.setHp(m.hp);
    const pct = Math.round(m.dmg / CW.HP * 1000) / 10, name = CW.CARRIERS[m.hit].name;
    feed(`💥 ${esc(name)} damaged by a crash: -${pct}%`);
    if (m.from === myId) this.host.say(`You crashed into ${name}: -${pct}%`, 3, '#ffc83a');
  }

  // ---------- every frame
  update(dt, nowSec, cam, fx) {
    CW.update(this.roundT());
    this.ocean.update(nowSec);
    if (!this.shown) return;
    this.carriers.forEach((c, i) => {
      const f = this.hp[i] / CW.HP, I = CW.CARRIERS[i];
      c.group.position.set(I.x, c.group.position.y, I.z); c.group.rotation.y = I.yaw; c.dish.rotation.y += dt * 2.2; c.flag.rotation.y = Math.PI / 2 + Math.sin(performance.now() / 280 + i) * 0.12;
      c.label.visible = Math.hypot(cam.position.x - I.x, cam.position.z - I.z) > 700;
      if (this.round.phase === 'over' && this.round.winner === 1 - i && c.sink > 0) {      // the loser goes down
        c.sink = Math.min(1, c.sink + dt / 18); const s = c.sink * c.sink;
        c.group.position.y = -s * 30; c.group.rotation.z = I.heel + (i ? 1 : -1) * s * 0.5; c.group.rotation.x = -s * 0.25;
      } else { c.group.rotation.z = I.heel; c.group.rotation.x = 0; }
      if (f < 0.75 && (c.smokeT -= dt) <= 0) {                                           // smoke and fire when hurt
        c.smokeT = f < 0.25 ? 0.08 : f < 0.5 ? 0.16 : 0.3;
        const w = CW.toWorld(I, (Math.random() - 0.5) * 20, CW.DECK.y + 2, (Math.random() - 0.5) * 160), x = w[0], z = w[2], y = w[1] - c.sink * 30;
        fx.smoke.emit({ p: [x, y, z], v: [(Math.random() - 0.5) * 3, 9 + Math.random() * 5, (Math.random() - 0.5) * 3], life: 5 + Math.random() * 3, size: [3, 22], c0: [0.12, 0.12, 0.12], c1: [0.3, 0.3, 0.3], a: 0.85, fadeIn: 0.05, drag: 0.4, acc: 0.6 });
        if (f < 0.5) fx.fire.emit({ p: [x, y, z], v: [0, 4, 0], life: 0.8, size: [3, 6], c0: [3, 1.8, 0.6], c1: [1.5, 0.3, 0.05], a: 1, fadeIn: 0.05, drag: 1 });
      }
    });
    // the escort: rides with the fleet; sunk, she settles by the bow with a list where she was hit and is gone after ~25 s
    this.escorts.forEach((e, i) => {
      const I = CW.ESCORTS[i], f = this.dd[i] / CW.DD_HP, g = e.group;
      if (e.sink > 0) {
        e.sink = Math.min(1, e.sink + dt / 25); const s = e.sink * e.sink;
        g.position.set(e.sinkAt[0], -s * 16, e.sinkAt[1]); g.rotation.y = I.yaw; g.rotation.x = -s * 0.5; g.rotation.z = I.heel + s * 0.35; e.wake.visible = false; g.visible = e.sink < 1;
      } else { g.position.set(I.x, 0, I.z); g.rotation.set(0, I.yaw, I.heel); e.flag.rotation.y = Math.PI / 2 + Math.sin(performance.now() / 260 + 7) * 0.14; }
      e.label.visible = g.visible && Math.hypot(cam.position.x - g.position.x, cam.position.z - g.position.z) > 700;
      if (!g.visible) return;
      if (e.sink === 0 && (e.stackT -= dt) <= 0) {                                       // a thin haze from the funnels (she is steaming at 15 kt)
        e.stackT = 0.35;
        for (const st of e.stacks) fx.smoke.emit({ p: CW.toWorld(I, st[0], st[1], st[2]), v: [(Math.random() - 0.5) + I._sy * CW.SPEED * 0.6, 2.5, I._cy * CW.SPEED * 0.6], life: 6, size: [1.6, 9], c0: [0.28, 0.28, 0.28], c1: [0.5, 0.5, 0.52], a: 0.35, fadeIn: 0.1, drag: 0.3, acc: 0.2, wind: 0.8 });
      }
      if ((f < 0.75 || e.sink > 0) && (e.smokeT -= dt) <= 0) {                           // hurt: black smoke and fires along the deck
        e.smokeT = f < 0.3 || e.sink > 0 ? 0.1 : f < 0.5 ? 0.2 : 0.35;
        const w = e.sink > 0 ? [g.position.x + (Math.random() - 0.5) * 6, 6, g.position.z + (Math.random() - 0.5) * 70] : CW.toWorld(I, (Math.random() - 0.5) * 6, 6, (Math.random() - 0.5) * 70), x = w[0], z = w[2], y = w[1] + g.position.y;
        fx.smoke.emit({ p: [x, y, z], v: [(Math.random() - 0.5) * 2, 7 + Math.random() * 4, (Math.random() - 0.5) * 2], life: 5 + Math.random() * 3, size: [2, 16], c0: [0.1, 0.1, 0.1], c1: [0.3, 0.3, 0.3], a: 0.85, fadeIn: 0.05, drag: 0.4, acc: 0.6 });
        if (f < 0.5) fx.fire.emit({ p: [x, y, z], v: [0, 3, 0], life: 0.7, size: [2, 4.5], c0: [3, 1.8, 0.6], c1: [1.5, 0.3, 0.05], a: 1, fadeIn: 0.05, drag: 1 });
      }
    });
    this.ships.forEach((sh, i) => this.wakes[i].update(dt, sh.info, this.round.phase === 'play' && !sh.info.sunk && !(sh.sink > 0)));
    // the AA: each ship's guns fire at enemy aircraft while the round is on and the ship is afloat
    const live = this.round.phase === 'play';
    this.aa.update(dt, this.host.targets(), [...this.hp.map(h => live && h > 0), ...this.dd.map((h, i) => live && h > 0 && !CW.ESCORTS[i].sunk)]);
    if (this.aaWarn > 0) this.aaWarn -= dt;
  }
  /** The text panels (carrier bars are updated by setHp). */
  updateNav(ac, team) {
    const own = CW.CARRIERS[team], en = CW.CARRIERS[1 - team], brg = (dx, dz) => String((Math.round(Math.atan2(dx, -dz) * 180 / Math.PI) + 360) % 360).padStart(3, '0');
    const dh = Math.hypot(own.x - ac.pos[0], own.z - ac.pos[2]), de = Math.hypot(en.x - ac.pos[0], en.z - ac.pos[2]);
    const left = Math.max(0, (this.round.max || CW.ROUND_MAX) - this.roundT()), mm = Math.floor(left / 60), ss = String(Math.floor(left % 60)).padStart(2, '0');
    $('cwNav').innerHTML = `HOME ${(dh / 1000).toFixed(1)} km · brg ${brg(own.x - ac.pos[0], own.z - ac.pos[2])}<br>ENEMY ${(de / 1000).toFixed(1)} km · brg ${brg(en.x - ac.pos[0], en.z - ac.pos[2])}<br>round ${mm}:${ss} · fleets at ${Math.round(CW.SPEED * 1.94384)} kt${CW.CARRIERS[1 - team].evading ? ' · enemy evading' : ''} · hook ${this.hookDown ? 'DOWN (H)' : 'up (H)'}`;
  }
  /** What the HUD needs to know that is specific to this map. */
  hudExtras(team, planeId) {
    return {
      teamName: CP.TEAMS[team].short + ' · ' + CP.PLANES[planeId].name, teamColor: TEAM_COL[team], aa: this.aaWarn > 0,
      carriers: CW.CARRIERS.map(c => ({ x: c.x, z: c.z, yaw: c.yaw, color: TEAM_COL[c.team], short: c.team ? 'IJN' : 'USN' })),
      escorts: CW.ESCORTS.filter(e => !e.sunk).map(e => ({ x: e.x, z: e.z, yaw: e.yaw, color: TEAM_COL[e.team], short: 'DD' })),
      radarFields: CW.CARRIERS.map(c => { const h = CW.DECK.len / 2, a = [c.x + c._sy * h, c.z + c._cy * h], b = [c.x - c._sy * h, c.z - c._cy * h];
        return { S: { a, b }, box: [c.x - CW.SHIELD.r, c.z - CW.SHIELD.r, c.x + CW.SHIELD.r, c.z + CW.SHIELD.r] }; }),
    };
  }
  /** The menu orbits your own carrier. */
  menuCamera(cam, team, now) {
    const c = CW.CARRIERS[team], t = now / 1000 * 0.08, R = 190;
    cam.position.set(c.x + Math.sin(t) * R, 55, c.z + Math.cos(t) * R); cam.up.set(0, 1, 0); cam.lookAt(c.x, 14, c.z); cam.fov = 55; cam.updateProjectionMatrix();
  }
}
