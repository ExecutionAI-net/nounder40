-- Allow users to insert their own profile (needed when trigger is delayed or missing)
CREATE POLICY "profiles_insert_own"
  ON profiles FOR INSERT
  WITH CHECK (id = auth.uid());
