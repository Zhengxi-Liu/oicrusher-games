<?php
// Test script to verify doodle_api.php functionality
$_SERVER['REQUEST_METHOD'] = 'POST';
$_SERVER['CONTENT_TYPE'] = 'application/json';

// Simulate POST data
$input = json_encode(['score' => 100, 'name' => 'Test Player']);
$_POST = json_decode($input, true);

// Capture output
ob_start();
include 'doodle_api.php';
$output = ob_get_clean();

echo $output;
?>
