'use strict';
/**
 * TJ Hide and Seek - the chess bots' brain, in a worker thread so a deep search never stalls the shared 60 Hz game loop.
 * In:  { id, fen, level, randomness }   Out: { id, from, to } (lower-case squares) or { id, error }
 * js-chess-engine (MIT) from game_server/node_modules; its transposition table is capped so the worker stays small.
 */
const path = require('path');
const { parentPort } = require('worker_threads');
const req = require('module').createRequire(path.join(__dirname, '../../game_server/package.json'));
const { Game } = req('js-chess-engine');

const TT_MB = [0, 0.5, 1, 2, 4, 8];

parentPort.on('message', ({ id, fen, level, randomness }) => {
  try {
    const lv = Math.max(1, Math.min(5, level | 0));
    // levels 4-5 search up to 2-3 plies deeper in simple endgames, which can take >50 MB at once: allow 1 at most
    const r = new Game(fen).ai({ level: lv, play: false, ttSizeMB: TT_MB[lv], randomness: randomness || 0, depth: lv >= 4 ? { extended: 1 } : undefined });
    const [from, to] = Object.entries(r.move)[0];
    parentPort.postMessage({ id, from: from.toLowerCase(), to: to.toLowerCase() });
  } catch (e) {
    parentPort.postMessage({ id, error: e.message });
  }
});
