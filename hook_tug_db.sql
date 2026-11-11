-- Hook & Tug - online lobby (presence + challenges) + WebRTC signaling relay + match history
-- Usage: ssh root@oicrusher.me 'mysql -u root games' < hook_tug_db.sql

-- Everyone with the online lobby open. Rows expire when the browser stops polling.
CREATE TABLE IF NOT EXISTS hook_tug_players (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(32)  NOT NULL,
  token      CHAR(32)     NOT NULL,
  last_seen  DATETIME     NOT NULL,
  created_at DATETIME     NOT NULL,
  INDEX idx_last_seen (last_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hook_tug_invites (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  from_id    INT NOT NULL,
  to_id      INT NOT NULL,
  state      ENUM('pending','accepted','declined','cancelled') NOT NULL DEFAULT 'pending',
  match_id   INT NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_to (to_id, state),
  INDEX idx_from (from_id, state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The challenger is the host (runs the physics). A match stays active while either
-- side keeps sending heartbeats; gameplay itself goes over the P2P DataChannel.
CREATE TABLE IF NOT EXISTS hook_tug_matches (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  host_id    INT NOT NULL,
  guest_id   INT NOT NULL,
  host_name  VARCHAR(32) NOT NULL,
  guest_name VARCHAR(32) NOT NULL,
  state      ENUM('active','ended') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  INDEX idx_state (state, updated_at),
  INDEX idx_host (host_id, state),
  INDEX idx_guest (guest_id, state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- SDP offers/answers and ICE candidates waiting to be picked up by the other player.
CREATE TABLE IF NOT EXISTS hook_tug_relay (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  match_id   INT NOT NULL,
  to_id      INT NOT NULL,
  payload    TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_match (match_id, to_id, id),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Finished first-to-5 matches, reported by the host. Names are copied so history outlives players.
CREATE TABLE IF NOT EXISTS hook_tug_history (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  match_id     INT NOT NULL,
  played_at    DATETIME NOT NULL,
  host_name    VARCHAR(32) NOT NULL,
  guest_name   VARCHAR(32) NOT NULL,
  host_score   TINYINT UNSIGNED NOT NULL,
  guest_score  TINYINT UNSIGNED NOT NULL,
  duration_sec SMALLINT UNSIGNED NOT NULL,
  INDEX idx_played (played_at),
  INDEX idx_match (match_id, played_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
