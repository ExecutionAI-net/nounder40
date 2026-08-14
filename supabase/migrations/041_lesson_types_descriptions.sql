-- Per-language descriptions on lesson types (FR/ES were missing)
ALTER TABLE lesson_types ADD COLUMN IF NOT EXISTS description_fr TEXT;
ALTER TABLE lesson_types ADD COLUMN IF NOT EXISTS description_es TEXT;
