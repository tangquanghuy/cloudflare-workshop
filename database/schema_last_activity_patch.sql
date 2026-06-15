ALTER TABLE presets ADD COLUMN last_activity_at TEXT;

UPDATE presets
SET last_activity_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
WHERE last_activity_at IS NULL OR last_activity_at = '';

ALTER TABLE workshop_entries ADD COLUMN last_activity_at TEXT;

UPDATE workshop_entries
SET last_activity_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
WHERE last_activity_at IS NULL OR last_activity_at = '';

CREATE INDEX IF NOT EXISTS idx_presets_last_activity
ON presets(last_activity_at DESC);

CREATE INDEX IF NOT EXISTS idx_workshop_entries_last_activity
ON workshop_entries(last_activity_at DESC);
