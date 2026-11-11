<?php
// Player accounts for the game portal (see identity_lib.php).
//   GET  ?action=me                         -> { identity: {name, registered, admin} | null, token }
//   GET  ?action=check&name=...             -> { ok, reason? }  (is the name usable / free?)
//   POST {"action":"register","username","password"}  -> { identity, token }
//   POST {"action":"login","username","password"}     -> { identity, token }
//   POST {"action":"guest","name"}                     -> { identity, token }   (cookie only, no account)
//   POST {"action":"logout"}                           -> { identity: null }
// Same-origin only (no CORS headers); POST bodies must be JSON.
require __DIR__ . '/identity_lib.php';
header('Content-Type: application/json');
header('Cache-Control: no-store');

function out($data, $code = 200) { http_response_code($code); echo json_encode($data); exit; }
function out_identity($id) { out(['identity' => $id ? ['name' => $id['name'], 'registered' => $id['registered'], 'admin' => oi_is_admin($id)] : null, 'token' => $id ? oi_token($id) : null]); }

const LOGIN_FAILS = 10;          // per IP ...
const LOGIN_WINDOW = 600;        // ... per 10 minutes

try {
    $pdo = oi_db();
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $action = $_GET['action'] ?? 'me';
        if ($action === 'me') out_identity(oi_identity($pdo));
        if ($action === 'check') {
            $n = oi_clean_name($_GET['name'] ?? '');
            if ($n === null) out(['ok' => false, 'reason' => 'Use 2-16 letters, digits, spaces, _ - .']);
            if (oi_registered_user($pdo, $n)) out(['ok' => false, 'reason' => 'That name belongs to a registered player.']);
            out(['ok' => true]);
        }
        out(['error' => 'Unknown action'], 400);
    }
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') out(['error' => 'Method not allowed'], 405);
    if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') === false) out(['error' => 'JSON required'], 415);
    $in = json_decode(file_get_contents('php://input'), true);
    if (!is_array($in)) out(['error' => 'Bad request'], 400);
    $action = (string)($in['action'] ?? '');

    if ($action === 'logout') {
        oi_set_auth_cookie(null, null);
        out(['identity' => null, 'token' => null]);
    }

    if ($action === 'guest') {
        $n = oi_clean_name($in['name'] ?? '');
        if ($n === null) out(['error' => 'Use 2-16 letters, digits, spaces, _ - .'], 400);
        if (!oi_text_ok($n)) out(['error' => OI_NAME_BLOCKED], 400);
        if (oi_registered_user($pdo, $n)) out(['error' => 'That name belongs to a registered player. Log in, or pick another name.'], 409);
        oi_set_auth_cookie(null, null);
        oi_set_guest_cookie($n);
        out_identity(['name' => $n, 'registered' => false, 'id' => null]);
    }

    if ($action === 'register' || $action === 'login') {
        $ip = oi_client_ip();
        $st = $pdo->prepare('SELECT COUNT(*) FROM site_auth_fail WHERE ip = ? AND at > (NOW() - INTERVAL ' . LOGIN_WINDOW . ' SECOND)');
        $st->execute([$ip]);
        if ((int)$st->fetchColumn() >= LOGIN_FAILS) out(['error' => 'Too many attempts. Try again in a few minutes.'], 429);
        $fail = function ($msg, $code) use ($pdo, $ip) {
            $pdo->prepare('INSERT INTO site_auth_fail (ip) VALUES (?)')->execute([$ip]);
            $pdo->exec('DELETE FROM site_auth_fail WHERE at < (NOW() - INTERVAL 1 DAY)');
            out(['error' => $msg], $code);
        };
        $n = oi_clean_name($in['username'] ?? '');
        $pw = (string)($in['password'] ?? '');
        if ($n === null) out(['error' => 'Username: 2-16 letters, digits, spaces, _ - .'], 400);
        if (strlen($pw) < 6 || strlen($pw) > 200) out(['error' => 'Password: at least 6 characters.'], 400);

        if ($action === 'register') {
            if (!oi_text_ok($n)) out(['error' => OI_NAME_BLOCKED], 400);
            if (oi_registered_user($pdo, $n)) out(['error' => 'That username is taken.'], 409);
            $st = $pdo->prepare('INSERT INTO site_users (username, username_lc, pass_hash, last_login, last_ip) VALUES (?, ?, ?, NOW(), ?)');
            try { $st->execute([$n, oi_lc($n), password_hash($pw, PASSWORD_DEFAULT), $ip]); }
            catch (PDOException $e) { out(['error' => 'That username is taken.'], 409); }
            $uid = (int)$pdo->lastInsertId();
            $name = $n;
            $ver = 1;
        } else {
            $st = $pdo->prepare('SELECT id, username, pass_hash, auth_ver FROM site_users WHERE username_lc = ?');
            $st->execute([oi_lc($n)]);
            $u = $st->fetch();
            if (!$u || !password_verify($pw, $u['pass_hash'])) $fail('Wrong username or password.', 401);
            if (password_needs_rehash($u['pass_hash'], PASSWORD_DEFAULT)) {
                $pdo->prepare('UPDATE site_users SET pass_hash = ? WHERE id = ?')->execute([password_hash($pw, PASSWORD_DEFAULT), $u['id']]);
            }
            $pdo->prepare('UPDATE site_users SET last_login = NOW(), last_ip = ? WHERE id = ?')->execute([$ip, $u['id']]);
            $uid = (int)$u['id'];
            $name = $u['username'];
            $ver = (int)$u['auth_ver'];
        }
        oi_set_guest_cookie(null);
        oi_set_auth_cookie($uid, $name, $ver);
        out_identity(['name' => $name, 'registered' => true, 'id' => $uid]);
    }
    out(['error' => 'Unknown action'], 400);
} catch (PDOException $e) {
    error_log('auth_api: ' . $e->getMessage());
    out(['error' => 'Server error'], 500);
}
