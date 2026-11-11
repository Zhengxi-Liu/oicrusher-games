-- Geometry Dash leaderboard table (endless mode, score-based)
-- Run this once against the existing `games` database on the server.
-- The scoring model changed from per-level percent-complete to a single global
-- distance+bonus score, so this replaces the old per-level table outright.
DROP TABLE IF EXISTS geometry_dash_scores;
CREATE TABLE geometry_dash_scores (
    id INT PRIMARY KEY AUTO_INCREMENT,
    player_name VARCHAR(50) UNIQUE DEFAULT 'Anonymous',
    score INT NOT NULL DEFAULT 0,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_score (score DESC)
);
