-- Cannon Duel - online duel lobby + event relay
-- Usage: mysql -u root games < cannon_duel_db.sql

CREATE TABLE IF NOT EXISTS cannon_duel_players (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(32)  NOT NULL,
  token      CHAR(32)     NOT NULL,
  last_seen  DATETIME     NOT NULL,
  created_at DATETIME     NOT NULL,
  INDEX idx_last_seen (last_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cannon_duel_matches (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  host_id    INT NOT NULL,
  guest_id   INT NOT NULL,
  state      ENUM('active','ended') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  INDEX idx_state (state),
  INDEX idx_host (host_id),
  INDEX idx_guest (guest_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cannon_duel_invites (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  from_id    INT NOT NULL,
  to_id      INT NOT NULL,
  state      ENUM('pending','accepted','declined','cancelled') NOT NULL DEFAULT 'pending',
  match_id   INT NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_to (to_id, state),
  INDEX idx_from (from_id, state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per gameplay event (fire / damage / airburst / terrain handshake).
CREATE TABLE IF NOT EXISTS cannon_duel_events (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  match_id   INT NOT NULL,
  sender_id  INT NOT NULL,
  payload    VARCHAR(2048) NOT NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_match (match_id, id),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Finished battles. Names are denormalised on purpose: player rows are deleted
-- when someone leaves the lobby, but the history has to outlive them.
CREATE TABLE IF NOT EXISTS cannon_duel_history (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  match_id      INT NOT NULL,
  played_at     DATETIME NOT NULL,
  map_id        VARCHAR(16) NOT NULL,
  duration_sec  SMALLINT UNSIGNED NOT NULL,
  airbursts     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  winner_id     INT NOT NULL,
  winner_name   VARCHAR(32) NOT NULL,
  winner_hp     TINYINT UNSIGNED NOT NULL,
  winner_shots  SMALLINT UNSIGNED NOT NULL,
  winner_hits   SMALLINT UNSIGNED NOT NULL,
  winner_damage SMALLINT UNSIGNED NOT NULL,
  loser_id      INT NOT NULL,
  loser_name    VARCHAR(32) NOT NULL,
  loser_hp      TINYINT UNSIGNED NOT NULL,
  loser_shots   SMALLINT UNSIGNED NOT NULL,
  loser_hits    SMALLINT UNSIGNED NOT NULL,
  loser_damage  SMALLINT UNSIGNED NOT NULL,
  UNIQUE KEY uniq_match (match_id),
  INDEX idx_played (played_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
