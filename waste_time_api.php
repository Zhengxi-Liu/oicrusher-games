<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

$host     = 'localhost';
$dbname   = 'games';
$username = 'root';
$password = '';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit(0);
}

try {
    $pdo = new PDO("mysql:host=$host;dbname=$dbname;charset=utf8mb4", $username, $password);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    $pdo->exec("CREATE TABLE IF NOT EXISTS waste_time_scores (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        player_name VARCHAR(50)  NOT NULL,
        time_ms     BIGINT       NOT NULL,
        created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_time_ms (time_ms)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Database connection failed']);
    exit;
}

// ── GET: fetch leaderboard ────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    try {
        $stmt = $pdo->query(
            'SELECT id, player_name, time_ms, created_at
               FROM waste_time_scores
           ORDER BY time_ms DESC
              LIMIT 20'
        );
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $leaderboard = array_map(function ($row, $i) {
            return [
                'rank'      => $i + 1,
                'id'        => (int)$row['id'],
                'name'      => $row['player_name'],
                'time_ms'   => (int)$row['time_ms'],
                'timestamp' => $row['created_at'],
            ];
        }, $rows, array_keys($rows));

        echo json_encode(['leaderboard' => $leaderboard]);
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to fetch leaderboard']);
    }
    exit;
}

// ── POST: submit a score ──────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $body = file_get_contents('php://input');
    $data = json_decode($body, true);

    if (!is_array($data)) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid request body']);
        exit;
    }

    $name    = trim($data['player_name'] ?? '');
    $time_ms = isset($data['time_ms']) ? (int)$data['time_ms'] : 0;

    // Validate name: 1–30 chars, unicode letters/digits + safe punctuation
    if ($name === '' || mb_strlen($name) > 30) {
        http_response_code(400);
        echo json_encode(['error' => 'Name must be 1–30 characters']);
        exit;
    }
    if (!preg_match('/^[\p{L}\p{N} _\-\.]+$/u', $name)) {
        http_response_code(400);
        echo json_encode(['error' => 'Name contains invalid characters']);
        exit;
    }

    // the portal identity decides the name; registered names can't be borrowed (identity_lib.php)
    require_once __DIR__ . '/identity_lib.php';
    $name = oi_score_name($name);
    if ($name === null) {
        http_response_code(403);
        echo json_encode(['error' => 'That name belongs to a registered player. Log in on the game portal to use it.']);
        exit;
    }

    // Validate time: 500 ms minimum (half a second), 24 h maximum
    if ($time_ms < 500 || $time_ms > 86400000) {
        http_response_code(400);
        echo json_encode(['error' => 'Time must be between 0.5 seconds and 24 hours']);
        exit;
    }

    try {
        $insert = $pdo->prepare(
            'INSERT INTO waste_time_scores (player_name, time_ms) VALUES (:name, :time_ms)'
        );
        $insert->execute([':name' => $name, ':time_ms' => $time_ms]);

        // COUNT(*)+1 gives this entry's rank; avoid reserved word `rank` as alias
        $rankStmt = $pdo->prepare(
            'SELECT COUNT(*) + 1 AS player_rank FROM waste_time_scores WHERE time_ms > :time_ms'
        );
        $rankStmt->execute([':time_ms' => $time_ms]);
        $rank = (int)$rankStmt->fetchColumn();

        // Return fresh leaderboard with the response
        $stmt = $pdo->query(
            'SELECT id, player_name, time_ms, created_at
               FROM waste_time_scores
           ORDER BY time_ms DESC
              LIMIT 20'
        );
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $leaderboard = array_map(function ($row, $i) {
            return [
                'rank'      => $i + 1,
                'id'        => (int)$row['id'],
                'name'      => $row['player_name'],
                'time_ms'   => (int)$row['time_ms'],
                'timestamp' => $row['created_at'],
            ];
        }, $rows, array_keys($rows));

        echo json_encode([
            'success'   => true,
            'your_rank' => $rank,
            'leaderboard' => $leaderboard,
        ]);
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to save score']);
    }
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);
