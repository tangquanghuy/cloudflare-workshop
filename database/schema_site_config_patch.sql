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
