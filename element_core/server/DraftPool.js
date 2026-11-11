'use strict';
/**
 * Server-side card pool. The server owns the RNG (seeded per room), so offers cannot be
 * rerolled or forged by a client. Each draft offers 3 distinct cards the player has not maxed.
 */
const crypto = require('crypto');
const { CARDS, CARD, RARITY } = require('../shared/Constants.js');

/** mulberry32: tiny, fast, good enough for card draws. */
function makeRng(seed = crypto.randomInt(1, 0x7fffffff)) {
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.seed = seed;
  return rng;
}

/** Weighted draw of `n` distinct card ids. */
function offer(rng, stacks, n = 3) {
  const pool = CARDS.filter(c => ((stacks[c.id] | 0) < c.max)).map(c => ({ id: c.id, w: RARITY[c.rarity] }));
  const out = [];
  while (out.length < n && pool.length) {
    const total = pool.reduce((s, c) => s + c.w, 0);
    let r = rng() * total, i = 0;
    while (r >= pool[i].w) { r -= pool[i].w; i++; }
    out.push(pool[i].id);
    pool.splice(i, 1);
  }
  return out;
}

function apply(stacks, id) {
  if (!CARD[id]) return false;
  if ((stacks[id] | 0) >= CARD[id].max) return false;
  stacks[id] = (stacks[id] | 0) + 1;
  return true;
}

module.exports = { makeRng, offer, apply };
