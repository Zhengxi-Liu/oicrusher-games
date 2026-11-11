<?php
header('Content-Type: application/json');

$contentType = $_SERVER['CONTENT_TYPE'] ?? '';
$rawInput = file_get_contents('php://input');

parse_str($rawInput, $parsed);

echo json_encode([
    'content_type' => $contentType,
    'raw_input' => $rawInput,
    'parsed' => $parsed,
    'POST' => $_POST,
    'action_from_parsed' => $parsed['action'] ?? null,
    'action_from_POST' => $_POST['action'] ?? null
]);
?>
