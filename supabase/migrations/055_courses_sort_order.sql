-- Ordinamento manuale dei corsi nella lista della scuola (frecce su/giù)
ALTER TABLE courses ADD COLUMN IF NOT EXISTS sort_order INT;

-- Backfill: ordine attuale (per data inizio, più recenti in alto)
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY school_id ORDER BY start_date DESC, created_at DESC) AS rn
  FROM courses
)
UPDATE courses SET sort_order = ranked.rn
FROM ranked
WHERE courses.id = ranked.id AND courses.sort_order IS NULL;
