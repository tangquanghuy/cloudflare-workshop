ALTER TABLE workshop_entries ADD COLUMN like_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS workshop_entry_likes (
  entry_id TEXT NOT NULL,
  user_discord_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (entry_id, user_discord_id)
);

CREATE INDEX IF NOT EXISTS idx_workshop_entries_likes ON workshop_entries(like_count DESC);
