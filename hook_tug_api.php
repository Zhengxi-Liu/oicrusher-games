<?php
declare(strict_types=1);

/**
 * Hook & Tug - online lobby (who is online + challenges) and WebRTC signaling relay.
 *
 * Every request is POST JSON: { "action": "...", ... }.
 * PHP only matches players and passes SDP / ICE messages between them; once the
 * DataChannel opens, the challenger's browser runs the physics and PHP only sees
 * a heartbeat every few seconds. Auth is a per-session token handed out by `hello`.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

const PRESENCE_TTL     = 12;    // seconds a player stays listed after their last poll
const INVITE_TTL       = 30;    // seconds an unanswered challenge stays alive
const MATCH_TTL        = 45;    // a match ends once nobody has sent a heartbeat for this long
const RELAY_TTL        = 300;   // undelivered signaling messages are pruned after this
const MAX_SIGNALS      = 40;    // messages accepted per call
const MAX_MATCH_SIGNALS = 300;  // a handshake needs ~2 SDPs + a few dozen ICE candidates
const MAX_PAYLOAD      = 8192;  // bytes per message (an SDP offer is ~1-3 KB)
const HISTORY_SIZE     = 10;
const HISTORY_DAYS     = 30;
const RESULT_GAP       = 20;    // seconds between two results from the same match

$HOST = 'localhost';
$DB   = 'games';
$USER = 'root';
$PASS = '';

function respond(array $data, int $code = 200): void {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(string $message, int $code = 400): void {
    respond(['ok' => false, 'error' => $message], $code);
}

/** Collapse whitespace, drop control characters, clamp to 2-16 visible characters. */
function cleanName(mixed $raw): string {
    if (!is_string($raw)) {
        fail('Invalid name');
    }
    $name = preg_replace('/[\x00-\x1F\x7F<>]/u', '', $raw) ?? '';
    $name = trim(preg_replace('/\s+/u', ' ', $name) ?? '');
    $len = mb_strlen($name, 'UTF-8');
    if ($len < 2 || $len > 16) {
        fail('Name must be 2-16 characters');
    }
    // the portal identity decides the name; registered names can't be borrowed (identity_lib.php)
    require_once __DIR__ . '/identity_lib.php';
    $name = oi_score_name($name);
    if ($name === null) {
        fail('That name belongs to a registered player. Log in on the game portal to use it.');
    }
    return $name;
}

function intArg(array $body, string $key): int {
    $value = $body[$key] ?? null;
    if (!is_int($value) && !(is_string($value) && ctype_digit($value))) {
        fail('Missing ' . $key);
    }
    return (int)$value;
}

function clampInt(mixed $value, int $min, int $max): int {
    $n = is_numeric($value) ? (int)$value : 0;
    return max($min, min($max, $n));
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fail('POST only', 405);
}

$raw = file_get_contents('php://input');
if ($raw === false || strlen($raw) > 256 * 1024) {
    fail('Bad request body');
}
$body = json_decode($raw, true);
if (!is_array($body)) {
    fail('Bad JSON');
}
$action = is_string($body['action'] ?? null) ? $body['action'] : '';

try {
    $pdo = new PDO("mysql:host=$HOST;dbname=$DB;charset=utf8mb4", $USER, $PASS, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
} catch (PDOException $e) {
    respond(['ok' => false, 'error' => 'Database unavailable'], 500);
}

/** Expire challenges, abandoned matches, departed players and stale relay messages. */
function sweep(PDO $pdo): void {
    $pdo->exec('UPDATE hook_tug_invites SET state = "cancelled"
                WHERE state = "pending" AND created_at < (NOW() - INTERVAL ' . INVITE_TTL . ' SECOND)');
    $pdo->exec('UPDATE hook_tug_matches SET state = "ended"
                WHERE state = "active" AND updated_at < (NOW() - INTERVAL ' . MATCH_TTL . ' SECOND)');
    $pdo->exec('DELETE FROM hook_tug_matches WHERE state = "ended" AND updated_at < (NOW() - INTERVAL 1 HOUR)');
    $pdo->exec('DELETE FROM hook_tug_invites WHERE state <> "pending" AND created_at < (NOW() - INTERVAL 1 HOUR)');
    $pdo->exec('DELETE FROM hook_tug_players WHERE last_seen < (NOW() - INTERVAL 10 MINUTE)');
    $pdo->exec('DELETE FROM hook_tug_relay WHERE created_at < (NOW() - INTERVAL ' . RELAY_TTL . ' SECOND)');
    $pdo->exec('DELETE FROM hook_tug_history WHERE played_at < (NOW() - INTERVAL ' . HISTORY_DAYS . ' DAY)');
}

function authenticate(PDO $pdo, array $body): array {
    $id = intArg($body, 'id');
    $token = $body['token'] ?? '';
    if (!is_string($token) || !preg_match('/^[0-9a-f]{32}$/', $token)) {
        fail('Invalid token', 401);
    }
    $stmt = $pdo->prepare('SELECT id, name, token FROM hook_tug_players WHERE id = ?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if (!$row || !hash_equals((string)$row['token'], $token)) {
        fail('Session expired', 401);
    }
    return $row;
}

function markSeen(PDO $pdo, int $id): void {
    $pdo->prepare('UPDATE hook_tug_players SET last_seen = NOW() WHERE id = ?')->execute([$id]);
}

function isOnline(PDO $pdo, int $id): bool {
    $stmt = $pdo->prepare('SELECT 1 FROM hook_tug_players
                           WHERE id = ? AND last_seen >= (NOW() - INTERVAL ' . PRESENCE_TTL . ' SECOND)');
    $stmt->execute([$id]);
    return (bool)$stmt->fetch();
}

function activeMatch(PDO $pdo, int $id): ?array {
    $stmt = $pdo->prepare('SELECT * FROM hook_tug_matches
                           WHERE state = "active" AND (host_id = ? OR guest_id = ?)
                           ORDER BY id DESC LIMIT 1');
    $stmt->execute([$id, $id]);
    $row = $stmt->fetch();
    return $row ?: null;
}

function matchView(array $m, int $me): array {
    $isHost = (int)$m['host_id'] === $me;
    return [
        'id'       => (int)$m['id'],
        'role'     => $isHost ? 'host' : 'guest',
        'opponent' => [
            'id'   => $isHost ? (int)$m['guest_id'] : (int)$m['host_id'],
            'name' => $isHost ? (string)$m['guest_name'] : (string)$m['host_name'],
        ],
    ];
}

function playerName(PDO $pdo, int $id): string {
    $stmt = $pdo->prepare('SELECT name FROM hook_tug_players WHERE id = ?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    return $row ? (string)$row['name'] : 'Unknown';
}

/** The caller's match by id, or fail. */
function ownMatch(PDO $pdo, array $body, int $me): array {
    $stmt = $pdo->prepare('SELECT * FROM hook_tug_matches WHERE id = ? AND (host_id = ? OR guest_id = ?)');
    $stmt->execute([intArg($body, 'match'), $me, $me]);
    $m = $stmt->fetch();
    if (!$m) {
        fail('Unknown match', 404);
    }
    return $m;
}

function recentMatches(PDO $pdo): array {
    $stmt = $pdo->query(
        'SELECT UNIX_TIMESTAMP(played_at) AS ts, host_name, guest_name, host_score, guest_score, duration_sec
         FROM hook_tug_history ORDER BY id DESC LIMIT ' . HISTORY_SIZE
    );
    return array_map(static fn(array $r) => [
        'ts'  => (int)$r['ts'],
        'a'   => (string)$r['host_name'],
        'b'   => (string)$r['guest_name'],
        'sa'  => (int)$r['host_score'],
        'sb'  => (int)$r['guest_score'],
        'dur' => (int)$r['duration_sec'],
    ], $stmt->fetchAll());
}

try {
    sweep($pdo);

    switch ($action) {

        // Enter the lobby. Reuses the session the tab already holds when it is still valid.
        case 'hello': {
            $name = cleanName($body['name'] ?? '');
            $token = $body['token'] ?? null;
            if (is_string($token) && preg_match('/^[0-9a-f]{32}$/', $token) && isset($body['id'])) {
                $stmt = $pdo->prepare('SELECT id, token FROM hook_tug_players WHERE id = ?');
                $stmt->execute([intArg($body, 'id')]);
                $row = $stmt->fetch();
                if ($row && hash_equals((string)$row['token'], $token)) {
                    $pdo->prepare('UPDATE hook_tug_players SET name = ?, last_seen = NOW() WHERE id = ?')
                        ->execute([$name, (int)$row['id']]);
                    respond(['ok' => true, 'id' => (int)$row['id'], 'token' => $token, 'name' => $name]);
                }
            }
            $fresh = bin2hex(random_bytes(16));
            $pdo->prepare('INSERT INTO hook_tug_players (name, token, last_seen, created_at) VALUES (?, ?, NOW(), NOW())')
                ->execute([$name, $fresh]);
            respond(['ok' => true, 'id' => (int)$pdo->lastInsertId(), 'token' => $fresh, 'name' => $name]);
        }

        case 'lobby': {
            $me = authenticate($pdo, $body);
            $id = (int)$me['id'];
            markSeen($pdo, $id);

            $match = activeMatch($pdo, $id);
            $stmt = $pdo->prepare(
                'SELECT p.id, p.name,
                        EXISTS(SELECT 1 FROM hook_tug_matches m
                               WHERE m.state = "active" AND (m.host_id = p.id OR m.guest_id = p.id)) AS busy,
                        EXISTS(SELECT 1 FROM hook_tug_invites i
                               WHERE i.state = "pending" AND (i.from_id = p.id OR i.to_id = p.id)) AS pending
                 FROM hook_tug_players p
                 WHERE p.id <> ? AND p.last_seen >= (NOW() - INTERVAL ' . PRESENCE_TTL . ' SECOND)
                 ORDER BY p.name ASC LIMIT 60'
            );
            $stmt->execute([$id]);
            $players = array_map(static fn(array $r) => [
                'id'     => (int)$r['id'],
                'name'   => (string)$r['name'],
                'status' => $r['busy'] ? 'busy' : ($r['pending'] ? 'pending' : 'idle'),
            ], $stmt->fetchAll());

            $stmt = $pdo->prepare('SELECT id, from_id FROM hook_tug_invites
                                   WHERE to_id = ? AND state = "pending" ORDER BY id DESC LIMIT 1');
            $stmt->execute([$id]);
            $in = $stmt->fetch();

            $stmt = $pdo->prepare('SELECT id, to_id, state FROM hook_tug_invites
                                   WHERE from_id = ? ORDER BY id DESC LIMIT 1');
            $stmt->execute([$id]);
            $out = $stmt->fetch();

            respond([
                'ok'       => true,
                'players'  => $players,
                'invite'   => $in ? ['id' => (int)$in['id'], 'from' => (int)$in['from_id'],
                                     'name' => playerName($pdo, (int)$in['from_id'])] : null,
                'outgoing' => $out ? ['id' => (int)$out['id'], 'to' => (int)$out['to_id'], 'state' => (string)$out['state'],
                                      'name' => playerName($pdo, (int)$out['to_id'])] : null,
                'match'    => $match ? matchView($match, $id) : null,
                // Only sent when asked for, so the 2s lobby poll stays small.
                'recent'   => empty($body['recent']) ? null : recentMatches($pdo),
            ]);
        }

        case 'invite': {
            $me = authenticate($pdo, $body);
            $id = (int)$me['id'];
            $target = intArg($body, 'target');
            if ($target === $id) {
                fail('Cannot challenge yourself');
            }
            markSeen($pdo, $id);
            if (!isOnline($pdo, $target)) {
                fail('That player went offline');
            }
            if (activeMatch($pdo, $target) || activeMatch($pdo, $id)) {
                fail('Already in a match');
            }
            $stmt = $pdo->prepare('SELECT 1 FROM hook_tug_invites WHERE state = "pending" AND (from_id = ? OR to_id = ?)');
            $stmt->execute([$target, $target]);
            if ($stmt->fetch()) {
                fail('That player is already being challenged');
            }
            $pdo->prepare('UPDATE hook_tug_invites SET state = "cancelled" WHERE from_id = ? AND state = "pending"')
                ->execute([$id]);
            $pdo->prepare('INSERT INTO hook_tug_invites (from_id, to_id, state, created_at) VALUES (?, ?, "pending", NOW())')
                ->execute([$id, $target]);
            respond(['ok' => true, 'id' => (int)$pdo->lastInsertId(), 'name' => playerName($pdo, $target)]);
        }

        case 'cancel': {
            $me = authenticate($pdo, $body);
            $pdo->prepare('UPDATE hook_tug_invites SET state = "cancelled" WHERE from_id = ? AND state = "pending"')
                ->execute([(int)$me['id']]);
            respond(['ok' => true]);
        }

        case 'respond': {
            $me = authenticate($pdo, $body);
            $id = (int)$me['id'];
            $inviteId = intArg($body, 'invite');
            markSeen($pdo, $id);

            $stmt = $pdo->prepare('SELECT id, from_id FROM hook_tug_invites WHERE id = ? AND to_id = ? AND state = "pending"');
            $stmt->execute([$inviteId, $id]);
            $invite = $stmt->fetch();
            if (!$invite) {
                fail('That challenge expired');
            }
            if (empty($body['accept'])) {
                $pdo->prepare('UPDATE hook_tug_invites SET state = "declined" WHERE id = ?')->execute([$inviteId]);
                respond(['ok' => true, 'accepted' => false]);
            }
            $host = (int)$invite['from_id'];
            if (!isOnline($pdo, $host)) {
                $pdo->prepare('UPDATE hook_tug_invites SET state = "cancelled" WHERE id = ?')->execute([$inviteId]);
                fail('The challenger went offline');
            }
            // The challenger hosts: BLUE, cars[0], runs the authoritative physics.
            $pdo->prepare('INSERT INTO hook_tug_matches (host_id, guest_id, host_name, guest_name, state, created_at, updated_at)
                           VALUES (?, ?, ?, ?, "active", NOW(), NOW())')
                ->execute([$host, $id, playerName($pdo, $host), (string)$me['name']]);
            $matchId = (int)$pdo->lastInsertId();
            $pdo->prepare('UPDATE hook_tug_invites SET state = "accepted", match_id = ? WHERE id = ?')
                ->execute([$matchId, $inviteId]);

            $stmt = $pdo->prepare('SELECT * FROM hook_tug_matches WHERE id = ?');
            $stmt->execute([$matchId]);
            respond(['ok' => true, 'accepted' => true, 'match' => matchView($stmt->fetch(), $id)]);
        }

        // Heartbeat + mailbox for one match: store outgoing signals for the opponent, return incoming ones.
        case 'signal': {
            $me = authenticate($pdo, $body);
            $id = (int)$me['id'];
            markSeen($pdo, $id);
            $m = ownMatch($pdo, $body, $id);
            $matchId = (int)$m['id'];
            $other = (int)$m['host_id'] === $id ? (int)$m['guest_id'] : (int)$m['host_id'];
            $since = clampInt($body['since'] ?? 0, 0, PHP_INT_MAX);
            if ($m['state'] !== 'active') {
                respond(['ok' => true, 'ended' => true, 'msgs' => [], 'since' => $since]);
            }

            $out = $body['out'] ?? [];
            if (!is_array($out) || count($out) > MAX_SIGNALS) {
                fail('Too many messages');
            }
            if ($out) {
                $count = $pdo->prepare('SELECT COUNT(*) FROM hook_tug_relay WHERE match_id = ?');
                $count->execute([$matchId]);
                if ((int)$count->fetchColumn() + count($out) > MAX_MATCH_SIGNALS) {
                    fail('Too many signaling messages', 429);
                }
                $insert = $pdo->prepare('INSERT INTO hook_tug_relay (match_id, to_id, payload, created_at) VALUES (?, ?, ?, NOW())');
                foreach ($out as $msg) {
                    $payload = json_encode($msg, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
                    if ($payload === false || strlen($payload) > MAX_PAYLOAD) {
                        fail('Message too large');
                    }
                    $insert->execute([$matchId, $other, $payload]);
                }
            }
            $pdo->prepare('UPDATE hook_tug_matches SET updated_at = NOW() WHERE id = ?')->execute([$matchId]);

            $stmt = $pdo->prepare('SELECT id, payload FROM hook_tug_relay
                                   WHERE match_id = ? AND to_id = ? AND id > ? ORDER BY id ASC LIMIT 100');
            $stmt->execute([$matchId, $id, $since]);
            $msgs = [];
            foreach ($stmt->fetchAll() as $row) {
                $since = (int)$row['id'];
                $msgs[] = json_decode((string)$row['payload'], true);
            }
            respond(['ok' => true, 'ended' => false, 'msgs' => $msgs, 'since' => $since]);
        }

        case 'end': {
            $me = authenticate($pdo, $body);
            $m = ownMatch($pdo, $body, (int)$me['id']);
            $pdo->prepare('UPDATE hook_tug_matches SET state = "ended", updated_at = NOW() WHERE id = ?')
                ->execute([(int)$m['id']]);
            respond(['ok' => true]);
        }

        // Leaving the lobby / closing the tab: drop out of the list, end matches, withdraw challenges.
        case 'bye': {
            $me = authenticate($pdo, $body);
            $id = (int)$me['id'];
            $pdo->prepare('UPDATE hook_tug_matches SET state = "ended", updated_at = NOW()
                           WHERE state = "active" AND (host_id = ? OR guest_id = ?)')->execute([$id, $id]);
            $pdo->prepare('UPDATE hook_tug_invites SET state = "cancelled"
                           WHERE state = "pending" AND (from_id = ? OR to_id = ?)')->execute([$id, $id]);
            $pdo->prepare('UPDATE hook_tug_players SET last_seen = (NOW() - INTERVAL 1 HOUR) WHERE id = ?')->execute([$id]);
            respond(['ok' => true]);
        }

        // The host reports a finished first-to-5 match. Trusting the host is fine: it
        // already owns the physics, and this is a casual history list, not a ranked ladder.
        case 'result': {
            $me = authenticate($pdo, $body);
            $m = ownMatch($pdo, $body, (int)$me['id']);
            if ((int)$m['host_id'] !== (int)$me['id']) {
                fail('Only the host reports results', 403);
            }
            $matchId = (int)$m['id'];
            $recent = $pdo->prepare('SELECT COUNT(*) FROM hook_tug_history
                                     WHERE match_id = ? AND played_at >= (NOW() - INTERVAL ' . RESULT_GAP . ' SECOND)');
            $recent->execute([$matchId]);
            if ((int)$recent->fetchColumn() > 0) {
                respond(['ok' => true, 'skipped' => true]);
            }
            $pdo->prepare('INSERT INTO hook_tug_history
                (match_id, played_at, host_name, guest_name, host_score, guest_score, duration_sec)
                VALUES (?, NOW(), ?, ?, ?, ?, ?)')
                ->execute([
                    $matchId, (string)$m['host_name'], (string)$m['guest_name'],
                    clampInt($body['hostScore'] ?? 0, 0, 99),
                    clampInt($body['guestScore'] ?? 0, 0, 99),
                    clampInt($body['duration'] ?? 0, 0, 7200),
                ]);
            respond(['ok' => true]);
        }

        default:
            fail('Unknown action');
    }
} catch (PDOException $e) {
    respond(['ok' => false, 'error' => 'Database error'], 500);
}
