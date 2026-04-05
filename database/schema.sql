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

CREATE TABLE IF NOT EXISTS site_featured_slots (
  id TEXT PRIMARY KEY,
  slot_key TEXT NOT NULL UNIQUE,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  badge_text TEXT NOT NULL DEFAULT '每周推荐',
  title TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  starts_at TEXT,
  ends_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS site_announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  badge_text TEXT NOT NULL DEFAULT '公告',
  display_mode TEXT NOT NULL DEFAULT 'modal',
  link_label TEXT NOT NULL DEFAULT '',
  link_url TEXT NOT NULL DEFAULT '',
  dismiss_key TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'active',
  starts_at TEXT,
  ends_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_site_featured_slots_status ON site_featured_slots(status, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_site_announcements_status ON site_announcements(status, sort_order, starts_at, ends_at);

CREATE TRIGGER IF NOT EXISTS trg_site_featured_slots_updated_at
AFTER UPDATE ON site_featured_slots
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE site_featured_slots
  SET updated_at = CURRENT_TIMESTAMP
  WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_site_announcements_updated_at
AFTER UPDATE ON site_announcements
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE site_announcements
  SET updated_at = CURRENT_TIMESTAMP
  WHERE id = OLD.id;
END;
