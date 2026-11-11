<?php
// Announcement update code for snake_api.php
// Insert this after the delete handler and before "If we get here with form-urlencoded..."

        // Handle announcement update
        if ($action === 'update_announcement') {
            $announcement = $postData['announcement'] ?? $_POST['announcement'] ?? '';
            $password = $postData['password'] ?? $_POST['password'] ?? '';
            
            // Verify admin password
            if ($password !== '__OLD_ADMIN_PASSWORD__') {
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
