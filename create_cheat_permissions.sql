-- Create cheat permissions table
CREATE TABLE IF NOT EXISTS doodle_cheat_permissions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    setting_key VARCHAR(50) UNIQUE NOT NULL,
    is_disabled BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Insert default settings
INSERT INTO doodle_cheat_permissions (setting_key, is_disabled) VALUES 
    ('control_p_cheat', FALSE),
    ('e_key_dismount', FALSE)
ON DUPLICATE KEY UPDATE setting_key = setting_key;

-- Add index for faster lookup
CREATE INDEX idx_setting_key ON doodle_cheat_permissions (setting_key);
