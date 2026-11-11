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

// GET - Read high score or leaderboard
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $action = $_GET['action'] ?? 'highscore';
    
    try {
        if ($action === 'leaderboard') {
            // Return top 10 scores with names
            $stmt = $pdo->query('SELECT player_name, score, timestamp FROM snake_scores ORDER BY score DESC LIMIT 10');
            $results = $stmt->fetchAll(PDO::FETCH_ASSOC);
            
            $leaderboard = array_map(function($row, $index) {
                return [
                    'rank' => $index + 1,
                    'name' => $row['player_name'] ?: 'Anonymous',
                    'score' => (int)$row['score'],
                    'timestamp' => $row['timestamp']
                ];
            }, $results, array_keys($results));
            
            echo json_encode([
                'leaderboard' => $leaderboard
            ]);
        } else {
            // Return highest score only (backward compatibility)
            $stmt = $pdo->query('SELECT score, timestamp FROM snake_scores ORDER BY score DESC LIMIT 1');
            $result = $stmt->fetch(PDO::FETCH_ASSOC);
            
            if ($result) {
                echo json_encode([
                    'highScore' => (int)$result['score'],
                    'timestamp' => $result['timestamp']
                ]);
            } else {
                echo json_encode(['highScore' => 0, 'timestamp' => date('Y-m-d H:i:s')]);
            }
        }
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to read scores']);
    }
    exit;
}

// POST - Save score with player name
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    
    if (!isset($input['score']) || !is_numeric($input['score'])) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid score']);
        exit;
    }
    
    $newScore = (int)$input['score'];
    $playerName = isset($input['name']) ? trim($input['name']) : 'Anonymous';
    
    // Validate and sanitize player name
    if (strlen($playerName) > 50) {
        $playerName = substr($playerName, 0, 50);
    }
    if (empty($playerName)) {
        $playerName = 'Anonymous';
    }
    
    try {
        // Get current high score
        $stmt = $pdo->query('SELECT MAX(score) as max_score FROM snake_scores');
        $result = $stmt->fetch(PDO::FETCH_ASSOC);
        $currentHighScore = $result['max_score'] ? (int)$result['max_score'] : 0;
        
        // Insert new score with player name
        $stmt = $pdo->prepare('INSERT INTO snake_scores (score, player_name) VALUES (:score, :player_name)');
        $stmt->execute([
            'score' => $newScore,
            'player_name' => $playerName
        ]);
        
        $isNewRecord = $newScore > $currentHighScore;
        
        // Calculate rank
        $stmt = $pdo->prepare('SELECT COUNT(*) + 1 as `rank` FROM snake_scores WHERE score > :score');
        $stmt->execute(['score' => $newScore]);
        $rankResult = $stmt->fetch(PDO::FETCH_ASSOC);
        $rank = (int)$rankResult['rank'];
        
        echo json_encode([
            'success' => true,
            'highScore' => $isNewRecord ? $newScore : $currentHighScore,
            'newRecord' => $isNewRecord,
            'rank' => $rank
        ]);
    } catch (PDOException $e) {
        http_response_code(500);
        error_log("Snake API Error: " . $e->getMessage());
        echo json_encode(['error' => 'Failed to save score', 'debug' => $e->getMessage()]);
    }
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);
?>
        // Insert new score
        $stmt = $pdo->prepare('INSERT INTO snake_scores (score) VALUES (:score)');
        $stmt->execute(['score' => $newScore]);
        
        $isNewRecord = $newScore > $currentHighScore;
        
        echo json_encode([
            'success' => true,
            'highScore' => $isNewRecord ? $newScore : $currentHighScore,
            'newRecord' => $isNewRecord
        ]);
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to save score']);
    }
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);
?>
