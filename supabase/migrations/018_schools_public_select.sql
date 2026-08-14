-- Allow anyone to read active schools (needed for public registration form)
CREATE POLICY "schools_public_select"
  ON schools FOR SELECT
  USING (active = true);
