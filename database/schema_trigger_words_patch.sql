ALTER TABLE presets ADD COLUMN trigger_words TEXT NOT NULL DEFAULT '';

ALTER TABLE workshop_entries ADD COLUMN trigger_words TEXT NOT NULL DEFAULT '';
