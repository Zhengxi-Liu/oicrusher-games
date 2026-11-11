/**
 * Bomb Arena 3D - constants shared by the Node server and the browser.
 * The arena is a grid of 1x1 tiles; positions are in tiles (tile (cx, cz) spans [cx, cx+1) x [cz, cz+1)).
 * One simulation tick is 1/60 s; timers are in ticks.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BAConst = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const C = {
    TICK_RATE: 60,
    DT: 1 / 60,
    SNAPSHOT_EVERY: 2,          // 30 Hz snapshots
    MAX_PLAYERS: 8,
    INTERP: 4,                  // remote players are drawn ~67 ms in the past

    W: 17, H: 15,               // arena size in tiles (odd: border + pillar grid)
    CRATE_DENSITY: 0.72,

    HALF: 0.38,                 // half the player's footprint (tiles)
    BASE_SPEED: 3.4,            // tiles per second
    SPEED_STEP: 0.55,
    MAX_SPEED_LVL: 5,
    CORNER_ASSIST: 0.42,        // how far off-lane we still slide around a pillar corner

    FUSE: 180,                  // 3 s
    CHAIN_FUSE: 5,              // a bomb caught in a blast goes off almost at once
    FLAME_TICKS: 32,            // flames linger ~0.5 s
    KICK_SPEED: 9,              // tiles per second
    START_BOMBS: 1, MAX_BOMBS: 8,
    START_FIRE: 2, MAX_FIRE: 8,
    DROP_CHANCE: 0.4,

    WIN_ROUNDS: 3,
    COUNTDOWN: 3 * 60,
    ROUND_TIME: 90 * 60,        // then sudden death: walls drop in a spiral
    SUDDEN_EVERY: 12,           // ticks between falling blocks
    ROUND_END: 3 * 60,
    MATCH_END: 7 * 60,
  };

  // tiles
  const T = { FLOOR: 0, WALL: 1, CRATE: 2 };
  // input bits
  const KEY = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, BOMB: 16 };
  // power-ups
  const PU = { BOMB: 1, FIRE: 2, SPEED: 3, KICK: 4 };
  const PU_NAMES = ['', 'Bomb Up', 'Fire Up', 'Speed Up', 'Kick'];
  const PU_WEIGHTS = [[PU.BOMB, 34], [PU.FIRE, 34], [PU.SPEED, 20], [PU.KICK, 12]];

  // events in snapshots: [code, ...data]
  const EV = {
    BOMB: 1,      // [1, playerId, cx, cz]
    BOOM: 2,      // [2, cx, cz, tiles...]     tiles = flat list of cx, cz
    CRATE: 3,     // [3, cx, cz]
    PICK: 4,      // [4, playerId, type]
    DIE: 5,       // [5, victimId, killerId (0 = sudden death / self = own bomb)]
    KICK: 6,      // [6, playerId]
    ROUND: 7,     // [7, round]               countdown for a new round started
    GO: 8,        // [8]
    WIN: 9,       // [9, winnerId (0 = draw), matchOver 0/1, botsOnly 0/1 (ended because every person was out)]
    SUDDEN: 10,   // [10]
    DROP: 11,     // [11, cx, cz]             a sudden-death block landed
  };

  const COLORS = [0xffffff, 0x2b2b2b, 0xff4d4d, 0x3d8bff, 0x45d16b, 0xffd23f, 0xb05cff, 0xff8a3d];
  const COLOR_NAMES = ['White', 'Black', 'Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Orange'];

  return { C, T, KEY, PU, PU_NAMES, PU_WEIGHTS, EV, COLORS, COLOR_NAMES };
});
