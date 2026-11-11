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

// GET - Read leaderboard or announcement
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $action = $_GET['action'] ?? 'leaderboard';

    if ($action === 'announcement') {
        $announcementFile = __DIR__ . '/announcement_geometry_dash.txt';
        $announcement = '';
        if (file_exists($announcementFile)) {
            $announcement = file_get_contents($announcementFile);
        }
        echo json_encode(['announcement' => $announcement]);
        exit;
    }

    try {
        $stmt = $pdo->query('SELECT id, player_name, score, timestamp FROM geometry_dash_scores ORDER BY score DESC, timestamp ASC LIMIT 10');
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

// POST - Save score, delete entry, or update announcement
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $contentType = $_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '';

    if (strpos($contentType, 'application/x-www-form-urlencoded') !== false) {
        parse_str(file_get_contents('php://input'), $postData);
        $action = $postData['action'] ?? $_POST['action'] ?? null;

        if ($action === 'delete') {
            $id = $postData['id'] ?? $_POST['id'] ?? null;
            $passwordHash = $postData['passwordHash'] ?? $_POST['passwordHash'] ?? '';

            $ADMIN_PASSWORD_HASH = '__ADMIN_PASSWORD_HASH__';

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
                $stmt = $pdo->prepare('DELETE FROM geometry_dash_scores WHERE id = :id');
                $stmt->execute(['id' => $id]);

                if ($stmt->rowCount() > 0) {
                    echo json_encode(['success' => true]);
                } else {
                    http_response_code(404);
                    echo json_encode(['error' => 'Entry not found']);
                }
                exit;
            } catch (PDOException $e) {
                http_response_code(500);
                echo json_encode(['error' => 'Failed to delete entry']);
                exit;
            }
        }

        if ($action === 'update_announcement') {
            $announcement = $postData['announcement'] ?? $_POST['announcement'] ?? '';
            $passwordHash = $postData['passwordHash'] ?? $_POST['passwordHash'] ?? '';

            $ADMIN_PASSWORD_HASH = '__ADMIN_PASSWORD_HASH__';

            if ($passwordHash !== $ADMIN_PASSWORD_HASH) {
                http_response_code(403);
                echo json_encode(['error' => 'Unauthorized']);
                exit;
            }

            $announcementFile = __DIR__ . '/announcement_geometry_dash.txt';
            file_put_contents($announcementFile, $announcement);

            echo json_encode(['success' => true]);
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

    $score = max(0, (int)$input['score']);
    $playerName = isset($input['name']) ? trim($input['name']) : 'Anonymous';

    if (strlen($playerName) > 50) {
        $playerName = substr($playerName, 0, 50);
    }
    if (empty($playerName)) {
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
        // One row per player_name: keep whichever score is higher, so a player resubmitting
        // a worse run never overwrites or duplicates their best.
        $stmt = $pdo->prepare('INSERT INTO geometry_dash_scores (player_name, score) VALUES (:player_name, :score)
            ON DUPLICATE KEY UPDATE score = GREATEST(score, VALUES(score)), timestamp = IF(VALUES(score) > score, CURRENT_TIMESTAMP, timestamp)');
        $stmt->execute([
            'player_name' => $playerName,
            'score' => $score
        ]);

        $stmt = $pdo->prepare('SELECT score FROM geometry_dash_scores WHERE player_name = :player_name');
        $stmt->execute(['player_name' => $playerName]);
        $storedScore = (int)$stmt->fetchColumn();

        $stmt = $pdo->prepare('SELECT COUNT(*) + 1 as `rank` FROM geometry_dash_scores WHERE score > :score');
        $stmt->execute(['score' => $storedScore]);
        $rankResult = $stmt->fetch(PDO::FETCH_ASSOC);
        $rank = (int)$rankResult['rank'];

        echo json_encode([
            'success' => true,
            'score' => $storedScore,
            'isNewBest' => $storedScore === $score,
            'rank' => $rank
        ]);
    } catch (PDOException $e) {
        http_response_code(500);
        error_log("Geometry Dash API Error: " . $e->getMessage());
        echo json_encode(['error' => 'Failed to save score', 'debug' => $e->getMessage()]);
    }
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);
