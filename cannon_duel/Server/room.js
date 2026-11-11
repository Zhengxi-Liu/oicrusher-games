'use strict';
/**
 * Cannon Duel - one online match on the shared game server.
 *
 * The game stays peer-authoritative exactly as before the PHP -> Node move (see CANNON_DUEL.md §9):
 * each gun scores its own shells, the host (challenger, BLUE, side 0) has the final word on the
 * winner. This room is a low-latency relay: every in-match event a browser sends is forwarded to
 * the opponent the moment it arrives, in order. It also writes the battle log the host reports.
 *
 * Client -> server: {t:'ev', e:{t:'start'|'chg'|'fire'|'dmg'|'air'|'win', ...}}   relayed as {t:'ev', e}
 *                   {t:'report', winner, map, dur, air, w:{hp,shots,hits,dmg}, l:{...}}   host only, once
 */
const RELAYED = new Set(['start', 'chg', 'fire', 'dmg', 'air', 'win']);
const HOST_ONLY = new Set(['start', 'win']);
const MAPS = new Set(['hill', 'lake']);

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0));

class CannonRoom {
  constructor(id, players, hooks) {
    this.id = id;
    this.players = players;
    this.hooks = hooks;
    this.tick = 0;
    this.startedAt = Date.now();
    this.closed = false;
    this.reported = false;
    this.stats = { relayed: 0 };
  }

  // ---- generic lobby interface (game_server/Lobby.js)
  startInfo() { return {}; }
  // Rematch is only ever offered from the result panel, and needs both players to ask.
  isOver() { return true; }
  update() { this.tick++; }
  forfeit() { this.closed = true; return null; }   // only finished, host-reported battles are logged

  onMessage(side, m) {
    if (this.closed) return;
    if (m.t === 'ev') {
      const e = m.e;
      if (!e || typeof e !== 'object' || !RELAYED.has(e.t)) return;
      if (HOST_ONLY.has(e.t) && side !== 0) return;
      this.stats.relayed++;
      this.hooks.send(this.players[1 - side], { t: 'ev', e });
    } else if (m.t === 'report') {
      this.report(side, m);
    }
  }

  /** The host logs the finished battle once; numbers are clamped, names come from the lobby. */
  report(side, m) {
    if (side !== 0 || this.reported) return;
    this.reported = true;
    const winner = m.winner === 1 ? 1 : 0;
    const stat = (s, p) => ({
      name: this.players[p].name,
      hp: clampInt(s && s.hp, 0, 255), shots: clampInt(s && s.shots, 0, 9999),
      hits: clampInt(s && s.hits, 0, 9999), dmg: clampInt(s && s.dmg, 0, 65535),
    });
    const entry = {
      ts: Math.floor(Date.now() / 1000),
      map: MAPS.has(m.map) ? m.map : 'lake',
      dur: clampInt(m.dur, 0, 65535),
      air: clampInt(m.air, 0, 9999),
      w: stat(m.w, winner),
      l: stat(m.l, 1 - winner),
    };
    const score = [0, 0]; score[winner] = 1;
    this.hooks.onOver(this, { winner, score, duration: entry.dur, forfeit: false, entry });
  }
}

module.exports = { Room: CannonRoom };
