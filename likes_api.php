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

// One like per game per browser (client id); a cleared browser can like again, but only a few times per IP per day
$MAX_PER_IP_PER_DAY = 3;

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

function valid_client($c) {
    return is_string($c) && preg_match('/^[a-f0-9]{32}$/', $c);
}

// GET - like counts for every game, plus which ones this browser already liked
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    try {
        $counts = [];
        $stmt = $pdo->query('SELECT game, COUNT(*) AS n FROM game_likes GROUP BY game');
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $counts[$row['game']] = (int)$row['n'];
        }
        $mine = [];
        $client = $_GET['client'] ?? '';
        if (valid_client($client)) {
            $stmt = $pdo->prepare('SELECT game FROM game_likes WHERE client_id = :c');
            $stmt->execute(['c' => $client]);
            $mine = $stmt->fetchAll(PDO::FETCH_COLUMN);
        }
        echo json_encode(['counts' => (object)$counts, 'mine' => $mine]);
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to read likes']);
    }
    exit;
}

// POST - like a game: {"game": "snake", "client": "<32 hex>"}
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    $game = is_array($input) ? ($input['game'] ?? '') : '';
    $client = is_array($input) ? ($input['client'] ?? '') : '';

    // only real games on this site can be liked
    if (!is_string($game) || !preg_match('/^[a-z0-9_]{1,40}$/', $game) || !file_exists(__DIR__ . '/' . $game . '.html') || !valid_client($client)) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid request']);
        exit;
    }

    $ip = $_SERVER['REMOTE_ADDR'] ?? '';

    try {
        $stmt = $pdo->prepare('SELECT COUNT(*) FROM game_likes WHERE game = :g AND client_id = :c');
        $stmt->execute(['g' => $game, 'c' => $client]);
        $already = (int)$stmt->fetchColumn() > 0;

        if (!$already) {
            $stmt = $pdo->prepare('SELECT COUNT(*) FROM game_likes WHERE game = :g AND ip = :ip AND created_at > NOW() - INTERVAL 1 DAY');
            $stmt->execute(['g' => $game, 'ip' => $ip]);
            if ((int)$stmt->fetchColumn() >= $MAX_PER_IP_PER_DAY) {
                http_response_code(429);
                echo json_encode(['error' => 'Too many likes from this network today']);
                exit;
            }
            $stmt = $pdo->prepare('INSERT IGNORE INTO game_likes (game, client_id, ip) VALUES (:g, :c, :ip)');
            $stmt->execute(['g' => $game, 'c' => $client, 'ip' => $ip]);
        }

        $stmt = $pdo->prepare('SELECT COUNT(*) FROM game_likes WHERE game = :g');
        $stmt->execute(['g' => $game]);
        echo json_encode(['success' => true, 'game' => $game, 'count' => (int)$stmt->fetchColumn(), 'liked' => true]);
    } catch (PDOException $e) {
        http_response_code(500);
        error_log('Likes API Error: ' . $e->getMessage());
        echo json_encode(['error' => 'Failed to save like']);
    }
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);
