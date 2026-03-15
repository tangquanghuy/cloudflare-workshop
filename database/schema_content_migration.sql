CREATE TABLE IF NOT EXISTS workshop_entries (
  id TEXT PRIMARY KEY,
  entry_type TEXT NOT NULL,
  owner_discord_id TEXT NOT NULL,
  title TEXT NOT NULL,
  intro TEXT,
  overview_text TEXT NOT NULL DEFAULT '',
  trigger_words TEXT NOT NULL DEFAULT '',
  cover_url TEXT,
  cover_object_key TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  content_text TEXT NOT NULL,
  like_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workshop_entry_likes (
  entry_id TEXT NOT NULL,
  user_discord_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (entry_id, user_discord_id)
);

CREATE INDEX IF NOT EXISTS idx_workshop_entries_type ON workshop_entries(entry_type);
CREATE INDEX IF NOT EXISTS idx_workshop_entries_owner ON workshop_entries(owner_discord_id);
CREATE INDEX IF NOT EXISTS idx_workshop_entries_created ON workshop_entries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workshop_entries_likes ON workshop_entries(like_count DESC);
