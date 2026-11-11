'use strict';
/**
 * Room lobby for many-player games (Half-Life Web Deathmatch): a public room list, "create room"
 * with a 4-letter code, join by code or by clicking a listed room. 1v1 games use Lobby.js instead.
 *
 * A game plugs in a room class with:
 *   new Room(code, hooks, opts)          hooks.send(client, msg), hooks.lobbyChanged()
 *   room.addClient(client) -> bool       false when full
 *   room.removeClient(client)
 *   room.onMessage(client, msg)          anything the lobby does not handle itself
 *   room.update()                        60 Hz
 *   room.info() -> {code, players, humans, max, ...}   shown in the room list
 *   room.humanCount, room.tick
 */
const Identity = require('./Identity.js');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';   // no I / O
const EMPTY_ROOM_TTL = 20000;                        // a room with only bots left is closed after this

class RoomLobby {
  constructor({ name, RoomClass, log, maxRooms = 12 }) {
    this.name = name;
    this.RoomClass = RoomClass;
    this.maxRooms = maxRooms;
    this.clients = new Map();
    this.rooms = new Map();                          // code -> room
    this.nextId = 1;
    this.log = (...a) => (log || console.log)(`[${name}]`, ...a);
    this.dirty = false;
    setInterval(() => this.flush(), 500).unref();
  }

  send(c, msg) {
    if (c && c.ws && c.ws.readyState === 1 && c.ws.bufferedAmount < 512 * 1024) c.ws.send(JSON.stringify(msg));
  }

  roomList() { return [...this.rooms.values()].map(r => r.info()); }

  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    const rooms = this.roomList();
    for (const c of this.clients.values()) if (c.name && !c.room) this.send(c, { t: 'rooms', rooms });
  }
  touch() { this.dirty = true; }

  add(ws, ip) {
    const c = { id: this.nextId++, ws, ip, name: '', room: null };
    this.clients.set(c.id, c);
    return c;
  }

  remove(c) {
    this.leaveRoom(c);
    this.clients.delete(c.id);
  }

  handle(c, m) {
    switch (m.t) {
      case 'ping': return this.send(c, { t: 'pong', c: m.c, k: c.room ? c.room.tick : 0 });
      case 'hello': {
        const who = Identity.resolve(m);             // the portal identity (signed token), see Identity.js
        if (who.error) return this.send(c, { t: 'error', msg: who.error });
        const name = who.name;
        c.name = name;
        c.registered = who.registered;
        c.skin = Math.max(0, Math.min(15, m.skin | 0));          // character skin, validated again by the room
        this.send(c, { t: 'welcome', id: c.id, name });
        return this.send(c, { t: 'rooms', rooms: this.roomList() });
      }
      case 'create': return this.create(c, m);
      case 'join': c.prefTeam = m.team; return this.join(c, String(m.code || '').toUpperCase().trim());
      case 'leave': this.leaveRoom(c); return this.send(c, { t: 'rooms', rooms: this.roomList() });
      default: if (c.room) c.room.onMessage(c, m);
    }
  }

  newCode() {
    for (let n = 0; n < 50; n++) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    return null;
  }

  create(c, m) {
    if (!c.name) return;
    c.prefTeam = m.team;                                         // preferred team (rooms that have teams may use it)
    if (this.rooms.size >= this.maxRooms) return this.send(c, { t: 'error', msg: 'The server is busy: too many rooms. Join an existing one.' });
    const code = this.newCode();
    if (!code) return this.send(c, { t: 'error', msg: 'Could not create a room, try again.' });
    this.leaveRoom(c);
    const level = ['easy', 'normal', 'hard'].includes(m.level) ? m.level : 'normal';
    const room = new this.RoomClass(code, {
      send: (cl, msg) => this.send(cl, msg),
      lobbyChanged: () => this.touch(),
    }, { bots: Math.max(0, Math.min(8, m.bots | 0)), botLevel: level, map: String(m.map || ''), mode: m.mode === 'team' ? 'team' : 'dm' });
    this.rooms.set(code, room);
    this.log(`room ${code} created by ${c.name} (${m.bots | 0} bots, ${level}, ${room.info().map}${room.info().mode === 'team' ? ', team' : ''})`);
    this.join(c, code);
  }

  join(c, code) {
    if (!c.name) return;
    const room = this.rooms.get(code);
    if (!room) return this.send(c, { t: 'error', msg: `Room ${code || '?'} does not exist.` });
    if (c.room === room) return;
    this.leaveRoom(c);
    if (!room.addClient(c)) return this.send(c, { t: 'error', msg: `Room ${code} is full.` });
    c.room = room;
    room.emptySince = 0;
    this.touch();
  }

  leaveRoom(c) {
    const room = c.room;
    if (!room) return;
    room.removeClient(c);
    c.room = null;
    if (!room.humanCount) room.emptySince = Date.now();
    this.touch();
  }

  update() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (!room.humanCount && room.emptySince && now - room.emptySince > EMPTY_ROOM_TTL) {
        this.rooms.delete(code);
        this.log(`room ${code} closed (empty)${room.stats ? ' ' + JSON.stringify(room.stats) : ''}`);
        this.touch();
        continue;
      }
      room.update();
    }
  }
}

module.exports = { RoomLobby };
