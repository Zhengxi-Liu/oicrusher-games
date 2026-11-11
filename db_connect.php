<?php
// 数据库连接文件
$servername = "localhost";

$username = "root";
$password = "";
$dbname = "games";

$conn = new mysqli($servername, $username, $password, $dbname);
if ($conn->connect_error) {
    die("Connection failed: " . $conn->connect_error);
}
?>
