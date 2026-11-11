<?php
// Who is playing what, for the game portal's "Playing now" list.
//   POST {"sid","game","title","status","join"}  heartbeat from a game page (every ~20 s; identity from cookies)
//   POST {"sid","leave":true}                     the page is closing
//   GET                                           -> { players: [{name, registered, game, title, status, join, mins}] }
// A row counts as online for PRESENCE_WINDOW seconds after its last heartbeat.
// Every heartbeat also adds the time since the same tab's previous one (capped, so closed or hidden
// tabs don't count) to site_playtime (day, player, game) for the admin report in report/.
// Players without a name yet are counted as "(anonymous)" and never listed publicly.
require __DIR__ . '/identity_lib.php';
header('Content-Type: application/json');
header('Cache-Control: no-store');

const PRESENCE_WINDOW = 45;
const HEARTBEAT_CAP = 25;          // seconds credited per heartbeat at most (pages beat every 20 s)
const ANON = '(anonymous)';

function out($data, $code = 200) { http_response_code($code); echo json_encode($data); exit; }
function clip($s, $n) { return mb_substr(trim(preg_replace('/[\x00-\x1F\x7F<>]/u', '', (string)$s)), 0, $n); }

try {
    $pdo = oi_db();
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $pdo->exec('DELETE FROM site_presence WHERE updated_at < (NOW() - INTERVAL 1 HOUR)');
        $rows = $pdo->query('SELECT name, registered, game, title, status, join_url, TIMESTAMPDIFF(MINUTE, started_at, NOW()) AS mins
                             FROM site_presence WHERE CHAR_LENGTH(name) > 0 AND updated_at > (NOW() - INTERVAL ' . PRESENCE_WINDOW . ' SECOND)
                             ORDER BY updated_at DESC LIMIT 200')->fetchAll();
        // one entry per player and game (several tabs collapse into one)
        $seen = [];
        $players = [];
        foreach ($rows as $r) {
            $k = mb_strtolower($r['name']) . '|' . $r['game'];
            if (isset($seen[$k])) continue;
            $seen[$k] = true;
            $players[] = ['name' => $r['name'], 'registered' => (bool)$r['registered'], 'game' => $r['game'], 'title' => $r['title'],
                          'status' => $r['status'], 'join' => $r['join_url'], 'mins' => (int)$r['mins']];
        }
        out(['players' => $players]);
    }
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') out(['error' => 'Method not allowed'], 405);
    $raw = file_get_contents('php://input');
    $in = json_decode($raw, true);
    if (!is_array($in)) out(['error' => 'Bad request'], 400);
    $sid = (string)($in['sid'] ?? '');
    if (!preg_match('/^[A-Za-z0-9_-]{8,40}$/', $sid)) out(['error' => 'Bad sid'], 400);
    if (!empty($in['leave'])) {
        $pdo->prepare('DELETE FROM site_presence WHERE sid = ?')->execute([$sid]);
        out(['ok' => true]);
    }
    $id = oi_identity($pdo);                                // null: no name yet (counted, never shown)
    $game = (string)($in['game'] ?? '');
    if (!preg_match('/^[a-z0-9_]{1,40}$/', $game)) out(['error' => 'Bad game'], 400);
    $title = clip($in['title'] ?? $game, 60);
    // play time since this tab's previous heartbeat
    $st = $pdo->prepare('SELECT game, TIMESTAMPDIFF(SECOND, updated_at, NOW()) AS gap FROM site_presence WHERE sid = ?');
    $st->execute([$sid]);
    $prev = $st->fetch();
    $add = $prev && $prev['game'] === $game ? max(0, min(HEARTBEAT_CAP, (int)$prev['gap'])) : 0;
    $newSession = !$prev || $prev['game'] !== $game;
    if ($add > 0 || $newSession) {
        $pdo->prepare('INSERT INTO site_playtime (day, name, game, registered, title, seconds, sessions) VALUES (CURDATE(), ?, ?, ?, ?, ?, ?)
                       ON DUPLICATE KEY UPDATE seconds = seconds + VALUES(seconds), sessions = sessions + VALUES(sessions),
                         registered = VALUES(registered), title = VALUES(title)')
            ->execute([$id ? $id['name'] : ANON, $game, $id && $id['registered'] ? 1 : 0, $title, $add, $newSession ? 1 : 0]);
    }
    $join = (string)($in['join'] ?? '');
    // only links to our own game pages (no other hosts, no javascript:)
    if (!preg_match('/^[a-z0-9_]+\.html(\?[A-Za-z0-9_=&%.\-]{0,120})?$/', $join)) $join = $game . '.html';
    $st = $pdo->prepare('INSERT INTO site_presence (sid, name, registered, game, title, status, join_url, started_at, updated_at)
                         VALUES (:sid, :name, :reg, :game, :title, :status, :join, NOW(), NOW())
                         ON DUPLICATE KEY UPDATE name = VALUES(name), registered = VALUES(registered),
                           started_at = IF(game = VALUES(game), started_at, NOW()), game = VALUES(game),
                           title = VALUES(title), status = VALUES(status), join_url = VALUES(join_url), updated_at = NOW()');
    $st->execute(['sid' => $sid, 'name' => $id ? $id['name'] : '', 'reg' => $id && $id['registered'] ? 1 : 0, 'game' => $game,
                  'title' => $title, 'status' => clip($in['status'] ?? '', 80), 'join' => $join]);
    out(['ok' => true]);
} catch (PDOException $e) {
    error_log('presence_api: ' . $e->getMessage());
    out(['error' => 'Server error'], 500);
}
