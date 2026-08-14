-- Multi-school: any member of a school (school_memberships) can update its
-- record, not only the single user_id owner.
DROP POLICY IF EXISTS "schools_school_update" ON schools;
CREATE POLICY "schools_school_update" ON schools FOR UPDATE
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM school_memberships m WHERE m.school_id = schools.id AND m.profile_id = auth.uid())
  )
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM school_memberships m WHERE m.school_id = schools.id AND m.profile_id = auth.uid())
  );
