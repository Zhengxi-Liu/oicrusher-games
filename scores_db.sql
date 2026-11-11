-- Shared Top 20 leaderboard (scores_api.php / leaderboard.js), one table for many games.
-- Run once against the existing `games` database; do NOT copy this file into the web root:
--   ssh root@oicrusher.me 'mysql -u root games' < scores_db.sql
CREATE TABLE IF NOT EXISTS game_scores (
    id INT PRIMARY KEY AUTO_INCREMENT,
    game VARCHAR(40) NOT NULL,
    player_name VARCHAR(50) DEFAULT 'Anonymous',
    score INT NOT NULL DEFAULT 0,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_game_score (game, score DESC, id)
);
