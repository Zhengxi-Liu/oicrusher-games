-- Game Portal like counts (one row per like). Run once; do NOT copy into the web root:
--   ssh root@oicrusher.me 'mysql -u root games' < likes_db.sql
CREATE TABLE IF NOT EXISTS game_likes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    game VARCHAR(40) NOT NULL,
    client_id CHAR(32) NOT NULL,
    ip VARCHAR(45) NOT NULL DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_game_client (game, client_id),
    INDEX idx_game_ip (game, ip, created_at)
);
