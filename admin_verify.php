<?php
// 管理员密码验证接口
header('Content-Type: application/json');
require_once 'db_connect.php'; // 需有数据库连接文件

// 获取前端提交的密码
$input = json_decode(file_get_contents('php://input'), true);
$password = $input['password'] ?? '';

if (!$password) {
    echo json_encode(['success' => false, 'message' => '密码不能为空']);
    exit;
}

// 查询数据库中的密码 hash
$sql = "SELECT password_hash FROM admin_passwords ORDER BY id DESC LIMIT 1";
$result = $conn->query($sql);
if ($row = $result->fetch_assoc()) {
    $hash = $row['password_hash'];
    if (password_verify($password, $hash)) {
        echo json_encode(['success' => true]);
    } else {
        echo json_encode(['success' => false, 'message' => '密码错误']);
    }
} else {
    echo json_encode(['success' => false, 'message' => '未设置管理员密码']);
}
?>
