-- HQ packages: make school_id nullable (NULL = HQ global package)
ALTER TABLE packages ALTER COLUMN school_id DROP NOT NULL;

-- Index for HQ packages (school_id IS NULL)
CREATE INDEX IF NOT EXISTS idx_packages_hq ON packages (id) WHERE school_id IS NULL;

-- school_students: ensure unique constraint exists (safe re-run)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'school_students_unique'
  ) THEN
    ALTER TABLE school_students ADD CONSTRAINT school_students_unique UNIQUE (school_id, student_id);
  END IF;
END$$;
