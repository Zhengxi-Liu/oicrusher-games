'use strict';
/**
 * Element Core - one authoritative 1v1 match (best of 3 rounds).
 *
 * 60 Hz on the server: each tick consumes one queued input per mage (inputs carry a sequence
 * number; the newest applied one is acknowledged in every snapshot so the client can replay the
 * rest), moves mages with the shared Movement code, simulates bolts / fire / cover, resolves all
 * damage, and every 2nd tick (30 Hz) sends a compact snapshot to both browsers.
 *
 * Phases: opening draft -> countdown -> combat -> (every 45 s: draft -> countdown -> combat) -> ko -> draft -> next round.
 */
const { C, PHASES, deriveStats } = require('../shared/Constants.js');
const Move = require('../shared/Movement.js');
const { stepProjectile } = require('./PhysicsEngine.js');
const Draft = require('./DraftPool.js');
const { Bot } = require('./Bot.js');

// event codes in snapshots: [code, tick, ...data]
const EV = { HIT: 0, BLOCK: 1, BREAK: 2, ZAP: 3, KILL: 4, HEAL: 5, BOUNCE: 6, BURN: 7 };
const FLAG = { FROST: 1, HOMING: 2, BOUNCE: 4, PIERCE: 8, CHAIN: 16, HEAVY: 32, VAMP: 64 };
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;

class GameRoom {
  constructor(id, players, hooks) {
    this.id = id;
    this.players = players;
    this.hooks = hooks;
    this.rng = Draft.makeRng();
    this.tick = 0;
    this.startedAt = Date.now();
    this.closed = false;
    this.stacks = [{}, {}];
    this.st = [deriveStats({}), deriveStats({})];
    this.score = [0, 0];
    this.round = 0;
    this.queue = [[], []];
    this.lastSeq = [0, 0];
    this.ack = [0, 0];
    this.last = [{ m: 0, a: 0, f: 0, d: 0 }, { m: 0, a: Math.PI, f: 0, d: 0 }];
    this.bots = players.map((p, i) => (p.bot ? new Bot(this, i, p.level) : null));
    this.events = [];
    this.nextId = 1;
    this.draft = null;
    this.stats = { peakBolts: 0, drafts: 0 };
    this.physicsHooks = {
      onCoverHit: (c, b, x, y) => this.hitCover(c, b, x, y),
      onWallOrCover: (b, x, y) => this.chainZap(b, x, y),
      onPlayerHit: (target, b) => this.hitPlayer(target, b),
      onBounce: (x, y) => this.ev(EV.BOUNCE, Math.round(x), Math.round(y)),
    };
    this.newRound();
    this.openingDraft = true;     // started on the first tick, after the lobby has sent 'match'
  }

  // ---------- lobby interface
  startInfo() { return { k: this.tick, stacks: this.stacks }; }
  isOver() { return this.phase === 'over'; }
  onMessage(side, m) {
    if (m.t === 'i') this.onInput(side, m);
    else if (m.t === 'pick') this.pick(side, String(m.id || ''));
  }
  forfeit(side) {
    if (this.closed) return null;
    this.closed = true;
    if (this.phase === 'over') return null;
    return { winner: 1 - side, score: this.score.slice(), duration: Math.round((Date.now() - this.startedAt) / 1000), forfeit: true };
  }

  // ---------- setup
  newRound() {
    this.round++;
    this.covers = C.COVERS.map((c, i) => ({ ...c, id: i, max: c.hp }));
    this.P = [0, 1].map(i => this.spawn(i));
    this.proj = [];
    this.fires = [];
    this.burnAcc = [0, 0];
    this.combatT = 0;
    this.phase = 'countdown';
    this.pt = C.COUNTDOWN;
  }

  spawn(i) {
    const [x, y] = C.SPAWNS[i], st = this.st[i];
    return { x, y, aim: i ? Math.PI : 0, hp: st.maxHp, shield: st.maxShield, dashT: 0, dashCd: 0, dashX: 0, dashY: 0,
             slowT: 0, fireCd: 0, alive: true, lastHit: -9999 };
  }

  ev(code, ...data) { this.events.push([code, this.tick, ...data]); }

  // ---------- inputs
  onInput(side, m) {
    if (m.r !== undefined && m.r !== this.id) return;    // still in flight from the previous match
    const s = m.s | 0;
    if (s <= this.lastSeq[side]) return;
    this.lastSeq[side] = s;
    const a = Number(m.a);
    this.queue[side].push({ s, m: (m.m | 0) & 15, a: Number.isFinite(a) ? a : this.last[side].a, f: m.f ? 1 : 0, d: m.d ? 1 : 0 });
    if (this.queue[side].length > 30) this.queue[side].shift();
  }

  /**
   * Inputs to apply for one mage this tick. Every input is applied exactly once, in order, so the
   * client's replay of unacknowledged inputs reproduces the server exactly:
   *   none queued -> the mage waits this tick (no invented input); 1-2 queued -> apply one;
   *   a backlog (jitter burst) -> apply two to catch up; a huge backlog is trimmed, keeping dashes.
   */
  takeInputs(i) {
    if (this.bots[i]) return [this.bots[i].input()];
    const q = this.queue[i];
    if (q.length > 12) {
      const dropped = q.splice(0, q.length - 4);
      if (dropped.some(x => x.d)) q[0].d = 1;
      this.ack[i] = dropped[dropped.length - 1].s;
    }
    const out = q.splice(0, q.length > 2 ? 2 : q.length);
    if (out.length) { this.last[i] = out[out.length - 1]; this.ack[i] = this.last[i].s; }
    return out;
  }

  // ---------- main tick
  update() {
    if (this.closed) return;
    this.tick++;
    if (this.openingDraft) { this.openingDraft = false; this.startDraft('opening'); }
    const inputs = [this.takeInputs(0), this.takeInputs(1)];
    switch (this.phase) {
      case 'countdown':
        this.P.forEach((p, i) => { p.aim = this.last[i].a; });
        if (--this.pt <= 0) this.phase = 'combat';
        break;
      case 'combat': this.combatTick(inputs); break;
      case 'ko':
        if (--this.pt <= 0) {
          if (Math.max(this.score[0], this.score[1]) >= C.ROUND_WINS) {
            this.phase = 'over';
            this.hooks.onOver(this, { winner: this.score[0] > this.score[1] ? 0 : 1, score: this.score.slice(),
                                      duration: Math.round((Date.now() - this.startedAt) / 1000), forfeit: false });
          } else this.startDraft('round');
        }
        break;
      case 'draft': this.draftTick(); break;
    }
    if (this.tick % C.SNAPSHOT_EVERY === 0) this.broadcast();
  }

  combatTick(inputs) {
    for (let i = 0; i < 2; i++) {
      const p = this.P[i], st = this.st[i];
      for (const inp of inputs[i]) {
        if (!p.alive) break;
        p.aim = inp.a;
        if (Move.stepPlayer(p, inp, this.covers, st)) this.cast(i, inp);
      }
      if (!p.alive) continue;
      if (p.dashT > 0 && st.burnLife && this.tick % 3 === 0) {
        this.fires.push({ id: this.nextId++, x: p.x, y: p.y, owner: i, life: st.burnLife, dmg: st.burnDmg });
      }
      if (st.maxShield && p.shield < st.maxShield && this.tick - p.lastHit > 180) p.shield = Math.min(st.maxShield, p.shield + 0.25);
    }

    this.proj = this.proj.filter(b => this.phase === 'combat' && stepProjectile(b, this.covers, this.P, this.physicsHooks));
    this.stats.peakBolts = Math.max(this.stats.peakBolts, this.proj.length);

    for (const f of this.fires) {
      f.life--;
      const e = this.P[1 - f.owner];
      if (e.alive && !Move.invulnerable(e) && Math.hypot(e.x - f.x, e.y - f.y) < 32) this.damage(1 - f.owner, f.dmg, f.owner, 'burn');
    }
    this.fires = this.fires.filter(f => f.life > 0);
    if (this.tick % 15 === 0) {
      for (let i = 0; i < 2; i++) if (this.burnAcc[i] >= 0.5) { this.ev(EV.BURN, r1(this.P[i].x), r1(this.P[i].y), r1(this.burnAcc[i]), i); this.burnAcc[i] = 0; }
    }

    if (this.phase === 'combat' && ++this.combatT >= C.DRAFT_EVERY) this.startDraft('timer');
  }

  cast(i, inp) {
    const st = this.st[i];
    let mine = 0;
    for (const b of this.proj) if (b.owner === i) mine++;
    if (mine >= C.MAX_PROJ_PER_PLAYER) return;
    const flags = (st.slow ? FLAG.FROST : 0) | (st.homing ? FLAG.HOMING : 0) | (st.bounce ? FLAG.BOUNCE : 0) | (st.pierce ? FLAG.PIERCE : 0)
                | (st.chainDmg ? FLAG.CHAIN : 0) | (st.radius > C.BOLT_R ? FLAG.HEAVY : 0) | (st.vamp ? FLAG.VAMP : 0);
    for (const s of Move.shotPattern(this.P[i], inp.a, st)) {
      this.proj.push({ id: this.nextId++, owner: i, seq: inp.s | 0, x: s.x, y: s.y, vx: s.vx, vy: s.vy, r: s.r, dmg: st.dmg,
                       life: st.life, homing: st.homing, bounce: st.bounce, pierce: st.pierce, passing: -1, slow: st.slow,
                       chain: st.chainDmg, chainRange: st.chainRange, flags });
    }
  }

  // ---------- damage & effects
  hitCover(c, b, x, y) {
    c.hp -= b.dmg;
    this.ev(EV.BLOCK, Math.round(x), Math.round(y), b.owner);
    if (c.hp <= 0) { c.hp = 0; this.ev(EV.BREAK, c.id); }
  }

  chainZap(b, x, y) {
    if (!b.chain) return;
    const e = this.P[1 - b.owner];
    if (!e.alive || Move.invulnerable(e) || Math.hypot(e.x - x, e.y - y) > b.chainRange) return;
    this.ev(EV.ZAP, Math.round(x), Math.round(y), Math.round(e.x), Math.round(e.y));
    this.damage(1 - b.owner, b.chain, b.owner, 'zap');
  }

  hitPlayer(target, b) {
    const i = this.P.indexOf(target);
    if (b.slow) target.slowT = Math.max(target.slowT, b.slow);
    this.damage(i, b.dmg, b.owner, 'bolt');
  }

  damage(i, amount, src, kind) {
    const p = this.P[i];
    if (!p.alive || this.phase !== 'combat' || amount <= 0) return;
    let rest = amount;
    if (p.shield > 0) { const a = Math.min(p.shield, rest); p.shield -= a; rest -= a; }
    p.hp -= rest;
    p.lastHit = this.tick;
    if (kind === 'burn') this.burnAcc[i] += amount;
    else this.ev(EV.HIT, r1(p.x), r1(p.y), r1(amount), i, kind === 'zap' ? 1 : 0);
    const vamp = this.st[src].vamp, s = this.P[src];
    if (vamp && s.alive) {
      const heal = Math.min(this.st[src].maxHp - s.hp, amount * vamp);
      if (heal > 0) { s.hp += heal; if (heal >= 1) this.ev(EV.HEAL, r1(s.x), r1(s.y), r1(heal), src); }
    }
    if (p.hp <= 0) {
      p.hp = 0; p.alive = false;
      this.score[1 - i]++;
      this.phase = 'ko'; this.pt = C.KO_TICKS;
      this.ev(EV.KILL, r1(p.x), r1(p.y), i);
    }
  }

  // ---------- draft
  startDraft(reason) {
    this.phase = 'draft';
    this.pt = C.DRAFT_TIME;
    this.proj = [];
    this.fires = [];
    this.stats.drafts++;
    const offers = [Draft.offer(this.rng, this.stacks[0]), Draft.offer(this.rng, this.stacks[1])];
    this.draft = { reason, offers, picks: [null, null] };
    for (let i = 0; i < 2; i++) {
      this.hooks.send(this.players[i], { t: 'draft', offers: offers[i], stacks: this.stacks, time: C.DRAFT_TIME, reason, round: this.round, score: this.score });
    }
  }

  pick(side, id) {
    const d = this.draft;
    if (this.phase !== 'draft' || !d || d.picks[side] || !d.offers[side].includes(id)) return;
    d.picks[side] = id;
    for (const p of this.players) this.hooks.send(p, { t: 'picked', side });
  }

  draftTick() {
    const d = this.draft;
    for (let i = 0; i < 2; i++) {
      if (this.bots[i] && !d.picks[i] && d.offers[i].length) {
        const id = this.bots[i].draftTick(d.offers[i]);
        if (id) this.pick(i, id);
      }
    }
    const done = [0, 1].every(i => d.picks[i] || !d.offers[i].length);
    if (--this.pt <= 0 || done) this.resolveDraft();
  }

  resolveDraft() {
    const d = this.draft, chosen = [null, null];
    for (let i = 0; i < 2; i++) {
      const id = d.picks[i] || (d.offers[i].length ? d.offers[i][Math.floor(this.rng() * d.offers[i].length)] : null);
      if (id && Draft.apply(this.stacks[i], id)) chosen[i] = id;
      this.st[i] = deriveStats(this.stacks[i]);
      const p = this.P[i];
      if (chosen[i] === 'vital') p.hp = Math.min(this.st[i].maxHp, p.hp + 25);
      p.shield = this.st[i].maxShield;
    }
    for (const p of this.players) this.hooks.send(p, { t: 'stats', stacks: this.stacks, chosen });
    this.draft = null;
    if (d.reason === 'round') this.newRound();
    else if (d.reason === 'opening') { this.P = [0, 1].map(i => this.spawn(i)); this.phase = 'countdown'; this.pt = C.COUNTDOWN; }
    else { this.phase = 'countdown'; this.pt = C.RESUME; this.combatT = 0; }
  }

  // ---------- snapshots (30 Hz)
  broadcast() {
    const pl = this.P.map(p => [r2(p.x), r2(p.y), r3(p.aim), r1(p.hp), r1(p.shield), p.dashT, p.dashCd, r3(p.dashX), r3(p.dashY),
                                p.slowT, p.fireCd, p.alive ? 1 : 0]);
    const pr = [];
    for (const b of this.proj) pr.push(b.id, Math.round(b.x), Math.round(b.y), r1(b.vx), r1(b.vy), b.owner, r1(b.r), b.flags, b.seq);
    const fz = [];
    for (const f of this.fires) fz.push(f.id, Math.round(f.x), Math.round(f.y), f.owner, f.life);
    const base = { t: 's', k: this.tick, ph: PHASES.indexOf(this.phase), pt: this.pt, ct: this.combatT, r: this.round, sc: this.score,
                   p: pl, pr, fz, cv: this.covers.map(c => Math.ceil(c.hp)), ev: this.events };
    for (let i = 0; i < 2; i++) if (!this.players[i].bot) this.hooks.send(this.players[i], { ...base, a: this.ack[i] });
    this.events = [];
  }
}

module.exports = { GameRoom, EV, FLAG };
