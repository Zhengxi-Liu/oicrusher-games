'use strict';
/**
 * TJ Hide and Seek - the persistent school, plugged into the unified game server (game_server/server.js).
 *
 * One world that never resets. Everything hidden stays where it was put (DATA_DIR/tjhs-world.json) until
 * somebody finds and opens it:
 *   - hide {type, p:[x,y,z], rot, msg}   checked against the school (shared/SchoolMap.js validSpot), the hider's
 *                                         own position (within reach), a per-player cap and a cooldown
 *   - open {id}                           first player within reach gets it: the note is revealed only now,
 *                                         the item is marked isFound, both finder and hider score
 *   - take {id}                           pick your own stash back up (no points)
 *   - st {p, yaw}                         positions relayed to everyone at 10 Hz (other students walking around)
 *   - chat {text}                         school-wide chat (rejected by the keyword filter when it matches, rate limited)
 *   - chatMod {} / chatDel {cid | by | all}  admins only: list recent chat / delete one line, everything a player said, or all
 *   - modGet / modRule / modExc / modTest  admins only: the keyword filter (Moderation.js) and its blocked-content log
 *   - chessStart {bot} / chessMove {uci} / chessResign {}   play the chess club bots in Room 23 (Chess.js); a win is
 *                                         announced to everyone and scores (once per bot per day)
 *   - hoopShoot {id, hoop, x, z, ang, pow} / hoopBoard {}   three-point shooting in the gyms (shared/Hoops.js): the server
 *                                         replays the shot, keeps each player's streak and the best-streak leaderboard
 *   - wb {key, text}                      write over the whiteboard of the classroom you stand in ('' = wipe it back to
 *                                         the lesson); key = "floor:room name", one board per room, kept forever
 * Only registered portal accounts may play (guests get {t:'error', needAccount}).
 * Usernames (hello), chat lines, stash notes and whiteboard text all go through the keyword filter first.
 * Then Gemini checks them in the background (AiModerator.js): flagged chat lines, notes and whiteboards become
 * "I love TJ"; a flagged username becomes "i'm 67" here (scores, stashes, chat and log entries move over).
 * Checked things are marked (ai: 1, world.names) so a restart only re-queues what was never answered.
 * Broadcasts: item+ / item- / log ("X just found Y's MacBook on Floor 2!") / board (top 10) / players / chat / wb.
 *
 * Interface expected by server.js: add(ws, ip) -> client, remove(client), handle(client, msg),
 * update() at 60 Hz, and `clients` / `rooms` maps for /health.
 */
const Identity = require('../../game_server/Identity.js');
const fs = require('fs');
const path = require('path');
const SchoolMap = require('../shared/SchoolMap.js');
const Moderation = require('./Moderation.js');
const AiModerator = require('./AiModerator.js');
const ChessClub = require('./Chess.js');
const ChessSpots = require('../shared/ChessClub.js');
const Hoops = require('../shared/Hoops.js');

const TYPES = ['macbook', 'ti84', 'hydroflask', 'redbull', 'homework', 'airpods', 'rubik', 'textbook'];
const TYPE_NAMES = { macbook: 'MacBook', ti84: 'TI-84', hydroflask: 'Hydro Flask', redbull: 'Red Bull', homework: 'Homework Folder',
                     airpods: 'AirPods', rubik: "Rubik's Cube", textbook: 'AP Physics textbook' };
const MAX_PLAYERS = 60;
const MAX_ACTIVE_PER_PLAYER = 5;     // stashes a player can have out at once
const MAX_ITEMS = 800;               // the whole school
const HIDE_COOLDOWN_MS = 15000;
const REACH = 4.0;                   // metres from the player (positions are ~100 ms old)
const MSG_LEN = 140;
const SEND_EVERY = 6;                // 60 Hz / 6 = 10 Hz
const KEEP_FOUND = 300;
const LOG_LEN = 300;                 // events kept (players can scroll back through them)
const HIST_PAGE = 50;                // history sent at once: on joining, and per scroll-back request
const CHAT_LEN = 120;
const CHAT_KEEP = 300;
const WB_LEN = 160;                  // a whiteboard: up to 6 lines
const WB_LINES = 6;
const WB_COOLDOWN_MS = 8000;
const WB_KINDS = new Set(['class', 'lecture', 'lab', 'cs', 'music']);   // the rooms SchoolBuilder puts a whiteboard in

const clean = (s, len = MSG_LEN) => String(s || '').replace(/[\x00-\x09\x0B-\x1F\x7F<>]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, len);
// what a player sees when the keyword filter rejects their text (nothing is published)
const WARN = 'Blocked: that contains language that is not allowed here. Inappropriate content can get your IP address banned. 已拦截：内容含有不允许的词语，违规可能导致 IP 被封禁。';

// what Gemini-flagged text and names are replaced with
const AI_TEXT = 'I love TJ';
const AI_NAME = "i'm 67";
const AI_HIT = [{ id: 'gemini', term: 'Gemini', cat: 'ai' }];

const r2 = v => Math.round(v * 100) / 100;

class HideServer {
  constructor({ name = 'tjhs', dataDir, log }) {
    this.name = name;
    this.clients = new Map();
    this.rooms = new Map();              // unused (one school); kept for /health
    this.nextId = 1;
    this.tick = 0;
    this.log = (...a) => (log || console.log)(`[${name}]`, ...a);
    this.mod = Moderation.shared({ dataDir, log: this.log });
    this.map = SchoolMap.build();
    this.file = path.join(dataDir || '.', 'tjhs-world.json');
    this.world = { items: [], scores: {}, log: [], nextItem: 1, boards: {}, chat: [], names: {}, hoops: {} };
    try {
      const w = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (w && Array.isArray(w.items)) this.world = { items: w.items, scores: w.scores || {}, log: w.log || [], nextItem: w.nextItem || 1, boards: w.boards || {}, chat: w.chat || [], names: w.names || {}, hoops: w.hoops || {} };
    } catch (e) {}
    // chat lines get ids so admins can delete them (older saves had none)
    this.world.nextChat = this.world.chat.reduce((n, e) => Math.max(n, (e.cid | 0) + 1), 1);
    for (const e of this.world.chat) if (!e.cid) e.cid = this.world.nextChat++;
    this.wbRooms = new Map(this.map.rooms.filter(r => WB_KINDS.has(r.kind)).map(r => [`${r.floor}:${r.name}`, r]));
    this.log(`school loaded: ${this.active().length} hidden items, ${Object.keys(this.world.scores).length} players`);
    this.dirty = false;
    setInterval(() => this.save(), 5000).unref();
    this.ai = new AiModerator({ log: this.log });
    this.chess = new ChessClub({ log: this.log });
    this.chessTables = ChessSpots.spots(this.map);
    this.hoopList = Hoops.hoops(this.map);
    this.hoopStreak = new Map();          // name -> current streak (in memory: a restart is a fresh start)
    this.aiScan();
  }

  // ---------------------------------------------------------------- Gemini pass (AiModerator.js)
  /** Queue everything that was never checked: on start-up, and so nothing is lost while Gemini is unreachable. */
  aiScan() {
    if (!this.ai.enabled) return;
    let n = 0;
    for (const e of this.world.chat) if (!e.ai) { this.aiChat(e); n++; }
    for (const [key, b] of Object.entries(this.world.boards)) if (!b.ai) { this.aiBoard(key, b); n++; }
    for (const it of this.active()) if (!it.ai) { this.aiNote(it); n++; }
    const names = new Set([...Object.keys(this.world.scores), ...this.world.chat.map(e => e.by), ...this.world.items.map(i => i.creator)]);
    for (const nm of names) if (nm && !this.world.names[nm] && nm !== AI_NAME) { this.aiName(nm); n++; }
    if (n) this.log(`gemini moderation: ${n} unchecked things queued`);
  }
  aiFlag(text, kind, user, ip, action) { this.mod.record(text, { kind, user, ip, hits: AI_HIT, action }); }
  aiChat(e) {
    this.ai.check(e.text, 'chat', bad => {
      e.ai = 1; this.dirty = true;
      if (!bad || e.text === AI_TEXT) return;
      this.aiFlag(e.text, 'chat', e.by, '', 'replaced');
      e.text = AI_TEXT;
      if (this.world.chat.includes(e)) this.broadcast({ t: 'chatEdit', e });
    });
  }
  aiBoard(key, b) {
    this.ai.check(b.text, 'board', bad => {
      b.ai = 1; this.dirty = true;
      if (!bad || b.text === AI_TEXT) return;
      this.aiFlag(b.text, 'board', b.by, '', 'replaced');
      b.text = AI_TEXT;
      if (this.world.boards[key] === b) this.broadcast({ t: 'wb', key, b });
    });
  }
  aiNote(it) {
    this.ai.check(it.message, 'note', bad => {
      it.ai = 1; this.dirty = true;
      if (!bad || it.message === AI_TEXT) return;
      this.aiFlag(it.message, 'note', it.creator, '', 'replaced');
      it.message = AI_TEXT;
    });
  }
  aiName(name) {
    if (this.aiPending && this.aiPending.has(name)) return;
    (this.aiPending = this.aiPending || new Set()).add(name);
    this.ai.check(name, 'username', bad => {
      this.aiPending.delete(name);
      if (this.world.names[name]) return;
      // portal admins keep their name
      const admin = [...this.clients.values()].some(c => c.realName === name && c.admin);
      this.world.names[name] = bad && !admin ? 'bad' : 'ok';
      this.dirty = true;
      if (bad && !admin) this.renameEverywhere(name);
    });
  }
  /** A flagged username: everything it owns moves to AI_NAME, and whoever is online under it is renamed. */
  renameEverywhere(old) {
    const w = this.world, to = AI_NAME;
    const s = w.scores[old];
    if (s) { const t = this.score(to); t.pts += s.pts; t.found += s.found; t.hidden += s.hidden; delete w.scores[old]; }
    for (const it of w.items) { if (it.creator === old) it.creator = to; if (it.foundBy === old) it.foundBy = to; }
    for (const e of w.log) { if (e.by === old) e.by = to; if (e.owner === old) e.owner = to; }
    for (const e of w.chat) if (e.by === old) e.by = to;
    for (const b of Object.values(w.boards)) if (b.by === old) b.by = to;
    const hs = w.hoops[old];
    if (hs) { const t = w.hoops[to] || (w.hoops[to] = { best: 0, made: 0, shots: 0 }); t.best = Math.max(t.best, hs.best); t.made += hs.made; t.shots += hs.shots; delete w.hoops[old]; }
    this.dirty = true;
    let ip = '';
    for (const c of this.clients.values()) if (c.name === old) {
      c.name = to; ip = c.ip;
      this.send(c, { t: 'me', me: this.me(c), note: `Your name was changed to "${to}" because it contains inappropriate language.` });
    }
    this.aiFlag(old, 'username', old, ip, 'renamed');
    this.log(`gemini moderation: renamed ${old} -> ${to}`);
    this.broadcast({ t: 'rename', from: old, to });
    this.roster();
    this.broadcast({ t: 'board', board: this.board() });
  }

  active() { return this.world.items.filter(i => !i.isFound); }
  send(c, m) { if (c.ws && c.ws.readyState === 1 && c.ws.bufferedAmount < 512 * 1024) c.ws.send(JSON.stringify(m)); }
  each(fn) { for (const c of this.clients.values()) if (c.name) fn(c); }
  broadcast(m) { const s = JSON.stringify(m); this.each(c => { if (c.ws.readyState === 1 && c.ws.bufferedAmount < 512 * 1024) c.ws.send(s); }); }

  save() {
    if (!this.dirty) return;
    this.dirty = false;
    const found = this.world.items.filter(i => i.isFound);
    if (found.length > KEEP_FOUND) {
      const drop = new Set(found.sort((a, b) => a.foundAt - b.foundAt).slice(0, found.length - KEEP_FOUND).map(i => i.id));
      this.world.items = this.world.items.filter(i => !drop.has(i.id));
    }
    const tmp = this.file + '.tmp';
    fs.writeFile(tmp, JSON.stringify(this.world), e => { if (!e) fs.rename(tmp, this.file, () => {}); });
  }

  add(ws, ip) {
    const c = { id: this.nextId++, ws, ip, name: '', look: 0, st: null, lastSt: 0, lastHide: 0, chatT: [], lastChat: '', lastWb: 0, histT: {} };
    this.clients.set(c.id, c);
    // the title screen shows the board and who is in before the visitor has a name
    this.send(c, { t: 'peek', board: this.board(), online: this.online(), log: this.world.log.slice(-HIST_PAGE) });
    return c;
  }

  remove(c) {
    this.clients.delete(c.id);
    if (c.name) { this.roster(); this.log(`${c.name} left (${this.online()} online)`); }
  }

  online() { let n = 0; this.each(() => n++); return n; }
  roster() { const list = []; this.each(c => list.push({ id: c.id, name: c.name, look: c.look })); this.broadcast({ t: 'players', list }); }
  score(name) { return this.world.scores[name] || (this.world.scores[name] = { pts: 0, found: 0, hidden: 0 }); }
  board() {
    return Object.entries(this.world.scores).map(([name, s]) => ({ name, ...s })).filter(s => s.pts > 0 || s.hidden > 0)
      .sort((a, b) => b.pts - a.pts || b.found - a.found).slice(0, 10);
  }
  pub(it, c) { return { id: it.id, type: it.type, p: [it.x, it.y, it.z], rot: it.rot, mine: !!(c && it.creator === c.name), at: it.createdAt }; }
  where(it) { return this.map.locate(it.x, it.y, it.z); }
  addLog(e) {
    e.at = Date.now();
    this.world.log.push(e);
    if (this.world.log.length > LOG_LEN) this.world.log.splice(0, this.world.log.length - LOG_LEN);
    this.dirty = true;
    this.broadcast({ t: 'log', e });
  }
  me(c) { const s = this.score(c.name); return { name: c.name, ...s, out: this.active().filter(i => i.creator === c.name).length, max: MAX_ACTIVE_PER_PLAYER }; }

  handle(c, m) {
    switch (m.t) {
      case 'ping': return this.send(c, { t: 'pong', c: m.c });
      case 'hello': {
        const who = Identity.resolve(m);                 // the portal identity (signed token), see game_server/Identity.js
        if (who.error) return this.send(c, { t: 'error', msg: who.error, blocked: !!who.blocked });   // blocked: the keyword filter refused the name (checked in Identity.resolve)
        if (!who.registered) return this.send(c, { t: 'error', needAccount: true, msg: 'TJ Hide and Seek is for registered players: log in or register on the game portal to play.' });
        if (!c.name && this.online() >= MAX_PLAYERS) return this.send(c, { t: 'error', msg: 'The school is full right now - try again in a minute.' });
        const first = !c.name;
        c.realName = who.name;
        c.admin = !!who.admin;
        c.name = !c.admin && this.world.names[who.name] === 'bad' ? AI_NAME : who.name;   // flagged by Gemini earlier
        if (!c.admin && !this.world.names[who.name] && who.name !== AI_NAME) this.aiName(who.name);
        c.look = Math.max(0, Math.min(15, m.look | 0));
        this.send(c, { t: 'welcome', id: c.id, admin: c.admin, me: this.me(c), items: this.active().map(i => this.pub(i, c)), board: this.board(), log: this.world.log.slice(-HIST_PAGE),
                       chat: this.world.chat.slice(-HIST_PAGE), boards: this.world.boards });
        if (first) this.log(`${c.name} connected (${this.online()} online)`);
        if (m.play && !c.playing) { c.playing = true; this.addLog({ k: 'join', by: c.name }); }   // announce only once they walk in
        return this.roster();
      }
      case 'st': return this.onState(c, m);
      case 'hide': return this.onHide(c, m);
      case 'open': return this.onOpen(c, m);
      case 'take': return this.onTake(c, m);
      case 'chat': return this.onChat(c, m);
      case 'chatMod': return this.onChatMod(c);
      case 'modGet': case 'modRule': case 'modExc': case 'modTest': return this.onModAdmin(c, m);
      case 'chatDel': return this.onChatDel(c, m);
      case 'chessStart': return this.onChessStart(c, m);
      case 'chessMove': return this.onChessMove(c, m);
      case 'chessResign': return this.onChessResign(c);
      case 'hoopShoot': return this.onHoopShoot(c, m);
      case 'hoopBoard': { const s = c.name && this.world.hoops[c.name];
        return this.send(c, { t: 'hoopBoard', list: this.hoopTop(), me: { best: s ? s.best : 0, streak: this.hoopStreak.get(c.name) || 0 } }); }
      case 'wb': return this.onBoard(c, m);
      case 'hist': return this.onHist(c, m);
    }
  }

  onState(c, m) {
    if (!c.name) return;
    const now = Date.now();
    if (now - c.lastSt < 60) return;
    const p = m.p;
    if (!Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite) || !Number.isFinite(m.yaw)) return;
    if (Math.abs(p[0]) > 400 || Math.abs(p[2]) > 400 || p[1] < -10 || p[1] > 20) return;
    c.lastSt = now;
    c.st = { p: p.map(r2), yaw: Math.round(m.yaw * 100) / 100, at: now, c: m.c ? 1 : 0 };
  }

  near(c, x, y, z, reach) {
    if (!c.st || Date.now() - c.st.at > 5000) return false;
    const [px, py, pz] = c.st.p;
    return Math.hypot(px - x, pz - z) <= reach && y > py - 1.0 && y < py + 2.8;
  }

  onHide(c, m) {
    if (!c.name) return;
    const fail = msg => this.send(c, { t: 'hideResult', ok: false, msg });
    const now = Date.now();
    if (now - c.lastHide < HIDE_COOLDOWN_MS) return fail(`Wait ${Math.ceil((HIDE_COOLDOWN_MS - (now - c.lastHide)) / 1000)} s before hiding something else.`);
    if (!TYPES.includes(m.type)) return fail('Unknown item.');
    const p = m.p;
    if (!Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite)) return fail('Bad position.');
    const [x, y, z] = p;
    if (!this.map.validSpot(x, y, z)) return fail('That spot is not inside the school.');
    if (!this.near(c, x, y, z, REACH)) return fail('Too far away - hide it within reach.');
    const msg = clean(m.msg);
    if (!msg) return fail('Write a note for whoever finds it.');
    if (!this.mod.allow(msg, { kind: 'note', user: c.name, ip: c.ip })) return fail(WARN);
    const act = this.active();
    if (act.filter(i => i.creator === c.name).length >= MAX_ACTIVE_PER_PLAYER) return fail(`You already have ${MAX_ACTIVE_PER_PLAYER} stashes out. Pick one up (walk to it, press X) or wait until someone finds one.`);
    if (act.length >= MAX_ITEMS) return fail('The school is full of stashes - find some first!');
    if (act.some(i => Math.hypot(i.x - x, i.y - y, i.z - z) < 0.3)) return fail('Something is already hidden right there.');
    const it = { id: this.world.nextItem++, type: m.type, x: r2(x), y: r2(y), z: r2(z), rot: Math.round((Number(m.rot) || 0) * 100) / 100,
                 floor: y > this.map.F2Y - 0.3 ? 2 : 1, creator: c.name, message: msg, createdAt: now, isFound: false };
    this.world.items.push(it);
    this.aiNote(it);
    this.score(c.name).hidden++;
    c.lastHide = now;
    this.dirty = true;
    const w = this.where(it);
    this.log(`${c.name} hid a ${it.type} in ${w.name} (floor ${w.floor})`);
    this.send(c, { t: 'hideResult', ok: true, id: it.id, me: this.me(c) });
    for (const o of this.clients.values()) if (o.name) this.send(o, { t: 'item+', item: this.pub(it, o) });
    this.addLog({ k: 'hid', by: c.name, type: it.type, floor: w.floor });
    this.broadcast({ t: 'board', board: this.board() });
  }

  onOpen(c, m) {
    if (!c.name) return;
    const it = this.world.items.find(i => i.id === (m.id | 0));
    if (!it || it.isFound) return this.send(c, { t: 'opened', ok: false, id: m.id | 0, msg: 'Too late - somebody else just found it!' });
    if (it.creator === c.name) {             // your own stash: read your note, nothing changes
      return this.send(c, { t: 'opened', ok: true, own: true, item: this.full(it) });
    }
    if (!this.near(c, it.x, it.y, it.z, REACH)) return this.send(c, { t: 'opened', ok: false, id: it.id, msg: 'Get closer first.' });
    const now = Date.now(), hours = (now - it.createdAt) / 3600000;
    const gain = 10 + Math.min(20, Math.floor(hours));
    const hiderGain = 3 + Math.min(12, Math.floor(hours / 4));
    it.isFound = true; it.foundBy = c.name; it.foundAt = now;
    const s = this.score(c.name); s.pts += gain; s.found++;
    this.score(it.creator).pts += hiderGain;
    this.dirty = true;
    const w = this.where(it);
    this.log(`${c.name} found ${it.creator}'s ${it.type} in ${w.name} after ${hours.toFixed(1)} h (+${gain} / +${hiderGain})`);
    this.send(c, { t: 'opened', ok: true, item: this.full(it), gain, me: this.me(c) });
    this.broadcast({ t: 'item-', id: it.id, by: c.name });
    this.addLog({ k: 'found', by: c.name, owner: it.creator, type: it.type, floor: w.floor, where: w.name, hours: Math.round(hours * 10) / 10 });
    for (const o of this.clients.values()) if (o.name === it.creator && o !== c) this.send(o, { t: 'me', me: this.me(o), note: `${c.name} found your ${TYPE_NAMES[it.type]}! +${hiderGain} pts` });
    this.broadcast({ t: 'board', board: this.board() });
  }

  onTake(c, m) {
    if (!c.name) return;
    const it = this.world.items.find(i => i.id === (m.id | 0));
    if (!it || it.isFound || it.creator !== c.name) return;
    if (!this.near(c, it.x, it.y, it.z, REACH)) return this.send(c, { t: 'hideResult', ok: false, msg: 'Get closer to pick it up.' });
    this.world.items = this.world.items.filter(i => i !== it);
    const s = this.score(c.name); s.hidden = Math.max(0, s.hidden - 1);
    this.dirty = true;
    this.broadcast({ t: 'item-', id: it.id, by: c.name, taken: true });
    this.send(c, { t: 'me', me: this.me(c), note: `Picked your ${TYPE_NAMES[it.type]} back up.` });
  }

  onChat(c, m) {
    if (!c.name) return;
    const now = Date.now();
    c.chatT = c.chatT.filter(t => now - t < 10000);
    if (c.chatT.length >= 5 || now - (c.chatT[c.chatT.length - 1] || 0) < 700) return this.send(c, { t: 'chatErr', msg: 'Slow down a little!' });
    const text = clean(String(m.text || '').replace(/\s+/g, ' '), CHAT_LEN);
    if (!text) return;
    if (!this.mod.allow(text, { kind: 'chat', user: c.name, ip: c.ip })) return this.send(c, { t: 'chatErr', msg: WARN });
    if (text === c.lastChat && now - c.chatT[c.chatT.length - 1] < 5000) return;
    c.chatT.push(now); c.lastChat = text;
    const e = { cid: this.world.nextChat++, id: c.id, by: c.name, text, at: now };
    this.world.chat.push(e);
    if (this.world.chat.length > CHAT_KEEP) this.world.chat.splice(0, this.world.chat.length - CHAT_KEEP);
    this.dirty = true;
    this.broadcast({ t: 'chat', e });
    this.aiChat(e);
  }

  /** Admin moderation: the recent chat, newest last. */
  onChatMod(c) {
    if (!c.name || !c.admin) return;
    this.send(c, { t: 'chatMod', list: this.world.chat.slice(-CHAT_KEEP) });
  }

  /** Admin moderation: delete one line ({cid}), everything one player said ({by}) or the whole chat ({all}). */
  onChatDel(c, m) {
    if (!c.name || !c.admin) return;
    const chat = this.world.chat;
    const gone = m.all ? chat : m.by ? chat.filter(e => e.by === String(m.by)) : chat.filter(e => e.cid === (m.cid | 0));
    if (!gone.length) return;
    const cids = gone.map(e => e.cid), drop = new Set(cids);
    this.world.chat = chat.filter(e => !drop.has(e.cid));
    this.dirty = true;
    this.log(`${c.name} deleted ${cids.length} chat line${cids.length === 1 ? '' : 's'}${m.all ? ' (all)' : m.by ? ` by ${m.by}` : ''}`);
    this.broadcast({ t: 'chatDel', cids });
  }

  /** Admin keyword filter: modGet {} / modRule {op: add|update|remove, rule} / modExc {op: add|remove, exc} / modTest {text}. */
  onModAdmin(c, m) {
    if (!c.name || !c.admin) return;
    if (m.t === 'modTest') {
      const r = this.mod.check(String(m.text || ''));
      return this.send(c, { t: 'modTest', ok: r.ok, hits: r.hits || [] });
    }
    let res = { ok: true };
    if (m.t === 'modRule') res = this.mod.editRule(String(m.op), m.rule || {});
    else if (m.t === 'modExc') res = this.mod.editException(String(m.op), m.exc || {});
    if (res.ok && m.t !== 'modGet') this.log(`${c.name} changed the keyword filter: ${m.t} ${m.op} ${JSON.stringify(m.rule || m.exc)}`);
    this.send(c, Object.assign({ t: 'mod', err: res.error || '' }, this.mod.snapshot()));
  }

  /** Scrolling back: the page of events / chat lines just older than `before` (the oldest one the client has). */
  onHist(c, m) {
    const k = m.k === 'chat' ? 'chat' : 'log';
    if (k === 'chat' && !c.name) return;
    const now = Date.now();
    if (now - (c.histT[k] || 0) < 250) return;
    c.histT[k] = now;
    const before = Number(m.before) || Infinity, all = this.world[k];
    let end = all.length;
    while (end > 0 && !(all[end - 1].at < before)) end--;
    const list = all.slice(Math.max(0, end - HIST_PAGE), end);
    this.send(c, { t: 'hist', k, list, more: end > list.length });
  }

  // ---------------------------------------------------------------- chess club (Chess.js, shared/ChessClub.js)
  sendTo(name, m) { for (const o of this.clients.values()) if (o.name === name) this.send(o, m); }
  onChessStart(c, m) {
    if (!c.name) return;
    const t = this.chessTables.find(s => s.bot.id === m.bot);
    if (!t) return;
    if (!c.st || Date.now() - c.st.at > 5000 || c.st.p[1] > this.map.F2Y - 1 || Math.hypot(c.st.p[0] - t.x, c.st.p[2] - t.z) > ChessSpots.REACH + 1)
      return this.send(c, { t: 'chessErr', msg: `Walk up to ${t.bot.name}'s table in Room 23 first.` });
    const g = this.chess.start(c.name, t.bot.id);
    if (g.rules.history().length === 0) this.log(`${c.name} sat down to play chess with ${t.bot.name}`);
    this.send(c, this.chess.view(g));
  }
  onChessMove(c, m) {
    if (!c.name) return;
    const name = c.name;
    const err = this.chess.move(name, m.uci, v => this.sendTo(name, v), result => this.chessOver(name, result));
    if (err) this.send(c, { t: 'chessErr', msg: err });
  }
  onChessResign(c) {
    if (!c.name) return;
    const g = this.chess.resign(c.name);
    if (!g) return;
    this.send(c, this.chess.view(g));
    this.chessOver(c.name, 'lost');
  }
  chessOver(name, result) {
    const g = this.chess.get(name);
    if (!g) return;
    const bot = g.bot, moves = Math.ceil(g.rules.history().length / 2);
    this.log(`chess: ${name} ${result === 'won' ? 'beat' : result === 'lost' ? 'lost to' : 'drew with'} ${bot.name} in ${moves} moves`);
    if (result !== 'won') return;
    // points once per bot per day (so nobody farms Riley); the announcement every time
    const s = this.score(name), day = new Date().toISOString().slice(0, 10);
    s.chess = s.chess || {};
    const gain = s.chess[bot.id] === day ? 0 : bot.pts;
    s.chess[bot.id] = day;
    s.pts += gain;
    this.dirty = true;
    this.addLog({ k: 'chess', by: name, bot: bot.name, label: bot.label, moves });
    for (const o of this.clients.values()) if (o.name === name) this.send(o, { t: 'me', me: this.me(o), note: gain ? `You beat ${bot.name}! +${gain} pts` : `You beat ${bot.name} again! (points only once a day per player)` });
    if (gain) this.broadcast({ t: 'board', board: this.board() });
  }

  // ---------------------------------------------------------------- three-point shooting (shared/Hoops.js)
  /** Best streaks, top 10: [{name, best, made, shots}]. */
  hoopTop() {
    return Object.entries(this.world.hoops).filter(([, s]) => s.best > 0).map(([name, s]) => ({ name, best: s.best, made: s.made, shots: s.shots }))
      .sort((a, b) => b.best - a.best || b.made / b.shots - a.made / a.shots).slice(0, 10);
  }
  onHoopShoot(c, m) {
    if (!c.name) return;
    const err = msg => this.send(c, { t: 'hoopShot', id: m.id, err: msg });
    const h = this.hoopList[m.hoop];
    const x = Number(m.x), z = Number(m.z), now = Date.now();
    if (!h || !Number.isFinite(x) || !Number.isFinite(z)) return err('No hoop there.');
    if (now - (c.lastShot || 0) < 1000) return err('Wait for your rebound.');
    // the shot has to come from where the player really stands, behind the line
    if (!c.st || now - c.st.at > 5000 || c.st.p[1] > 1 || Math.hypot(c.st.p[0] - x, c.st.p[2] - z) > 1.5) return err('Walk to your spot first.');
    if (!Hoops.isThree(h, x, z, 0.2)) return err('Step behind the three-point line.');
    c.lastShot = now;
    const r = Hoops.simulate(h, { x, z, ang: Number(m.ang), pow: Number(m.pow) });
    const s = this.world.hoops[c.name] || (this.world.hoops[c.name] = { best: 0, made: 0, shots: 0 });
    const top = this.hoopTop()[0];
    let streak = this.hoopStreak.get(c.name) || 0;
    s.shots++;
    if (r.made) { s.made++; streak++; } else { streak = 0; c.hoopRecordRun = false; }
    this.hoopStreak.set(c.name, streak);
    const pb = streak > s.best;
    if (pb) s.best = streak;
    this.dirty = true;
    this.send(c, { t: 'hoopShot', id: m.id, made: r.made, swish: r.swish, streak, best: s.best, pb });
    if (pb) {
      // a new school record (3 or more) is news for everyone: once when it is broken, then every 5 more in the same run;
      // any personal best changes the board
      if (streak >= 3 && (!top || streak > top.best) && (!c.hoopRecordRun || streak % 5 === 0)) {
        c.hoopRecordRun = true;
        this.addLog({ k: 'hoops', by: c.name, streak, where: h.room });
        this.log(`hoops: ${c.name} set the school record, ${streak} threes in a row in ${h.room}`);
      }
      this.broadcast({ t: 'hoopBoard', list: this.hoopTop() });
    }
  }

  onBoard(c, m) {
    if (!c.name) return;
    const fail = msg => this.send(c, { t: 'wbResult', ok: false, msg });
    const key = String(m.key || ''), rm = this.wbRooms.get(key);
    if (!rm) return fail('There is no whiteboard there.');
    if (!c.st || Date.now() - c.st.at > 5000) return fail('Walk up to the board first.');
    const [px, py, pz] = c.st.p, floor = py > this.map.F2Y - 1 ? 2 : 1;
    if (floor !== rm.floor || !this.map.pointInPoly(px, pz, rm.poly)) return fail(`Go into ${/^\d/.test(rm.name) ? 'Room ' + rm.name : rm.name} to write on its board.`);
    const now = Date.now();
    if (now - c.lastWb < WB_COOLDOWN_MS) return fail(`Wait ${Math.ceil((WB_COOLDOWN_MS - (now - c.lastWb)) / 1000)} s - the marker is drying.`);
    const lines = String(m.text || '').replace(/\r/g, '').split('\n').map(l => l.replace(/\s+$/, '')).slice(0, WB_LINES);
    const text = clean(lines.join('\n').replace(/\n+$/, ''), WB_LEN);
    if (text && !this.mod.allow(text, { kind: 'board', user: c.name, ip: c.ip })) return fail(WARN);
    c.lastWb = now;
    if (!text) delete this.world.boards[key];                  // wiped: the lesson comes back
    else this.aiBoard(key, this.world.boards[key] = { text, by: c.name, at: now });
    this.dirty = true;
    this.log(`${c.name} ${text ? 'wrote on' : 'wiped'} the board in ${rm.name}: ${JSON.stringify(text)}`);
    this.send(c, { t: 'wbResult', ok: true, key, wiped: !text });
    this.broadcast({ t: 'wb', key, b: this.world.boards[key] || null });
    if (text) this.addLog({ k: 'wb', by: c.name, where: rm.name, floor: rm.floor });
  }

  full(it) {
    const w = this.where(it);
    return { id: it.id, type: it.type, p: [it.x, it.y, it.z], creator: it.creator, message: it.message, createdAt: it.createdAt, where: w.name, floor: w.floor };
  }

  update() {
    if (++this.tick % SEND_EVERY) return;
    const now = Date.now(), list = [];
    this.each(c => { if (c.st && now - c.st.at < 5000) list.push(c.id, c.st.p[0], c.st.p[1], c.st.p[2], c.st.yaw, c.st.c); });
    if (!list.length) return;
    this.broadcast({ t: 'pl', p: list });
  }
}

module.exports = { HideServer };
