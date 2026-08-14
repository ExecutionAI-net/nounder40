-- Atomic function: get-or-create student, then link to school.
-- SECURITY DEFINER bypasses RLS so no permission issues.
CREATE OR REPLACE FUNCTION link_student_to_school(
  p_user_id   UUID,
  p_email     TEXT,
  p_name      TEXT,
  p_school_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_student_id UUID;
BEGIN
  -- Insert student if not exists; on conflict just return existing id
  INSERT INTO students (user_id, email, name)
  VALUES (p_user_id, p_email, p_name)
  ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
  RETURNING id INTO v_student_id;

  -- Remove existing school links for this student
  DELETE FROM school_students WHERE student_id = v_student_id;

  -- Link student to new school
  INSERT INTO school_students (student_id, school_id, free_lesson_used)
  VALUES (v_student_id, p_school_id, false)
  ON CONFLICT (school_id, student_id) DO NOTHING;

  RETURN v_student_id;
END;
$$;
