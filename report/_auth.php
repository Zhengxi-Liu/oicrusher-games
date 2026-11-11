<?php
// Admin area of the game portal: access checks and the shared page frame.
// Roles live in games.site_users.role (user / admin / super); zxliu is always super (identity_lib.php).
// Nothing in this directory is linked from the public site, and every file checks the role itself
// (Apache's AllowOverride is None, so there is no .htaccess protection to rely on).
if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) { http_response_code(403); exit; }   // a library, not a page
require_once __DIR__ . '/../identity_lib.php';

function admin_headers() {
    header('Cache-Control: no-store');
    header('X-Robots-Tag: noindex, nofollow');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: same-origin');
}

/** HTML pages: the identity when it has the role, otherwise an "admins only" page (with a login button). */
function admin_gate_page($min, $title) {
    admin_headers();
    try { $id = oi_require_role($min); $who = oi_identity(); }
    catch (Throwable $e) { http_response_code(500); exit('Server error'); }
    if ($id) return $id;
    http_response_code(403);
    $msg = $who ? 'Signed in as <b>' . htmlspecialchars($who['name']) . '</b>' . ($who['registered'] ? '' : ' (guest)') . ', which has no access here.'
                : 'Please log in with an administrator account.';
    admin_head($title, null, '');
    echo '<main class="gate"><h1>🔒 Admins only</h1><p>' . $msg . '</p>
          <p><button class="btn" onclick="OIID.open({tab: \'login\'})">Log in</button></p></main>
          <script>OIID.onChange(() => location.reload());</script>';
    admin_foot();
    exit;
}

/** JSON APIs: the identity or a 403. Writes also need the page's CSRF token in X-CSRF. */
function admin_gate_api($min, $write = false) {
    admin_headers();
    header('Content-Type: application/json');
    $id = oi_require_role($min);
    if (!$id) { http_response_code(403); echo json_encode(['error' => 'Admins only']); exit; }
    if ($write && !oi_check_csrf($id)) { http_response_code(403); echo json_encode(['error' => 'Bad CSRF token - reload the page']); exit; }
    return $id;
}

function admin_head($title, $id, $active) {
    $isSuper = $id && ($id['role'] ?? '') === 'super';
    ?><!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title><?= htmlspecialchars($title) ?> · Game Admin</title>
  <style>
    :root { color-scheme: light; --surface-0: #f3f4f1; --surface-1: #fcfcfb; --surface-2: #f0f0ec; --border: #e1e0da; --text-primary: #0b0b0b;
            --text-secondary: #52514e; --text-muted: #7c7b75; --series-1: #2a78d6; --series-1-soft: #d6e6f8; --accent: #2a78d6; --danger: #c93a39; --good: #1d8a4e; }
    @media (prefers-color-scheme: dark) {
      :root:where(:not([data-theme="light"])) { color-scheme: dark; --surface-0: #111110; --surface-1: #1a1a19; --surface-2: #232321; --border: #33332f;
        --text-primary: #f0efec; --text-secondary: #c3c2b7; --text-muted: #8f8e86; --series-1: #3987e5; --series-1-soft: #1f3550; --accent: #3987e5; --danger: #e66767; --good: #4cc27f; }
    }
    :root[data-theme="dark"] { color-scheme: dark; --surface-0: #111110; --surface-1: #1a1a19; --surface-2: #232321; --border: #33332f;
        --text-primary: #f0efec; --text-secondary: #c3c2b7; --text-muted: #8f8e86; --series-1: #3987e5; --series-1-soft: #1f3550; --accent: #3987e5; --danger: #e66767; --good: #4cc27f; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font: 14px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; background: var(--surface-0); color: var(--text-primary); }
    header.top { display: flex; align-items: center; gap: 18px; padding: 12px 24px; background: var(--surface-1); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
    header.top h1 { font-size: 16px; }
    header.top nav { display: flex; gap: 4px; }
    header.top nav a { color: var(--text-secondary); text-decoration: none; padding: 6px 12px; border-radius: 8px; }
    header.top nav a.on { background: var(--surface-2); color: var(--text-primary); font-weight: 600; }
    header.top .who { margin-left: auto; color: var(--text-secondary); font-size: 13px; }
    main { max-width: 1280px; margin: 0 auto; padding: 20px 24px 60px; }
    main.gate { max-width: 460px; margin-top: 12vh; text-align: center; background: var(--surface-1); border: 1px solid var(--border); border-radius: 14px; padding: 32px; }
    main.gate h1 { font-size: 22px; margin-bottom: 10px; } main.gate p { color: var(--text-secondary); margin-bottom: 14px; }
    .card { background: var(--surface-1); border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px; }
    .btn { font: inherit; font-weight: 600; cursor: pointer; border: 1px solid var(--accent); background: var(--accent); color: #fff; border-radius: 8px; padding: 7px 14px; }
    .btn.ghost { background: transparent; color: var(--text-primary); border-color: var(--border); }
    .btn.danger { background: transparent; color: var(--danger); border-color: var(--danger); }
    .btn.small { padding: 3px 9px; font-size: 12px; }
    .btn:disabled { opacity: .5; cursor: default; }
    input, select { font: inherit; color: var(--text-primary); background: var(--surface-1); border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--border); white-space: nowrap; }
    th { color: var(--text-secondary); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .3px; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
    .muted { color: var(--text-muted); }
    .tag { font-size: 11px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--border); color: var(--text-secondary); }
    .tag.reg { border-color: var(--good); color: var(--good); }
    .tag.admin { border-color: var(--accent); color: var(--accent); }
    .tag.super { background: var(--accent); border-color: var(--accent); color: #fff; }
  </style>
  <script src="../identity.js?v=2" data-badge="off" data-presence="off"></script>
</head>
<body>
<?php if ($id): ?>
<header class="top">
  <h1>🎮 Game Admin</h1>
  <nav>
    <a href="index.php" class="<?= $active === 'report' ? 'on' : '' ?>">Play-time report</a>
    <?php if ($isSuper): ?><a href="users.php" class="<?= $active === 'users' ? 'on' : '' ?>">Users</a><?php endif; ?>
  </nav>
  <span class="who">Signed in as <b><?= htmlspecialchars($id['name']) ?></b> <span class="tag <?= htmlspecialchars($id['role']) ?>"><?= htmlspecialchars($id['role']) ?></span></span>
</header>
<?php endif;
}

function admin_foot() { echo "\n</body>\n</html>\n"; }
