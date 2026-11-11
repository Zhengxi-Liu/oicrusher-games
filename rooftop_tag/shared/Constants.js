/**
 * Rooftop Tag - constants shared by the Node server and the browser.
 * Units are metres and seconds; one simulation tick is 1/60 s. Timers are in ticks.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RTConst = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const C = {
    TICK_RATE: 60,
    DT: 1 / 60,
    SNAPSHOT_EVERY: 2,           // 30 Hz snapshots
    MAX_PLAYERS: 4,              // 1v1 or 2v2
    PLAYER_R: 0.35,              // half width of the player box
    PLAYER_H: 1.8,
    CROUCH_H: 1.1,
    EYE: 1.62,
    CROUCH_EYE: 0.95,
    GRAVITY: 20,
    JUMP_V: 7.6,
    MAX_SPEED: 8,                // running
    CROUCH_SPEED: 3.6,
    CARRY_MUL: 0.88,             // flag carrier runs slower
    ACCEL: 11,
    AIR_ACCEL: 1.6,
    AIR_WISH: 1.3,
    FRICTION: 6,
    STOP_SPEED: 2,
    STEP: 0.55,
    MAX_HSPEED: 26,              // hard cap on horizontal speed

    // slide (crouch while running)
    SLIDE_MIN: 6.2,              // need this much speed to start a slide
    SLIDE_BOOST: 2.6,            // extra speed when the slide starts
    SLIDE_FRICTION: 0.35,        // almost no friction
    SLIDE_TICKS: 75,             // after this a flat slide turns into a crouch walk
    SLIDE_COOL: 40,
    SLIDE_GRAVITY: 1.0,          // share of the slope's pull applied along a ramp

    // wall running and wall jumps
    WALLRUN_MIN: 5,              // horizontal speed needed
    WALLRUN_TICKS: 80,
    WALLRUN_GRAVITY: 0.18,       // gravity share while running along a wall
    WALLJUMP_PUSH: 7,            // away from the wall
    WALLJUMP_UP: 7.2,
    WALLJUMP_COOL: 18,

    // grappling hook
    HOOK_RANGE: 34,
    HOOK_PULL: 42,               // m/s^2 toward the anchor
    HOOK_MAX: 24,                // max speed while reeling in
    HOOK_TICKS: 150,             // auto release after 2.5 s
    HOOK_COOL: 75,               // 1.25 s after release
    HOOK_RELEASE_DIST: 2.2,

    // combat
    HP: 100,
    REGEN_DELAY: 240,            // 4 s without damage
    REGEN_PER_TICK: 0.2,         // 12 HP/s
    TAGGER_DMG: 25,              // four hits
    TAGGER_RATE: 24,             // 0.4 s
    TAGGER_RANGE: 70,
    RESPAWN_TICKS: 180,          // 3 s
    SPAWN_PROTECT: 90,
    VOID_Y: -14,                 // falling below this = eliminated

    // flags
    CAPTURE_LIMIT: 3,
    FLAG_RETURN: 300,            // a dropped flag goes home after 5 s
    FLAG_RADIUS: 1.1,
    TIME_LIMIT: 8 * 60 * 60,
    INTERMISSION: 8 * 60,
    LAGCOMP_MAX: 15,             // the server rewinds hitboxes by at most 250 ms
    INTERP: 4,                   // remote players are drawn ~67 ms in the past
  };

  const MOVE = { FWD: 1, BACK: 2, LEFT: 4, RIGHT: 8, JUMP: 16, CROUCH: 32 };
  const BTN = { FIRE: 1, HOOK: 2 };

  // player state bits in snapshots
  const PF = { FIRED: 1, CROUCH: 2, SLIDE: 4, WALLRUN: 8, HOOK: 16, CARRY: 32, PROTECT: 64 };

  // teams: 0 = Magenta (north, z < 0), 1 = Cyan (south, z > 0)
  const TEAMS = [
    { name: 'Magenta', color: '#ff2fb4', hex: 0xff2fb4, dark: 0x5a0a40 },
    { name: 'Cyan', color: '#22e6ff', hex: 0x22e6ff, dark: 0x06424d },
  ];

  // flag state: 0 at base, 1 carried, 2 dropped
  const FLAG = { BASE: 0, CARRIED: 1, DROPPED: 2 };

  // event codes in snapshots: [code, ...data]
  const EV = {
    SHOT: 1,      // [1, shooterId, ox, oy, oz, ex, ey, ez, hitPlayer]
    HIT: 2,       // [2, attackerId, victimId, amount]
    KILL: 3,      // [3, killerId (0 = the void), victimId, cause]  cause 0 tagger, 1 void
    SPAWN: 4,     // [4, playerId]
    FLAG_TAKE: 5, // [5, playerId, flagTeam]
    FLAG_DROP: 6, // [6, playerId, flagTeam, x, y, z]
    FLAG_RETURN: 7, // [7, flagTeam, playerId (0 = timeout)]
    CAPTURE: 8,   // [8, playerId, flagTeam]
    PAD: 9,       // [9, playerId, padIndex]
    HOOK: 10,     // [10, playerId, x, y, z]  anchored
    WALLJUMP: 11, // [11, playerId]
    WIN: 12,      // [12, team]
  };

  return { C, MOVE, BTN, PF, TEAMS, FLAG, EV };
});
