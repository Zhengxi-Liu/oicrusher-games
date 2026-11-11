/**
 * Element Core - constants and the card catalogue, shared by the Node server and the browser.
 * deriveStats() turns a player's card stacks into the numbers both sides simulate with, so the
 * client can predict its own movement / cooldowns with exactly the server's values.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ElementConst = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const C = {
    TICK_RATE: 60,
    SNAPSHOT_EVERY: 2,              // 30 Hz snapshots
    ARENA_W: 1240, ARENA_H: 680,
    PLAYER_R: 18,
    SPEED: 4.2,                     // px per tick (252 px/s)
    DASH_SPEED: 15, DASH_TICKS: 10, DASH_CD: 90,   // the whole dash (10 ticks) is invulnerable
    HP: 100,
    FIRE_CD: 14,
    BOLT_SPEED: 9.5, BOLT_R: 6, BOLT_DMG: 9, BOLT_LIFE: 100,
    SLOW_MUL: 0.55,
    ROUND_WINS: 2,                  // best of 3
    DRAFT_EVERY: 45 * 60,           // combat ticks between drafts
    DRAFT_TIME: 15 * 60,
    COUNTDOWN: 150, RESUME: 75, KO_TICKS: 110, KO_FREEZE: 18,
    MAX_PROJ_PER_PLAYER: 90,
    SPAWNS: [[130, 340], [1110, 340]],
    // destructible cover: centre x/y, width, height, hit points (mirror-symmetric)
    COVERS: [
      { x: 620, y: 340, w: 70, h: 70, hp: 160 },
      { x: 420, y: 190, w: 46, h: 96, hp: 100 }, { x: 820, y: 190, w: 46, h: 96, hp: 100 },
      { x: 420, y: 490, w: 46, h: 96, hp: 100 }, { x: 820, y: 490, w: 46, h: 96, hp: 100 },
      { x: 250, y: 340, w: 36, h: 130, hp: 120 }, { x: 990, y: 340, w: 36, h: 130, hp: 120 },
      { x: 620, y: 118, w: 130, h: 32, hp: 90 }, { x: 620, y: 562, w: 130, h: 32, hp: 90 },
    ],
  };

  const MOVE = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8 };
  const PHASES = ['countdown', 'combat', 'ko', 'draft', 'over'];

  // rarity: weight in the draft pool
  const RARITY = { common: 10, rare: 6, epic: 3 };
  const pct = v => `${Math.round(v * 100)}%`;
  const CARDS = [
    { id: 'split', name: 'Split Shot', icon: '✶', color: '#ffd166', rarity: 'rare', max: 3,
      desc: n => `Each cast fires ${1 + 2 * n} bolts in a fan (each ${pct(Math.pow(0.8, n))} damage).` },
    { id: 'frost', name: 'Ice Slowdown', icon: '❄', color: '#8be9ff', rarity: 'common', max: 3,
      desc: n => `Hits slow the enemy by 45% for ${((45 + 30 * n) / 60).toFixed(1)} s.` },
    { id: 'homing', name: 'Homing Missiles', icon: '➶', color: '#c49bff', rarity: 'rare', max: 3,
      desc: n => `Bolts curve toward the enemy (turn rate ×${n}).` },
    { id: 'flame', name: 'Flame Dash Trail', icon: '🔥', color: '#ff8a3d', rarity: 'common', max: 3,
      desc: n => `Dashing leaves fire for ${((90 + 60 * (n - 1)) / 60).toFixed(1)} s that burns ${Math.round((0.3 + 0.1 * (n - 1)) * 60)} dmg/s.` },
    { id: 'vamp', name: 'Vampiric Touch', icon: '♥', color: '#ff4d6d', rarity: 'rare', max: 3,
      desc: n => `Heal ${pct(0.18 * n)} of the damage you deal.` },
    { id: 'chain', name: 'Chain Lightning', icon: 'ϟ', color: '#fff35c', rarity: 'epic', max: 3,
      desc: n => `Bolts that hit cover or walls arc ${5 + 3 * (n - 1)} dmg to an enemy within ${200 + 40 * (n - 1)} px.` },
    { id: 'bounce', name: 'Bounce off Walls', icon: '⟲', color: '#7cffb2', rarity: 'common', max: 3,
      desc: n => `Bolts ricochet ${n}× off walls and cover.` },
    { id: 'rapid', name: 'Rapid Cast', icon: '⚡', color: '#5cf0ff', rarity: 'common', max: 3,
      desc: n => `Cast ${pct(1 / Math.pow(0.78, n) - 1)} faster.` },
    { id: 'power', name: 'Overcharge', icon: '✹', color: '#ff5cf0', rarity: 'common', max: 3,
      desc: n => `+${pct(0.25 * n)} bolt damage.` },
    { id: 'heavy', name: 'Heavy Orb', icon: '●', color: '#ffb05c', rarity: 'rare', max: 2,
      desc: n => `Bigger, slower bolts with ${pct(Math.pow(1.35, n) - 1)} more damage.` },
    { id: 'velocity', name: 'Velocity', icon: '➤', color: '#9dff5c', rarity: 'common', max: 2,
      desc: n => `+${pct(Math.pow(1.25, n) - 1)} bolt speed.` },
    { id: 'pierce', name: 'Phase Bolts', icon: '⇶', color: '#b4b4ff', rarity: 'epic', max: 2,
      desc: n => `Bolts pass through ${n} cover block${n > 1 ? 's' : ''}.` },
    { id: 'swift', name: 'Swift Step', icon: '»', color: '#5cffd6', rarity: 'common', max: 3,
      desc: n => `+${pct(Math.pow(1.1, n) - 1)} move speed, dash recharges ${pct(1 - Math.pow(0.8, n))} faster.` },
    { id: 'shield', name: 'Arcane Shield', icon: '⬡', color: '#6ea8ff', rarity: 'rare', max: 3,
      desc: n => `A ${20 * n} pt shield that recharges after 3 s without damage.` },
    { id: 'vital', name: 'Vitality', icon: '✚', color: '#5cff7a', rarity: 'common', max: 3,
      desc: n => `Max HP ${C.HP + 25 * n} (+25 now).` },
  ];
  const CARD = Object.fromEntries(CARDS.map(c => [c.id, c]));

  /** Card stacks ({id: count}) -> simulation numbers. */
  function deriveStats(stacks) {
    const n = id => (stacks && stacks[id]) | 0;
    return {
      count: 1 + 2 * n('split'),
      spread: 0.15,
      fireCd: Math.max(5, Math.round(C.FIRE_CD * Math.pow(0.78, n('rapid')))),
      dmg: C.BOLT_DMG * (1 + 0.25 * n('power')) * Math.pow(1.35, n('heavy')) * Math.pow(0.8, n('split')),
      radius: C.BOLT_R * Math.pow(1.4, n('heavy')),
      boltSpeed: C.BOLT_SPEED * Math.pow(1.25, n('velocity')) * Math.pow(0.88, n('heavy')),
      life: Math.round(C.BOLT_LIFE * (1 + 0.35 * n('bounce'))),
      homing: 0.035 * n('homing'),
      bounce: n('bounce'),
      pierce: n('pierce'),
      slow: n('frost') ? 45 + 30 * n('frost') : 0,
      burnLife: n('flame') ? 90 + 60 * (n('flame') - 1) : 0,
      burnDmg: n('flame') ? 0.3 + 0.1 * (n('flame') - 1) : 0,
      vamp: 0.18 * n('vamp'),
      chainDmg: n('chain') ? 5 + 3 * (n('chain') - 1) : 0,
      chainRange: 200 + 40 * Math.max(0, n('chain') - 1),
      speed: Math.pow(1.1, n('swift')),
      dashCd: Math.round(C.DASH_CD * Math.pow(0.8, n('swift'))),
      maxHp: C.HP + 25 * n('vital'),
      maxShield: 20 * n('shield'),
    };
  }

  return { C, MOVE, PHASES, CARDS, CARD, RARITY, deriveStats };
});
