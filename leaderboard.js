// Shared Top 20 leaderboard popup, backed by scores_api.php.
//
//   const lb = GameLeaderboard({ game: 'flip_sizzle', title: 'Top 20 Flippers', format: s => s + ' flips' });
//   lb.open();          // just show the board
//   lb.gameOver(score); // at the end of a run: if the score makes the Top 20, pop up and save it
//
// The name is the player's portal identity (identity.js: registered account or guest cookie); the
// server takes it from the cookies too. Pages without identity.js fall back to typing a name.
// Optional: onOpen / onClose callbacks (e.g. to pause a real-time game).
(function () {
  const API = 'scores_api.php';                       // same origin, so the identity cookies go along
  const LB_SIZE = 20;
  const NAME_KEY = 'gameLeaderboardName';

  const CSS = `
  .glb-ov { position: fixed; inset: 0; z-index: 100000; display: none; align-items: center; justify-content: center;
    padding: 16px; background: rgba(5, 8, 15, 0.72); backdrop-filter: blur(3px); font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; }
  .glb-ov.show { display: flex; }
  .glb-panel { width: 100%; max-width: 420px; max-height: calc(100vh - 32px); overflow-y: auto; padding: 20px 18px 16px;
    border-radius: 16px; background: #161b29; border: 1px solid #2f3852; box-shadow: 0 20px 60px rgba(0,0,0,0.6); color: #e8ecf5; text-align: center; }
  .glb-panel h2 { margin: 0 0 4px; font-size: 20px; color: #ffcf5a; letter-spacing: 0.5px; }
  .glb-msg { margin: 6px 0 0; min-height: 1em; font-size: 14px; color: #b9c2d8; }
  .glb-entry { margin: 12px 0 0; padding: 12px; border-radius: 12px; background: rgba(95,209,111,0.12); border: 1px solid rgba(95,209,111,0.5); }
  .glb-entry p { margin: 0 0 8px; font-weight: 700; color: #b9f5c2; }
  .glb-entry input { width: 60%; max-width: 220px; padding: 9px 12px; border-radius: 20px; border: 2px solid #3d4766; background: #eef1f8;
    color: #141824; font-size: 16px; font-family: inherit; font-weight: 700; outline: none; user-select: text; -webkit-user-select: text; }
  .glb-status { margin-top: 6px; min-height: 1em; font-size: 13px; color: #ffb3a8; }
  .glb-list { margin: 14px 0 0; text-align: left; }
  .glb-row { display: flex; align-items: center; gap: 10px; padding: 6px 10px; margin: 4px 0; border-radius: 8px;
    background: rgba(255,255,255,0.05); border-left: 3px solid #3d4766; font-size: 14px; }
  .glb-row.top3 { background: rgba(255,207,90,0.12); border-left-color: #ffcf5a; }
  .glb-row.me { background: rgba(95,209,111,0.25); border-left-color: #5fd16f; }
  .glb-rank { min-width: 34px; font-weight: 800; color: #9aa4bf; }
  .glb-row.top3 .glb-rank { color: #ffcf5a; }
  .glb-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .glb-score { font-weight: 800; color: #ffd66b; white-space: nowrap; }
  .glb-empty { text-align: center; color: #9aa4bf; font-size: 14px; padding: 8px; }
  .glb-btn { display: inline-block; margin: 8px 4px 0; padding: 10px 22px; border-radius: 30px; border: none; cursor: pointer;
    font: 800 15px system-ui, -apple-system, 'Segoe UI', sans-serif; color: #1d1405; background: linear-gradient(180deg, #ffd66b, #f39a1d); }
  .glb-btn.alt { color: #e8ecf5; background: #2c3550; }
  .glb-btn:disabled { opacity: 0.6; cursor: default; }`;

  function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
  function getName() { try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; } }
  function setName(n) { try { localStorage.setItem(NAME_KEY, n); } catch (e) { /* ignore */ } }

  let styled = false;

  window.GameLeaderboard = function (opts) {
    const game = opts.game;
    const title = opts.title || '🏆 Top 20';
    const format = opts.format || (s => String(s));
    const isTouch = matchMedia('(pointer: coarse)').matches;

    if (!styled) { const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st); styled = true; }
    const ov = document.createElement('div');
    ov.className = 'glb-ov';
    ov.innerHTML = `<div class="glb-panel" role="dialog" aria-modal="true" aria-label="Leaderboard">
        <h2>${escapeHtml(title)}</h2>
        <p class="glb-msg"></p>
        <div class="glb-entry" style="display:none">
          <p>🎉 You made the Top 20! Enter your name:</p>
          <input type="text" maxlength="20" placeholder="Your name" autocomplete="nickname">
          <button class="glb-btn glb-submit" type="button">Submit</button>
          <div class="glb-status"></div>
        </div>
        <div class="glb-list"></div>
        <button class="glb-btn alt glb-close" type="button">Close</button>
      </div>`;
    document.body.appendChild(ov);
    const $ = s => ov.querySelector(s);
    const msg = $('.glb-msg'), entry = $('.glb-entry'), inp = $('input'), status = $('.glb-status'),
      submitBtn = $('.glb-submit'), list = $('.glb-list');

    let board = null, myId = null, pendingScore = 0, submitting = false, isOpen = false;

    function render() {
      if (board === null) { list.innerHTML = '<div class="glb-empty">Loading…</div>'; return; }
      if (board === false) { list.innerHTML = '<div class="glb-empty">Leaderboard unavailable right now.</div>'; return; }
      const mine = window.OIID && OIID.name ? OIID.name.toLowerCase() : '';
      list.innerHTML = board.map((r, i) => `<div class="glb-row ${i < 3 ? 'top3' : ''} ${r.id === myId || (mine && String(r.name).toLowerCase() === mine && myId === null) ? 'me' : ''}">
          <span class="glb-rank">${i < 3 ? ['🥇', '🥈', '🥉'][i] : '#' + (i + 1)}</span>
          <span class="glb-name">${escapeHtml(r.name)}</span>
          <span class="glb-score">${escapeHtml(format(r.score))}</span></div>`).join('')
        || '<div class="glb-empty">No scores yet. Be the first!</div>';
    }
    async function load() {
      try {
        const res = await fetch(API + '?game=' + encodeURIComponent(game), { cache: 'no-store' });
        if (!res.ok) throw new Error(res.status);
        board = (await res.json()).leaderboard || [];
      } catch (e) {
        if (board === null) board = false;
      }
      render();
    }
    function qualifies(s) {
      if (!(s > 0)) return false;
      if (!board) return true; // unknown: let the server decide
      return board.length < LB_SIZE || s > board[board.length - 1].score;
    }
    function show() {
      if (isOpen) return;
      isOpen = true;
      ov.classList.add('show');
      if (opts.onOpen) opts.onOpen();
    }
    function close() {
      if (!isOpen) return;
      isOpen = false;
      ov.classList.remove('show');
      entry.style.display = 'none';
      if (opts.onClose) opts.onClose();
    }
    async function submit(asName) {
      if (submitting) return;
      const name = asName || inp.value.trim();
      if (!name) { status.textContent = 'Please enter your name!'; inp.focus(); return; }
      submitting = true; submitBtn.disabled = true; inp.disabled = true; status.textContent = 'Submitting…';
      try {
        const res = await fetch(API, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game, score: pendingScore, name }) });
        if (res.status === 403) { const d = await res.json().catch(() => ({})); status.textContent = d.error || 'That name is taken.'; entry.style.display = ''; submitBtn.disabled = false; inp.disabled = false; return; }
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        setName(name);
        myId = data.id;
        entry.style.display = 'none';
        msg.textContent = `🎉 ${name}, you're #${data.rank} on the leaderboard!`;
        await load();
      } catch (e) {
        status.textContent = 'Could not submit. Check your connection and try again.';
        submitBtn.disabled = false; inp.disabled = false;
      } finally {
        submitting = false;
      }
    }

    submitBtn.addEventListener('click', () => submit());
    $('.glb-close').addEventListener('click', close);
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    // keep typing / Enter / Space from reaching the game's own key handlers
    ov.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') close();
      else if (e.key === 'Enter' && e.target === inp) submit();
    });
    ov.addEventListener('keyup', e => e.stopPropagation());

    return {
      open() {
        msg.textContent = '';
        entry.style.display = 'none';
        render();
        show();
        load();
      },
      // Returns a promise that resolves to true if the name prompt was shown.
      async gameOver(score) {
        score = Math.floor(score);
        myId = null;
        await load();
        if (!qualifies(score)) return false;
        pendingScore = score;
        msg.textContent = 'Your score: ' + format(score);
        status.textContent = '';
        submitBtn.disabled = false; inp.disabled = false;
        if (window.OIID) {
          // one name everywhere: save under the portal identity (ask for one first if there is none)
          entry.style.display = 'none';
          show();
          const id = await OIID.require({ title: '🎉 Top 20! Who are you?' });
          if (id) { msg.textContent = `Saving ${format(score)} for ${id.name}…`; await submit(id.name); return true; }
        }
        inp.value = getName();
        entry.style.display = '';
        show();
        if (!isTouch) setTimeout(() => inp.focus(), 50);
        return true;
      },
      close,
    };
  };
})();
