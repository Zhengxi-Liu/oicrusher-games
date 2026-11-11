<?php
declare(strict_types=1);

/**
 * Cannon Duel - online duel lobby and event relay.
 *
 * Every request is POST JSON: { "action": "...", ... }.
 * Auth is a per-session token handed out by `join` and echoed back by the client;
 * it is never stored in a cookie server-side, so there is no CSRF surface.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

const PRESENCE_TTL = 15;   // seconds a player stays visible in the lobby after their last poll
const INVITE_TTL   = 30;   // seconds an unanswered challenge stays alive
const MATCH_TTL    = 60;   // a match is abandoned once nobody has synced for this long
const EVENT_TTL    = 180;  // relayed events are pruned after this
const MAX_EVENTS   = 24;   // events accepted per sync call
const MAX_PAYLOAD  = 2048; // bytes per event
const HISTORY_SIZE = 12;   // battles shown in the lobby
const HISTORY_DAYS = 30;   // how long a finished battle is kept

$HOST = 'localhost';
$DB   = 'games';
$USER = 'root';
$PASS = '';

function respond(array $data, int $code = 200): void {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function fail(string $message, int $code = 400): void {
    respond(['ok' => false, 'error' => $message], $code);
}

/** Collapse whitespace, drop control characters, clamp to 16 visible characters. */
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
    return $name;
}

function intArg(array $body, string $key): int {
    $value = $body[$key] ?? null;
    if (!is_int($value) && !(is_string($value) && ctype_digit($value))) {
        fail('Missing ' . $key);
    }
    return (int)$value;
}

/** Like cleanName() but for logged-after-the-fact data: never rejects, just sanitises. */
function safeName(mixed $raw): string {
    if (!is_string($raw)) {
        return 'Player';
    }
    $name = trim(preg_replace('/\s+/u', ' ', preg_replace('/[\x00-\x1F\x7F<>]/u', '', $raw) ?? '') ?? '');
    return $name === '' ? 'Player' : mb_substr($name, 0, 16, 'UTF-8');
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
if ($raw === false || strlen($raw) > 64 * 1024) {
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

/** Drop stale presence rows, invites, finished matches and relayed events. */
function sweep(PDO $pdo): void {
    $pdo->exec('UPDATE cannon_duel_invites SET state = "cancelled"
                WHERE state = "pending" AND created_at < (NOW() - INTERVAL ' . INVITE_TTL . ' SECOND)');

    $pdo->exec('UPDATE cannon_duel_matches SET state = "ended"
                WHERE state = "active" AND updated_at < (NOW() - INTERVAL ' . MATCH_TTL . ' SECOND)');

    $pdo->exec('DELETE FROM cannon_duel_events WHERE created_at < (NOW() - INTERVAL ' . EVENT_TTL . ' SECOND)');

    $pdo->exec('DELETE FROM cannon_duel_players WHERE last_seen < (NOW() - INTERVAL ' . (PRESENCE_TTL * 8) . ' SECOND)');

    $pdo->exec('DELETE FROM cannon_duel_matches
                WHERE state = "ended" AND updated_at < (NOW() - INTERVAL 1 HOUR)');

    $pdo->exec('DELETE FROM cannon_duel_history WHERE played_at < (NOW() - INTERVAL ' . HISTORY_DAYS . ' DAY)');
}

/** Most recent finished battles, newest first. */
function recentBattles(PDO $pdo): array {
    $stmt = $pdo->query(
        'SELECT UNIX_TIMESTAMP(played_at) AS ts, map_id, duration_sec, airbursts,
                winner_name, winner_hp, winner_shots, winner_hits, winner_damage,
                loser_name, loser_hp, loser_shots, loser_hits, loser_damage
         FROM cannon_duel_history ORDER BY id DESC LIMIT ' . HISTORY_SIZE
    );
    return array_map(static fn(array $r) => [
        'ts'  => (int)$r['ts'],
        'map' => (string)$r['map_id'],
        'dur' => (int)$r['duration_sec'],
        'air' => (int)$r['airbursts'],
        'w'   => ['name' => (string)$r['winner_name'], 'hp' => (int)$r['winner_hp'],
                  'shots' => (int)$r['winner_shots'], 'hits' => (int)$r['winner_hits'],
                  'dmg' => (int)$r['winner_damage']],
        'l'   => ['name' => (string)$r['loser_name'], 'hp' => (int)$r['loser_hp'],
                  'shots' => (int)$r['loser_shots'], 'hits' => (int)$r['loser_hits'],
                  'dmg' => (int)$r['loser_damage']],
    ], $stmt->fetchAll());
}

function authenticate(PDO $pdo, array $body): array {
    $id = intArg($body, 'id');
    $token = $body['token'] ?? '';
    if (!is_string($token) || !preg_match('/^[0-9a-f]{32}$/', $token)) {
        fail('Invalid token', 401);
    }
    $stmt = $pdo->prepare('SELECT id, name, token FROM cannon_duel_players WHERE id = ?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if (!$row || !hash_equals((string)$row['token'], $token)) {
        fail('Session expired', 401);
    }
    return $row;
}

function markSeen(PDO $pdo, int $id): void {
    $pdo->prepare('UPDATE cannon_duel_players SET last_seen = NOW() WHERE id = ?')->execute([$id]);
}

/** The player's live match, or null. */
function activeMatch(PDO $pdo, int $id): ?array {
    $stmt = $pdo->prepare('SELECT id, host_id, guest_id FROM cannon_duel_matches
                           WHERE state = "active" AND (host_id = ? OR guest_id = ?)
                           ORDER BY id DESC LIMIT 1');
    $stmt->execute([$id, $id]);
    $row = $stmt->fetch();
    return $row ?: null;
}

function playerName(PDO $pdo, int $id): string {
    $stmt = $pdo->prepare('SELECT name FROM cannon_duel_players WHERE id = ?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    return $row ? (string)$row['name'] : 'Unknown';
}

function matchView(PDO $pdo, array $match, int $me): array {
    $isHost = (int)$match['host_id'] === $me;
    $other = $isHost ? (int)$match['guest_id'] : (int)$match['host_id'];
    return [
        'id'       => (int)$match['id'],
        'role'     => $isHost ? 'host' : 'guest',
        'opponent' => ['id' => $other, 'name' => playerName($pdo, $other)],
    ];
}

function endMatch(PDO $pdo, int $matchId): void {
    $pdo->prepare('UPDATE cannon_duel_matches SET state = "ended", updated_at = NOW() WHERE id = ?')
        ->execute([$matchId]);
}

try {
    sweep($pdo);

    switch ($action) {

        case 'join': {
            $name = cleanName($body['name'] ?? '');
            $token = $body['token'] ?? null;

            // Reuse the existing row when the browser still holds a valid session.
            if (is_string($token) && preg_match('/^[0-9a-f]{32}$/', $token) && isset($body['id'])) {
                $stmt = $pdo->prepare('SELECT id, token FROM cannon_duel_players WHERE id = ?');
                $stmt->execute([intArg($body, 'id')]);
                $row = $stmt->fetch();
                if ($row && hash_equals((string)$row['token'], $token)) {
                    $pdo->prepare('UPDATE cannon_duel_players SET name = ?, last_seen = NOW() WHERE id = ?')
                        ->execute([$name, (int)$row['id']]);
                    respond(['ok' => true, 'id' => (int)$row['id'], 'token' => $token, 'name' => $name]);
                }
            }

            $fresh = bin2hex(random_bytes(16));
            $stmt = $pdo->prepare('INSERT INTO cannon_duel_players (name, token, last_seen, created_at)
                                   VALUES (?, ?, NOW(), NOW())');
            $stmt->execute([$name, $fresh]);
            respond(['ok' => true, 'id' => (int)$pdo->lastInsertId(), 'token' => $fresh, 'name' => $name]);
        }

        case 'rename': {
            $me = authenticate($pdo, $body);
            $name = cleanName($body['name'] ?? '');
            $pdo->prepare('UPDATE cannon_duel_players SET name = ?, last_seen = NOW() WHERE id = ?')
                ->execute([$name, (int)$me['id']]);
            respond(['ok' => true, 'name' => $name]);
        }

        case 'lobby': {
            $me = authenticate($pdo, $body);
            $id = (int)$me['id'];
            markSeen($pdo, $id);

            $match = activeMatch($pdo, $id);
            if ($match) {
                respond([
                    'ok'      => true,
                    'name'    => $me['name'],
                    'players' => [],
                    'match'   => matchView($pdo, $match, $id),
                ]);
            }

            $stmt = $pdo->prepare(
                'SELECT p.id, p.name,
                        EXISTS(SELECT 1 FROM cannon_duel_matches m
                               WHERE m.state = "active" AND (m.host_id = p.id OR m.guest_id = p.id)) AS busy,
                        EXISTS(SELECT 1 FROM cannon_duel_invites i
                               WHERE i.state = "pending" AND (i.from_id = p.id OR i.to_id = p.id)) AS pending
                 FROM cannon_duel_players p
                 WHERE p.id <> ? AND p.last_seen >= (NOW() - INTERVAL ' . PRESENCE_TTL . ' SECOND)
                 ORDER BY p.name ASC LIMIT 60'
            );
            $stmt->execute([$id]);
            $players = array_map(static fn(array $r) => [
                'id'     => (int)$r['id'],
                'name'   => (string)$r['name'],
                'status' => $r['busy'] ? 'busy' : ($r['pending'] ? 'pending' : 'idle'),
            ], $stmt->fetchAll());

            $stmt = $pdo->prepare('SELECT id, from_id FROM cannon_duel_invites
                                   WHERE to_id = ? AND state = "pending" ORDER BY id DESC LIMIT 1');
            $stmt->execute([$id]);
            $in = $stmt->fetch();

            $stmt = $pdo->prepare('SELECT id, to_id, state FROM cannon_duel_invites
                                   WHERE from_id = ? ORDER BY id DESC LIMIT 1');
            $stmt->execute([$id]);
            $out = $stmt->fetch();

            respond([
                'ok'       => true,
                'name'     => $me['name'],
                'players'  => $players,
                'invite'   => $in ? ['id' => (int)$in['id'], 'from' => (int)$in['from_id'],
                                     'name' => playerName($pdo, (int)$in['from_id'])] : null,
                'outgoing' => $out ? ['id' => (int)$out['id'], 'to' => (int)$out['to_id'],
                                      'state' => (string)$out['state'],
                                      'name' => playerName($pdo, (int)$out['to_id'])] : null,
                'match'    => null,
                // Only sent when asked for, so the 2s lobby poll stays small.
                'history'  => empty($body['history']) ? null : recentBattles($pdo),
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

            $stmt = $pdo->prepare('SELECT id FROM cannon_duel_players
                                   WHERE id = ? AND last_seen >= (NOW() - INTERVAL ' . PRESENCE_TTL . ' SECOND)');
            $stmt->execute([$target]);
            if (!$stmt->fetch()) {
                fail('That player went offline');
            }
            if (activeMatch($pdo, $target) || activeMatch($pdo, $id)) {
                fail('Already in a match');
            }

            $stmt = $pdo->prepare('SELECT 1 FROM cannon_duel_invites
                                   WHERE state = "pending" AND (from_id = ? OR to_id = ?)');
            $stmt->execute([$target, $target]);
            if ($stmt->fetch()) {
                fail('That player is already being challenged');
            }

            $pdo->prepare('UPDATE cannon_duel_invites SET state = "cancelled"
                           WHERE from_id = ? AND state = "pending"')->execute([$id]);
            $pdo->prepare('INSERT INTO cannon_duel_invites (from_id, to_id, state, created_at)
                           VALUES (?, ?, "pending", NOW())')->execute([$id, $target]);

            respond(['ok' => true, 'id' => (int)$pdo->lastInsertId(), 'name' => playerName($pdo, $target)]);
        }

        case 'cancel': {
            $me = authenticate($pdo, $body);
            $pdo->prepare('UPDATE cannon_duel_invites SET state = "cancelled"
                           WHERE from_id = ? AND state = "pending"')->execute([(int)$me['id']]);
            respond(['ok' => true]);
        }

        case 'respond': {
            $me = authenticate($pdo, $body);
            $id = (int)$me['id'];
            $inviteId = intArg($body, 'invite');
            $accept = !empty($body['accept']);
            markSeen($pdo, $id);

            $stmt = $pdo->prepare('SELECT id, from_id FROM cannon_duel_invites
                                   WHERE id = ? AND to_id = ? AND state = "pending"');
            $stmt->execute([$inviteId, $id]);
            $invite = $stmt->fetch();
            if (!$invite) {
                fail('That challenge expired');
            }

            if (!$accept) {
                $pdo->prepare('UPDATE cannon_duel_invites SET state = "declined" WHERE id = ?')
                    ->execute([$inviteId]);
                respond(['ok' => true, 'accepted' => false]);
            }

            // The challenger hosts, so they are always BLUE / players[0].
            $pdo->prepare('INSERT INTO cannon_duel_matches (host_id, guest_id, state, created_at, updated_at)
                           VALUES (?, ?, "active", NOW(), NOW())')
                ->execute([(int)$invite['from_id'], $id]);
            $matchId = (int)$pdo->lastInsertId();
            $pdo->prepare('UPDATE cannon_duel_invites SET state = "accepted", match_id = ? WHERE id = ?')
                ->execute([$matchId, $inviteId]);

            $match = ['id' => $matchId, 'host_id' => (int)$invite['from_id'], 'guest_id' => $id];
            respond(['ok' => true, 'accepted' => true, 'match' => matchView($pdo, $match, $id)]);
        }

        case 'sync': {
            $me = authenticate($pdo, $body);
            $id = (int)$me['id'];
            $matchId = intArg($body, 'match');
            markSeen($pdo, $id);

            $stmt = $pdo->prepare('SELECT id, host_id, guest_id, state FROM cannon_duel_matches
                                   WHERE id = ? AND (host_id = ? OR guest_id = ?)');
            $stmt->execute([$matchId, $id, $id]);
            $match = $stmt->fetch();
            if (!$match) {
                fail('Unknown match', 404);
            }
            if ($match['state'] !== 'active') {
                respond(['ok' => true, 'ended' => true, 'events' => [], 'since' => intArg($body, 'since')]);
            }

            $events = $body['events'] ?? [];
            if (!is_array($events) || count($events) > MAX_EVENTS) {
                fail('Too many events');
            }
            if ($events) {
                $insert = $pdo->prepare('INSERT INTO cannon_duel_events (match_id, sender_id, payload, created_at)
                                         VALUES (?, ?, ?, NOW())');
                foreach ($events as $event) {
                    $payload = json_encode($event, JSON_UNESCAPED_UNICODE);
                    if ($payload === false || strlen($payload) > MAX_PAYLOAD) {
                        continue;
                    }
                    $insert->execute([$matchId, $id, $payload]);
                }
            }
            $pdo->prepare('UPDATE cannon_duel_matches SET updated_at = NOW() WHERE id = ?')->execute([$matchId]);

            $since = max(0, intArg($body, 'since'));
            $stmt = $pdo->prepare('SELECT id, payload FROM cannon_duel_events
                                   WHERE match_id = ? AND sender_id <> ? AND id > ?
                                   ORDER BY id ASC LIMIT 200');
            $stmt->execute([$matchId, $id, $since]);

            $out = [];
            foreach ($stmt->fetchAll() as $row) {
                $since = max($since, (int)$row['id']);
                $decoded = json_decode((string)$row['payload'], true);
                if (is_array($decoded)) {
                    $out[] = $decoded;
                }
            }

            $other = (int)$match['host_id'] === $id ? (int)$match['guest_id'] : (int)$match['host_id'];
            $stmt = $pdo->prepare('SELECT 1 FROM cannon_duel_players
                                   WHERE id = ? AND last_seen >= (NOW() - INTERVAL ' . PRESENCE_TTL . ' SECOND)');
            $stmt->execute([$other]);

            respond([
                'ok'     => true,
                'ended'  => false,
                'alive'  => (bool)$stmt->fetch(),
                'since'  => $since,
                'events' => $out,
            ]);
        }

        case 'end': {
            $me = authenticate($pdo, $body);
            $id = (int)$me['id'];
            $matchId = intArg($body, 'match');
            $stmt = $pdo->prepare('SELECT id FROM cannon_duel_matches
                                   WHERE id = ? AND (host_id = ? OR guest_id = ?)');
            $stmt->execute([$matchId, $id, $id]);
            if ($stmt->fetch()) {
                endMatch($pdo, $matchId);
            }
            respond(['ok' => true]);
        }

        // Host-only. Retires the finished match and re-pairs the same two players in a new
        // one, so every round keeps its own event stream and its own battle-log row. The
        // guest notices because its next sync on the old match reports it as ended.
        case 'rematch': {
            $me = authenticate($pdo, $body);
            $id = (int)$me['id'];
            $matchId = intArg($body, 'match');
            markSeen($pdo, $id);

            $stmt = $pdo->prepare('SELECT id, guest_id FROM cannon_duel_matches
                                   WHERE id = ? AND host_id = ?');
            $stmt->execute([$matchId, $id]);
            $old = $stmt->fetch();
            if (!$old) {
                fail('Only the host can start a rematch', 403);
            }
            $guest = (int)$old['guest_id'];

            $stmt = $pdo->prepare('SELECT 1 FROM cannon_duel_players
                                   WHERE id = ? AND last_seen >= (NOW() - INTERVAL ' . PRESENCE_TTL . ' SECOND)');
            $stmt->execute([$guest]);
            if (!$stmt->fetch()) {
                fail('Your opponent went offline');
            }

            endMatch($pdo, $matchId);
            $pdo->prepare('INSERT INTO cannon_duel_matches (host_id, guest_id, state, created_at, updated_at)
                           VALUES (?, ?, "active", NOW(), NOW())')->execute([$id, $guest]);
            $new = ['id' => (int)$pdo->lastInsertId(), 'host_id' => $id, 'guest_id' => $guest];

            respond(['ok' => true, 'match' => matchView($pdo, $new, $id)]);
        }

        // Only the host reports a result, mirroring who owns damage resolution in game.
        // The unique key on match_id makes a retry harmless.
        case 'report': {
            $me = authenticate($pdo, $body);
            $id = (int)$me['id'];
            $matchId = intArg($body, 'match');

            $stmt = $pdo->prepare('SELECT host_id, guest_id FROM cannon_duel_matches
                                   WHERE id = ? AND host_id = ?');
            $stmt->execute([$matchId, $id]);
            $match = $stmt->fetch();
            if (!$match) {
                fail('Only the host records results', 403);
            }

            $winnerId = intArg($body, 'winner');
            $host = (int)$match['host_id'];
            $guest = (int)$match['guest_id'];
            if ($winnerId !== $host && $winnerId !== $guest) {
                fail('Winner is not in this match');
            }
            $loserId = $winnerId === $host ? $guest : $host;

            $w = is_array($body['w'] ?? null) ? $body['w'] : [];
            $l = is_array($body['l'] ?? null) ? $body['l'] : [];
            $mapId = in_array($body['map'] ?? '', ['hill', 'lake'], true) ? $body['map'] : 'lake';

            $stmt = $pdo->prepare(
                'INSERT IGNORE INTO cannon_duel_history
                 (match_id, played_at, map_id, duration_sec, airbursts,
                  winner_id, winner_name, winner_hp, winner_shots, winner_hits, winner_damage,
                  loser_id, loser_name, loser_hp, loser_shots, loser_hits, loser_damage)
                 VALUES (?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            );
            $stmt->execute([
                $matchId, $mapId,
                clampInt($body['dur'] ?? 0, 0, 65535),
                clampInt($body['air'] ?? 0, 0, 9999),
                $winnerId, safeName($w['name'] ?? null),
                clampInt($w['hp'] ?? 0, 0, 255), clampInt($w['shots'] ?? 0, 0, 9999),
                clampInt($w['hits'] ?? 0, 0, 9999), clampInt($w['dmg'] ?? 0, 0, 65535),
                $loserId, safeName($l['name'] ?? null),
                clampInt($l['hp'] ?? 0, 0, 255), clampInt($l['shots'] ?? 0, 0, 9999),
                clampInt($l['hits'] ?? 0, 0, 9999), clampInt($l['dmg'] ?? 0, 0, 65535),
            ]);

            respond(['ok' => true, 'history' => recentBattles($pdo)]);
        }

        case 'leave': {
            $me = authenticate($pdo, $body);
            $id = (int)$me['id'];
            $match = activeMatch($pdo, $id);
            if ($match) {
                endMatch($pdo, (int)$match['id']);
            }
            $pdo->prepare('UPDATE cannon_duel_invites SET state = "cancelled"
                           WHERE state = "pending" AND (from_id = ? OR to_id = ?)')->execute([$id, $id]);
            $pdo->prepare('DELETE FROM cannon_duel_players WHERE id = ?')->execute([$id]);
            respond(['ok' => true]);
        }

        default:
            fail('Unknown action');
    }
} catch (PDOException $e) {
    respond(['ok' => false, 'error' => 'Server error'], 500);
}
