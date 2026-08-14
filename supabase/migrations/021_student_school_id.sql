-- Add school_id directly on students table for primary school assignment
ALTER TABLE students ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id) ON DELETE SET NULL;

-- Ensure students can update their own record
DROP POLICY IF EXISTS "students_own_update" ON students;
CREATE POLICY "students_own_update" ON students FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
