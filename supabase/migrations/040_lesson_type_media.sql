-- HQ-level media on lesson types: image + per-language preview link
-- (YouTube/Vimeo) shown to students when booking
ALTER TABLE lesson_types ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE lesson_types ADD COLUMN IF NOT EXISTS video_url_it TEXT;
ALTER TABLE lesson_types ADD COLUMN IF NOT EXISTS video_url_en TEXT;
ALTER TABLE lesson_types ADD COLUMN IF NOT EXISTS video_url_fr TEXT;
ALTER TABLE lesson_types ADD COLUMN IF NOT EXISTS video_url_es TEXT;
