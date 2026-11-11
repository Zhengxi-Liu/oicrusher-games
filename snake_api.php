<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST');
header('Access-Control-Allow-Headers: Content-Type');

$scoreFile = __DIR__ . '/snake_scores.json';

// Handle preflight request
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

// GET - Read leaderboard or high score
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $action = $_GET['action'] ?? 'highscore';
    
    if ($action === 'announcement') {
        // Return announcement
        if (file_exists($scoreFile)) {
            $data = json_decode(file_get_contents($scoreFile), true);
            echo json_encode(['announcement' => $data['announcement'] ?? '']);
        } else {
            echo json_encode(['announcement' => '']);
        }
        exit;
    } elseif ($action === 'leaderboard') {
        // Return top 10 scores with names
        if (file_exists($scoreFile)) {
            $data = json_decode(file_get_contents($scoreFile), true);
            $scores = $data['scores'] ?? [];
            
            // Sort by score descending
            usort($scores, function($a, $b) {
                return $b['score'] - $a['score'];
            });
            
            // Get top 10
            $top10 = array_slice($scores, 0, 10);
            
            // Format leaderboard
            $leaderboard = array_map(function($item, $index) {
                return [
                    'id' => $index + 1, // Use rank as id for JSON file
                    'rank' => $index + 1,
                    'name' => $item['name'] ?? 'Anonymous',
                    'score' => (int)$item['score'],
                    'timestamp' => $item['timestamp'] ?? date('c')
                ];
            }, $top10, array_keys($top10));
            
            echo json_encode(['leaderboard' => $leaderboard]);
        } else {
            echo json_encode(['leaderboard' => []]);
        }
    } else {
        // Return highest score only (backward compatibility)
        if (file_exists($scoreFile)) {
            $data = json_decode(file_get_contents($scoreFile), true);
            $scores = $data['scores'] ?? [];
            
            if (count($scores) > 0) {
                // Find highest score
                $maxScore = max(array_column($scores, 'score'));
                echo json_encode(['highScore' => (int)$maxScore, 'timestamp' => date('c')]);
            } else {
                echo json_encode(['highScore' => 0, 'timestamp' => date('c')]);
            }
        } else {
            echo json_encode(['highScore' => 0, 'timestamp' => date('c')]);
        }
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
            
            // Load scores
            $scores = [];
            if (file_exists($scoreFile)) {
                $data = json_decode(file_get_contents($scoreFile), true);
                $scores = $data['scores'] ?? [];
            }
            
            // Sort to match leaderboard order
            usort($scores, function($a, $b) {
                return $b['score'] - $a['score'];
            });
            
            // Remove entry by index (id is the rank - 1)
            $index = (int)$id - 1;
            if ($index >= 0 && $index < count($scores)) {
                array_splice($scores, $index, 1);
                
                // Save back to file - preserve announcement
                $existingData = [];
                if (file_exists($scoreFile)) {
                    $existingData = json_decode(file_get_contents($scoreFile), true) ?? [];
                }
                $data = ['scores' => $scores];
                if (isset($existingData['announcement'])) {
                    $data['announcement'] = $existingData['announcement'];
                }
                
                file_put_contents($scoreFile, json_encode($data, JSON_PRETTY_PRINT));
                echo json_encode(['success' => true]);
                exit;
            } else {
                http_response_code(404);
                echo json_encode(['error' => 'Entry not found']);
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
            
            // Load existing data
            $data = ['scores' => []];
            if (file_exists($scoreFile)) {
                $existing = json_decode(file_get_contents($scoreFile), true);
                $data['scores'] = $existing['scores'] ?? [];
            }
            
            // Update announcement
            $data['announcement'] = $announcement;
            
            // Save back to file
            file_put_contents($scoreFile, json_encode($data, JSON_PRETTY_PRINT));
            
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
    
    // Read existing scores
    $scores = [];
    if (file_exists($scoreFile)) {
        $data = json_decode(file_get_contents($scoreFile), true);
        $scores = $data['scores'] ?? [];
    }
    
    // Get current high score
    $currentHighScore = 0;
    if (count($scores) > 0) {
        $currentHighScore = max(array_column($scores, 'score'));
    }
    
    // Add new score
    $scores[] = [
        'score' => $newScore,
        'name' => $playerName,
        'timestamp' => date('c')
    ];
    
    // Sort by score descending
    usort($scores, function($a, $b) {
        return $b['score'] - $a['score'];
    });
    
    // Calculate rank
    $rank = 1;
    foreach ($scores as $index => $item) {
        if ($item['score'] === $newScore && $item['name'] === $playerName) {
            $rank = $index + 1;
            break;
        }
    }
    
    // Save back to file
    // Preserve announcement if it exists
    $existingData = [];
    if (file_exists($scoreFile)) {
        $existingData = json_decode(file_get_contents($scoreFile), true) ?? [];
    }
    $data = ['scores' => $scores];
    if (isset($existingData['announcement'])) {
        $data['announcement'] = $existingData['announcement'];
    }
    file_put_contents($scoreFile, json_encode($data, JSON_PRETTY_PRINT));
    
    $isNewRecord = $newScore > $currentHighScore;
    
    echo json_encode([
        'success' => true,
        'highScore' => $isNewRecord ? $newScore : $currentHighScore,
        'newRecord' => $isNewRecord,
        'rank' => $rank
    ]);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);
?>
