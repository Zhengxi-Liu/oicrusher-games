<?php
error_reporting(E_ALL);
ini_set('display_errors', 1);

$scoreFile = __DIR__ . '/snake_scores.json';

echo "Score file: $scoreFile\n";
echo "File exists: " . (file_exists($scoreFile) ? 'yes' : 'no') . "\n";
echo "Is writable: " . (is_writable($scoreFile) ? 'yes' : 'no') . "\n";

$data = ['highScore' => 5000, 'timestamp' => date('c')];
$result = file_put_contents($scoreFile, json_encode($data, JSON_PRETTY_PRINT));

echo "Write result: " . ($result !== false ? $result . ' bytes' : 'FAILED') . "\n";
echo "New content: " . file_get_contents($scoreFile) . "\n";
?>
