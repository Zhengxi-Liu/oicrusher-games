'use strict';
/**
 * TJ Hide and Seek - chess against the student bots in Room 23 (shared/ChessClub.js).
 *
 * The server owns every game: chess.js (BSD-2) checks the player's moves and decides how the game ends, the bot's
 * moves come from ChessWorker.js. So a "X beat Marcus" broadcast always means a real, legal win.
 * One game per player (by name), kept in memory for GAME_TTL so closing the board or reconnecting resumes it.
 * The player always has White.
 */
const path = require('path');
const { Worker } = require('worker_threads');
const req = require('module').createRequire(path.join(__dirname, '../../game_server/package.json'));
const { Chess } = req('chess.js');
const Club = require('../shared/ChessClub.js');

const GAME_TTL = 2 * 3600 * 1000;      // idle games are dropped after this
const THINK_TIMEOUT = 20000;
const MIN_THINK_MS = 500;               // a bot never answers instantly (feels like a person)

class ChessClub {
  constructor({ log }) {
    this.log = log || console.log;
    this.games = new Map();             // player name -> game
    this.worker = null;
    this.jobs = new Map();
    this.nextJob = 1;
    setInterval(() => { const now = Date.now(); for (const [k, g] of this.games) if (now - g.at > GAME_TTL) this.games.delete(k); }, 600000).unref();
  }

  bot(id) { return Club.BOTS.find(b => b.id === id) || null; }

  // ---------------------------------------------------------------- the engine thread (started on first use, restarted if it dies)
  engine() {
    if (this.worker) return this.worker;
    const w = this.worker = new Worker(path.join(__dirname, 'ChessWorker.js'), { resourceLimits: { maxOldGenerationSizeMb: 64 } });
    w.unref();
    w.on('message', m => { const j = this.jobs.get(m.id); if (!j) return; this.jobs.delete(m.id); clearTimeout(j.timer); m.error ? j.reject(new Error(m.error)) : j.resolve(m); });
    const fail = e => {
      if (this.worker === w) this.worker = null;
      for (const j of this.jobs.values()) { clearTimeout(j.timer); j.reject(e); }
      this.jobs.clear();
    };
    w.on('error', e => { this.log('chess engine error: ' + e.message); fail(e); });
    w.on('exit', code => fail(new Error('chess engine exited ' + code)));
    return w;
  }
  think(fen, bot) {
    return new Promise((resolve, reject) => {
      const id = this.nextJob++;
      const timer = setTimeout(() => { this.jobs.delete(id); reject(new Error('timeout')); }, THINK_TIMEOUT);
      this.jobs.set(id, { resolve, reject, timer });
      this.engine().postMessage({ id, fen, level: bot.level, randomness: bot.randomness });
    });
  }

  // ---------------------------------------------------------------- games
  /** The game this player has with this bot (resumed), or a new one. Starting with another bot abandons the old game. */
  start(name, botId) {
    const bot = this.bot(botId);
    if (!bot) return null;
    const old = this.games.get(name);
    if (old && old.bot === bot && !old.over) { old.at = Date.now(); return old; }
    const g = { bot, rules: new Chess(), at: Date.now(), last: null, over: null, thinking: false };
    this.games.set(name, g);
    return g;
  }
  get(name) { return this.games.get(name) || null; }

  /** What the client draws. legal: the player's moves as "e2e4" / "e7e8q". */
  view(g) {
    const r = g.rules, mine = !g.over && !g.thinking && r.turn() === 'w';
    return { t: 'chess', bot: g.bot.id, fen: r.fen(), last: g.last, check: r.inCheck(), thinking: g.thinking, over: g.over,
             legal: mine ? r.moves({ verbose: true }).map(m => m.from + m.to + (m.promotion || '')) : [] };
  }

  /** 'won' | 'lost' | 'draw: reason' once the game has ended (from White's = the player's side), else null. */
  ending(g) {
    const r = g.rules;
    if (r.isCheckmate()) return r.turn() === 'w' ? 'lost' : 'won';
    if (r.isStalemate()) return 'draw: stalemate';
    if (r.isInsufficientMaterial()) return 'draw: insufficient material';
    if (r.isThreefoldRepetition()) return 'draw: threefold repetition';
    if (r.isDraw()) return 'draw: 50-move rule';
    return null;
  }

  /**
   * The player's move (uci "e2e4", "e7e8q"). Calls back:
   *   update(view) after the player's move and again after the bot's reply, done(result) when the game ends.
   * Returns an error message, or '' when the move was taken.
   */
  move(name, uci, update, done) {
    const g = this.games.get(name);
    if (!g || g.over) return 'No game in progress.';
    if (g.thinking || g.rules.turn() !== 'w') return `Wait for ${g.bot.name}.`;
    uci = String(uci || '').toLowerCase();
    const m = g.rules.moves({ verbose: true }).find(x => x.from + x.to + (x.promotion || '') === uci);
    if (!m) return 'That move is not legal.';
    g.rules.move({ from: m.from, to: m.to, promotion: m.promotion });
    g.last = m.from + m.to; g.at = Date.now();
    if ((g.over = this.ending(g))) { update(this.view(g)); done(g.over); return ''; }
    g.thinking = true;
    update(this.view(g));
    const t0 = Date.now(), fen = g.rules.fen();
    this.think(fen, g.bot).catch(e => { this.log(`chess: ${g.bot.name} could not think (${e.message}), playing a random move`); return null; }).then(ans => {
      if (this.games.get(name) !== g || g.over || g.rules.fen() !== fen) return;      // abandoned or resigned meanwhile
      setTimeout(() => {
        if (this.games.get(name) !== g || g.over) return;
        const legal = g.rules.moves({ verbose: true });
        // the engine promotes to a queen; anything it says that chess.js does not accept becomes a random legal move
        const pick = (ans && (legal.find(x => x.from === ans.from && x.to === ans.to && (!x.promotion || x.promotion === 'q')))) || legal[(Math.random() * legal.length) | 0];
        g.rules.move({ from: pick.from, to: pick.to, promotion: pick.promotion });
        g.last = pick.from + pick.to; g.thinking = false; g.at = Date.now();
        g.over = this.ending(g);
        update(this.view(g));
        if (g.over) done(g.over);
      }, Math.max(0, MIN_THINK_MS - (Date.now() - t0)));
    });
    return '';
  }

  resign(name) {
    const g = this.games.get(name);
    if (!g || g.over) return null;
    g.over = 'lost'; g.thinking = false;
    return g;
  }
}

module.exports = ChessClub;
