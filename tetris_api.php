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
    
    if ($action === 'announcement') {
        // Return announcement from text file
        $announcementFile = __DIR__ . '/announcement_tetris.txt';
        $announcement = '';
        if (file_exists($announcementFile)) {
            $announcement = file_get_contents($announcementFile);
        }
        echo json_encode(['announcement' => $announcement]);
        exit;
    }
    
    try {
        if ($action === 'leaderboard') {
            // Return top 10 scores with names
            $stmt = $pdo->query('SELECT id, player_name, score, timestamp FROM tetris_scores ORDER BY score DESC LIMIT 10');
            $results = $stmt->fetchAll(PDO::FETCH_ASSOC);
            
            $leaderboard = array_map(function($row, $index) {
                return [
                    'id' => (int)$row['id'],
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
            $stmt = $pdo->query('SELECT score, timestamp FROM tetris_scores ORDER BY score DESC LIMIT 1');
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

// POST - Save score with player name or delete entry
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $contentType = $_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '';
    
    // Check if it's a delete request (form-urlencoded)
    if (strpos($contentType, 'application/x-www-form-urlencoded') !== false) {
        parse_str(file_get_contents('php://input'), $postData);
        $action = $postData['action'] ?? $_POST['action'] ?? null;
        
        if ($action === 'delete') {
            $id = $postData['id'] ?? $_POST['id'] ?? null;
            $passwordHash = $postData['passwordHash'] ?? $_POST['passwordHash'] ?? '';
            
            $ADMIN_PASSWORD_HASH = '__ADMIN_PASSWORD_HASH__';
            
            // Verify admin password hash
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
                // Delete directly by id
                $stmt = $pdo->prepare('DELETE FROM tetris_scores WHERE id = :id');
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
        
        // Handle announcement update
        if ($action === 'update_announcement') {
            $announcement = $postData['announcement'] ?? $_POST['announcement'] ?? '';
            $passwordHash = $postData['passwordHash'] ?? $_POST['passwordHash'] ?? '';
            
            $ADMIN_PASSWORD_HASH = '__ADMIN_PASSWORD_HASH__';
            
            // Verify admin password hash
            if ($passwordHash !== $ADMIN_PASSWORD_HASH) {
                http_response_code(403);
                echo json_encode(['error' => 'Unauthorized']);
                exit;
            }
            
            // Write announcement to text file
            $announcementFile = __DIR__ . '/announcement_tetris.txt';
            file_put_contents($announcementFile, $announcement);
            
            echo json_encode(['success' => true]);
            exit;
        }
        
        // If we get here with form-urlencoded but not delete action, it's an error
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
    $playerName = isset($input['name']) ? trim($input['name']) : 'Anonymous';
    
    // Validate and sanitize player name
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
        // Get current high score
        $stmt = $pdo->query('SELECT MAX(score) as max_score FROM tetris_scores');
        $result = $stmt->fetch(PDO::FETCH_ASSOC);
        $currentHighScore = $result['max_score'] ? (int)$result['max_score'] : 0;
        
        // Insert new score with player name
        $stmt = $pdo->prepare('INSERT INTO tetris_scores (score, player_name) VALUES (:score, :player_name)');
        $stmt->execute([
            'score' => $newScore,
            'player_name' => $playerName
        ]);
        
        $isNewRecord = $newScore > $currentHighScore;
        
        // Calculate rank
        $stmt = $pdo->prepare('SELECT COUNT(*) + 1 as `rank` FROM tetris_scores WHERE score > :score');
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
        error_log("Tetris API Error: " . $e->getMessage());
        echo json_encode(['error' => 'Failed to save score', 'debug' => $e->getMessage()]);
    }
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);
?>
        // Insert new score
        $stmt = $pdo->prepare('INSERT INTO tetris_scores (score) VALUES (:score)');
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
