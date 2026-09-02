-- 060: documenti allieve — tipi definiti dalla scuola, più file per documento,
-- scadenza gestita dalla scuola, blocco prenotazioni opzionale.

-- Tipi di documento richiesti da ciascuna scuola.
-- variants = scelte ammesse per lo stesso tipo (es. carta d'identità /
-- permesso di soggiorno / passaporto): l'allieva indica quale sta caricando.
CREATE TABLE IF NOT EXISTS school_document_types (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id   UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  variants    TEXT[] NOT NULL DEFAULT '{}',
  has_expiry  BOOLEAN NOT NULL DEFAULT true,
  required    BOOLEAN NOT NULL DEFAULT false,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, code)
);

ALTER TABLE school_document_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "school_doc_types_read" ON school_document_types;
DROP POLICY IF EXISTS "school_doc_types_write" ON school_document_types;
-- Lettura aperta: l'allieva deve sapere cosa le viene chiesto anche prima
-- di risultare iscritta; la scrittura resta alla scuola proprietaria e a HQ.
CREATE POLICY "school_doc_types_read" ON school_document_types FOR SELECT USING (true);
CREATE POLICY "school_doc_types_write" ON school_document_types FOR ALL
  USING (school_id = get_my_school_id() OR get_my_role() = 'hq');

-- Allegati: un PDF oppure più immagini (es. fronte/retro).
-- Si salva il percorso nel bucket privato, non un URL: i link si firmano al volo.
-- [{ "path": "...", "name": "fronte.jpg", "mime": "image/jpeg", "size": 12345 }]
ALTER TABLE student_documents
  ADD COLUMN IF NOT EXISTS files   JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS variant TEXT,
  ADD COLUMN IF NOT EXISTS type_id UUID REFERENCES school_document_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS note    TEXT;

COMMENT ON COLUMN student_documents.files IS 'Allegati nel bucket privato documents: [{path,name,mime,size}]';
COMMENT ON COLUMN student_documents.variant IS 'Variante scelta fra quelle del tipo (es. Passaporto)';

-- Documento obbligatorio mancante o scaduto: bloccare la prenotazione o solo avvisare
ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS block_booking_on_documents BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN schools.block_booking_on_documents IS
  'true = niente prenotazione senza documenti obbligatori validi; false = solo avviso';

-- Tipi predefiniti per le scuole esistenti (modificabili e disattivabili)
INSERT INTO school_document_types (school_id, code, name, variants, has_expiry, required, sort_order)
SELECT s.id, d.code, d.name, d.variants, d.has_expiry, d.required, d.sort_order
FROM schools s
CROSS JOIN (VALUES
  ('id_document',   'Documento di riconoscimento', ARRAY['Carta d''identità','Permesso di soggiorno','Passaporto'], true,  false, 1),
  ('medical_cert',  'Certificato medico',          ARRAY[]::TEXT[],                                                  true,  true,  2),
  ('privacy',       'Informativa privacy',         ARRAY[]::TEXT[],                                                  false, false, 3),
  ('image_release', 'Liberatoria immagini',        ARRAY[]::TEXT[],                                                  false, false, 4)
) AS d(code, name, variants, has_expiry, required, sort_order)
ON CONFLICT (school_id, code) DO NOTHING;

-- Documenti già caricati: aggancio al tipo corrispondente della loro scuola
UPDATE student_documents sd
SET type_id = t.id
FROM school_document_types t
WHERE t.school_id = sd.school_id
  AND t.code = sd.type
  AND sd.type_id IS NULL;
