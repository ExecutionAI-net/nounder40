-- 1. Website on schools
ALTER TABLE schools ADD COLUMN IF NOT EXISTS website TEXT;

-- 2. Multi-school membership: a school-role user can belong to several schools.
--    profiles.school_id stays the ACTIVE school (whole app keeps reading it);
--    switching updates it after validating membership here.
CREATE TABLE IF NOT EXISTS school_memberships (
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  school_id  UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  sub_role   TEXT NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, school_id)
);

ALTER TABLE school_memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "school_memberships_own_read" ON school_memberships;
CREATE POLICY "school_memberships_own_read" ON school_memberships FOR SELECT
  USING (profile_id = auth.uid() OR get_my_role() = 'hq');

-- Seed from current single-school assignments (idempotent)
INSERT INTO school_memberships (profile_id, school_id, sub_role)
SELECT id, school_id, COALESCE(school_sub_role, 'admin')
FROM profiles
WHERE school_id IS NOT NULL
  AND (role = 'school' OR 'school' = ANY(roles))
ON CONFLICT DO NOTHING;

-- 3. Seed HQ countries/cities (were empty → school profile said "not configured")
INSERT INTO hq_countries (name, code) VALUES
  ('Italy', 'IT'), ('Spain', 'ES'), ('France', 'FR'),
  ('Germany', 'DE'), ('United Kingdom', 'GB'), ('Türkiye', 'TR')
ON CONFLICT DO NOTHING;

INSERT INTO hq_cities (country_id, name)
SELECT c.id, v.city FROM (VALUES
  ('IT', 'Milano'), ('IT', 'Roma'), ('IT', 'Torino'),
  ('ES', 'Barcelona'), ('ES', 'Madrid'),
  ('FR', 'Paris'), ('DE', 'Aachen'), ('DE', 'Berlin')
) AS v(code, city)
JOIN hq_countries c ON c.code = v.code
WHERE NOT EXISTS (
  SELECT 1 FROM hq_cities x WHERE x.name = v.city
);
