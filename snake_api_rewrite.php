<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST');
header('Access-Control-Allow-Headers: Content-Type');

$scoreFile = __DIR__ . '/snake_scores.json';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

// GET requests
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $action = $_GET['action'] ?? 'leaderboard';
    
    if ($action === 'announcement') {
        $data = file_exists($scoreFile) ? json_decode(file_get_contents($scoreFile), true) : [];
        echo json_encode(['announcement' => $data['announcement'] ?? '']);
        exit;
    }
    
    if ($action === 'leaderboard') {
        if (file_exists($scoreFile)) {
            $data = json_decode(file_get_contents($scoreFile), true);
            $scores = $data['scores'] ?? [];
            
            usort($scores, function($a, $b) {
                return $b['score'] - $a['score'];
            });
            
            $top10 = array_slice($scores, 0, 10);
            
            $leaderboard = array_map(function($item, $index) {
                return [
                    'id' => $index + 1,
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
        exit;
    }
}

// POST requests
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
    
    // Handle form-urlencoded (delete and announcement updates)
    if (strpos($contentType, 'application/x-www-form-urlencoded') !== false) {
        parse_str(file_get_contents('php://input'), $postData);
        $action = $postData['action'] ?? $_POST['action'] ?? '';
        
        // Delete entry
        if ($action === 'delete') {
            $id = $postData['id'] ?? $_POST['id'] ?? null;
            $password = $postData['password'] ?? $_POST['password'] ?? '';
            
            if ($password !== '__OLD_ADMIN_PASSWORD__') {
                http_response_code(403);
                echo json_encode(['error' => 'Unauthorized']);
                exit;
            }
            
            if (!$id) {
                http_response_code(400);
                echo json_encode(['error' => 'ID required']);
                exit;
            }
            
            $data = file_exists($scoreFile) ? json_decode(file_get_contents($scoreFile), true) : ['scores' => []];
            $scores = $data['scores'] ?? [];
            
            usort($scores, function($a, $b) {
                return $b['score'] - $a['score'];
            });
            
            $index = (int)$id - 1;
            if ($index >= 0 && $index < count($scores)) {
                array_splice($scores, $index, 1);
                $data['scores'] = $scores;
                file_put_contents($scoreFile, json_encode($data, JSON_PRETTY_PRINT));
                echo json_encode(['success' => true]);
            } else {
                http_response_code(404);
                echo json_encode(['error' => 'Entry not found']);
            }
            exit;
        }
        
        // Update announcement
        if ($action === 'update_announcement') {
            $announcement = $postData['announcement'] ?? $_POST['announcement'] ?? '';
            $password = $postData['password'] ?? $_POST['password'] ?? '';
            
            if ($password !== '__OLD_ADMIN_PASSWORD__') {
                http_response_code(403);
                echo json_encode(['error' => 'Unauthorized']);
                exit;
            }
            
            $data = file_exists($scoreFile) ? json_decode(file_get_contents($scoreFile), true) : ['scores' => []];
            $data['announcement'] = $announcement;
            file_put_contents($scoreFile, json_encode($data, JSON_PRETTY_PRINT));
            echo json_encode(['success' => true]);
            exit;
        }
        
        http_response_code(400);
        echo json_encode(['error' => 'Invalid action']);
        exit;
    }
    
    // Handle JSON (score submission)
    $input = json_decode(file_get_contents('php://input'), true);
    
    if (!isset($input['score']) || !is_numeric($input['score'])) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid score']);
        exit;
    }
    
    $newScore = (int)$input['score'];
    $playerName = isset($input['name']) ? trim($input['name']) : 'Anonymous';
    
    if (strlen($playerName) > 50) {
        $playerName = substr($playerName, 0, 50);
    }
    if (empty($playerName)) {
        $playerName = 'Anonymous';
    }
    
    $data = file_exists($scoreFile) ? json_decode(file_get_contents($scoreFile), true) : ['scores' => []];
    $scores = $data['scores'] ?? [];
    
    $scores[] = [
        'score' => $newScore,
        'name' => $playerName,
        'timestamp' => date('c')
    ];
    
    usort($scores, function($a, $b) {
        return $b['score'] - $a['score'];
    });
    
    $rank = 1;
    foreach ($scores as $index => $item) {
        if ($item['score'] === $newScore && $item['name'] === $playerName) {
            $rank = $index + 1;
            break;
        }
    }
    
    $data['scores'] = $scores;
    file_put_contents($scoreFile, json_encode($data, JSON_PRETTY_PRINT));
    
    echo json_encode([
        'success' => true,
        'rank' => $rank
    ]);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);
?>
