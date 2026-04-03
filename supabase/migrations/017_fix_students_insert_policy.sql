-- Allow service-role and newly registered users to insert student records.
-- user_id FK to auth.users prevents orphan records.
DROP POLICY IF EXISTS "students_insert" ON students;
CREATE POLICY "students_insert" ON students FOR INSERT WITH CHECK (true);
