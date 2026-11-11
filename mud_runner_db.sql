-- Mud Runner 2D leaderboard (score = metres travelled).
-- Run once against the existing `games` database; do NOT copy this file into the web root:
--   ssh root@oicrusher.me 'mysql -u root games' < mud_runner_db.sql
CREATE TABLE IF NOT EXISTS mud_runner_scores (
    id INT PRIMARY KEY AUTO_INCREMENT,
    player_name VARCHAR(50) DEFAULT 'Anonymous',
    score INT NOT NULL DEFAULT 0,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_score (score DESC)
);
