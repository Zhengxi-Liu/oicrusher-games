<?php
// Player account management (super administrator only - zxliu).
//   GET                                                   -> { users: [...] }
//   POST {action: "add", username, password?, role}       -> { ok, password }   (a password is generated when empty)
//   POST {action: "reset", id, password?}                 -> { ok, password }   (also logs that user out everywhere)
//   POST {action: "role", id, role: "user" | "admin"}     -> { ok }
//   POST {action: "delete", id}                           -> { ok }
// Writes need the page's CSRF token (X-CSRF). The super account cannot be changed or deleted here,
// and nobody can change or delete their own account.
require __DIR__ . '/_auth.php';
$write = $_SERVER['REQUEST_METHOD'] === 'POST';
$me = admin_gate_api('super', $write);

function fail($msg, $code = 400) { http_response_code($code); echo json_encode(['error' => $msg]); exit; }
function gen_password() {
    $abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    $p = '';
    for ($i = 0; $i < 10; $i++) $p .= $abc[random_int(0, strlen($abc) - 1)];
    return $p;
}

try {
    $pdo = oi_db();
    if (!$write) {
        $users = $pdo->query("SELECT u.id, u.username, u.role, u.created_at, u.last_login, u.last_ip,
                                     COALESCE((SELECT SUM(p.seconds) FROM site_playtime p WHERE p.registered = 1 AND p.name = u.username), 0) AS seconds
                              FROM site_users u ORDER BY u.role = 'super' DESC, u.role = 'admin' DESC, u.username")->fetchAll();
        foreach ($users as &$u) { $u['id'] = (int)$u['id']; $u['seconds'] = (int)$u['seconds']; $u['me'] = $u['id'] === $me['id']; }
        echo json_encode(['users' => $users]);
        exit;
    }
    $in = json_decode(file_get_contents('php://input'), true);
    if (!is_array($in)) fail('Bad request');
    $action = (string)($in['action'] ?? '');

    if ($action === 'add') {
        $n = oi_clean_name($in['username'] ?? '');
        if ($n === null) fail('Username: 2-16 letters, digits, spaces, _ - .');
        $pw = (string)($in['password'] ?? '');
        $generated = $pw === '';
        if ($generated) $pw = gen_password();
        if (strlen($pw) < 6 || strlen($pw) > 200) fail('Password: at least 6 characters.');
        $role = ($in['role'] ?? 'user') === 'admin' ? 'admin' : 'user';
        if (oi_lc($n) === OI_SUPER) $role = 'super';
        if (oi_registered_user($pdo, $n)) fail('That username is taken.', 409);
        $pdo->prepare('INSERT INTO site_users (username, username_lc, pass_hash, role) VALUES (?, ?, ?, ?)')
            ->execute([$n, oi_lc($n), password_hash($pw, PASSWORD_DEFAULT), $role]);
        error_log("game admin: {$me['name']} added user $n ($role)");
        echo json_encode(['ok' => true, 'password' => $generated ? $pw : null]);
        exit;
    }

    $uid = (int)($in['id'] ?? 0);
    $st = $pdo->prepare('SELECT id, username, role FROM site_users WHERE id = ?');
    $st->execute([$uid]);
    $u = $st->fetch();
    if (!$u) fail('No such user.', 404);
    $self = (int)$u['id'] === $me['id'];

    if ($action === 'reset') {
        $pw = (string)($in['password'] ?? '');
        $generated = $pw === '';
        if ($generated) $pw = gen_password();
        if (strlen($pw) < 6 || strlen($pw) > 200) fail('Password: at least 6 characters.');
        // bumping auth_ver logs the user out on every browser (identity_lib.php checks it)
        $pdo->prepare('UPDATE site_users SET pass_hash = ?, auth_ver = auth_ver + 1 WHERE id = ?')->execute([password_hash($pw, PASSWORD_DEFAULT), $uid]);
        if ($self) {                                      // keep the admin who reset their own password logged in
            $v = (int)$pdo->query('SELECT auth_ver FROM site_users WHERE id = ' . $uid)->fetchColumn();
            oi_set_auth_cookie($uid, $u['username'], $v);
        }
        error_log("game admin: {$me['name']} reset the password of {$u['username']}");
        echo json_encode(['ok' => true, 'password' => $generated ? $pw : null]);
        exit;
    }
    if ($self || $u['role'] === 'super') fail('This account cannot be changed here.', 403);
    if ($action === 'role') {
        $role = ($in['role'] ?? '') === 'admin' ? 'admin' : 'user';
        $pdo->prepare('UPDATE site_users SET role = ? WHERE id = ?')->execute([$role, $uid]);
        error_log("game admin: {$me['name']} set {$u['username']} to $role");
        echo json_encode(['ok' => true]);
        exit;
    }
    if ($action === 'delete') {
        $pdo->prepare('DELETE FROM site_users WHERE id = ?')->execute([$uid]);
        error_log("game admin: {$me['name']} deleted user {$u['username']}");
        echo json_encode(['ok' => true]);
        exit;
    }
    fail('Unknown action');
} catch (PDOException $e) {
    error_log('users api: ' . $e->getMessage());
    fail('Server error', 500);
}
