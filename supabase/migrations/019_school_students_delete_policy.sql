-- Allow students to delete their own school links (needed for school change flow)
CREATE POLICY "school_students_student_delete"
  ON school_students FOR DELETE
  USING (student_id IN (SELECT id FROM students WHERE user_id = auth.uid()));
