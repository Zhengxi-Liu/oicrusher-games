/**
 * Voxel Kart Racing - constants shared by the Node server and the browser.
 * Units are metres and seconds; one simulation tick is 1/60 s. Timers are in ticks.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VKConst = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const C = {
    TICK_RATE: 60,
    DT: 1 / 60,
    SNAPSHOT_EVERY: 2,           // 30 Hz snapshots
    MAX_RACERS: 8,
    LAPS: 3,
    INTERP: 4,                   // remote karts are drawn ~67 ms in the past

    // kart handling (arcade: no tyre model, just forward drive + lateral grip)
    KART_R: 0.95,                // collision radius
    MAX_SPEED: 26,
    REVERSE_SPEED: 8,
    ACCEL: 15,
    BRAKE: 32,
    COAST: 5,                    // deceleration with no throttle
    TURN_RATE: 2.35,             // rad/s at full lock and moderate speed
    GRIP: 0.22,                  // share of sideways velocity removed per tick
    DRIFT_GRIP: 0.05,
    GRAVITY: 34,                 // heavy, keeps karts glued to the road
    HOP_V: 4.2,                  // the little hop that starts a drift
    STEP_UP: 0.7,                // highest ledge a kart climbs without stopping

    // drift and mini-turbo
    DRIFT_MIN_SPEED: 11,
    DRIFT_TURN: 1.25,            // extra yaw rate multiplier while drifting
    DRIFT_TIERS: [42, 84, 132],  // charge ticks for blue, orange, purple sparks
    DRIFT_BOOST: [36, 66, 100],  // boost ticks granted by each tier

    // boosts and surfaces
    BOOST_SPEED: 1.32,           // max speed multiplier while boosting
    BOOST_ACCEL: 46,
    SHROOM_TICKS: 84,
    PAD_TICKS: 50,
    OFFROAD_MUL: 0.45,           // max speed on grass / sand / shallow water
    JUMP_V: 9.5,                 // ramp launch
    VOID_Y: -24,                 // falling below this = rescue
    RESCUE_TICKS: 75,            // time on the rescue cloud before control returns

    // items
    ITEM_ROULETTE: 75,           // 1.25 s spinning slot before the item can be used
    BOX_RESPAWN: 180,
    BOX_R: 1.6,
    SHELL_SPEED: 46,
    RED_SPEED: 42,
    SHELL_LIFE: 360,
    SHELL_BOUNCES: 4,
    SHELL_R: 0.6,
    BANANA_R: 0.7,
    MAX_HAZARDS: 40,             // bananas + shells alive in a room
    SPIN_TICKS: 66,
    LIGHTNING_TICKS: 240,
    SHRINK_MUL: 0.68,            // max speed while shrunk

    // race flow
    COUNTDOWN: 4 * 60,
    FINISH_GRACE: 30 * 60,       // the race ends this long after the first finish
    RACE_LIMIT: 6 * 60 * 60,
    RESULTS: 10 * 60,
  };

  // input bits
  const KEY = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, DRIFT: 16, ITEM: 32, BACK: 64 };

  // items: 0 = none
  const ITEM = { NONE: 0, GREEN: 1, RED: 2, BANANA: 3, SHROOM: 4, LIGHTNING: 5, TRIPLE: 6 };
  const ITEM_NAMES = ['', 'Green Shell', 'Red Shell', 'Banana', 'Turbo Mushroom', 'Lightning', 'Triple Mushroom'];

  /**
   * Item odds by race position (rubber-banding): one row per position bucket
   * [front, upper middle, lower middle, back], weights for GREEN, RED, BANANA, SHROOM, LIGHTNING, TRIPLE.
   */
  const ODDS = [
    [40, 5, 50, 5, 0, 0],
    [30, 30, 15, 20, 0, 5],
    [15, 35, 5, 25, 5, 15],
    [5, 30, 0, 20, 15, 30],
  ];

  // surfaces in the track grid
  const SURF = { VOID: 0, ROAD: 1, OFFROAD: 2, WALL: 3, LAVA: 4, BOOST: 5, JUMP: 6, WOOD: 7, WATER: 8 };

  // kart state bits in snapshots
  const KF = { DRIFT: 1, BOOST: 2, SPIN: 4, SHRINK: 8, AIR: 16, RESCUE: 32, FINISHED: 64, BRAKE: 128 };

  // event codes in snapshots: [code, ...data]
  const EV = {
    BOX: 1,        // [1, kartId, boxIndex]          picked an item box
    USE: 2,        // [2, kartId, item]
    HIT: 3,        // [3, victimId, attackerId, cause]  cause: item id that hit
    LIGHTNING: 4,  // [4, kartId]
    LAP: 5,        // [5, kartId, lap]
    FINISH: 6,     // [6, kartId, place, timeTicks]
    RESCUE: 7,     // [7, kartId]
    TURBO: 8,      // [8, kartId, tier]
    BUMP: 9,       // [9, kartA, kartB]
    GO: 10,        // [10]
  };

  const COLORS = [0xe53935, 0x1e88e5, 0x43a047, 0xfdd835, 0x8e24aa, 0xfb8c00, 0x00acc1, 0xf06292];

  return { C, KEY, ITEM, ITEM_NAMES, ODDS, SURF, KF, EV, COLORS };
});
