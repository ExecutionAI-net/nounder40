-- Per-language images on lesson types (images can contain text)
ALTER TABLE lesson_types ADD COLUMN IF NOT EXISTS image_url_it TEXT;
ALTER TABLE lesson_types ADD COLUMN IF NOT EXISTS image_url_en TEXT;
ALTER TABLE lesson_types ADD COLUMN IF NOT EXISTS image_url_fr TEXT;
ALTER TABLE lesson_types ADD COLUMN IF NOT EXISTS image_url_es TEXT;
