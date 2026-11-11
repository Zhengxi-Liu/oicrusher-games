'use strict';
/**
 * Generic presence lobby shared by every game in this process: who is online, challenges,
 * practice-vs-bot rooms, rematches and a small "recent matches" list.
 *
 * A game plugs in a room class with this interface:
 *   new Room(id, players, hooks)        players[i] = client or { bot: true, name, level }
 *   room.tick                           current server tick (for ping replies)
 *   room.startInfo(side) -> object      extra fields merged into the 'match' message
 *   room.onMessage(side, msg)           any message type the lobby does not handle itself
 *   room.update()                       called at 60 Hz
 *   room.isOver() -> bool               rematch allowed
 *   room.forfeit(side) -> result|null   a player left; result if the match was still undecided
 *   hooks.send(client, msg), hooks.onOver(room, result)   result = { winner, score, duration, forfeit, entry? }
 * A game with a richer battle log passes its own `entry` object; it is stored and sent as-is.
 */
const fs = require('fs');
const path = require('path');
const Identity = require('./Identity.js');

const INVITE_TTL = 30000;
const RECENT_SIZE = 12;

class Lobby {
  constructor({ name, RoomClass, dataDir, log, bots = false }) {
    this.name = name;
    this.RoomClass = RoomClass;
    this.bots = bots;
    this.clients = new Map();
    this.rooms = new Map();
    this.invites = new Map();
    this.nextId = 1;
    this.log = (...a) => (log || console.log)(`[${name}]`, ...a);
    this.recentFile = dataDir ? path.join(dataDir, `${name}-recent.json`) : null;
    this.recent = [];
    try { if (this.recentFile) this.recent = JSON.parse(fs.readFileSync(this.recentFile, 'utf8')).slice(0, RECENT_SIZE); } catch (e) {}
    this.dirty = false;
    setInterval(() => this.expireInvites(), 1000).unref();
    setInterval(() => this.flushLobby(), 250).unref();
  }

  send(c, msg) {
    if (c && c.ws && c.ws.readyState === 1 && c.ws.bufferedAmount < 512 * 1024) c.ws.send(JSON.stringify(msg));
  }

  status(c) {
    if (c.room) return 'busy';
    for (const inv of this.invites.values()) if (inv.from === c.id || inv.to === c.id) return 'pending';
    return 'idle';
  }

  flushLobby() {
    if (!this.dirty) return;
    this.dirty = false;
    const players = [...this.clients.values()].filter(c => c.name).map(c => ({ id: c.id, name: c.name, status: this.status(c) }));
    for (const c of this.clients.values()) {
      if (c.name && !c.room) this.send(c, { t: 'lobby', you: c.id, players: players.filter(p => p.id !== c.id), recent: this.recent });
    }
  }
  touch() { this.dirty = true; }

  add(ws, ip) {
    const c = { id: this.nextId++, ws, ip, name: '', room: null, side: -1 };
    this.clients.set(c.id, c);
    return c;
  }

  remove(c) {
    this.leaveRoom(c, 'disconnected');
    for (const inv of [...this.invites.values()]) {
      if (inv.from === c.id || inv.to === c.id) this.dropInvite(inv, inv.from === c.id ? 'cancelled' : 'offline');
    }
    this.clients.delete(c.id);
    this.touch();
  }

  /** Route one client message. */
  handle(c, m) {
    switch (m.t) {
      case 'ping': return this.send(c, { t: 'pong', c: m.c, k: c.room ? c.room.tick : 0 });
      case 'hello': return this.hello(c, m);
      case 'challenge': return this.challenge(c, m.id | 0);
      case 'cancel': return this.cancel(c);
      case 'respond': return this.respond(c, m.id | 0, !!m.accept);
      case 'practice': return this.practice(c, String(m.level || 'normal'));
      case 'leave': return this.leaveRoom(c, 'left');
      case 'rematch': return this.rematch(c);
      default: if (c.room) c.room.onMessage(c.side, m);
    }
  }

  hello(c, m) {
    const who = Identity.resolve(m);                 // the portal identity (signed token), see Identity.js
    if (who.error) return this.send(c, { t: 'error', msg: who.error });
    c.name = who.name;
    c.registered = who.registered;
    this.send(c, { t: 'welcome', id: c.id, name: who.name });
    this.touch();
  }

  challenge(c, targetId) {
    const target = this.clients.get(targetId);
    if (!c.name || c.room) return;
    if (!target || !target.name || target === c) return this.send(c, { t: 'notice', msg: 'That player is no longer online.' });
    if (target.room) return this.send(c, { t: 'notice', msg: `${target.name} is in a match.` });
    for (const inv of [...this.invites.values()]) {
      if (inv.from === c.id) this.dropInvite(inv, 'cancelled');
      else if (inv.from === target.id || inv.to === target.id) return this.send(c, { t: 'notice', msg: `${target.name} is busy with another challenge.` });
    }
    const inv = { id: this.nextId++, from: c.id, to: target.id, at: Date.now() };
    this.invites.set(inv.id, inv);
    this.send(target, { t: 'invite', id: inv.id, from: c.name });
    this.send(c, { t: 'challenging', id: inv.id, name: target.name });
    this.touch();
  }

  dropInvite(inv, why) {
    if (!this.invites.delete(inv.id)) return;
    const from = this.clients.get(inv.from), to = this.clients.get(inv.to);
    if (from) this.send(from, { t: 'challenge_over', id: inv.id, why, name: to ? to.name : '' });
    if (to) this.send(to, { t: 'invite_over', id: inv.id });
    this.touch();
  }

  cancel(c) {
    for (const inv of [...this.invites.values()]) if (inv.from === c.id) this.dropInvite(inv, 'cancelled');
  }

  respond(c, inviteId, accept) {
    const inv = this.invites.get(inviteId);
    if (!inv || inv.to !== c.id) return this.send(c, { t: 'notice', msg: 'That challenge expired.' });
    if (!accept) return this.dropInvite(inv, 'declined');
    const host = this.clients.get(inv.from);
    this.invites.delete(inv.id);
    if (!host || host.room || c.room) { this.touch(); return this.send(c, { t: 'notice', msg: 'The challenger is no longer available.' }); }
    this.startRoom(host, c);
  }

  practice(c, level) {
    if (!this.bots || !c.name || c.room) return;
    if (!['easy', 'normal', 'hard'].includes(level)) level = 'normal';
    this.cancel(c);
    this.startRoom(c, { id: -1, bot: true, level, name: `Bot · ${level[0].toUpperCase()}${level.slice(1)}` });
  }

  expireInvites() {
    const now = Date.now();
    for (const inv of [...this.invites.values()]) if (now - inv.at > INVITE_TTL) this.dropInvite(inv, 'expired');
  }

  startRoom(a, b) {
    for (const inv of [...this.invites.values()]) {
      if ([a.id, b.id].includes(inv.from) || [a.id, b.id].includes(inv.to)) this.dropInvite(inv, 'cancelled');
    }
    const room = new this.RoomClass(this.nextId++, [a, b], {
      send: (cl, msg) => this.send(cl, msg),
      onOver: (r, result) => this.record(r, result),
    });
    this.rooms.set(room.id, room);
    [a, b].forEach((cl, side) => {
      cl.room = room; cl.side = side;
      this.send(cl, { t: 'match', room: room.id, side, opp: (side ? a : b).name, names: [a.name, b.name], ...room.startInfo(side) });
    });
    this.log(`match ${room.id}: ${a.name} vs ${b.name}`);
    this.touch();
  }

  leaveRoom(c, why) {
    const room = c.room;
    if (!room) return;
    const result = room.forfeit(c.side);
    if (result) this.record(room, result);
    for (const p of room.players) {
      if (p !== c && p.room === room) this.send(p, { t: 'end', why });
      p.room = null; p.side = -1;
    }
    this.rooms.delete(room.id);
    this.touch();
  }

  rematch(c) {
    const room = c.room;
    if (!room || !room.isOver()) return;
    room.rematch = room.rematch || [false, false];
    room.rematch[c.side] = true;
    const other = room.players[1 - c.side];
    if (other.bot) room.rematch[1 - c.side] = true;
    if (!room.rematch[1 - c.side]) return this.send(other, { t: 'rematch_ask' });
    room.closed = true;
    this.rooms.delete(room.id);
    for (const p of room.players) { p.room = null; p.side = -1; }
    this.startRoom(room.players[0], room.players[1]);
  }

  record(room, result) {
    const [a, b] = room.players;
    if (a.bot || b.bot) return;                           // practice games stay out of the list
    this.recent.unshift(result.entry || { ts: Math.floor(Date.now() / 1000), a: a.name, b: b.name, sa: result.score[0], sb: result.score[1],
                                          w: result.winner, dur: result.duration, ff: result.forfeit ? 1 : 0 });
    this.recent = this.recent.slice(0, RECENT_SIZE);
    this.log(`result ${room.id}: ${a.name} ${result.score[0]}-${result.score[1]} ${b.name}${result.forfeit ? ' (forfeit)' : ''}${room.stats ? ' ' + JSON.stringify(room.stats) : ''}`);
    if (this.recentFile) fs.writeFile(this.recentFile, JSON.stringify(this.recent), () => {});
    this.touch();
  }

  update() {
    for (const room of this.rooms.values()) room.update();
  }
}

module.exports = { Lobby };
