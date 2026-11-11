/**
 * CarrierWorld - the geometry of the Carrier War universe, shared by the browser (physics, drawing, bombs) and the server
 * (bomb checks, damage). It is an open sea with two carriers: team 0 (USN, west) and team 1 (IJN, east). Both face north
 * (-z) and sail that way at SPEED; planes take off toward -z and land from the south (+z, the stern). Nothing here is shared with the island sim.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CWWorld = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DECK = { len: 270, hw: 24, y: 20, hullHw: 16, hullLen: 300 };            // flight deck half-width 24 m, 20 m above the sea
  // both fleets steam north (-z) at 15 knots, starting at z = Z0 when a round starts; position is a pure function of the round clock
  const SPEED = 7.7, Z0 = 3300, ROUND_MAX = 1200;
  const CARRIERS = [
    { team: 0, name: 'USS Resolute', x: -2600, z: Z0, color: 0x3b6ea8 },
    { team: 1, name: 'IJN Akagiri', x: 2600, z: Z0, color: 0xb83a3a },
  ];
  // the escort: a Kagero-class destroyer screening on the IJN carrier's port (west, left) side, a little ahead of it. It sails with the fleet,
  // has its own AA (client/CarrierAA.js), can be bombed, torpedoed, strafed and sunk (it does not decide the round: only the carriers do).
  // Real Kagero: 118.5 m long, 10.8 m beam, 3.8 m draught; forecastle deck ~7 m above the sea, the main deck aft ~5.5 m.
  const DD = { len: 118.5, hw: 5.4, draft: 3.8, fc: 7.2, main: 5.6, fcEnd: -14 };
  const ESCORTS = [
    { dd: true, idx: 0, team: 1, name: 'IJN Yukikaze', cls: 'Kagero-class destroyer', dx: -800, dz: -180, x: 0, z: Z0, sunk: false },
  ];
  const DD_HP = 1200;
  // ---------- the fleets under way. Every ship steams at SPEED - the destroyer keeps the carrier's 15 kt - and steers with a rudder: the yaw rate
  // follows the rudder with a lag (a ship takes seconds to answer her helm), and she heels OUTWARD in the turn (the flight deck slants), all
  // integrated at a fixed FDT. The server's AI (steer(), run by CarrierBattle) sets the rudders and sends snapshots (snap()); the browsers integrate
  // the same model from those snapshots (applySnap()), so every deck is where the server has it. The track is recorded (HIST s) so the server can
  // re-fly a bomb over the decks where they were.
  const D2R = Math.PI / 180, FDT = 0.1, HIST = 150;
  // rMax: the yaw rate at full rudder (turning circle radius SPEED / rMax: ~390 m for the carrier, ~230 m for the destroyer); tauR: how fast the
  // turn builds up; heel: the steady heel at full rudder (outward), tauH: how fast it builds up
  const HANDLING = { cv: { rMax: 0.02, tauR: 8, heel: 5 * D2R, tauH: 3.5, k: 0.05 }, dd: { rMax: 0.034, tauR: 4, heel: 8 * D2R, tauH: 2.2, k: 0.1 } };
  const SHIPS = [...CARRIERS, ...ESCORTS];
  const FLEET = { t: 0, hist: [] };
  const THREATS = [];
  CARRIERS.forEach(c => { c.home = { x: c.x, z: Z0 }; });
  ESCORTS.forEach(e => { const c = CARRIERS[e.team]; e.home = { x: c.x + e.dx, z: Z0 + e.dz }; });
  /** Set where a ship is drawn / tested: position, heading (yaw, radians, + = to port, 0 = north) and heel (+ = starboard side up). */
  function setPose(s, x, z, yaw, heel, r) {
    s.x = x; s.z = z; s.yaw = yaw; s.heel = heel; s.r = r;
    s._cy = Math.cos(yaw); s._sy = Math.sin(yaw); s._ch = Math.cos(heel); s._sh = Math.sin(heel);
  }
  /** World (x, z) -> ship-local [lx (starboard +), lz (astern +)], for a point at height h on the heeled ship (the heel shifts the decks sideways). */
  function loc(s, x, z, h = 0) {
    const dx = x - s.x, dz = z - s.z;
    let lx = dx * s._cy - dz * s._sy; const lz = dx * s._sy + dz * s._cy;
    if (h && s._sh) lx = (lx + h * s._sh) / s._ch;
    return [lx, lz];
  }
  /** Ship-local (lx, ly, lz) -> world [x, y, z] (heel about the waterline, then the heading): the same as a THREE group with rotation order YXZ, y = yaw, z = heel. */
  function toWorld(s, lx, ly, lz) {
    const x1 = lx * s._ch - ly * s._sh, y = lx * s._sh + ly * s._ch;
    return [s.x + x1 * s._cy + lz * s._sy, y, s.z - x1 * s._sy + lz * s._cy];
  }
  function stepShip(S, H, dt) {
    S.r += (S.cmd * H.rMax - S.r) * Math.min(1, dt / H.tauR);
    S.yaw += S.r * dt;
    S.x -= Math.sin(S.yaw) * SPEED * dt; S.z -= Math.cos(S.yaw) * SPEED * dt;
    S.heel += (-H.heel * S.r / H.rMax - S.heel) * Math.min(1, dt / H.tauH);
  }
  const hand = s => HANDLING[s.dd ? 'dd' : 'cv'];
  function record() {
    const H = FLEET.hist;
    H.push({ t: FLEET.t, s: SHIPS.map(s => [s.st.x, s.st.z, s.st.yaw, s.st.heel, s.st.r]) });
    if (H.length > HIST / FDT + 20) H.splice(0, H.length - HIST / FDT);
  }
  /** A new round: every ship back on station, heading north, rudder amidships. */
  function resetFleet() {
    for (const s of SHIPS) { s.st = { x: s.home.x, z: s.home.z, yaw: 0, r: 0, heel: 0, cmd: 0 }; setPose(s, s.home.x, s.home.z, 0, 0, 0); }
    FLEET.t = 0; FLEET.hist.length = 0; THREATS.length = 0; record();
  }
  /** Put the ships where they are t seconds into the round (integrating forward from the last state, or from the recorded track for a past t). */
  function update(t) {
    t = Math.max(0, t || 0);
    if (t >= FLEET.t) {
      let n = 0;
      while (FLEET.t + FDT <= t + 1e-9 && n++ < 30000) {
        for (const s of SHIPS) if (!s.sunk) stepShip(s.st, hand(s), FDT);
        FLEET.t = Math.round((FLEET.t + FDT) * 1e4) / 1e4; record();
      }
      const f = Math.max(0, t - FLEET.t);
      for (const s of SHIPS) { const S = s.st, k = s.sunk ? 0 : 1; setPose(s, S.x - Math.sin(S.yaw) * SPEED * f * k, S.z - Math.cos(S.yaw) * SPEED * f * k, S.yaw + S.r * f * k, S.heel, S.r * k); }
      return;
    }
    const H = FLEET.hist;                                        // in the past: interpolate the recorded track
    let lo = 0, hi = H.length - 1;
    if (t <= H[0].t) hi = lo = 0;
    else { while (hi - lo > 1) { const m = (lo + hi) >> 1; if (H[m].t <= t) lo = m; else hi = m; } }
    const a = H[lo], b = H[hi], f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
    SHIPS.forEach((s, i) => { const A = a.s[i], B = b.s[i], L = (j) => A[j] + (B[j] - A[j]) * f; setPose(s, L(0), L(1), L(2), L(3), L(4)); });
  }
  /** The server's snapshot of the fleet (sent when a rudder changes, and every second): {T, s: [[x, z, yaw, r, heel, cmd], ...]}.
   *  The server adopts the rounded numbers itself, so both sides integrate exactly the same state. */
  function snap() {
    const R = (v, k) => Math.round(v * k) / k;
    for (const s of SHIPS) { const S = s.st; S.x = R(S.x, 1000); S.z = R(S.z, 1000); S.yaw = R(S.yaw, 1e6); S.r = R(S.r, 1e7); S.heel = R(S.heel, 1e6); }
    return { T: FLEET.t, s: SHIPS.map(s => [s.st.x, s.st.z, s.st.yaw, s.st.r, s.st.heel, s.st.cmd]) };
  }
  function applySnap(m) {
    if (!m || !Number.isFinite(m.T) || !Array.isArray(m.s) || m.s.length !== SHIPS.length) return;
    SHIPS.forEach((s, i) => { const a = m.s[i]; if (Array.isArray(a) && a.length === 6 && a.every(Number.isFinite)) s.st = { x: a[0], z: a[1], yaw: a[2], r: a[3], heel: a[4], cmd: a[5] }; });
    const H = FLEET.hist; while (H.length && H[H.length - 1].t >= m.T) H.pop();
    FLEET.t = m.T; record();
  }

  // ---------- the AI: every ship dodges what is coming at her. A threat is a bomb falling (where and when it reaches her deck height) or a
  // torpedo running (from where, which way, when). The ships know every release (the server re-flies it, with its scatter: the "lookouts").
  // They also anticipate: an enemy bomber diving at them, a torpedo plane low and fast (where its ordnance would go if let go now).
  // steer() is a little model-predictive controller: for each ship it tries rudder plans (one rudder for PLAN_T1 s, then another), flies the ship
  // model forward with each, scores how close every threat comes to the hull or the deck (inside = a hit, the worst; a near miss also costs),
  // the other ships' predicted tracks (no collisions), the drift off the base course, and rudder changes - and takes the best plan's first rudder.
  // With nothing coming, she steers back to the base course (north, on station) with a gentle PD helm.
  const PLAN_DT = 0.25, PLAN_T1 = 10, RUDDERS = [-1, -0.5, 0, 0.5, 1];
  /** A release (a bomb / torpedo left an enemy aircraft): rel = {type, p, v, wind, seed, tRel}; key = who and which, to drop it on impact. */
  function addThreat(rel, team, BM, key) {
    const B = BM.BOMBS[rel.type]; if (!B) return;
    const b = new BM.Bomb({ type: rel.type, p: rel.p, v: rel.v, wind: rel.wind, seed: rel.seed });
    const env = { ground: () => -1, hull: null, obstacle: null, floorMax: 60 }, t0 = rel.tRel || 0, at = {};
    let prev = b.p.slice(), n = 0;
    while (n++ < 5000) {
      const ev = b.advance(BM.DT, env);
      if (b.run) { const T = B.torp; THREATS.push({ kind: 'torp', team, key, w: 1, t0: t0 + b.t, x: b.p[0], z: b.p[2], dx: b.run.dx, dz: b.run.dz, v: T.runSpeed, until: t0 + b.t + (T.runMax - b.run.dist) / T.runSpeed }); return; }
      if (!B.torp) for (const h of [DECK.y, DD.main]) if (!at[h] && prev[1] > h && b.p[1] <= h) { const f = (prev[1] - h) / (prev[1] - b.p[1]); at[h] = { t: t0 + b.t - BM.DT * (1 - f), x: prev[0] + (b.p[0] - prev[0]) * f, z: prev[2] + (b.p[2] - prev[2]) * f }; }
      if (ev) break;
      prev = b.p.slice();
    }
    if (at[DECK.y] && at[DD.main]) THREATS.push({ kind: 'bomb', team, key, w: 1, cv: at[DECK.y], dd: at[DD.main], until: at[DD.main].t + 0.5 });
  }
  function dropThreat(key) { for (let i = THREATS.length - 1; i >= 0; i--) if (THREATS[i].key === key) THREATS.splice(i, 1); }
  /** The anticipated threats of the enemy aircraft: pilots = [{team, p, v, bomb: 'tp' | 'b500' | 'b1000' | null}]. */
  function foresee(s, t, pilots) {
    const out = [];
    for (const a of pilots) {
      if (a.team === s.team || !a.bomb || !a.p || !a.v || a.p[1] < 8) continue;
      const [px, py, pz] = a.p, [vx, vy, vz] = a.v, d = Math.hypot(px - s.x, pz - s.z), hs = Math.hypot(vx, vz), sp = Math.hypot(vx, vy, vz);
      if (d > 4000 || sp < 30) continue;
      if (a.bomb === 'tp') {
        if (py > 160 || hs < 35) continue;
        const tf = Math.sqrt(2 * py / 9.81), ux = vx / hs, uz = vz / hs, ex = px + vx * tf, ez = pz + vz * tf;
        // only if the run would pass near her (it is aimed at her, or close enough to worry)
        const along = (s.x - ex) * ux + (s.z - ez) * uz, cross = Math.abs((s.x - ex) * uz - (s.z - ez) * ux);
        if (along < -100 || along > 1600 || cross > 500) continue;
        out.push({ kind: 'torp', w: 0.45, t0: t + tf + 1, x: ex, z: ez, dx: ux, dz: uz, v: 22, until: t + tf + 1 + 1400 / 22 });
      } else {
        if (vy > -0.25 * sp || d > 2500) continue;                                    // diving at something
        const fall = h => { const tt = (vy + Math.sqrt(vy * vy + 2 * 9.81 * Math.max(0, py - h))) / 9.81; return { t: t + tt, x: px + vx * tt, z: pz + vz * tt }; };
        const cv = fall(DECK.y), dd = fall(DD.main);
        if (Math.hypot(cv.x - s.x, cv.z - s.z) > 600) continue;
        out.push({ kind: 'bomb', w: 0.4, cv, dd, until: dd.t + 0.5 });
      }
    }
    return out;
  }
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  /** The heading this ship wants with nothing coming at her: carriers back to the base course (north) and their lane; the escort to her station. */
  function homeYaw(s, S) {
    if (!s.dd) return -Math.max(-0.35, Math.min(0.35, (s.home.x - S.x) / 2000));
    const c = CARRIERS[s.team].st, ax = c.x + s.dx, az = c.z + s.dz - 700;           // steer for a point 700 m ahead of the station
    return Math.atan2(-(ax - S.x), -(az - S.z));
  }
  function homeCmd(s) {
    const S = s.st, H = hand(s), e = wrap(homeYaw(s, S) - S.yaw);
    const rd = Math.max(-0.6 * H.rMax, Math.min(0.6 * H.rMax, e * H.k));
    return Math.max(-1, Math.min(1, rd / H.rMax + (rd - S.r) / H.rMax * 0.8));
  }
  /** Signed distance from the ship-local point to a rectangle of half-sizes hw x hl (negative inside). */
  function rectDist(lx, lz, hw, hl) {
    const dx = Math.abs(lx) - hw, dz = Math.abs(lz) - hl;
    return dx > 0 || dz > 0 ? Math.hypot(Math.max(0, dx), Math.max(0, dz)) : Math.max(dx, dz);
  }
  const hitCost = (c, M) => c < 0 ? 1000 + 8 * -c : c < M ? 120 * (1 - c / M) * (1 - c / M) : 0;
  /** Fly a copy of the ship's state with rudder a, then b after PLAN_T1; returns the poses every PLAN_DT for n steps. */
  function track(s, a, b, n) {
    const S = { ...s.st }, H = hand(s), out = new Array(n + 1);
    out[0] = [S.x, S.z, S.yaw];
    for (let i = 1; i <= n; i++) { S.cmd = i * PLAN_DT <= PLAN_T1 ? a : b; stepShip(S, H, PLAN_DT); out[i] = [S.x, S.z, S.yaw]; }
    return out;
  }
  function plan(s, thr, others, t) {
    const S = s.st, end = Math.max(...thr.map(k => k.until)) - t, n = Math.ceil(Math.min(75, Math.max(25, end + 4)) / PLAN_DT);
    const dims = s.dd ? { bomb: [DD.hw, DD.len / 2], torp: [DD.hw, DD.len / 2] } : { bomb: [DECK.hw, DECK.len / 2], torp: [DECK.hullHw, DECK.hullLen / 2] };
    let best = S.cmd, bc = Infinity;
    for (const a of RUDDERS) for (const b of RUDDERS) {
      const tr = track(s, a, b, n);
      let cost = 3 * Math.abs(a - S.cmd) + 0.5 * Math.abs(b - a);
      const L = (P, x, z) => { const dx = x - P[0], dz = z - P[1], c = Math.cos(P[2]), sn = Math.sin(P[2]); return [dx * c - dz * sn, dx * sn + dz * c]; };
      for (const k of thr) {
        if (k.kind === 'bomb') {
          const h = s.dd ? k.dd : k.cv, i = Math.max(0, Math.min(n, Math.round((h.t - t) / PLAN_DT)));
          const l = L(tr[i], h.x, h.z); cost += k.w * hitCost(rectDist(l[0], l[1], dims.bomb[0], dims.bomb[1]), 35);
        } else {
          let m = Infinity;
          for (let i = Math.max(0, Math.floor((k.t0 - t) / PLAN_DT)); i <= n; i++) {
            const tt = t + i * PLAN_DT; if (tt > k.until) break;
            const run = Math.max(0, tt - k.t0) * k.v, l = L(tr[i], k.x + k.dx * run, k.z + k.dz * run);
            const d = rectDist(l[0], l[1], dims.torp[0], dims.torp[1]);
            // it runs into her: how far from her nearest end (the bow or the stern: the way out of its path) - it stops there
            if (d < 0) { m = -(dims.torp[1] - Math.abs(l[1])); break; }
            m = Math.min(m, d);
          }
          if (m < Infinity) cost += k.w * hitCost(m, 30);
        }
      }
      // off the base course, and too close to the other ships of the fleet (their tracks as they are steering now)
      for (let i = 0; i <= n; i += 4) {
        const P = tr[i], e = wrap(homeYaw(s, { x: P[0], z: P[1] }) - P[2]); cost += 0.3 * e * e * PLAN_DT * 4;
        for (const o of others) { const Q = o[Math.min(i, o.length - 1)], d = Math.hypot(P[0] - Q[0], P[1] - Q[1]); if (d < 400) cost += (400 - d) * 0.5; }
      }
      if (cost < bc - 1e-6) { bc = cost; best = a; }
    }
    return best;
  }
  /** One decision for every ship (the server calls this a few times a second). pilots: the enemy aircraft, see foresee(). Returns true if a rudder changed. */
  function steer(pilots = []) {
    const t = FLEET.t;
    for (let i = THREATS.length - 1; i >= 0; i--) if (THREATS[i].until < t) THREATS.splice(i, 1);
    const nBase = Math.ceil(40 / PLAN_DT), tracks = SHIPS.map(s => s.sunk ? null : track(s, s.st.cmd, s.st.cmd, nBase));
    let changed = false;
    SHIPS.forEach((s, j) => {
      if (s.sunk) return;
      const thr = THREATS.filter(k => k.team !== s.team).concat(foresee(s, t, pilots));
      const others = tracks.filter((x, i) => x && i !== j && SHIPS[i].team === s.team);
      let cmd = thr.length ? plan(s, thr, others, t) : homeCmd(s);
      cmd = Math.round(cmd * 10) / 10;
      if (cmd !== s.st.cmd) { s.st.cmd = cmd; changed = true; }
      s.evading = thr.length > 0;
    });
    return changed;
  }
  /** The destroyer's hull in plan: half-width at zl metres aft of its middle (the bow is at -len/2: a fine entry, a rounded stern). */
  function ddHalfWidth(zl) {
    const s = (zl + DD.len / 2) / DD.len;
    if (s < 0 || s > 1) return 0;
    return s < 0.32 ? DD.hw * Math.pow(Math.sin(s / 0.32 * Math.PI / 2), 0.85) : s > 0.86 ? DD.hw * (1 - 0.32 * Math.pow((s - 0.86) / 0.14, 2)) : DD.hw;
  }
  /** Deck height at zl: the raised forecastle (with a sheer up to the bow) as far as the break just aft of the bridge, then the main deck. */
  const ddDeckY = zl => zl < DD.fcEnd ? DD.fc + 1.4 * Math.max(0, (-zl - 30) / 29) : DD.main;
  const ddInL = (lx, zl, m = 0) => Math.abs(lx) <= ddHalfWidth(Math.max(-DD.len / 2, Math.min(DD.len / 2, zl))) + m && Math.abs(zl) <= DD.len / 2 + m;
  const ddIn = (e, x, z, m = 0) => { const L = loc(e, x, z, DD.main); return ddInL(L[0], L[1], m); };
  /** Distance from (x, z) to the destroyer's outline (a box with the hull's beam; 0 inside the hull). */
  function distToDD(e, x, z) {
    const L = loc(e, x, z, DD.main);
    if (ddInL(L[0], L[1])) return 0;
    const dx = Math.max(0, Math.abs(L[0]) - DD.hw), dz = Math.max(0, Math.abs(L[1]) - DD.len / 2);
    return Math.max(0.01, Math.hypot(dx, dz));
  }
  /** The bridge and the two raked funnels stand up above the deck (an aircraft flying into them crashes). */
  function ddTopside(e, x, y, z) {
    const L = loc(e, x, z, DD.main), xl = Math.abs(L[0]), zl = L[1];
    if (xl < 4.2 && zl > -31 && zl < -17 && y < 17.5) return 'the destroyer\'s bridge';
    if (xl < 2.4 && ((zl > -12 && zl < -5 && y < 15.5) || (zl > 3 && zl < 10 && y < 14.5))) return 'the destroyer\'s funnel';
    return null;
  }
  const afloat = () => ESCORTS.filter(e => !e.sunk);
  const HP = 2800;
  const SHIELD = { r: 420, ceil: 380 };                                           // guns / missiles cannot hurt anybody inside; bombs go through
  const WIRES = { from: 20, to: 105 };                                            // metres forward of the stern: the arrestor wires
  const CAT = { len: 110, accel: 38 };                                            // catapult: metres from the bow-end start, m/s^2

  const inDeck = (c, x, z, m = 0) => { const L = loc(c, x, z, DECK.y); return Math.abs(L[0]) <= DECK.hw + m && Math.abs(L[1]) <= DECK.len / 2 + m; };
  // the island (control tower) sits on the starboard edge of the deck
  const inIslandL = (lx, lz) => lx > 14 && lx < 31 && lz > -34 && lz < -2;
  const inIsland = (c, x, z) => { const L = loc(c, x, z, DECK.y); return inIslandL(L[0], L[1]); };
  /** The heeled deck's height at ship-local lx (the deck tilts about the waterline when the ship heels in a turn). */
  const deckY = (c, lx) => lx * c._sh + DECK.y * c._ch;
  /** Height of the flight deck under (x, y, z) if that point is just on or above it (a landing wheel, a wingtip), else null. */
  function deckAt(x, y, z) {
    for (const c of CARRIERS) {
      const L = loc(c, x, z, DECK.y); if (Math.abs(L[0]) > DECK.hw || Math.abs(L[1]) > DECK.len / 2 || inIslandL(L[0], L[1])) continue;
      const h = deckY(c, L[0]); if (y > h - 2.5 && y < h + 40) return h;
    }
    return null;
  }
  /** The deck's surface normal (it heels in a turn): world [nx, ny, nz]. */
  function deckNormal(c) { return [-c._sh * c._cy, c._ch, c._sh * c._sy]; }
  /** The normal of the deck under (x, y, z), or null when not over a deck or the deck is level. */
  function deckNormalAt(x, y, z) { for (const c of CARRIERS) if (Math.abs(c.heel) > 1e-4 && inDeck(c, x, z)) return deckNormal(c); return null; }
  /** What a flying thing or a bomb hits at (x, y, z): the hull, the island, or null. */
  function solidAt(x, y, z) {
    for (const e of afloat()) { const L = loc(e, x, z, DD.main); if (ddInL(L[0], L[1])) {
      const top = ddTopside(e, x, y, z); if (top) return top;
      if (y <= ddDeckY(L[1]) + L[0] * e._sh && y > -DD.draft) return 'the destroyer';
    } }
    for (const c of CARRIERS) {
      const L = loc(c, x, z, DECK.y), h = deckY(c, L[0]);
      if (inIslandL(L[0], L[1]) && y < h + 17 && y > 0) return 'the island';
      if (Math.abs(L[0]) > DECK.hw || Math.abs(L[1]) > DECK.len / 2) continue;
      if (y <= h - 2.5 && y > -2) return 'the carrier';
      if (y > h - 2.5 && y <= h) return 'the flight deck';
    }
    return null;
  }
  /** Which carrier's shield (if any) contains the point. */
  function shieldAt(x, y, z) {
    if (y > SHIELD.ceil) return null;
    for (const c of CARRIERS) if (Math.hypot(x - c.x, z - c.z) <= SHIELD.r) return c;
    return null;
  }
  /** Distance from (x, z) to the carrier's deck rectangle (0 when inside). */
  function distToDeck(c, x, z) {
    const L = loc(c, x, z, DECK.y), dx = Math.max(0, Math.abs(L[0]) - DECK.hw), dz = Math.max(0, Math.abs(L[1]) - DECK.len / 2);
    return Math.hypot(dx, dz);
  }
  /** Where a team's planes appear: on the deck, behind the catapult mark at the stern end, pointing north. */
  function spawnPoint(team, slot) {
    // three lanes, each plane a row behind the last: the outer wingtips stay clear of the parked, wing-folded aircraft on the deck edges (|x| > 17)
    // and of the island (x > 14); the planes are staggered 14 m apart so neighbouring wings never overlap
    const c = CARRIERS[team], i = slot % 9, lane = [-8, 0, 7.5][i % 3], w = toWorld(c, lane, DECK.y, DECK.len / 2 - 40 - i * 14);
    return { x: w[0], z: w[2], y: w[1], yaw: c.yaw };
  }
  /** The bomb environment: the sea everywhere (ground -1), a bomb that reaches a carrier's deck bursts on it. */
  /** Inside a carrier's waterline outline (what a running torpedo hits; the hull is 300 m long and ~31 m wide at the water). */
  const hullAt = (c, x, z) => { const L = loc(c, x, z); return Math.abs(L[0]) <= DECK.hullHw * 0.95 && Math.abs(L[1]) <= DECK.hullLen / 2 * 0.95; };
  const bombEnv = { hull: (x, z) => CARRIERS.some(c => hullAt(c, x, z)) || afloat().some(e => ddIn(e, x, z)),
                    ground: (x, z) => {
                      for (const c of CARRIERS) { const L = loc(c, x, z, DECK.y); if (Math.abs(L[0]) <= DECK.hw && Math.abs(L[1]) <= DECK.len / 2) return deckY(c, L[0]); }
                      for (const e of afloat()) { const L = loc(e, x, z, DD.main); if (ddInL(L[0], L[1])) return ddDeckY(L[1]) + L[0] * e._sh; }
                      return -1; }, obstacle: null, floorMax: 60 };
  // damage from a direct hit on the deck (a level / glide bomb). A torpedo under the waterline: three sink a carrier, one breaks a destroyer's back.
  const BOMB_DMG = { b500: 300, b1000: 600, tp: 1100 };
  /** Dive bombing: a bomb released in a steep dive hits faster, more vertically and exactly where it was aimed - it goes through the flight deck
   *  and bursts in the hangar below. x1 for a release flatter than 25 deg, rising to x1.6 at 50 deg and steeper (three dive-bombed 1000 lb hits sink a carrier).
   *  v = the aircraft's velocity when it let the bomb go. */
  function diveFactor(v) {
    if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite)) return 1;
    const sp = Math.hypot(v[0], v[1], v[2]); if (sp < 1) return 1;
    const dive = Math.asin(Math.max(-1, Math.min(1, -v[1] / sp))) * 180 / Math.PI;
    return 1 + 0.6 * Math.max(0, Math.min(1, (dive - 25) / 25));
  }
  const CRASH_DMG = { hellcat: 100, zero: 70, dauntless: 120, val: 100, avenger: 160, kate: 120, corsair: 110, suisei: 110 };      // damage to a carrier from a plane flying into it at 70 m/s (scaled by speed, 0.3x - 1.6x)
  /** Is a point on a carrier's deck, island or hull side (what a crashing aircraft can hit)? Returns that carrier. */
  function shipAt(x, y, z) {
    for (const e of afloat()) if (distToDD(e, x, z) <= 4 && y > -3 && y < 18) return e;
    for (const c of CARRIERS) if (distToDeck(c, x, z) <= 6 && y > -3 && y < DECK.y + 18) return c;
    return null;
  }
  const BLAST = { b500: 55, b1000: 75, tp: 45 };                                           // lethal radius to aircraft, metres
  resetFleet();
  return { dropThreat, foresee, SPEED, Z0, ROUND_MAX, update, FLEET, SHIPS, loc, toWorld, deckNormal, deckNormalAt, deckY, resetFleet, applySnap, snap, addThreat, steer, threats: THREATS, HANDLING, DECK, CARRIERS, HP, SHIELD, WIRES, CAT, inDeck, inIsland, deckAt, solidAt, shieldAt, distToDeck, spawnPoint, bombEnv, BOMB_DMG, BLAST, CRASH_DMG, shipAt, hullAt,
           DD, ESCORTS, DD_HP, ddIn, ddDeckY, ddHalfWidth, distToDD, diveFactor };
});
