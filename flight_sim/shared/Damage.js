/**
 * Damage - the persistent state of the map after bombs and missiles, shared by the browser and the Node server.
 *
 *   WEAPONS / MATERIALS   what a warhead of `ex` kg of TNT does to soil, sand, rock or pavement
 *   makeCrater()          a crater record {id, w, x, z, R, d, H, mat, seed, ...} (radius R scales with ex^(1/3))
 *   DamageField           the craters as a height function: dh(x, z) is added to the terrain, so the physics ground,
 *                         the wheels, the birds and the picture all use the same deformed surface
 *   DamageStore           the authoritative list (server) / the offline copy (browser): merge repeated hits on the
 *                         same spot into one deeper crater, cap the number, serialise
 *   runwayStatus()        how much of the runway is still usable (longest clear stretch) for a given gear track
 *   lastNoonET()          the daily reset: 12:00 PM America/New_York, DST handled by the time zone database
 *
 * A crater is a paraboloid bowl (depth d, radius R, lumpy outline) with a raised rim of ejecta (height H) fading
 * out at 2.4 R; hard surfaces (pavement, rock) add a rubble ring of random bumps. Overlapping craters add up.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FSDamage = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const getW = () => (typeof require === 'function' ? require('./World.js') : globalThis.FSWorld);

  /** ex = TNT-equivalent explosive in kg. */
  const WEAPONS = {
    msl:   { name: 'AIM-9 Sidewinder', ex: 4 },
    b500:  { name: '500 lb GP bomb', ex: 120 },
    b1000: { name: '1,000 lb GP bomb', ex: 240 },
    b2000: { name: '2,000 lb GP bomb', ex: 480 },
    tp:    { name: 'aerial torpedo', ex: 300 },
    grand: { name: '22,000 lb Grand Slam', ex: 4300 },
  };
  // k: crater radius per ex^(1/3); depth, rim: fractions of R and of the depth; rough: rubble bump height (m per sqrt(R))
  const MATERIALS = {
    soil:     { k: 1.10, depth: 0.36, rim: 0.22, rough: 0 },
    sand:     { k: 1.25, depth: 0.28, rim: 0.12, rough: 0 },
    rock:     { k: 0.72, depth: 0.22, rim: 0.10, rough: 0.30 },
    pavement: { k: 0.95, depth: 0.34, rim: 0.42, rough: 0.28 },
  };
  const MAX_CRATERS = 400;
  const DEPTH_CAP = 10, RISE_CAP = 4;            // metres the ground can drop / rise from overlapping craters
  const CELL = 128;

  const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  function hash2(ix, iz, s) {
    let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(s | 0, 1274126177) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }
  function vnoise(x, z, s) {                       // smooth value noise in [-1, 1]
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
    const a = hash2(ix, iz, s), b = hash2(ix + 1, iz, s), c = hash2(ix, iz + 1, s), d = hash2(ix + 1, iz + 1, s);
    return (a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz) * 2 - 1;
  }
  function rng(seed) { let s = (seed | 0) || 1; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  /** What is the ground made of at (x, z)? 'water' | 'pavement' | 'rock' | 'sand' | 'soil' - from the shared terrain function. */
  function classify(x, z) {
    const W = getW(), h = W.heightAt(x, z);
    if (h < 0.2) return 'water';
    if (W.onRunway(x, z) || (Math.abs(x - W.RUNWAY.x) <= W.RUNWAY.width / 2 + 5 && z <= W.RUNWAY.z0 + 30 && z >= W.RUNWAY.z1 - 30)) return 'pavement';
    const s = 12, slope = Math.hypot(W.heightAt(x + s, z) - W.heightAt(x - s, z), W.heightAt(x, z + s) - W.heightAt(x, z - s)) / (2 * s);
    if (slope > 0.5 || h > 650 + W.fbm(x / 700, z / 700, 3) * 120) return 'rock';
    if (h < 7 + W.fbm(x / 160 + 7, z / 160, 2) * 3) return 'sand';
    return 'soil';
  }

  /** A crater record for weapon w landing at (x, z) on material mat. Deterministic from `seed`. */
  function makeCrater(w, x, z, mat, seed) {
    const W = WEAPONS[w], M = MATERIALS[mat] || MATERIALS.soil, r = rng(seed);
    const R = M.k * Math.cbrt(W.ex), d = M.depth * R;
    const c = { id: 0, v: 1, w, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, R: Math.round(R * 100) / 100, d: Math.round(d * 100) / 100,
                H: Math.round(M.rim * d * 100) / 100, mat, seed: seed | 0, ex: W.ex, a: Math.round(r() * 628) / 100, b: Math.round(r() * 628) / 100, t: 0 };
    prepare(c);
    return c;
  }
  /** Derived (not stored) fields: influence radius, roughness, zone radii. */
  function prepare(c) {
    const M = MATERIALS[c.mat] || MATERIALS.soil;
    c.Ri = c.R * 2.8;                                 // beyond this the crater changes nothing
    c.Ri2 = c.Ri * c.Ri;
    c.rough = M.rough * Math.sqrt(c.R);
    c.Rt = c.R * 3.2;                                 // trees are felled / burnt out to here
    return c;
  }

  /** Height change of one crater at (x, z): bowl + rim + rubble. */
  function craterDh(c, x, z) {
    const dx = x - c.x, dz = z - c.z, r2 = dx * dx + dz * dz;
    if (r2 >= c.Ri2) return 0;
    const th = Math.atan2(dz, dx), Re = c.R * (1 + 0.10 * Math.sin(3 * th + c.a) + 0.06 * Math.sin(5 * th + c.b)), p = Math.sqrt(r2) / Re;
    let h = p < 1 ? -c.d * (1 - p * p) : 0;
    const q = (p - 1.1) / 0.45;
    h += c.H * Math.exp(-q * q) * smooth(2.4, 1.7, p);
    if (c.rough && p > 0.45 && p < 2.1) h += c.rough * vnoise(x / 2.2, z / 2.2, c.seed) * smooth(0.45, 0.8, p) * smooth(2.1, 1.5, p);
    return h;
  }

  /** The craters as a height function, with a 128 m grid so lookups only touch the craters nearby. */
  class DamageField {
    constructor() { this.list = []; this.byId = new Map(); this.cells = new Map(); this.version = 0; }
    clear() { this.list = []; this.byId.clear(); this.cells.clear(); this.version++; }
    key(ix, iz) { return (ix + 256) * 1024 + (iz + 256); }
    unindex(c) { for (const k of c._cells || []) { const a = this.cells.get(k); if (a) { const i = a.indexOf(c); if (i >= 0) a.splice(i, 1); } } c._cells = null; }
    index(c) {
      c._cells = [];
      const x0 = Math.floor((c.x - c.Ri) / CELL), x1 = Math.floor((c.x + c.Ri) / CELL), z0 = Math.floor((c.z - c.Ri) / CELL), z1 = Math.floor((c.z + c.Ri) / CELL);
      for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) { const k = this.key(ix, iz); let a = this.cells.get(k); if (!a) this.cells.set(k, a = []); a.push(c); c._cells.push(k); }
    }
    /** Add a crater record, or replace the one with the same id (a merged / deepened crater). */
    add(rec) {
      const old = this.byId.get(rec.id);
      if (old) { this.unindex(old); this.list.splice(this.list.indexOf(old), 1); }
      const c = prepare(Object.assign({}, rec));
      this.list.push(c); this.byId.set(c.id, c); this.index(c); this.version++;
      return c;
    }
    near(x, z) { return this.cells.get(this.key(Math.floor(x / CELL), Math.floor(z / CELL))); }
    /** Height change at (x, z), metres. 0 away from every crater. */
    dh(x, z) {
      if (!this.list.length) return 0;
      const a = this.near(x, z);
      if (!a) return 0;
      let h = 0;
      for (let i = 0; i < a.length; i++) h += craterDh(a[i], x, z);
      return h < -DEPTH_CAP ? -DEPTH_CAP : h > RISE_CAP ? RISE_CAP : h;
    }
    /** On a broken hard surface (pavement or rock rubble)? Wheels roll badly there. */
    rubbleAt(x, z) {
      const a = this.near(x, z);
      if (!a) return false;
      for (let i = 0; i < a.length; i++) {
        const c = a[i];
        if (c.mat !== 'pavement' && c.mat !== 'rock') continue;
        const dx = x - c.x, dz = z - c.z;
        if (dx * dx + dz * dz < (c.R * 2.0) * (c.R * 2.0)) return true;
      }
      return false;
    }
    /** Is any crater within r metres of (x, z) (centre + its own radius)? */
    nearCrater(x, z, r) {
      for (const c of this.list) if (Math.hypot(c.x - x, c.z - z) < c.R * 1.4 + r) return true;
      return false;
    }
  }

  /** What happens to tree number i (deterministic) at distance `dist` from crater c: 0 untouched, 1 burnt, 2 blown over, 3 destroyed. */
  function treeFate(i, dist, c) {
    if (dist < c.R * 1.15) return 3;
    if (dist >= c.Rt) return 0;
    const p = 1 - (dist - c.R * 1.15) / (c.Rt - c.R * 1.15), u = hash2(i, c.id, c.seed);
    return u < p * 0.45 ? 3 : u < p * 0.8 ? 2 : u < p ? 1 : 0;
  }

  /**
   * The authoritative crater list. add(w, x, z, seed) -> {rec, merged} | null (full). Repeated hits on one spot
   * deepen and widen the crater that is already there instead of stacking a new one on top of it.
   */
  class DamageStore {
    constructor() { this.field = new DamageField(); this.nextId = 1; this.era = 0; }
    get list() { return this.field.list; }
    reset(era) { this.field.clear(); this.nextId = 1; this.era = era || 0; }
    load(data) {
      this.reset(data.era);
      for (const c of data.craters || []) { this.field.add(c); this.nextId = Math.max(this.nextId, c.id + 1); }
    }
    save() { return { era: this.era, craters: this.field.list.map(strip) }; }
    /** Remove every crater for which pred(c) is true (ids of the others stay). Returns how many went. */
    removeWhere(pred) {
      const keep = this.field.list.filter(c => !pred(c)), n = this.field.list.length - keep.length;
      if (n) { const recs = keep.map(strip); this.field.clear(); for (const r of recs) this.field.add(r); }
      return n;
    }
    add(w, x, z, mat, seed, now = Date.now()) {
      const fresh = makeCrater(w, x, z, mat, seed);
      let best = null, bd = Infinity;
      for (const c of this.field.list) {
        const d = Math.hypot(c.x - x, c.z - z);
        if (d < Math.max(c.R, fresh.R) * 0.5 && d < bd) { best = c; bd = d; }
      }
      if (best) {                                       // a second bomb in the same hole: bigger and deeper
        const m = MATERIALS[best.mat] || MATERIALS.soil;
        const R = Math.min(60, Math.sqrt(best.R * best.R + fresh.R * fresh.R * 0.8)), d = Math.min(DEPTH_CAP, best.d + fresh.d * 0.6);
        const rec = Object.assign(strip(best), { R: Math.round(R * 100) / 100, d: Math.round(d * 100) / 100, H: Math.round(m.rim * d * 100) / 100, v: best.v + 1, ex: best.ex + fresh.ex, t: now,
                                                 x: Math.round((best.x + (x - best.x) * 0.2) * 10) / 10, z: Math.round((best.z + (z - best.z) * 0.2) * 10) / 10 });
        this.field.add(rec);
        return { rec: strip(rec), merged: true };
      }
      if (this.field.list.length >= MAX_CRATERS) return null;
      fresh.id = this.nextId++; fresh.t = now;
      this.field.add(fresh);
      return { rec: strip(fresh), merged: false };
    }
  }
  /** The stored fields only (what is saved / sent over the network). */
  function strip(c) { return { id: c.id, v: c.v, w: c.w, x: c.x, z: c.z, R: c.R, d: c.d, H: c.H, mat: c.mat, seed: c.seed, ex: c.ex, a: c.a, b: c.b, t: c.t }; }

  /** Does crater c (bowl, rim and rubble: 1.35 R) touch the runway strip? */
  function onRunway(c, R) {
    if (!R) { const W = getW(); return onRunway(c, W.RUNWAY) || onRunway(c, W.AIRSTRIP); }          // the paved runway or Cinder Cay's dirt strip
    return Math.abs(c.x - R.x) < R.width / 2 + c.R * 1.35 && c.z > R.z1 - c.R * 1.35 && c.z < R.z0 + c.R * 1.35;
  }

  /**
   * Usable runway for an aircraft with the given gear track (m): five lanes across the strip; a lane is blocked
   * wherever a crater (its bowl, rim and rubble, 1.35 R) comes within half a track + 2 m of it. Returns the longest
   * clear stretch in the best lane, the whole length, and the blocked intervals along z (for the map).
   */
  function runwayStatus(list, track = 8, R = getW().RUNWAY) {
    const lanes = [-10, -5, 0, 5, 10].map(o => R.x + o), step = 2, n = Math.ceil(R.length / step);
    const cs = list.filter(c => Math.abs(c.x - R.x) < R.width / 2 + c.R * 1.35 + track && c.z > R.z1 - c.R * 1.35 && c.z < R.z0 + c.R * 1.35);
    let best = 0, bestStart = R.z1, blocked = [];
    for (const lx of lanes) {
      let run = 0, runStart = R.z1;
      for (let i = 0; i <= n; i++) {
        const z = R.z1 + i * step;
        let bad = i === n;
        for (let k = 0; k < cs.length && !bad; k++) { const c = cs[k], dx = lx - c.x, dz = z - c.z; bad = dx * dx + dz * dz < (c.R * 1.35 + track / 2 + 2) ** 2; }
        if (bad) { if (run > best) { best = run; bestStart = runStart; } run = 0; runStart = z + step; } else run += step;
      }
    }
    for (const c of cs) blocked.push([c.z - c.R * 1.35, c.z + c.R * 1.35]);
    return { length: R.length, clear: Math.round(best), from: bestStart, to: bestStart + best, pct: Math.round(best / R.length * 100), craters: cs.length, blocked };
  }

  // ---------- the daily reset: 12:00 PM America/New_York
  const TZ = 'America/New_York';
  let _fmt = null;
  function etParts(ms) {
    _fmt = _fmt || new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const o = {};
    for (const p of _fmt.formatToParts(new Date(ms))) o[p.type] = +p.value;
    return o;
  }
  /** Offset (ms) of New York wall-clock time from UTC at instant ms (negative: behind UTC). */
  function etOffset(ms) { const p = etParts(ms); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000; }
  /** The instant (UTC ms) of 12:00:00 New York time on that calendar date. Noon is never inside a DST gap. */
  function noonET(y, m, d) {
    const guess = Date.UTC(y, m - 1, d, 12, 0, 0);
    let t = guess - etOffset(guess);
    const o2 = etOffset(t);
    if (guess - o2 !== t) t = guess - o2;
    return t;
  }
  /** The most recent 12:00 PM Eastern at or before `now`: the id ("era") of the current map. */
  function lastNoonET(now = Date.now()) {
    const p = etParts(now);
    let t = noonET(p.year, p.month, p.day);
    if (t > now) { const d = new Date(Date.UTC(p.year, p.month - 1, p.day - 1)); t = noonET(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
    return t;
  }
  /** The next reset after `now`. */
  function nextNoonET(now = Date.now()) {
    const p = etParts(lastNoonET(now)), d = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
    return noonET(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  return { WEAPONS, MATERIALS, MAX_CRATERS, classify, makeCrater, prepare, craterDh, DamageField, DamageStore, treeFate, runwayStatus, onRunway, strip, rng, hash2,
           lastNoonET, nextNoonET, TZ };
});
