-- Ordinamento manuale del catalogo tipi lezione HQ (frecce su/giù).
-- L'ordine vale ovunque: catalogo HQ, tendine della scuola, cataloghi studente.
ALTER TABLE lesson_types ADD COLUMN IF NOT EXISTS sort_order INT;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY name_en) AS rn
  FROM lesson_types
)
UPDATE lesson_types SET sort_order = ranked.rn
FROM ranked
WHERE lesson_types.id = ranked.id AND lesson_types.sort_order IS NULL;
