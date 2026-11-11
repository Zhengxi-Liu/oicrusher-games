/**
 * oicrusher.me game portal - one player name for every game.
 *
 *   <script src="identity.js?v=1"></script>            (add data-badge="off" to skip the corner badge)
 *
 *   OIID.me()              -> Promise<{name, registered, token} | null>   (cached; cookies decide)
 *   OIID.require()         -> Promise<identity>  asks for a name (guest / log in / register) if there is none
 *   OIID.require({registered: true})   same, but only an account will do: log in / register, no guest tab
 *   OIID.open()            opens the account dialog (switch name, log in / out)
 *   OIID.name / OIID.token / OIID.registered / OIID.admin     after me() resolved
 *   OIID.onChange(fn)      fn(identity) after logging in / out or picking a guest name
 *   OIID.activity({status, join, title})         what the portal's "Playing now" list shows; heartbeats every 20 s
 *   OIID.param('join')     query string helper for "click to join" links from the portal
 *
 * Accounts live in games.site_users (auth_api.php); guests keep their name in a signed cookie;
 * the token lets the Node game server trust the name (game_server/Identity.js).
 */
(function () {
  'use strict';
  if (window.OIID) return;
  const BASE = (document.currentScript && document.currentScript.src || location.href).replace(/[^/]*$/, '');
  const API = BASE + 'auth_api.php', PRESENCE = BASE + 'presence_api.php';
  const script = document.currentScript;
  const OLD_KEYS = ['vkName', 'rtName', 'hldmName', 'fencingName', 'elementName', 'fsName', 'hookTugName', 'gd_player_name', 'mudrunner_name',
                    'cannonName', 'oi_lb_name', 'gameLeaderboardName', 'leaderboardName', 'playerName'];

  let current, mePromise = null;
  const listeners = [];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function call(method, body, query = '') {
    const res = await fetch(API + query, method === 'GET' ? { credentials: 'same-origin', cache: 'no-store' }
      : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error(data.error || `Server error (${res.status})`);
    return data;
  }

  function set(data) {
    const id = data && data.identity ? { name: data.identity.name, registered: !!data.identity.registered, admin: !!data.identity.admin, token: data.token } : null;
    const changed = !current || !id || current.name !== id.name || current.registered !== id.registered;
    current = id;
    OIID.name = id ? id.name : ''; OIID.registered = !!(id && id.registered); OIID.admin = !!(id && id.admin); OIID.token = id ? id.token : '';
    OIID.tokenAt = Date.now();
    renderBadge();
    return changed;
  }

  function me(force) {
    if (!mePromise || force) {
      mePromise = call('GET', null, '?action=me').then(d => { set(d); return current; }).catch(e => { console.warn('identity', e); current = null; return null; });
    }
    return mePromise;
  }

  /** A fresh token (they last 12 h) right before connecting to a game server. */
  async function fresh() {
    if (!current || Date.now() - OIID.tokenAt > 3600 * 1000) await me(true);
    return current;
  }

  // ---------------------------------------------------------------- dialog
  const CSS = `
  .oiid-back { position: fixed; inset: 0; background: rgba(5,8,20,.72); z-index: 2147483000; display: flex; align-items: center; justify-content: center; font: 14px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; }
  .oiid-box { width: min(420px, 92vw); background: #141a2e; color: #e8ecff; border: 1px solid #3a4677; border-radius: 14px; box-shadow: 0 20px 60px rgba(0,0,0,.6); padding: 22px 24px; }
  .oiid-box h2 { margin: 0 0 4px; font-size: 20px; } .oiid-box p { margin: 0 0 14px; color: #aab3d8; font-size: 13px; }
  .oiid-tabs { display: flex; gap: 6px; margin-bottom: 14px; }
  .oiid-tabs button { flex: 1; padding: 8px; border-radius: 8px; border: 1px solid #3a4677; background: transparent; color: #aab3d8; cursor: pointer; font: inherit; }
  .oiid-tabs button.on { background: #3b5bdb; color: #fff; border-color: #3b5bdb; }
  .oiid-box label { display: block; font-size: 12px; color: #aab3d8; margin: 8px 0 4px; }
  .oiid-box input { width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 8px; border: 1px solid #3a4677; background: #0b1020; color: #fff; font: inherit; }
  .oiid-go { width: 100%; margin-top: 16px; padding: 11px; border: 0; border-radius: 8px; background: linear-gradient(90deg,#4c6ef5,#7950f2); color: #fff; font: 600 15px system-ui, sans-serif; cursor: pointer; }
  .oiid-go:disabled { opacity: .6; cursor: default; }
  .oiid-err { color: #ff8787; min-height: 1.4em; font-size: 13px; margin-top: 8px; }
  .oiid-row { display: flex; gap: 8px; margin-top: 14px; } .oiid-row button { flex: 1; padding: 9px; border-radius: 8px; border: 1px solid #3a4677; background: transparent; color: #e8ecff; cursor: pointer; font: inherit; }
  .oiid-x { float: right; background: none; border: 0; color: #aab3d8; font-size: 20px; cursor: pointer; line-height: 1; }
  .oiid-badge { position: fixed; left: 10px; bottom: 10px; z-index: 2147482000; font: 600 12px system-ui, sans-serif; color: #fff; background: rgba(10,14,30,.78);
                border: 1px solid rgba(255,255,255,.25); border-radius: 999px; padding: 5px 11px; cursor: pointer; backdrop-filter: blur(4px); max-width: 60vw;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: .8; transition: opacity .2s; }
  .oiid-badge:hover { opacity: 1; } .oiid-badge .g { color: #ffd43b; font-weight: 400; } .oiid-badge .r { color: #69db7c; }`;
  function ensureCss() {
    if (document.getElementById('oiid-css')) return;
    const st = document.createElement('style'); st.id = 'oiid-css'; st.textContent = CSS; document.head.appendChild(st);
  }

  let dialog = null;
  function open(opts = {}) {
    ensureCss();
    if (dialog) dialog.remove();
    return new Promise(resolve => {
      const back = document.createElement('div');
      back.className = 'oiid-back';
      dialog = back;
      // keep game hotkeys (space, WASD, Esc...) away from the game while typing here
      for (const t of ['keydown', 'keyup', 'keypress']) back.addEventListener(t, e => e.stopPropagation());
      const close = id => { back.remove(); if (dialog === back) dialog = null; resolve(id || current); };
      const accountOnly = !!opts.registered;          // this game needs an account: no guest names
      let tab = opts.tab || (current && current.registered ? 'account' : accountOnly ? 'login' : 'guest');
      const render = () => {
        const signedIn = current && current.registered;
        let body;
        if (tab === 'account' && current) {
          body = `<h2>${signedIn ? '✓ ' : ''}${esc(current.name)}</h2>
            <p>${signedIn ? 'Registered player. This name is used in every game and on every leaderboard.' : 'Guest name (saved in a cookie on this browser). Register to reserve it.'}</p>
            <div class="oiid-row">${signedIn ? '<button data-a="logout">Log out</button>' : '<button data-t="register">Register this name</button>'}
              ${accountOnly ? '' : '<button data-t="guest">Play under another name</button>'}</div>
            <div class="oiid-row"><button data-t="login">Log in to another account</button></div>`;
        } else {
          const guessed = (current && current.name) || oldName();
          body = `<h2>${opts.title || 'Who is playing?'}</h2><p>${opts.note ? esc(opts.note) : 'One name for every game, the leaderboards and the "Playing now" list on the portal.'}</p>
            <div class="oiid-tabs">${accountOnly ? '' : `<button data-t="guest" class="${tab === 'guest' ? 'on' : ''}">Guest</button>`}
              <button data-t="login" class="${tab === 'login' ? 'on' : ''}">Log in</button><button data-t="register" class="${tab === 'register' ? 'on' : ''}">Register</button></div>
            <form>${tab === 'guest'
              ? `<label>Name (no password, kept in a cookie)</label><input name="name" maxlength="16" autocomplete="nickname" value="${esc(guessed)}">`
              : `<label>Username</label><input name="username" maxlength="16" autocomplete="username" value="${esc(tab === 'register' ? guessed : '')}">
                 <label>Password${tab === 'register' ? ' (6+ characters)' : ''}</label><input name="password" type="password" autocomplete="${tab === 'register' ? 'new-password' : 'current-password'}">`}
            <button class="oiid-go" type="submit">${tab === 'guest' ? 'Play as guest' : tab === 'login' ? 'Log in' : 'Create account'}</button>
            <div class="oiid-err"></div></form>`;
        }
        back.innerHTML = `<div class="oiid-box">${opts.required && !current && !accountOnly ? '' : '<button class="oiid-x" title="Close">×</button>'}${body}</div>`;
        const x = back.querySelector('.oiid-x'); if (x) x.onclick = () => close();
        back.querySelectorAll('[data-t]').forEach(b => { b.onclick = e => { e.preventDefault(); tab = b.dataset.t; render(); }; });
        const lo = back.querySelector('[data-a="logout"]');
        if (lo) lo.onclick = async () => { await call('POST', { action: 'logout' }); set(null); fire(); tab = accountOnly ? 'login' : 'guest'; render(); };
        const form = back.querySelector('form');
        if (form) {
          const first = form.querySelector('input'); setTimeout(() => { first.focus(); first.select(); }, 30);
          form.onsubmit = async e => {
            e.preventDefault();
            const err = form.querySelector('.oiid-err'), go = form.querySelector('.oiid-go');
            const f = Object.fromEntries(new FormData(form).entries());
            go.disabled = true; err.textContent = '';
            try {
              const d = await call('POST', tab === 'guest' ? { action: 'guest', name: f.name } : { action: tab, username: f.username, password: f.password });
              mePromise = Promise.resolve(null);
              if (set(d)) fire();
              mePromise = Promise.resolve(current);
              close(current);
            } catch (ex) { err.textContent = ex.message; go.disabled = false; }
          };
        }
      };
      render();
      if (!opts.required) back.addEventListener('mousedown', e => { if (e.target === back) close(); });
      document.body.appendChild(back);
    });
  }

  function oldName() {
    for (const k of OLD_KEYS) { try { const v = (localStorage.getItem(k) || '').trim(); if (v.length >= 2) return v.slice(0, 16); } catch (e) {} }
    return '';
  }
  function fire() { for (const fn of listeners) { try { fn(current); } catch (e) { console.error(e); } } pulse(); }

  async function require(opts = {}) {
    const id = await me();
    if (id && (id.registered || !opts.registered)) return id;
    return open({ ...opts, required: true, tab: opts.registered ? 'login' : opts.tab });
  }

  // ---------------------------------------------------------------- corner badge
  let badge = null;
  function renderBadge() {
    if (!badge) return;
    badge.innerHTML = current ? `👤 ${esc(current.name)} ${current.registered ? '<span class="r">✓</span>' : '<span class="g">guest</span>'}` : '👤 Sign in';
    badge.title = current ? 'Your name in every game - click to change' : 'Pick a name / log in';
  }
  function mountBadge() {
    if (badge || (script && script.dataset.badge === 'off')) return;
    ensureCss();
    badge = document.createElement('div');
    badge.className = 'oiid-badge';
    badge.onclick = () => open({ tab: current ? 'account' : 'guest' });
    document.body.appendChild(badge);
    renderBadge();
  }

  // ---------------------------------------------------------------- presence ("Playing now" on the portal)
  const GAME = (location.pathname.split('/').pop() || 'index.html').replace(/\.html$/, '') || 'index';
  let sid = '';
  try { sid = sessionStorage.getItem('oiid_sid') || ''; } catch (e) {}
  if (!sid) { sid = Math.random().toString(36).slice(2) + Date.now().toString(36); try { sessionStorage.setItem('oiid_sid', sid); } catch (e) {} }
  let act = null, timer = null;
  const defaultTitle = () => (document.title.split(/\s[-–|·]\s/)[0] || GAME).trim().slice(0, 60);
  function pulse() {
    if (!act) return;                    // without a name the server still counts play time (anonymously)
    fetch(PRESENCE, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, keepalive: true,
                      body: JSON.stringify({ sid, game: GAME, title: act.title || defaultTitle(), status: act.status || '', join: act.join || GAME + '.html' }) }).catch(() => {});
  }
  function activity(a = {}) {
    act = Object.assign(act || {}, a);
    pulse();
    if (!timer) {
      timer = setInterval(() => { if (document.visibilityState !== 'hidden' || act.background) pulse(); }, 20000);
      addEventListener('pagehide', () => { try { navigator.sendBeacon(PRESENCE, JSON.stringify({ sid, leave: true })); } catch (e) {} });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pulse(); });
    }
  }

  const OIID = window.OIID = {
    name: '', registered: false, admin: false, token: '', tokenAt: 0, game: GAME,
    me, fresh, require, open: o => open(o || {}), activity,
    onChange(fn) { listeners.push(fn); },
    param(k) { return new URLSearchParams(location.search).get(k); },
  };

  const boot = () => {
    mountBadge();
    me().then(() => {
      // every game page shows up on the portal while open; games refine the status with OIID.activity()
      if (GAME !== 'index' && !(script && script.dataset.presence === 'off')) activity({});
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
