-- Allow school users to update their own school record (e.g. Stripe onboarding)
DROP POLICY IF EXISTS "schools_school_update" ON schools;
CREATE POLICY "schools_school_update" ON schools FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
