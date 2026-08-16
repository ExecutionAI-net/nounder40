-- Impostazione scuola: mostrare o nascondere il nome dell'insegnante alle allieve
-- (a volte è un peggiorativo: la scuola può spegnerlo)
ALTER TABLE schools ADD COLUMN IF NOT EXISTS show_teacher_to_students BOOLEAN NOT NULL DEFAULT true;
