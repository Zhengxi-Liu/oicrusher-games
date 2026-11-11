/**
 * The carrier aircraft's flight models and paint. They are tuned copies of the Thunder Warbird (a WWII-style heavy fighter) in the
 * shared FlightPhysics TYPES table; the flight sim only lets pilots pick them on the carrier map (FSWorld.mapAllows). Different mass, power,
 * wing area, guns and bombs; the 3D models are in CarrierModels.js.
 */
import * as THREE from 'three';

const FP = window.FSPhysics, DEG = Math.PI / 180;
const clone = o => JSON.parse(JSON.stringify(o));

function derive(id, base, over) {
  const T = clone(FP.TYPES[base]);
  Object.assign(T, over, { id });
  FP.TYPES[id] = T;
  return T;
}
const scaleWings = (T, k) => { for (const s of T.surfaces) if (s.id === 'wingL' || s.id === 'wingR') { s.area *= k; } };
const guns = (xs, y, z, extra) => ({ muzzles: xs.map(x => [x, y, z]), converge: 280, ...extra });

// F6F Hellcat: big, rugged, six .50s, 2,000 hp
{
  const T = derive('hellcat', 'warbird', {
    name: 'F6F Hellcat', blurb: 'The Navy workhorse: rugged, stable, six .50 cals. Out-dives the Zero but cannot out-turn it.',
    mass: 4900, engine: { kind: 'prop', static: 23000, power: 1.35e6, vmax: 245, lag: 0.9, propZ: -3.7 },
    gun: guns([-2.2, -2.45, -2.7, 2.2, 2.45, 2.7], -0.3, -1.5, { rate: 36, speed: 880, ammo: 480, spread: 0.007 }),
    hud: { vs0: 92, vs1: 80, vfe: 160, vne: 430 }, stats: { speed: 4, agility: 3, stall: 2 },
  });
  delete T.bombRack; scaleWings(T, 1.12); T.gLimit = 8;
}
// SBD Dauntless: the Midway dive bomber - one 1,000 lb bomb on a swing arm, perforated dive brakes, two .50s
{
  const T = derive('dauntless', 'warbird', {
    name: 'SBD Dauntless', blurb: 'Dive bomber. N drops the 1,000 lb bomb on the swing arm; Z = dive brakes. Dive on the enemy carrier\'s deck.',
    mass: 4600, engine: { kind: 'prop', static: 18000, power: 0.95e6, vmax: 205, lag: 1.0, propZ: -3.7 },
    gun: guns([-0.5, 0.5], -0.5, -3.0, { rate: 18, speed: 860, ammo: 360, spread: 0.006 }),
    airbrake: { area: 3.4, at: [0, 0.2, 2.5] },
    hud: { vs0: 84, vs1: 72, vfe: 150, vne: 380 }, stats: { speed: 3, agility: 3, stall: 3 },
  });
  scaleWings(T, 1.2);
}
// A6M Zero: light, agile, long-ranged, fragile; two 20 mm cannon and two 7.7s - and, as the 1944 bakusen fighter-bomber, one 250 kg bomb on the belly
{
  const T = derive('zero', 'warbird', {
    name: 'A6M Zero', blurb: 'Light and incredibly agile, but fragile. Two 20 mm cannon hit hard; one 250 kg bomb on the belly (N) for a fighter-bomber dive. Do not dive it too fast.',
    mass: 2750, inertia: [6500, 11500, 4800], engine: { kind: 'prop', static: 14500, power: 0.85e6, vmax: 235, lag: 0.7, propZ: -3.7 },
    gun: guns([-2.0, 2.0, -0.7, 0.7], -0.3, -1.5, { rate: 30, speed: 820, ammo: 420, spread: 0.008 }),
    bombRack: { type: 'b500', count: 1, pylon: true, pylons: [[0, -1.0, -0.4]] },
    gLimit: 7, hud: { vs0: 68, vs1: 60, vfe: 140, vne: 360 }, stats: { speed: 3, agility: 5, stall: 4 },
  });
  scaleWings(T, 1.55);
}
// D3A Val: fixed-gear dive bomber, two 250 kg bombs, a weak gun
{
  const T = derive('val', 'warbird', {
    name: 'D3A Val', blurb: 'Fixed-gear dive bomber. N drops a 250 kg bomb (you carry two). Accurate in a dive, slow and fragile.',
    mass: 3700, inertia: [10000, 17000, 7000], engine: { kind: 'prop', static: 15000, power: 0.78e6, vmax: 190, lag: 1.0, propZ: -3.7 },
    gun: guns([-0.6, 0.6], -0.4, -2.2, { rate: 14, speed: 740, ammo: 300, spread: 0.008 }),
    bombRack: { type: 'b500', count: 2, pylon: true, pylons: [[-1.6, -0.9, -0.2], [1.6, -0.9, -0.2]] },
    airbrake: { area: 2.6, at: [0, 0.2, 2.5] },
    gLimit: 6, hud: { vs0: 74, vs1: 64, vfe: 150, vne: 330 }, stats: { speed: 2, agility: 4, stall: 3 },
  });
  delete T.retract; scaleWings(T, 1.35);
}
// TBF Avenger: the big Navy torpedo bomber - one Mk 13 torpedo on the belly (N drops it), a .50 in each wing, tough but slow
{
  const T = derive('avenger', 'warbird', {
    name: 'TBF Avenger', blurb: 'Torpedo bomber. N drops the torpedo: fly low (under 100 m) and level, release at the enemy carrier\'s hull from a few hundred metres, and turn away. The AA hates you.',
    mass: 5900, inertia: [13000, 20000, 9500], engine: { kind: 'prop', static: 20000, power: 1.1e6, vmax: 200, lag: 1.1, propZ: -3.7 },
    gun: guns([-2.4, 2.4], -0.4, -1.4, { rate: 22, speed: 860, ammo: 400, spread: 0.007 }),
    bombRack: { type: 'tp', count: 1, pylon: true, pylons: [[0, -1.05, 0.1]] },
    hud: { vs0: 88, vs1: 76, vfe: 150, vne: 360 }, stats: { speed: 2, agility: 2, stall: 3 },
  });
  T.gLimit = 6; scaleWings(T, 1.35);
}
// B5N Kate: the IJN torpedo bomber - lighter and nimbler than the Avenger, a weak gun, fragile
{
  const T = derive('kate', 'warbird', {
    name: 'B5N Kate', blurb: 'Torpedo bomber. N drops the Type 91 torpedo: fly low (under 100 m) and level, release at the enemy carrier\'s hull from a few hundred metres. Slow and fragile.',
    mass: 3900, inertia: [10000, 16000, 7500], engine: { kind: 'prop', static: 14500, power: 0.78e6, vmax: 185, lag: 1.0, propZ: -3.7 },
    gun: guns([-0.6, 0.6], -0.4, -2.2, { rate: 14, speed: 740, ammo: 280, spread: 0.008 }),
    bombRack: { type: 'tp', count: 1, pylon: true, pylons: [[0, -1.0, 0.1]] },
    hud: { vs0: 72, vs1: 62, vfe: 140, vne: 320 }, stats: { speed: 2, agility: 3, stall: 4 },
  });
  T.gLimit = 6; scaleWings(T, 1.5);
}
// F4U Corsair: inverted gull wing, a 2,000 hp R-2800 and a four-metre prop; fast, heavy, six .50s - and two 500 lb bombs under the wings
{
  const T = derive('corsair', 'warbird', {
    name: 'F4U Corsair', blurb: 'The bent-wing fighter-bomber: the fastest US carrier plane, six .50 cals and two 500 lb bombs under the wings (N drops them). Dive on the deck, then fight your way home.',
    mass: 5500, engine: { kind: 'prop', static: 24500, power: 1.5e6, vmax: 262, lag: 0.95, propZ: -3.7 },
    gun: guns([-2.2, -2.5, -2.8, 2.2, 2.5, 2.8], -0.3, -1.5, { rate: 36, speed: 880, ammo: 400, spread: 0.007 }),
    bombRack: { type: 'b500', count: 2, pylon: true, pylons: [[-2.7, -1.3, -0.3], [2.7, -1.3, -0.3]] },
    hud: { vs0: 96, vs1: 84, vfe: 165, vne: 450 }, stats: { speed: 5, agility: 3, stall: 2 },
  });
  T.gLimit = 8; scaleWings(T, 1.1);
}
// D4Y Suisei ("Judy"): the Navy's most advanced dive bomber - a liquid-cooled inline engine, a slim nose, retractable gear, dive brakes; faster than most fighters
{
  const T = derive('suisei', 'warbird', {
    name: 'D4Y Suisei', blurb: 'Sleek inline-engined dive bomber with retractable gear and dive brakes (Z). One 500 kg bomb (N), very fast, light and fragile: dive, drop, and run.',
    mass: 3500, inertia: [8500, 14000, 6200], engine: { kind: 'prop', static: 15500, power: 1.0e6, vmax: 228, lag: 0.8, propZ: -3.7 },
    gun: guns([-0.5, 0.5], -0.2, -3.0, { rate: 16, speed: 800, ammo: 340, spread: 0.007 }),
    airbrake: { area: 3.0, at: [0, 0.2, 2.5] },
    gLimit: 6.5, hud: { vs0: 76, vs1: 66, vfe: 160, vne: 400 }, stats: { speed: 4, agility: 3, stall: 3 },
  });
  scaleWings(T, 1.3);
}
const TIP = { corsair: 6.2, suisei: 5.75, hellcat: 6.0, dauntless: 6.1, avenger: 6.4, zero: 6.0, val: 6.5, kate: 6.3 };         // half spans (m): the models in CarrierModels.js have the same
const CP = window.CWPlanes, TOP_KT = { corsair: 340, suisei: 295, hellcat: 320, dauntless: 255, avenger: 240, zero: 290, val: 235, kate: 215 };
for (const id of ['hellcat', 'corsair', 'dauntless', 'avenger', 'zero', 'val', 'kate', 'suisei']) {            // keep the derived/rest fields the physics computes in its own init
  const T = FP.TYPES[id];
  T.hitScale = 12 / CP.PLANES[id].hp; T.flakScale = 12 / (CP.PLANES[id].flak || CP.PLANES[id].hp); T.gun.dmg = CP.PLANES[id].gun; T.topKt = TOP_KT[id];     // the flight sim shoots a pilot down at 12 hits: tougher airframes take less per round; the Zero's cannon hit harder
  T.hardpoints[0][0] = -TIP[id]; T.hardpoints[1][0] = TIP[id];
  for (const s of T.surfaces) if (s.id === 'wingL') s.r[0] = -TIP[id] * 0.5; else if (s.id === 'wingR') s.r[0] = TIP[id] * 0.5;
  for (const s of T.surfaces) { if (!s.f) s.f = [0, 0, -1]; s.cla = 2 * Math.PI * s.ar / (s.ar + 2); s.k = 1 / (Math.PI * 0.88 * s.ar); }
}

// ---------- paint (kept apart from the island sim's livery list, which pilots pick from): one fixed scheme per aircraft
const paint = (name, main, accent, trim, camo) => ({ name, main, accent, trim, rough: 0.5, metal: 0.15, camo });
export const PAINT = {
  hellcat: paint('Navy Blue', 0x1d3a66, 0xe8ecf2, 0x0d1830),                                // glossy sea blue
  dauntless: paint('Dive Bomber Grey', 0x7b8da6, 0xe6e3da, 0x2a3340, [0x5f7089, 0xa5b3c4]), // blue-grey over light grey
  zero: paint('Zero Grey-Green', 0xaab59a, 0x9c2a22, 0x2a3024),                             // pale grey-green, red-brown cowl
  avenger: paint('Avenger Blue-Grey', 0x31507c, 0xe8ecf2, 0x16243c, [0x27406a, 0x7f98b8]),   // blue-grey over white
  kate: paint('Kate Grey-Green', 0x9fae96, 0xd8a038, 0x2a3024),                              // light grey-green, a yellow-orange tail band
  corsair: paint('Corsair Tri-Colour', 0x21427a, 0xf0f2f5, 0x0d1830, [0x1a3560, 0x4a6fa0]),  // sea blue over intermediate blue, white underside
  suisei: paint('Suisei Dark Green', 0x44604e, 0xc23a22, 0x1c2a22, [0x35503f, 0x82a08c]),    // dark green over pale grey, a red tail band
  val: paint('Val Green', 0x5d7048, 0xd9742a, 0x1f2a18, [0x46583a, 0x7f9460]),              // dark green over grey, orange tail band
};
// the island sim's plane picker lists FSPhysics.TYPE_IDS: add ours (they only fly on the carrier map, see FSWorld.mapAllows)
for (const id of Object.keys(PAINT)) if (!FP.TYPE_IDS.includes(id)) FP.TYPE_IDS.push(id);

/** National insignia on the fuselage sides: US blue roundel with a white star, Japanese red Hinomaru. */
export function addInsignia(model, team) {
  const disc = (r, col, x, z, flip) => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 20), new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide }));
    m.position.set(x, 0.1, z); m.rotation.y = Math.PI / 2 * (flip ? -1 : 1); model.root.add(m); return m;
  };
  for (const s of [-1, 1]) {
    if (team === 0) { disc(0.52, 0x1b3b84, s * 0.83, 2.4, s < 0); disc(0.3, 0xf4f4f4, s * 0.835, 2.4, s < 0); }
    else disc(0.5, 0xc4161c, s * 0.83, 2.4, s < 0);
  }
  for (const s of [-1, 1]) {                                                       // wing tops
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.7, 20), new THREE.MeshBasicMaterial({ color: team === 0 ? 0x1b3b84 : 0xc4161c, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.set(s * 3.9, 0.02, -0.5); model.root.add(m);
  }
}
