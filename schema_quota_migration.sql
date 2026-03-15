ALTER TABLE users ADD COLUMN storage_quota_bytes INTEGER NOT NULL DEFAULT 314572800;
ALTER TABLE users ADD COLUMN storage_used_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE presets ADD COLUMN cover_size_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE presets ADD COLUMN preset_size_bytes INTEGER NOT NULL DEFAULT 0;

UPDATE users
SET storage_quota_bytes = COALESCE(storage_quota_bytes, 314572800),
    storage_used_bytes = COALESCE(storage_used_bytes, 0);

UPDATE presets
SET cover_size_bytes = COALESCE(cover_size_bytes, 0),
    preset_size_bytes = COALESCE(preset_size_bytes, 0);

UPDATE users
SET storage_used_bytes = COALESCE((
  SELECT SUM(COALESCE(p.preset_size_bytes, 0) + COALESCE(p.cover_size_bytes, 0))
  FROM presets p
  WHERE p.owner_discord_id = users.discord_id
), 0);
