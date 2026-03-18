ALTER TABLE workshop_entries ADD COLUMN worldbook_position_type TEXT NOT NULL DEFAULT 'after_character_definition';
ALTER TABLE workshop_entries ADD COLUMN worldbook_depth INTEGER NOT NULL DEFAULT 0;
