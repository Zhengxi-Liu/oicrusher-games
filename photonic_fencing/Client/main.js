/** UI flow, input, main loop: attract demo, practice vs bot, and online duels. */
(function () {
  'use strict';
  const S = window.FencingSim, { C, IN } = S;
  const A = window.FencingAudio;
  const { LocalEngine, OnlineEngine } = window.FencingEngine;
  const { Bot } = window.FencingBot;
  const { Net } = window.FencingNet;
  const $ = id => document.getElementById(id);
  const STEP = 1000 / 60;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const renderer = new window.FencingRender.Renderer($('game'));
  let engine = null, mode = 'demo', names = ['CYAN', 'MAGENTA'], labels = ['', ''];
  let net = null, side = 0, paused = false, overShown = false, overTimer = null;
  let seen = new Set(), lastPhase = '', lastRound = 0, allezRound = 0;

  // ---------- input
  const keys = Object.create(null);
  let touchBits = 0, tapped = 0;     // tapped: action keys pressed since the last tick (a tap shorter than a frame still counts)
  const MAP = [
    [IN.LEFT, ['KeyA', 'ArrowLeft']], [IN.RIGHT, ['KeyD', 'ArrowRight']],
    [IN.LUNGE, ['KeyJ', 'Space', 'KeyZ']], [IN.PARRY, ['KeyK', 'KeyX']], [IN.DODGE, ['KeyL', 'KeyC', 'ShiftLeft', 'ShiftRight']],
  ];
  function readBits() {
    if (paused || !inGame()) return 0;
    let b = touchBits | tapped;
    tapped = 0;
    for (const [bit, codes] of MAP) if (codes.some(c => keys[c])) b |= bit;
    return b;
  }
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') { if (e.key === 'Enter') e.target.dispatchEvent(new CustomEvent('enter')); return; }
    if (!e.repeat) for (const [bit, codes] of MAP) if (bit & S.ACTIONS && codes.includes(e.code)) tapped |= bit;
    keys[e.code] = true;
    A.unlock();
    if (inGame() && (e.code.startsWith('Arrow') || e.code === 'Space')) e.preventDefault();
    if (e.code === 'Escape') togglePause();
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; touchBits = 0; });
  document.querySelectorAll('#touch button').forEach(btn => {
    const bit = +btn.dataset.bit;
    const down = e => { e.preventDefault(); touchBits |= bit; tapped |= bit & S.ACTIONS; btn.classList.add('on'); A.unlock(); };
    const up = e => { e.preventDefault(); touchBits &= ~bit; btn.classList.remove('on'); };
    btn.addEventListener('pointerdown', down);
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) btn.addEventListener(ev, up);
  });

  // ---------- panels
  const PANELS = ['pMain', 'pLobby', 'pConn', 'pPause', 'pOver', 'pMsg'];
  function show(id) {
    $('overlay').classList.remove('hidden');
    for (const p of PANELS) $(p).classList.toggle('show', p === id);
  }
  function hideOverlay() { $('overlay').classList.add('hidden'); }
  function current() { return $('overlay').classList.contains('hidden') ? null : PANELS.find(p => $(p).classList.contains('show')); }
  function inGame() { return mode !== 'demo' && current() === null; }
  let msgNext = 'pMain';
  function message(title, text, next = 'pMain') { $('msgTitle').textContent = title; $('msgText').textContent = text; msgNext = next; show('pMsg'); }

  function myName() {
    const v = $('nameInput').value.replace(/[\x00-\x1F<>]/g, '').trim().slice(0, 16);
    return v.length >= 2 ? v : '';
  }

  // ---------- modes
  function resetFx() { seen = new Set(); lastPhase = ''; lastRound = 0; allezRound = 0; overShown = false; clearTimeout(overTimer); }

  function demo() {
    mode = 'demo'; paused = false;
    names = ['CYAN', 'MAGENTA']; labels = ['', ''];
    engine = new LocalEngine([new Bot(0, 'hard'), new Bot(1, 'normal')]);
    resetFx();
  }

  function practice(level) {
    A.unlock();
    mode = 'bot'; paused = false; side = 0;
    names = [myName() || 'YOU', `BOT · ${level.toUpperCase()}`]; labels = ['YOU', ''];
    engine = new LocalEngine([null, new Bot(1, level)]);
    engine.level = level;
    resetFx();
    hideOverlay();
  }

  // ---------- online
  async function goOnline() {
    // one name for every game: the portal identity (identity.js); the token proves it to the server
    const id = await OIID.require();
    if (!id) return false;
    const fresh = await OIID.fresh();
    const name = id.name, token = fresh ? fresh.token : '';
    $('nameInput').value = name;
    A.unlock();
    $('lobbyName').textContent = name;
    if (net && net.open) { net.send({ t: 'hello', name, token }); show('pLobby'); return; }
    show('pConn');
    net = new Net();
    net.on('welcome', m => { $('lobbyName').textContent = m.name; })
      .on('lobby', renderLobby)
      .on('invite', m => {
        $('inviteFrom').textContent = m.from; $('inviteBox').dataset.id = m.id; $('inviteBox').classList.add('show'); A.invite();
      })
      .on('invite_over', m => { if ($('inviteBox').dataset.id == m.id) $('inviteBox').classList.remove('show'); })
      .on('challenging', m => { lobbyStatus(`<span class="spinner"></span>Challenging <b>${esc(m.name)}</b>… they have 30 seconds to accept.`); $('cancelRow').style.display = ''; })
      .on('challenge_over', m => {
        $('cancelRow').style.display = 'none';
        const why = { declined: `${esc(m.name)} declined your challenge.`, expired: `${esc(m.name)} didn't answer in time.`,
                      offline: `${esc(m.name)} went offline.`, cancelled: '' }[m.why] || '';
        lobbyStatus(why, !!why);
      })
      .on('notice', m => lobbyStatus(esc(m.msg), true))
      .on('error', m => lobbyStatus(esc(m.msg), true))
      .on('match', startOnline)
      .on('s', m => { if (mode === 'online' && engine) engine.onSnapshot(m.s, m.ob, m.of || [], m.adv); })
      .on('end', m => {
        if (mode !== 'online') return;
        if (overShown) { $('overStatus').textContent = 'Your opponent left.'; $('btnRematch').disabled = true; return; }
        mode = 'lobby'; demo();
        message('Match ended', m.why === 'disconnected' ? 'Your opponent disconnected. You win by forfeit.' : 'Your opponent left the match. You win by forfeit.', 'pLobby');
      })
      .on('rematch_ask', () => { $('overStatus').textContent = `${names[1 - side]} wants a rematch!`; })
      .on('close', () => { net = null; demo(); message('Disconnected', 'Lost the connection to the game server.', 'pMain'); });
    try {
      await net.connect();
      net.send({ t: 'hello', name, token });
      lobbyStatus('');
      show('pLobby');
    } catch (e) {
      net = null;
      message('Server unavailable', e.message + ' Practice vs Bot still works offline.', 'pMain');
    }
  }

  function lobbyStatus(html, error = false) {
    $('lobbyStatus').innerHTML = html;
    $('lobbyStatus').classList.toggle('error', error);
  }

  // "Playing now" on the portal: waiting in the lobby = anyone can click to challenge us
  let deepChallenge = (OIID.param('challenge') || '').slice(0, 16), lastLobbyPresence = 0;
  function lobbyPresence(m) {
    if (Date.now() - lastLobbyPresence > 15000) {
      lastLobbyPresence = Date.now();
      OIID.activity({ status: 'in the duel lobby - challenge me!', join: `photonic_fencing.html?challenge=${encodeURIComponent(OIID.name)}` });
    }
    if (deepChallenge) {
      const t = m.players.find(p => p.name.toLowerCase() === deepChallenge.toLowerCase());
      if (t && t.status !== 'busy') { deepChallenge = ''; net.send({ t: 'challenge', id: t.id }); }
    }
  }

  function renderLobby(m) {
    lobbyPresence(m);
    const list = $('playerList');
    $('onlineCount').textContent = m.players.length;
    const invitedBy = $('inviteBox').classList.contains('show') ? $('inviteFrom').textContent : null;
    list.innerHTML = m.players.length ? m.players.map(p => {
      let right;
      if (p.status === 'busy') right = '<span class="tag">⚔ in a duel</span>';
      else if (p.name === invitedBy && p.status === 'pending') right = '<span class="tag">challenging you</span>';
      else if (p.status === 'pending') right = '<span class="tag">⏳ busy</span>';
      else right = `<button data-id="${p.id}">Challenge</button>`;
      return `<div class="item"><span><i class="dot"></i>${esc(p.name)}</span>${right}</div>`;
    }).join('') : '<div class="empty">Nobody else is online right now.<br>Keep this lobby open, or warm up against the bot.</div>';
    list.querySelectorAll('button[data-id]').forEach(b => { b.onclick = () => net.send({ t: 'challenge', id: +b.dataset.id }); });
    const now = Date.now() / 1000;
    const ago = s => s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
    $('recentList').innerHTML = m.recent.length ? m.recent.map(r =>
      `<div class="item"><span><b class="${r.w === 0 ? 'win' : ''}">${esc(r.a)}</b> ${r.sa} : ${r.sb} <b class="${r.w === 1 ? 'win' : ''}">${esc(r.b)}</b>${r.ff ? ' <span class="muted">(forfeit)</span>' : ''}</span><span class="muted">${ago(Math.max(0, Math.round(now - r.ts)))} ago</span></div>`).join('')
      : '<div class="empty">No duels yet.</div>';
  }

  function startOnline(m) {
    OIID.activity({ status: m.opp ? `duelling ${m.opp}` : 'in a duel', join: 'photonic_fencing.html' });
    side = m.side;
    names = m.names.slice(); labels = side === 0 ? ['YOU', ''] : ['', 'YOU'];
    engine = new OnlineEngine(side, msg => net.send(msg));
    const lead = Math.ceil((net.rtt || 80) / 2 / STEP) + 2;
    engine.begin(m.k, lead);
    mode = 'online'; paused = false;
    $('inviteBox').classList.remove('show'); $('cancelRow').style.display = 'none'; lobbyStatus('');
    resetFx();
    hideOverlay();
  }

  // ---------- pause / over
  function togglePause() {
    if (mode === 'demo') return;
    const cur = current();
    if (cur === null) {
      paused = mode === 'bot';
      $('pauseTitle').textContent = mode === 'online' ? 'Leave the duel?' : 'Paused';
      $('pauseHint').textContent = mode === 'online' ? 'The duel keeps running. Leaving counts as a forfeit.' : '';
      $('btnResume').textContent = mode === 'online' ? '⚔ Keep fighting' : '▶ Resume';
      show('pPause');
    } else if (cur === 'pPause') { paused = false; hideOverlay(); }
  }

  function leaveToMenu() {
    if (mode === 'online' && net) { net.send({ t: 'leave' }); demo(); show('pLobby'); return; }
    demo(); show('pMain');
  }

  function showOver(s) {
    overShown = true;
    const meWon = s.winner === side;
    let title = `${names[s.winner]} wins`;
    if (mode === 'bot') title = meWon ? '🏆 You beat the bot!' : '🤖 The bot wins';
    if (mode === 'online') title = meWon ? '🏆 Victory' : '💀 Defeat';
    $('overTitle').textContent = title;
    $('overScore').textContent = `${names[0]} ${s.score[0]} : ${s.score[1]} ${names[1]}`;
    $('overStatus').textContent = '';
    $('btnRematch').disabled = false;
    $('btnOverBack').textContent = mode === 'online' ? '← Back to lobby' : '← Main menu';
    if (mode !== 'demo') (meWon ? A.win : A.lose)();
    show('pOver');
  }

  // ---------- effects & sounds from simulation state
  const SOUND = { lunge: 'lunge', dodge: 'dodge', parry: 'parry', clash: 'clash', hit: 'hit', time: 'beep', whiff: 'whiff' };
  function effects(s) {
    for (const e of s.ev) {
      const key = `${e.k}:${e.tick}:${e.p}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (s.tick - e.tick > 20) continue;
      renderer.event(e, s);
      if (mode !== 'demo') A[SOUND[S.EVENTS[e.k]]]();
    }
    if (seen.size > 300) seen = new Set(s.ev.map(e => `${e.k}:${e.tick}:${e.p}`));
    if (mode === 'demo') return;
    if (s.phase === 'intro' && (s.pt === 45 || s.round !== lastRound)) { lastRound = s.round; A.beep(); }
    if (s.phase === 'fight' && allezRound !== s.round) { allezRound = s.round; A.allez(); }
    if (s.phase === 'over' && !overShown && !overTimer) overTimer = setTimeout(() => { overTimer = null; if (engine && engine.view.phase === 'over') showOver(engine.view); }, 1400);
    if (s.phase !== 'over' && overShown && lastPhase === 'over') { overShown = false; hideOverlay(); }
    lastPhase = s.phase;
  }

  // ---------- main loop: fixed 60 Hz simulation, render every frame
  let acc = 0, last = performance.now();
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const stepMs = STEP * (mode === 'online' ? engine.rateFactor() : 1);
    acc += dt * 1000;
    let n = 0;
    while (acc >= stepMs && n < 8) {
      if (mode === 'online') engine.tickLocal(readBits());
      else if (!paused) {
        engine.tick(readBits());
        if (mode === 'demo' && engine.view.phase === 'over' && engine.view.pt-- < -120) demo();
      }
      acc -= stepMs; n++;
    }
    if (n === 8) acc = 0;
    engine.frame(dt);
    const s = engine.view;
    effects(s);
    const status = mode === 'online' ? `${Math.round(net ? net.rtt : 0)} ms · ${engine.corrections} corrections` : mode === 'bot' ? 'PRACTICE · Esc to pause' : '';
    renderer.draw(s, { names, labels, smooth: engine.smooth, status }, dt);
    requestAnimationFrame(loop);
  }

  // ---------- wiring
  // the name box shows the portal identity (identity.js); clicking it opens the account dialog
  $('nameInput').readOnly = true;
  $('nameInput').title = 'Your name in every game - click to change';
  $('nameInput').placeholder = 'Pick a name';
  $('nameInput').onclick = () => OIID.open();
  OIID.me().then(id => { if (id) $('nameInput').value = id.name; });
  OIID.onChange(id => { $('nameInput').value = id ? id.name : ''; if (id && net && net.open) net.send({ t: 'hello', name: id.name, token: id.token }); });
  if (deepChallenge) $('btnOnline').textContent = '⚔ Challenge ' + deepChallenge;
  $('btnOnline').onclick = goOnline;
  document.querySelectorAll('[data-level]').forEach(b => { b.onclick = () => practice(b.dataset.level); });
  $('btnLobbyBack').onclick = () => { if (net) { net.close(); net = null; } show('pMain'); };
  $('btnConnCancel').onclick = () => { if (net) { net.close(); net = null; } show('pMain'); };
  $('btnAccept').onclick = () => { net.send({ t: 'respond', id: +$('inviteBox').dataset.id, accept: true }); $('inviteBox').classList.remove('show'); };
  $('btnDecline').onclick = () => { net.send({ t: 'respond', id: +$('inviteBox').dataset.id, accept: false }); $('inviteBox').classList.remove('show'); };
  $('btnCancelInvite').onclick = () => { net.send({ t: 'cancel' }); };
  $('btnResume').onclick = () => { paused = false; hideOverlay(); };
  $('btnQuit').onclick = leaveToMenu;
  $('btnRematch').onclick = () => {
    if (mode === 'online') { net.send({ t: 'rematch' }); $('btnRematch').disabled = true; $('overStatus').textContent = 'Waiting for your opponent…'; }
    else practice(engine.level || 'normal');
  };
  $('btnOverBack').onclick = leaveToMenu;
  $('btnMsgOk').onclick = () => show(msgNext === 'pLobby' && !(net && net.open) ? 'pMain' : msgNext);
  $('menuBtn').onclick = () => { if (mode === 'demo') show('pMain'); else togglePause(); };
  $('soundBtn').textContent = A.on ? '🔊' : '🔇';
  $('soundBtn').onclick = () => { $('soundBtn').textContent = A.toggle() ? '🔊' : '🔇'; };

  demo();
  requestAnimationFrame(loop);
  window.PhotonicFencing = {
    get state() { const s = engine.view; return { mode, side, phase: s.phase, tick: s.tick, score: s.score.slice(), round: s.round, f: s.f.map(f => ({ x: f.x, st: f.st, t: f.t })), ev: s.ev.map(e => S.EVENTS[e.k] + '@' + e.tick + ':p' + e.p), rtt: net ? net.rtt : 0, corrections: engine.corrections || 0, adv: engine.adv }; },
  };
})();
