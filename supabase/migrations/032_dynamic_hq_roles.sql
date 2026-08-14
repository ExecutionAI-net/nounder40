-- Dynamic HQ roles & permissions matrix (editable by owner/super_admin,
-- custom profiles allowed). hq_sub_role becomes TEXT so new role keys
-- don't require an enum change.

ALTER TABLE profiles ALTER COLUMN hq_sub_role TYPE TEXT USING hq_sub_role::text;
ALTER TABLE hq_members ALTER COLUMN sub_role DROP DEFAULT;
ALTER TABLE hq_members ALTER COLUMN sub_role TYPE TEXT USING sub_role::text;
ALTER TABLE hq_members ALTER COLUMN sub_role SET DEFAULT 'support';

CREATE TABLE IF NOT EXISTS hq_roles (
  key         TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  builtin     BOOLEAN NOT NULL DEFAULT false,
  permissions TEXT[] NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE hq_roles ENABLE ROW LEVEL SECURITY;

-- Read: any HQ member (writes go through the API with the service role)
DROP POLICY IF EXISTS "hq_roles_hq_read" ON hq_roles;
CREATE POLICY "hq_roles_hq_read" ON hq_roles FOR SELECT
  USING (get_my_role() = 'hq');

-- Seed from the previously hardcoded matrix (idempotent)
INSERT INTO hq_roles (key, label, builtin, permissions) VALUES
  ('owner', 'Owner', true, ARRAY['dashboard','schools_view','schools_create_edit','schools_activate','schools_platform_fee','payments','reports','inbox','library','shop','packages','lesson_types','team','permissions','homepage_settings','locations','translations','email_templates']),
  ('super_admin', 'Super Admin', true, ARRAY['dashboard','schools_view','schools_create_edit','schools_activate','schools_platform_fee','payments','reports','inbox','library','shop','packages','lesson_types','team','permissions','homepage_settings','locations','translations','email_templates']),
  ('operations', 'Operations', true, ARRAY['dashboard','schools_view','schools_create_edit','schools_activate','inbox','library','shop','packages','lesson_types','homepage_settings','locations']),
  ('finance', 'Finance', true, ARRAY['dashboard','schools_view','schools_platform_fee','payments','reports']),
  ('tech_support', 'Tech Support', true, ARRAY['dashboard','inbox']),
  ('analytics', 'Analytics', true, ARRAY['dashboard','schools_view','reports']),
  ('support', 'Support', true, ARRAY['dashboard','inbox'])
ON CONFLICT (key) DO NOTHING;
