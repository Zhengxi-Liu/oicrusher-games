/**
 * Photonic Fencing - deterministic duel simulation, shared verbatim by the Node server
 * (authority + lag-compensating rollback) and the browser (prediction + reconciliation).
 *
 * Rules for this file: integers only, no Math.random / Date / floating trig. step() must be
 * a pure function of (state, inputs) so both sides replay identical frames.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FencingSim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const C = {
    TICK_RATE: 60,
    ARENA_W: 960, CENTER: 480,
    START_GAP: 175,                 // fencers start at CENTER ± START_GAP
    WALL_L: 70, WALL_R: 890,
    WALL_CLOSE_AT: 20 * 60,         // after 20 s the piste ends start closing in
    ROUND_TICKS: 30 * 60,           // 30 s round limit
    WALL_MIN_HALF: 120,             // walls stop at CENTER ± this
    BODY_HALF: 16, MIN_SEP: 38,
    WALK: 3,
    REACH: 46,                      // idle blade tip distance from body centre
    LUNGE_STARTUP: 13, LUNGE_ACTIVE: 6, LUNGE_RECOVERY: 22, LUNGE_SPEED: 13, LUNGE_EXT: 30,
    DODGE_TOTAL: 20, DODGE_IFRAMES: 10, DODGE_SPEED: 12,
    PARRY_WINDOW: 12, PARRY_TOTAL: 30,  // 12 frames = 200 ms perfect window, then an 18-frame whiff
    STAGGER: 52, RECOIL: 20,
    HITSTOP: 18, CLASH_STOP: 6, KO_STOP: 8,   // 18 frames = 0.3 s bullet time
    INTRO_TICKS: 90, KO_TICKS: 80, WIN_ROUNDS: 3,
    BUFFER: 8,                      // an action pressed this many frames early still comes out
  };

  const IN = { LEFT: 1, RIGHT: 2, LUNGE: 4, DODGE: 8, PARRY: 16 };
  const ACTIONS = IN.LUNGE | IN.DODGE | IN.PARRY;
  const PHASES = ['intro', 'fight', 'ko', 'over'];
  const STATES = ['idle', 'walk', 'lunge', 'dodge', 'parry', 'stagger', 'recoil', 'hit'];
  const EVENTS = ['lunge', 'dodge', 'parry', 'clash', 'hit', 'time', 'whiff'];

  function makeFencer(p) {
    const dir = p === 0 ? 1 : -1;
    return { x: C.CENTER - dir * C.START_GAP, vx: 0, dir, st: 'idle', t: 0, prev: 0, buf: 0, bufT: 0, done: 0 };
  }

  function create() {
    return {
      tick: 0, phase: 'intro', pt: C.INTRO_TICKS, rt: 0, freeze: 0,
      round: 1, score: [0, 0], winner: -1, roundWinner: -1,
      f: [makeFencer(0), makeFencer(1)],
      ev: [],                       // recent events {k, tick, p, x} for effects / sound
    };
  }

  function clone(s) {
    return {
      tick: s.tick, phase: s.phase, pt: s.pt, rt: s.rt, freeze: s.freeze,
      round: s.round, score: [s.score[0], s.score[1]], winner: s.winner, roundWinner: s.roundWinner,
      f: s.f.map(f => ({ x: f.x, vx: f.vx, dir: f.dir, st: f.st, t: f.t, prev: f.prev, buf: f.buf, bufT: f.bufT, done: f.done })),
      ev: s.ev.map(e => ({ k: e.k, tick: e.tick, p: e.p, x: e.x })),
    };
  }

  function emit(s, k, p, x) {
    s.ev.push({ k, tick: s.tick, p, x });
    if (s.ev.length > 8) s.ev.shift();
  }

  function walls(s) {
    if (s.phase !== 'fight' || s.rt <= C.WALL_CLOSE_AT) return [C.WALL_L, C.WALL_R];
    const span = C.ROUND_TICKS - C.WALL_CLOSE_AT;
    const k = Math.min(span, s.rt - C.WALL_CLOSE_AT);
    const travel = C.CENTER - C.WALL_MIN_HALF - C.WALL_L;
    const d = Math.floor(travel * k / span);
    return [C.WALL_L + d, C.WALL_R - d];
  }

  const actionable = f => f.st === 'idle' || f.st === 'walk';
  const actionOf = bits => (bits & IN.PARRY) ? IN.PARRY : (bits & IN.LUNGE) ? IN.LUNGE : (bits & IN.DODGE) ? IN.DODGE : 0;
  const lungeActive = f => f.st === 'lunge' && f.t >= C.LUNGE_STARTUP && f.t < C.LUNGE_STARTUP + C.LUNGE_ACTIVE;
  const parrying = f => f.st === 'parry' && f.t < C.PARRY_WINDOW;
  const invulnerable = f => f.st === 'dodge' && f.t < C.DODGE_IFRAMES;
  const tipX = f => f.x + f.dir * (C.REACH + (lungeActive(f) ? C.LUNGE_EXT : 0));

  function startRound(s) {
    s.f = [makeFencer(0), makeFencer(1)];
    s.phase = 'intro'; s.pt = C.INTRO_TICKS; s.rt = 0; s.freeze = 0; s.roundWinner = -1;
  }

  function setState(f, st) { f.st = st; f.t = 0; }

  /** Read presses (rising edges) into the input buffer; movement bits are read live. */
  function latch(f, bits, decay) {
    const pressed = bits & ~f.prev;
    f.prev = bits;
    const act = actionOf(pressed);
    if (act) { f.buf = act; f.bufT = C.BUFFER; }
    else if (!decay) return;                                  // hit-stop: buffered counters wait
    else if (f.bufT > 0) f.bufT--;
    else f.buf = 0;
  }

  function advanceFencer(s, p, bits) {
    const f = s.f[p];
    f.t++;
    switch (f.st) {
      case 'lunge': if (f.t >= C.LUNGE_STARTUP + C.LUNGE_ACTIVE + C.LUNGE_RECOVERY) setState(f, 'idle'); break;
      case 'dodge': if (f.t >= C.DODGE_TOTAL) setState(f, 'idle'); break;
      case 'parry': if (f.t >= C.PARRY_TOTAL) setState(f, 'idle'); break;
      case 'stagger': if (f.t >= C.STAGGER) setState(f, 'idle'); break;
      case 'recoil': if (f.t >= C.RECOIL) setState(f, 'idle'); break;
    }
    if (actionable(f) && f.buf) {
      const act = f.buf; f.buf = 0; f.bufT = 0;
      if (act === IN.LUNGE) { setState(f, 'lunge'); f.done = 0; emit(s, 0, p, f.x); }
      else if (act === IN.DODGE) { setState(f, 'dodge'); emit(s, 1, p, f.x); }
      else { setState(f, 'parry'); }
    }
    switch (f.st) {
      case 'idle': case 'walk': {
        const move = ((bits & IN.RIGHT) ? 1 : 0) - ((bits & IN.LEFT) ? 1 : 0);
        f.vx = move * C.WALK;
        f.st = move ? 'walk' : 'idle';
        break;
      }
      case 'lunge':
        if (f.t < C.LUNGE_STARTUP) f.vx = f.t < 5 ? -f.dir : 0;                       // wind-up
        else if (f.t < C.LUNGE_STARTUP + C.LUNGE_ACTIVE) f.vx = f.dir * C.LUNGE_SPEED;  // the strike
        else f.vx = f.dir * Math.max(0, 6 - (f.t - C.LUNGE_STARTUP - C.LUNGE_ACTIVE));  // overrun
        break;
      case 'dodge': f.vx = f.t < 12 ? -f.dir * Math.max(2, C.DODGE_SPEED - f.t) : 0; break;
      case 'parry': f.vx = 0; break;
      case 'stagger': f.vx = f.t < 12 ? -f.dir * 3 : 0; break;
      case 'recoil': f.vx = -f.dir * Math.max(0, 9 - f.t); break;
      default: f.vx = 0;
    }
  }

  function moveAndSeparate(s) {
    const [L, R] = walls(s);
    const lo = L + C.BODY_HALF, hi = R - C.BODY_HALF;
    const a = s.f[0], b = s.f[1];
    a.x = Math.max(lo, Math.min(hi, a.x + a.vx));
    b.x = Math.max(lo, Math.min(hi, b.x + b.vx));
    const overlap = C.MIN_SEP - (b.x - a.x);
    if (overlap > 0) {
      // whoever pushed in gives way; a fencer pinned on a wall cannot be pushed
      const aIn = a.vx > 0, bIn = b.vx < 0;
      let da = aIn && !bIn ? overlap : !aIn && bIn ? 0 : (overlap >> 1);
      let db = overlap - da;
      if (a.x - da < lo) { db += da - (a.x - lo); da = a.x - lo; }
      if (b.x + db > hi) { da += db - (hi - b.x); db = hi - b.x; }
      a.x -= da; b.x += db;
    }
  }

  function strikes(f, o) {
    if (!lungeActive(f) || f.done) return false;
    return f.dir * (tipX(f) - o.x) >= -C.BODY_HALF;
  }

  function resolveHits(s) {
    const a = s.f[0], b = s.f[1];
    const ha = strikes(a, b), hb = strikes(b, a);
    if (ha && hb) {                                           // blades meet: nobody scores
      a.done = b.done = 1;
      setState(a, 'recoil'); setState(b, 'recoil');
      s.freeze = C.CLASH_STOP;
      emit(s, 3, -1, (a.x + b.x) >> 1);
      return;
    }
    if (!ha && !hb) return;
    const p = ha ? 0 : 1, f = s.f[p], o = s.f[1 - p];
    if (parrying(o)) {                                        // perfect parry: bullet time + stagger
      f.done = 1;
      setState(f, 'stagger');
      setState(o, 'idle');
      s.freeze = C.HITSTOP;
      emit(s, 2, 1 - p, tipX(f));
    } else if (invulnerable(o)) {
      // phased through: the lunge keeps travelling but can't hit this dodge
    } else {
      f.done = 1;
      setState(o, 'hit');
      s.score[p]++;
      s.roundWinner = p;
      s.phase = 'ko'; s.pt = C.KO_TICKS; s.freeze = C.KO_STOP;
      emit(s, 4, p, o.x);
    }
  }

  /** Advance one tick. inputs = [bits for fencer 0, bits for fencer 1] for tick s.tick + 1. */
  function step(s, inputs) {
    s.tick++;
    const decay = s.freeze === 0;
    latch(s.f[0], inputs[0] | 0, decay);
    latch(s.f[1], inputs[1] | 0, decay);

    if (s.phase === 'over') return s;
    if (s.freeze > 0) { s.freeze--; return s; }

    if (s.phase === 'intro') {
      if (--s.pt <= 0) s.phase = 'fight';
      return s;
    }
    if (s.phase === 'ko') {
      for (const f of s.f) { f.t++; f.x += f.st === 'hit' ? -f.dir * Math.max(0, 6 - (f.t >> 2)) : 0; }
      if (--s.pt <= 0) {
        if (Math.max(s.score[0], s.score[1]) >= C.WIN_ROUNDS) { s.phase = 'over'; s.winner = s.score[0] > s.score[1] ? 0 : 1; }
        else { s.round++; startRound(s); }
      }
      return s;
    }

    s.rt++;
    advanceFencer(s, 0, inputs[0] | 0);
    advanceFencer(s, 1, inputs[1] | 0);
    moveAndSeparate(s);
    resolveHits(s);
    for (let p = 0; p < 2; p++) {                             // a parry that met nothing is a whiff
      const f = s.f[p];
      if (f.st === 'parry' && f.t === C.PARRY_WINDOW) emit(s, 6, p, f.x);
    }
    if (s.phase === 'fight' && s.rt >= C.ROUND_TICKS) {      // time: replay the round, no point
      s.phase = 'ko'; s.pt = C.KO_TICKS; s.roundWinner = -1;
      emit(s, 5, -1, C.CENTER);
    }
    return s;
  }

  // ---- compact wire format (flat integer array)
  function encode(s) {
    const out = [s.tick, PHASES.indexOf(s.phase), s.pt, s.rt, s.freeze, s.round, s.score[0], s.score[1], s.winner, s.roundWinner];
    for (const f of s.f) out.push(f.x, f.vx, STATES.indexOf(f.st), f.t, f.prev, f.buf, f.bufT, f.done);
    out.push(s.ev.length);
    for (const e of s.ev) out.push(e.k, e.tick, e.p, e.x);
    return out;
  }

  function decode(a) {
    let i = 0;
    const s = {
      tick: a[i++], phase: PHASES[a[i++]], pt: a[i++], rt: a[i++], freeze: a[i++], round: a[i++],
      score: [a[i++], a[i++]], winner: a[i++], roundWinner: a[i++], f: [], ev: [],
    };
    for (let p = 0; p < 2; p++) {
      s.f.push({ x: a[i++], vx: a[i++], dir: p === 0 ? 1 : -1, st: STATES[a[i++]], t: a[i++], prev: a[i++], buf: a[i++], bufT: a[i++], done: a[i++] });
    }
    const n = a[i++];
    for (let k = 0; k < n; k++) s.ev.push({ k: a[i++], tick: a[i++], p: a[i++], x: a[i++] });
    return s;
  }

  return { C, IN, ACTIONS, EVENTS, create, clone, step, encode, decode, walls, tipX, lungeActive, parrying, invulnerable };
});
