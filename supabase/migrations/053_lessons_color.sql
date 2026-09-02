-- Colore per singola lezione: ogni orario di un corso può avere il suo colore
-- (prima il colore viveva solo su courses.color e si uniformava al salvataggio)
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS color TEXT;

-- Backfill: le lezioni esistenti ereditano il colore del corso
UPDATE lessons SET color = courses.color
FROM courses
WHERE lessons.course_id = courses.id AND lessons.color IS NULL;
