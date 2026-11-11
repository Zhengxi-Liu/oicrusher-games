<?php
// Shared Top 20 leaderboard for games that don't have their own *_api.php.
//   GET  ?game=flip_sizzle                      -> { leaderboard: [...] }
//   POST {"game": "...", "score": 123, "name": "..."} -> { success, id, rank }
//   POST (form) action=delete&game=...&id=...&passwordHash=...  (admin)
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST');
header('Access-Control-Allow-Headers: Content-Type');

// Database configuration
$host = 'localhost';
$dbname = 'games';
$username = 'root';
$password = '';

$LEADERBOARD_SIZE = 20;

// game id => highest believable score (anything above is rejected)
$GAMES = [
    'flip_sizzle'     => 10000,     // best flip streak in one run
    'rb_tree_defense' => 100000000, // points
    'pipeline'        => 10000000,  // requests served in endless mode
    'oxygen_colony'   => 100000,    // cycles survived
    'byzantine'       => 100000,    // campaign total
    'descent'         => 100000,    // floors*100 + time bonus + win bonus, x1.5 on hardcore
    'skyline_evade'   => 50000,     // time*100 + 10/graze, +3000 +1000/HP on a 100 s clear
];
// games whose score is a running total: keep one row per player name, raised when it improves
$ONE_PER_NAME = ['byzantine'];

// Handle preflight request
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

function fail($code, $msg) {
    http_response_code($code);
    echo json_encode(['error' => $msg]);
    exit;
}

try {
    $pdo = new PDO("mysql:host=$host;dbname=$dbname;charset=utf8mb4", $username, $password);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch (PDOException $e) {
    fail(500, 'Database connection failed');
}

// GET - Read leaderboard
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $game = $_GET['game'] ?? '';
    if (!isset($GAMES[$game])) fail(400, 'Unknown game');
    try {
        $stmt = $pdo->prepare("SELECT id, player_name, score, timestamp FROM game_scores WHERE game = :game ORDER BY score DESC, id ASC LIMIT $LEADERBOARD_SIZE");
        $stmt->execute(['game' => $game]);
        $results = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $leaderboard = array_map(function ($row, $index) {
            return [
                'id' => (int)$row['id'],
                'rank' => $index + 1,
                'name' => $row['player_name'] ?: 'Anonymous',
                'score' => (int)$row['score'],
                'timestamp' => $row['timestamp']
            ];
        }, $results, array_keys($results));

        echo json_encode(['leaderboard' => $leaderboard]);
    } catch (PDOException $e) {
        fail(500, 'Failed to read scores');
    }
    exit;
}

// POST - Save score with player name, or admin delete
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $contentType = $_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '';

    if (strpos($contentType, 'application/x-www-form-urlencoded') !== false) {
        parse_str(file_get_contents('php://input'), $postData);
        $action = $postData['action'] ?? $_POST['action'] ?? null;

        $ADMIN_PASSWORD_HASH = '__ADMIN_PASSWORD_HASH__';

        if ($action === 'delete') {
            $id = $postData['id'] ?? $_POST['id'] ?? null;
            $game = $postData['game'] ?? $_POST['game'] ?? '';
            $passwordHash = $postData['passwordHash'] ?? $_POST['passwordHash'] ?? '';

            if ($passwordHash !== $ADMIN_PASSWORD_HASH) fail(403, 'Unauthorized');
            if (!$id || !isset($GAMES[$game])) fail(400, 'ID and game required');
            try {
                $stmt = $pdo->prepare('DELETE FROM game_scores WHERE id = :id AND game = :game');
                $stmt->execute(['id' => $id, 'game' => $game]);
                if ($stmt->rowCount() > 0) {
                    echo json_encode(['success' => true]);
                } else {
                    fail(404, 'Entry not found');
                }
            } catch (PDOException $e) {
                fail(500, 'Failed to delete entry');
            }
            exit;
        }

        fail(400, 'Invalid request');
    }

    // Normal score submission (JSON)
    $input = json_decode(file_get_contents('php://input'), true);

    $game = isset($input['game']) ? (string)$input['game'] : '';
    if (!isset($GAMES[$game])) fail(400, 'Unknown game');

    if (!isset($input['score']) || !is_numeric($input['score'])) fail(400, 'Invalid score');
    $newScore = (int)$input['score'];
    if ($newScore <= 0 || $newScore > $GAMES[$game]) fail(400, 'Invalid score');

    $playerName = isset($input['name']) ? trim((string)$input['name']) : 'Anonymous';
    if (mb_strlen($playerName) > 20) {
        $playerName = mb_substr($playerName, 0, 20);
    }
    if ($playerName === '') {
        $playerName = 'Anonymous';
    }

    // the portal identity decides the name; registered names can't be borrowed (identity_lib.php)
    require_once __DIR__ . '/identity_lib.php';
    $playerName = oi_score_name($playerName);
    if ($playerName === null) {
        http_response_code(403);
        echo json_encode(['error' => 'That name belongs to a registered player. Log in on the game portal to use it.']);
        exit;
    }

    try {
        $newId = 0;
        if (in_array($game, $ONE_PER_NAME, true)) {
            $stmt = $pdo->prepare('SELECT id, score FROM game_scores WHERE game = :game AND player_name = :player_name ORDER BY score DESC LIMIT 1');
            $stmt->execute(['game' => $game, 'player_name' => $playerName]);
            $old = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($old) {
                $newId = (int)$old['id'];
                if ($newScore > (int)$old['score']) {
                    $stmt = $pdo->prepare('UPDATE game_scores SET score = :score, timestamp = CURRENT_TIMESTAMP WHERE id = :id');
                    $stmt->execute(['score' => $newScore, 'id' => $newId]);
                } else {
                    $newScore = (int)$old['score'];
                }
            }
        }
        if (!$newId) {
            $stmt = $pdo->prepare('INSERT INTO game_scores (game, score, player_name) VALUES (:game, :score, :player_name)');
            $stmt->execute(['game' => $game, 'score' => $newScore, 'player_name' => $playerName]);
            $newId = (int)$pdo->lastInsertId();
        }

        // rank uses the same ordering as the leaderboard (ties: earlier entry first)
        $stmt = $pdo->prepare('SELECT COUNT(*) + 1 AS `rank` FROM game_scores WHERE game = :game AND (score > :score OR (score = :score2 AND id < :id))');
        $stmt->execute(['game' => $game, 'score' => $newScore, 'score2' => $newScore, 'id' => $newId]);
        $rank = (int)$stmt->fetch(PDO::FETCH_ASSOC)['rank'];

        echo json_encode(['success' => true, 'id' => $newId, 'rank' => $rank]);
    } catch (PDOException $e) {
        http_response_code(500);
        error_log('Scores API Error: ' . $e->getMessage());
        echo json_encode(['error' => 'Failed to save score']);
    }
    exit;
}

fail(405, 'Method not allowed');
