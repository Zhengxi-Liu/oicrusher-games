<?php
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
$MAX_SCORE = 100000; // metres; anything above this is not a real run

// Handle preflight request
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

try {
    $pdo = new PDO("mysql:host=$host;dbname=$dbname;charset=utf8mb4", $username, $password);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Database connection failed']);
    exit;
}

// GET - Read leaderboard
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    try {
        $stmt = $pdo->query("SELECT id, player_name, score, timestamp FROM mud_runner_scores ORDER BY score DESC, timestamp ASC LIMIT $LEADERBOARD_SIZE");
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
        http_response_code(500);
        echo json_encode(['error' => 'Failed to read scores']);
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
            $passwordHash = $postData['passwordHash'] ?? $_POST['passwordHash'] ?? '';

            if ($passwordHash !== $ADMIN_PASSWORD_HASH) {
                http_response_code(403);
                echo json_encode(['error' => 'Unauthorized']);
                exit;
            }
            if (!$id) {
                http_response_code(400);
                echo json_encode(['error' => 'ID required']);
                exit;
            }
            try {
                $stmt = $pdo->prepare('DELETE FROM mud_runner_scores WHERE id = :id');
                $stmt->execute(['id' => $id]);
                if ($stmt->rowCount() > 0) {
                    echo json_encode(['success' => true]);
                } else {
                    http_response_code(404);
                    echo json_encode(['error' => 'Entry not found']);
                }
            } catch (PDOException $e) {
                http_response_code(500);
                echo json_encode(['error' => 'Failed to delete entry']);
            }
            exit;
        }

        http_response_code(400);
        echo json_encode(['error' => 'Invalid request']);
        exit;
    }

    // Normal score submission (JSON)
    $input = json_decode(file_get_contents('php://input'), true);

    if (!isset($input['score']) || !is_numeric($input['score'])) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid score']);
        exit;
    }

    $newScore = (int)$input['score'];
    if ($newScore <= 0 || $newScore > $MAX_SCORE) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid score']);
        exit;
    }

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
        $stmt = $pdo->prepare('INSERT INTO mud_runner_scores (score, player_name) VALUES (:score, :player_name)');
        $stmt->execute(['score' => $newScore, 'player_name' => $playerName]);
        $newId = (int)$pdo->lastInsertId();

        // rank uses the same ordering as the leaderboard (ties: earlier entry first)
        $stmt = $pdo->prepare('SELECT COUNT(*) + 1 AS `rank` FROM mud_runner_scores WHERE score > :score OR (score = :score2 AND id < :id)');
        $stmt->execute(['score' => $newScore, 'score2' => $newScore, 'id' => $newId]);
        $rank = (int)$stmt->fetch(PDO::FETCH_ASSOC)['rank'];

        echo json_encode(['success' => true, 'id' => $newId, 'rank' => $rank]);
    } catch (PDOException $e) {
        http_response_code(500);
        error_log('Mud Runner API Error: ' . $e->getMessage());
        echo json_encode(['error' => 'Failed to save score']);
    }
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);
