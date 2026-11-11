<?php
// Play-time report data (admins only).
//   GET ?from=YYYY-MM-DD&to=YYYY-MM-DD  -> { rows: [[day, name, game, registered, seconds, sessions]], titles: {game: title},
//                                          accounts: {name_lc: role}, online: n, from, to }
// Rows are per day, player and game (site_playtime); the page aggregates them by user / game / day.
require __DIR__ . '/_auth.php';
admin_gate_api('admin');

$day = '/^\d{4}-\d{2}-\d{2}$/';
$from = preg_match($day, $_GET['from'] ?? '') ? $_GET['from'] : date('Y-m-d', time() - 29 * 86400);
$to = preg_match($day, $_GET['to'] ?? '') ? $_GET['to'] : date('Y-m-d');
if ($from > $to) [$from, $to] = [$to, $from];

try {
    $pdo = oi_db();
    $st = $pdo->prepare('SELECT day, name, game, registered, title, seconds, sessions FROM site_playtime
                         WHERE day BETWEEN ? AND ? ORDER BY day LIMIT 100000');
    $st->execute([$from, $to]);
    $rows = [];
    $titles = [];
    foreach ($st as $r) {
        $rows[] = [$r['day'], $r['name'], $r['game'], (int)$r['registered'], (int)$r['seconds'], (int)$r['sessions']];
        if ($r['title'] !== '') $titles[$r['game']] = $r['title'];
    }
    $accounts = [];
    foreach ($pdo->query('SELECT username_lc, role FROM site_users') as $u) $accounts[$u['username_lc']] = $u['role'];
    $online = (int)$pdo->query('SELECT COUNT(*) FROM site_presence WHERE updated_at > (NOW() - INTERVAL 45 SECOND)')->fetchColumn();
    $first = $pdo->query('SELECT MIN(day) FROM site_playtime')->fetchColumn();
    echo json_encode(['rows' => $rows, 'titles' => $titles, 'accounts' => $accounts, 'online' => $online,
                      'from' => $from, 'to' => $to, 'first' => $first ?: null, 'today' => date('Y-m-d')]);
} catch (PDOException $e) {
    error_log('report api: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => 'Server error']);
}
