/**
 * Element Core client: connection + lobby, the 60 Hz input/prediction loop, snapshot handling
 * (reconciliation for our mage, 100 ms interpolation for everything else), the draft modal and
 * per-frame rendering.
 */
(function () {
  'use strict';
  const { C, CARD, PHASES, deriveStats } = window.ElementConst;
  const A = window.ElementAudio;
  const { Renderer } = window.ElementRenderer;
  const { InputHandler } = window.ElementInput;
  const { Predictor } = window.ElementPredictor;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STEP = 1000 / 60;
  const INTERP = 6;                       // ticks (100 ms) of interpolation delay for remote entities

  const canvas = $('game');
  const renderer = new Renderer(canvas);
  const input = new InputHandler(canvas, (x, y) => renderer.toWorld(x, y));

  // ---------- state
  let net = null, inMatch = false, side = 0, roomId = 0, names = ['CYAN', 'MAGENTA'];
  let stacks = [{}, {}], stats = [deriveStats({}), deriveStats({})];
  let snaps = [], latest = null, clock = null, evQueue = [], lastPhase = '', lastRound = 0, sinceFight = 99, koBy = -1;
  let predictor = new Predictor();
  let draft = null, overTimer = null, freezeT = 0, lastAim = 0;

  // ---------- networking
  function wsUrl() {
    const q = new URLSearchParams(location.search).get('ws');
    return q || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/game/element-ws`;
  }
  class Net {
    constructor() { this.handlers = {}; this.rtt = 0; }
    on(t, fn) { this.handlers[t] = fn; return this; }
    get open() { return this.ws && this.ws.readyState === 1; }
    connect() {
      return new Promise((resolve, reject) => {
        let opened = false;
        const ws = this.ws = new WebSocket(wsUrl());
        ws.onopen = () => { opened = true; const ping = () => this.send({ t: 'ping', c: performance.now() }); ping(); this.pinger = setInterval(ping, 1000); resolve(); };
        ws.onmessage = e => {
          let m; try { m = JSON.parse(e.data); } catch (err) { return; }
          if (m.t === 'pong') { const r = performance.now() - m.c; this.rtt = this.rtt ? this.rtt * 0.75 + r * 0.25 : r; }
          const h = this.handlers[m.t]; if (h) h(m);
        };
        ws.onclose = () => { clearInterval(this.pinger); if (!opened) reject(new Error('Could not reach the game server.')); else if (this.handlers.close) this.handlers.close(); };
        ws.onerror = () => {};
      });
    }
    send(m) { if (this.open) this.ws.send(JSON.stringify(m)); }
    close() { clearInterval(this.pinger); if (this.ws) { this.ws.onclose = null; try { this.ws.close(); } catch (e) {} } this.ws = null; }
  }

  // ---------- panels
  const PANELS = ['pMain', 'pLobby', 'pConn', 'pPause', 'pOver', 'pMsg'];
  function show(id) { $('overlay').classList.remove('hidden'); for (const p of PANELS) $(p).classList.toggle('show', p === id); syncInput(); }
  function hideOverlay() { $('overlay').classList.add('hidden'); syncInput(); }
  function current() { return $('overlay').classList.contains('hidden') ? null : PANELS.find(p => $(p).classList.contains('show')); }
  function syncInput() {
    input.enabled = inMatch && current() === null && !draft;
    canvas.classList.toggle('aiming', inMatch && current() === null);
  }
  let msgNext = 'pMain';
  function message(title, text, next = 'pMain') { $('msgTitle').textContent = title; $('msgText').textContent = text; msgNext = next; show('pMsg'); }
  function lobbyStatus(html, error = false) { $('lobbyStatus').innerHTML = html; $('lobbyStatus').classList.toggle('error', error); }
  function myName() { const v = $('nameInput').value.replace(/[\x00-\x1F<>]/g, '').trim().slice(0, 16); return v.length >= 2 ? v : ''; }

  async function ensureNet() {
    // one name for every game: the portal identity (identity.js); the token proves it to the server
    const id = await OIID.require();
    if (!id) return false;
    const fresh = await OIID.fresh();
    const name = id.name, token = fresh ? fresh.token : '';
    $('nameInput').value = name;
    A.unlock();
    if (net && net.open) { net.send({ t: 'hello', name, token }); return true; }
    show('pConn');
    net = new Net();
    net.on('welcome', m => { $('lobbyName').textContent = m.name; })
      .on('lobby', renderLobby)
      .on('invite', m => { $('inviteFrom').textContent = m.from; $('inviteBox').dataset.id = m.id; $('inviteBox').classList.add('show'); A.invite(); })
      .on('invite_over', m => { if ($('inviteBox').dataset.id == m.id) $('inviteBox').classList.remove('show'); })
      .on('challenging', m => { lobbyStatus(`<span class="spinner"></span>Challenging <b>${esc(m.name)}</b>… they have 30 seconds to accept.`); $('cancelRow').style.display = ''; })
      .on('challenge_over', m => {
        $('cancelRow').style.display = 'none';
        const why = { declined: `${esc(m.name)} declined your challenge.`, expired: `${esc(m.name)} didn't answer in time.`, offline: `${esc(m.name)} went offline.` }[m.why] || '';
        lobbyStatus(why, !!why);
      })
      .on('notice', m => lobbyStatus(esc(m.msg), true))
      .on('error', m => lobbyStatus(esc(m.msg), true))
      .on('match', startMatch)
      .on('s', onSnapshot)
      .on('draft', openDraft)
      .on('picked', m => { if (draft && m.side !== side) $('draftOpp').textContent = `${names[1 - side]} has chosen.`; })
      .on('stats', onStats)
      .on('end', m => {
        if (!inMatch) return;
        if (current() === 'pOver') { $('overStatus').textContent = 'Your opponent left.'; $('btnRematch').disabled = true; return; }
        endMatch();
        message('Match ended', m.why === 'disconnected' ? 'Your opponent disconnected. You win by forfeit.' : 'Your opponent left. You win by forfeit.', 'pLobby');
      })
      .on('rematch_ask', () => { $('overStatus').textContent = `${names[1 - side]} wants a rematch!`; })
      .on('close', () => { net = null; endMatch(); message('Disconnected', 'Lost the connection to the game server.', 'pMain'); });
    try {
      await net.connect();
      net.send({ t: 'hello', name, token });
      return true;
    } catch (e) {
      net = null;
      message('Server unavailable', e.message, 'pMain');
      return false;
    }
  }

  // "Playing now" on the portal: waiting in the lobby = anyone can click to challenge us
  let deepChallenge = (OIID.param('challenge') || '').slice(0, 16), lastLobbyPresence = 0;
  function lobbyPresence(m) {
    if (Date.now() - lastLobbyPresence > 15000) {
      lastLobbyPresence = Date.now();
      OIID.activity({ status: 'in the duel lobby - challenge me!', join: `element_core.html?challenge=${encodeURIComponent(OIID.name)}` });
    }
    if (deepChallenge) {
      const t = m.players.find(p => p.name.toLowerCase() === deepChallenge.toLowerCase());
      if (t && t.status !== 'busy') { deepChallenge = ''; net.send({ t: 'challenge', id: t.id }); }
    }
  }

  function renderLobby(m) {
    lobbyPresence(m);
    $('onlineCount').textContent = m.players.length;
    const invitedBy = $('inviteBox').classList.contains('show') ? $('inviteFrom').textContent : null;
    $('playerList').innerHTML = m.players.length ? m.players.map(p => {
      let right;
      if (p.status === 'busy') right = '<span class="tag">⚔ in a duel</span>';
      else if (p.status === 'pending' && p.name === invitedBy) right = '<span class="tag">challenging you</span>';
      else if (p.status === 'pending') right = '<span class="tag">⏳ busy</span>';
      else right = `<button data-id="${p.id}">Challenge</button>`;
      return `<div class="item"><span><i class="dot"></i>${esc(p.name)}</span>${right}</div>`;
    }).join('') : '<div class="empty">Nobody else is online right now.<br>Keep this lobby open, or warm up against a bot.</div>';
    $('playerList').querySelectorAll('button[data-id]').forEach(b => { b.onclick = () => net.send({ t: 'challenge', id: +b.dataset.id }); });
    const now = Date.now() / 1000;
    const ago = s => s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
    $('recentList').innerHTML = m.recent.length ? m.recent.map(r =>
      `<div class="item"><span><b class="${r.w === 0 ? 'win' : ''}">${esc(r.a)}</b> ${r.sa} : ${r.sb} <b class="${r.w === 1 ? 'win' : ''}">${esc(r.b)}</b>${r.ff ? ' <span class="muted">(forfeit)</span>' : ''}</span><span class="muted">${ago(Math.max(0, Math.round(now - r.ts)))} ago</span></div>`).join('')
      : '<div class="empty">No duels yet.</div>';
  }

  // ---------- match lifecycle
  function startMatch(m) {
    OIID.activity({ status: m.opp ? `duelling ${m.opp}` : 'in a duel', join: 'element_core.html' });
    side = m.side;
    roomId = m.room;
    names = m.names.slice();
    stacks = m.stacks; stats = stacks.map(deriveStats);
    snaps = []; latest = null; clock = null; evQueue = []; lastPhase = ''; lastRound = 0; koBy = -1;
    // input sequence numbers keep counting across matches: inputs still in flight from the last
    // match must never collide with (and block) the new match's numbers
    const seq = predictor.seq;
    predictor = new Predictor();
    predictor.seq = seq;
    closeDraft();
    clearTimeout(overTimer); overTimer = null;
    inMatch = true;
    $('inviteBox').classList.remove('show'); $('cancelRow').style.display = 'none'; lobbyStatus('');
    hideOverlay();
  }

  function endMatch() {
    inMatch = false; latest = null; snaps = []; closeDraft();
    clearTimeout(overTimer); overTimer = null;
    syncInput();
  }

  function decode(m) {
    const players = m.p.map(a => ({ x: a[0], y: a[1], aim: a[2], hp: a[3], shield: a[4], dashT: a[5], dashCd: a[6], dashX: a[7], dashY: a[8],
                                    slowT: a[9], fireCd: a[10], alive: !!a[11] }));
    const bolts = new Map();
    for (let i = 0; i < m.pr.length; i += 9) {
      bolts.set(m.pr[i], { id: m.pr[i], x: m.pr[i + 1], y: m.pr[i + 2], vx: m.pr[i + 3], vy: m.pr[i + 4], owner: m.pr[i + 5], r: m.pr[i + 6], flags: m.pr[i + 7], seq: m.pr[i + 8] });
    }
    const fires = [];
    for (let i = 0; i < m.fz.length; i += 5) fires.push({ id: m.fz[i], x: m.fz[i + 1], y: m.fz[i + 2], owner: m.fz[i + 3], life: m.fz[i + 4] });
    return { k: m.k, ack: m.a, phase: PHASES[m.ph], pt: m.pt, ct: m.ct, round: m.r, score: m.sc, players, bolts, fires,
             covers: m.cv, coverObjs: C.COVERS.map((c, i) => ({ ...c, hp: m.cv[i] })), ev: m.ev };
  }

  function onSnapshot(m) {
    if (!inMatch) return;
    const s = decode(m);
    if (latest && s.k <= latest.k) return;
    snaps.push(s); if (snaps.length > 30) snaps.shift();
    clock = clock === null || Math.abs(s.k - clock) > 30 ? s.k : clock + (s.k - clock) * 0.06;

    if (s.round !== lastRound) { lastRound = s.round; predictor.reset(s.players[side]); }
    const combat = s.phase === 'combat';
    predictor.reconcile(s.players[side], s.ack, s.coverObjs, stats[side], combat);
    for (const b of s.bolts.values()) if (b.owner === side && b.seq > predictor.confirmedSeq) predictor.confirmedSeq = b.seq;
    for (const e of s.ev) evQueue.push(e);

    if (s.phase !== lastPhase) {
      if (s.phase === 'combat') { sinceFight = 0; A.fight(); }
      if (s.phase === 'ko') { const dead = s.players.findIndex(p => !p.alive); koBy = dead >= 0 ? 1 - dead : -1; }
      if (s.phase === 'over' && !overTimer) overTimer = setTimeout(showOver, 1600);
      lastPhase = s.phase;
    }
    if (s.phase === 'countdown' && latest && Math.ceil(s.pt / 50) !== Math.ceil(latest.pt / 50) && s.pt > 0) A.beep();
    latest = s;
  }

  function showOver() {
    overTimer = null;
    if (!latest || latest.phase !== 'over') return;
    const won = latest.score[side] > latest.score[1 - side];
    $('overTitle').textContent = won ? '🏆 Victory' : '💀 Defeat';
    $('overScore').textContent = `${names[0]} ${latest.score[0]} : ${latest.score[1]} ${names[1]}`;
    $('overStatus').textContent = '';
    $('btnRematch').disabled = false;
    (won ? A.win : A.lose)();
    show('pOver');
  }

  // ---------- draft
  function openDraft(m) {
    stacks = m.stacks;
    draft = { offers: m.offers, deadline: performance.now() + m.time / 60 * 1000, total: m.time / 60 * 1000, picked: null };
    $('draftTitle').textContent = m.reason === 'opening' ? 'Choose your opening card'
      : m.reason === 'round' ? `Round ${m.round} over · choose a card` : 'Power surge · choose a card';
    $('draftOpp').textContent = '';
    $('draftCards').innerHTML = m.offers.map((id, i) => {
      const c = CARD[id], lvl = (stacks[side][id] | 0) + 1;
      return `<button class="card ${c.rarity}" data-id="${id}" style="--c:${c.color}">
        <span class="key">${i + 1}</span><span class="icon">${c.icon}</span>
        <span class="cname">${esc(c.name)}</span>
        <span class="desc">${esc(c.desc(lvl))}</span>
        <span class="lvl">${lvl > 1 ? `Lv ${lvl - 1} → ${lvl}` : 'NEW'} · ${c.rarity}</span></button>`;
    }).join('') || '<p>Every card is maxed out!</p>';
    $('draftCards').querySelectorAll('.card').forEach(b => { b.onclick = () => pickCard(b.dataset.id); });
    $('draft').classList.add('show');
    A.draft();
    syncInput();
  }

  function pickCard(id) {
    if (!draft || draft.picked) return;
    draft.picked = id;
    net.send({ t: 'pick', id });
    A.pick();
    $('draftCards').querySelectorAll('.card').forEach(b => b.classList.toggle(b.dataset.id === id ? 'chosen' : 'dim', true));
    $('draftOpp').textContent = $('draftOpp').textContent || `Waiting for ${names[1 - side]}…`;
  }

  function closeDraft() { draft = null; $('draft').classList.remove('show'); syncInput(); }

  function onStats(m) {
    stacks = m.stacks; stats = stacks.map(deriveStats);
    closeDraft();
    const mine = m.chosen[side] && CARD[m.chosen[side]], theirs = m.chosen[1 - side] && CARD[m.chosen[1 - side]];
    toast(`${mine ? `You: ${mine.icon} ${mine.name}` : ''}${theirs ? `   ·   ${esc(names[1 - side])}: ${theirs.icon} ${theirs.name}` : ''}`);
  }

  let toastTimer = null;
  function toast(text) { $('toast').innerHTML = text; $('toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3500); }

  input.onKey = e => {
    if (e.code === 'Escape') { togglePause(); return true; }
    if (draft && !draft.picked && /^Digit[1-3]$/.test(e.code)) { const id = draft.offers[+e.code.slice(5) - 1]; if (id) pickCard(id); return true; }
    return false;
  };

  function togglePause() {
    if (!inMatch) return;
    if (current() === null) show('pPause');
    else if (current() === 'pPause') hideOverlay();
  }

  // ---------- frame building: predicted self + interpolated world
  function interpolate(t) {
    let a = snaps[0], b = snaps[snaps.length - 1];
    if (t <= a.k) b = a;
    else if (t >= b.k) a = b;
    else for (let i = 0; i < snaps.length - 1; i++) if (snaps[i].k <= t && snaps[i + 1].k > t) { a = snaps[i]; b = snaps[i + 1]; break; }
    return { a, b, f: b.k === a.k ? 0 : (t - a.k) / (b.k - a.k) };
  }

  function buildView() {
    const base = { me: side, names, stacks, stats, labels: ['', ''], hud: inMatch, cursor: input.cursor, showCursor: inMatch && current() === null };
    if (!inMatch || !latest) {
      return { ...base, players: [null, null], bolts: [], fires: [], covers: C.COVERS.map(c => c.hp), phase: 'menu', score: [0, 0], round: 1, ct: 0, pt: 0 };
    }
    const t = clock - INTERP;
    const { a, b, f } = interpolate(t);
    const lerp = (x, y) => x + (y - x) * f;
    const other = 1 - side;
    const pa = a.players[other], pb = b.players[other];
    const remote = { ...pb, x: lerp(pa.x, pb.x), y: lerp(pa.y, pb.y), aim: pa.aim + Math.atan2(Math.sin(pb.aim - pa.aim), Math.cos(pb.aim - pa.aim)) * f };
    const pos = predictor.pos || latest.players[side];
    const self = { ...latest.players[side], ...(predictor.p || {}), x: pos.x, y: pos.y, aim: lastAim,
                   hp: latest.players[side].hp, shield: latest.players[side].shield, alive: latest.players[side].alive };
    const players = side === 0 ? [self, remote] : [remote, self];

    // bolts: enemy ones interpolated; ours pushed forward to "now"; plus not-yet-confirmed predicted casts
    const lead = INTERP + (net ? net.rtt / 2 / STEP : 0);
    const bolts = [];
    for (const nb of b.bolts.values()) {
      const ob = a.bolts.get(nb.id);
      let x = ob ? lerp(ob.x, nb.x) : nb.x - nb.vx * (b.k - t), y = ob ? lerp(ob.y, nb.y) : nb.y - nb.vy * (b.k - t);
      if (nb.owner === side) { x += nb.vx * lead; y += nb.vy * lead; }
      bolts.push({ ...nb, x, y, key: nb.id });
    }
    for (const pb2 of predictor.bolts) bolts.push({ ...pb2, owner: side, flags: 0, key: `p${pb2.seq}:${pb2.vx.toFixed(2)}` });

    return { ...base, players, bolts, fires: latest.fires, covers: latest.covers, phase: latest.phase, pt: latest.pt, ct: latest.ct,
             round: latest.round, score: latest.score, sinceFight, koBy, winner: latest.score[0] > latest.score[1] ? 0 : 1,
             labels: side === 0 ? ['YOU', ''] : ['', 'YOU'],
             status: `${Math.round(net ? net.rtt : 0)} ms · ${predictor.corrections} corrections · ${bolts.length} bolts` };
  }

  function playEvents(renderTick) {
    while (evQueue.length && evQueue[0][1] <= renderTick) {
      const e = evQueue.shift();
      renderer.event(e, side);
      switch (e[0]) {
        case 0: if (e[5] === side) A.hurt(); else A.hit(); break;
        case 1: A.block(); break;
        case 2: A.crumble(); break;
        case 3: A.zap(); break;
        case 4: A.kill(); freezeT = 0.3; break;
      }
    }
    if (evQueue.length > 400) evQueue.splice(0, evQueue.length - 200);
  }

  // ---------- main loop
  let acc = 0, last = performance.now(), wasDashing = false;
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += dt * 1000;
    let n = 0;
    while (acc >= STEP && n < 6) {
      if (inMatch && latest && net) {
        const origin = predictor.pos || latest.players[side];
        const inp = input.sample(origin);
        lastAim = inp.a;
        const fired = predictor.step(inp, latest.coverObjs, stats[side], latest.phase === 'combat');
        net.send({ t: 'i', r: roomId, s: inp.s, m: inp.m, a: inp.a, f: inp.f, d: inp.d });
        if (fired) A.shoot();
        predictor.advanceBolts(latest.coverObjs);
        const dashing = predictor.p && predictor.p.dashT > 0;
        if (dashing && !wasDashing) A.dash();
        wasDashing = dashing;
        sinceFight++;
      } else input.sample({ x: 0, y: 0 });
      acc -= STEP; n++;
    }
    if (n === 6) acc = 0;
    // hit-stop: hold the interpolation clock for a moment on a lethal hit
    if (clock !== null) { if (freezeT > 0) freezeT -= dt; else clock += dt * 60; }
    predictor.frame(dt);
    if (inMatch && latest) playEvents(clock - INTERP);
    if (draft) {
      const left = Math.max(0, draft.deadline - performance.now());
      $('draftBar').style.width = `${(left / draft.total) * 100}%`;
      $('draftTime').textContent = `${Math.ceil(left / 1000)}s`;
    }
    renderer.draw(buildView(), dt);
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
  $('btnOnline').onclick = async () => { if (await ensureNet()) { lobbyStatus(''); show('pLobby'); } };
  document.querySelectorAll('[data-level]').forEach(b => {
    b.onclick = async () => { if (await ensureNet()) net.send({ t: 'practice', level: b.dataset.level }); };
  });
  $('btnLobbyBack').onclick = () => { if (net) { net.close(); net = null; } show('pMain'); };
  $('btnConnCancel').onclick = () => { if (net) { net.close(); net = null; } show('pMain'); };
  $('btnAccept').onclick = () => { net.send({ t: 'respond', id: +$('inviteBox').dataset.id, accept: true }); $('inviteBox').classList.remove('show'); };
  $('btnDecline').onclick = () => { net.send({ t: 'respond', id: +$('inviteBox').dataset.id, accept: false }); $('inviteBox').classList.remove('show'); };
  $('btnCancelInvite').onclick = () => net.send({ t: 'cancel' });
  $('btnResume').onclick = () => hideOverlay();
  const leave = () => { if (net) net.send({ t: 'leave' }); endMatch(); show(net ? 'pLobby' : 'pMain'); };
  $('btnQuit').onclick = leave;
  $('btnOverBack').onclick = leave;
  $('btnRematch').onclick = () => { net.send({ t: 'rematch' }); $('btnRematch').disabled = true; $('overStatus').textContent = 'Waiting for your opponent…'; };
  $('btnMsgOk').onclick = () => show(msgNext === 'pLobby' && !(net && net.open) ? 'pMain' : msgNext);
  $('menuBtn').onclick = () => (inMatch ? togglePause() : show('pMain'));
  $('soundBtn').textContent = A.on ? '🔊' : '🔇';
  $('soundBtn').onclick = () => { $('soundBtn').textContent = A.toggle() ? '🔊' : '🔇'; };
  if (matchMedia('(pointer: coarse)').matches) $('touchNote').style.display = 'block';

  requestAnimationFrame(loop);
  window.ElementCore = {
    get state() {
      return { inMatch, side, phase: latest && latest.phase, round: latest && latest.round, score: latest && latest.score, tick: latest && latest.k,
               me: predictor.pos, server: latest && latest.players[side], opp: latest && latest.players[1 - side], bolts: latest ? latest.bolts.size : 0,
               corrections: predictor.corrections, pending: predictor.pending.length, rtt: net ? net.rtt : 0, stacks, draft: !!draft, covers: latest && latest.covers };
    },
  };
})();
