/**
 * Skyward Dynamics - the world, shared by the browser and the Node server.
 * Deterministic (seeded) so every client and the server agree on terrain, runway and the race course.
 *
 * Axes: x east, y up, z south (so -z is north). Units: metres. Sea level is y = 0.
 *   - an island: rolling hills in the middle, a mountain range to the north, coast to the south
 *   - a river canyon winding through the mountains, out to the sea in the west (the ring race flies it)
 *   - runway 18/36 at the origin, 1400 m x 30 m, along z; landings come in from the sea (south)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FSWorld = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SIZE = 26000;                 // the terrain square, centred on the origin
  const RUNWAY = { x: 0, z: 0, length: 1400, width: 30, elev: 14, heading: 0 };   // heading 0 = takes off toward north (-z)
  RUNWAY.z0 = RUNWAY.z + RUNWAY.length / 2;     // southern threshold (landing direction: northbound)
  RUNWAY.z1 = RUNWAY.z - RUNWAY.length / 2;     // northern end
  // the sea lane: a buoyed water runway for the floatplane south-east of the island, landing northbound like runway 36
  const SEALANE = { x: 1600, z: 5000, length: 1400, width: 60, elev: 0, heading: 0 };
  SEALANE.z0 = SEALANE.z + SEALANE.length / 2;
  SEALANE.z1 = SEALANE.z - SEALANE.length / 2;
  // Cinder Cay: a volcanic island ~5 km south-west of the main one - a smoking cone with a crater, a ridge, a horseshoe bay
  // open to the south and a red-earth plateau in the east with an UNPAVED strip (same 36 / 18 orientation as the runway)
  const ISLE = { x: -5000, z: 8800 };
  const AIRSTRIP = { x: ISLE.x + 900, z: ISLE.z + 120, length: 1000, width: 24, elev: 16, heading: 0, name: 'Cinder Cay', surface: 'dirt' };
  AIRSTRIP.z0 = AIRSTRIP.z + AIRSTRIP.length / 2;
  AIRSTRIP.z1 = AIRSTRIP.z - AIRSTRIP.length / 2;
  const VOLCANO = { x: ISLE.x - 500, z: ISLE.z - 300, peak: 460, reach: 760, crater: 190, floor: 190 };
  // flattened sites for the playground (client/Playground.js): ellipse rx * rz, blended into the hills over 150 m
  const SITES = {
    rex: { x: -650, z: -350, rx: 120, rz: 290, elev: 66, yaw: Math.PI / 2 },    // the REX statue, facing the runway
    barn: { x: 800, z: -300, rx: 70, rz: 70, elev: 74, yaw: 0 },               // a barn to fly through (north-south)
  };

  // ---------- noise (value noise + fbm, hashed so it needs no tables)
  function hash(ix, iz) {
    let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }
  const fade = t => t * t * (3 - 2 * t);
  function vnoise(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z), fx = fade(x - ix), fz = fade(z - iz);
    const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
    return (a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz) * 2 - 1;
  }
  function fbm(x, z, oct) {
    let s = 0, a = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { s += a * vnoise(x * f + i * 17.3, z * f - i * 9.1); n += a; a *= 0.5; f *= 2.03; }
    return s / n;
  }
  const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---------- the canyon: a polyline through the mountains, floor sloping gently down toward the sea
  const CANYON = [
    [-5200, -6900], [-4200, -6200], [-3300, -6450], [-2400, -5800], [-1700, -5000], [-700, -4750],
    [300, -5150], [1300, -4650], [2100, -3900], [2600, -3000], [3050, -2150],
  ];
  CANYON.unshift([-8100, -6150], [-7300, -5700], [-6300, -6500]);   // the west end opens onto the sea
  const CANYON_FLOOR = [-10, 40, 170, 260, 245, 230, 215, 200, 185, 175, 160, 140, 120, 90];
  function canyonInfo(x, z) {            // distance to the centreline and the floor height there
    let best = Infinity, floor = 0;
    for (let i = 0; i < CANYON.length - 1; i++) {
      const [ax, az] = CANYON[i], [bx, bz] = CANYON[i + 1];
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
      if (d < best) { best = d; floor = lerp(CANYON_FLOOR[i], CANYON_FLOOR[i + 1], t); }
    }
    return { d: best, floor };
  }

  // ---------- Cinder Cay
  const capsule = (px, pz, ax, az, bx, bz) => {          // distance from (px, pz) to the segment a-b
    const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(px - ax - dx * t, pz - az - dz * t);
  };
  /** Signed distance (m) to the island's coast contour: negative inland. Only meaningful within ~2.6 km of the island. */
  function isleSdf(x, z) {
    const u = x - ISLE.x, v = z - ISLE.z;
    const vol = Math.hypot(u + 500, v + 300) - 620;
    const plat = (Math.hypot((u - 900) / 520, (v - 150) / 950) - 1) * 560;
    const ridge = capsule(u, v, -500, -300, 700, -900) - 230;
    const spit = capsule(u, v, -380, 350, -250, 1000) - 140;
    let d = Math.min(vol, plat, ridge, spit);
    const bay = Math.min(Math.hypot(u - 80, v - 500) - 330, capsule(u, v, 80, 500, 80, 1700) - 170);      // the horseshoe bay and its channel to the sea
    d = Math.max(d, -bay);
    return d + fbm(x / 420 + 11, z / 420 - 7, 3) * 95;
  }
  /** Island height (sea floor included: about -70 well away from the coast). */
  function isleHeight(x, z) {
    const sdf = isleSdf(x, z), t = -sdf;
    let h = -70 + 84 * smooth(-450, 40, t);
    const inland = smooth(0, 320, t);
    h += inland * (22 * (fbm(x / 260, z / 260, 3) * 0.5 + 0.5) + 10 * fbm(x / 90, z / 90, 2));
    const rr = Math.hypot(x - VOLCANO.x, z - VOLCANO.z) + fbm(x / 160, z / 160, 2) * 55;       // the cone, with a crater
    if (rr < VOLCANO.reach) {
      const cone = r => VOLCANO.peak * Math.pow(Math.max(0, 1 - r / VOLCANO.reach), 1.7);
      let c = cone(rr);
      if (rr < VOLCANO.crater) c = lerp(cone(VOLCANO.crater) - 92, c, smooth(70, VOLCANO.crater, rr));
      h += c;
    }
    const rd = capsule(x - ISLE.x, z - ISLE.z, -500, -300, 700, -900);                          // the ridge joining it to the plateau
    h += 120 * Math.exp(-((rd / 240) ** 2)) * inland * (0.7 + 0.5 * fbm(x / 300, z / 300, 2));
    const A = AIRSTRIP, ax = Math.abs(x - A.x), az = Math.abs(z - A.z);                           // flatten the strip
    const f = smooth(0, 300, Math.max(ax - 70, az - (A.length / 2 + 110), 0));
    if (f < 1) h = lerp(A.elev, h, f);
    return h;
  }
  /** On the dirt strip? */
  function onAirstrip(x, z) { return Math.abs(x - AIRSTRIP.x) <= AIRSTRIP.width / 2 && z <= AIRSTRIP.z0 && z >= AIRSTRIP.z1; }
  /** How much (0..1) of the island's volcanic ash and red earth colours the ground at (x, z): [ash, earth]. */
  function isleMix(x, z) {
    const rr = Math.hypot(x - VOLCANO.x, z - VOLCANO.z), pe = Math.hypot((x - AIRSTRIP.x) / 480, (z - AIRSTRIP.z) / 900);
    return [1 - smooth(260, 700, rr + fbm(x / 120, z / 120, 2) * 90), (1 - smooth(0.6, 1.25, pe)) * smooth(300, 600, rr)];
  }

  /** Terrain height at (x, z). Below 0 is sea. */
  function heightAt(x, z) {
    // island mask: land around (0, -2600), coast ~2.8 km south of the runway
    const cx = x / 1.15, cz = z + 2600;
    const dist = Math.hypot(cx, cz) + fbm(x / 2600, z / 2600, 3) * 1300;
    const land = 1 - smooth(5200, 7600, dist);
    const hills = 30 + 110 * (fbm(x / 1500, z / 1500, 5) * 0.5 + 0.5);
    let h = land * hills - (1 - land) * 70;
    // mountains to the north (ridged noise), strongest beyond z = -3500
    const mask = smooth(-2200, -4300, z) * land;
    if (mask > 0) {
      const r = 1 - Math.abs(fbm(x / 2200 + 40, z / 2200 - 30, 5));
      h += mask * (420 + 1100 * Math.pow(r, 2.2) + 220 * fbm(x / 600, z / 600, 3));
    }
    // carve the canyon
    const c = canyonInfo(x, z);
    if (c.d < 420) {
      const k = 1 - smooth(70, 420, c.d);
      const floor = c.floor + 8 * fbm(x / 120, z / 120, 2);
      if (h > floor) h = lerp(h, floor, k * k * (3 - 2 * k));
    }
    // the approach to runway 36 (from the south): keep the ground well under the 3-degree glide path
    if (z > RUNWAY.z0 - 200 && z < RUNWAY.z0 + 6000) {
      const along = Math.max(0, z - RUNWAY.z0);
      const cap = RUNWAY.elev - 1 + along * 0.022 + Math.max(0, Math.abs(x - RUNWAY.x) - 250) * 0.12;
      if (h > cap) h = cap;
    }
    // flatten the airfield
    const ax = Math.abs(x - RUNWAY.x), az = Math.abs(z - RUNWAY.z);
    const pad = Math.max(ax - 90, az - (RUNWAY.length / 2 + 160), 0);
    const f = smooth(0, 420, pad);
    h = lerp(RUNWAY.elev, h, f);
    // playground sites
    for (const k in SITES) {
      const st = SITES[k], e = Math.hypot((x - st.x) / st.rx, (z - st.z) / st.rz);
      if (e < 3) h = lerp(st.elev, h, smooth(0, 150, (e - 1) * Math.min(st.rx, st.rz)));
    }
    // Cinder Cay
    if (Math.abs(x - ISLE.x) < 2700 && Math.abs(z - ISLE.z) < 2700) { const ih = isleHeight(x, z); if (ih > h) h = ih; }
    // the terrain mesh ends at +-SIZE/2: let the land (the northern mountains too) fall into the sea before it,
    // with a ragged coastline, so the island never ends in a cut-off cliff hanging above nothing
    const edge = Math.max(Math.abs(x), Math.abs(z)) + fbm(x / 900 + 3, z / 900 - 5, 3) * 450;
    const ef = smooth(SIZE / 2 - 2500, SIZE / 2 - 550, edge);
    if (ef > 0 && h > -60) h = lerp(h, -60, ef);
    return h;
  }
  /** Inside a playground site (keep trees out)? */
  function inSite(x, z, margin = 0) {
    for (const k in SITES) { const st = SITES[k]; if (Math.hypot((x - st.x) / (st.rx + margin), (z - st.z) / (st.rz + margin)) < 1) return true; }
    return false;
  }

  /** Is (x, z) on the paved runway? */
  function onRunway(x, z) {
    return Math.abs(x - RUNWAY.x) <= RUNWAY.width / 2 && z <= RUNWAY.z0 && z >= RUNWAY.z1;
  }

  // ---------- three maps and three kinds of aircraft
  // The PEACE map is for civil aircraft only (no weapons, no craters, nobody shoots anybody). The WAR map takes everything:
  // war aircraft can only fly there, civil aircraft may join it - unarmed, and fair game. The CARRIER map is another sea altogether
  // (carrier_war/): two carriers, WWII carrier aircraft only, two teams - the island, its airfields and craters do not exist there.
  const MAPS = ['peace', 'war', 'carrier'];
  const CIVIL = ['trainer', 'sport', 'seaplane'], WARPLANES = ['warbird', 'jet', 'a10', 'b29'], CARRIER_PLANES = ['hellcat', 'dauntless', 'avenger', 'corsair', 'zero', 'val', 'kate', 'suisei'];
  const isCivil = plane => CIVIL.indexOf(plane) >= 0;
  const isCarrierPlane = plane => CARRIER_PLANES.indexOf(plane) >= 0;
  const mapAllows = (map, plane) => map === 'carrier' ? isCarrierPlane(plane) : isCarrierPlane(plane) ? false : map === 'war' ? (isCivil(plane) || WARPLANES.indexOf(plane) >= 0) : isCivil(plane);

  // ---------- the airbase shield (war map)
  // Over each airfield (paved runway, Cinder Cay, the sea lane) and its final approach there is a protected box. Inside it nobody can be
  // hurt by guns, missiles or bomb blasts and nobody can fire (no strafing the parked, no spawn camping, no shooting down the landing).
  // Leaving it you keep the protection for SHIELD.grace seconds to get clear - until you fire something.
  const FIELDS = [
    { id: 'main', name: 'Main airfield', S: RUNWAY }, { id: 'isle', name: 'Cinder Cay', S: AIRSTRIP }, { id: 'sea', name: 'Sea lane', S: SEALANE },
  ];
  const SHIELD = { side: 380, beyond: 350, approach: 1900, ceil: 320, grace: 8, repairMs: 3 * 60 * 1000, repairEveryMs: 25 * 1000 };
  /** The field whose shield (x, y, z) is inside, or null. */
  function shieldAt(x, y, z) {
    for (let i = 0; i < FIELDS.length; i++) {
      const S = FIELDS[i].S;
      if (Math.abs(x - S.x) <= S.width / 2 + SHIELD.side && z >= S.z1 - SHIELD.beyond && z <= S.z0 + SHIELD.approach && y <= S.elev + SHIELD.ceil) return FIELDS[i];
    }
    return null;
  }
  /** The corners of a field's shield on the ground: [x0, z0, x1, z1] (west, north, east, south). */
  function shieldBox(f) {
    const S = f.S, hw = S.width / 2 + SHIELD.side;
    return [S.x - hw, S.z1 - SHIELD.beyond, S.x + hw, S.z0 + SHIELD.approach];
  }

  // ---------- ring race course: up the canyon from the sea end, over the pass, back to the field
  // each ring: {x, y, z, yaw (heading the ring faces, radians, 0 = north), r}
  function buildCourse() {
    const pts = [];
    // canyon gates on the centreline's corners, flown from the east mouth to the sea in the west:
    // every leg between two gates follows the river, so it never cuts through a canyon wall
    for (let i = CANYON.length - 1; i >= 0; i--) {
      const [x, z] = CANYON[i];
      pts.push({ x, z, y: canyonInfo(x, z).floor + 70 });
    }
    const climb = [[-9200, -4700], [-8900, -2500], [-6000, -1300], [-3000, -400], [-1100, 150]];
    for (const [x, z] of climb) pts.push({ x, z, y: 0, clear: true });
    pts.push({ x: 0, z: 450, y: 60 });
    // out of the canyon: fly ~110 m above the highest ground on the way to each ring
    pts.forEach((p, i) => {
      if (!p.clear) return;
      const a = pts[i - 1];
      let top = 0;
      for (let k = 0; k <= 20; k++) top = Math.max(top, heightAt(a.x + (p.x - a.x) * k / 20, a.z + (p.z - a.z) * k / 20));
      p.y = top + 110;
    });
    return pts.map((p, i) => {
      const n = pts[Math.min(pts.length - 1, i + 1)], b = pts[Math.max(0, i - 1)];
      const dx = n.x - b.x, dz = n.z - b.z;
      const yaw = Math.atan2(-dx, -dz);                        // ring normal points along the course
      const ground = heightAt(p.x, p.z);
      return { x: Math.round(p.x), y: Math.round(Math.max(p.y, ground + 45)), z: Math.round(p.z), yaw, r: i === pts.length - 1 ? 36 : 30 };
    });
  }
  const COURSE = buildCourse();
  const COURSE_START = (() => {        // spawn 1.4 km before the first ring, lined up with it
    const a = COURSE[0], b = COURSE[1];
    const dx = a.x - b.x, dz = a.z - b.z, l = Math.hypot(dx, dz);
    const x = a.x + dx / l * 1400, z = a.z + dz / l * 1400;
    let top = 0;                                                // clear every hill on the way in
    for (let k = 0; k <= 30; k++) top = Math.max(top, heightAt(x + (a.x - x) * k / 30, z + (a.z - z) * k / 30));
    return { x, y: Math.max(a.y + 40, top + 70), z, yaw: Math.atan2(-(b.x - a.x), -(b.z - a.z)) };
  })();

  /** Fastest plausible time between two rings (s) - used by the server to sanity-check race results. */
  const MAX_PLAUSIBLE_SPEED = 420;    // m/s, above what even the jet can do in a dive
  function minSplit(i) {
    const a = i === 0 ? COURSE_START : COURSE[i - 1], b = COURSE[i];
    return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / MAX_PLAUSIBLE_SPEED;
  }

  return { MAPS, CIVIL, WARPLANES, CARRIER_PLANES, isCivil, isCarrierPlane, mapAllows, FIELDS, SHIELD, shieldAt, shieldBox, SIZE, RUNWAY, SEALANE, ISLE, AIRSTRIP, VOLCANO, isleMix, onAirstrip, SITES, inSite, heightAt, onRunway, fbm, canyonInfo, CANYON, COURSE, COURSE_START, minSplit, smooth, lerp };
});
