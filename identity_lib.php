<?php
// Shared player identity for every game on oicrusher.me/game (included by auth_api.php,
// presence_api.php and the leaderboard APIs; it prints nothing by itself).
//
//   registered players: games.site_users (username + password_hash); logged in = the signed, HttpOnly
//                       cookie "oi_auth" (30 days, stateless: no PHP session involved)
//   guests:             a name in the signed cookie "oi_guest" (no account; registered names are reserved)
//   Node game server:   oi_token() signs {name, registered, expiry} with the shared secret so the
//                       WebSocket lobbies can trust the name without talking to MySQL
//
// PHP 8.0: no enums / readonly / never.

const OI_NAME_MIN = 2;
const OI_NAME_MAX = 16;
const OI_GUEST_COOKIE = 'oi_guest';
const OI_TOKEN_TTL = 12 * 3600;
const OI_SECRET_FILE = '/etc/oicrusher/identity.secret';

function oi_db() {
    static $pdo = null;
    if ($pdo) return $pdo;
    $host = getenv('OI_DB_HOST') ?: 'localhost';
    $name = getenv('OI_DB_NAME') ?: 'games';
    $pdo = new PDO("mysql:host=$host;dbname=$name;charset=utf8mb4", getenv('OI_DB_USER') ?: 'root', getenv('OI_DB_PASS') ?: '');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    oi_ensure_tables($pdo);
    return $pdo;
}

function oi_ensure_tables($pdo) {
    $pdo->exec("CREATE TABLE IF NOT EXISTS site_users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(32) NOT NULL,
        username_lc VARCHAR(32) NOT NULL UNIQUE,
        pass_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP NULL,
        last_ip VARCHAR(45) NOT NULL DEFAULT ''
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS site_presence (
        sid VARCHAR(40) PRIMARY KEY,
        name VARCHAR(32) NOT NULL,
        registered TINYINT(1) NOT NULL DEFAULT 0,
        game VARCHAR(40) NOT NULL,
        title VARCHAR(60) NOT NULL DEFAULT '',
        status VARCHAR(80) NOT NULL DEFAULT '',
        join_url VARCHAR(200) NOT NULL DEFAULT '',
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_updated (updated_at)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS site_auth_fail (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ip VARCHAR(45) NOT NULL,
        at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_ip_at (ip, at)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    // play time per player, game and day (fed by presence_api.php heartbeats; anonymous = no name picked yet)
    $pdo->exec("CREATE TABLE IF NOT EXISTS site_playtime (
        day DATE NOT NULL,
        name VARCHAR(32) NOT NULL,
        game VARCHAR(40) NOT NULL,
        registered TINYINT(1) NOT NULL DEFAULT 0,
        title VARCHAR(60) NOT NULL DEFAULT '',
        seconds INT NOT NULL DEFAULT 0,
        sessions INT NOT NULL DEFAULT 0,
        PRIMARY KEY (day, name, game),
        INDEX idx_name (name), INDEX idx_game (game)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    // roles (user / admin / super) and a per-user version that invalidates old login cookies
    $cols = $pdo->query("SHOW COLUMNS FROM site_users")->fetchAll(PDO::FETCH_COLUMN);
    if (!in_array('role', $cols, true)) $pdo->exec("ALTER TABLE site_users ADD COLUMN role VARCHAR(10) NOT NULL DEFAULT 'user'");
    if (!in_array('auth_ver', $cols, true)) $pdo->exec("ALTER TABLE site_users ADD COLUMN auth_ver INT NOT NULL DEFAULT 1");
    // the owner's account is always the super administrator
    $pdo->exec("UPDATE site_users SET role = 'super' WHERE username_lc = '" . OI_SUPER . "' AND role <> 'super'");
}

const OI_SUPER = 'zxliu';
const OI_ROLES = ['user' => 0, 'admin' => 1, 'super' => 2];

const OI_AUTH_COOKIE = 'oi_auth';
const OI_AUTH_TTL = 30 * 86400;

function oi_cookie($name, $value, $ttl, $httpOnly) {
    setcookie($name, $value, ['expires' => $value === '' ? time() - 3600 : time() + $ttl, 'path' => '/', 'httponly' => $httpOnly,
                              'samesite' => 'Lax', 'secure' => !empty($_SERVER['HTTPS'])]);
    if ($value === '') unset($_COOKIE[$name]); else $_COOKIE[$name] = $value;
}

function oi_sign($payload, $kind) { return oi_b64url(hash_hmac('sha256', $kind . '|' . $payload, oi_secret(), true)); }

/** Log a registered player in on this browser (or out with null). */
function oi_set_auth_cookie($uid, $name, $ver = 1) {
    if ($uid === null) { oi_cookie(OI_AUTH_COOKIE, '', 0, true); return; }
    $payload = oi_b64url(json_encode(['u' => (int)$uid, 'n' => $name, 'v' => (int)$ver, 'e' => time() + OI_AUTH_TTL]));
    oi_cookie(OI_AUTH_COOKIE, $payload . '.' . oi_sign($payload, 'auth'), OI_AUTH_TTL, true);
}

function oi_auth_user() {
    $raw = $_COOKIE[OI_AUTH_COOKIE] ?? '';
    $p = strpos($raw, '.');
    if ($p === false) return null;
    $payload = substr($raw, 0, $p);
    if (!hash_equals(oi_sign($payload, 'auth'), substr($raw, $p + 1))) return null;
    $d = json_decode(base64_decode(strtr($payload, '-_', '+/')), true);
    if (!is_array($d) || empty($d['u']) || empty($d['n']) || ($d['e'] ?? 0) < time()) return null;
    return ['id' => (int)$d['u'], 'name' => (string)$d['n'], 'v' => (int)($d['v'] ?? 1)];
}

function oi_secret() {
    static $s = null;
    if ($s !== null) return $s;
    $s = getenv('OI_ID_SECRET') ?: '';
    if ($s === '' && is_readable(OI_SECRET_FILE)) $s = trim(file_get_contents(OI_SECRET_FILE));
    if ($s === '') $s = 'dev-only-secret';          // local testing; production always has the file
    return $s;
}

function oi_b64url($bin) { return rtrim(strtr(base64_encode($bin), '+/', '-_'), '='); }

/** 2-16 letters (any script), digits, space, _ - . ; null when unusable. */
function oi_clean_name($name) {
    $n = preg_replace('/[\x00-\x1F\x7F<>&"\'\\\\]/u', '', (string)$name);
    $n = trim(preg_replace('/\s+/u', ' ', $n ?? ''));
    if ($n === '' || !preg_match('/^[\p{L}\p{N} _.\-]+$/u', $n)) return null;
    $len = mb_strlen($n);
    if ($len < OI_NAME_MIN || $len > OI_NAME_MAX) return null;
    return $n;
}

/**
 * Is this text fine to show to other players? Asks the game server's keyword filter (the same one the games use,
 * POST 127.0.0.1:8090/moderate, which also logs what it blocks). Fails open: if the game server is down, nothing is refused.
 */
function oi_text_ok($text, $kind = 'username', $user = '') {
    $body = json_encode(['text' => (string)$text, 'kind' => $kind, 'game' => 'portal', 'user' => $user !== '' ? $user : (string)$text, 'ip' => oi_client_ip()]);
    $ctx = stream_context_create(['http' => ['method' => 'POST', 'header' => "Content-Type: application/json\r\n", 'content' => $body, 'timeout' => 1.5, 'ignore_errors' => true]]);
    $res = @file_get_contents('http://127.0.0.1:8090/moderate', false, $ctx);
    $d = $res === false ? null : json_decode($res, true);
    return !(is_array($d) && array_key_exists('ok', $d) && $d['ok'] === false);
}
const OI_NAME_BLOCKED = 'That name contains language that is not allowed here. Please pick another. 名字含有不允许的词语，请换一个。';

function oi_lc($name) { return mb_strtolower($name, 'UTF-8'); }

function oi_registered_user($pdo, $name) {
    $st = $pdo->prepare('SELECT id, username FROM site_users WHERE username_lc = ?');
    $st->execute([oi_lc($name)]);
    return $st->fetch() ?: null;
}

function oi_guest_value($name) { return rawurlencode($name) . '.' . substr(oi_sign($name, 'guest'), 0, 24); }

function oi_set_guest_cookie($name) { oi_cookie(OI_GUEST_COOKIE, $name === null ? '' : oi_guest_value($name), 365 * 86400, false); }

function oi_guest_name() {
    $raw = $_COOKIE[OI_GUEST_COOKIE] ?? '';
    $p = strrpos($raw, '.');
    if ($p === false) return null;
    $name = oi_clean_name(rawurldecode(substr($raw, 0, $p)));
    if ($name === null || !hash_equals(oi_guest_value($name), $raw)) return null;
    return $name;
}

/** The current player: ['name', 'registered', 'id'] or null. */
function oi_identity($pdo = null) {
    $u = oi_auth_user();
    if ($u) {
        // the account must still exist with the same login version (deleted users and password resets log out)
        $st = ($pdo ?: oi_db())->prepare('SELECT username, role, auth_ver FROM site_users WHERE id = ?');
        $st->execute([$u['id']]);
        $row = $st->fetch();
        if ($row && (int)$row['auth_ver'] === $u['v'] && oi_lc($row['username']) === oi_lc($u['name'])) {
            return ['name' => $row['username'], 'registered' => true, 'id' => $u['id'], 'role' => $row['role']];
        }
        if (!headers_sent()) oi_set_auth_cookie(null, null);
    }
    $g = oi_guest_name();
    if ($g === null) return null;
    // a guest name that someone has since registered is no longer usable
    if (oi_registered_user($pdo ?: oi_db(), $g)) return null;
    return ['name' => $g, 'registered' => false, 'id' => null];
}

/** Is the current player at least this role ('admin' or 'super')? Returns the identity or null. */
function oi_require_role($min, $pdo = null) {
    $id = oi_identity($pdo);
    if (!$id || !$id['registered']) return null;
    return (OI_ROLES[$id['role'] ?? 'user'] ?? 0) >= OI_ROLES[$min] ? $id : null;
}

/** Admin or super? (role comes from oi_identity(); right after a login it is not loaded yet, so look it up) */
function oi_is_admin($id) {
    if (!$id || empty($id['registered']) || empty($id['id'])) return false;
    $role = $id['role'] ?? null;
    if ($role === null) {
        $st = oi_db()->prepare('SELECT role FROM site_users WHERE id = ?');
        $st->execute([$id['id']]);
        $role = $st->fetchColumn() ?: 'user';
    }
    return (OI_ROLES[$role] ?? 0) >= OI_ROLES['admin'];
}

/** CSRF token for admin pages: bound to the account and its login version. */
function oi_csrf($id) { return oi_sign($id['id'] . '|' . oi_lc($id['name']), 'csrf'); }
function oi_check_csrf($id) { return hash_equals(oi_csrf($id), (string)($_SERVER['HTTP_X_CSRF'] ?? '')); }

/** Signed token for the Node game server: payload.signature (both base64url). */
function oi_token($id) {
    $d = ['n' => $id['name'], 'r' => $id['registered'] ? 1 : 0, 'e' => time() + OI_TOKEN_TTL];
    if (oi_is_admin($id)) $d['a'] = 1;           // admin / super: games may gate on it (tj_hide_seek)
    $payload = oi_b64url(json_encode($d));
    return $payload . '.' . oi_b64url(hash_hmac('sha256', $payload, oi_secret(), true));
}

/**
 * Name to store with a leaderboard score: the player's identity when there is one; otherwise the
 * typed name (old cached pages), unless it belongs to a registered player. Returns null when refused.
 */
function oi_score_name($claimed, $pdo = null) {
    try {
        $pdo = $pdo ?: oi_db();
        $id = oi_identity($pdo);
        if ($id) return oi_text_ok($id['name']) ? $id['name'] : 'Anonymous';
        $n = oi_clean_name($claimed);
        if ($n === null || !oi_text_ok($n)) return 'Anonymous';
        return oi_registered_user($pdo, $n) ? null : $n;
    } catch (Throwable $e) {
        error_log('identity: ' . $e->getMessage());
        $n = oi_clean_name($claimed);
        return $n === null ? 'Anonymous' : $n;
    }
}

function oi_client_ip() { return $_SERVER['REMOTE_ADDR'] ?? ''; }
