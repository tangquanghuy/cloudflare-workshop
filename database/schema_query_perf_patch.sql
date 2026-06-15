CREATE INDEX IF NOT EXISTS idx_preset_likes_preset_created
ON preset_likes(preset_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_preset_likes_user_preset
ON preset_likes(user_discord_id, preset_id);

CREATE INDEX IF NOT EXISTS idx_preset_download_events_preset_created
ON preset_download_events(preset_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workshop_entry_likes_entry_created
ON workshop_entry_likes(entry_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workshop_entry_likes_user_entry
ON workshop_entry_likes(user_discord_id, entry_id);
