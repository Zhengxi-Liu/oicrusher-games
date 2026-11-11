<?php
// Play-time report for the game portal (admins only). Data: report/api.php; recorded by presence_api.php.
require __DIR__ . '/_auth.php';
$id = admin_gate_page('admin', 'Play-time report');
admin_head('Play-time report', $id, 'report');
?>
<style>
  .filters { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 16px; }
  .seg { display: inline-flex; border: 1px solid var(--border); border-radius: 9px; overflow: hidden; background: var(--surface-1); }
  .seg button { font: inherit; border: 0; background: transparent; color: var(--text-secondary); padding: 6px 12px; cursor: pointer; border-right: 1px solid var(--border); }
  .seg button:last-child { border-right: 0; }
  .seg button.on { background: var(--surface-2); color: var(--text-primary); font-weight: 600; }
  .filters .grow { flex: 1; }
  .filters .grp { display: inline-flex; gap: 8px; align-items: center; }
  .tile .v.long { font-size: 19px; line-height: 1.25; margin-top: 6px; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .tile .k { color: var(--text-secondary); font-size: 12px; }
  .tile .v { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; margin-top: 2px; }
  .tile .s { color: var(--text-muted); font-size: 12px; }
  .charts { display: grid; grid-template-columns: 3fr 2fr; gap: 12px; margin-bottom: 16px; }
  @media (max-width: 900px) { .charts { grid-template-columns: 1fr; } }
  .card h2 { font-size: 14px; margin-bottom: 10px; display: flex; align-items: baseline; gap: 8px; }
  .card h2 small { color: var(--text-muted); font-weight: 400; }
  svg text { fill: var(--text-secondary); font-size: 11px; }
  .gridline { stroke: var(--border); stroke-width: 1; }
  .bar { fill: var(--series-1); }
  .bar:hover, .bar.hot { opacity: .8; }
  .hit { fill: transparent; cursor: pointer; }
  #tip { position: fixed; pointer-events: none; background: var(--surface-1); color: var(--text-primary); border: 1px solid var(--border); border-radius: 8px;
         padding: 6px 10px; font-size: 12px; box-shadow: 0 6px 18px rgba(0,0,0,.18); display: none; z-index: 10; }
  #tip b { display: block; }
  .tablewrap { overflow-x: auto; }
  th.sort { cursor: pointer; user-select: none; } th.sort.on { color: var(--text-primary); }
  tr.row { cursor: pointer; } tr.row:hover td { background: var(--surface-2); }
  .meter { display: inline-block; height: 8px; border-radius: 0 4px 4px 0; background: var(--series-1); vertical-align: middle; margin-right: 8px; }
  .drill { margin-top: 16px; display: none; } .drill.show { display: block; }
  .drill .close { float: right; }
  .empty { color: var(--text-muted); padding: 28px; text-align: center; }
  .note { color: var(--text-muted); font-size: 12px; margin-top: 10px; }
</style>
<main>
  <div class="filters" role="group" aria-label="Filters">
    <div class="seg" id="range">
      <button data-d="0">Today</button><button data-d="6">7 days</button><button data-d="29" class="on">30 days</button><button data-d="89">90 days</button><button data-d="all">All time</button>
    </div>
    <input type="date" id="from" aria-label="From"> <span class="muted">to</span> <input type="date" id="to" aria-label="To">
    <select id="who" aria-label="Players">
      <option value="all">All players</option><option value="registered">Registered only</option><option value="guests">Guests only</option><option value="named" selected>Registered + guests (no anonymous)</option>
    </select>
    <span class="grow"></span>
    <span class="grp"><span class="muted">Group by</span>
    <div class="seg" id="group">
      <button data-g="user" class="on">Player</button><button data-g="game">Game</button><button data-g="pair">Player × Game</button><button data-g="day">Day</button>
    </div></span>
  </div>

  <div class="tiles" id="tiles"></div>

  <div class="charts">
    <div class="card"><h2>Play time per day <small id="trendSub"></small></h2><div id="trend"></div></div>
    <div class="card"><h2 id="rankTitle">Top players</h2><div id="rank"></div></div>
  </div>

  <div class="card">
    <h2><span id="tableTitle">Players</span> <small id="tableSub"></small>
      <span style="margin-left:auto;display:flex;gap:8px"><input id="search" placeholder="Filter…" aria-label="Filter rows"><button class="btn ghost small" id="csv">Export CSV</button></span></h2>
    <div class="tablewrap"><table id="table"></table></div>
  </div>

  <div class="card drill" id="drill"></div>
  <p class="note">Play time is counted from game-page heartbeats (every 20 s while the page is visible; hidden or closed tabs don't count).
     "(anonymous)" is time from visitors who have not picked a name yet. Recording started when this report was installed.</p>
</main>
<div id="tip"></div>
<script>
(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = s => s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.floor(s / 3600)}h ${String(Math.round(s % 3600 / 60)).padStart(2, '0')}m`;
  const hrs = s => (s / 3600).toFixed(2);
  const iso = d => d.toISOString().slice(0, 10);
  let data = null, group = 'user', sortKey = 'seconds', sortDir = -1, drill = null;

  // ---------- filters
  const setRange = d => {
    const today = new Date();
    $('to').value = iso(today);
    $('from').value = d === 'all' ? '2026-01-01' : iso(new Date(today.getTime() - d * 86400000));
    document.querySelectorAll('#range button').forEach(b => b.classList.toggle('on', b.dataset.d === String(d)));
    load();
  };
  document.querySelectorAll('#range button').forEach(b => { b.onclick = () => setRange(b.dataset.d === 'all' ? 'all' : +b.dataset.d); });
  $('from').onchange = $('to').onchange = () => { document.querySelectorAll('#range button').forEach(b => b.classList.remove('on')); load(); };
  $('who').onchange = render;
  $('search').oninput = renderTable;
  document.querySelectorAll('#group button').forEach(b => { b.onclick = () => {
    group = b.dataset.g; sortKey = group === 'day' ? 'key' : 'seconds'; sortDir = -1; drill = null;
    document.querySelectorAll('#group button').forEach(x => x.classList.toggle('on', x === b));
    render();
  }; });

  async function load() {
    $('tiles').innerHTML = '<div class="empty">Loading…</div>';
    const r = await fetch(`api.php?from=${$('from').value}&to=${$('to').value}`, { cache: 'no-store' });
    if (!r.ok) { $('tiles').innerHTML = '<div class="empty">Could not load the report.</div>'; return; }
    data = await r.json();
    render();
  }

  // ---------- aggregation (rows: [day, name, game, registered, seconds, sessions])
  const title = g => (data.titles[g] || g).replace(/\s*[:–-].*$/, '');
  function rows() {
    const who = $('who').value;
    return data.rows.filter(r => who === 'all' || (who === 'registered' && r[3]) || (who === 'guests' && !r[3] && r[1] !== '(anonymous)')
                              || (who === 'named' && r[1] !== '(anonymous)'));
  }
  function aggregate(list, keyOf, labelOf) {
    const m = new Map();
    for (const r of list) {
      const k = keyOf(r);
      let a = m.get(k);
      if (!a) m.set(k, a = { key: k, label: labelOf(r), seconds: 0, sessions: 0, players: new Set(), games: new Set(), days: new Set(), last: '', reg: 0, byGame: new Map() });
      a.seconds += r[4]; a.sessions += r[5]; a.players.add(r[1]); a.games.add(r[2]); a.days.add(r[0]);
      if (r[0] > a.last) a.last = r[0];
      a.reg = a.reg || r[3];
      a.byGame.set(r[2], (a.byGame.get(r[2]) || 0) + r[4]);
    }
    return [...m.values()].map(a => ({ ...a, nPlayers: a.players.size, nGames: a.games.size, nDays: a.days.size,
      fav: [...a.byGame.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] || '', perPlayer: a.players.size ? a.seconds / a.players.size : 0,
      perSession: a.sessions ? a.seconds / a.sessions : 0 }));
  }
  const keyers = {
    user: [r => r[1].toLowerCase(), r => r[1]],
    game: [r => r[2], r => title(r[2])],
    pair: [r => r[1].toLowerCase() + '|' + r[2], r => `${r[1]} · ${title(r[2])}`],
    day:  [r => r[0], r => r[0]],
  };
  const kind = a => a.label === '(anonymous)' ? '<span class="tag">anonymous</span>'
    : a.reg ? `<span class="tag reg">${esc(data.accounts[a.label.toLowerCase()] || 'registered')}</span>` : '<span class="tag">guest</span>';

  const COLS = {
    user: [['label', 'Player'], ['type', 'Type'], ['seconds', 'Play time', 1], ['sessions', 'Sessions', 1], ['nGames', 'Games', 1], ['nDays', 'Days active', 1], ['fav', 'Favourite game'], ['last', 'Last played']],
    game: [['label', 'Game'], ['seconds', 'Play time', 1], ['sessions', 'Sessions', 1], ['nPlayers', 'Players', 1], ['perPlayer', 'Per player', 1], ['perSession', 'Per session', 1], ['last', 'Last played']],
    pair: [['label', 'Player · Game'], ['seconds', 'Play time', 1], ['sessions', 'Sessions', 1], ['nDays', 'Days', 1], ['perSession', 'Per session', 1], ['last', 'Last played']],
    day:  [['key', 'Day'], ['seconds', 'Play time', 1], ['sessions', 'Sessions', 1], ['nPlayers', 'Players', 1], ['nGames', 'Games', 1]],
  };
  const cell = (a, k) => k === 'seconds' || k === 'perPlayer' || k === 'perSession' ? fmt(Math.round(a[k])) : k === 'type' ? kind(a) : k === 'fav' ? esc(a.fav ? title(a.fav) : '') : esc(a[k]);

  // ---------- render
  function render() {
    if (!data) return;
    const list = rows();
    const total = list.reduce((s, r) => s + r[4], 0), sessions = list.reduce((s, r) => s + r[5], 0);
    const players = new Set(list.map(r => r[1].toLowerCase())), games = new Set(list.map(r => r[2]));
    const byGame = aggregate(list, keyers.game[0], keyers.game[1]).sort((a, b) => b.seconds - a.seconds);
    $('tiles').innerHTML = [
      ['Total play time', fmt(total), `${hrs(total)} hours`],
      ['Players', players.size, `${new Set(list.filter(r => r[3]).map(r => r[1].toLowerCase())).size} registered`],
      ['Sessions', sessions, sessions ? `avg ${fmt(Math.round(total / sessions))} each` : ''],
      ['Avg per player', players.size ? fmt(Math.round(total / players.size)) : '-', `${games.size} games played`],
      ['Most played game', byGame[0] ? esc(byGame[0].label) : '-', byGame[0] ? fmt(byGame[0].seconds) : ''],
      ['Online now', data.online, 'open game pages'],
    ].map(([k, v, s]) => `<div class="card tile"><div class="k">${k}</div><div class="v ${String(v).length > 12 ? 'long' : ''}">${v}</div><div class="s">${s}</div></div>`).join('');
    drawTrend(list);
    drawRank(list);
    renderTable();
    renderDrill();
  }

  function currentGroups() {
    const [kf, lf] = keyers[group];
    let g = aggregate(rows(), kf, lf);
    const q = $('search').value.trim().toLowerCase();
    if (q) g = g.filter(a => a.label.toLowerCase().includes(q));
    const dir = sortDir;
    g.sort((a, b) => { const x = a[sortKey], y = b[sortKey]; return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir; });
    return g;
  }

  function renderTable() {
    if (!data) return;
    const g = currentGroups(), cols = COLS[group], max = Math.max(1, ...g.map(a => a.seconds));
    $('tableTitle').textContent = { user: 'Players', game: 'Games', pair: 'Player × Game', day: 'Days' }[group];
    $('tableSub').textContent = `${g.length} rows · ${$('from').value} → ${$('to').value}`;
    if (!g.length) { $('table').innerHTML = '<tr><td class="empty">No play time recorded in this range yet.</td></tr>'; return; }
    $('table').innerHTML = `<tr>${cols.map(([k, l, num]) => `<th class="sort ${num ? 'num' : ''} ${k === sortKey ? 'on' : ''}" data-k="${k}">${l}${k === sortKey ? (sortDir < 0 ? ' ↓' : ' ↑') : ''}</th>`).join('')}</tr>` +
      g.map(a => `<tr class="row" data-k="${esc(a.key)}">${cols.map(([k, , num]) => `<td class="${num ? 'num' : ''}">${k === 'seconds'
        ? `<span class="meter" style="width:${Math.max(2, a.seconds / max * 90)}px"></span>${fmt(a.seconds)}` : cell(a, k)}</td>`).join('')}</tr>`).join('');
    $('table').querySelectorAll('th.sort').forEach(th => { th.onclick = () => { const k = th.dataset.k; sortDir = sortKey === k ? -sortDir : (k === 'label' || k === 'key' ? 1 : -1); sortKey = k; renderTable(); }; });
    $('table').querySelectorAll('tr.row').forEach(tr => { tr.onclick = () => { if (group === 'user' || group === 'game') { drill = { group, key: tr.dataset.k }; renderDrill(); $('drill').scrollIntoView({ behavior: 'smooth' }); } }; });
  }

  // ---------- charts (single series: one hue; hover tooltips)
  const tip = $('tip');
  function showTip(e, html) { tip.innerHTML = html; tip.style.display = 'block'; tip.style.left = Math.min(innerWidth - 220, e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 14) + 'px'; }
  function hideTip() { tip.style.display = 'none'; }
  function bindTips(root, fn) {
    root.querySelectorAll('[data-i]').forEach(el => { el.onmousemove = e => showTip(e, fn(+el.dataset.i)); el.onmouseleave = hideTip; });
  }

  // axis in minutes: round steps (5m, 10m, 15m, 30m, 1h, 2h, ...) so ticks read cleanly
  const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 180, 240, 360, 600, 1200, 2400, 6000];
  const niceStep = maxMin => STEPS.find(s => s * 4 >= maxMin) || STEPS[STEPS.length - 1];
  const tickLabel = v => v >= 60 ? `${+(v / 60).toFixed(1)}h` : `${v}m`;

  function drawTrend(list, target = $('trend'), height = 220) {
    const from = new Date($('from').value + 'T00:00:00'), to = new Date($('to').value + 'T00:00:00');
    const days = [];
    for (let d = new Date(from); d <= to && days.length < 400; d.setDate(d.getDate() + 1)) days.push(iso(d));
    const per = new Map(days.map(d => [d, { s: 0, p: new Set() }]));
    for (const r of list) { const e = per.get(r[0]); if (e) { e.s += r[4]; e.p.add(r[1]); } }
    const vals = days.map(d => per.get(d).s / 60);       // minutes
    const W = Math.max(320, target.clientWidth || 600), H = height, L = 46, B = 24, T = 8;
    const step = niceStep(Math.max(1, ...vals)), max = step * Math.max(1, Math.ceil(Math.max(1, ...vals) / step)), bw = (W - L - 8) / Math.max(1, days.length);
    const y = v => T + (H - T - B) * (1 - v / max);
    let svg = `<svg width="${W}" height="${H}" role="img" aria-label="Play time per day">`;
    for (let v = 0; v <= max + 1e-9; v += step) { const yy = y(v); svg += `<line class="gridline" x1="${L}" x2="${W - 4}" y1="${yy}" y2="${yy}"/><text x="${L - 6}" y="${yy + 4}" text-anchor="end">${tickLabel(v)}</text>`; }
    const every = Math.ceil(days.length / Math.floor((W - L) / 64));
    days.forEach((d, i) => {
      const x = L + i * bw, h = Math.max(0, y(0) - y(vals[i])), w = Math.max(1, bw - 2);
      if (h > 0) svg += `<path class="bar" d="M${x + 1},${y(0)} v${-Math.max(0, h - Math.min(4, w / 2))} q0,${-Math.min(4, w / 2)} ${Math.min(4, w / 2)},${-Math.min(4, w / 2)} h${Math.max(0, w - 2 * Math.min(4, w / 2))} q${Math.min(4, w / 2)},0 ${Math.min(4, w / 2)},${Math.min(4, w / 2)} v${Math.max(0, h - Math.min(4, w / 2))} z"/>`;
      svg += `<rect class="hit" data-i="${i}" x="${x}" y="${T}" width="${bw}" height="${H - T - B}"/>`;
      if (i % every === 0) svg += `<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${d.slice(5)}</text>`;
    });
    svg += `<line class="gridline" x1="${L}" x2="${W - 4}" y1="${y(0)}" y2="${y(0)}" style="stroke: var(--text-muted)"/></svg>`;
    target.innerHTML = svg;
    if (target === $('trend')) $('trendSub').textContent = `${days.length} days`;
    bindTips(target, i => `<b>${days[i]}</b>${fmt(Math.round(vals[i] * 60))} · ${per.get(days[i]).p.size} players`);
  }

  function hbar(target, items, labelW = 140) {
    if (!items.length) { target.innerHTML = '<div class="empty">No data</div>'; return; }
    const W = Math.max(280, target.clientWidth || 400), row = 24, H = items.length * row + 4;
    const max = Math.max(1, ...items.map(a => a.seconds)), x0 = labelW, span = W - x0 - 70;
    let svg = `<svg width="${W}" height="${H}" role="img" aria-label="Ranking">`;
    items.forEach((a, i) => {
      const y = i * row + 4, w = Math.max(2, a.seconds / max * span), r = Math.min(4, w / 2);
      const lbl = a.label.length > 20 ? a.label.slice(0, 19) + '…' : a.label;
      svg += `<text x="${x0 - 8}" y="${y + 14}" text-anchor="end" style="fill: var(--text-primary)">${esc(lbl)}</text>`;
      svg += `<path class="bar" d="M${x0},${y + 3} h${w - r} q${r},0 ${r},${r} v${16 - 2 * r} q0,${r} ${-r},${r} h${-(w - r)} z"/>`;
      svg += `<text x="${x0 + w + 6}" y="${y + 14}">${fmt(a.seconds)}</text>`;
      svg += `<rect class="hit" data-i="${i}" x="0" y="${y}" width="${W}" height="${row}"/>`;
    });
    target.innerHTML = svg + '</svg>';
    bindTips(target, i => `<b>${esc(items[i].label)}</b>${fmt(items[i].seconds)} · ${items[i].sessions} sessions${items[i].nPlayers > 1 ? ' · ' + items[i].nPlayers + ' players' : ''}`);
  }

  function drawRank(list) {
    const g = group === 'day' ? 'game' : group;
    const [kf, lf] = keyers[g];
    $('rankTitle').textContent = { user: 'Top players', game: 'Top games', pair: 'Top player × game' }[g] + ' by play time';
    hbar($('rank'), aggregate(list, kf, lf).sort((a, b) => b.seconds - a.seconds).slice(0, 15));
  }

  function renderDrill() {
    const el = $('drill');
    if (!drill || !data) { el.classList.remove('show'); return; }
    const list = rows().filter(r => drill.group === 'user' ? r[1].toLowerCase() === drill.key : r[2] === drill.key);
    if (!list.length) { el.classList.remove('show'); return; }
    const name = drill.group === 'user' ? list[0][1] : title(drill.key);
    const other = drill.group === 'user' ? keyers.game : keyers.user;
    const items = aggregate(list, other[0], other[1]).sort((a, b) => b.seconds - a.seconds);
    const total = list.reduce((s, r) => s + r[4], 0);
    el.innerHTML = `<button class="btn ghost small close">Close</button><h2>${esc(name)} <small>${fmt(total)} in ${new Set(list.map(r => r[0])).size} days ·
      ${drill.group === 'user' ? items.length + ' games' : items.length + ' players'}</small></h2>
      <div class="charts"><div><h2><small>Per day</small></h2><div id="drillTrend"></div></div><div><h2><small>${drill.group === 'user' ? 'Games' : 'Players'}</small></h2><div id="drillBars"></div></div></div>
      <table><tr><th>${drill.group === 'user' ? 'Game' : 'Player'}</th><th class="num">Play time</th><th class="num">Sessions</th><th class="num">Days</th><th>Last played</th></tr>
      ${items.map(a => `<tr><td>${esc(a.label)}</td><td class="num">${fmt(a.seconds)}</td><td class="num">${a.sessions}</td><td class="num">${a.nDays}</td><td>${esc(a.last)}</td></tr>`).join('')}</table>`;
    el.classList.add('show');
    el.querySelector('.close').onclick = () => { drill = null; renderDrill(); };
    drawTrend(list, $('drillTrend'), 160);
    hbar($('drillBars'), items.slice(0, 12));
  }

  $('csv').onclick = () => {
    const g = currentGroups(), cols = COLS[group];
    const val = (a, k) => k === 'type' ? (a.label === '(anonymous)' ? 'anonymous' : a.reg ? 'registered' : 'guest') : k === 'fav' ? (a.fav ? title(a.fav) : '')
      : ['seconds', 'perPlayer', 'perSession'].includes(k) ? Math.round(a[k]) : a[k];
    const lines = [cols.map(([k, l]) => (['seconds', 'perPlayer', 'perSession'].includes(k) ? l + ' (s)' : l)).join(',')]
      .concat(g.map(a => cols.map(([k]) => `"${String(val(a, k)).replace(/"/g, '""')}"`).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = `playtime-${group}-${$('from').value}-${$('to').value}.csv`; link.click();
  };
  addEventListener('resize', () => { clearTimeout(window.__rz); window.__rz = setTimeout(render, 150); });
  setRange(29);
})();
</script>
<?php admin_foot();
