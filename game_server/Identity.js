'use strict';
/**
 * Player names on the WebSocket lobbies come from the portal's identity system (game/identity_lib.php):
 * the browser gets a signed token from auth_api.php and sends it in 'hello'. A valid token fixes the
 * name, so nobody can play under a registered player's name.
 *
 * Secret: env OI_ID_SECRET, else /etc/oicrusher/identity.secret (shared with PHP). Without a secret
 * (local development) plain typed names are still accepted.
 */
const crypto = require('crypto');
const fs = require('fs');

let SECRET = process.env.OI_ID_SECRET || '';
if (!SECRET) { try { SECRET = fs.readFileSync(process.env.OI_ID_SECRET_FILE || '/etc/oicrusher/identity.secret', 'utf8').trim(); } catch (e) {} }
const STRICT = !!SECRET;

// Every game's 'hello' goes through resolve(), so this one hook keeps inappropriate names out of all of them.
// server.js plugs in the keyword filter: fn(name, m) -> true when the name is fine (m._ip / m._game say who and where).
let nameFilter = null;
const setNameFilter = fn => { nameFilter = fn; };
const NAME_BLOCKED = 'Your name contains language that is not allowed here, so you cannot play. Change it on the game portal and try again. 你的名字含有不允许的词语，请在游戏门户修改后再进入。';
const KEY = SECRET || 'dev-only-secret';

const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const cleanName = n => String(n || '').replace(/[\x00-\x1F\x7F<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);

function verify(token) {
  if (typeof token !== 'string' || token.length > 600) return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const payload = token.slice(0, dot), sig = token.slice(dot + 1);
  const want = b64url(crypto.createHmac('sha256', KEY).update(payload).digest());
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  let d;
  try { d = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch (e) { return null; }
  if (!d || typeof d.n !== 'string' || !(d.e > Date.now() / 1000)) return null;
  const name = cleanName(d.n);
  return name.length >= 2 ? { name, registered: !!d.r, admin: !!d.a } : null;
}

/** The name a 'hello' message may use: {name, registered} or {error}. */
function resolve(m) {
  const v = verify(m && m.token);
  if (v) return v.admin || !nameFilter || nameFilter(v.name, m) ? v : { error: NAME_BLOCKED, blocked: true };
  if (STRICT) return { error: 'Please pick your name on the game portal (refresh the page).' };
  const name = cleanName(m && m.name);
  if (name.length < 2) return { error: 'Name must be 2-16 characters' };
  if (nameFilter && !nameFilter(name, m)) return { error: NAME_BLOCKED, blocked: true };
  return { name, registered: false };
}

module.exports = { resolve, verify, STRICT, setNameFilter };
