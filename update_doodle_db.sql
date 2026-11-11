-- Add player_name column to doodle_scores table
ALTER TABLE doodle_scores 
ADD COLUMN player_name VARCHAR(50) DEFAULT 'Anonymous' AFTER score;

-- Update existing records to have a default name
UPDATE doodle_scores SET player_name = 'Anonymous' WHERE player_name IS NULL;

-- Add index for faster leaderboard queries
CREATE INDEX idx_score_desc ON doodle_scores (score DESC);
