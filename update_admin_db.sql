-- 创建管理员密码表
CREATE TABLE IF NOT EXISTS admin_passwords (
    id INT AUTO_INCREMENT PRIMARY KEY,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 插入初始密码（请用实际密码的hash替换）
INSERT INTO admin_passwords (password_hash) VALUES ('$2y$10$examplehash');
-- 你可以用 PHP 的 password_hash('your_password', PASSWORD_DEFAULT) 生成实际 hash
