/**
 * Half-Life Web Deathmatch - constants shared by the Node server and the browser.
 * Units are metres and seconds; one simulation tick is 1/60 s. Weapon timers are in ticks.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HLConst = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const C = {
    TICK_RATE: 60,
    DT: 1 / 60,
    SNAPSHOT_EVERY: 2,           // 30 Hz snapshots
    MAX_PLAYERS: 10,
    PLAYER_R: 0.35,              // half width of the player box
    PLAYER_H: 1.8,
    EYE: 1.6,
    HEAD: 0.34,                  // top slice of the box that counts as a headshot
    GRAVITY: 20,
    JUMP_V: 7.6,                 // ~1.4 m jump: clears a 1.2 m crate
    MAX_SPEED: 6.4,
    ACCEL: 10,
    AIR_ACCEL: 1.4,
    AIR_WISH: 1.2,
    FRICTION: 6,
    STOP_SPEED: 2,
    STEP: 0.55,                  // stairs are 0.5 m per step
    HP: 100,
    MAX_HP: 100,
    MAX_ARMOR: 100,
    ARMOR_ABSORB: 0.6,           // share of damage the HEV battery soaks up
    RESPAWN_TICKS: 180,          // 3 s
    SPAWN_PROTECT: 60,
    SWITCH_TICKS: 24,
    FRAG_LIMIT: 20,
    TIME_LIMIT: 10 * 60 * 60,
    INTERMISSION: 10 * 60,
    LAGCOMP_MAX: 15,             // the server rewinds hitboxes by at most 250 ms
    INTERP: 5,                   // remote players are drawn ~83 ms in the past
    CROUCH_H: 1.2,               // crouched box height (Ctrl / C)
    CROUCH_EYE: 1.05,
    CROUCH_SPEED: 0.36,          // share of running speed while crouched
    MAX_ITEMS: 32,               // dropped weapons lying around in one room
    // team elimination (CS style): rounds without respawns, a team that is wiped out loses the round
    ROUNDS_TO_WIN: 8,
    FREEZE_TICKS: 3 * 60,        // start of a round: nobody moves
    ROUND_TICKS: 115 * 60,       // then 1:55 of fighting
    ROUND_END_TICKS: 5 * 60,
    BUY_TICKS: 20 * 60,          // the loadout menu (B) works this long into a round
    ITEM_LIFE: 60 * 60,          // a dropped weapon disappears after a minute
  };

  const MOVE = { FWD: 1, BACK: 2, LEFT: 4, RIGHT: 8, JUMP: 16, CROUCH: 32 };
  const BTN = { FIRE: 1, ALT: 2, RELOAD: 4, SCOPE: 8, DROP: 16 };   // SCOPE: the AWP is zoomed in; DROP: G
  const W = { CROWBAR: 1, GLOCK: 2, PYTHON: 3, MP5: 4, SHOTGUN: 5, CROSSBOW: 6, RPG: 7, AWP: 8, AK47: 9, M4A1: 10, HE: 11 };
  const NUM_WEAPONS = 11;
  // Counter-Strike style slots: one primary (long gun), one pistol, the crowbar, grenades
  const SLOT = { PRIMARY: 1, PISTOL: 2, MELEE: 3, GRENADE: 4 };
  const KILL_BARREL = 20;      // kill-feed weapon code for an exploding barrel

  /**
   * rate/altRate: ticks between shots. mag: clip size (0 = no ammo). reload: ticks.
   * pickup: reserve ammo granted by a weapon pickup. kick: view punch (radians) on the client.
   */
  // pen: metres of wall a bullet can punch through in total (penMult = damage kept per wall)
  // Spread (radians-ish cone) = spread x (1 + crouch bonus) + spray (grows per shot, decays per tick)
  //   + moving * speed share + air when jumping. stepWeapon tracks the spray so the client crosshair matches.
  const WEAPONS = {
    1: { id: 1, key: 'crowbar', name: 'Crowbar', slot: SLOT.MELEE, melee: true, dmg: 25, range: 1.75, rate: 24, mag: 0, kick: 0.015 },
    2: { id: 2, key: 'glock', name: 'Glock 17', slot: SLOT.PISTOL, dmg: 12, rate: 18, spread: 0.006, altRate: 9, altSpread: 0.06,
         mag: 17, maxReserve: 120, start: 68, pickup: 34, reload: 90, kick: 0.02, head: 3, sprayAdd: 0.012, sprayMax: 0.05, sprayDecay: 0.002, moving: 0.02, air: 0.08 },
    3: { id: 3, key: 'python', name: '.357 Magnum', slot: SLOT.PISTOL, dmg: 40, rate: 45, spread: 0, mag: 6, maxReserve: 36, pickup: 12,
         reload: 120, kick: 0.09, head: 2.5, sprayAdd: 0.035, sprayMax: 0.07, sprayDecay: 0.0015, moving: 0.035, air: 0.12 },
    4: { id: 4, key: 'mp5', name: 'MP5', slot: SLOT.PRIMARY, dmg: 8, rate: 6, spread: 0.02, mag: 50, maxReserve: 250, pickup: 50,
         reload: 96, kick: 0.012, head: 3, altRate: 60, altMax: 10, altPickup: 2, grenadeSpeed: 19, sprayAdd: 0.004, sprayMax: 0.035, sprayDecay: 0.002, moving: 0.015, air: 0.08 },
    5: { id: 5, key: 'shotgun', name: 'Shotgun', slot: SLOT.PRIMARY, dmg: 9, pellets: 6, altPellets: 12, spread: 0.085, rate: 45, altRate: 90,
         mag: 8, maxReserve: 64, pickup: 12, reload: 150, kick: 0.07, head: 1.5 },
    6: { id: 6, key: 'crossbow', name: 'Crossbow', slot: SLOT.PRIMARY, dmg: 60, rate: 45, mag: 5, maxReserve: 50, pickup: 5, reload: 180,
         kick: 0.04, head: 2, boltSpeed: 70, boltGravity: 4, zoom: true },
    7: { id: 7, key: 'rpg', name: 'RPG', slot: SLOT.PRIMARY, dmg: 110, radius: 5, rate: 75, mag: 1, maxReserve: 5, pickup: 2, reload: 90,
         kick: 0.05, rocketSpeed: 22 },
    // AWP: one body shot kills; wildly inaccurate unless scoped (BTN.SCOPE), a little worse while moving
    8: { id: 8, key: 'awp', name: 'AWP', slot: SLOT.PRIMARY, dmg: 115, rate: 88, spread: 0.075, scopedSpread: 0, movingSpread: 0.025,
         mag: 10, maxReserve: 30, pickup: 10, reload: 200, kick: 0.16, head: 2, pen: 1.2, penMult: 0.8 },
    // CS rifles: a headshot kills in one bullet; the first shots are precise, holding the trigger sprays
    9: { id: 9, key: 'ak47', name: 'AK-47', slot: SLOT.PRIMARY, dmg: 36, rate: 6, spread: 0.004, mag: 30, maxReserve: 90, pickup: 60, reload: 150,
         kick: 0.03, head: 4, sprayAdd: 0.011, sprayMax: 0.085, sprayDecay: 0.0035, moving: 0.07, air: 0.18, pen: 0.55, penMult: 0.65 },
    10: { id: 10, key: 'm4a1', name: 'M4A1', slot: SLOT.PRIMARY, dmg: 30, rate: 5, spread: 0.003, mag: 30, maxReserve: 90, pickup: 60, reload: 186,
          kick: 0.02, head: 4, sprayAdd: 0.008, sprayMax: 0.065, sprayDecay: 0.0045, moving: 0.055, air: 0.16, pen: 0.4, penMult: 0.6 },
    // HE grenade: LMB throws, RMB lobs it underhand; it bounces and goes off after 1.5 s
    11: { id: 11, key: 'he', name: 'HE Grenade', slot: SLOT.GRENADE, grenade: true, rate: 40, mag: 0, kick: 0.01 },
  };
  const GRENADE = { dmg: 100, radius: 4.5, gravity: 14 };
  const BARREL = { dmg: 80, radius: 4 };

  const PICKUP_RESPAWN = { weapon: 20 * 60, health: 20 * 60, battery: 25 * 60, ammo: 20 * 60 };
  const PROP_HP = { crate: 40, barrel: 25 };
  const PROP_RESPAWN = 40 * 60;

  // projectile types in snapshots
  const PROJ = { BOLT: 1, ROCKET: 2, GRENADE: 3, HE: 4 };
  const HEG = { dmg: 100, radius: 6, fuse: 90, gravity: 16, bounce: 0.45, speed: 17, lob: 9, max: 1 };

  // event codes in snapshots: [code, ...data]
  const EV = {
    SHOT: 1,      // [1, shooterId, weapon, ox, oy, oz, ...endpoints(x,y,z,surface)]  surface 0 wall,1 flesh,2 none
    MELEE: 2,     // [2, shooterId, hit(0 miss / 1 wall / 2 flesh), x, y, z]
    BOOM: 3,      // [3, x, y, z, radius]
    KILL: 4,      // [4, killerId, victimId, weapon(0 = world), headshot]
    HIT: 5,       // [5, attackerId, victimId, amount, headshot]
    PROP: 6,      // [6, propIndex, x, y, z]  destroyed
    PICKUP: 7,    // [7, playerId, pickupIndex]
    SPAWN: 8,     // [8, playerId]
    BOLT_HIT: 9,  // [9, x, y, z, surface]
    EMPTY: 10,    // [10, playerId]
    RELOAD: 11,   // [11, playerId, weapon]
    BOUNCE: 12,   // [12, x, y, z]  a grenade hit something
    DROP: 13,     // [13, playerId, weapon]
    ROUND: 14,    // [14, winnerTeam (-1 draw), reason]  reason 0 eliminated, 1 time ran out
    ROUND_START: 15, // [15, roundNumber]
  };

  // teams in elimination mode; suits are forced to the team's palette so friend and foe read at a glance
  const TEAMS = [
    { name: 'Terrorists', short: 'T', color: '#f0a43a', skins: [0, 5, 3, 2, 0, 5] },
    { name: 'Counter-Terrorists', short: 'CT', color: '#5ab0ff', skins: [1, 6, 4, 7, 1, 6] },
  ];
  const PRIMARIES = [9, 10, 8, 4, 5, 6, 7];   // what the free loadout menu (B) offers

  const COLORS = ['#ff9a1f', '#3fd0ff', '#ff4f6d', '#7dff6a', '#c58bff', '#ffe14d', '#ff7ae0', '#4dffd2', '#ffffff', '#ff6a2a'];

  // character skins: suit colour, armour trim, dark parts (boots, gloves, joints)
  const SKINS = [
    { name: 'HEV Orange', suit: 0xd8742a, trim: 0x3b3d44, dark: 0x1f2024 },
    { name: 'Security Blue', suit: 0x2e5fa6, trim: 0xb9c4d4, dark: 0x1b2230 },
    { name: 'Black Ops', suit: 0x2b2d31, trim: 0x5a6068, dark: 0x111214 },
    { name: 'Marine Camo', suit: 0x5b6a38, trim: 0x8c7c52, dark: 0x2a2e1c },
    { name: 'Lab White', suit: 0xe6e3da, trim: 0x3f9c99, dark: 0x3a3c40 },
    { name: 'Crimson', suit: 0xa3262e, trim: 0x2c2c2e, dark: 0x16100f },
    { name: 'Arctic', suit: 0xcfe2ec, trim: 0x46708a, dark: 0x2a3640 },
    { name: 'Toxic', suit: 0x7cc23a, trim: 0x2f3d20, dark: 0x1a2112 },
  ];

  return { C, TEAMS, PRIMARIES, MOVE, BTN, W, SLOT, NUM_WEAPONS, KILL_BARREL, SKINS, WEAPONS, GRENADE, HEG, BARREL, PICKUP_RESPAWN, PROP_HP, PROP_RESPAWN, PROJ, EV, COLORS };
});
