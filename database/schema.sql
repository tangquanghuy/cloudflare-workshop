CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS presets (
  id TEXT PRIMARY KEY,
  owner_discord_id TEXT NOT NULL,
  title TEXT NOT NULL,
  intro TEXT,
  cover_url TEXT,
  cover_object_key TEXT,
  object_key TEXT NOT NULL,
  class_name TEXT,
  race TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  preset_json TEXT NOT NULL,
  like_count INTEGER NOT NULL DEFAULT 0,
  download_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS preset_likes (
  preset_id TEXT NOT NULL,
  user_discord_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (preset_id, user_discord_id)
);

CREATE TABLE IF NOT EXISTS preset_download_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  preset_id TEXT NOT NULL,
  user_discord_id TEXT,
  ip_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_presets_owner ON presets(owner_discord_id);
CREATE INDEX IF NOT EXISTS idx_presets_created ON presets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_presets_likes ON presets(like_count DESC);
CREATE INDEX IF NOT EXISTS idx_presets_downloads ON presets(download_count DESC);

CREATE TABLE IF NOT EXISTS workshop_entries (
  id TEXT PRIMARY KEY,
  entry_type TEXT NOT NULL,
  owner_discord_id TEXT NOT NULL,
  title TEXT NOT NULL,
  intro TEXT,
  overview_text TEXT NOT NULL DEFAULT '',
  content_sections_json TEXT,
  trigger_words TEXT NOT NULL DEFAULT '',
  worldbook_position_type TEXT NOT NULL DEFAULT 'after_character_definition',
  worldbook_depth INTEGER NOT NULL DEFAULT 0,
  worldbook_order INTEGER NOT NULL DEFAULT 401,
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
