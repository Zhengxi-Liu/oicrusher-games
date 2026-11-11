<?php
// Player account management (super administrator only). Actions go through users_api.php.
require __DIR__ . '/_auth.php';
$id = admin_gate_page('super', 'Users');
admin_head('Users', $id, 'users');
?>
<style>
  .bar2 { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; }
  .bar2 h2 { font-size: 16px; margin-right: auto; }
  form.add { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .actions { display: flex; gap: 6px; }
  #msg { min-height: 1.4em; margin: 10px 0; }
  #msg.err { color: var(--danger); } #msg.ok { color: var(--good); }
  .pw { font-family: ui-monospace, Menlo, monospace; background: var(--surface-2); padding: 2px 8px; border-radius: 6px; user-select: all; }
</style>
<main>
  <div class="card">
    <div class="bar2">
      <h2>Player accounts <small class="muted" id="count"></small></h2>
      <form class="add" id="addForm" autocomplete="off">
        <input name="username" placeholder="New username" maxlength="16" required>
        <input name="password" type="text" placeholder="Password (blank = generate)" autocomplete="new-password">
        <select name="role"><option value="user">Player</option><option value="admin">Admin (can see the report)</option></select>
        <button class="btn" type="submit">Add user</button>
      </form>
    </div>
    <div id="msg"></div>
    <div style="overflow-x:auto"><table id="users"></table></div>
    <p class="muted" style="margin-top:12px">Resetting a password logs that player out on every device. Admins can open the play-time report; only the
      super administrator (<?= htmlspecialchars(OI_SUPER) ?>) can manage accounts. Deleting an account frees its name; its play-time history stays in the report.</p>
  </div>
</main>
<script>
(() => {
  const CSRF = <?= json_encode(oi_csrf($id)) ?>;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = s => s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.floor(s / 3600)}h ${String(Math.round(s % 3600 / 60)).padStart(2, '0')}m`;
  const say = (html, ok) => { $('msg').innerHTML = html; $('msg').className = ok ? 'ok' : 'err'; };

  async function api(body) {
    const r = await fetch('users_api.php', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF': CSRF }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Request failed');
    return d;
  }

  async function load() {
    const r = await fetch('users_api.php', { cache: 'no-store', credentials: 'same-origin' });
    const d = await r.json();
    if (!r.ok) { say(esc(d.error || 'Could not load users')); return; }
    $('count').textContent = `${d.users.length} accounts`;
    $('users').innerHTML = `<tr><th>Username</th><th>Role</th><th>Created</th><th>Last login</th><th>Last IP</th><th class="num">Play time</th><th>Actions</th></tr>` +
      d.users.map(u => {
        const locked = u.role === 'super' || u.me;
        return `<tr data-id="${u.id}" data-name="${esc(u.username)}"><td><b>${esc(u.username)}</b>${u.me ? ' <span class="muted">(you)</span>' : ''}</td>
          <td><span class="tag ${esc(u.role)}">${esc(u.role === 'user' ? 'player' : u.role)}</span></td>
          <td class="muted">${esc(u.created_at || '')}</td><td class="muted">${esc(u.last_login || '-')}</td><td class="muted">${esc(u.last_ip || '')}</td>
          <td class="num">${fmt(u.seconds)}</td>
          <td><div class="actions">
            <button class="btn ghost small" data-a="reset">Reset password</button>
            ${locked ? '' : `<button class="btn ghost small" data-a="role" data-role="${u.role === 'admin' ? 'user' : 'admin'}">${u.role === 'admin' ? 'Remove admin' : 'Make admin'}</button>
            <button class="btn danger small" data-a="delete">Delete</button>`}
          </div></td></tr>`;
      }).join('');
    $('users').querySelectorAll('button[data-a]').forEach(b => { b.onclick = () => act(b); });
  }

  async function act(b) {
    const tr = b.closest('tr'), id = +tr.dataset.id, name = tr.dataset.name;
    try {
      if (b.dataset.a === 'reset') {
        const pw = prompt(`New password for ${name} (at least 6 characters).\nLeave empty to generate one.`, '');
        if (pw === null) return;
        const d = await api({ action: 'reset', id, password: pw });
        say(d.password ? `Password for <b>${esc(name)}</b> reset to <span class="pw">${esc(d.password)}</span> - pass it on now, it is not shown again.` : `Password for <b>${esc(name)}</b> changed.`, true);
      } else if (b.dataset.a === 'role') {
        await api({ action: 'role', id, role: b.dataset.role });
        say(`<b>${esc(name)}</b> is now ${b.dataset.role === 'admin' ? 'an admin' : 'a player'}.`, true);
      } else if (b.dataset.a === 'delete') {
        if (!confirm(`Delete the account "${name}"? Their name becomes free for others; play-time history stays in the report.`)) return;
        await api({ action: 'delete', id });
        say(`Deleted <b>${esc(name)}</b>.`, true);
      }
      load();
    } catch (e) { say(esc(e.message)); }
  }

  $('addForm').onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    try {
      const d = await api({ action: 'add', username: f.username, password: f.password, role: f.role });
      say(`Added <b>${esc(f.username)}</b>${d.password ? ` with password <span class="pw">${esc(d.password)}</span> - pass it on now, it is not shown again.` : '.'}`, true);
      e.target.reset();
      load();
    } catch (ex) { say(esc(ex.message)); }
  };
  load();
})();
</script>
<?php admin_foot();
